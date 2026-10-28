import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Notch} from './notch.js';

const EAR_PX = 13;   // radius of the concave top corners
const ISLAND_GAP = 8;     // how far below the edge the notch floats over a window
const SETTLE_MS = 1500;   // until the strut applies, maximized windows still reach the top

export default class NexNotchExtension extends Extension {
    enable() {
        this._settings = this.getSettings('org.gnome.shell.extensions.nexnotch');

        this._notch = new Notch(this);

        /* Mount the notch into the top chrome layer — OUTSIDE the panel's
           actor tree. This keeps any Shell.BlurEffect that blur-my-shell
           attaches to the panel from bleeding through the notch. */
        /* fullscreen windows are handled in _syncCover: the notch still has
           to peek and open over them */
        Main.layoutManager.addTopChrome(this._notch, {
            trackFullscreen: false,
            affectsStruts: false,
        });

        /* Invisible full-width strip as tall as the collapsed notch, so
           maximized windows stop below it. Kept separate from the notch,
           whose height changes on expand. */
        this._strut = new St.Widget({reactive: false});
        Main.layoutManager.addChrome(this._strut, {
            trackFullscreen: true,
            affectsStruts: true,
        });

        /* Concave corners either side of the notch's top edge, so it flows
           out of the screen edge instead of starting with a hard step. */
        this._ears = [false, true].map(right => {
            const ear = new St.DrawingArea({width: EAR_PX, height: EAR_PX});
            ear.connect('repaint', () => this._paintEar(ear, right));
            Main.layoutManager.addTopChrome(ear, {trackFullscreen: false, affectsStruts: false});
            return ear;
        });
        this._earColorId = this._settings.connect('changed::bg-color', () => this._ears.forEach(e => e.queue_repaint()));

        this._reposition = () => this._positionNotch();
        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', this._reposition);
        this._panelAllocId = Main.panel.connect('notify::allocation', this._reposition);
        this._notchAllocId = this._notch.connect('notify::width', this._reposition);
        this._settings.connectObject(
            'changed::reserve-space', this._reposition,
            'changed::collapsed-height', this._reposition,
            'changed::island-when-covered', () => this._queueCover(),
            this);
        this._positionNotch();
        this._watchWindows();

        /* Volume / brightness OSDs for the primary monitor go to the notch;
           GNOME's own OSD stays for other monitors and as the fallback. */
        const osd = Main.osdWindowManager;
        const original = osd._showOsdWindow;
        osd._showOsdWindow = (monitorIndex, icon, label, level, maxLevel) => {
            if (monitorIndex === Main.layoutManager.primaryIndex &&
                this._notch?.showOsd(icon, label, level, maxLevel)) {
                osd._osdWindows[monitorIndex]?.cancel();
                return;
            }
            original.call(osd, monitorIndex, icon, label, level, maxLevel);
        };

        this._notch.start();
    }

    _positionNotch() {
        if (!this._notch) return;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;
        const w = this._notch.width || 240;
        const x = monitor.x + Math.floor((monitor.width - w) / 2);
        const y = monitor.y + (this._notch._covered ? ISLAND_GAP : 0);
        this._notch.set_position(x, y);
        this._ears?.[0].set_position(x - EAR_PX, monitor.y);
        this._ears?.[1].set_position(x + w, monitor.y);
        this._ears?.forEach(e => (e.visible = !this._notch._covered && this._notch.visible));
        this._strut?.set_position(monitor.x, monitor.y);
        this._strut?.set_size(monitor.width,
            this._settings.get_boolean('reserve-space') ? this._settings.get_int('collapsed-height') : 0);
    }

    /* Windows reaching up under the notch's centre on the primary monitor:
       with island-when-covered the notch floats over them, hidden at rest;
       without it, it just steps aside for fullscreen ones as before. */
    _watchWindows() {
        const track = win => win.connectObject(
            'position-changed', () => this._queueCover(),
            'size-changed', () => this._queueCover(),
            'notify::minimized', () => this._queueCover(),
            'notify::fullscreen', () => this._queueCover(),
            'workspace-changed', () => this._queueCover(),
            'unmanaged', () => this._queueCover(),
            this);
        global.get_window_actors().forEach(a => track(a.meta_window));
        global.display.connectObject('window-created', (_d, win) => { track(win); this._queueCover(); }, this);
        global.workspace_manager.connectObject('active-workspace-changed', () => this._queueCover(), this);
        this._settleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_MS, () => {
            this._settleId = 0;
            this._settled = true;
            this._syncCover();
            return GLib.SOURCE_REMOVE;
        });
    }

    _queueCover() {
        if (this._coverIdle || !this._settled) return;
        this._coverIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._coverIdle = 0;
            this._syncCover();
            return GLib.SOURCE_REMOVE;
        });
    }

    _syncCover() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!this._notch || !monitor) return;
        const ws = global.workspace_manager.get_active_workspace();
        const cx = monitor.x + monitor.width / 2;
        const reach = this._settings.get_int('collapsed-height');
        const reaching = global.get_window_actors().map(a => a.meta_window).filter(w => {
            if (w.get_window_type() !== Meta.WindowType.NORMAL || w.minimized || !w.located_on_workspace(ws) ||
                w.get_monitor() !== monitor.index) return false;
            const r = w.get_frame_rect();
            return r.x <= cx && r.x + r.width >= cx && (w.is_fullscreen() || r.y - monitor.y < reach);
        });
        const island = this._settings.get_boolean('island-when-covered');
        this._notch.setCovered(island && reaching.length > 0);
        this._notch.visible = island || !reaching.some(w => w.is_fullscreen());
        this._positionNotch();
    }

    _paintEar(area, right) {
        const cr = area.get_context();
        const r = EAR_PX;
        const bg = this._settings.get_string('bg-color');   // same fallback as the notch: non-rgb() is black
        const [red, green, blue, alpha = 1] = /^rgba?\(/.test(bg) ? bg.match(/[\d.]+/g).map(Number) : [0, 0, 0];
        cr.setSourceRGBA(red / 255, green / 255, blue / 255, alpha);
        if (right) {
            cr.moveTo(r, 0);
            cr.lineTo(0, 0);
            cr.lineTo(0, r);
            cr.arc(r, r, r, Math.PI, 1.5 * Math.PI);
        } else {
            cr.moveTo(0, 0);
            cr.lineTo(r, 0);
            cr.lineTo(r, r);
            cr.arcNegative(0, r, r, 0, -0.5 * Math.PI);
        }
        cr.fill();
        cr.$dispose();
    }

    disable() {
        delete Main.osdWindowManager._showOsdWindow;   // back to the prototype method
        if (this._settleId) { GLib.source_remove(this._settleId); this._settleId = 0; }
        if (this._coverIdle) { GLib.source_remove(this._coverIdle); this._coverIdle = 0; }
        this._settled = false;
        global.display.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);
        global.get_window_actors().forEach(a => a.meta_window.disconnectObject(this));
        this._settings.disconnectObject(this);
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }
        if (this._panelAllocId) {
            try { Main.panel.disconnect(this._panelAllocId); } catch (_) {}
            this._panelAllocId = 0;
        }
        if (this._notchAllocId) {
            try { this._notch?.disconnect(this._notchAllocId); } catch (_) {}
            this._notchAllocId = 0;
        }
        if (this._notch) {
            this._notch.stop();
            try { Main.layoutManager.removeChrome(this._notch); } catch (_) {}
            this._notch.destroy();
            this._notch = null;
        }
        this._strut?.destroy();
        this._strut = null;
        if (this._earColorId) { this._settings.disconnect(this._earColorId); this._earColorId = 0; }
        this._ears?.forEach(e => e.destroy());
        this._ears = null;
        this._reposition = null;
        this._settings = null;
    }
}
