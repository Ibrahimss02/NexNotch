import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Notch} from './notch.js';

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
            /* Not trackFullscreen: with the top bar hidden, a maximized
               self-decorated window (Firefox) covers the whole monitor and
               GNOME's legacy heuristic calls that "fullscreen", hiding the
               notch. _syncFullscreen only reacts to real fullscreen. */
            trackFullscreen: false,
            affectsStruts: false,
            // GNOME 50 dropped affectsInputRegion; chrome always takes input now
        });
        this._fullscreenSync = () => this._syncFullscreen();
        global.display.connectObject(
            'in-fullscreen-changed', this._fullscreenSync,
            'notify::focus-window', this._fullscreenSync, this);
        Main.overview.connectObject(
            'showing', this._fullscreenSync,
            'hidden', this._fullscreenSync, this);

        this._reposition = () => this._positionNotch();
        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', this._reposition);
        this._panelAllocId = Main.panel.connect('notify::allocation', this._reposition);
        this._notchAllocId = this._notch.connect('notify::allocation', this._reposition);
        this._positionNotch();
        this._syncFullscreen();

        /* Notch-only top, toggled live by `hide-top-bar`. The panel keeps its
           Quick Settings items alive for the notch's Quick tab to mirror. */
        this._topBarSigId = this._settings.connect('changed::hide-top-bar', () => this._syncTopBar());
        this._panelHeightId = Main.layoutManager.panelBox.connect('notify::height', () => this._syncTopBar());
        this._syncTopBar();

        this._notch.start();
    }

    /* Hide the notch only while the focused window on the primary monitor
       is truly fullscreen (video, F11); always show it in the overview. */
    _syncFullscreen() {
        if (!this._notch) return;
        const w = global.display.focus_window;
        const fullscreen = !Main.overview.visible && !!w?.is_fullscreen() &&
            w.get_monitor() === Main.layoutManager.primaryIndex;
        this._notch.visible = !fullscreen;
    }

    /* Same approach as the Hide Top Bar extension: keep the panel at its
       normal size (a 0px-tall panel left a 0px top strut that broke window
       drawing), stop it reserving screen space, and slide it off-screen. */
    _syncTopBar() {
        const box = Main.layoutManager.panelBox;
        const hidden = !!this._settings?.get_boolean('hide-top-bar');
        if (hidden !== !!this._topBarHidden) {
            this._topBarHidden = hidden;
            Main.layoutManager._untrackActor(box);
            Main.layoutManager._trackActor(box, {affectsStruts: !hidden, trackFullscreen: true});
        }
        box.translation_y = hidden ? -box.height : 0;
    }

    _restoreTopBar() {
        if (this._topBarSigId) { this._settings.disconnect(this._topBarSigId); this._topBarSigId = 0; }
        if (this._panelHeightId) { Main.layoutManager.panelBox.disconnect(this._panelHeightId); this._panelHeightId = 0; }
        if (this._topBarHidden) {
            const box = Main.layoutManager.panelBox;
            Main.layoutManager._untrackActor(box);
            Main.layoutManager._trackActor(box, {affectsStruts: true, trackFullscreen: true});
            box.translation_y = 0;
            this._topBarHidden = false;
        }
    }

    _positionNotch() {
        if (!this._notch) return;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;
        const [, natW] = this._notch.get_preferred_width(-1);
        const [, natH] = this._notch.get_preferred_height(natW);
        const w = natW || this._notch.width || 240;
        const x = monitor.x + Math.floor((monitor.width - w) / 2);
        const y = monitor.y;
        this._notch.set_position(x, y);
    }

    disable() {
        this._restoreTopBar();
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
        global.display.disconnectObject(this);
        Main.overview.disconnectObject(this);
        if (this._notch) {
            this._notch.stop();
            try { Main.layoutManager.removeChrome(this._notch); } catch (_) {}
            this._notch.destroy();
            this._notch = null;
        }
        this._reposition = null;
        this._settings = null;
    }
}
