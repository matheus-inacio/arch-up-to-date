import {runCommand} from '../common/subprocess.js';
import {parseVersionLines} from './parse.js';

/** List pending AUR updates using the detected helper (`yay` / `paru`). */
export async function checkAur(cap, cancellable, debug) {
    const res = await runCommand([cap.path, '-Qua', '--color', 'never'], cancellable, debug);
    // yay/paru return exit code 1 with empty stdout/stderr when no AUR updates exist
    if (!res.ok && res.stdout.trim() === '' && res.stderr.trim() === '' && res.exitCode === 1)
        return [];
    if (!res.ok)
        throw new Error(res.stderr.trim() || `${cap.name} exited with status ${res.exitCode}`);
    return parseVersionLines(res.stdout, 'aur');
}
