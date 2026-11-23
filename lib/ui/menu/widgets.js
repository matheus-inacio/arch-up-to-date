import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

/** A non-interactive popup menu row used as a container for custom content. */
export function createStaticMenuItem(styleClass, {visible = true} = {}) {
    const item = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
        style_class: styleClass,
    });
    item.visible = visible;
    return item;
}

/** A label that wraps onto multiple lines instead of ellipsizing. */
export function createWrappingLabel(params) {
    const label = new St.Label(params);
    label.clutter_text.line_wrap = true;
    label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    return label;
}

/** A small round icon button as used in the menu header. */
export function createIconButton(iconName, accessibleName) {
    const icon = new St.Icon({
        icon_name: iconName,
        style_class: 'arch-uptodate-icon-btn-icon',
    });
    const button = new St.Button({
        child: icon,
        style_class: 'icon-button arch-uptodate-icon-btn',
        can_focus: true,
        accessible_name: accessibleName,
    });
    return {button, icon};
}
