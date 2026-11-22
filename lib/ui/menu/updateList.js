import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {SOURCE_META, SOURCE_ORDER} from '../../common/sources.js';
import {createStaticMenuItem} from './widgets.js';

function createGroupHeader(sourceKey, count) {
    const meta = SOURCE_META[sourceKey];
    const header = new St.BoxLayout({
        style_class: 'arch-uptodate-group-header',
        x_expand: true,
    });
    header.add_child(new St.Icon({
        icon_name: meta.icon,
        style_class: 'arch-uptodate-group-icon',
    }));
    header.add_child(new St.Label({
        text: `${meta.label} (${count})`,
        style_class: 'arch-uptodate-group-title',
        x_expand: true,
    }));
    return header;
}

function createPackageRow(item, onActivate) {
    const row = new St.Button({
        style_class: 'arch-uptodate-pkg-row',
        x_expand: true,
        can_focus: true,
    });
    const rowBox = new St.BoxLayout({x_expand: true});

    const nameLabel = new St.Label({
        text: item.name,
        x_expand: true,
        style_class: 'arch-uptodate-pkg-name',
    });
    nameLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

    const versionLabel = new St.Label({
        text: `${item.currentVersion} → ${item.newVersion}`,
        style_class: 'arch-uptodate-pkg-ver',
        y_align: Clutter.ActorAlign.CENTER,
    });

    rowBox.add_child(nameLabel);
    rowBox.add_child(versionLabel);
    row.set_child(rowBox);
    row.connect('clicked', () => onActivate(item));
    return row;
}

/**
 * Scrollable list of pending updates, grouped by source.
 */
export class UpdateList {
    /**
     * @param {PopupMenu.PopupMenu} menu
     * @param {object} callbacks
     * @param {(item: object) => void} callbacks.onItemActivated
     */
    constructor(menu, {onItemActivated}) {
        this._onItemActivated = onItemActivated;

        this._separator = new PopupMenu.PopupSeparatorMenuItem();
        menu.addMenuItem(this._separator);

        this._item = createStaticMenuItem('arch-uptodate-list-item');
        this._box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'arch-uptodate-list-box',
        });
        this._item.add_child(new St.ScrollView({
            style_class: 'arch-uptodate-list-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            child: this._box,
        }));
        menu.addMenuItem(this._item);
    }

    set visible(visible) {
        this._separator.visible = visible;
        this._item.visible = visible;
    }

    /** Rebuild the list from `{pacman: [...], aur: [...], ...}`. */
    setUpdates(bySource) {
        this._box.destroy_all_children();

        for (const sourceKey of SOURCE_ORDER) {
            const items = bySource[sourceKey];
            if (!items || items.length === 0)
                continue;

            this._box.add_child(createGroupHeader(sourceKey, items.length));
            for (const item of items)
                this._box.add_child(createPackageRow(item, this._onItemActivated));
        }
    }
}
