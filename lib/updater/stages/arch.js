const STEP_RE = /^\(\s*(\d+)\s*\/\s*(\d+)\s*\)\s+(.+)$/;

/** Milestones in pacman's output, mapped to the minimum progress they represent. */
const MILESTONES = [
    {match: ['Synchronizing package databases'], progress: 0.08},
    {match: ['Starting full system upgrade'], progress: 0.14},
    {match: ['Retrieving packages'], progress: 0.20},
    {match: ['checking keys in keyring', 'checking package integrity'], progress: 0.30},
    {match: ['loading package files', 'checking for file conflicts'], progress: 0.36},
];
const HOOKS_MARKER = 'Running post-transaction hooks';

/**
 * Build the upgrade command for either the AUR helper or plain pacman via sudo.
 *
 * @param {object} capabilities
 * @param {boolean} useAskpass Whether a SUDO_ASKPASS helper is available
 */
function buildArgv(capabilities, useAskpass) {
    if (capabilities.aur.enabled) {
        const argv = [
            capabilities.aur.path, '-Syu', '--noconfirm', '--color', 'never',
            `--sudoflags=${useAskpass ? '-A' : '-n'}`, '--sudoloop',
        ];
        if (capabilities.aur.name === 'paru')
            argv.push('--skipreview');
        return argv;
    }
    return [
        'sudo', useAskpass ? '-A' : '-n',
        capabilities.pacman.pacmanPath, '-Syu', '--noconfirm', '--color', 'never',
    ];
}

/**
 * Stateful parser that turns pacman/yay/paru output lines into a 0..1 progress estimate.
 */
class PacmanProgressTracker {
    constructor() {
        this.progress = 0.05;
        this._inHooks = false;
    }

    feed(line) {
        const milestone = MILESTONES.find(m => m.match.some(text => line.includes(text)));
        if (milestone) {
            this._raise(milestone.progress);
            return this.progress;
        }

        if (line.includes(HOOKS_MARKER)) {
            this._inHooks = true;
            this._raise(0.90);
            return this.progress;
        }

        const step = STEP_RE.exec(line);
        if (step) {
            const cur = parseInt(step[1], 10);
            const tot = Math.max(1, parseInt(step[2], 10));
            if (this._inHooks)
                this._raise(0.90 + (cur / tot) * 0.09);
            else
                this._raise(0.38 + (cur / tot) * 0.50);
        }
        return this.progress;
    }

    _raise(value) {
        this.progress = Math.max(this.progress, value);
    }
}

/**
 * Arch / AUR full system upgrade stage.
 *
 * @param {object} params
 * @param {object} params.capabilities All detected capabilities
 * @param {string|null} params.askpassPath SUDO_ASKPASS script path, or null for `sudo -n`
 * @param {Function} params.emit `(fraction, stageLabel, detail, line?) => void`
 * @param {Function} params.spawn `(argv, env, onLine) => Promise<void>`
 */
export async function runArchStage({capabilities, askpassPath, emit, spawn}) {
    const label = capabilities.aur.enabled
        ? `Arch / AUR (${capabilities.aur.name})`
        : 'Arch Linux (pacman)';
    const env = askpassPath ? {SUDO_ASKPASS: askpassPath} : null;
    const argv = buildArgv(capabilities, Boolean(askpassPath));

    const tracker = new PacmanProgressTracker();
    emit(tracker.progress, label, 'Synchronizing package databases…', `── ${label} ──`);

    await spawn(argv, env, line => {
        emit(tracker.feed(line), label, line, line);
    });

    emit(1, label, 'System upgrade finished');
}
