import {runCommand} from '../common/subprocess.js';
import {nonEmptyLines} from './parse.js';

const HEADER_ID = 'Application ID';

/** Parse `application<TAB>version<TAB>branch` rows, skipping the header row. */
function* parseColumns(stdout) {
    for (const line of nonEmptyLines(stdout)) {
        const parts = line.split('\t');
        const appId = parts[0]?.trim();
        if (appId && appId !== HEADER_ID)
            yield {appId, version: parts[1]?.trim() || '', branch: parts[2]?.trim() || ''};
    }
}

/** List pending Flatpak app & runtime updates. */
export async function checkFlatpak(cap, cancellable, debug) {
    // Run remote-ls and installed list in parallel (2 processes total instead of N+1)
    const [updatesRes, installedRes] = await Promise.all([
        runCommand(
            [cap.path, 'remote-ls', '--updates', '--columns=application,version,branch'],
            cancellable,
            debug
        ),
        runCommand(
            [cap.path, 'list', '--columns=application,version,branch'],
            cancellable,
            debug
        ),
    ]);

    if (!updatesRes.ok)
        throw new Error(updatesRes.stderr.trim() || `flatpak exited with status ${updatesRes.exitCode}`);

    const installedMap = new Map();
    for (const {appId, version, branch} of parseColumns(installedRes.stdout)) {
        const key = branch ? `${appId}/${branch}` : appId;
        installedMap.set(key, version || branch || 'installed');
    }

    const seen = new Set();
    const raw = [];
    const appIdCounts = new Map();
    for (const entry of parseColumns(updatesRes.stdout)) {
        const key = entry.branch ? `${entry.appId}/${entry.branch}` : entry.appId;
        if (seen.has(key))
            continue;
        seen.add(key);
        appIdCounts.set(entry.appId, (appIdCounts.get(entry.appId) ?? 0) + 1);
        raw.push({...entry, key});
    }

    return raw.map(({appId, version, branch, key}) => ({
        id: key,
        name: branch && appIdCounts.get(appId) > 1 ? `${appId} (${branch})` : appId,
        currentVersion: installedMap.get(key) || branch || 'current',
        newVersion: version || 'update',
        source: 'flatpak',
        extra: {appId},
    }));
}
