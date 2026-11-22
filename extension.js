import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {ArchUpToDateIndicator} from './lib/ui/indicator.js';

export default class ArchUpToDateExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new ArchUpToDateIndicator(this, this._settings);

        const box = this._settings.get_string('panel-box');
        const index = this._settings.get_int('panel-index');
        Main.panel.addToStatusArea(this.uuid, this._indicator, index, box);
    }

    /** Move the indicator after the panel position preferences changed. */
    repositionIndicator() {
        if (!this._indicator)
            return;
        const container = this._indicator.container;
        container.get_parent()?.remove_child(container);

        const boxMap = {
            left: Main.panel._leftBox,
            center: Main.panel._centerBox,
            right: Main.panel._rightBox,
        };
        const target = boxMap[this._settings.get_string('panel-box')] || Main.panel._rightBox;
        const index = Math.min(this._settings.get_int('panel-index'), target.get_n_children());
        target.insert_child_at_index(container, index);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
