import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Animation from 'resource:///org/gnome/shell/ui/animation.js';
import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as ShellEntry from 'resource:///org/gnome/shell/ui/shellEntry.js';

import {validateSudoPassword} from './sudo.js';

export const SudoPasswordDialog = GObject.registerClass(
class SudoPasswordDialog extends ModalDialog.ModalDialog {
    _init(summaryText) {
        super._init({
            styleClass: 'prompt-dialog arch-uptodate-auth-dialog',
            destroyOnClose: true,
        });

        this._resolve = null;
        this._validating = false;
        this._cancellable = new Gio.Cancellable();

        const content = new Dialog.MessageDialogContent({
            title: 'Authentication Required',
            description: summaryText || 'Enter your password to install Arch Linux system updates.',
        });
        this.contentLayout.add_child(content);

        const passwordBox = new St.BoxLayout({
            style_class: 'prompt-dialog-password-layout',
            orientation: Clutter.Orientation.VERTICAL,
        });

        const entryRow = new St.BoxLayout({
            style_class: 'arch-uptodate-password-row',
            x_align: Clutter.ActorAlign.CENTER,
        });

        this._passwordEntry = new St.PasswordEntry({
            style_class: 'prompt-dialog-password-entry',
            hint_text: 'Password',
            can_focus: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        ShellEntry.addContextMenu(this._passwordEntry);
        this._passwordEntry.clutter_text.connect('activate', () => this._onAuthenticate());
        this._passwordEntry.clutter_text.connect('text-changed', text => {
            this._updateSensitivity(text.get_text().length > 0);
        });
        entryRow.add_child(this._passwordEntry);

        this._spinner = new Animation.Spinner(16, {hideOnStop: true});
        this._spinner.add_style_class_name('arch-uptodate-auth-spinner');
        entryRow.add_child(this._spinner);

        passwordBox.add_child(entryRow);

        const warningBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
        });

        const capsLockWarning = new ShellEntry.CapsLockWarning();
        warningBox.add_child(capsLockWarning);

        this._errorLabel = new St.Label({
            style_class: 'prompt-dialog-error-label',
            visible: false,
        });
        this._errorLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._errorLabel.clutter_text.line_wrap = true;
        warningBox.add_child(this._errorLabel);

        passwordBox.add_child(warningBox);
        this.contentLayout.add_child(passwordBox);

        this._cancelButton = this.addButton({
            label: 'Cancel',
            action: () => this._finish(null),
            key: Clutter.KEY_Escape,
        });

        this._authButton = this.addButton({
            label: 'Authenticate',
            action: () => this._onAuthenticate(),
            reactive: false,
        });

        this.setInitialKeyFocus(this._passwordEntry);
        this.connect('destroy', () => {
            this._cancellable?.cancel();
            this._cancellable = null;
            if (this._resolve) {
                const resolve = this._resolve;
                this._resolve = null;
                resolve(null);
            }
        });
    }

    _updateSensitivity(hasText) {
        const sensitive = !this._validating;
        this._passwordEntry.reactive = sensitive;
        this._passwordEntry.clutter_text.editable = sensitive;
        this._authButton.reactive = sensitive && hasText;
        this._authButton.can_focus = sensitive && hasText;
    }

    async _onAuthenticate() {
        if (this._validating)
            return;

        const password = this._passwordEntry.get_text();
        if (!password)
            return;

        this._validating = true;
        this._errorLabel.visible = false;
        this._updateSensitivity(true);
        this._spinner.play();

        const ok = await validateSudoPassword(password, this._cancellable);

        if (!this._cancellable || this._cancellable.is_cancelled())
            return;

        this._spinner.stop();
        this._validating = false;

        if (ok) {
            this._passwordEntry.set_text('');
            this._finish(password);
        } else {
            this._passwordEntry.set_text('');
            this._errorLabel.text = 'Incorrect password. Please try again.';
            this._errorLabel.visible = true;
            this._updateSensitivity(false);
            this._passwordEntry.grab_key_focus();
        }
    }

    _finish(result) {
        const resolve = this._resolve;
        this._resolve = null;
        this.close();
        if (resolve)
            resolve(result);
    }

    /**
     * Open the modal dialog and wait for either a verified password or null (cancelled).
     *
     * @returns {Promise<string|null>}
     */
    prompt() {
        return new Promise(resolve => {
            this._resolve = resolve;
            if (!this.open()) {
                this._resolve = null;
                resolve(null);
            }
        });
    }
});
