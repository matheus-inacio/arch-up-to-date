/**
 * Flatpak update stage: `flatpak update -y --noninteractive`.
 *
 * @param {object} params
 * @param {object} params.cap Flatpak capability
 * @param {Function} params.emit `(fraction, stageLabel, detail, line?) => void`
 * @param {Function} params.spawn `(argv, env, onLine) => Promise<void>`
 */
export async function runFlatpakStage({cap, emit, spawn}) {
    let progress = 0.05;
    emit(progress, 'Flatpak', 'Updating Flatpak apps and runtimes…', '── Flatpak ──');

    await spawn([cap.path, 'update', '-y', '--noninteractive'], null, line => {
        const pctMatch = line.match(/(\d+)%/);
        if (pctMatch)
            progress = Math.max(progress, Math.min(0.95, parseInt(pctMatch[1], 10) / 100));
        else if (line.startsWith('Updating') || line.startsWith('Installing'))
            progress = Math.min(0.9, progress + 0.1);

        emit(progress, 'Flatpak', line, line);
    });

    emit(1, 'Flatpak', 'Flatpak updates finished');
}
