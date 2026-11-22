import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Animation from 'resource:///org/gnome/shell/ui/animation.js';
import * as BarLevel from 'resource:///org/gnome/shell/ui/barLevel.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {SOURCE_META, checkAllUpdates, detectBackends} from './lib/backends.js';
import {DebugLogger, formatMs} from './lib/debug.js';
import {SudoPasswordDialog, canSudoWithoutPassword} from './lib/passwordDialog.js';
import {UpdateRunner} from './lib/updater.js';

const PACMAN_LOCAL_DIR = '/var/lib/pacman/local';
const MAX_LOG_LINES = 200;
const DB_DEBOUNCE_SECONDS = 5;

const ArchUpToDateIndicator = GObject.registerClass(
class ArchUpToDateIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, extension.metadata.name);

        this._extension = extension;
        this._settings = extension.getSettings();
        this._debug = new DebugLogger(this._settings.get_boolean('debug-mode'));
        this._updater = new UpdateRunner();

        this._state = 'idle'; // 'idle' | 'checking' | 'updating' | 'error'
        this._updates = [];
        this._bySource = {pacman: [], aur: [], flatpak: [], gearlever: []};
        const endDetect = this._debug.startTimer('init', 'detectBackends');
        this._capabilities = detectBackends(this._settings);
        endDetect({
            pacman: this._capabilities.pacman.enabled,
            aur: this._capabilities.aur.name,
            flatpak: this._capabilities.flatpak.enabled,
            gearlever: this._capabilities.gearlever.mode,
        });
        this._lastTimings = null;
        this._checkErrors = [];
        this._lastCheck = null;
        this._logLines = [];
        this._logExpanded = false;

        this._checkCancellable = null;
        this._checkTimerId = 0;
        this._bootTimerId = 0;
        this._dbDebounceTimerId = 0;
        this._postUpdateTimerId = 0;
        this._pacmanMonitor = null;
        this._notifSource = null;
        this._activeDialog = null;
        this._destroyed = false;

        this.add_style_class_name('arch-uptodate-indicator');

        this._buildPanelWidget();
        this._buildPopupMenu();

        this._settings.connectObject(
            'changed', (_settings, key) => this._onSettingChanged(key),
            this
        );

        this._applyAppearance();
        this._syncPacmanMonitor();
        this._renderState();

        const bootDelay = this._settings.get_int('boot-delay');
        if (bootDelay <= 0) {
            this._runCheck();
        } else {
            this._bootTimerId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                bootDelay,
                () => {
                    this._bootTimerId = 0;
                    this._runCheck();
                    return GLib.SOURCE_REMOVE;
                }
            );
        }
    }

    _getIcon(state) {
        const useArch = this._settings.get_boolean('use-arch-icons');
        if (useArch) {
            const map = {
                updates: 'arch-updates-symbolic',
                uptodate: 'arch-uptodate-symbolic',
                error: 'arch-error-symbolic',
                unknown: 'arch-unknown-symbolic',
            };
            const name = map[state] || 'arch-unknown-symbolic';
            const path = this._extension.dir.get_child('icons').get_child(`${name}.svg`).get_path();
            if (GLib.file_test(path, GLib.FileTest.EXISTS))
                return Gio.FileIcon.new(Gio.File.new_for_path(path));
        }

        const fallback = {
            updates: 'software-update-available-symbolic',
            uptodate: 'emblem-ok-symbolic',
            error: 'dialog-warning-symbolic',
            unknown: 'content-loading-symbolic',
        };
        return Gio.ThemedIcon.new(fallback[state] || 'software-update-available-symbolic');
    }

    _buildPanelWidget() {
        this._panelBox = new St.BoxLayout({
            style_class: 'panel-status-indicators-box',
        });

        this._panelIcon = new St.Icon({
            gicon: this._getIcon('unknown'),
            style_class: 'system-status-icon',
        });

        this._panelLabel = new St.Label({
            text: '',
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'arch-uptodate-panel-label',
            visible: false,
        });

        this._panelBox.add_child(this._panelIcon);
        this._panelBox.add_child(this._panelLabel);
        this.add_child(this._panelBox);
    }

    _buildPopupMenu() {
        this.menu.box.add_style_class_name('arch-uptodate-menu');

        // ── Header ───────────────────────────────────────────────────────
        const headerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'arch-uptodate-header-item',
        });

        const headerTextBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });

        this._headerTitle = new St.Label({
            text: 'Checking for updates…',
            style_class: 'arch-uptodate-header-title',
        });
        this._headerSubtitle = new St.Label({
            text: '',
            style_class: 'arch-uptodate-header-subtitle',
        });
        headerTextBox.add_child(this._headerTitle);
        headerTextBox.add_child(this._headerSubtitle);

        const headerActions = new St.BoxLayout({
            style_class: 'arch-uptodate-header-actions',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._headerSpinner = new Animation.Spinner(16, {hideOnStop: true});
        this._headerSpinner.add_style_class_name('arch-uptodate-header-spinner');

        this._refreshIcon = new St.Icon({
            icon_name: 'view-refresh-symbolic',
            style_class: 'arch-uptodate-icon-btn-icon',
        });
        this._refreshButton = new St.Button({
            child: this._refreshIcon,
            style_class: 'icon-button arch-uptodate-icon-btn',
            can_focus: true,
            accessible_name: 'Check for updates',
        });
        this._refreshButton.connect('clicked', () => {
            if (this._state === 'checking')
                this._cancelCheck();
            else if (this._state !== 'updating')
                this._runCheck();
        });

        const settingsButton = new St.Button({
            child: new St.Icon({
                icon_name: 'emblem-system-symbolic',
                style_class: 'arch-uptodate-icon-btn-icon',
            }),
            style_class: 'icon-button arch-uptodate-icon-btn',
            can_focus: true,
            accessible_name: 'Settings',
        });
        settingsButton.connect('clicked', () => {
            this.menu.close();
            this._extension.openPreferences();
        });

        headerActions.add_child(this._headerSpinner);
        headerActions.add_child(this._refreshButton);
        headerActions.add_child(settingsButton);

        headerItem.add_child(headerTextBox);
        headerItem.add_child(headerActions);
        this.menu.addMenuItem(headerItem);

        // ── Debug Diagnostics Strip (only visible when debug-mode is ON) ─
        this._debugItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'arch-uptodate-debug-item',
        });
        this._debugItem.visible = false;
        this._debugLabel = new St.Label({
            text: '',
            style_class: 'arch-uptodate-debug-text',
            x_expand: true,
        });
        this._debugLabel.clutter_text.line_wrap = true;
        this._debugLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._debugItem.add_child(this._debugLabel);
        this.menu.addMenuItem(this._debugItem);

        // ── Progress Card (shown during updates or update errors) ────────
        this._progressItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'arch-uptodate-progress-item',
        });
        this._progressItem.visible = false;

        const progressBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'arch-uptodate-progress-box',
        });

        const progressTopRow = new St.BoxLayout({x_expand: true});
        this._progressStageLabel = new St.Label({
            text: '',
            x_expand: true,
            style_class: 'arch-uptodate-progress-stage',
        });
        this._progressPctLabel = new St.Label({
            text: '0%',
            style_class: 'arch-uptodate-progress-pct',
        });
        progressTopRow.add_child(this._progressStageLabel);
        progressTopRow.add_child(this._progressPctLabel);

        this._progressBar = new BarLevel.BarLevel({
            value: 0,
            maximumValue: 1,
            x_expand: true,
            style_class: 'arch-uptodate-bar',
        });

        this._progressDetailLabel = new St.Label({
            text: '',
            style_class: 'arch-uptodate-progress-detail',
        });
        this._progressDetailLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        const progressControls = new St.BoxLayout({
            x_expand: true,
            style_class: 'arch-uptodate-progress-controls',
        });

        this._toggleLogButton = new St.Button({
            label: 'Show log',
            style_class: 'button arch-uptodate-small-btn',
            can_focus: true,
        });
        this._toggleLogButton.connect('clicked', () => {
            this._logExpanded = !this._logExpanded;
            this._logScroll.visible = this._logExpanded;
            this._toggleLogButton.label = this._logExpanded ? 'Hide log' : 'Show log';
        });

        const spacer = new St.Widget({x_expand: true});

        this._cancelUpdateButton = new St.Button({
            label: 'Cancel',
            style_class: 'button arch-uptodate-small-btn arch-uptodate-cancel-btn',
            can_focus: true,
        });
        this._cancelUpdateButton.connect('clicked', () => {
            if (this._updater.running) {
                this._updater.cancel();
            } else {
                this._progressItem.visible = false;
            }
        });

        progressControls.add_child(this._toggleLogButton);
        progressControls.add_child(spacer);
        progressControls.add_child(this._cancelUpdateButton);

        this._logLabel = new St.Label({
            text: '',
            style_class: 'arch-uptodate-log-text',
        });
        this._logLabel.clutter_text.line_wrap = true;
        this._logLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

        const logContainer = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'arch-uptodate-log-container',
        });
        logContainer.add_child(this._logLabel);

        this._logScroll = new St.ScrollView({
            style_class: 'arch-uptodate-log-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            child: logContainer,
            visible: false,
        });

        progressBox.add_child(progressTopRow);
        progressBox.add_child(this._progressBar);
        progressBox.add_child(this._progressDetailLabel);
        progressBox.add_child(progressControls);
        progressBox.add_child(this._logScroll);

        this._progressItem.add_child(progressBox);
        this.menu.addMenuItem(this._progressItem);

        // ── Error Banner (non-fatal backend errors) ──────────────────────
        this._errorItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'arch-uptodate-error-item',
        });
        this._errorItem.visible = false;
        this._errorLabel = new St.Label({
            text: '',
            style_class: 'arch-uptodate-error-text',
            x_expand: true,
        });
        this._errorLabel.clutter_text.line_wrap = true;
        this._errorLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._errorItem.add_child(this._errorLabel);
        this.menu.addMenuItem(this._errorItem);

        // ── Scrollable Grouped Update List ───────────────────────────────
        this._listSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._listSeparator);

        this._listSectionItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'arch-uptodate-list-item',
        });

        this._listBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'arch-uptodate-list-box',
        });

        this._listScroll = new St.ScrollView({
            style_class: 'arch-uptodate-list-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            child: this._listBox,
        });

        this._listSectionItem.add_child(this._listScroll);
        this.menu.addMenuItem(this._listSectionItem);

        // ── Footer Action Bar ────────────────────────────────────────────
        this._footerSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._footerSeparator);

        this._footerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'arch-uptodate-footer-item',
        });

        this._updateAllButton = new St.Button({
            label: 'Update All',
            style_class: 'button arch-uptodate-update-btn',
            x_expand: true,
            can_focus: true,
        });
        this._updateAllButton.connect('clicked', () => this._startUpdate());

        this._footerItem.add_child(this._updateAllButton);
        this.menu.addMenuItem(this._footerItem);
    }

    _onSettingChanged(key) {
        if (key === 'debug-mode') {
            this._debug.enabled = this._settings.get_boolean('debug-mode');
            this._renderState();
            return;
        }
        if (key === 'panel-box' || key === 'panel-index') {
            this._extension.repositionIndicator();
            return;
        }
        if (key === 'watch-pacman-db') {
            this._syncPacmanMonitor();
            return;
        }
        if (key === 'check-interval') {
            this._scheduleNextCheck();
            return;
        }
        if (['enable-pacman', 'aur-helper', 'enable-flatpak', 'enable-gearlever'].includes(key)) {
            this._capabilities = detectBackends(this._settings);
            if (this._state !== 'updating')
                this._runCheck();
            return;
        }
        this._applyAppearance();
        this._renderState();
    }

    _applyAppearance() {
        const compact = this._settings.get_boolean('compact-mode');
        if (compact) {
            this.add_style_class_name('compact');
            this.set_style('-natural-hpadding: 10px');
            this._panelIcon.set_style('padding: 0; margin: 0');
        } else {
            this.remove_style_class_name('compact');
            this.set_style(null);
            this._panelIcon.set_style('padding: 0');
        }
    }

    _syncPacmanMonitor() {
        if (this._pacmanMonitor) {
            this._pacmanMonitor.cancel();
            this._pacmanMonitor = null;
        }
        if (!this._settings.get_boolean('watch-pacman-db'))
            return;
        if (!GLib.file_test(PACMAN_LOCAL_DIR, GLib.FileTest.IS_DIR))
            return;

        try {
            const dir = Gio.File.new_for_path(PACMAN_LOCAL_DIR);
            this._pacmanMonitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._pacmanMonitor.connectObject('changed', () => {
                if (this._updater.running)
                    return;
                this._debug.log('monitor', `${PACMAN_LOCAL_DIR} changed; scheduling debounced re-check (${DB_DEBOUNCE_SECONDS}s)`);
                this._scheduleDbRecheck();
            }, this);
        } catch (err) {
            console.warn(`arch-up-to-date: failed to monitor ${PACMAN_LOCAL_DIR}: ${err.message}`);
        }
    }

    _scheduleDbRecheck() {
        if (this._dbDebounceTimerId) {
            GLib.source_remove(this._dbDebounceTimerId);
            this._dbDebounceTimerId = 0;
        }
        this._dbDebounceTimerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            DB_DEBOUNCE_SECONDS,
            () => {
                this._dbDebounceTimerId = 0;
                if (!this._updater.running)
                    this._runCheck();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _scheduleNextCheck() {
        if (this._checkTimerId) {
            GLib.source_remove(this._checkTimerId);
            this._checkTimerId = 0;
        }
        const intervalSec = Math.max(300, this._settings.get_int('check-interval') * 60);
        this._debug.log('scheduler', `next automatic check in ${intervalSec}s`);
        this._checkTimerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            intervalSec,
            () => {
                this._checkTimerId = 0;
                if (this._state !== 'updating')
                    this._runCheck();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _cancelCheck() {
        if (this._checkCancellable) {
            this._checkCancellable.cancel();
            this._checkCancellable = null;
        }
    }

    async _runCheck() {
        if (this._destroyed || this._state === 'updating')
            return;

        this._cancelCheck();
        this._checkCancellable = new Gio.Cancellable();
        const cancellable = this._checkCancellable;

        this._state = 'checking';
        this._renderState();

        const previousIds = new Set(this._updates.map(u => `${u.source}:${u.id}`));

        try {
            const result = await checkAllUpdates(this._settings, cancellable, this._debug);
            if (this._destroyed || cancellable.is_cancelled())
                return;

            this._updates = result.updates;
            this._bySource = result.bySource;
            this._capabilities = result.capabilities;
            this._lastTimings = result.timings;
            this._checkErrors = result.errors;
            this._lastCheck = new Date();
            this._state = (this._updates.length === 0 && this._checkErrors.length > 0)
                ? 'error'
                : 'idle';

            this._rebuildUpdateList();
            this._renderState();

            if (this._settings.get_boolean('notify-updates') && this._updates.length > 0) {
                const newItems = this._updates.filter(u => !previousIds.has(`${u.source}:${u.id}`));
                if (newItems.length > 0) {
                    const preview = newItems.slice(0, 6).map(u => u.name).join(', ');
                    const suffix = newItems.length > 6 ? ` +${newItems.length - 6} more` : '';
                    this._notify(
                        `${this._updates.length} Update${this._updates.length === 1 ? '' : 's'} Available`,
                        `${preview}${suffix}`,
                        true
                    );
                }
            }
        } catch (err) {
            if (this._destroyed || cancellable.is_cancelled() ||
                err?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                if (!this._destroyed && this._state === 'checking') {
                    this._state = 'idle';
                    this._renderState();
                }
                return;
            }
            this._checkErrors = [{source: 'system', message: err?.message ?? String(err)}];
            this._state = 'error';
            this._renderState();
        } finally {
            if (this._checkCancellable === cancellable)
                this._checkCancellable = null;
            if (!this._destroyed)
                this._scheduleNextCheck();
        }
    }

    async _startUpdate() {
        if (this._destroyed || this._updater.running || this._updates.length === 0)
            return;

        const needsArchAuth =
            (this._bySource.pacman.length > 0 || this._bySource.aur.length > 0) &&
            (this._capabilities.pacman.enabled || this._capabilities.aur.enabled);

        let password = null;
        if (needsArchAuth) {
            const passwordless = await canSudoWithoutPassword();
            if (this._destroyed)
                return;

            if (!passwordless) {
                this.menu.close();
                const count = this._bySource.pacman.length + this._bySource.aur.length;
                const dialog = new SudoPasswordDialog(
                    `Enter your password to upgrade ${count} Arch Linux package${count === 1 ? '' : 's'}.`
                );
                this._activeDialog = dialog;
                password = await dialog.prompt();
                this._activeDialog = null;

                if (this._destroyed || password === null)
                    return;
            }
        }

        this._cancelCheck();
        this._state = 'updating';
        this._logLines = [];
        this._logLabel.text = '';
        this._logExpanded = false;
        this._logScroll.visible = false;
        this._toggleLogButton.label = 'Show log';
        this._cancelUpdateButton.label = 'Cancel';
        this._progressBar.value = 0;
        this._progressPctLabel.text = '0%';
        this._progressStageLabel.text = 'Preparing updates…';
        this._progressDetailLabel.text = '';
        this._progressItem.visible = true;
        this._renderState();
        this.menu.open();

        const result = await this._updater.run({
            bySource: this._bySource,
            capabilities: this._capabilities,
            password,
            debug: this._debug,
            onProgress: ({fraction, stageLabel, detail, line}) => {
                if (this._destroyed)
                    return;
                const pct = Math.round(fraction * 100);
                this._progressBar.value = fraction;
                this._progressPctLabel.text = `${pct}%`;
                this._progressStageLabel.text = stageLabel;
                if (detail)
                    this._progressDetailLabel.text = detail;
                this._panelLabel.text = `${pct}%`;
                this._panelLabel.visible = true;

                if (line) {
                    this._logLines.push(line);
                    if (this._logLines.length > MAX_LOG_LINES)
                        this._logLines.shift();
                    this._logLabel.text = this._logLines.join('\n');
                }
            },
        });

        password = null;
        if (this._destroyed)
            return;

        this._state = 'idle';

        if (result.cancelled) {
            this._progressStageLabel.text = 'Update cancelled';
            this._progressDetailLabel.text = 'Cancelled by user';
            this._cancelUpdateButton.label = 'Dismiss';
        } else if (!result.ok) {
            this._progressStageLabel.text = 'Update finished with errors';
            this._progressDetailLabel.text = result.errors.map(e => `${e.stage}: ${e.message}`).join(' • ');
            this._cancelUpdateButton.label = 'Dismiss';
            this._logExpanded = true;
            this._logScroll.visible = true;
            this._toggleLogButton.label = 'Hide log';
            if (this._settings.get_boolean('notify-updates')) {
                this._notify(
                    'System Update Failed',
                    result.errors.map(e => `${e.stage}: ${e.message}`).join('\n'),
                    false
                );
            }
        } else {
            this._progressItem.visible = false;
            if (this._settings.get_boolean('notify-updates')) {
                this._notify(
                    'System Updated',
                    'All pending updates were installed successfully.',
                    false
                );
            }
        }

        this._renderState();

        // Short settle delay (especially helpful for Gearlever state flush) before re-checking
        if (this._postUpdateTimerId) {
            GLib.source_remove(this._postUpdateTimerId);
            this._postUpdateTimerId = 0;
        }
        this._postUpdateTimerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            2,
            () => {
                this._postUpdateTimerId = 0;
                this._runCheck();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _rebuildUpdateList() {
        const endRebuild = this._debug.startTimer('ui', 'rebuildUpdateList');
        this._listBox.destroy_all_children();

        const order = ['pacman', 'aur', 'flatpak', 'gearlever'];
        for (const sourceKey of order) {
            const items = this._bySource[sourceKey];
            if (!items || items.length === 0)
                continue;

            const meta = SOURCE_META[sourceKey];
            const sectionHeader = new St.BoxLayout({
                style_class: 'arch-uptodate-group-header',
                x_expand: true,
            });
            sectionHeader.add_child(new St.Icon({
                icon_name: meta.icon,
                style_class: 'arch-uptodate-group-icon',
            }));
            sectionHeader.add_child(new St.Label({
                text: `${meta.label} (${items.length})`,
                style_class: 'arch-uptodate-group-title',
                x_expand: true,
            }));
            this._listBox.add_child(sectionHeader);

            for (const item of items) {
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

                const verLabel = new St.Label({
                    text: `${item.currentVersion} → ${item.newVersion}`,
                    style_class: 'arch-uptodate-pkg-ver',
                    y_align: Clutter.ActorAlign.CENTER,
                });

                rowBox.add_child(nameLabel);
                rowBox.add_child(verLabel);
                row.set_child(rowBox);

                row.connect('clicked', () => this._openPackageInfo(item));
                this._listBox.add_child(row);
            }
        }
        endRebuild({items: this._updates.length});
    }

    _openPackageInfo(item) {
        let uri = null;
        const encoded = encodeURIComponent(item.name);
        if (item.source === 'pacman')
            uri = `https://archlinux.org/packages/?q=${encoded}`;
        else if (item.source === 'aur')
            uri = `https://aur.archlinux.org/packages/${encoded}`;
        else if (item.source === 'flatpak')
            uri = `https://flathub.org/apps/${encoded}`;

        if (!uri)
            return;

        this.menu.close();
        try {
            Gio.AppInfo.launch_default_for_uri(uri, null);
        } catch (err) {
            console.warn(`arch-up-to-date: failed to open ${uri}: ${err.message}`);
        }
    }

    _formatActiveBackends() {
        const active = [];
        if (this._capabilities.pacman.enabled)
            active.push('Pacman');
        if (this._capabilities.aur.enabled)
            active.push(this._capabilities.aur.name);
        if (this._capabilities.flatpak.enabled)
            active.push('Flatpak');
        if (this._capabilities.gearlever.enabled)
            active.push('Gearlever');
        return active.length > 0 ? active.join(' · ') : 'No backends detected';
    }

    _renderState() {
        const count = this._updates.length;
        const showCount = this._settings.get_boolean('show-count');
        const hideWhenUpToDate = this._settings.get_boolean('hide-when-uptodate');

        // Top bar icon, label & visibility
        if (this._state === 'updating') {
            this._panelIcon.gicon = this._getIcon('updates');
            this.visible = true;
        } else if (this._state === 'checking') {
            this._panelIcon.gicon = this._getIcon('unknown');
            this._panelLabel.visible = showCount && count > 0;
            if (count > 0)
                this._panelLabel.text = String(count);
            this.visible = !hideWhenUpToDate || count > 0 || this._lastCheck === null;
        } else if (this._state === 'error') {
            this._panelIcon.gicon = this._getIcon('error');
            this._panelLabel.visible = false;
            this.visible = true;
        } else if (count > 0) {
            this._panelIcon.gicon = this._getIcon('updates');
            this._panelLabel.text = String(count);
            this._panelLabel.visible = showCount;
            this.visible = true;
        } else {
            this._panelIcon.gicon = this._getIcon('uptodate');
            this._panelLabel.text = '';
            this._panelLabel.visible = false;
            this.visible = !hideWhenUpToDate;
        }

        // Header text & spinner
        if (this._state === 'updating') {
            this._headerTitle.text = 'Installing updates…';
            this._headerSpinner.play();
            this._refreshButton.reactive = false;
            this._refreshIcon.icon_name = 'view-refresh-symbolic';
        } else if (this._state === 'checking') {
            this._headerTitle.text = 'Checking for updates…';
            this._headerSpinner.play();
            this._refreshButton.reactive = true;
            this._refreshIcon.icon_name = 'process-stop-symbolic';
        } else if (this._state === 'error') {
            this._headerTitle.text = 'Update check failed';
            this._headerSpinner.stop();
            this._refreshButton.reactive = true;
            this._refreshIcon.icon_name = 'view-refresh-symbolic';
        } else if (count > 0) {
            this._headerTitle.text = `${count} update${count === 1 ? '' : 's'} pending`;
            this._headerSpinner.stop();
            this._refreshButton.reactive = true;
            this._refreshIcon.icon_name = 'view-refresh-symbolic';
        } else {
            this._headerTitle.text = 'System is up to date';
            this._headerSpinner.stop();
            this._refreshButton.reactive = true;
            this._refreshIcon.icon_name = 'view-refresh-symbolic';
        }

        const timeText = this._lastCheck
            ? `Checked ${this._lastCheck.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`
            : 'Waiting for first check';
        this._headerSubtitle.text = `${timeText}  •  ${this._formatActiveBackends()}`;

        // Debug diagnostics strip
        if (this._debug.enabled) {
            if (this._lastTimings) {
                const parts = Object.entries(this._lastTimings.bySource)
                    .map(([src, ms]) => `${src} ${formatMs(ms)}`);
                this._debugLabel.text = `DEBUG · ${formatMs(this._lastTimings.totalMs)} total (${parts.join(' · ')})`;
            } else {
                this._debugLabel.text = `DEBUG · state=${this._state} · waiting for check`;
            }
            this._debugItem.visible = true;
        } else {
            this._debugItem.visible = false;
        }

        // Error banner
        const warnings = [...this._checkErrors.map(e => `${e.source}: ${e.message}`)];
        if (this._capabilities.pacman.missingCheckupdates && this._settings.get_boolean('enable-pacman'))
            warnings.push('Install pacman-contrib to enable official repo checks (checkupdates).');

        if (warnings.length > 0) {
            this._errorLabel.text = warnings.join('\n');
            this._errorItem.visible = true;
        } else {
            this._errorItem.visible = false;
        }

        // List & Footer visibility
        const showList = count > 0;
        this._listSeparator.visible = showList;
        this._listSectionItem.visible = showList;
        this._footerSeparator.visible = showList;
        this._footerItem.visible = showList;

        this._updateAllButton.reactive = count > 0 && this._state !== 'updating';
        this._updateAllButton.can_focus = this._updateAllButton.reactive;
        this._updateAllButton.label = this._state === 'updating'
            ? 'Updating…'
            : `Update All (${count})`;
    }

    _notify(title, body, withUpdateAction) {
        if (!this._notifSource) {
            this._notifSource = new MessageTray.Source({
                title: this._extension.metadata.name,
                icon: this._getIcon('updates'),
            });
            this._notifSource.connect('destroy', () => {
                this._notifSource = null;
            });
            Main.messageTray.add(this._notifSource);
        }

        const notification = new MessageTray.Notification({
            source: this._notifSource,
            title,
            body,
            gicon: this._getIcon('updates'),
        });
        if (withUpdateAction)
            notification.addAction('Update Now', () => this._startUpdate());

        this._notifSource.addNotification(notification);
    }

    destroy() {
        this._destroyed = true;

        this._cancelCheck();
        this._updater.cancel();

        if (this._activeDialog) {
            this._activeDialog.close();
            this._activeDialog = null;
        }

        for (const id of [
            this._bootTimerId,
            this._checkTimerId,
            this._dbDebounceTimerId,
            this._postUpdateTimerId,
        ]) {
            if (id)
                GLib.source_remove(id);
        }
        this._bootTimerId = 0;
        this._checkTimerId = 0;
        this._dbDebounceTimerId = 0;
        this._postUpdateTimerId = 0;

        if (this._pacmanMonitor) {
            this._pacmanMonitor.disconnectObject(this);
            this._pacmanMonitor.cancel();
            this._pacmanMonitor = null;
        }

        if (this._notifSource) {
            this._notifSource.destroy();
            this._notifSource = null;
        }

        this._settings?.disconnectObject(this);
        this._settings = null;

        super.destroy();
    }
});

export default class ArchUpToDateExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new ArchUpToDateIndicator(this);
        this._addIndicatorToPanel();
    }

    _addIndicatorToPanel() {
        const box = this._settings.get_string('panel-box');
        const index = this._settings.get_int('panel-index');
        Main.panel.addToStatusArea(this.uuid, this._indicator, index, box);
    }

    repositionIndicator() {
        if (!this._indicator)
            return;
        const parent = this._indicator.container.get_parent();
        if (parent)
            parent.remove_child(this._indicator.container);

        const boxName = this._settings.get_string('panel-box');
        const index = this._settings.get_int('panel-index');
        const boxMap = {
            left: Main.panel._leftBox,
            center: Main.panel._centerBox,
            right: Main.panel._rightBox,
        };
        const target = boxMap[boxName] || Main.panel._rightBox;
        const clampedIndex = Math.min(index, target.get_n_children());
        target.insert_child_at_index(this._indicator.container, clampedIndex);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
