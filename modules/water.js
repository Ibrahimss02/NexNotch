import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

/* Drink-water reminder: every `water-interval` minutes the cup in the pill
   drains like an hourglass, then 'due' fires and it refills straight away.
   Monotonic time stops during suspend, so the timer pauses with the laptop. */
export const WaterReminder = GObject.registerClass({
    Signals: {
        'level': {param_types: [GObject.TYPE_DOUBLE]},   // water left, 1 → 0
        'due': {},
    },
}, class WaterReminder extends GObject.Object {
    _init(settings) {
        super._init();
        this._settings = settings;
    }

    start() {
        this.stop();
        this._startedAt = GLib.get_monotonic_time();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 5, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
        this._intervalId = this._settings.connect('changed::water-interval', () => this.start());
        this._tick();
    }

    stop() {
        if (this._timer) { GLib.source_remove(this._timer); this._timer = 0; }
        if (this._intervalId) { this._settings.disconnect(this._intervalId); this._intervalId = 0; }
    }

    destroy() { this.stop(); }

    _tick() {
        const total = Math.max(1, this._settings.get_int('water-interval')) * 60 * 1e6;
        const left = 1 - (GLib.get_monotonic_time() - this._startedAt) / total;
        if (left > 0) { this.emit('level', left); return; }
        this._startedAt = GLib.get_monotonic_time();
        this.emit('level', 1);
        this.emit('due');
    }
});

/* A small glass whose water level is setLevel(0..1). */
export const WaterCup = GObject.registerClass(
class WaterCup extends St.DrawingArea {
    _init() {
        super._init({style_class: 'nexnotch-water-cup', y_align: Clutter.ActorAlign.CENTER,
            accessible_name: 'Drink water reminder'});
        this._level = 1;
    }

    setLevel(level) {
        this._level = level;
        this.queue_repaint();
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        const top = 1.5, bottom = h - 1, taper = w * 0.18;
        const glass = () => {
            cr.moveTo(1, top);
            cr.lineTo(w - 1, top);
            cr.lineTo(w - 1 - taper, bottom);
            cr.lineTo(1 + taper, bottom);
            cr.closePath();
        };
        glass();
        cr.save();
        cr.clip();
        cr.setSourceRGBA(0.36, 0.72, 1, 0.95);
        cr.rectangle(0, bottom - (bottom - top) * this._level, w, h);
        cr.fill();
        cr.restore();
        glass();
        cr.setSourceRGBA(1, 1, 1, 0.75);
        cr.setLineWidth(1.2);
        cr.stroke();
        cr.$dispose();
    }
});
