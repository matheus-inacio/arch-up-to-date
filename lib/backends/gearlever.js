import {runCommand} from '../common/subprocess.js';
import {gearleverArgv} from './detect.js';
import {nonEmptyLines} from './parse.js';

/** List AppImages managed by Gearlever that have updates available. */
export async function checkGearlever(cap, cancellable, debug) {
    const res = await runCommand(gearleverArgv(cap, ['--list-updates']), cancellable, debug);
    if (!res.ok && res.stdout.trim() === '' && res.stderr.trim() !== '')
        throw new Error(res.stderr.trim());

    const items = [];
    for (const line of nonEmptyLines(res.stdout)) {
        if (line.startsWith('No '))
            continue;
        const parts = line.split(/\s+/);
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
