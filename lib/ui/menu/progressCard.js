import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as BarLevel from 'resource:///org/gnome/shell/ui/barLevel.js';

import {formatStageErrors} from '../../common/format.js';
import {createStaticMenuItem, createWrappingLabel} from './widgets.js';

const MAX_LOG_LINES = 200;

/**
 * Progress card shown while updating (and afterwards on failure/cancel):
 * stage label, percentage, progress bar, detail line, cancel/dismiss button
 * and an expandable live log.
 */
export class ProgressCard {
    /**
     * @param {PopupMenu.PopupMenu} menu
     * @param {object} callbacks
     * @param {() => void} callbacks.onCancelClicked Pressed "Cancel" / "Dismiss"
     */
    constructor(menu, {onCancelClicked}) {
        this._logLines = [];
        this._logFlushId = 0;

        this._item = createStaticMenuItem('arch-uptodate-progress-item', {visible: false});

        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'arch-uptodate-progress-box',
        });
        box.add_child(this._buildTopRow());

        this._bar = new BarLevel.BarLevel({
            value: 0,
            maximumValue: 1,
            x_expand: true,
            style_class: 'arch-uptodate-bar',
        });
        box.add_child(this._bar);

        this._detailLabel = new St.Label({
            text: '',
            style_class: 'arch-uptodate-progress-detail',
        });
        this._detailLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(this._detailLabel);

        box.add_child(this._buildControls(onCancelClicked));
        box.add_child(this._buildLogView());

        this._item.add_child(box);
        menu.addMenuItem(this._item);
    }

    _buildTopRow() {
        const row = new St.BoxLayout({x_expand: true});
        this._stageLabel = new St.Label({
            text: '',
            x_expand: true,
            style_class: 'arch-uptodate-progress-stage',
        });
        this._pctLabel = new St.Label({
            text: '0%',
            style_class: 'arch-uptodate-progress-pct',
        });
        row.add_child(this._stageLabel);
        row.add_child(this._pctLabel);
        return row;
    }

    _buildControls(onCancelClicked) {
        const controls = new St.BoxLayout({
            x_expand: true,
            style_class: 'arch-uptodate-progress-controls',
        });

        this._toggleLogButton = new St.Button({
            label: 'Show log',
            style_class: 'button arch-uptodate-small-btn',
            can_focus: true,
        });
        this._toggleLogButton.connect('clicked', () => this._setLogExpanded(!this._logExpanded));

        this._cancelButton = new St.Button({
            label: 'Cancel',
            style_class: 'button arch-uptodate-small-btn arch-uptodate-cancel-btn',
            can_focus: true,
        });
        this._cancelButton.connect('clicked', onCancelClicked);

        controls.add_child(this._toggleLogButton);
        controls.add_child(new St.Widget({x_expand: true}));
        controls.add_child(this._cancelButton);
        return controls;
    }

    _buildLogView() {
        this._logLabel = createWrappingLabel({
            text: '',
            style_class: 'arch-uptodate-log-text',
        });

        const container = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'arch-uptodate-log-container',
        });
        container.add_child(this._logLabel);

        this._logScroll = new St.ScrollView({
            style_class: 'arch-uptodate-log-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            child: container,
            visible: false,
        });
        this._logExpanded = false;
        return this._logScroll;
    }

    _setLogExpanded(expanded) {
        this._logExpanded = expanded;
        this._logScroll.visible = expanded;
        this._toggleLogButton.label = expanded ? 'Hide log' : 'Show log';
        this._clearLogFlush();
        if (expanded)
            this._logLabel.text = this._logLines.join('\n');
    }

    _clearLogFlush() {
        if (this._logFlushId) {
            GLib.source_remove(this._logFlushId);
            this._logFlushId = 0;
        }
    }

    _appendLog(line) {
        this._logLines.push(line);
        if (this._logLines.length > MAX_LOG_LINES)
            this._logLines.shift();
        if (!this._logExpanded || this._logFlushId)
            return;
        this._logFlushId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._logFlushId = 0;
            if (this._logExpanded)
                this._logLabel.text = this._logLines.join('\n');
            return GLib.SOURCE_REMOVE;
        });
    }

    /** Indicate that cancellation is in progress while waiting for the subprocess to exit. */
    setCancelling() {
        this._cancelButton.label = 'Cancelling…';
        this._cancelButton.reactive = false;
        this._cancelButton.can_focus = false;
    }

    /** Reset to a fresh state and show the card. */
    start() {
        this._clearLogFlush();
        this._logLines = [];
        this._logLabel.text = '';
        this._setLogExpanded(false);
        this._cancelButton.label = 'Cancel';
        this._cancelButton.reactive = true;
        this._cancelButton.can_focus = true;
        this._bar.value = 0;
        this._pctLabel.text = '0%';
        this._stageLabel.text = 'Preparing updates…';
        this._detailLabel.text = '';
        this._item.visible = true;
    }

    /** @param {{fraction: number, stageLabel: string, detail?: string, line?: string}} event */
    setProgress({fraction, stageLabel, detail, line}) {
        this._bar.value = fraction;
        this._pctLabel.text = `${Math.round(fraction * 100)}%`;
        this._stageLabel.text = stageLabel;
        if (detail)
            this._detailLabel.text = detail;
        if (line)
            this._appendLog(line);
    }

    /** Show the outcome of an update run; hides the card on success. */
    showResult(result) {
        this._cancelButton.reactive = true;
        this._cancelButton.can_focus = true;
        if (result.cancelled) {
            this._stageLabel.text = 'Update cancelled';
            this._detailLabel.text = 'Cancelled by user';
            this._cancelButton.label = 'Dismiss';
        } else if (!result.ok) {
            this._stageLabel.text = 'Update finished with errors';
            this._detailLabel.text = formatStageErrors(result.errors, ' • ');
            this._cancelButton.label = 'Dismiss';
            this._setLogExpanded(true);
        } else {
            this.hide();
        }
    }

    hide() {
        this._clearLogFlush();
        this._item.visible = false;
    }

    destroy() {
        this._clearLogFlush();
        this._logLines = [];
    }
}
