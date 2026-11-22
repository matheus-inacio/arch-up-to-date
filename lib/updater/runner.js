import Gio from 'gi://Gio';

import {nowMs} from '../common/debug.js';
import {hasArchUpdates} from '../common/sources.js';
import {isCancelledError, spawnStreaming} from '../common/subprocess.js';
import {AskpassServer} from './askpass.js';
import {runArchStage} from './stages/arch.js';
import {runFlatpakStage} from './stages/flatpak.js';
import {runGearleverStage} from './stages/gearlever.js';

/**
 * Runs the update pipeline (one stage per backend) with cancellation support
 * and aggregated progress reporting.
 */
export class UpdateRunner {
    constructor() {
        this._cancellable = null;
        this._forceCancellable = null;
        this._askpass = null;
        this._running = false;
        this._debug = null;
    }

    get running() {
        return this._running;
    }

    cancel({force = false} = {}) {
        if (force)
            this._forceCancellable?.cancel();
        this._cancellable?.cancel();
    }

    destroy() {
        this.cancel({force: true});
    }

    /**
     * Build the ordered list of stages to run:
     * 1. Flatpak
     * 2. Gearlever (AppImages)
     * 3. Arch / AUR (last, so pacman db monitor sees everything done)
     */
    _planStages(bySource, capabilities) {
        const stages = [];
        if (bySource.flatpak.length > 0 && capabilities.flatpak.enabled) {
            stages.push({
                id: 'flatpak',
                run: ctx => runFlatpakStage({...ctx, cap: capabilities.flatpak}),
            });
        }
        if (bySource.gearlever.length > 0 && capabilities.gearlever.enabled) {
            stages.push({
                id: 'gearlever',
                run: ctx => runGearleverStage({...ctx, items: bySource.gearlever, cap: capabilities.gearlever}),
            });
        }
        if (hasArchUpdates(bySource, capabilities)) {
            stages.push({
                id: 'arch',
                run: ctx => runArchStage({
                    ...ctx,
                    capabilities,
                    askpassPath: this._askpass?.scriptPath ?? null,
                }),
            });
        }
        return stages;
    }

    /**
     * Execute all pending update stages in order.
     *
     * @param {object} params
     * @param {object} params.bySource
     * @param {object} params.capabilities
     * @param {string|null} params.password Verified sudo password (or null if passwordless / not needed)
     * @param {(event: object) => void} params.onProgress
     * @param {import('../common/debug.js').DebugLogger=} params.debug
     */
    async run({bySource, capabilities, password, onProgress, debug = null}) {
        if (this._running)
            throw new Error('An update is already in progress');

        const stages = this._planStages(bySource, capabilities);
        if (stages.length === 0)
            return {ok: true, cancelled: false, errors: []};

        this._running = true;
        this._cancellable = new Gio.Cancellable();
        this._forceCancellable = new Gio.Cancellable();
        this._debug = debug;
        const totalStart = nowMs();
        const errors = [];

        try {
            this._debug?.log('updater', 'starting update pipeline', {stages: stages.map(s => s.id)});

            if (password && stages.some(s => s.id === 'arch')) {
                this._askpass = new AskpassServer(password, this._debug);
                this._askpass.start();
            }

            for (let idx = 0; idx < stages.length; idx++) {
                if (this._cancellable.is_cancelled())
                    break;

                const error = await this._runStage(stages[idx], idx, stages.length, onProgress);
                if (error === 'cancelled')
                    break;
                if (error)
                    errors.push(error);
            }

            const cancelled = this._cancellable.is_cancelled();
            const ok = !cancelled && errors.length === 0;
            if (ok)
                onProgress?.({fraction: 1, stageLabel: 'Complete', detail: 'All updates installed'});

            this._debug?.log('updater', 'pipeline finished', {
                ok,
                cancelled,
                errors: errors.length,
                totalMs: Math.round(nowMs() - totalStart),
            });

            return {ok, cancelled, errors};
        } finally {
            this._askpass?.dispose();
            this._askpass = null;
            this._cancellable = null;
            this._forceCancellable = null;
            this._debug = null;
            this._running = false;
        }
    }

    /**
     * Run a single stage, mapping its local 0..1 progress into the overall range.
     *
     * @returns {Promise<null|'cancelled'|{stage: string, message: string}>}
     */
    async _runStage(stage, idx, stageCount, onProgress) {
        const stageStart = nowMs();
        const base = idx / stageCount;
        const weight = 1 / stageCount;
        const emit = (subFraction, stageLabel, detail, line = null) => {
            const clamped = Math.max(0, Math.min(1, subFraction));
            onProgress?.({
                fraction: base + clamped * weight,
                stageLabel,
                detail,
                line,
            });
        };

        try {
            await stage.run({emit, spawn: (argv, env, onLine) => this._spawn(argv, env, onLine)});
            this._debug?.log('updater', `stage ${stage.id} finished`, {
                durationMs: Math.round(nowMs() - stageStart),
            });
            return null;
        } catch (err) {
            if (this._cancellable.is_cancelled() || isCancelledError(err))
                return 'cancelled';

            const message = err?.message ?? String(err);
            this._debug?.log('updater', `stage ${stage.id} failed`, {
                durationMs: Math.round(nowMs() - stageStart),
                error: message,
            });
            emit(1, stage.id, `Failed: ${message}`, `[ERROR] ${message}`);
            return {stage: stage.id, message};
        }
    }

    _spawn(argv, env, onLine) {
        return spawnStreaming(argv, {
            env,
            cancellable: this._cancellable,
            onLine,
            gracefulCancel: true,
            forceCancellable: this._forceCancellable,
            debug: this._debug,
        });
    }
}
