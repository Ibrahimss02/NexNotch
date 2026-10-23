import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickToggle, QuickMenuToggle, QuickSlider} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

const UPOWER_XML = `
<node>
  <interface name="org.freedesktop.DBus.ObjectManager">
    <method name="GetManagedObjects">
      <arg type="a{oa{sa{sv}}}" direction="out"/>
    </method>
  </interface>
</node>`;

export const QuickHub = GObject.registerClass({
    Signals: {
        'updated': {},
        'request-collapse': {},
    },
}, class QuickHub extends GObject.Object {
    _init(settings) {
        super._init();
        this._settings = settings;
        this._mic = false;
        this._cam = false;
        this._btDevices = [];
        this._kbLayout = '';
        this._poller = 0;
        this._armedTimers = new Set();
        this._mirrorCleanups = [];
        try {
            this._dndSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        } catch (_) { this._dndSettings = null; }
    }

    start() {
        this._stopped = false;
        this._focused = false;
        this._refresh();
    }

    /* Mic/cam/BT status only matters while the Quick tab is actually on
       screen — each refresh spawns up to 3 subprocesses (pactl/fuser/
       upower). Only run the poller while focused, so a background Quick
       module costs nothing. */
    setFocused(focused) {
        if (this._focused === focused) return;
        this._focused = focused;
        if (focused) {
            this._refresh();
            if (!this._poller) {
                this._poller = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 15, () => {
                    if (this._stopped) return GLib.SOURCE_REMOVE;
                    this._refresh();
                    return GLib.SOURCE_CONTINUE;
                });
            }
        } else if (this._poller) {
            GLib.source_remove(this._poller);
            this._poller = 0;
        }
    }

    stop() {
        this._stopped = true;
        if (this._poller) { GLib.source_remove(this._poller); this._poller = 0; }
        for (const id of this._armedTimers) {
            try { GLib.source_remove(id); } catch (_) {}
        }
        this._armedTimers.clear();
        this._dropMirrors();
    }

    destroy() { this.stop(); }

    _dropMirrors() {
        for (const f of this._mirrorCleanups) {
            try { f(); } catch (_) {}
        }
        this._mirrorCleanups = [];
    }

    /* GNOME's own Quick Settings items. They stay alive while the top bar is
       hidden, so the notch mirrors them instead of reimplementing Wi-Fi,
       Bluetooth, volume etc. */
    _systemItems() {
        const grid = Main.panel.statusArea.quickSettings?.menu?._grid;
        return grid ? grid.get_children().filter(c => c.visible) : [];
    }

    _syncIcon(icon, item) {
        if (item.gicon) icon.gicon = item.gicon;
        else icon.icon_name = item.iconName || 'emblem-system-symbolic';
    }

    _buildSliders() {
        const box = new St.BoxLayout({style_class: 'nexnotch-quick-sliders', vertical: true, x_expand: true});
        for (const item of this._systemItems()) {
            if (!(item instanceof QuickSlider)) continue;
            const row = new St.BoxLayout({style_class: 'nexnotch-quick-slider-row', x_expand: true});
            const icon = new St.Icon({style_class: 'nexnotch-quick-slider-icon', y_align: Clutter.ActorAlign.CENTER});
            const slider = new Slider(item.slider.value);
            row.add_child(icon);
            row.add_child(slider);
            if (item.menu) row.add_child(this._moreButton(item, 'nexnotch-quick-slider-more'));   // e.g. audio output
            box.add_child(row);

            const sync = () => this._syncIcon(icon, item);
            sync();
            // both ways: dragging here moves GNOME's slider, which changes the real volume/brightness
            const binding = item.slider.bind_property('value', slider, 'value',
                GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE);
            const ids = ['notify::gicon', 'notify::icon-name'].map(s => item.connect(s, sync));
            this._mirror(row, () => {
                binding.unbind();
                ids.forEach(id => item.disconnect(id));
            });
        }
        return box;
    }

    /* Undo a mirror as soon as its widget dies (tab switch, rerender), and
       at the latest on the next render; whichever comes first. */
    _mirror(widget, cleanup) {
        let done = false;
        const once = () => { if (!done) { done = true; cleanup(); } };
        widget.connect('destroy', once);
        this._mirrorCleanups.push(once);
    }

    _buildToggles() {
        const row = new St.BoxLayout({style_class: 'nexnotch-quick-toggles', x_expand: true, x_align: Clutter.ActorAlign.CENTER});
        for (const item of this._systemItems()) {
            if (!(item instanceof QuickToggle || item instanceof QuickMenuToggle)) continue;
            const icon = new St.Icon({style_class: 'nexnotch-quick-toggle-icon'});
            const btn = new St.Button({
                style_class: 'nexnotch-quick-toggle', child: icon, can_focus: true,
                button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,   // right-click opens the submenu
            });
            const sync = () => {
                this._syncIcon(icon, item);
                btn.accessible_name = item.title ?? '';
                if (item.checked) btn.add_style_pseudo_class('checked');
                else btn.remove_style_pseudo_class('checked');
            };
            sync();
            btn.connect('clicked', (_b, button) => {
                if (button === Clutter.BUTTON_SECONDARY && item.menu && item.menuEnabled !== false)
                    this.openSubmenu(item);
                else if (button !== Clutter.BUTTON_SECONDARY)
                    item.emit('clicked', 1);
            });
            const ids = ['notify::checked', 'notify::gicon', 'notify::icon-name', 'notify::title']
                .map(s => item.connect(s, sync));
            this._mirror(btn, () => ids.forEach(id => item.disconnect(id)));
            row.add_child(item.menu ? this._withBadge(btn, item) : btn);
        }
        return row;
    }

    /* toggle + small ▾ badge in its corner that opens the submenu */
    _withBadge(btn, item) {
        const wrap = new St.Widget({layout_manager: new Clutter.BinLayout()});
        wrap.add_child(btn);
        wrap.add_child(this._moreButton(item, 'nexnotch-quick-badge', {
            x_expand: true, y_expand: true,
            x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.END,
        }));
        return wrap;
    }

    _moreButton(item, styleClass, params = {}) {
        const more = new St.Button({
            style_class: styleClass,
            child: new St.Icon({icon_name: 'pan-down-symbolic', style_class: `${styleClass}-icon`}),
            accessible_name: `${item.title ?? 'Item'} options`,
            can_focus: true,
            ...params,
        });
        more.connect('clicked', () => this.openSubmenu(item));
        // Wi-Fi's network list is unavailable while Wi-Fi is off, etc.
        const sync = () => { more.visible = item.menuEnabled !== false; };
        sync();
        const id = item.connect('notify::menu-enabled', sync);
        this._mirror(more, () => item.disconnect(id));
        return more;
    }

    /* GNOME's Quick Settings menu still works with the top bar slid off
       screen; it pops up at the top-right corner. Open it, then the item's
       own submenu (Wi-Fi networks, Bluetooth devices, power modes, output). */
    openSubmenu(item) {
        const qs = Main.panel.statusArea.quickSettings;
        if (!qs?.menu || !item?.menu) return;
        this.emit('request-collapse');
        qs.menu.open();
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (qs.menu.isOpen) item.menu.open(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    /* the volume slider, whose submenu picks the audio output */
    outputSlider() {
        return Main.panel.statusArea.quickSettings?._volumeOutput?.quickSettingsItems?.[0] ?? null;
    }

    async _refresh() {
        try {
            this._mic = await this._anyAppUsing('Audio/Source');
            this._cam = await this._anyCameraUsing();
            this._btDevices = await this._btBatteries();
            this._kbLayout  = this._currentLayout();
            this.emit('updated');
        } catch (e) { logError(e, 'nexnotch:quick:refresh'); }
    }

    async _anyAppUsing(_role) {
        return await new Promise(resolve => {
            if (!GLib.find_program_in_path('pactl')) { resolve(false); return; }
            try {
                const proc = Gio.Subprocess.new(
                    ['pactl', '-f', 'json', 'list', 'source-outputs'],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
                );
                proc.communicate_utf8_async(null, null, (p, res) => {
                    try {
                        const [, out] = p.communicate_utf8_finish(res);
                        const data = JSON.parse(out || '[]');
                        resolve(Array.isArray(data) && data.length > 0);
                    } catch (_) { resolve(false); }
                });
            } catch (_) { resolve(false); }
        });
    }

    async _anyCameraUsing() {
        /* Avoid `sh -c` entirely — enumerate /dev/video* ourselves and spawn
           fuser directly with an explicit absolute path. Portable and the
           spawn matches the guarded binary. */
        const fuserPath = GLib.find_program_in_path('fuser');
        if (!fuserPath) return false;
        const devs = [];
        try {
            const dir = Gio.File.new_for_path('/dev');
            const iter = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = iter.next_file(null))) {
                const n = info.get_name();
                if (/^video\d+$/.test(n)) devs.push(`/dev/${n}`);
            }
        } catch (_) { return false; }
        if (devs.length === 0) return false;
        return new Promise(resolve => {
            try {
                const proc = Gio.Subprocess.new(
                    [fuserPath, ...devs],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
                );
                proc.communicate_utf8_async(null, null, (p, res) => {
                    try {
                        const [, out] = p.communicate_utf8_finish(res);
                        resolve(out.trim().length > 0);
                    } catch (_) { resolve(false); }
                });
            } catch (_) { resolve(false); }
        });
    }

    async _btBatteries() {
        return await new Promise(resolve => {
            if (!GLib.find_program_in_path('upower')) { resolve([]); return; }
            try {
                const proc = Gio.Subprocess.new(
                    ['upower', '-d'],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
                );
                proc.communicate_utf8_async(null, null, (p, res) => {
                    try {
                        const [, out] = p.communicate_utf8_finish(res);
                        const devs = [];
                        const blocks = out.split(/\n\s*\n/);
                        for (const b of blocks) {
                            if (!/model:/i.test(b)) continue;
                            if (!/battery/i.test(b) && !/headset|headphones|keyboard|mouse|phone/i.test(b)) continue;
                            const model = (b.match(/model:\s+([^\n]+)/) || [])[1];
                            const pctRaw = (b.match(/percentage:\s+(\d+)/) || [])[1];
                            const pct   = Number(pctRaw);
                            /* keep 0% devices — they're the ones that need alerting */
                            if (model && Number.isFinite(pct)) devs.push({model: model.trim(), pct});
                        }
                        resolve(devs);
                    } catch (_) { resolve([]); }
                });
            } catch (_) { resolve([]); }
        });
    }

    _currentLayout() {
        try {
            const src = new Gio.Settings({schema_id: 'org.gnome.desktop.input-sources'});
            const srcs = src.get_value('sources').deep_unpack();
            const cur  = src.get_uint('current');
            if (srcs[cur]) return srcs[cur][1];
        } catch (_) {}
        return '';
    }

    render() {
        const box = new St.BoxLayout({style_class: 'nexnotch-quick', vertical: true, x_expand: true, y_expand: true});

        this._dropMirrors(); // the previous render's widgets are gone
        box.add_child(this._buildSliders());
        box.add_child(this._buildToggles());

        /* status pills — mic/cam/layout plus Bluetooth batteries, one centered row */
        const statusRow = new St.BoxLayout({style_class: 'nexnotch-quick-row', x_align: Clutter.ActorAlign.CENTER});
        statusRow.add_child(this._pill('Mic',    this._mic  ? 'on'  : 'off', this._mic));
        statusRow.add_child(this._pill('Camera', this._cam  ? 'on'  : 'off', this._cam));
        statusRow.add_child(this._pill('Layout', this._kbLayout || '—', false));
        for (const d of this._btDevices) {
            const p = this._pill(d.model, `${d.pct}%`, false);
            if (d.pct < 20) p.add_style_class_name('low');
            statusRow.add_child(p);
        }
        box.add_child(statusRow);

        const actions = new St.BoxLayout({style_class: 'nexnotch-quick-actions', x_align: Clutter.ActorAlign.CENTER});
        /* Lock and Suspend are safe one-click; Log out / Reboot / Shutdown
           require a second confirmation click within 3 s (button turns red
           and shows a check mark) so accidental taps don't kill work. */
        actions.add_child(this._actionButton('Lock',    'system-lock-screen-symbolic', () => this._run(['loginctl', 'lock-session'])));
        actions.add_child(this._actionButton('Suspend', 'weather-clear-night-symbolic', () => this._run(['systemctl', 'suspend'])));
        actions.add_child(this._armedActionButton('Log out',  'system-log-out-symbolic',  ['gnome-session-quit', '--logout', '--no-prompt']));
        actions.add_child(this._armedActionButton('Reboot',   'system-reboot-symbolic',   ['systemctl', 'reboot']));
        actions.add_child(this._armedActionButton('Shutdown', 'system-shutdown-symbolic', ['systemctl', 'poweroff']));
        box.add_child(actions);

        return box;
    }

    _pill(label, value, active) {
        const p = new St.BoxLayout({style_class: 'nexnotch-quick-pill' + (active ? ' active' : '')});
        p.add_child(new St.Label({text: label, style_class: 'nexnotch-quick-pill-label'}));
        p.add_child(new St.Label({text: value, style_class: 'nexnotch-quick-pill-value'}));
        return p;
    }

    _actionButton(label, iconName, cb) {
        const b = new St.Button({
            style_class: 'nexnotch-quick-toggle nexnotch-quick-power',
            child: new St.Icon({icon_name: iconName, style_class: 'nexnotch-quick-toggle-icon'}),
            accessible_name: label,
            can_focus: true,
        });
        b.connect('clicked', cb);
        return b;
    }

    _armedActionButton(label, iconName, argv) {
        const icon = new St.Icon({icon_name: iconName, style_class: 'nexnotch-quick-toggle-icon'});
        const b = new St.Button({
            style_class: 'nexnotch-quick-toggle nexnotch-quick-power',
            child: icon,
            accessible_name: `${label} (click twice to confirm)`,
            can_focus: true,
        });
        let armed = false;
        let armTimer = 0;
        const disarm = () => {
            armed = false;
            if (armTimer) {
                this._armedTimers.delete(armTimer);
                try { GLib.source_remove(armTimer); } catch (_) {}
                armTimer = 0;
            }
            try { icon.icon_name = iconName; b.remove_style_class_name('armed'); } catch (_) {}
        };
        b.connect('clicked', () => {
            if (this._stopped) return;
            if (armed) { disarm(); this._run(argv); return; }
            armed = true;
            icon.icon_name = 'object-select-symbolic'; // "click again to confirm"
            b.add_style_class_name('armed');
            if (armTimer) { this._armedTimers.delete(armTimer); GLib.source_remove(armTimer); }
            armTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
                this._armedTimers.delete(armTimer);
                armTimer = 0;
                disarm();
                return GLib.SOURCE_REMOVE;
            });
            this._armedTimers.add(armTimer);
        });
        /* if the whole tab rerenders while armed, the button is destroyed —
           make sure we also drop the pending timer rather than touching a
           dead actor. */
        b.connect('destroy', () => disarm());
        return b;
    }

    _run(argv) {
        if (!GLib.find_program_in_path(argv[0])) {
            logError(new Error(`${argv[0]} not in PATH`), 'nexnotch:quick:run');
            return;
        }
        try {
            Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) { logError(e, 'nexnotch:quick:run'); }
    }
});
