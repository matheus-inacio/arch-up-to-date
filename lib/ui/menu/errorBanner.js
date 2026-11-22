import {createStaticMenuItem, createWrappingLabel} from './widgets.js';

/**
 * Banner listing non-fatal problems (backend errors, missing tools).
 */
export class ErrorBanner {
    constructor(menu) {
        this._item = createStaticMenuItem('arch-uptodate-error-item', {visible: false});
        this._label = createWrappingLabel({
            text: '',
            style_class: 'arch-uptodate-error-text',
            x_expand: true,
        });
        this._item.add_child(this._label);
        menu.addMenuItem(this._item);
    }

    /** @param {string[]} messages */
    setMessages(messages) {
        if (messages.length > 0) {
            this._label.text = messages.join('\n');
            this._item.visible = true;
        } else {
            this._item.visible = false;
        }
    }
}
