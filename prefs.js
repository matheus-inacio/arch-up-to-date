import Adw from 'gi://Adw';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {detectBackends} from './lib/backends/detect.js';
import {buildAppearanceGroup} from './lib/prefs/appearanceGroup.js';
import {buildBehaviorGroup} from './lib/prefs/behaviorGroup.js';
import {buildDeveloperGroup} from './lib/prefs/developerGroup.js';
import {buildSourcesGroup} from './lib/prefs/sourcesGroup.js';

export default class ArchUpToDatePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'software-update-available-symbolic',
        });
        page.add(buildSourcesGroup(settings, detectBackends(settings)));
        page.add(buildBehaviorGroup(settings, this.uuid, window));
        page.add(buildAppearanceGroup(settings));
        page.add(buildDeveloperGroup(settings));
        window.add(page);
    }
}
