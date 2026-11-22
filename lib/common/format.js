/** Text formatting helpers shared by the UI and the updater. */

/** `plural(1, 'update')` -> "1 update", `plural(3, 'update')` -> "3 updates". */
export function plural(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Join updater stage errors as "stage: message" entries. */
export function formatStageErrors(errors, separator) {
    return errors.map(e => `${e.stage}: ${e.message}`).join(separator);
}

/** Local "HH:MM" time, prefixed with short date when not from today. */
export function formatClockTime(date) {
    const now = new Date();
    const sameDay = date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();
    if (sameDay)
        return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    return date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}
