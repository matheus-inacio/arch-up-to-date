import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {detectBackends} from './lib/backends.js';

const AUR_OPTIONS = [
    {id: 'auto', label: 'Auto-detect (yay / paru)'},
    {id: 'yay', label: 'yay'},
    {id: 'paru', label: 'paru'},
    {id: 'disabled', label: 'Disabled'},
];

const PANEL_BOX_OPTIONS = [
    {id: 'left', label: 'Left'},
    {id: 'center', label: 'Center'},
    {id: 'right', label: 'Right'},
];

export default class ArchUpToDatePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const caps = detectBackends(settings);

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'software-update-available-symbolic',
        });
        window.add(page);

        // ── Update Sources ───────────────────────────────────────────────
        const sourcesGroup = new Adw.PreferencesGroup({
            title: 'Update Sources',
            description: 'Backends are auto-detected directly from your system.',
        });
        page.add(sourcesGroup);

        const pacmanRow = new Adw.SwitchRow({
            title: 'Arch Repositories (pacman)',
            subtitle: caps.pacman.available
                ? `Detected: ${caps.pacman.checkupdatesPath}`
                : (caps.pacman.missingCheckupdates
                    ? 'pacman found, but checkupdates (pacman-contrib) is missing'
                    : 'Not detected on system'),
            sensitive: caps.pacman.available,
        });
        settings.bind('enable-pacman', pacmanRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        sourcesGroup.add(pacmanRow);

        const aurStatusParts = [];
        if (caps.aur.hasYay)
            aurStatusParts.push('yay');
        if (caps.aur.hasParu)
            aurStatusParts.push('paru');
        const aurRow = new Adw.ComboRow({
            title: 'AUR Helper',
            subtitle: aurStatusParts.length > 0
                ? `Detected: ${aurStatusParts.join(', ')}`
                : 'Neither yay nor paru detected',
            model: Gtk.StringList.new(AUR_OPTIONS.map(o => o.label)),
        });
        const currentAur = settings.get_string('aur-helper');
        const aurIdx = Math.max(0, AUR_OPTIONS.findIndex(o => o.id === currentAur));
        aurRow.selected = aurIdx;
        aurRow.connect('notify::selected', row => {
            const opt = AUR_OPTIONS[row.selected];
            if (opt)
                settings.set_string('aur-helper', opt.id);
        });
        sourcesGroup.add(aurRow);

        const flatpakRow = new Adw.SwitchRow({
            title: 'Flatpak',
            subtitle: caps.flatpak.available
                ? `Detected: ${caps.flatpak.path}`
                : 'Not detected on system',
            sensitive: caps.flatpak.available,
        });
        settings.bind('enable-flatpak', flatpakRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        sourcesGroup.add(flatpakRow);

        const gearleverRow = new Adw.SwitchRow({
            title: 'Gearlever (AppImages)',
            subtitle: caps.gearlever.available
                ? `Detected (${caps.gearlever.mode === 'native' ? 'native' : 'Flatpak'})`
                : 'Not detected on system',
            sensitive: caps.gearlever.available,
        });
        settings.bind('enable-gearlever', gearleverRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        sourcesGroup.add(gearleverRow);

        // ── Behavior ─────────────────────────────────────────────────────
        const behaviorGroup = new Adw.PreferencesGroup({
            title: 'Behavior',
        });
        page.add(behaviorGroup);

        const intervalRow = new Adw.SpinRow({
            title: 'Check Interval (minutes)',
            subtitle: 'How often to automatically check for updates',
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 1440,
                step_increment: 5,
                page_increment: 30,
            }),
        });
        settings.bind('check-interval', intervalRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        behaviorGroup.add(intervalRow);

        const bootDelayRow = new Adw.SpinRow({
            title: 'Startup Delay (seconds)',
            subtitle: 'Wait time before running the initial check',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 300,
                step_increment: 5,
                page_increment: 15,
            }),
        });
        settings.bind('boot-delay', bootDelayRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        behaviorGroup.add(bootDelayRow);

        const watchDbRow = new Adw.SwitchRow({
            title: 'Watch Pacman Database',
            subtitle: 'Re-check automatically after external pacman/yay transactions',
        });
        settings.bind('watch-pacman-db', watchDbRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        behaviorGroup.add(watchDbRow);

        const notifyRow = new Adw.SwitchRow({
            title: 'Desktop Notifications',
            subtitle: 'Notify when new updates are found or when an update completes',
        });
        settings.bind('notify-updates', notifyRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        behaviorGroup.add(notifyRow);

        // ── Appearance ───────────────────────────────────────────────────
        const appearanceGroup = new Adw.PreferencesGroup({
            title: 'Top Bar & Appearance',
        });
        page.add(appearanceGroup);

        const compactRow = new Adw.SwitchRow({
            title: 'Compact Mode',
            subtitle: 'Minimal padding and smaller count badge on the top bar',
        });
        settings.bind('compact-mode', compactRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        appearanceGroup.add(compactRow);

        const showCountRow = new Adw.SwitchRow({
            title: 'Show Update Count',
            subtitle: 'Display pending update count next to the icon',
        });
        settings.bind('show-count', showCountRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        appearanceGroup.add(showCountRow);

        const hideRow = new Adw.SwitchRow({
            title: 'Hide When Up to Date',
            subtitle: 'Only show the top bar icon when updates are pending or active',
        });
        settings.bind('hide-when-uptodate', hideRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        appearanceGroup.add(hideRow);

        const archIconsRow = new Adw.SwitchRow({
            title: 'Use Arch Linux Icons',
            subtitle: 'Use bundled Arch symbolic icons instead of generic system icons',
        });
        settings.bind('use-arch-icons', archIconsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        appearanceGroup.add(archIconsRow);

        const panelBoxRow = new Adw.ComboRow({
            title: 'Panel Position',
            model: Gtk.StringList.new(PANEL_BOX_OPTIONS.map(o => o.label)),
        });
        const currentBox = settings.get_string('panel-box');
        panelBoxRow.selected = Math.max(0, PANEL_BOX_OPTIONS.findIndex(o => o.id === currentBox));
        panelBoxRow.connect('notify::selected', row => {
            const opt = PANEL_BOX_OPTIONS[row.selected];
            if (opt)
                settings.set_string('panel-box', opt.id);
        });
        appearanceGroup.add(panelBoxRow);

        const panelIndexRow = new Adw.SpinRow({
            title: 'Panel Index',
            subtitle: 'Order within the selected panel box',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 20,
                step_increment: 1,
                page_increment: 1,
            }),
        });
        settings.bind('panel-index', panelIndexRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        appearanceGroup.add(panelIndexRow);

        // ── Developer ────────────────────────────────────────────────────
        const devGroup = new Adw.PreferencesGroup({
            title: 'Developer',
            description: 'Inspect backend timings and subprocess logs with: journalctl -f /usr/bin/gnome-shell | grep arch-up-to-date',
        });
        page.add(devGroup);

        const debugRow = new Adw.SwitchRow({
            title: 'Debug & Performance Diagnostics',
            subtitle: 'Log timings to journalctl and display a timing summary inside the popup menu',
        });
        settings.bind('debug-mode', debugRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        devGroup.add(debugRow);
    }
}
