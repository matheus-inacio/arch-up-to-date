import GLib from 'gi://GLib';

const GEARLEVER_FLATPAK_ID = 'it.mijorus.gearlever';

function hasFlatpakApp(appId) {
    const paths = [
        GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share', 'flatpak', 'app', appId]),
        `/var/lib/flatpak/app/${appId}`,
    ];
    return paths.some(p => GLib.file_test(p, GLib.FileTest.IS_DIR));
}

function resolveAurHelper(pref, yayPath, paruPath) {
    if (pref === 'yay' && yayPath)
        return {path: yayPath, name: 'yay'};
    if (pref === 'paru' && paruPath)
        return {path: paruPath, name: 'paru'};
    if (pref === 'auto') {
        if (yayPath)
            return {path: yayPath, name: 'yay'};
        if (paruPath)
            return {path: paruPath, name: 'paru'};
    }
    return {path: null, name: null};
}

/**
 * Synchronously (via fast PATH & stat checks, zero subprocesses) detect installed
 * package management backends on the system.
 *
 * @param {Gio.Settings=} settings Optional GSettings to apply user enable/disable prefs
 */
export function detectBackends(settings = null) {
    const pacmanPath = GLib.find_program_in_path('pacman');
    const checkupdatesPath = GLib.find_program_in_path('checkupdates');
    const yayPath = GLib.find_program_in_path('yay');
    const paruPath = GLib.find_program_in_path('paru');
    const flatpakPath = GLib.find_program_in_path('flatpak');
    const nativeGearleverPath = GLib.find_program_in_path('gearlever');
    const flatpakGearlever = Boolean(flatpakPath && hasFlatpakApp(GEARLEVER_FLATPAK_ID));

    const aurPref = settings ? settings.get_string('aur-helper') : 'auto';
    const aur = resolveAurHelper(aurPref, yayPath, paruPath);

    const enablePacman = settings ? settings.get_boolean('enable-pacman') : true;
    const enableFlatpak = settings ? settings.get_boolean('enable-flatpak') : true;
    const enableGearlever = settings ? settings.get_boolean('enable-gearlever') : true;

    return {
        pacman: {
            available: Boolean(pacmanPath && checkupdatesPath),
            enabled: Boolean(enablePacman && pacmanPath && checkupdatesPath),
            pacmanPath,
            checkupdatesPath,
            missingCheckupdates: Boolean(pacmanPath && !checkupdatesPath),
        },
        aur: {
            available: Boolean(yayPath || paruPath),
            enabled: Boolean(aur.path && aurPref !== 'disabled'),
            path: aur.path,
            name: aur.name,
            hasYay: Boolean(yayPath),
            hasParu: Boolean(paruPath),
        },
        flatpak: {
            available: Boolean(flatpakPath),
            enabled: Boolean(enableFlatpak && flatpakPath),
            path: flatpakPath,
        },
        gearlever: {
            available: Boolean(nativeGearleverPath || flatpakGearlever),
            enabled: Boolean(enableGearlever && (nativeGearleverPath || flatpakGearlever)),
            mode: nativeGearleverPath ? 'native' : (flatpakGearlever ? 'flatpak' : null),
            path: nativeGearleverPath || flatpakPath,
            flatpakId: GEARLEVER_FLATPAK_ID,
        },
    };
}

/**
 * Build the argv to run Gearlever, either natively or through `flatpak run`.
 *
 * @param {object} cap Gearlever capability from {@link detectBackends}
 * @param {string[]} args Gearlever arguments
 */
export function gearleverArgv(cap, args) {
    return cap.mode === 'native'
        ? [cap.path, ...args]
        : [cap.path, 'run', cap.flatpakId, ...args];
}
