import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/** Bundled Arch symbolic icons (in `icons/`), keyed by status. */
const ARCH_ICONS = {
    updates: 'arch-updates-symbolic',
    uptodate: 'arch-uptodate-symbolic',
    error: 'arch-error-symbolic',
    unknown: 'arch-unknown-symbolic',
};

/** Generic theme icons used when Arch icons are disabled or missing. */
const THEME_ICONS = {
    updates: 'software-update-available-symbolic',
    uptodate: 'emblem-ok-symbolic',
    error: 'dialog-warning-symbolic',
    unknown: 'content-loading-symbolic',
};

/**
 * Resolves status icons, honoring the `use-arch-icons` preference.
 */
export class StatusIcons {
    /**
     * @param {Gio.File} extensionDir
     * @param {Gio.Settings} settings
     */
    constructor(extensionDir, settings) {
        this._iconsDir = extensionDir.get_child('icons');
        this._settings = settings;
        this._cache = new Map();
    }

    /**
     * @param {'updates'|'uptodate'|'error'|'unknown'} status
     * @returns {Gio.Icon}
     */
    get(status) {
        const useArch = this._settings.get_boolean('use-arch-icons');
        const cacheKey = `${useArch ? 'arch' : 'theme'}:${status}`;
        let icon = this._cache.get(cacheKey);
        if (icon)
            return icon;

        if (useArch) {
            const name = ARCH_ICONS[status] || ARCH_ICONS.unknown;
            const file = this._iconsDir.get_child(`${name}.svg`);
            if (GLib.file_test(file.get_path(), GLib.FileTest.EXISTS))
                icon = Gio.FileIcon.new(file);
        }
        if (!icon)
            icon = Gio.ThemedIcon.new(THEME_ICONS[status] || THEME_ICONS.updates);

        this._cache.set(cacheKey, icon);
        return icon;
    }
}
