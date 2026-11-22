import {runCommand} from '../common/subprocess.js';
import {nonEmptyLines} from './parse.js';

const HEADER_ID = 'Application ID';

/** Parse `application<TAB>version` rows, skipping the header row. */
function* parseColumns(stdout) {
    for (const line of nonEmptyLines(stdout)) {
        const parts = line.split('\t');
        const appId = parts[0]?.trim();
        if (appId && appId !== HEADER_ID)
            yield {appId, version: parts[1]?.trim()};
    }
}

/** List pending Flatpak app & runtime updates. */
export async function checkFlatpak(cap, cancellable, debug) {
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
    for (const {appId, version} of parseColumns(installedRes.stdout))
        installedMap.set(appId, version || 'installed');

    const seen = new Set();
    const items = [];
    for (const {appId, version} of parseColumns(updatesRes.stdout)) {
        if (seen.has(appId))
            continue;
        seen.add(appId);

        items.push({
            id: appId,
            name: appId,
            currentVersion: installedMap.get(appId) || 'current',
            newVersion: version || 'update',
            source: 'flatpak',
        });
    }
    return items;
}
