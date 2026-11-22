import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Animation from 'resource:///org/gnome/shell/ui/animation.js';

import {formatClockTime, plural} from '../../common/format.js';
import {createIconButton, createStaticMenuItem} from './widgets.js';

/**
 * Menu header: status title, last-check subtitle, spinner, refresh/stop and
 * settings buttons.
 */
export class MenuHeader {
    /**
     * @param {PopupMenu.PopupMenu} menu
     * @param {object} callbacks
     * @param {() => void} callbacks.onRefreshClicked
     * @param {() => void} callbacks.onSettingsClicked
     */
    constructor(menu, {onRefreshClicked, onSettingsClicked}) {
        const item = createStaticMenuItem('arch-uptodate-header-item');

        const textBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this._title = new St.Label({
            text: 'Checking for updates…',
            style_class: 'arch-uptodate-header-title',
        });
        this._subtitle = new St.Label({
            text: '',
            style_class: 'arch-uptodate-header-subtitle',
        });
        textBox.add_child(this._title);
        textBox.add_child(this._subtitle);

        const actions = new St.BoxLayout({
            style_class: 'arch-uptodate-header-actions',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._spinner = new Animation.Spinner(16, {hideOnStop: true});
        this._spinner.add_style_class_name('arch-uptodate-header-spinner');

        const refresh = createIconButton('view-refresh-symbolic', 'Check for updates');
        this._refreshButton = refresh.button;
        this._refreshIcon = refresh.icon;
        this._refreshButton.connect('clicked', onRefreshClicked);

        const settings = createIconButton('emblem-system-symbolic', 'Settings');
        settings.button.connect('clicked', onSettingsClicked);

        actions.add_child(this._spinner);
        actions.add_child(this._refreshButton);
        actions.add_child(settings.button);

        item.add_child(textBox);
        item.add_child(actions);
        menu.addMenuItem(item);
    }

    /**
     * @param {object} params
     * @param {string} params.state
     * @param {number} params.count
     * @param {Date|null} params.lastCheck
     * @param {string} params.backendsText
     */
    update({state, count, lastCheck, backendsText}) {
        const busy = state === 'updating' || state === 'checking';
        if (busy)
            this._spinner.play();
        else
            this._spinner.stop();

        // While checking, the refresh button turns into a "stop" button
        const canClick = state !== 'updating';
        this._refreshButton.reactive = canClick;
        this._refreshButton.can_focus = canClick;
        this._refreshButton.accessible_name = state === 'checking'
            ? 'Cancel update check'
            : 'Check for updates';
        this._refreshIcon.icon_name = state === 'checking'
            ? 'process-stop-symbolic'
            : 'view-refresh-symbolic';

        this._title.text = this._titleFor(state, count);

        const timeText = lastCheck
            ? `Checked ${formatClockTime(lastCheck)}`
            : 'Waiting for first check';
        this._subtitle.text = `${timeText}  •  ${backendsText}`;
    }

    _titleFor(state, count) {
        if (state === 'updating')
            return 'Installing updates…';
        if (state === 'checking')
            return 'Checking for updates…';
        if (state === 'error')
            return 'Update check failed';
        if (count > 0)
            return `${plural(count, 'update')} pending`;
        return 'System is up to date';
    }
}
