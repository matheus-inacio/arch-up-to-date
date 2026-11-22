import {createGroup, createSwitchRow} from './rows.js';

/** "Developer" group: debug & performance diagnostics. */
export function buildDeveloperGroup(settings) {
    return createGroup({
        title: 'Developer',
        description: 'Inspect backend timings and subprocess logs with: journalctl -f /usr/bin/gnome-shell | grep arch-up-to-date',
    }, [
        createSwitchRow(settings, 'debug-mode', {
            title: 'Debug &amp; Performance Diagnostics',
            subtitle: 'Log timings to journalctl and display a timing summary inside the popup menu',
        }),
    ]);
}
