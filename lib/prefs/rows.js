import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

/** Adw.SwitchRow bound to a boolean setting. */
export function createSwitchRow(settings, key, props) {
    const row = new Adw.SwitchRow(props);
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

/**
 * Adw.SpinRow bound to an integer setting.
 *
 * @param {Gio.Settings} settings
 * @param {string} key
 * @param {object} props Row properties
 * @param {{lower: number, upper: number, step: number, page: number}} range
 */
export function createSpinRow(settings, key, props, {lower, upper, step, page}) {
    const row = new Adw.SpinRow({
        ...props,
        adjustment: new Gtk.Adjustment({
            lower,
            upper,
            step_increment: step,
            page_increment: page,
        }),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

/**
 * Adw.ComboRow that stores the selected option's `id` in a string setting.
 *
 * @param {Gio.Settings} settings
 * @param {string} key
 * @param {{id: string, label: string}[]} options
 * @param {object} props Row properties
 */
export function createComboRow(settings, key, options, props) {
    const row = new Adw.ComboRow({
        ...props,
        model: Gtk.StringList.new(options.map(o => o.label)),
    });
    const syncFromSettings = () => {
        const current = settings.get_string(key);
        const idx = Math.max(0, options.findIndex(o => o.id === current));
        if (row.selected !== idx)
            row.selected = idx;
    };
    syncFromSettings();

    row.connect('notify::selected', () => {
        const opt = options[row.selected];
        if (opt && settings.get_string(key) !== opt.id)
            settings.set_string(key, opt.id);
    });
    const changedId = settings.connect(`changed::${key}`, syncFromSettings);
    row.connect('destroy', () => settings.disconnect(changedId));
    return row;
}

/** Adw.PreferencesGroup pre-filled with rows. */
export function createGroup(props, rows) {
    const group = new Adw.PreferencesGroup(props);
    for (const row of rows)
        group.add(row);
    return group;
}
