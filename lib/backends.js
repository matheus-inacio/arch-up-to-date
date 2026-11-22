import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {nowMs} from './debug.js';

Gio._promisify(
    Gio.Subprocess.prototype,
    'communicate_utf8_async',
    'communicate_utf8_finish'
);

const UPDATE_LINE_RE = /^(\S+)\s+(\S+)\s+->\s+(\S+)$/;
const GEARLEVER_FLATPAK_ID = 'it.mijorus.gearlever';

export const SOURCE_META = Object.freeze({
    pacman: {
        id: 'pacman',
        label: 'Arch Repositories',
        icon: 'system-software-install-symbolic',
    },
    aur: {
        id: 'aur',
        label: 'AUR',
        icon: 'package-x-generic-symbolic',
    },
    flatpak: {
        id: 'flatpak',
        label: 'Flatpak',
        icon: 'application-x-executable-symbolic',
    },
    gearlever: {
        id: 'gearlever',
        label: 'Gearlever (AppImages)',
        icon: 'applications-other-symbolic',
    },
});

function createLauncher() {
    const launcher = new Gio.SubprocessLauncher({
        flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    });
    launcher.setenv('LANG', 'C', true);
    launcher.unsetenv('DESKTOP_STARTUP_ID');
    return launcher;
}

async function runCommand(argv, cancellable = null, debug = null) {
    const t0 = nowMs();
    debug?.log('spawn', argv.join(' '));
    const launcher = createLauncher();
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
        if (cancellable?.is_cancelled()) {
            try {
                proc.force_exit();
            } catch {
                // Process already exited
            }
        }
        throw err;
    }
}

function hasFlatpakApp(appId) {
    const paths = [
        GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share', 'flatpak', 'app', appId]),
        `/var/lib/flatpak/app/${appId}`,
    ];
    return paths.some(p => GLib.file_test(p, GLib.FileTest.IS_DIR));
}

/**
 * Synchronously (via fast PATH & stat checks, zero subprocesses) detect installed
 * package management backends on the system.
 *
 * @param {Gio.Settings=} settings Optional GSettings to apply user enable/disable prefs
 */
export function detectBackends(settings = null) {
    const pacmanPath = GLib.find_program_in_path('pacman');
    const checkupdatesPath = GLib.find_program_in_path('checkupdates');
    const yayPath = GLib.find_program_in_path('yay');
    const paruPath = GLib.find_program_in_path('paru');
    const flatpakPath = GLib.find_program_in_path('flatpak');
    const nativeGearleverPath = GLib.find_program_in_path('gearlever');
    const flatpakGearlever = Boolean(flatpakPath && hasFlatpakApp(GEARLEVER_FLATPAK_ID));

    const aurPref = settings ? settings.get_string('aur-helper') : 'auto';
    let aurPath = null;
    let aurName = null;
    if (aurPref === 'yay' && yayPath) {
        aurPath = yayPath;
        aurName = 'yay';
    } else if (aurPref === 'paru' && paruPath) {
        aurPath = paruPath;
        aurName = 'paru';
    } else if (aurPref === 'auto') {
        if (yayPath) {
            aurPath = yayPath;
            aurName = 'yay';
        } else if (paruPath) {
            aurPath = paruPath;
            aurName = 'paru';
        }
    }

    const enablePacman = settings ? settings.get_boolean('enable-pacman') : true;
    const enableFlatpak = settings ? settings.get_boolean('enable-flatpak') : true;
    const enableGearlever = settings ? settings.get_boolean('enable-gearlever') : true;

    return {
        pacman: {
            available: Boolean(pacmanPath && checkupdatesPath),
            enabled: Boolean(enablePacman && pacmanPath && checkupdatesPath),
            pacmanPath,
            checkupdatesPath,
            missingCheckupdates: Boolean(pacmanPath && !checkupdatesPath),
        },
        aur: {
            available: Boolean(yayPath || paruPath),
            enabled: Boolean(aurPath && aurPref !== 'disabled'),
            path: aurPath,
            name: aurName,
            hasYay: Boolean(yayPath),
            hasParu: Boolean(paruPath),
        },
        flatpak: {
            available: Boolean(flatpakPath),
            enabled: Boolean(enableFlatpak && flatpakPath),
            path: flatpakPath,
        },
        gearlever: {
            available: Boolean(nativeGearleverPath || flatpakGearlever),
            enabled: Boolean(enableGearlever && (nativeGearleverPath || flatpakGearlever)),
            mode: nativeGearleverPath ? 'native' : (flatpakGearlever ? 'flatpak' : null),
            path: nativeGearleverPath || flatpakPath,
            flatpakId: GEARLEVER_FLATPAK_ID,
        },
    };
}

function parseVersionLines(stdout, source) {
    const items = [];
    for (const rawLine of stdout.split('\n')) {
        const line = rawLine.trim();
        if (!line)
            continue;
        const m = UPDATE_LINE_RE.exec(line);
        if (!m)
            continue;
        items.push({
            id: m[1],
            name: m[1],
            currentVersion: m[2],
            newVersion: m[3],
            source,
        });
    }
    return items;
}

async function checkPacman(cap, cancellable, debug) {
    const res = await runCommand([cap.checkupdatesPath], cancellable, debug);
    // checkupdates returns exit code 2 when no updates are available
    if (!res.ok && res.exitCode !== 2) {
        const detail = res.stderr.trim() || `checkupdates exited with status ${res.exitCode}`;
        throw new Error(detail);
    }
    return parseVersionLines(res.stdout, 'pacman');
}

async function checkAur(cap, cancellable, debug) {
    const res = await runCommand([cap.path, '-Qua', '--color', 'never'], cancellable, debug);
    // yay/paru return exit code 1 with empty stdout when no AUR updates exist
    if (!res.ok && res.stdout.trim() === '' && res.exitCode === 1)
        return [];
    if (!res.ok && res.stderr.trim() !== '')
        throw new Error(res.stderr.trim());
    return parseVersionLines(res.stdout, 'aur');
}

async function checkFlatpak(cap, cancellable, debug) {
    // Run remote-ls and installed list in parallel (2 processes total instead of N+1)
    const [updatesRes, installedRes] = await Promise.all([
        runCommand(
            [cap.path, 'remote-ls', '--updates', '--columns=application,version'],
            cancellable,
            debug
        ),
        runCommand(
            [cap.path, 'list', '--columns=application,version'],
            cancellable,
            debug
        ),
    ]);

    if (!updatesRes.ok && updatesRes.stderr.trim() !== '')
        throw new Error(updatesRes.stderr.trim());

    const installedMap = new Map();
    for (const rawLine of installedRes.stdout.split('\n')) {
        const line = rawLine.trim();
        if (!line)
            continue;
        const parts = line.split('\t');
        const appId = parts[0]?.trim();
        const ver = parts[1]?.trim();
        if (appId && appId !== 'Application ID')
            installedMap.set(appId, ver || 'installed');
    }

    const seen = new Set();
    const items = [];
    for (const rawLine of updatesRes.stdout.split('\n')) {
        const line = rawLine.trim();
        if (!line)
            continue;
        const parts = line.split('\t');
        const appId = parts[0]?.trim();
        if (!appId || appId === 'Application ID' || seen.has(appId))
            continue;
        seen.add(appId);

        const newVer = parts[1]?.trim() || 'update';
        const curVer = installedMap.get(appId) || 'current';
        items.push({
            id: appId,
            name: appId,
            currentVersion: curVer,
            newVersion: newVer,
            source: 'flatpak',
        });
    }
    return items;
}

async function checkGearlever(cap, cancellable, debug) {
    const argv = cap.mode === 'native'
        ? [cap.path, '--list-updates']
        : [cap.path, 'run', cap.flatpakId, '--list-updates'];

    const res = await runCommand(argv, cancellable, debug);
    if (!res.ok && res.stdout.trim() === '' && res.stderr.trim() !== '')
        throw new Error(res.stderr.trim());

    const items = [];
    for (const rawLine of res.stdout.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('No '))
            continue;
        const parts = line.split(/\s+/);
        if (parts.length === 0)
            continue;
        const name = parts[0];
        const appPath = parts.length >= 2 ? parts[parts.length - 1] : name;
        items.push({
            id: appPath,
            name,
            currentVersion: 'current',
            newVersion: 'update',
            source: 'gearlever',
            extra: {appPath},
        });
    }
    return items;
}

/**
 * Run all enabled & available update checks in parallel.
 *
 * @param {Gio.Settings} settings
 * @param {Gio.Cancellable=} cancellable
 * @param {import('./debug.js').DebugLogger=} debug
 */
export async function checkAllUpdates(settings, cancellable = null, debug = null) {
    const totalStart = nowMs();
    const capabilities = detectBackends(settings);
    const jobs = [];
    const timingsBySource = {};

    const track = (source, fn) => {
        const t0 = nowMs();
        return fn().then(
            items => {
                timingsBySource[source] = Math.round(nowMs() - t0);
                return items;
            },
            err => {
                timingsBySource[source] = Math.round(nowMs() - t0);
                throw err;
            }
        );
    };

    if (capabilities.pacman.enabled)
        jobs.push({source: 'pacman', promise: track('pacman', () => checkPacman(capabilities.pacman, cancellable, debug))});
    if (capabilities.aur.enabled)
        jobs.push({source: 'aur', promise: track('aur', () => checkAur(capabilities.aur, cancellable, debug))});
    if (capabilities.flatpak.enabled)
        jobs.push({source: 'flatpak', promise: track('flatpak', () => checkFlatpak(capabilities.flatpak, cancellable, debug))});
    if (capabilities.gearlever.enabled)
        jobs.push({source: 'gearlever', promise: track('gearlever', () => checkGearlever(capabilities.gearlever, cancellable, debug))});

    const settled = await Promise.allSettled(jobs.map(j => j.promise));

    const bySource = {
        pacman: [],
        aur: [],
        flatpak: [],
        gearlever: [],
    };
    const errors = [];

    settled.forEach((result, idx) => {
        const {source} = jobs[idx];
        if (result.status === 'fulfilled') {
            bySource[source] = result.value;
        } else {
            const err = result.reason;
            if (err?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            errors.push({
                source,
                message: err?.message ?? String(err),
            });
        }
    });

    if (cancellable?.is_cancelled())
        throw new Gio.IOErrorEnum({code: Gio.IOErrorEnum.CANCELLED, message: 'Cancelled'});

    const updates = [
        ...bySource.pacman,
        ...bySource.aur,
        ...bySource.flatpak,
        ...bySource.gearlever,
    ];

    const totalMs = Math.round(nowMs() - totalStart);
    const timings = {totalMs, bySource: timingsBySource};

    debug?.log('check', `finished in ${totalMs}ms`, {
        counts: {
            pacman: bySource.pacman.length,
            aur: bySource.aur.length,
            flatpak: bySource.flatpak.length,
            gearlever: bySource.gearlever.length,
        },
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
