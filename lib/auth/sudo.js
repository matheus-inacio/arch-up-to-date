import Gio from 'gi://Gio';

import {createLauncher} from '../common/subprocess.js';

/**
 * Check whether passwordless sudo works in a non-interactive subprocess
 * (e.g., NOPASSWD rule or global timestamp).
 */
export async function canSudoWithoutPassword(cancellable = null) {
    try {
        const launcher = createLauncher(
            Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE
        );
        const proc = launcher.spawnv(['sudo', '-n', 'true']);
        await proc.communicate_utf8_async(null, cancellable);
        return proc.get_successful();
    } catch {
        return false;
    }
}

/**
 * Validate a sudo password via stdin pipe without caching it on disk.
 */
export async function validateSudoPassword(password, cancellable = null) {
    const launcher = createLauncher(
        Gio.SubprocessFlags.STDIN_PIPE |
        Gio.SubprocessFlags.STDOUT_SILENCE |
        Gio.SubprocessFlags.STDERR_PIPE
    );
    const proc = launcher.spawnv(['sudo', '-S', '-k', '-p', '', '-v']);
    try {
        await proc.communicate_utf8_async(`${password}\n`, cancellable);
        return proc.get_successful();
    } catch {
        return false;
    }
}
