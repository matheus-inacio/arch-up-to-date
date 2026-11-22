import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {SOURCE_ORDER, emptyBySource} from '../common/sources.js';
import {isCancelledError} from '../common/subprocess.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

const CACHE_VERSION = 1;
const VALID_SOURCES = new Set(SOURCE_ORDER);
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder('utf-8');

function isValidItem(item) {
    return item !== null &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.currentVersion === 'string' &&
        typeof item.newVersion === 'string' &&
        VALID_SOURCES.has(item.source);
}

/** Group flat update items into `{pacman, aur, flatpak, gearlever}` lists. */
export function groupBySource(updates) {
    const bySource = emptyBySource();
    for (const item of updates) {
        if (VALID_SOURCES.has(item.source))
            bySource[item.source].push(item);
    }
    return bySource;
}

/**
 * Lightweight, non-blocking JSON cache for the last update check under
 * `$XDG_CACHE_HOME/<uuid>/state.json`.
 *
 * Uses async Gio I/O with atomic file replacement so the GNOME Shell
 * compositor thread is never blocked and the cache file cannot be corrupted
 * by a crash or power loss.
 */
export class StateCache {
    /**
     * @param {object} params
     * @param {string} params.uuid Extension UUID used as cache subdirectory name
     * @param {import('../common/debug.js').DebugLogger=} params.debug
     * @param {string=} params.baseDir Override cache base dir (for tests)
     */
    constructor({uuid, debug = null, baseDir = GLib.get_user_cache_dir()}) {
        this._dirPath = GLib.build_filenamev([baseDir, uuid]);
        this._file = Gio.File.new_for_path(GLib.build_filenamev([this._dirPath, 'state.json']));
        this._debug = debug;
        this._dirReady = false;
        this._loadCancellable = null;
        this._saveCancellable = null;
    }

    /**
     * Load cached state from disk.
     *
     * @returns {Promise<{lastCheck: Date, updates: object[]}|null>}
     */
    async load() {
        this._loadCancellable?.cancel();
        const cancellable = new Gio.Cancellable();
        this._loadCancellable = cancellable;

        const endTimer = this._debug?.startTimer('cache', 'load');
        try {
            const [bytes] = await this._file.load_contents_async(cancellable);
            const raw = DECODER.decode(bytes);
            const data = JSON.parse(raw);

            if (data?.v !== CACHE_VERSION || !Number.isFinite(data.lastCheck) || !Array.isArray(data.updates)) {
                endTimer?.({status: 'invalid'});
                return null;
            }

            const updates = data.updates.filter(isValidItem);
            const lastCheck = new Date(data.lastCheck);
            endTimer?.({status: 'hit', items: updates.length});
            return {lastCheck, updates};
        } catch (err) {
            if (isCancelledError(err)) {
                endTimer?.({status: 'cancelled'});
                return null;
            }
            if (err?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
                endTimer?.({status: 'miss'});
                return null;
            }
            this._debug?.log('cache', `failed to read cache: ${err?.message ?? err}`);
            endTimer?.({status: 'error'});
            return null;
        } finally {
            if (this._loadCancellable === cancellable)
                this._loadCancellable = null;
        }
    }

    /**
     * Atomically persist the latest check timestamp and pending updates.
     * Any superseded in-flight write is cancelled.
     *
     * @param {{lastCheck: Date, updates: object[]}} state
     */
    async save({lastCheck, updates}) {
        this._saveCancellable?.cancel();
        const cancellable = new Gio.Cancellable();
        this._saveCancellable = cancellable;

        const endTimer = this._debug?.startTimer('cache', 'save');
        try {
            if (!this._dirReady) {
                GLib.mkdir_with_parents(this._dirPath, 0o700);
                this._dirReady = true;
            }

            const payload = JSON.stringify({
                v: CACHE_VERSION,
                lastCheck: lastCheck.getTime(),
                updates,
            });
            const bytes = new GLib.Bytes(ENCODER.encode(payload));

            await this._file.replace_contents_bytes_async(
                bytes,
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                cancellable
            );
            endTimer?.({status: 'ok', items: updates.length, bytes: bytes.get_size()});
        } catch (err) {
            if (!isCancelledError(err))
                this._debug?.log('cache', `failed to write cache: ${err?.message ?? err}`);
            endTimer?.({status: isCancelledError(err) ? 'cancelled' : 'error'});
        } finally {
            if (this._saveCancellable === cancellable)
                this._saveCancellable = null;
        }
    }

    destroy() {
        this._loadCancellable?.cancel();
        this._loadCancellable = null;
        this._saveCancellable?.cancel();
        this._saveCancellable = null;
    }
}
