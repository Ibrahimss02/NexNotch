import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

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
        'show-submenu': {},
        'submenu-closed': {},   // by the user: back button or an item picked
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
        } else {
            this.closeSubmenu();
            if (this._poller) {
                GLib.source_remove(this._poller);
                this._poller = 0;
            }
        }
    }

    stop() {
        this._stopped = true;
        if (this._poller) { GLib.source_remove(this._poller); this._poller = 0; }
        for (const id of this._armedTimers) {
            try { GLib.source_remove(id); } catch (_) {}
        }
        this._armedTimers.clear();
        this.closeSubmenu();
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
            /* a full-height pill: the white fill is the level, the icon sits inside it */
            const pill = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true});
            const slider = new Slider(item.slider.value);
            slider.add_style_class_name('nexnotch-quick-slider');
            slider.x_expand = true;
            slider.accessible_name = item.slider.accessible_name ?? '';
            const icon = new St.Icon({style_class: 'nexnotch-quick-slider-icon', x_expand: true, y_expand: true,
                x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER});
            pill.add_child(slider);
            pill.add_child(icon);
            row.add_child(pill);
            if (item.menu) row.add_child(this._moreButton(item, 'nexnotch-quick-slider-more'));   // e.g. audio output
            box.add_child(row);

            const sync = () => {
                this._syncIcon(icon, item);
                icon.set_style(`color: ${slider.value > 0.1 ? '#000000' : '#A1A1A6'};`);
            };
            sync();
            // both ways: dragging here moves GNOME's slider, which changes the real volume/brightness
            const binding = item.slider.bind_property('value', slider, 'value',
                GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE);
            const ids = ['notify::gicon', 'notify::icon-name'].map(sig => item.connect(sig, sync));
            const valueId = slider.connect('notify::value', sync);
            this._mirror(row, () => {
                binding.unbind();
                ids.forEach(id => item.disconnect(id));
                slider.disconnect(valueId);
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

    /* Toggles with a submenu (Wi-Fi, Bluetooth, power mode…) go in one big
       card with their status; the rest are small tiles beside it. */
    _buildToggles() {
        const area = new St.BoxLayout({style_class: 'nexnotch-quick-grid', x_expand: true});
        /* top-aligned: the two groups can differ in height and neither should stretch */
        const big = new St.BoxLayout({style_class: 'nexnotch-quick-big', vertical: true, x_expand: true, y_align: Clutter.ActorAlign.START});
        const small = new St.BoxLayout({style_class: 'nexnotch-quick-smalls', vertical: true, x_expand: true, y_align: Clutter.ActorAlign.START});
        const items = this._systemItems().filter(i => i instanceof QuickToggle || i instanceof QuickMenuToggle);
        const withMenu = items.filter(i => i.menu).slice(0, 4);
        const rest = items.filter(i => !withMenu.includes(i));

        let row = null;
        withMenu.forEach((item, i) => {
            if (i % 2 === 0) {
                big.add_child(row = new St.BoxLayout({style_class: 'nexnotch-quick-big-row', x_expand: true}));
                row.layout_manager.homogeneous = true;
            }
            row.add_child(this._bigToggle(item));
        });
        const tiles = rest.map(item => this._smallToggle(item));
        tiles.push(this._layoutTile());
        tiles.forEach((tile, i) => {
            if (i % 2 === 0) {
                small.add_child(row = new St.BoxLayout({style_class: 'nexnotch-quick-small-row', x_expand: true}));
                row.layout_manager.homogeneous = true;
            }
            row.add_child(tile);
        });
        if (withMenu.length) area.add_child(big);
        area.add_child(small);
        return area;
    }

    /* Toggle-mode items (Night Light, Do Not Disturb) flip their own
       `checked` on a real click and bind the setting to it, so a bare
       'clicked' does nothing for them; others act on 'clicked'. */
    _activate(item) {
        if (item.toggle_mode) item.checked = !item.checked;
        item.emit('clicked', 1);
    }

    _watch(item, actor, sync) {
        sync();
        const ids = ['notify::checked', 'notify::gicon', 'notify::icon-name', 'notify::title', 'notify::subtitle', 'notify::menu-enabled']
            .map(sig => item.connect(sig, sync));
        this._mirror(actor, () => ids.forEach(id => item.disconnect(id)));
    }

    _bigToggle(item) {
        const box = new St.BoxLayout({style_class: 'nexnotch-quick-big-item', x_expand: true});
        const icon = new St.Icon({style_class: 'nexnotch-quick-big-icon'});
        const disc = new St.Button({style_class: 'nexnotch-quick-disc', child: icon, can_focus: true, y_align: Clutter.ActorAlign.CENTER});
        disc.connect('clicked', () => this._activate(item));
        const text = new St.BoxLayout({vertical: true, x_expand: true});
        const title = new St.Label({style_class: 'nexnotch-quick-big-title'});
        const sub = new St.Label({style_class: 'nexnotch-quick-big-sub'});
        title.clutter_text.ellipsize = sub.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        text.add_child(title);
        text.add_child(sub);
        /* the circle toggles; the label and chevron open the item's list */
        const labelBox = new St.BoxLayout({x_expand: true});
        labelBox.add_child(text);
        const chevron = new St.Icon({icon_name: 'go-next-symbolic', style_class: 'nexnotch-quick-chevron', y_align: Clutter.ActorAlign.CENTER});
        labelBox.add_child(chevron);
        const label = new St.Button({style_class: 'nexnotch-quick-big-label', child: labelBox, x_expand: true, can_focus: true,
            y_align: Clutter.ActorAlign.CENTER});
        label.connect('clicked', () => {
            if (item.menu && item.menuEnabled !== false) this.openSubmenu(item);
            else this._activate(item);
        });
        box.add_child(disc);
        box.add_child(label);
        this._watch(item, box, () => {
            this._syncIcon(icon, item);
            title.text = item.title ?? '';
            sub.text = item.subtitle || (item.checked ? 'On' : 'Off');
            disc.accessible_name = item.title ?? '';
            label.accessible_name = `${item.title ?? ''} options`;
            chevron.visible = !!item.menu && item.menuEnabled !== false;
            if (item.checked) disc.add_style_pseudo_class('checked');
            else disc.remove_style_pseudo_class('checked');
        });
        return box;
    }

    _smallToggle(item) {
        const icon = new St.Icon({style_class: 'nexnotch-quick-small-icon', x_align: Clutter.ActorAlign.START});
        const title = new St.Label({style_class: 'nexnotch-quick-small-title'});
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        const col = new St.BoxLayout({vertical: true, x_expand: true, y_expand: true});
        col.add_child(icon);
        col.add_child(new St.Widget({y_expand: true}));
        col.add_child(title);
        const btn = new St.Button({style_class: 'nexnotch-quick-small', child: col, can_focus: true, x_expand: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE});   // right-click opens a submenu if any
        btn.connect('clicked', (_b, button) => {
            if (button === Clutter.BUTTON_SECONDARY && item.menu && item.menuEnabled !== false) this.openSubmenu(item);
            else if (button !== Clutter.BUTTON_SECONDARY) this._activate(item);
        });
        this._watch(item, btn, () => {
            this._syncIcon(icon, item);
            title.text = item.title ?? '';
            btn.accessible_name = item.title ?? '';
            if (item.checked) btn.add_style_pseudo_class('checked');
            else btn.remove_style_pseudo_class('checked');
        });
        return btn;
    }

    _layoutTile() {
        const col = new St.BoxLayout({vertical: true, x_expand: true, y_expand: true});
        col.add_child(new St.Icon({icon_name: 'input-keyboard-symbolic', style_class: 'nexnotch-quick-small-icon', x_align: Clutter.ActorAlign.START}));
        col.add_child(new St.Widget({y_expand: true}));
        col.add_child(new St.Label({text: `Layout · ${this._kbLayout || '—'}`, style_class: 'nexnotch-quick-small-title'}));
        return new St.Bin({style_class: 'nexnotch-quick-small', child: col, x_expand: true});
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

    /* Show the item's own submenu (Wi-Fi networks, Bluetooth devices, power
       modes, output) inside the Quick tab. Its box is borrowed from GNOME's
       hidden menu and handed back on close. The menu is marked open so Wi-Fi
       scans, and picking an item closes it like in GNOME. */
    openSubmenu(item) {
        if (!item?.menu) return;
        this.closeSubmenu();
        const menu = item.menu;
        menu.isOpen = true;
        menu.emit('open-state-changed', true);
        const closedId = menu.connect('open-state-changed', (_m, open) => {
            if (!open) { this.closeSubmenu(); this.emit('updated'); this.emit('submenu-closed'); }
        });
        this._submenu = {item, closedId};
        this.emit('show-submenu');
    }

    closeSubmenu() {
        const s = this._submenu;
        if (!s) return;
        this._submenu = null;
        const menu = s.item.menu;
        menu.disconnect(s.closedId);
        menu.box.get_parent()?.remove_child(menu.box);
        menu.actor.add_child(menu.box);
        if (menu.isOpen) { menu.isOpen = false; menu.emit('open-state-changed', false); }
    }

    _buildSubmenu() {
        const {box} = this._submenu.item.menu;
        const view = new St.BoxLayout({style_class: 'nexnotch-quick-submenu', vertical: true, x_expand: true});
        const back = new St.Button({
            style_class: 'nexnotch-quick-back', can_focus: true, accessible_name: 'Back',
            x_align: Clutter.ActorAlign.START,
            child: new St.Icon({icon_name: 'go-previous-symbolic', style_class: 'nexnotch-quick-back-icon'}),
        });
        back.connect('clicked', () => { this.closeSubmenu(); this.emit('updated'); this.emit('submenu-closed'); });
        view.add_child(back);
        const holder = new St.Bin({x_expand: true});
        box.get_parent()?.remove_child(box);
        box.opacity = 255;   // GNOME's close() leaves it faded out
        holder.set_child(box);
        view.add_child(holder);
        // take the box out before the holder's destroy would take it along
        this._mirror(holder, () => { if (box.get_parent() === holder) holder.remove_child(box); });
        return view;
    }

    /* the volume slider, whose submenu picks the audio output */
    outputSlider() {
        return Main.panel.statusArea.quickSettings?._volumeOutput?.quickSettingsItems?.[0] ?? null;
    }

    /* No subprocesses here: forking the shell stalls it ~9 ms per spawn.
       Mic and camera come from GNOME's own privacy indicators, device
       batteries from UPower over D-Bus. */
    async _refresh() {
        try {
            const qs = Main.panel.statusArea.quickSettings;
            this._mic = !!qs?._volumeInput?._indicator?.visible;
            this._cam = !!qs?._camera?._indicator?.visible;
            this._btDevices = await this._btBatteries();
            this._kbLayout  = this._currentLayout();
            this.emit('updated');
        } catch (e) { logError(e, 'nexnotch:quick:refresh'); }
    }

    async _btBatteries() {
        const call = (path, iface, method, args, type) => new Promise((resolve, reject) => {
            Gio.DBus.system.call('org.freedesktop.UPower', path, iface, method, args,
                new GLib.VariantType(type), Gio.DBusCallFlags.NONE, 2000, null, (conn, res) => {
                    try { resolve(conn.call_finish(res).deepUnpack()[0]); } catch (e) { reject(e); }
                });
        });
        try {
            const paths = await call('/org/freedesktop/UPower', 'org.freedesktop.UPower', 'EnumerateDevices', null, '(ao)');
            const all = await Promise.all(paths.map(path => call(path, 'org.freedesktop.DBus.Properties', 'GetAll',
                new GLib.Variant('(s)', ['org.freedesktop.UPower.Device']), '(a{sv})')));
            return all
                .map(p => ({type: p.Type?.unpack(), model: p.Model?.unpack()?.trim(), pct: p.Percentage?.unpack()}))
                .filter(d => d.type !== 1 && d.model && Number.isFinite(d.pct))   // 1 = line power
                .map(({model, pct}) => ({model, pct: Math.round(pct)}));
        } catch (_) { return []; }
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
        const box = new St.BoxLayout({style_class: 'nexnotch-quick', vertical: true, x_expand: true});

        this._dropMirrors(); // the previous render's widgets are gone
        if (this._submenu) {
            box.add_child(this._buildSubmenu());
            return box;
        }
        box.add_child(this._buildSliders());
        box.add_child(this._buildToggles());

        const chips = new St.BoxLayout({style_class: 'nexnotch-quick-chips', x_align: Clutter.ActorAlign.CENTER});
        chips.add_child(this._pill(this._mic ? 'Mic in use' : 'Mic off', this._mic ? 'audio-input-microphone-symbolic' : 'microphone-disabled-symbolic', this._mic));
        chips.add_child(this._pill(this._cam ? 'Camera in use' : 'Camera off', this._cam ? 'camera-web-symbolic' : 'camera-disabled-symbolic', this._cam));
        for (const d of this._btDevices) {
            const p = this._pill(`${d.model} · ${d.pct}%`, 'battery-symbolic', false);
            p.add_style_class_name(d.pct < 20 ? 'low' : 'device');
            chips.add_child(p);
        }
        box.add_child(chips);

        const actions = new St.BoxLayout({style_class: 'nexnotch-quick-actions', x_align: Clutter.ActorAlign.CENTER});
        /* Lock and Suspend are safe one-click; Log out / Reboot / Shutdown
           require a second confirmation click within 3 s (button turns red
           and shows a check mark) so accidental taps don't kill work. */
        actions.add_child(this._actionButton('Lock',    'system-lock-screen-symbolic', () => this._run(['loginctl', 'lock-session'])));
        actions.add_child(this._actionButton('Suspend', 'weather-clear-night-symbolic', () => this._run(['systemctl', 'suspend'])));
        actions.add_child(this._armedActionButton('Log out',  'system-log-out-symbolic',  ['gnome-session-quit', '--logout', '--no-prompt']));
        actions.add_child(this._armedActionButton('Reboot',   'system-reboot-symbolic',   ['systemctl', 'reboot']));
        const off = this._armedActionButton('Shutdown', 'system-shutdown-symbolic', ['systemctl', 'poweroff']);
        off.add_style_class_name('danger');
        actions.add_child(off);
        box.add_child(actions);
        return box;
    }

    _pill(text, iconName, active) {
        const p = new St.BoxLayout({style_class: 'nexnotch-quick-chip' + (active ? ' active' : '')});
        p.add_child(new St.Icon({icon_name: iconName, style_class: 'nexnotch-quick-chip-icon', y_align: Clutter.ActorAlign.CENTER}));
        p.add_child(new St.Label({text, y_align: Clutter.ActorAlign.CENTER}));
        return p;
    }

    _actionButton(label, iconName, cb) {
        const b = new St.Button({
            style_class: 'nexnotch-quick-power',
            child: new St.Icon({icon_name: iconName, style_class: 'nexnotch-quick-power-icon'}),
            accessible_name: label,
            can_focus: true,
        });
        b.connect('clicked', cb);
        return b;
    }

    _armedActionButton(label, iconName, argv) {
        const icon = new St.Icon({icon_name: iconName, style_class: 'nexnotch-quick-power-icon'});
        const b = new St.Button({
            style_class: 'nexnotch-quick-power',
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
