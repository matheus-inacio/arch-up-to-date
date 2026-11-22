import Clutter from 'gi://Clutter';
import St from 'gi://St';

/**
 * The top bar part of the indicator: status icon + count/progress label,
 * and the button's own visibility.
 */
export class PanelStatus {
    /**
     * @param {PanelMenu.Button} button
     * @param {import('./icons.js').StatusIcons} icons
     */
    constructor(button, icons) {
        this._button = button;
        this._icons = icons;

        this._icon = new St.Icon({
            gicon: icons.get('unknown'),
            style_class: 'system-status-icon',
        });

        this._label = new St.Label({
            text: '',
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'arch-uptodate-panel-label',
            visible: false,
        });

        const box = new St.BoxLayout({style_class: 'panel-status-indicators-box'});
        box.add_child(this._icon);
        box.add_child(this._label);
        button.add_child(box);
    }

    setCompact(compact) {
        if (compact) {
            this._button.add_style_class_name('compact');
            this._button.set_style('-natural-hpadding: 10px');
            this._icon.set_style('padding: 0; margin: 0');
        } else {
            this._button.remove_style_class_name('compact');
            this._button.set_style(null);
            this._icon.set_style('padding: 0');
        }
    }

    /** Show the overall update progress next to the icon. */
    showProgress(fraction) {
        this._label.text = `${Math.round(fraction * 100)}%`;
        this._label.visible = true;
    }

    /**
     * @param {object} params
     * @param {string} params.state
     * @param {number} params.count
     * @param {boolean} params.showCount
     * @param {boolean} params.hideWhenUpToDate
     * @param {boolean} params.hasChecked
     */
    update({state, count, showCount, hideWhenUpToDate, hasChecked}) {
        if (state === 'updating') {
            this._icon.gicon = this._icons.get('updates');
            this._button.visible = true;
        } else if (state === 'checking') {
            this._icon.gicon = this._icons.get('unknown');
            this._label.visible = showCount && count > 0;
            if (count > 0)
                this._label.text = String(count);
            this._button.visible = !hideWhenUpToDate || count > 0 || !hasChecked;
        } else if (state === 'error') {
            this._icon.gicon = this._icons.get('error');
            this._label.visible = false;
            this._button.visible = true;
        } else if (count > 0) {
            this._icon.gicon = this._icons.get('updates');
            this._label.text = String(count);
            this._label.visible = showCount;
            this._button.visible = true;
        } else {
            this._icon.gicon = this._icons.get('uptodate');
            this._label.text = '';
            this._label.visible = false;
            this._button.visible = !hideWhenUpToDate;
        }
    }
}
