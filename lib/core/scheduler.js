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

    _intervalSeconds() {
        return Math.max(MIN_INTERVAL_SECONDS, this._settings.get_int('check-interval') * 60);
    }

    /**
     * Remaining seconds until the next scheduled check based on `lastCheck`,
     * or `null` when no valid recent check timestamp is known.
     *
     * @param {Date|null} lastCheck
     * @returns {number|null}
     */
    _remainingSeconds(lastCheck) {
        if (!(lastCheck instanceof Date) || Number.isNaN(lastCheck.getTime()))
            return null;
        const elapsedSec = Math.floor((Date.now() - lastCheck.getTime()) / 1000);
        if (elapsedSec < 0)
            return null;
        return Math.max(0, this._intervalSeconds() - elapsedSec);
    }

    /**
     * Schedule the first check after startup, respecting both `boot-delay` and
     * any remaining time in `check-interval` since `lastCheck`.
     *
     * @param {Date|null=} lastCheck
     */
    scheduleBoot(lastCheck = null) {
        const bootDelay = this._settings.get_int('boot-delay');
        const remaining = this._remainingSeconds(lastCheck);

        if (remaining !== null && remaining > 0) {
            const delaySec = Math.max(bootDelay, remaining);
            this._debug.log('scheduler', `cache fresh, next check in ${delaySec}s`);
            this._bootTimer.start(delaySec, this._onCheck);
            return;
        }

        if (bootDelay <= 0) {
            this._onCheck();
        } else {
            this._debug.log('scheduler', `boot check in ${bootDelay}s`);
            this._bootTimer.start(bootDelay, this._onCheck);
        }
    }

    /**
     * (Re)arm the periodic check timer from the configured interval.
     * When `lastCheck` is given (e.g. after the user edits `check-interval`),
     * accounts for time already elapsed since that check.
     *
     * @param {Date|null=} lastCheck
     */
    scheduleNext(lastCheck = null) {
        this._bootTimer.clear();
        const remaining = this._remainingSeconds(lastCheck);
        const delaySec = remaining !== null
            ? Math.max(1, remaining)
            : this._intervalSeconds();
        this._debug.log('scheduler', `next automatic check in ${delaySec}s`);
        this._intervalTimer.start(delaySec, this._onCheck);
    }

    /** Short settle delay (especially helpful for Gearlever state flush) before re-checking. */
    schedulePostUpdate() {
        this._bootTimer.clear();
        this._intervalTimer.clear();
        this._postUpdateTimer.start(POST_UPDATE_SETTLE_SECONDS, this._onCheck);
    }

    destroy() {
        this._bootTimer.clear();
        this._intervalTimer.clear();
        this._postUpdateTimer.clear();
    }
}
