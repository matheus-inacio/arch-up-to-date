const UPDATE_LINE_RE = /^(\S+)\s+(\S+)\s+->\s+(\S+)(?:\s+(.*))?$/;
const IGNORED_RE = /\[ignored\]/i;

/** Iterate over trimmed, non-empty lines of a command's output. */
export function* nonEmptyLines(text) {
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (line)
            yield line;
    }
}

/**
 * Parse `name oldver -> newver [...]` lines (checkupdates, yay/paru -Qua),
 * tolerating trailing annotations such as yay's `[1h16m]` age tag while
 * skipping `[ignored]` packages.
 *
 * @param {string} stdout
 * @param {string} source
 */
export function parseVersionLines(stdout, source) {
    const items = [];
    for (const line of nonEmptyLines(stdout)) {
        const m = UPDATE_LINE_RE.exec(line);
        if (!m || (m[4] && IGNORED_RE.test(m[4])))
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
