import {runCommand} from '../common/subprocess.js';
import {parseVersionLines} from './parse.js';

/** List pending official repository updates using `checkupdates` (rootless). */
export async function checkPacman(cap, cancellable, debug) {
    const res = await runCommand([cap.checkupdatesPath], cancellable, debug);
    // checkupdates returns exit code 2 when no updates are available
    if (!res.ok && res.exitCode !== 2) {
        const detail = res.stderr.trim() || `checkupdates exited with status ${res.exitCode}`;
        throw new Error(detail);
    }
    return parseVersionLines(res.stdout, 'pacman');
}
