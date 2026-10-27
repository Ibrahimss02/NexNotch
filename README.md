# NexNotch — Dynamic Island for GNOME

[![GNOME Shell 46–50](https://img.shields.io/badge/GNOME%20Shell-46%20to%2050-4A86CF?logo=gnome&logoColor=white)](https://www.gnome.org/)
[![Ubuntu 24.04+](https://img.shields.io/badge/Ubuntu-24.04%2B-E95420?logo=ubuntu&logoColor=white)](#compatibility)
[![Fedora 40+](https://img.shields.io/badge/Fedora-40%2B-51A2DA?logo=fedora&logoColor=white)](#compatibility)
[![License: GPL-3.0+](https://img.shields.io/badge/License-GPL--3.0%2B-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Built by NexVar](https://img.shields.io/badge/built%20by-NexVar-0a0a0a?labelColor=000)](https://nexvar.io)

**Bring the iPhone Dynamic Island vibe to your Linux desktop.**

NexNotch is a MacBook-notch-shaped pill that replaces the GNOME top-bar clock. Hover it and it springs open into a swipeable hub: a music player with album art and synced lyrics, your notification history, a live system monitor, Google Calendar, weather, a Pomodoro timer, notes, Claude Code usage and GNOME's own quick settings. When something happens — a notification, a new song, the charger, a volume or brightness change, time to drink water — the notch peeks open to tell you, then tucks itself away.

> Built at **[NexVar](https://nexvar.io)** by **[Mert Ali Dalkır](https://mertdlkr.com)** — the polished desktop tooling we use ourselves.

---

## Why NexNotch?

GNOME's top bar is wasted space. macOS turned its notch into a Dynamic Island. NexNotch does the same for Linux — one hover-expanding component instead of a dozen separate extensions.

- **Light** — no subprocess polling, no blocking sensor reads; it stays off the shell's main thread
- **Native GNOME Shell** — pure JavaScript on St/Clutter/GObject, no build step
- **Wayland & X11**
- **Smooth** — spring-eased expand/collapse, swipe between tabs with momentum

---

## What's inside the notch

Hover the pill (or press `Super + N`). **Swipe left/right with two fingers** on the touchpad to move between tabs — a long swipe or a quick flick runs through several. A horizontal mouse wheel or `Shift` + wheel also works, and the page dots at the bottom are clickable. The notch reopens on the last tab you used.

| Tab | What it does |
|---|---|
| **Notifs** | Now Playing card tinted from the album art (seek bar, shuffle/repeat, synced lyrics, output picker) above GNOME's notification history. |
| **System** | Live CPU, RAM, swap, network, disk I/O, CPU temperature, load, uptime, battery time remaining. |
| **Limits** | Claude Code usage rings. |
| **Calendar** | Google Calendar month view and agenda through GNOME Online Accounts — no extra login. |
| **Notes** | Quick notes, autosaved. |
| **Shelf** | Drag files onto the notch to keep them at hand. Click one to open it, or copy it to paste anywhere. |
| **Weather** | Dual-location weather (wttr.in). |
| **Timer** | Pomodoro with presets. |
| **Water** | Cups drunk today against your goal, an hourly chart, and drink-water reminders. |
| **Quick** | GNOME's own Quick Settings — volume and brightness sliders, Wi-Fi, Bluetooth, power mode, dark style, night light… Click a name with a › to open its list (Wi-Fi networks, Bluetooth devices, audio output) right inside the notch. Mic/camera/battery status and two-tap power actions. |

**Peeks** — the notch briefly opens for:

- **Notifications** — hover to read the whole thing, click to open, ✕ to dismiss
- **Now playing** — when a track starts or changes (album art works for Spotify too)
- **Volume, brightness and keyboard backlight** — replaces GNOME's OSD popup with a slim bar in the notch
- **Charger** plugged in / unplugged
- **Drink water** — every 10 minutes by default, with a **Drink** button right on the reminder
- **Shelf** — drag a file near the notch and it becomes a drop target; after a drop it confirms, and the next open shows the Shelf

The collapsed pill shows battery, the time and date, a live waveform while music plays, the Pomodoro countdown and a screen-recording indicator (click to stop).

---

## Compatibility

| Distro | GNOME | Supported |
|---|---|---|
| Ubuntu 24.04 LTS | 46 | ✅ |
| Ubuntu 24.10 | 47 | ✅ |
| Ubuntu 25.04 | 48 | ✅ |
| Ubuntu 25.10 | 49 | ✅ |
| Ubuntu 26.04 LTS | 50 | ✅ |
| Fedora 40 – 44 | 46 – 50 | ✅ |

Developed and tested on GNOME 50 (Fedora 44). GNOME 46–49 use the same APIs; please open an issue if something looks off on your version.

Check yours with `gnome-shell --version`.

---

## Install

### Ubuntu / Debian

```sh
sudo apt install git make gnome-shell-extension-prefs
git clone https://github.com/Ibrahimss02/NexNotch.git
cd NexNotch
make install
```

Then **log out and back in** (on Wayland GNOME only loads new extensions at login) and enable it:

```sh
gnome-extensions enable nexnotch@nexvar
gnome-extensions prefs nexnotch@nexvar      # settings
```

On Ubuntu the notch sits in the middle of the top bar and takes over the clock. To get a notch-only top like macOS, hide the top bar with an extension such as [Just Perfection](https://extensions.gnome.org/extension/3843/just-perfection/).

### Fedora

```sh
sudo dnf install git make
git clone https://github.com/Ibrahimss02/NexNotch.git
cd NexNotch
make install
# log out → log in, then:
gnome-extensions enable nexnotch@nexvar
```

### From a zip

```sh
make pack                                          # builds nexnotch@nexvar.shell-extension.zip
gnome-extensions install --force nexnotch@nexvar.shell-extension.zip
```

### Update / uninstall

```sh
git pull && make install     # update, then log out / in (NexNotch tells you when a new release is out)
make uninstall               # remove
```

---

## Global keyboard shortcut

| Shortcut | Action |
|---|---|
| `Super + N` | Toggle notch expand / collapse |

Remappable from the **Shortcuts** page in preferences.

---

## Preferences

1. **General** — module toggles, drink-water reminder and interval, poll interval, hide GNOME clock
2. **Appearance** — size, corner radius, colors and presets, battery-icon colors
3. **Clock** — date, seconds, 12h / 24h, music in the pill
4. **Notifications** — native-banner suppression, Do Not Disturb behaviour
5. **Weather** — primary + secondary location, units, refresh rate
6. **Claude** — usage tab and refresh
7. **Pomodoro** — presets, long break, cycles
8. **Calendar** — per-account filter, shortcut to GNOME Online Accounts
9. **Shortcuts** — the toggle accelerator

---

## Architecture

```
nexnotch@nexvar/
├── metadata.json          # shell-version 46–50
├── extension.js           # mount in top chrome, top-corner ears, OSD hook
├── notch.js               # pill, expanded hub, swipe tabs, peeks, music card
├── modules/
│   ├── system.js          # /proc stats, CPU sensor, battery
│   ├── mpris.js           # media players (MPRIS)
│   ├── lyrics.js          # synced lyrics from lrclib.net (opt-in, cached)
│   ├── updates.js         # daily check for a newer GitHub release
│   ├── history.js         # GNOME notification history
│   ├── notifications.js   # notification peek
│   ├── power.js           # charger plug/unplug (UPower)
│   ├── water.js           # drink-water reminder + cup log
│   ├── shelf.js           # file shelf + drag-and-drop target
│   ├── dropzone.js        # tiny GTK helper that receives drops (see below)
│   ├── ui.js              # shared drawn widgets: battery, waveform, ring
│   ├── quick.js           # mirrors GNOME Quick Settings
│   ├── calendar.js        # Google Calendar via GOA
│   ├── notes.js           # notes
│   ├── weather.js         # wttr.in
│   ├── pomodoro.js        # Pomodoro timer
│   ├── claudeusage.js     # Claude Code usage
│   └── goa.js             # GNOME Online Accounts helper
├── prefs.js               # Adwaita preferences window
├── schemas/…gschema.xml
├── icons/                 # the water-cup icon
└── stylesheet.css
```

---

## Known limits

- **Wayland needs a log out / log in** after installing or updating — GNOME can't reload extension code in a running session.
- **Lyrics** are off until you press *Lyrics* on the player; turning them on sends the track name to [lrclib.net](https://lrclib.net).
- **Update check**: once a day NexNotch asks GitHub for the latest release and shows a notification when there's a newer one. Nothing is downloaded or installed. Turn it off in Preferences → General → Updates.
- **Shelf drag-and-drop:** on Wayland GNOME Shell can't receive dropped files itself, so while you drag, NexNotch briefly runs an invisible helper window (`modules/dropzone.js`, GJS + GTK 4) over the notch to catch the drop. Dragging files *out* of the shelf isn't possible; use click to open or Copy.
- **Evolution Data Server** sometimes doesn't auto-start; `extension.js` starts `evolution-source-registry` once at enable as a workaround.

---

## Dependencies

Nothing beyond a standard GNOME desktop (GNOME Shell 46+, GJS, GLib, GTK 4, libadwaita, libsoup 3). Calendar uses GNOME Online Accounts; weather and lyrics use the network only when enabled.

---

## Contributing

PRs welcome. NexNotch follows a small, opinionated style:

- Pure ES modules, no build step (GNOME loads `.js` directly)
- Each module owns its own `start()` / `stop()` lifecycle, registers `Gio.Cancellable`s
- Settings keys live in `schemas/*.gschema.xml`, accessed via `Gio.Settings`
- All async I/O uses GLib async primitives (`load_contents_async`, `copy_async`)
- No npm, no node_modules, no transpiler — keeps the install zip tiny

Run `make logs` to tail GNOME Shell logs while developing.

---

## Built By

### [NexVar](https://nexvar.io)

AI-first software studio shipping production tooling, AI platforms, and developer infrastructure. NexNotch is the desktop tooling we use ourselves — a 4800-line GNOME shell extension we polished while we were already daily-driving it.

[![Website](https://img.shields.io/badge/nexvar.io-000?style=flat&logo=safari&logoColor=white)](https://nexvar.io)
[![GitHub](https://img.shields.io/badge/NexVar-181717?style=flat&logo=github&logoColor=white)](https://github.com/NexVar)

### [Mert Ali Dalkır](https://mertdlkr.com)

Creator and maintainer. Co-founder of NexVar. Builder of useful, well-engineered desktop tooling for Linux.

[![Website](https://img.shields.io/badge/mertdlkr.com-000?style=flat&logo=safari&logoColor=white)](https://mertdlkr.com)
[![X](https://img.shields.io/badge/@mertdlkr-000?style=flat&logo=x&logoColor=white)](https://x.com/mertdlkr)
[![LinkedIn](https://img.shields.io/badge/mertdlkr-0A66C2?style=flat&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/mertdlkr/)
[![GitHub](https://img.shields.io/badge/mertdlkr-181717?style=flat&logo=github&logoColor=white)](https://github.com/mertdlkr)

---

## License

GPL-3.0-or-later © [NexVar](https://nexvar.io) and [Mert Ali Dalkır](https://mertdlkr.com)

See [LICENSE](LICENSE) for the full text.

---

**If NexNotch makes your GNOME desktop better, give it a star.** It helps others find it.

Built with conviction at [nexvar.io](https://nexvar.io) and [mertdlkr.com](https://mertdlkr.com).

<!--
Discoverability keywords (for GitHub search and AI indexing):
gnome extension, gnome shell extension, gnome 46, gnome 47, gnome 48, gnome 49, gnome 50, ubuntu 24.04,
dynamic island linux, dynamic island gnome, macbook notch linux,
linux desktop customization, linux productivity,
top bar replacement, gnome panel, gnome top bar, system monitor extension,
gnome calendar extension, pomodoro timer linux, gnome weather extension,
notification center linux, fedora extension, ubuntu extension,
arch linux extension, kde alternative, gnome customize,
gnome theming, ricing linux, linux ui, gnome ui, wayland extension,
adwaita, libadwaita, gjs, st widget, clutter, gnome online accounts,
google calendar gnome, google tasks gnome, vitals replacement,
all-in-one gnome extension, mertnotch, nexnotch, nexvar
-->
