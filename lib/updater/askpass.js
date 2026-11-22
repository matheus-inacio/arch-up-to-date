import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const ENCODER = new TextEncoder();

/** gjs client script that reads one line from the socket and prints it for sudo. */
function buildClientScript(socketPath) {
    const gjsPath = GLib.find_program_in_path('gjs') || '/usr/bin/gjs';
    return [
        `#!${gjsPath} -m`,
        `import Gio from 'gi://Gio';`,
        `const client = new Gio.SocketClient();`,
        `const conn = client.connect(Gio.UnixSocketAddress.new(${JSON.stringify(socketPath)}), null);`,
        `const stream = new Gio.DataInputStream({base_stream: conn.get_input_stream()});`,
        `const [line] = stream.read_line_utf8(null);`,
        `if (line !== null) print(line);`,
        `conn.close(null);`,
        '',
    ].join('\n');
}

function tryIgnore(fn) {
    try {
        fn();
    } catch {
        // Ignore cleanup errors
    }
}

/**
 * Ephemeral in-memory SUDO_ASKPASS provider backed by a user-only (0700) Unix socket.
 * The password never touches disk, environment variables, or command-line arguments.
 */
export class AskpassServer {
    constructor(password, debug = null) {
        this._password = password;
        this._debug = debug;
        this._service = null;
        this._dir = null;
        this._socketPath = null;
        this._scriptPath = null;
    }

    /**
     * Create the private runtime dir, socket and client script.
     *
     * @returns {string} Path of the askpass script to use as SUDO_ASKPASS
     */
    start() {
        const runtimeDir = GLib.get_user_runtime_dir();
        const suffix = GLib.uuid_string_random().slice(0, 12);
        this._dir = GLib.build_filenamev([runtimeDir, `arch-up-to-date-${suffix}`]);
        GLib.mkdir_with_parents(this._dir, 0o700);

        this._socketPath = GLib.build_filenamev([this._dir, 'askpass.sock']);
        this._scriptPath = GLib.build_filenamev([this._dir, 'askpass.js']);

        this._createSocketService();
        this._writeClientScript();

        this._service.start();
        this._debug?.log('askpass', 'socket server started', {dir: this._dir});
        return this._scriptPath;
    }

    get scriptPath() {
        return this._scriptPath;
    }

    _createSocketService() {
        this._service = new Gio.SocketService();
        this._service.add_address(
            Gio.UnixSocketAddress.new(this._socketPath),
            Gio.SocketType.STREAM,
            Gio.SocketProtocol.DEFAULT,
            null
        );
        this._service.connect('incoming', (_service, connection) => {
            this._serveCredential(connection);
            return true;
        });
    }

    _serveCredential(connection) {
        try {
            if (this._password !== null) {
                const out = connection.get_output_stream();
                out.write_all(ENCODER.encode(`${this._password}\n`), null);
                out.flush(null);
                this._debug?.log('askpass', 'served credential request over Unix socket');
            }
        } catch (err) {
            console.warn(`arch-up-to-date: askpass write failed: ${err.message}`);
        } finally {
            tryIgnore(() => connection.close(null));
        }
    }

    _writeClientScript() {
        const file = Gio.File.new_for_path(this._scriptPath);
        const outStream = file.replace(null, false, Gio.FileCreateFlags.PRIVATE, null);
        outStream.write_all(ENCODER.encode(buildClientScript(this._socketPath)), null);
        outStream.close(null);
        GLib.chmod(this._scriptPath, 0o700);
    }

    dispose() {
        this._password = null;
        if (this._dir)
            this._debug?.log('askpass', 'disposing socket server and runtime dir');

        if (this._service) {
            tryIgnore(() => {
                this._service.stop();
                this._service.close();
            });
            this._service = null;
        }

        for (const p of [this._socketPath, this._scriptPath]) {
            if (p)
                tryIgnore(() => GLib.unlink(p));
        }
        if (this._dir)
            tryIgnore(() => GLib.rmdir(this._dir));

        this._socketPath = null;
        this._scriptPath = null;
        this._dir = null;
    }
}
