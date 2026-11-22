import {gearleverArgv} from '../../backends/detect.js';
import {plural} from '../../common/format.js';

/**
 * Gearlever update stage: updates each AppImage one by one.
 *
 * @param {object} params
 * @param {object[]} params.items Pending Gearlever items
 * @param {object} params.cap Gearlever capability
 * @param {Function} params.emit `(fraction, stageLabel, detail, line?) => void`
 * @param {Function} params.spawn `(argv, env, onLine) => Promise<void>`
 */
export async function runGearleverStage({items, cap, emit, spawn}) {
    const total = items.length;
    emit(0.05, 'Gearlever', `Updating ${plural(total, 'AppImage')}…`, '── Gearlever ──');

    for (let i = 0; i < total; i++) {
        const item = items[i];
        const appPath = item.extra?.appPath || item.id;
        const stageLabel = `Gearlever (${i + 1}/${total})`;
        emit(i / total, stageLabel, `Updating ${item.name}…`, `Updating AppImage: ${item.name}`);

        await spawn(gearleverArgv(cap, ['--update', appPath, '-y']), null, line => {
            emit((i + 0.5) / total, stageLabel, line, line);
        });
    }

    emit(1, 'Gearlever', 'AppImage updates finished');
}
