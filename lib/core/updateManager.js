import Gio from 'gi://Gio';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

import {canSudoWithoutPassword} from '../auth/sudo.js';
import {checkAllUpdates} from '../backends/checker.js';
import {detectBackends} from '../backends/detect.js';
import {DebugLogger} from '../common/debug.js';
import {countArchUpdates, emptyBySource, hasArchUpdates} from '../common/sources.js';
import {isCancelledError} from '../common/subprocess.js';
import {UpdateLogWriter} from '../updater/logWriter.js';
import {UpdateRunner} from '../updater/runner.js';
import {PacmanDbWatcher} from './pacmanWatcher.js';
import {CheckScheduler} from './scheduler.js';
import {StateCache, groupBySource} from './stateCache.js';

const SOURCE_SETTING_KEYS = ['enable-pacman', 'aur-helper', 'enable-flatpak', 'enable-gearlever'];

const itemKey = item => `${item.source}:${item.id}`;

/**
 * UI-independent core of the extension: owns the update state, runs checks
 * and updates, and reacts to the settings that affect them.
 *
 * Signals:
 *  - `state-changed`               anything shown in the UI may have changed
 *  - `updates-changed`             the list of pending updates was replaced
 *  - `new-updates` (items)         a check found updates that were not pending before
 *  - `update-started`              the update pipeline is about to run
 *  - `update-progress` (event)     `{fraction, stageLabel, detail, line}`
 *  - `update-finished` (result)    `{ok, cancelled, errors}`
 */
export class UpdateManager extends EventEmitter {
    /**
     * @param {object} params
     * @param {Gio.Settings} params.settings
     * @param {string=} params.uuid Extension UUID used to namespace cached state
     * @param {(archCount: number) => Promise<string|null>} params.requestPassword
     *   Ask the user for a (verified) sudo password; resolve null if cancelled.
     */
    constructor({settings, uuid = null, requestPassword}) {
        super();

        this._settings = settings;
        this._requestPassword = requestPassword;
        this._destroyed = false;
        this._authenticating = false;

        /** @type {'idle'|'checking'|'updating'|'error'} */
        this.state = 'idle';
        this.updates = [];
        this.bySource = emptyBySource();
        this.lastTimings = null;
        this.checkErrors = [];
        this.lastCheck = null;

        this.debug = new DebugLogger(settings.get_boolean('debug-mode'));
        this._cache = uuid ? new StateCache({uuid, debug: this.debug}) : null;
        this._updateLog = uuid ? new UpdateLogWriter({uuid, debug: this.debug}) : null;
        this._updater = new UpdateRunner();
        this._checkCancellable = null;

        const endDetect = this.debug.startTimer('init', 'detectBackends');
        this.capabilities = detectBackends(settings);
        endDetect({
            pacman: this.capabilities.pacman.enabled,
            aur: this.capabilities.aur.name,
            flatpak: this.capabilities.flatpak.enabled,
            gearlever: this.capabilities.gearlever.mode,
        });

        this._scheduler = new CheckScheduler({
            settings,
            debug: this.debug,
            onCheck: () => this.runCheck(),
        });
        this._watcher = new PacmanDbWatcher({
            debug: this.debug,
            isBusy: () => this._updater.running || this._authenticating,
            onChanged: () => this.runCheck(),
        });

        settings.connectObject('changed', (_s, key) => this._onSettingChanged(key), this);
        this._watcher.setEnabled(settings.get_boolean('watch-pacman-db'));
    }

    /**
     * Restore cached state (if any) without blocking the shell, then schedule
     * the first check honoring `boot-delay` and remaining `check-interval`.
     */
    async start() {
        const cached = this._cache ? await this._cache.load() : null;
        if (this._destroyed)
            return;

        if (cached && this.lastCheck === null && this.state === 'idle') {
            this.updates = cached.updates.filter(u => this.capabilities[u.source]?.enabled);
            this.bySource = groupBySource(this.updates);
            this.lastCheck = cached.lastCheck;
            this.emit('updates-changed');
            this.emit('state-changed');
        }

        if (this.state === 'idle')
            this._scheduler.scheduleBoot(this.lastCheck);
    }

    get isUpdating() {
        return this._updater.running;
    }

    /** Non-fatal problems to show to the user. */
    get warnings() {
        const warnings = this.checkErrors.map(e => `${e.source}: ${e.message}`);
        if (this.capabilities.pacman.missingCheckupdates && this._settings.get_boolean('enable-pacman'))
            warnings.push('Install pacman-contrib to enable official repo checks (checkupdates).');
        return warnings;
    }

    _setState(state) {
        if (this.state === state)
            return;
        this.state = state;
        this.emit('state-changed');
    }

    _onSettingChanged(key) {
        if (key === 'debug-mode') {
            this.debug.enabled = this._settings.get_boolean('debug-mode');
            this.emit('state-changed');
        } else if (key === 'watch-pacman-db') {
            this._watcher.setEnabled(this._settings.get_boolean('watch-pacman-db'));
        } else if (key === 'check-interval') {
            this._scheduler.scheduleNext(this.lastCheck);
        } else if (SOURCE_SETTING_KEYS.includes(key)) {
            this.capabilities = detectBackends(this._settings);
            if (!this._updater.running)
                this.runCheck();
        }
    }

    // ── Checking ─────────────────────────────────────────────────────────

    cancelCheck({resetState = true} = {}) {
        this._scheduler.clearPostUpdate();
        if (this._checkCancellable) {
            this._checkCancellable.cancel();
            this._checkCancellable = null;
        }
        if (resetState && !this._destroyed && this.state === 'checking')
            this._setState('idle');
    }

    /**
     * @param {object} [options]
     * @param {Set<string>|null} [options.knownKeys] Pre-existing `source:id` keys (suppresses false "new updates" notifications after an upgrade)
     */
    async runCheck({knownKeys = null} = {}) {
        if (this._destroyed || this._authenticating || this._updater.running)
            return;

        this.cancelCheck({resetState: false});
        const cancellable = new Gio.Cancellable();
        this._checkCancellable = cancellable;

        const previousKeys = knownKeys ?? new Set(this.updates.map(itemKey));
        this._setState('checking');

        try {
            const result = await checkAllUpdates(this._settings, cancellable, this.debug);
            if (this._destroyed || cancellable.is_cancelled()) {
                if (!this._destroyed && this._checkCancellable === cancellable && this.state === 'checking')
                    this._setState('idle');
                return;
            }

            const totalFailure = result.updates.length === 0 && result.errors.length > 0;
            this.capabilities = result.capabilities;
            this.lastTimings = result.timings;
            this.checkErrors = result.errors;

            if (totalFailure && this.updates.length > 0) {
                // Keep last known updates visible & cached when offline/failed
                this._setState('idle');
            } else {
                this.updates = result.updates;
                this.bySource = result.bySource;
                if (!totalFailure) {
                    this.lastCheck = new Date();
                    this._cache?.save({lastCheck: this.lastCheck, updates: this.updates});
                }

                this.emit('updates-changed');
                this._setState(totalFailure ? 'error' : 'idle');

                const newItems = this.updates.filter(u => !previousKeys.has(itemKey(u)));
                if (newItems.length > 0)
                    this.emit('new-updates', newItems);
            }
        } catch (err) {
            if (this._destroyed || cancellable.is_cancelled() || isCancelledError(err)) {
                if (!this._destroyed && this._checkCancellable === cancellable && this.state === 'checking')
                    this._setState('idle');
                return;
            }
            this.checkErrors = [{source: 'system', message: err?.message ?? String(err)}];
            this._setState('error');
        } finally {
            if (this._checkCancellable === cancellable)
                this._checkCancellable = null;
            if (!this._destroyed)
                this._scheduler.scheduleNext();
        }
    }

    // ── Updating ─────────────────────────────────────────────────────────

    cancelUpdate() {
        this._updater.cancel();
    }

    /**
     * Ask for credentials when needed.
     *
     * @returns {Promise<{password: string|null}|null>} null when the user cancelled
     */
    async _authenticate() {
        if (!hasArchUpdates(this.bySource, this.capabilities))
            return {password: null};

        if (await canSudoWithoutPassword())
            return {password: null};
        if (this._destroyed)
            return null;

        const password = await this._requestPassword(countArchUpdates(this.bySource));
        return password === null ? null : {password};
    }

    async startUpdate() {
        if (this._destroyed || this._authenticating || this._updater.running || this.updates.length === 0)
            return;

        this.cancelCheck();
        this._watcher.suppress(0);
        this._authenticating = true;
        let auth;
        try {
            auth = await this._authenticate();
        } finally {
            this._authenticating = false;
        }
        if (this._destroyed || auth === null || this.updates.length === 0)
            return;

        this.state = 'updating';
        this.emit('update-started');
        this.emit('state-changed');

        const recordLog = Boolean(this._updateLog && this._settings.get_boolean('save-update-log'));
        if (recordLog)
            this._updateLog.begin({bySource: this.bySource});

        const result = await this._updater.run({
            bySource: this.bySource,
            capabilities: this.capabilities,
            password: auth.password,
            debug: this.debug,
            onProgress: event => {
                if (recordLog && event.line)
                    this._updateLog.append(event.line);
                if (!this._destroyed)
                    this.emit('update-progress', event);
            },
        });
        auth.password = null;

        if (recordLog)
            this._updateLog.finish(result);

        if (this._destroyed)
            return;

        const preUpdateKeys = new Set(this.updates.map(itemKey));
        if (this.updates.length > 0) {
            this.updates = [];
            this.bySource = emptyBySource();
            if (result.ok)
                this._cache?.save({lastCheck: this.lastCheck ?? new Date(), updates: []});
            this.emit('updates-changed');
        }

        if (result.stagesRun.includes('arch'))
            this._watcher.suppress(2000);

        this.emit('update-finished', result);
        this._setState('checking');

        if (result.stagesRun.at(-1) === 'gearlever') {
            this._scheduler.schedulePostUpdate(() => this.runCheck({knownKeys: preUpdateKeys}));
        } else {
            this._scheduler.clearPostUpdate();
            this.runCheck({knownKeys: preUpdateKeys});
        }
    }

    destroy() {
        this._destroyed = true;
        this.cancelCheck({resetState: false});
        this._cache?.destroy();
        this._updateLog?.destroy();
        this._updater.destroy();
        this._scheduler.destroy();
        this._watcher.destroy();
        this._settings.disconnectObject(this);
        this.disconnectAll();
    }
}
