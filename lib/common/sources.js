/**
 * Static description of every update source and small helpers
 * shared by the checker, the updater and the UI.
 */

/** Display order of sources in the popup list. */
export const SOURCE_ORDER = Object.freeze(['pacman', 'aur', 'flatpak', 'gearlever']);

export const SOURCE_META = Object.freeze({
    pacman: {
        id: 'pacman',
        label: 'Arch Repositories',
        icon: 'system-software-install-symbolic',
    },
    aur: {
        id: 'aur',
        label: 'AUR',
        icon: 'package-x-generic-symbolic',
    },
    flatpak: {
        id: 'flatpak',
        label: 'Flatpak',
        icon: 'application-x-executable-symbolic',
    },
    gearlever: {
        id: 'gearlever',
        label: 'Gearlever (AppImages)',
        icon: 'applications-other-symbolic',
    },
});

/** A fresh `{pacman: [], aur: [], flatpak: [], gearlever: []}` map. */
export function emptyBySource() {
    return Object.fromEntries(SOURCE_ORDER.map(source => [source, []]));
}

/** Number of pending Arch (pacman + AUR) packages. */
export function countArchUpdates(bySource) {
    return bySource.pacman.length + bySource.aur.length;
}

/** Whether there are pending pacman/AUR updates that an enabled backend can install. */
export function hasArchUpdates(bySource, capabilities) {
    return countArchUpdates(bySource) > 0 &&
        (capabilities.pacman.enabled || capabilities.aur.enabled);
}

/** Web page with details about a package, or null if the source has none. */
export function getPackageInfoUrl(item) {
    const encoded = encodeURIComponent(item.extra?.appId ?? item.name);
    switch (item.source) {
    case 'pacman':
        return `https://archlinux.org/packages/?q=${encoded}`;
    case 'aur':
        return `https://aur.archlinux.org/packages/${encoded}`;
    case 'flatpak':
        return `https://flathub.org/apps/${encoded}`;
    default:
        return null;
    }
}

/** Short human-readable list of enabled backends, e.g. "Pacman · yay · Flatpak". */
export function describeActiveBackends(capabilities) {
    const active = [];
    if (capabilities.pacman.enabled)
        active.push('Pacman');
    if (capabilities.aur.enabled)
        active.push(capabilities.aur.name);
    if (capabilities.flatpak.enabled)
        active.push('Flatpak');
    if (capabilities.gearlever.enabled)
        active.push('Gearlever');
    return active.length > 0 ? active.join(' · ') : 'No backends detected';
}
