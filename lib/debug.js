import GLib from 'gi://GLib';

const PREFIX = '[arch-up-to-date][DEBUG]';

export function nowMs() {
    return GLib.get_monotonic_time() / 1000;
}

export function formatMs(ms) {
    if (ms >= 1000)
        return `${(ms / 1000).toFixed(2)}s`;
    return `${Math.round(ms)}ms`;
}

export class DebugLogger {
    constructor(enabled = false) {
        this._enabled = Boolean(enabled);
    }

    get enabled() {
        return this._enabled;
    }

    set enabled(val) {
        const next = Boolean(val);
        if (this._enabled === next)
            return;
        this._enabled = next;
        if (next)
            console.log(`${PREFIX} Debug mode enabled`);
    }

    log(area, message, data = null) {
        if (!this._enabled)
            return;
        if (data !== null && data !== undefined)
            console.log(`${PREFIX} [${area}] ${message} ${JSON.stringify(data)}`);
        else
            console.log(`${PREFIX} [${area}] ${message}`);
    }

    startTimer(area, label) {
        const t0 = nowMs();
        return (extra = null) => {
            const elapsed = nowMs() - t0;
            if (this._enabled) {
                const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
                console.log(`${PREFIX} [${area}] ${label} completed in ${formatMs(elapsed)}${suffix}`);
            }
            return elapsed;
        };
    }
}
