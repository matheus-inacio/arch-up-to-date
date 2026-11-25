import {runCommand} from '../common/subprocess.js';
import {nonEmptyLines, parseVersionLines} from './parse.js';

const WARNING_LINE_RE = /^(?:::)?\s*warning:/i;

function hasFatalStderr(stderr) {
    for (const line of nonEmptyLines(stderr)) {
        if (!WARNING_LINE_RE.test(line))
            return true;
    }
    return false;
}

/** List pending AUR updates using the detected helper (`yay` / `paru`). */
export async function checkAur(cap, cancellable, debug) {
    const res = await runCommand([cap.path, '-Qua', '--color', 'never'], cancellable, debug);
    // yay/paru return exit code 1 with empty stdout when no AUR updates exist
    if (!res.ok && res.stdout.trim() === '' && !hasFatalStderr(res.stderr) && res.exitCode === 1)
        return [];
    if (!res.ok)
        throw new Error(res.stderr.trim() || `${cap.name} exited with status ${res.exitCode}`);
    return parseVersionLines(res.stdout, 'aur');
}
