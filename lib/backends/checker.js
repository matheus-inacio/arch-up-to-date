import {nowMs} from '../common/debug.js';
import {SOURCE_ORDER, emptyBySource} from '../common/sources.js';
import {cancelledError, isCancelledError} from '../common/subprocess.js';
import {checkAur} from './aur.js';
import {detectBackends} from './detect.js';
import {checkFlatpak} from './flatpak.js';
import {checkGearlever} from './gearlever.js';
import {checkPacman} from './pacman.js';

/** Check function for each source: `(capability, cancellable, debug) => Promise<item[]>`. */
const CHECKERS = Object.freeze({
    pacman: checkPacman,
    aur: checkAur,
    flatpak: checkFlatpak,
    gearlever: checkGearlever,
});

/** Wrap a promise so its duration (success or failure) is recorded in `timings[source]`. */
async function timed(source, timings, fn) {
    const t0 = nowMs();
    try {
        return await fn();
    } finally {
        timings[source] = Math.round(nowMs() - t0);
    }
}

/**
 * Run all enabled & available update checks in parallel.
 *
 * @param {Gio.Settings} settings
 * @param {Gio.Cancellable=} cancellable
 * @param {import('../common/debug.js').DebugLogger=} debug
 */
export async function checkAllUpdates(settings, cancellable = null, debug = null) {
    const totalStart = nowMs();
    const capabilities = detectBackends(settings);
    const timingsBySource = {};

    const jobs = SOURCE_ORDER
        .filter(source => capabilities[source].enabled)
        .map(source => ({
            source,
            promise: timed(source, timingsBySource,
                () => CHECKERS[source](capabilities[source], cancellable, debug)),
        }));

    const settled = await Promise.allSettled(jobs.map(j => j.promise));

    const bySource = emptyBySource();
    const errors = [];

    settled.forEach((result, idx) => {
        const {source} = jobs[idx];
        if (result.status === 'fulfilled') {
            bySource[source] = result.value;
        } else if (!isCancelledError(result.reason)) {
            errors.push({
                source,
                message: result.reason?.message ?? String(result.reason),
            });
        }
    });

    if (cancellable?.is_cancelled())
        throw cancelledError();

    const updates = SOURCE_ORDER.flatMap(source => bySource[source]);

    const totalMs = Math.round(nowMs() - totalStart);
    const timings = {totalMs, bySource: timingsBySource};

    debug?.log('check', `finished in ${totalMs}ms`, {
        counts: Object.fromEntries(SOURCE_ORDER.map(s => [s, bySource[s].length])),
        timingsMs: timingsBySource,
        errors: errors.length,
    });

    return {
        updates,
        bySource,
        errors,
        capabilities,
        timings,
    };
}
