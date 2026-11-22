import {createGroup, createSpinRow, createSwitchRow} from './rows.js';

/** "Behavior" group: scheduling, database watcher and notifications. */
export function buildBehaviorGroup(settings) {
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
    ]);
}
