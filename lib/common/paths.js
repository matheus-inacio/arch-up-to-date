import GLib from 'gi://GLib';

/** Path to the latest update audit log under `$XDG_STATE_HOME/<uuid>/last-update.log`. */
export function getUpdateLogPath(uuid, baseDir = GLib.get_user_state_dir()) {
    return GLib.build_filenamev([baseDir, uuid, 'last-update.log']);
}
