import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {getUpdateLogPath} from '../common/paths.js';
import {createGroup, createSpinRow, createSwitchRow} from './rows.js';

function createOpenLogRow(uuid, window) {
    const logPath = getUpdateLogPath(uuid);
    const logFile = Gio.File.new_for_path(logPath);
    const exists = logFile.query_exists(null);

    const row = new Adw.ActionRow({
        title: 'View Latest Update Log',
        subtitle: exists ? logPath : 'No update log saved yet',
        activatable: exists,
        sensitive: exists,
    });
    row.add_suffix(new Gtk.Image({
        icon_name: 'document-open-symbolic',
        valign: Gtk.Align.CENTER,
    }));
    row.connect('activated', () => {
        const launcher = new Gtk.FileLauncher({file: logFile});
        launcher.launch(window, null, (source, res) => {
            try {
                source.launch_finish(res);
            } catch (err) {
                if (!err.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                    console.warn(`arch-up-to-date: failed to open ${logPath}: ${err.message}`);
            }
        });
    });
    return row;
}

/** "Behavior" group: scheduling, database watcher, notifications and update log. */
export function buildBehaviorGroup(settings, uuid, window) {
    return createGroup({title: 'Behavior'}, [
        createSpinRow(settings, 'check-interval', {
            title: 'Check Interval (minutes)',
            subtitle: 'How often to automatically check for updates',
        }, {lower: 5, upper: 1440, step: 5, page: 30}),
        createSpinRow(settings, 'boot-delay', {
            title: 'Startup Delay (seconds)',
            subtitle: 'Wait time before running the initial check',
        }, {lower: 0, upper: 300, step: 5, page: 15}),
        createSwitchRow(settings, 'watch-pacman-db', {
            title: 'Watch Pacman Database',
            subtitle: 'Re-check automatically after external pacman/yay transactions',
        }),
        createSwitchRow(settings, 'notify-updates', {
            title: 'Desktop Notifications',
            subtitle: 'Notify when new updates are found or when an update completes',
        }),
        createSwitchRow(settings, 'save-update-log', {
            title: 'Save Latest Update Log',
            subtitle: 'Keep the full output of the most recent update for auditing',
        }),
        createOpenLogRow(uuid, window),
    ]);
}
