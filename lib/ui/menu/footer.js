import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {createStaticMenuItem} from './widgets.js';

/**
 * Footer action bar with the "Update All" button.
 */
export class MenuFooter {
    /**
     * @param {PopupMenu.PopupMenu} menu
     * @param {object} callbacks
     * @param {() => void} callbacks.onUpdateAllClicked
     */
    constructor(menu, {onUpdateAllClicked}) {
        this._separator = new PopupMenu.PopupSeparatorMenuItem();
        menu.addMenuItem(this._separator);

        this._item = createStaticMenuItem('arch-uptodate-footer-item');
        this._updateAllButton = new St.Button({
            label: 'Update All',
            style_class: 'button arch-uptodate-update-btn',
            x_expand: true,
            can_focus: true,
        });
        this._updateAllButton.connect('clicked', onUpdateAllClicked);
        this._item.add_child(this._updateAllButton);
        menu.addMenuItem(this._item);
    }

    set visible(visible) {
        this._separator.visible = visible;
        this._item.visible = visible;
    }

    /**
     * @param {object} params
     * @param {string} params.state
     * @param {number} params.count
     */
    update({state, count}) {
        const updating = state === 'updating';
        this._updateAllButton.reactive = count > 0 && !updating;
        this._updateAllButton.can_focus = this._updateAllButton.reactive;
        this._updateAllButton.label = updating ? 'Updating…' : `Update All (${count})`;
    }
}
