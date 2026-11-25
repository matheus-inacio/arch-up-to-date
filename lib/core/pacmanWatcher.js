import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {nowMs} from '../common/debug.js';
import {OneShotTimer} from '../common/timer.js';

const PACMAN_LOCAL_DIR = '/var/lib/pacman/local';
const DB_DEBOUNCE_SECONDS = 5;

/**
 * Watches the local pacman database and fires a debounced callback when it
 * changes (e.g. after `pacman`, `yay` or `paru` were run from a terminal).
 */
export class PacmanDbWatcher {
    /**
     * @param {object} params
     * @param {import('../common/debug.js').DebugLogger} params.debug
     * @param {() => boolean} params.isBusy Changes are ignored while this returns true
     * @param {() => void} params.onChanged
     */
    constructor({debug, isBusy, onChanged}) {
        this._debug = debug;
        this._isBusy = isBusy;
        this._onChanged = onChanged;
        this._monitor = null;
        this._debounce = new OneShotTimer();
        this._suppressedUntil = 0;
    }

    /** Ignore monitor events (and cancel any pending debounce) for `durationMs`. */
    suppress(durationMs) {
        this._suppressedUntil = nowMs() + durationMs;
        this._debounce.clear();
    }

    /** Start or stop watching. */
    setEnabled(enabled) {
        this._stopMonitor();
        if (!enabled)
            return;
        if (!GLib.file_test(PACMAN_LOCAL_DIR, GLib.FileTest.IS_DIR))
            return;

        try {
            const dir = Gio.File.new_for_path(PACMAN_LOCAL_DIR);
            this._monitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._monitor.connectObject('changed', () => this._onMonitorChanged(), this);
        } catch (err) {
            console.warn(`arch-up-to-date: failed to monitor ${PACMAN_LOCAL_DIR}: ${err.message}`);
        }
    }

    _onMonitorChanged() {
        if (this._isBusy() || nowMs() < this._suppressedUntil)
            return;
        this._debug.log('monitor', `${PACMAN_LOCAL_DIR} changed; scheduling debounced re-check (${DB_DEBOUNCE_SECONDS}s)`);
        this._debounce.start(DB_DEBOUNCE_SECONDS, () => {
            if (!this._isBusy() && nowMs() >= this._suppressedUntil)
                this._onChanged();
        });
    }

    _stopMonitor() {
        if (this._monitor) {
            this._monitor.disconnectObject(this);
            this._monitor.cancel();
            this._monitor = null;
        }
    }

    destroy() {
        this._debounce.clear();
        this._stopMonitor();
    }
}
