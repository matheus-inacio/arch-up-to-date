import {createComboRow, createGroup, createSpinRow, createSwitchRow} from './rows.js';

const PANEL_BOX_OPTIONS = [
    {id: 'left', label: 'Left'},
    {id: 'center', label: 'Center'},
    {id: 'right', label: 'Right'},
];

/** "Top Bar & Appearance" group: indicator look and placement. */
export function buildAppearanceGroup(settings) {
    return createGroup({title: 'Top Bar & Appearance'}, [
        createSwitchRow(settings, 'compact-mode', {
            title: 'Compact Mode',
            subtitle: 'Minimal padding and smaller count badge on the top bar',
        }),
        createSwitchRow(settings, 'show-count', {
            title: 'Show Update Count',
            subtitle: 'Display pending update count next to the icon',
        }),
        createSwitchRow(settings, 'hide-when-uptodate', {
            title: 'Hide When Up to Date',
            subtitle: 'Only show the top bar icon when updates are pending or active',
        }),
        createSwitchRow(settings, 'use-arch-icons', {
            title: 'Use Arch Linux Icons',
            subtitle: 'Use bundled Arch symbolic icons instead of generic system icons',
        }),
        createComboRow(settings, 'panel-box', PANEL_BOX_OPTIONS, {
            title: 'Panel Position',
        }),
        createSpinRow(settings, 'panel-index', {
            title: 'Panel Index',
            subtitle: 'Order within the selected panel box',
        }, {lower: 0, upper: 20, step: 1, page: 1}),
    ]);
}
