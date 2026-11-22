/** Text formatting helpers shared by the UI and the updater. */

/** `plural(1, 'update')` -> "1 update", `plural(3, 'update')` -> "3 updates". */
export function plural(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Join updater stage errors as "stage: message" entries. */
export function formatStageErrors(errors, separator) {
    return errors.map(e => `${e.stage}: ${e.message}`).join(separator);
}

/** Local "HH:MM" time. */
export function formatClockTime(date) {
    return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}
