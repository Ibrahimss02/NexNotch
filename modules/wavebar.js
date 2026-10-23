import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

const WAVELENGTH = 22;   // px per wave
const AMPLITUDE  = 3;    // px while playing; flattens to 0 when paused
const FRAME_MS   = 33;

/* Android-style squiggly seek bar: the played part is an animated sine
   wave, the rest a flat dim line, with a vertical thumb. Click or drag to
   seek. Between position polls the thumb advances on its own while playing,
   so it glides instead of jumping once a second. */
export const WaveBar = GObject.registerClass({
    Signals: {
        'scrub': {param_types: [GObject.TYPE_DOUBLE]},   // dragging, 0..1
        'seek':  {param_types: [GObject.TYPE_DOUBLE]},   // released, 0..1
    },
}, class WaveBar extends St.DrawingArea {
    _init() {
        super._init({style_class: 'nexnotch-wave', reactive: true, x_expand: true, track_hover: true});
        this._pos = 0;          // µs at _stamp
        this._len = 0;          // µs
        this._stamp = 0;        // monotonic µs when _pos was set
        this._playing = false;
        this._amp = 0;
        this._phase = 0;
        this._dragValue = null;
        this._timer = 0;

        this.connect('repaint', () => this._paint());
        this.connect('button-press-event', (_a, event) => {
            if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
            this._grab = global.stage.grab(this);
            this._scrubTo(event);
            return Clutter.EVENT_STOP;
        });
        this.connect('motion-event', (_a, event) => {
            if (this._dragValue === null) return Clutter.EVENT_PROPAGATE;
            this._scrubTo(event);
            return Clutter.EVENT_STOP;
        });
        this.connect('button-release-event', () => {
            if (this._dragValue === null) return Clutter.EVENT_PROPAGATE;
            this._grab?.dismiss();
            this._grab = null;
            const v = this._dragValue;
            this._dragValue = null;
            this.emit('seek', v);
            return Clutter.EVENT_STOP;
        });
        this.connect('destroy', () => {
            this._grab?.dismiss();
            this._stopTimer();
        });
    }

    setProgress(posUs, lenUs, playing) {
        this._pos = posUs;
        this._len = lenUs;
        this._stamp = GLib.get_monotonic_time();
        this._playing = playing;
        this._ensureTimer();
        this.queue_repaint();
    }

    get value() {
        if (this._dragValue !== null) return this._dragValue;
        if (!this._len) return 0;
        const pos = this._pos + (this._playing ? GLib.get_monotonic_time() - this._stamp : 0);
        return Math.max(0, Math.min(1, pos / this._len));
    }

    _scrubTo(event) {
        const [x, y] = event.get_coords();
        const [ok, lx] = this.transform_stage_point(x, y);
        if (!ok) return;
        const pad = this._pad();
        this._dragValue = Math.max(0, Math.min(1, (lx - pad) / Math.max(1, this.width - 2 * pad)));
        this.emit('scrub', this._dragValue);
        this.queue_repaint();
    }

    _pad() { return 6; }

    /* animate while playing, or until a pause has flattened the wave */
    _ensureTimer() {
        if (this._timer) return;
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FRAME_MS, () => {
            const target = this._playing ? AMPLITUDE : 0;
            this._amp += (target - this._amp) * 0.2;
            if (Math.abs(target - this._amp) < 0.05) this._amp = target;
            if (this._playing) this._phase += 0.22;
            this.queue_repaint();
            if (!this._playing && this._amp === 0) { this._timer = 0; return GLib.SOURCE_REMOVE; }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopTimer() {
        if (this._timer) { GLib.source_remove(this._timer); this._timer = 0; }
    }

    _paint() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        const pad = this._pad();
        const mid = h / 2;
        const x0 = pad, x1 = w - pad;
        const xv = x0 + (x1 - x0) * this.value;

        cr.setLineCap(1); // Cairo.LineCap.ROUND
        cr.setLineWidth(3);

        /* remaining: flat and dim */
        cr.setSourceRGBA(1, 1, 1, 0.25);
        cr.moveTo(xv, mid);
        cr.lineTo(x1, mid);
        cr.stroke();

        /* played: travelling sine wave */
        cr.setSourceRGBA(1, 1, 1, 0.95);
        const k = 2 * Math.PI / WAVELENGTH;
        cr.moveTo(x0, mid + this._amp * Math.sin(-this._phase));
        for (let x = x0 + 1; x <= xv; x++)
            cr.lineTo(x, mid + this._amp * Math.sin(k * (x - x0) - this._phase));
        cr.stroke();

        /* thumb */
        cr.setLineWidth(4);
        cr.moveTo(xv, mid - 7);
        cr.lineTo(xv, mid + 7);
        cr.stroke();

        cr.$dispose();
    }
});
