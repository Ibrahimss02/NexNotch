import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

/* Small drawn widgets shared by the pill, the peeks and the tabs. */

/* St.BoxLayout's `vertical` was replaced by `orientation` in GNOME 48 and
   removed in 51; spread this into a vertical box's params. */
export const VERTICAL = (() => {
    try {
        new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL}).destroy();
        return {orientation: Clutter.Orientation.VERTICAL};
    } catch (_) {
        return {vertical: true};
    }
})();

const rgba = hex => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
};

function roundRect(cr, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    cr.newSubPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}

/* iOS-style battery: grey outline, fill by level. Drawn on a 24×12 grid. */
export const BatteryGlyph = GObject.registerClass(
class BatteryGlyph extends St.DrawingArea {
    _init() {
        super._init({style_class: 'nexnotch-battery-glyph', y_align: Clutter.ActorAlign.CENTER});
        this._level = 1;
        this._color = '#30D158';
    }

    set(level, color) {
        this._level = Math.max(0, Math.min(1, level));
        this._color = color;
        this.queue_repaint();
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        cr.scale(w / 24, h / 12);
        cr.setLineWidth(1.5);
        cr.setSourceRGBA(0.56, 0.56, 0.58, 1);
        roundRect(cr, 0.75, 0.75, 20, 10.5, 3);
        cr.stroke();
        roundRect(cr, 22, 4, 1.6, 4, 0.8);
        cr.fill();
        if (this._level > 0) {
            cr.setSourceRGBA(...rgba(this._color), 1);
            roundRect(cr, 2.5, 2.5, Math.max(1.6, 16.5 * this._level), 7, 1.6);
            cr.fill();
        }
        cr.$dispose();
    }
});

/* Animated level bars for "something is playing". Only scale_y moves, so
   it costs a transform per frame, and the actor-bound timeline stops while
   the bars aren't on screen. */
export const Waveform = GObject.registerClass(
class Waveform extends St.BoxLayout {
    _init(bars = 4, styleClass = 'nexnotch-wave') {
        super._init({style_class: styleClass, y_align: Clutter.ActorAlign.CENTER, accessible_name: 'Playing'});
        this._bars = Array.from({length: bars}, () => {
            const bar = new St.Widget({style_class: 'nexnotch-wave-bar', y_expand: true});
            bar.set_pivot_point(0.5, 0.5);
            this.add_child(bar);
            return bar;
        });
        this._offsets = [0.1, 0.5, 0.3, 0.7, 0.2, 0.6];
        this._timeline = new Clutter.Timeline({actor: this, duration: 900, repeat_count: -1});
        this.connect('destroy', () => this._timeline.stop());
        this._timeline.connect('new-frame', () => {
            const p = this._timeline.get_progress();
            this._bars.forEach((bar, i) => {
                bar.scale_y = 0.35 + 0.65 * (0.5 - 0.5 * Math.cos(2 * Math.PI * (p + this._offsets[i % 6])));
            });
        });
        this.setPlaying(false);
    }

    setColor(hex) {
        this._bars.forEach(bar => bar.set_style(`background-color: ${hex};`));
    }

    setPlaying(on) {
        if (on) {
            this._timeline.start();
            this.opacity = 255;
        } else {
            this._timeline.stop();
            this._bars.forEach(bar => (bar.scale_y = 0.35));
            this.opacity = 150;
        }
    }
});

/* Progress ring: track circle plus a round-capped arc from 12 o'clock. */
export const Ring = GObject.registerClass(
class Ring extends St.DrawingArea {
    _init({size, thickness, track = '#2C2C2E', color = '#0A84FF', frac = 0, accessibleName = ''}) {
        super._init({width: size, height: size, accessible_name: accessibleName});
        this._p = {thickness, track, color, frac};
    }

    set(frac, color = this._p.color) {
        this._p.frac = frac;
        this._p.color = color;
        this.queue_repaint();
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        const {thickness, track, color, frac} = this._p;
        const t = thickness * (w / this.width || 1);
        const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - t / 2;
        cr.setLineWidth(t);
        cr.setSourceRGBA(...rgba(track), 1);
        cr.arc(cx, cy, r, 0, 2 * Math.PI);
        cr.stroke();
        if (frac > 0) {
            cr.setLineCap(1);   // round
            cr.setSourceRGBA(...rgba(color), 1);
            cr.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.min(1, frac) * 2 * Math.PI);
            cr.stroke();
        }
        cr.$dispose();
    }
});
