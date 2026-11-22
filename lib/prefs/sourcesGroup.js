import {createComboRow, createGroup, createSwitchRow} from './rows.js';

const AUR_OPTIONS = [
    {id: 'auto', label: 'Auto-detect (yay / paru)'},
    {id: 'yay', label: 'yay'},
    {id: 'paru', label: 'paru'},
    {id: 'disabled', label: 'Disabled'},
];

const NOT_DETECTED = 'Not detected on system';

function pacmanSubtitle(cap) {
    if (cap.available)
        return `Detected: ${cap.checkupdatesPath}`;
    if (cap.missingCheckupdates)
        return 'pacman found, but checkupdates (pacman-contrib) is missing';
    return NOT_DETECTED;
}

function aurSubtitle(cap) {
    const found = [];
    if (cap.hasYay)
        found.push('yay');
    if (cap.hasParu)
        found.push('paru');
    return found.length > 0 ? `Detected: ${found.join(', ')}` : 'Neither yay nor paru detected';
}

/**
 * "Update Sources" group: enable/disable each detected backend.
 *
 * @param {Gio.Settings} settings
 * @param {object} caps Result of detectBackends()
 */
export function buildSourcesGroup(settings, caps) {
    return createGroup({
        title: 'Update Sources',
        description: 'Backends are auto-detected directly from your system.',
    }, [
        createSwitchRow(settings, 'enable-pacman', {
            title: 'Arch Repositories (pacman)',
            subtitle: pacmanSubtitle(caps.pacman),
            sensitive: caps.pacman.available,
        }),
        createComboRow(settings, 'aur-helper', AUR_OPTIONS, {
            title: 'AUR Helper',
            subtitle: aurSubtitle(caps.aur),
        }),
        createSwitchRow(settings, 'enable-flatpak', {
            title: 'Flatpak',
            subtitle: caps.flatpak.available ? `Detected: ${caps.flatpak.path}` : NOT_DETECTED,
            sensitive: caps.flatpak.available,
        }),
        createSwitchRow(settings, 'enable-gearlever', {
            title: 'Gearlever (AppImages)',
            subtitle: caps.gearlever.available
                ? `Detected (${caps.gearlever.mode === 'native' ? 'native' : 'Flatpak'})`
                : NOT_DETECTED,
            sensitive: caps.gearlever.available,
        }),
    ]);
}
