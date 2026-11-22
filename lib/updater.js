import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {nowMs} from './debug.js';

Gio._promisify(
    Gio.Subprocess.prototype,
    'wait_check_async',
    'wait_check_finish'
);
Gio._promisify(
    Gio.DataInputStream.prototype,
    'read_line_async',
    'read_line_finish'
);

const DECODER = new TextDecoder('utf-8');

const STEP_RE = /^\(\s*(\d+)\s*\/\s*(\d+)\s*\)\s+(.+)$/;
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

/**
 * Ephemeral in-memory SUDO_ASKPASS provider backed by a user-only (0700) Unix socket.
 * The password never touches disk, environment variables, or command-line arguments.
 */
class AskpassServer {
    constructor(password, debug = null) {
        this._password = password;
        this._debug = debug;
        this._service = null;
        this._dir = null;
        this._socketPath = null;
        this._scriptPath = null;
    }

    start() {
        const runtimeDir = GLib.get_user_runtime_dir();
        const suffix = GLib.uuid_string_random().slice(0, 12);
        this._dir = GLib.build_filenamev([runtimeDir, `arch-up-to-date-${suffix}`]);
        GLib.mkdir_with_parents(this._dir, 0o700);

        this._socketPath = GLib.build_filenamev([this._dir, 'askpass.sock']);
        this._scriptPath = GLib.build_filenamev([this._dir, 'askpass.js']);

        this._service = new Gio.SocketService();
        const address = Gio.UnixSocketAddress.new(this._socketPath);
        this._service.add_address(
            address,
            Gio.SocketType.STREAM,
            Gio.SocketProtocol.DEFAULT,
            null
        );

        this._service.connect('incoming', (_service, connection) => {
            try {
                if (this._password !== null) {
                    const out = connection.get_output_stream();
                    const bytes = new TextEncoder().encode(`${this._password}\n`);
                    out.write_all(bytes, null);
                    out.flush(null);
                    this._debug?.log('askpass', 'served credential request over Unix socket');
                }
            } catch (err) {
                console.warn(`arch-up-to-date: askpass write failed: ${err.message}`);
            } finally {
                try {
                    connection.close(null);
                } catch {
                    // Ignore close error
                }
            }
            return true;
        });

        const gjsPath = GLib.find_program_in_path('gjs') || '/usr/bin/gjs';
        const script = [
            `#!${gjsPath} -m`,
            `import Gio from 'gi://Gio';`,
            `const client = new Gio.SocketClient();`,
            `const conn = client.connect(Gio.UnixSocketAddress.new(${JSON.stringify(this._socketPath)}), null);`,
            `const stream = new Gio.DataInputStream({base_stream: conn.get_input_stream()});`,
            `const [line] = stream.read_line_utf8(null);`,
            `if (line !== null) print(line);`,
            `conn.close(null);`,
            '',
        ].join('\n');

        const file = Gio.File.new_for_path(this._scriptPath);
        const outStream = file.replace(null, false, Gio.FileCreateFlags.PRIVATE, null);
        outStream.write_all(new TextEncoder().encode(script), null);
        outStream.close(null);
        GLib.chmod(this._scriptPath, 0o700);

        this._service.start();
        this._debug?.log('askpass', 'socket server started', {dir: this._dir});
        return this._scriptPath;
    }

    get scriptPath() {
        return this._scriptPath;
    }

    dispose() {
        this._password = null;
        if (this._dir)
            this._debug?.log('askpass', 'disposing socket server and runtime dir');

        if (this._service) {
            try {
                this._service.stop();
                this._service.close();
            } catch {
                // Ignore cleanup errors
            }
            this._service = null;
        }

        for (const p of [this._socketPath, this._scriptPath]) {
            if (p) {
                try {
                    GLib.unlink(p);
                } catch {
                    // Ignore
                }
            }
        }
        if (this._dir) {
            try {
                GLib.rmdir(this._dir);
            } catch {
                // Ignore
            }
        }
        this._socketPath = null;
        this._scriptPath = null;
        this._dir = null;
    }
}

export class UpdateRunner {
    constructor() {
        this._cancellable = null;
        this._activeProc = null;
        this._askpass = null;
        this._running = false;
    }

    get running() {
        return this._running;
    }

    cancel() {
        this._cancellable?.cancel();
        if (this._activeProc) {
            try {
                this._activeProc.force_exit();
            } catch {
                // Process already exited
            }
            this._activeProc = null;
        }
    }

    /**
     * Execute all pending update stages in order:
     * 1. Flatpak
     * 2. Gearlever (AppImages)
     * 3. Arch / AUR (last, so pacman db monitor sees everything done)
     *
     * @param {object} params
     * @param {object} params.bySource
     * @param {object} params.capabilities
     * @param {string|null} params.password Verified sudo password (or null if passwordless / not needed)
     * @param {(event: object) => void} params.onProgress
     */
    async run({bySource, capabilities, password, onProgress, debug = null}) {
        if (this._running)
            throw new Error('An update is already in progress');

        this._running = true;
        this._cancellable = new Gio.Cancellable();
        this._debug = debug;
        const totalStart = nowMs();

        const stages = [];
        if (bySource.flatpak.length > 0 && capabilities.flatpak.enabled)
            stages.push('flatpak');
        if (bySource.gearlever.length > 0 && capabilities.gearlever.enabled)
            stages.push('gearlever');
        if ((bySource.pacman.length > 0 || bySource.aur.length > 0) &&
            (capabilities.pacman.enabled || capabilities.aur.enabled))
            stages.push('arch');

        if (stages.length === 0) {
            this._running = false;
            return {ok: true, cancelled: false, errors: []};
        }

        const errors = [];
        const stageCount = stages.length;

        try {
            this._debug?.log('updater', 'starting update pipeline', {stages});

            if (stages.includes('arch') && password) {
                this._askpass = new AskpassServer(password, this._debug);
                this._askpass.start();
            }

            for (let idx = 0; idx < stageCount; idx++) {
                if (this._cancellable.is_cancelled())
                    break;

                const stage = stages[idx];
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
                    if (stage === 'flatpak')
                        await this._runFlatpak(capabilities.flatpak, emit);
                    else if (stage === 'gearlever')
                        await this._runGearlever(bySource.gearlever, capabilities.gearlever, emit);
                    else if (stage === 'arch')
                        await this._runArch(capabilities, emit);
                    this._debug?.log('updater', `stage ${stage} finished`, {
                        durationMs: Math.round(nowMs() - stageStart),
                    });
                } catch (err) {
                    if (this._cancellable.is_cancelled() ||
                        err?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        break;
                    errors.push({stage, message: err?.message ?? String(err)});
                    this._debug?.log('updater', `stage ${stage} failed`, {
                        durationMs: Math.round(nowMs() - stageStart),
                        error: err?.message ?? String(err),
                    });
                    emit(1, stage, `Failed: ${err?.message ?? err}`, `[ERROR] ${err?.message ?? err}`);
                }
            }

            const cancelled = this._cancellable.is_cancelled();
            if (!cancelled && errors.length === 0)
                onProgress?.({fraction: 1, stageLabel: 'Complete', detail: 'All updates installed'});

            this._debug?.log('updater', 'pipeline finished', {
                ok: !cancelled && errors.length === 0,
                cancelled,
                errors: errors.length,
                totalMs: Math.round(nowMs() - totalStart),
            });

            return {
                ok: !cancelled && errors.length === 0,
                cancelled,
                errors,
            };
        } finally {
            this._askpass?.dispose();
            this._askpass = null;
            this._activeProc = null;
            this._cancellable = null;
            this._debug = null;
            this._running = false;
        }
    }

    async _spawnAndStream(argv, envExtra, onLine) {
        const t0 = nowMs();
        this._debug?.log('updater:spawn', argv.join(' '));
        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE,
        });
        launcher.setenv('LANG', 'C', true);
        launcher.unsetenv('DESKTOP_STARTUP_ID');

        if (envExtra) {
            for (const [k, v] of Object.entries(envExtra))
                launcher.setenv(k, v, true);
        }

        const proc = launcher.spawnv(argv);
        this._activeProc = proc;

        const stream = new Gio.DataInputStream({
            base_stream: proc.get_stdout_pipe(),
        });

        try {
            while (!this._cancellable.is_cancelled()) {
                const [bytes] = await stream.read_line_async(
                    GLib.PRIORITY_DEFAULT,
                    this._cancellable
                );
                if (bytes === null)
                    break;
                const rawLine = DECODER.decode(bytes);
                const clean = rawLine.replace(ANSI_RE, '').trim();
                if (clean)
                    onLine?.(clean);
            }

            await proc.wait_check_async(this._cancellable);
            this._debug?.log('updater:spawn', 'exited cleanly', {
                cmd: argv[0],
                durationMs: Math.round(nowMs() - t0),
            });
        } catch (err) {
            if (this._cancellable?.is_cancelled()) {
                try {
                    proc.force_exit();
                } catch {
                    // Already exited
                }
            }
            throw err;
        } finally {
            try {
                stream.close(null);
            } catch {
                // Ignore
            }
            if (this._activeProc === proc)
                this._activeProc = null;
        }
    }

    async _runFlatpak(cap, emit) {
        let progress = 0.05;
        emit(progress, 'Flatpak', 'Updating Flatpak apps and runtimes…', '── Flatpak ──');

        await this._spawnAndStream(
            [cap.path, 'update', '-y', '--noninteractive'],
            null,
            line => {
                const pctMatch = line.match(/(\d+)%/);
                if (pctMatch) {
                    progress = Math.max(progress, Math.min(0.95, parseInt(pctMatch[1], 10) / 100));
                } else if (line.startsWith('Updating') || line.startsWith('Installing')) {
                    progress = Math.min(0.9, progress + 0.1);
                }
                emit(progress, 'Flatpak', line, line);
            }
        );
        emit(1, 'Flatpak', 'Flatpak updates finished');
    }

    async _runGearlever(items, cap, emit) {
        const total = items.length;
        emit(0.05, 'Gearlever', `Updating ${total} AppImage${total === 1 ? '' : 's'}…`, '── Gearlever ──');

        for (let i = 0; i < total; i++) {
            const item = items[i];
            const appPath = item.extra?.appPath || item.id;
            const stageLabel = `Gearlever (${i + 1}/${total})`;
            emit(i / total, stageLabel, `Updating ${item.name}…`, `Updating AppImage: ${item.name}`);

            const argv = cap.mode === 'native'
                ? [cap.path, '--update', appPath, '-y']
                : [cap.path, 'run', cap.flatpakId, '--update', appPath, '-y'];

            await this._spawnAndStream(argv, null, line => {
                emit((i + 0.5) / total, stageLabel, line, line);
            });
        }
        emit(1, 'Gearlever', 'AppImage updates finished');
    }

    async _runArch(capabilities, emit) {
        const useAur = capabilities.aur.enabled;
        const label = useAur ? `Arch / AUR (${capabilities.aur.name})` : 'Arch Linux (pacman)';
        const env = this._askpass ? {SUDO_ASKPASS: this._askpass.scriptPath} : null;

        let argv;
        if (useAur) {
            argv = [
                capabilities.aur.path,
                '-Syu',
                '--noconfirm',
                '--color', 'never',
            ];
            if (this._askpass)
                argv.push('--sudoflags', '-A', '--sudoloop');
        } else {
            argv = this._askpass
                ? ['sudo', '-A', capabilities.pacman.pacmanPath, '-Syu', '--noconfirm', '--color', 'never']
                : ['sudo', '-n', capabilities.pacman.pacmanPath, '-Syu', '--noconfirm', '--color', 'never'];
        }

        let progress = 0.05;
        let inHooks = false;
        emit(progress, label, 'Synchronizing package databases…', `── ${label} ──`);

        await this._spawnAndStream(argv, env, line => {
            if (line.includes('Synchronizing package databases')) {
                progress = Math.max(progress, 0.08);
            } else if (line.includes('Starting full system upgrade')) {
                progress = Math.max(progress, 0.14);
            } else if (line.includes('Retrieving packages')) {
                progress = Math.max(progress, 0.20);
            } else if (line.includes('checking keys in keyring') || line.includes('checking package integrity')) {
                progress = Math.max(progress, 0.30);
            } else if (line.includes('loading package files') || line.includes('checking for file conflicts')) {
                progress = Math.max(progress, 0.36);
            } else if (line.includes('Running post-transaction hooks')) {
                inHooks = true;
                progress = Math.max(progress, 0.90);
            } else {
                const step = STEP_RE.exec(line);
                if (step) {
                    const cur = parseInt(step[1], 10);
                    const tot = Math.max(1, parseInt(step[2], 10));
                    if (inHooks)
                        progress = Math.max(progress, 0.90 + (cur / tot) * 0.09);
                    else
                        progress = Math.max(progress, 0.38 + (cur / tot) * 0.50);
                }
            }
            emit(progress, label, line, line);
        });

        emit(1, label, 'System upgrade finished');
    }
}
