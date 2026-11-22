const UPDATE_LINE_RE = /^(\S+)\s+(\S+)\s+->\s+(\S+)$/;

/** Iterate over trimmed, non-empty lines of a command's output. */
export function* nonEmptyLines(text) {
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (line)
            yield line;
    }
}

/**
 * Parse `name oldver -> newver` lines (checkupdates, yay/paru -Qua).
 *
 * @param {string} stdout
 * @param {string} source
 */
export function parseVersionLines(stdout, source) {
    const items = [];
    for (const line of nonEmptyLines(stdout)) {
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
