# Arch Up To Date

A fast, lightweight **GNOME Shell 51+** extension for Arch Linux that automatically detects and updates your **Pacman**, **AUR**, **Flatpak**, and **Gearlever (AppImage)** packages right from the top bar.

## Why Arch Up To Date?

- **Zero setup, automatic discovery**: Automatically finds Pacman, `yay` or `paru`, Flatpak, and Gearlever (both native and Flatpak) on your system. No custom shell scripts or manual command configuration needed.
- **Fast and non-blocking**: Checks all of your update sources in parallel in the background, starts up with zero overhead, and stays lightweight on modern GNOME 51+.
- **Update directly in the popup menu**: No terminal windows popping open. Track progress with a native progress bar, stage indicator, cancel button, and an optional expandable live log right inside the menu.
- **Native GNOME authentication**: Prompts with GNOME's own password dialog (with Caps Lock warnings and inline validation) only when system privileges are actually needed. Skips the prompt for Flatpak/AppImage-only updates or passwordless `sudo`, and never stores your password on disk.
- **Always in sync with your terminal**: Automatically refreshes whenever you install or upgrade packages externally with `pacman`, `yay`, or `paru`.
- **Clean and unobtrusive**: Auto-hides when your system is up to date, includes a compact top bar mode, and lets you switch between Arch Linux icons and standard system icons.

## Supported Sources

All sources are auto-detected and can be individually enabled or disabled in Preferences.

| Source | Auto-Detection | Requirements |
| --- | --- | --- |
| **Arch Repositories** | Automatic | `pacman-contrib` (`checkupdates`) |
| **AUR** | Automatic (`yay` or `paru`) | `yay` or `paru` |
| **Flatpak** | Automatic | `flatpak` |
| **Gearlever (AppImages)** | Automatic (native or Flatpak) | Gearlever (`gearlever` or `it.mijorus.gearlever`) |

When applying updates, sources run in order: **Flatpak -> Gearlever -> Arch / AUR**.

## Requirements

- **GNOME Shell 51+**
- **Arch Linux** (or an Arch-based distribution)
- `pacman-contrib` for safe, rootless Arch repository checks:
  ```bash
  sudo pacman -S pacman-contrib
  ```
- Optional: `yay` or `paru`, `flatpak`, and `gearlever` (detected automatically if installed).

## Installation

### From Source

1. Compile the settings schema:
   ```bash
   glib-compile-schemas schemas/
   ```
2. Symlink the extension into your local GNOME Shell extensions folder:
   ```bash
   ln -s "$(pwd)" ~/.local/share/gnome-shell/extensions/arch-up-to-date@matheus-inacio.com
   ```
3. Log out and back in (on Wayland) so GNOME Shell discovers the extension, then enable it:
   ```bash
   gnome-extensions enable arch-up-to-date@matheus-inacio.com
   ```

### Packaging as a `.zip` Bundle

```bash
gnome-extensions pack --force \
  --extra-source=lib \
  --extra-source=icons \
  --schema=schemas/org.gnome.shell.extensions.arch-up-to-date.gschema.xml
gnome-extensions install --force arch-up-to-date@matheus-inacio.com.shell-extension.zip
```

## Preferences

Open preferences from the gear icon inside the popup menu, or run:

```bash
gnome-extensions prefs arch-up-to-date@matheus-inacio.com
```

- **Update Sources**: Toggle Pacman, Flatpak, and Gearlever, or pick a specific AUR helper (`auto`, `yay`, `paru`, or `disabled`).
- **Behavior**: Check interval (5 to 1440 minutes), startup delay (0 to 300 seconds), automatic pacman database watcher, and desktop notifications.
- **Top Bar & Appearance**: Compact mode, update count badge, hide when up to date, Arch Linux symbolic icons, panel position (`left`, `center`, `right`), and panel index.
- **Developer**: Debug & performance diagnostics toggle.

## Troubleshooting & Performance Profiling

Enable **Debug & Performance Diagnostics** in Preferences to see per-source check timings inside the popup menu and view detailed logs in real time:

```bash
journalctl -f /usr/bin/gnome-shell | grep arch-up-to-date
```

## Project Structure

```text
arch-up-to-date/
├── extension.js                  # Extension lifecycle & panel placement
├── prefs.js                      # Libadwaita preferences entry point
├── metadata.json                 # Extension metadata (GNOME Shell 51)
├── stylesheet.css                # GNOME Shell styling
├── icons/                        # Bundled Arch Linux symbolic SVG icons
├── schemas/                      # GSettings XML schema
└── lib/
    ├── common/                   # Shared utilities
    │   ├── debug.js              # Timing and diagnostic logger
    │   ├── format.js             # Text & time formatting helpers
    │   ├── sources.js            # Source metadata, ordering, and package URLs
    │   ├── subprocess.js         # Buffered & streaming subprocess helpers
    │   └── timer.js              # Reusable one-shot GLib timeout wrapper
    ├── backends/                 # Backend discovery & update checks
    │   ├── detect.js             # Fast PATH/stat backend auto-detection
    │   ├── parse.js              # Shared CLI output parsers
    │   ├── pacman.js             # Pacman (checkupdates) check
    │   ├── aur.js                # AUR (yay/paru) check
    │   ├── flatpak.js            # Flatpak check
    │   ├── gearlever.js          # Gearlever (AppImage) check
    │   └── checker.js            # Parallel check orchestrator
    ├── auth/                     # Privilege elevation
    │   ├── sudo.js               # Passwordless check & stdin password validation
    │   └── passwordDialog.js     # Native GNOME Shell sudo password modal
    ├── updater/                  # Update execution pipeline
    │   ├── askpass.js            # Ephemeral Unix-socket SUDO_ASKPASS server
    │   ├── runner.js             # Ordered multi-stage update runner
    │   └── stages/
    │       ├── flatpak.js        # Flatpak update stage
    │       ├── gearlever.js      # Gearlever AppImage update stage
    │       └── arch.js           # Pacman/AUR upgrade stage & progress tracker
    ├── core/                     # UI-independent state & orchestration
    │   ├── scheduler.js          # Boot, periodic, and post-update check timers
    │   ├── pacmanWatcher.js      # Debounced /var/lib/pacman/local watcher
    │   └── updateManager.js      # Central state machine & event emitter
    ├── ui/                       # GNOME Shell top bar & popup UI
    │   ├── icons.js              # Arch/system symbolic icon resolver
    │   ├── panelStatus.js        # Top bar icon, badge, and visibility
    │   ├── notifier.js           # Desktop notifications
    │   ├── indicator.js          # PanelMenu.Button wiring manager to UI widgets
    │   └── menu/
    │       ├── widgets.js        # Shared popup menu widget factories
    │       ├── header.js         # Status title, spinner, refresh & settings buttons
    │       ├── debugStrip.js     # Debug timing summary strip
    │       ├── progressCard.js   # Progress bar, cancel/dismiss, and live log
    │       ├── errorBanner.js    # Non-fatal backend warnings banner
    │       ├── updateList.js     # Scrollable, source-grouped update list
    │       └── footer.js         # "Update All" action bar
    └── prefs/                    # Preferences UI groups
        ├── rows.js               # Bound Adw row & group factories
        ├── sourcesGroup.js       # Update sources preferences group
        ├── behaviorGroup.js      # Scheduling, watcher & notifications group
        ├── appearanceGroup.js    # Top bar & appearance group
        └── developerGroup.js     # Debug diagnostics group
```

## License

Licensed under the [GNU General Public License v3.0 or later](LICENSE) (`GPL-3.0-or-later`).
