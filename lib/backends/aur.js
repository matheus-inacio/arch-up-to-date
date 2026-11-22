import {runCommand} from '../common/subprocess.js';
import {parseVersionLines} from './parse.js';

/** List pending AUR updates using the detected helper (`yay` / `paru`). */
export async function checkAur(cap, cancellable, debug) {
    const res = await runCommand([cap.path, '-Qua', '--color', 'never'], cancellable, debug);
    // yay/paru return exit code 1 with empty stdout when no AUR updates exist
    if (!res.ok && res.stdout.trim() === '' && res.exitCode === 1)
        return [];
    if (!res.ok && res.stderr.trim() !== '')
        throw new Error(res.stderr.trim());
    return parseVersionLines(res.stdout, 'aur');
}
