import {formatMs} from '../../common/debug.js';
import {createStaticMenuItem, createWrappingLabel} from './widgets.js';

/**
 * Diagnostics strip with the last check timings (only visible in debug mode).
 */
export class DebugStrip {
    constructor(menu) {
        this._item = createStaticMenuItem('arch-uptodate-debug-item', {visible: false});
        this._label = createWrappingLabel({
            text: '',
            style_class: 'arch-uptodate-debug-text',
            x_expand: true,
        });
        this._item.add_child(this._label);
        menu.addMenuItem(this._item);
    }

    /**
     * @param {object} params
     * @param {boolean} params.enabled
     * @param {object|null} params.timings `{totalMs, bySource}` from the last check
     * @param {string} params.state
     */
    update({enabled, timings, state}) {
        this._item.visible = enabled;
        if (!enabled)
            return;

        if (timings) {
            const parts = Object.entries(timings.bySource)
                .map(([src, ms]) => `${src} ${formatMs(ms)}`);
            this._label.text = `DEBUG · ${formatMs(timings.totalMs)} total (${parts.join(' · ')})`;
        } else {
            this._label.text = `DEBUG · state=${state} · waiting for check`;
        }
    }
}
