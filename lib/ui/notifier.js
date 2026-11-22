import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {formatStageErrors, plural} from '../common/format.js';

const PREVIEW_COUNT = 6;

/**
 * Desktop notifications, gated by the `notify-updates` preference.
 */
export class Notifier {
    /**
     * @param {object} params
     * @param {string} params.title Notification source title
     * @param {Gio.Settings} params.settings
     * @param {import('./icons.js').StatusIcons} params.icons
     * @param {() => void} params.onUpdateNow Handler for the "Update Now" action
     */
    constructor({title, settings, icons, onUpdateNow}) {
        this._title = title;
        this._settings = settings;
        this._icons = icons;
        this._onUpdateNow = onUpdateNow;
        this._source = null;
    }

    get _enabled() {
        return this._settings.get_boolean('notify-updates');
    }

    /**
     * @param {object[]} newItems Updates that were not pending before
     * @param {number} total Total pending updates
     */
    newUpdates(newItems, total) {
        if (!this._enabled || newItems.length === 0)
            return;
        const preview = newItems.slice(0, PREVIEW_COUNT).map(u => u.name).join(', ');
        const suffix = newItems.length > PREVIEW_COUNT ? ` +${newItems.length - PREVIEW_COUNT} more` : '';
        this._show(`${plural(total, 'Update')} Available`, `${preview}${suffix}`, {
            iconStatus: 'updates',
            withUpdateAction: true,
        });
    }

    updateFailed(errors) {
        if (this._enabled) {
            this._show('System Update Failed', formatStageErrors(errors, '\n'), {
                iconStatus: 'error',
            });
        }
    }

    updateSucceeded() {
        if (this._enabled) {
            this._show('System Updated', 'All pending updates were installed successfully.', {
                iconStatus: 'uptodate',
            });
        }
    }

    _ensureSource() {
        if (!this._source) {
            this._source = new MessageTray.Source({
                title: this._title,
                icon: this._icons.get('updates'),
            });
            this._source.connect('destroy', () => {
                this._source = null;
            });
            Main.messageTray.add(this._source);
        }
        return this._source;
    }

    _show(title, body, {iconStatus = 'updates', withUpdateAction = false} = {}) {
        const source = this._ensureSource();
        const notification = new MessageTray.Notification({
            source,
            title,
            body,
            gicon: this._icons.get(iconStatus),
        });
        if (withUpdateAction)
            notification.addAction('Update Now', () => this._onUpdateNow());

        source.addNotification(notification);
    }

    destroy() {
        this._source?.destroy();
        this._source = null;
    }
}
