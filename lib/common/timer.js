import GLib from 'gi://GLib';

/**
 * A single named one-shot GLib timeout that can be (re)armed and cleared.
 */
export class OneShotTimer {
    constructor() {
        this._id = 0;
    }

    start(seconds, callback) {
        this.clear();
        this._id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._id = 0;
            callback();
            return GLib.SOURCE_REMOVE;
        });
    }

    clear() {
        if (this._id) {
            GLib.source_remove(this._id);
            this._id = 0;
        }
    }
}
