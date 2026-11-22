import {OneShotTimer} from '../common/timer.js';

const MIN_INTERVAL_SECONDS = 300;
const POST_UPDATE_SETTLE_SECONDS = 2;

/**
 * Decides *when* update checks run: after boot, periodically, and shortly
 * after an update finished. The actual check is delegated to `onCheck`.
 */
export class CheckScheduler {
    /**
     * @param {object} params
     * @param {Gio.Settings} params.settings
     * @param {import('../common/debug.js').DebugLogger} params.debug
     * @param {() => void} params.onCheck
     */
    constructor({settings, debug, onCheck}) {
        this._settings = settings;
        this._debug = debug;
        this._onCheck = onCheck;

        this._bootTimer = new OneShotTimer();
        this._intervalTimer = new OneShotTimer();
        this._postUpdateTimer = new OneShotTimer();
    }

    /** Run the first check, honoring the configured startup delay. */
    scheduleBoot() {
        const bootDelay = this._settings.get_int('boot-delay');
        if (bootDelay <= 0)
            this._onCheck();
        else
            this._bootTimer.start(bootDelay, this._onCheck);
    }

    /** (Re)arm the periodic check timer from the configured interval. */
    scheduleNext() {
        const intervalSec = Math.max(MIN_INTERVAL_SECONDS, this._settings.get_int('check-interval') * 60);
        this._debug.log('scheduler', `next automatic check in ${intervalSec}s`);
        this._intervalTimer.start(intervalSec, this._onCheck);
    }

    /** Short settle delay (especially helpful for Gearlever state flush) before re-checking. */
    schedulePostUpdate() {
        this._postUpdateTimer.start(POST_UPDATE_SETTLE_SECONDS, this._onCheck);
    }

    destroy() {
        this._bootTimer.clear();
        this._intervalTimer.clear();
        this._postUpdateTimer.clear();
    }
}
