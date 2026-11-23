import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {SudoPasswordDialog} from '../auth/passwordDialog.js';
import {plural} from '../common/format.js';
import {getPackageInfoUrl} from '../common/sources.js';
import {UpdateManager} from '../core/updateManager.js';
import {StatusIcons} from './icons.js';
import {DebugStrip} from './menu/debugStrip.js';
import {ErrorBanner} from './menu/errorBanner.js';
import {MenuFooter} from './menu/footer.js';
import {MenuHeader} from './menu/header.js';
import {ProgressCard} from './menu/progressCard.js';
import {UpdateList} from './menu/updateList.js';
import {Notifier} from './notifier.js';
import {PanelStatus} from './panelStatus.js';

const APPEARANCE_KEYS = ['compact-mode', 'show-count', 'hide-when-uptodate', 'use-arch-icons'];
const POSITION_KEYS = ['panel-box', 'panel-index'];

/**
 * Top bar button + popup menu. Pure view/glue: it renders the state of an
 * {@link UpdateManager} and forwards user actions to it.
 */
export const ArchUpToDateIndicator = GObject.registerClass(
class ArchUpToDateIndicator extends PanelMenu.Button {
    _init(extension, settings) {
        super._init(0.5, extension.metadata.name);

        this._extension = extension;
        this._settings = settings;
        this._activeDialog = null;

        this.add_style_class_name('arch-uptodate-indicator');

        this._manager = new UpdateManager({
            settings: this._settings,
            uuid: extension.uuid,
            requestPassword: count => this._requestPassword(count),
        });

        this._icons = new StatusIcons(extension.dir, this._settings);
        this._panelStatus = new PanelStatus(this, this._icons);
        this._notifier = new Notifier({
            title: extension.metadata.name,
            settings: this._settings,
            icons: this._icons,
            onUpdateNow: () => this._manager.startUpdate(),
        });

        this._buildMenu();
        this._connectManager();

        this._settings.connectObject(
            'changed', (_settings, key) => this._onSettingChanged(key),
            this
        );

        this._panelStatus.setCompact(this._settings.get_boolean('compact-mode'));
        this._render();
        this._manager.start();
    }

    _buildMenu() {
        this.menu.box.add_style_class_name('arch-uptodate-menu');

        this._header = new MenuHeader(this.menu, {
            onRefreshClicked: () => this._onRefreshClicked(),
            onSettingsClicked: () => {
                this.menu.close();
                this._extension.openPreferences();
            },
        });
        this._debugStrip = new DebugStrip(this.menu);
        this._progressCard = new ProgressCard(this.menu, {
            onCancelClicked: () => {
                if (this._manager.isUpdating) {
                    this._progressCard.setCancelling();
                    this._manager.cancelUpdate();
                } else {
                    this._progressCard.hide();
                }
            },
        });
        this._errorBanner = new ErrorBanner(this.menu);
        this._updateList = new UpdateList(this.menu, {
            onItemActivated: item => this._openPackageInfo(item),
        });
        this._footer = new MenuFooter(this.menu, {
            onUpdateAllClicked: () => this._manager.startUpdate(),
        });

        this.menu.connectObject('open-state-changed', (_menu, isOpen) => {
            if (isOpen)
                this._syncUpdateList();
        }, this);
    }

    _connectManager() {
        const m = this._manager;
        m.connectObject(
            'state-changed', () => this._render(),
            'updates-changed', () => this._rebuildUpdateList(),
            'new-updates', (_m, newItems) => this._notifier.newUpdates(newItems, m.updates.length),
            'update-started', () => {
                this._progressCard.start();
                this.menu.open();
            },
            'update-progress', (_m, event) => {
                this._progressCard.setProgress(event);
                this._panelStatus.showProgress(event.fraction);
            },
            'update-finished', (_m, result) => this._onUpdateFinished(result),
            this
        );
    }

    _onSettingChanged(key) {
        if (POSITION_KEYS.includes(key)) {
            this._extension.repositionIndicator();
        } else if (APPEARANCE_KEYS.includes(key)) {
            this._panelStatus.setCompact(this._settings.get_boolean('compact-mode'));
            this._render();
        }
    }

    _onRefreshClicked() {
        const {state} = this._manager;
        if (state === 'checking')
            this._manager.cancelCheck();
        else if (state !== 'updating')
            this._manager.runCheck();
    }

    async _requestPassword(archCount) {
        this.menu.close();
        const dialog = new SudoPasswordDialog(
            `Enter your password to upgrade ${plural(archCount, 'Arch Linux package')}.`
        );
        this._activeDialog = dialog;
        try {
            return await dialog.prompt();
        } finally {
            this._activeDialog = null;
        }
    }

    _onUpdateFinished(result) {
        this._progressCard.showResult(result);
        if (result.cancelled)
            return;
        if (result.ok)
            this._notifier.updateSucceeded();
        else
            this._notifier.updateFailed(result.errors);
    }

    _rebuildUpdateList() {
        if (this.menu.isOpen) {
            const endRebuild = this._manager.debug.startTimer('ui', 'rebuildUpdateList');
            this._updateList.setUpdates(this._manager.bySource, true);
            endRebuild({items: this._manager.updates.length});
        } else {
            this._updateList.setUpdates(this._manager.bySource, false);
        }
    }

    _syncUpdateList() {
        if (!this._updateList.dirty)
            return;
        const endRebuild = this._manager.debug.startTimer('ui', 'rebuildUpdateList');
        if (this._updateList.syncIfNeeded())
            endRebuild({items: this._manager.updates.length, deferred: true});
    }

    _openPackageInfo(item) {
        const uri = getPackageInfoUrl(item);
        if (!uri)
            return;

        this.menu.close();
        try {
            Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
        } catch (err) {
            console.warn(`arch-up-to-date: failed to open ${uri}: ${err.message}`);
        }
    }

    _render() {
        const m = this._manager;
        const {state} = m;
        const count = m.updates.length;

        this._panelStatus.update({
            state,
            count,
            showCount: this._settings.get_boolean('show-count'),
            hideWhenUpToDate: this._settings.get_boolean('hide-when-uptodate'),
            hasChecked: m.lastCheck !== null,
        });
        this._header.update({
            state,
            count,
            lastCheck: m.lastCheck,
        });
        this._debugStrip.update({
            enabled: m.debug.enabled,
            timings: m.lastTimings,
            state,
        });
        this._errorBanner.setMessages(m.warnings);

        const hasUpdates = count > 0;
        this._updateList.visible = hasUpdates;
        this._footer.visible = hasUpdates;
        this._footer.update({state, count});
    }

    destroy() {
        this.menu.disconnectObject(this);
        this._manager.disconnectObject(this);
        this._manager.destroy();

        this._progressCard.destroy();

        if (this._activeDialog) {
            this._activeDialog.popModal();
            this._activeDialog.destroy();
            this._activeDialog = null;
        }

        this._notifier.destroy();

        this._settings?.disconnectObject(this);
        this._settings = null;

        super.destroy();
    }
});
