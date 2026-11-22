import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {nowMs} from './debug.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');
Gio._promisify(Gio.Subprocess.prototype, 'wait_async', 'wait_finish');
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

const SIGINT = 2;
const GRACEFUL_EXIT_TIMEOUT_MS = 5000;

function forceExit(proc) {
    try {
        proc.force_exit();
    } catch {
        // Process already exited
    }
}

function interruptProcess(proc) {
    try {
        proc.send_signal(SIGINT);
    } catch {
        // Process already exited or cannot be signalled
    }
}

/**
 * Send SIGINT and wait for the subprocess to exit cleanly, escalating to
 * SIGKILL if it does not terminate within `timeoutMs` or if `forceCancellable`
 * is triggered (e.g. during extension disable).
 */
async function terminateGracefully(proc, timeoutMs = GRACEFUL_EXIT_TIMEOUT_MS, forceCancellable = null) {
    interruptProcess(proc);

    const waitCancellable = new Gio.Cancellable();
    let timeoutId = 0;
    const clearTimer = () => {
        if (timeoutId) {
            GLib.source_remove(timeoutId);
            timeoutId = 0;
        }
    };

    timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
        timeoutId = 0;
        forceExit(proc);
        waitCancellable.cancel();
        return GLib.SOURCE_REMOVE;
    });

    const forceId = forceCancellable?.connect(() => {
        clearTimer();
        forceExit(proc);
        waitCancellable.cancel();
    }) ?? 0;

    try {
        await proc.wait_async(waitCancellable);
    } catch {
        // Process already exited, timed out, or force-cancelled
    } finally {
        clearTimer();
        if (forceId)
            forceCancellable.disconnect(forceId);
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
 * @param {Gio.Cancellable=} options.cancellable
 * @param {(line: string) => void=} options.onLine
 * @param {boolean=} options.gracefulCancel Send SIGINT instead of SIGKILL on cancellation
 * @param {Gio.Cancellable=} options.forceCancellable Immediately escalate to SIGKILL if cancelled
 * @param {import('./debug.js').DebugLogger=} options.debug
 */
export async function spawnStreaming(argv, {
    env = null,
    cancellable = null,
    onLine,
    gracefulCancel = false,
    forceCancellable = null,
    debug = null,
}) {
    const t0 = nowMs();
    debug?.log('updater:spawn', argv.join(' '));
    const launcher = createLauncher(
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE,
        env
    );
    const proc = launcher.spawnv(argv);
    const forceId = forceCancellable?.connect(() => forceExit(proc)) ?? 0;

    const stream = new Gio.DataInputStream({
        base_stream: proc.get_stdout_pipe(),
    });

    try {
        while (!cancellable?.is_cancelled()) {
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
        if (cancellable?.is_cancelled()) {
            if (gracefulCancel && !forceCancellable?.is_cancelled())
                await terminateGracefully(proc, GRACEFUL_EXIT_TIMEOUT_MS, forceCancellable);
            else
                forceExit(proc);
        }
        throw err;
    } finally {
        if (forceId)
            forceCancellable.disconnect(forceId);
        try {
            stream.close(null);
        } catch {
            // Ignore
        }
    }
}
