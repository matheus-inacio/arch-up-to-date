import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {nowMs} from './debug.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');
Gio._promisify(Gio.Subprocess.prototype, 'wait_check_async', 'wait_check_finish');
Gio._promisify(Gio.DataInputStream.prototype, 'read_line_async', 'read_line_finish');

const DECODER = new TextDecoder('utf-8');
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

/**
 * Create a subprocess launcher with a predictable, non-localized environment.
 *
 * @param {Gio.SubprocessFlags} flags
 * @param {Record<string, string>|null} envExtra Extra environment variables
 */
export function createLauncher(flags, envExtra = null) {
    const launcher = new Gio.SubprocessLauncher({flags});
    launcher.setenv('LANG', 'C', true);
    launcher.unsetenv('DESKTOP_STARTUP_ID');
    if (envExtra) {
        for (const [k, v] of Object.entries(envExtra))
            launcher.setenv(k, v, true);
    }
    return launcher;
}

export function isCancelledError(err) {
    return Boolean(err?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED));
}

export function cancelledError() {
    return new Gio.IOErrorEnum({code: Gio.IOErrorEnum.CANCELLED, message: 'Cancelled'});
}

function forceExit(proc) {
    try {
        proc.force_exit();
    } catch {
        // Process already exited
    }
}

/**
 * Run a command to completion, capturing stdout and stderr.
 *
 * @param {string[]} argv
 * @param {Gio.Cancellable=} cancellable
 * @param {import('./debug.js').DebugLogger=} debug
 */
export async function runCommand(argv, cancellable = null, debug = null) {
    const t0 = nowMs();
    debug?.log('spawn', argv.join(' '));
    const launcher = createLauncher(Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    const proc = launcher.spawnv(argv);
    try {
        const [stdout, stderr] = await proc.communicate_utf8_async(null, cancellable);
        const exitCode = proc.get_if_exited() ? proc.get_exit_status() : -1;
        const durationMs = nowMs() - t0;
        debug?.log('spawn', `done (${Math.round(durationMs)}ms)`, {
            cmd: argv[0],
            exitCode,
            stdoutBytes: (stdout ?? '').length,
            stderrBytes: (stderr ?? '').length,
        });
        return {
            ok: proc.get_successful(),
            exitCode,
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            durationMs,
        };
    } catch (err) {
        if (cancellable?.is_cancelled())
            forceExit(proc);
        throw err;
    }
}

/**
 * Spawn a command and stream its merged stdout/stderr line by line
 * (ANSI escape codes stripped, empty lines skipped). Resolves when the
 * process exits successfully, rejects on failure or cancellation.
 *
 * @param {string[]} argv
 * @param {object} options
 * @param {Record<string, string>|null=} options.env Extra environment variables
 * @param {Gio.Cancellable} options.cancellable
 * @param {(line: string) => void=} options.onLine
 * @param {(proc: Gio.Subprocess) => void=} options.onSpawn Called right after the process starts
 * @param {import('./debug.js').DebugLogger=} options.debug
 */
export async function spawnStreaming(argv, {env = null, cancellable, onLine, onSpawn, debug = null}) {
    const t0 = nowMs();
    debug?.log('updater:spawn', argv.join(' '));
    const launcher = createLauncher(
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE,
        env
    );
    const proc = launcher.spawnv(argv);
    onSpawn?.(proc);

    const stream = new Gio.DataInputStream({
        base_stream: proc.get_stdout_pipe(),
    });

    try {
        while (!cancellable.is_cancelled()) {
            const [bytes] = await stream.read_line_async(GLib.PRIORITY_DEFAULT, cancellable);
            if (bytes === null)
                break;
            const clean = DECODER.decode(bytes).replace(ANSI_RE, '').trim();
            if (clean)
                onLine?.(clean);
        }

        await proc.wait_check_async(cancellable);
        debug?.log('updater:spawn', 'exited cleanly', {
            cmd: argv[0],
            durationMs: Math.round(nowMs() - t0),
        });
    } catch (err) {
        if (cancellable?.is_cancelled())
            forceExit(proc);
        throw err;
    } finally {
        try {
            stream.close(null);
        } catch {
            // Ignore
        }
    }
}
