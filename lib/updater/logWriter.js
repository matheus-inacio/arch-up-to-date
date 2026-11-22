import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {SOURCE_ORDER} from '../common/sources.js';
import {isCancelledError} from '../common/subprocess.js';

Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

const MAX_LOG_BYTES = 2 * 1024 * 1024;
const ENCODER = new TextEncoder();

function pad2(n) {
    return n < 10 ? `0${n}` : `${n}`;
}

/** Fast "HH:MM:SS" local timestamp without locale-formatter overhead per line. */
function shortTimestamp(date = new Date()) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** Path to the latest update audit log under `$XDG_STATE_HOME/<uuid>/last-update.log`. */
export function getUpdateLogPath(uuid, baseDir = GLib.get_user_state_dir()) {
    return GLib.build_filenamev([baseDir, uuid, 'last-update.log']);
}

/**
 * Buffers output lines during an update run and performs a single atomic,
 * non-blocking write to `$XDG_STATE_HOME/<uuid>/last-update.log` on completion.
 */
export class UpdateLogWriter {
    /**
     * @param {object} params
     * @param {string} params.uuid Extension UUID used as state subdirectory name
     * @param {import('../common/debug.js').DebugLogger=} params.debug
     * @param {string=} params.baseDir Override state base dir (for tests)
     */
    constructor({uuid, debug = null, baseDir = GLib.get_user_state_dir()}) {
        this._dirPath = GLib.build_filenamev([baseDir, uuid]);
        this._file = Gio.File.new_for_path(getUpdateLogPath(uuid, baseDir));
        this._debug = debug;
        this._dirReady = false;
        this._lines = null;
        this._bytes = 0;
        this._truncated = false;
        this._startedAt = null;
        this._writeCancellable = null;
    }

    /** Start recording a new update run. */
    begin({bySource}) {
        this._startedAt = new Date();
        this._lines = [];
        this._bytes = 0;
        this._truncated = false;

        const counts = SOURCE_ORDER
            .filter(s => bySource[s]?.length > 0)
            .map(s => `${s}: ${bySource[s].length}`);
        const total = SOURCE_ORDER.reduce((sum, s) => sum + (bySource[s]?.length ?? 0), 0);

        this._pushRaw('=== Arch Up To Date — Update Log ===');
        this._pushRaw(`Started:  ${this._startedAt.toISOString()}`);
        this._pushRaw(`Packages: ${total}${counts.length > 0 ? ` (${counts.join(', ')})` : ''}`);
        this._pushRaw('');

        for (const source of SOURCE_ORDER) {
            for (const item of bySource[source] ?? [])
                this._pushRaw(`  [${source}] ${item.name} ${item.currentVersion} -> ${item.newVersion}`);
        }
        this._pushRaw('');
    }

    /** Append a single output line from an update stage. */
    append(line) {
        if (!this._lines || this._truncated || !line)
            return;
        this._pushRaw(`[${shortTimestamp()}] ${line}`);
    }

    _pushRaw(text) {
        const size = text.length + 1;
        if (this._bytes + size > MAX_LOG_BYTES) {
            this._lines.push('[... log truncated at 2 MiB ...]');
            this._truncated = true;
            return;
        }
        this._lines.push(text);
        this._bytes += size;
    }

    /**
     * Atomically flush the buffered log to disk and release the buffer.
     *
     * @param {{ok: boolean, cancelled: boolean, errors: Array<{stage: string, message: string}>}} result
     */
    async finish(result) {
        const lines = this._lines;
        const startedAt = this._startedAt;
        this._lines = null;
        this._startedAt = null;
        this._bytes = 0;
        this._truncated = false;

        if (!lines)
            return;

        const finishedAt = new Date();
        const durationSec = startedAt
            ? ((finishedAt.getTime() - startedAt.getTime()) / 1000).toFixed(1)
            : '0.0';
        const status = result.cancelled ? 'CANCELLED' : result.ok ? 'OK' : 'FAILED';

        lines.push('');
        lines.push(`=== Finished: ${finishedAt.toISOString()} (${durationSec}s) | Status: ${status} ===`);
        for (const err of result.errors ?? [])
            lines.push(`Error [${err.stage}]: ${err.message}`);

        this._writeCancellable?.cancel();
        const cancellable = new Gio.Cancellable();
        this._writeCancellable = cancellable;

        const endTimer = this._debug?.startTimer('updater', 'writeLog');
        try {
            if (!this._dirReady) {
                GLib.mkdir_with_parents(this._dirPath, 0o700);
                this._dirReady = true;
            }

            const bytes = new GLib.Bytes(ENCODER.encode(`${lines.join('\n')}\n`));
            await this._file.replace_contents_bytes_async(
                bytes,
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                cancellable
            );
            endTimer?.({status: 'ok', lines: lines.length, bytes: bytes.get_size()});
        } catch (err) {
            if (!isCancelledError(err))
                this._debug?.log('updater', `failed to write update log: ${err?.message ?? err}`);
            endTimer?.({status: isCancelledError(err) ? 'cancelled' : 'error'});
        } finally {
            if (this._writeCancellable === cancellable)
                this._writeCancellable = null;
        }
    }

    destroy() {
        this._lines = null;
        this._writeCancellable?.cancel();
        this._writeCancellable = null;
    }
}
