import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Notch} from './notch.js';

const EAR_PX = 13;   // radius of the concave top corners

export default class NexNotchExtension extends Extension {
    enable() {
        this._settings = this.getSettings('org.gnome.shell.extensions.nexnotch');

        /* Evolution Data Server's source-registry D-Bus service sometimes
           doesn't auto-activate on login; when that happens Calendar and
           Tasks come up empty. If the binary is discoverable via $PATH or
           the standard libexec prefixes, kick it once — idempotent. This
           replaces the previous hard-coded /usr/libexec/... path so the
           extension stays portable across distros. */
        try {
            const candidates = [
                GLib.find_program_in_path('evolution-source-registry'),
                '/usr/libexec/evolution-source-registry',
                '/usr/lib/evolution-data-server/evolution-source-registry',
                '/usr/lib64/evolution-data-server/evolution-source-registry',
            ].filter(p => p && GLib.file_test(p, GLib.FileTest.IS_EXECUTABLE));
            if (candidates.length) {
                Gio.Subprocess.new([candidates[0]],
                    Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
            }
        } catch (_) {}

        this._notch = new Notch(this);

        /* Mount the notch into the top chrome layer — OUTSIDE the panel's
           actor tree. This keeps any Shell.BlurEffect that blur-my-shell
           attaches to the panel from bleeding through the notch. */
        Main.layoutManager.addTopChrome(this._notch, {
            trackFullscreen: true,
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
            Main.layoutManager.addTopChrome(ear, {trackFullscreen: true, affectsStruts: false});
            return ear;
        });
        this._earColorId = this._settings.connect('changed::bg-color', () => this._ears.forEach(e => e.queue_repaint()));

        this._reposition = () => this._positionNotch();
        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', this._reposition);
        this._panelAllocId = Main.panel.connect('notify::allocation', this._reposition);
        this._notchAllocId = this._notch.connect('notify::width', this._reposition);
        this._positionNotch();

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
        const y = monitor.y;
        this._notch.set_position(x, y);
        this._ears?.[0].set_position(x - EAR_PX, y);
        this._ears?.[1].set_position(x + w, y);
        this._strut?.set_position(monitor.x, monitor.y);
        this._strut?.set_size(monitor.width, this._settings.get_int('collapsed-height'));
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
