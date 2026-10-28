import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import {Switch} from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Ring, VERTICAL} from './ui.js';

const LOG_FILE = GLib.build_filenamev([GLib.get_user_data_dir(), 'nexnotch', 'water.json']);
const CHART_HOURS = 11;

/* our own glass-of-water icon: icon themes have no water/cup symbol */
export const CUP_ICON = Gio.FileIcon.new(
    Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('icons').get_child('water-cup.svg'));

/* Drink-water reminder: every `water-interval` minutes 'due' fires and the
   countdown restarts straight away; drinking restarts it too. Today's cups
   (one timestamp each) are kept in ~/.local/share/nexnotch/water.json. Monotonic time stops during
   suspend, so the countdown pauses with the laptop. */
export const WaterReminder = GObject.registerClass({
    Signals: {
        'level': {param_types: [GObject.TYPE_DOUBLE]},   // countdown left, 1 → 0
        'due': {},
        'changed': {},                                   // drinks or settings changed
    },
}, class WaterReminder extends GObject.Object {
    _init(settings) {
        super._init();
        this._settings = settings;
        this._log = this._load();
        this._startedAt = GLib.get_monotonic_time();
        this._settingsId = settings.connect('changed', (_s, key) => {
            if (key.startsWith('water-') || key === 'show-water') this.emit('changed');
        });
    }

    start() {
        this.stop();
        this._startedAt = GLib.get_monotonic_time();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 5, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
        this._intervalId = this._settings.connect('changed::water-interval', () => this.start());
    }

    stop() {
        if (this._timer) { GLib.source_remove(this._timer); this._timer = 0; }
        if (this._intervalId) { this._settings.disconnect(this._intervalId); this._intervalId = 0; }
    }

    destroy() {
        this.stop();
        if (this._settingsId) { this._settings.disconnect(this._settingsId); this._settingsId = 0; }
    }

    level() {
        if (!this._timer) return 1;
        const total = Math.max(1, this._settings.get_int('water-interval')) * 60 * 1e6;
        return Math.max(0, 1 - (GLib.get_monotonic_time() - this._startedAt) / total);
    }

    _tick() {
        const left = this.level();
        if (left > 0) { this.emit('level', left); return; }
        this._startedAt = GLib.get_monotonic_time();
        this.emit('level', 1);
        this.emit('due');
    }

    drink() {
        this._today().drinks.push(Math.floor(Date.now() / 1000));
        this._save();
        if (this._timer) this._startedAt = GLib.get_monotonic_time();
        this.emit('level', this.level());
        this.emit('changed');
    }

    cups() {
        return this._today().drinks.length;
    }

    /* cups per hour for the last CHART_HOURS hours, oldest first: [{hour, cups}] */
    hourly() {
        const now = new Date();
        const hours = Array.from({length: CHART_HOURS}, (_, i) => {
            const d = new Date(now);
            d.setHours(now.getHours() - (CHART_HOURS - 1 - i), 0, 0, 0);
            return {start: d.getTime() / 1000, hour: d.getHours(), cups: 0};
        });
        for (const t of this._today().drinks) {
            const h = hours.find(x => t >= x.start && t < x.start + 3600);
            if (h) h.cups++;
        }
        return hours;
    }

    _today() {
        const date = GLib.DateTime.new_now_local().format('%F');
        if (this._log.date !== date) this._log = {date, drinks: []};
        return this._log;
    }

    _load() {
        try {
            const [ok, bytes] = GLib.file_get_contents(LOG_FILE);
            if (ok) return JSON.parse(new TextDecoder().decode(bytes));
        } catch (_) {}
        return {date: '', drinks: []};
    }

    _save() {
        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(LOG_FILE), 0o700);
            const bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(this._log)));
            Gio.File.new_for_path(LOG_FILE).replace_contents_bytes_async(bytes, null, false,
                Gio.FileCreateFlags.NONE, null, (f, res) => {
                    try { f.replace_contents_finish(res); } catch (e) { logError(e, 'nexnotch:water:save'); }
                });
        } catch (e) { logError(e, 'nexnotch:water:save'); }
    }

    /* The Water tab. onSettings opens the preferences. */
    render({onSettings}) {
        const goal = Math.max(1, this._settings.get_int('water-goal'));
        const cups = this.cups();
        const on = this._settings.get_boolean('show-water');
        const plural = n => `${n} cup${n === 1 ? '' : 's'}`;

        const page = new St.BoxLayout({style_class: 'nexnotch-water', x_expand: true});
        const main = new St.BoxLayout({style_class: 'nexnotch-card nexnotch-water-main', ...VERTICAL, x_expand: true});
        page.add_child(main);

        const top = new St.BoxLayout({style_class: 'nexnotch-water-top'});
        const wrap = new St.Widget({layout_manager: new Clutter.BinLayout(), width: 97, height: 97});
        wrap.add_child(new Ring({size: 97, thickness: 11, track: '#0B3340', color: '#64D2FF', frac: cups / goal,
            accessibleName: `${cups} of ${goal} cups`}));
        const count = new St.BoxLayout({...VERTICAL, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        count.add_child(new St.Label({text: String(cups), style_class: 'nexnotch-water-count', x_align: Clutter.ActorAlign.CENTER}));
        count.add_child(new St.Label({text: `of ${plural(goal)}`, style_class: 'nexnotch-water-of', x_align: Clutter.ActorAlign.CENTER}));
        wrap.add_child(count);
        top.add_child(wrap);

        const side = new St.BoxLayout({...VERTICAL, style_class: 'nexnotch-water-side', y_align: Clutter.ActorAlign.CENTER});
        side.add_child(new St.Label({text: 'Water', style_class: 'nexnotch-section-title'}));
        side.add_child(new St.Label({text: cups >= goal ? 'Goal reached today' : `${plural(goal - cups)} to go today`, style_class: 'nexnotch-muted'}));
        const btns = new St.BoxLayout({style_class: 'nexnotch-water-btns'});
        const drinkBox = new St.BoxLayout({style_class: 'nexnotch-pill-btn-box'});
        drinkBox.add_child(new St.Icon({icon_name: 'list-add-symbolic', style_class: 'nexnotch-water-drink-icon', y_align: Clutter.ActorAlign.CENTER}));
        drinkBox.add_child(new St.Label({text: 'Drink', y_align: Clutter.ActorAlign.CENTER}));
        const drink = new St.Button({style_class: 'nexnotch-water-drink', child: drinkBox, can_focus: true, accessible_name: 'Log a cup of water'});
        drink.connect('clicked', () => this.drink());
        btns.add_child(drink);
        const settings = new St.Button({style_class: 'nexnotch-water-settings', child: new St.Icon({icon_name: 'emblem-system-symbolic'}),
            can_focus: true, accessible_name: 'Water settings'});
        settings.connect('clicked', () => onSettings());
        btns.add_child(settings);
        side.add_child(btns);
        top.add_child(side);
        main.add_child(top);

        const reminders = new St.BoxLayout({style_class: 'nexnotch-water-reminders', x_expand: true});
        const label = new St.BoxLayout({...VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        label.add_child(new St.Label({text: 'Reminders', style_class: 'nexnotch-water-reminders-title'}));
        if (on) {
            const mins = Math.max(1, Math.ceil(this.level() * this._settings.get_int('water-interval')));
            label.add_child(new St.Label({text: `Next in ${mins} min`, style_class: 'nexnotch-water-next'}));
        }
        reminders.add_child(label);
        const toggle = new St.Button({style_class: 'nexnotch-water-toggle', child: new Switch(on), can_focus: true,
            accessible_name: 'Drink-water reminders', y_align: Clutter.ActorAlign.CENTER});
        toggle.connect('clicked', () => this._settings.set_boolean('show-water', !on));
        reminders.add_child(toggle);
        main.add_child(reminders);

        page.add_child(this._buildChart(cups));
        return page;
    }

    _buildChart(cups) {
        const data = this.hourly();
        const peak = Math.max(4, Math.ceil(Math.max(...data.map(d => d.cups)) / 2) * 2);
        const chart = new St.BoxLayout({style_class: 'nexnotch-card nexnotch-water-chart', ...VERTICAL});
        const head = new St.BoxLayout({x_expand: true});
        head.add_child(new St.Label({text: 'TODAY', style_class: 'nexnotch-caps', x_expand: true}));
        head.add_child(new St.Label({text: cups ? `${cups} cup${cups === 1 ? '' : 's'} logged` : 'Nothing logged yet', style_class: 'nexnotch-water-chart-status'}));
        chart.add_child(head);
        const body = new St.BoxLayout({style_class: 'nexnotch-water-chart-body'});
        const bars = new St.DrawingArea({style_class: 'nexnotch-water-bars', x_expand: true});
        bars.connect('repaint', () => this._paintBars(bars, data, peak));
        body.add_child(bars);
        const axis = new St.BoxLayout({style_class: 'nexnotch-water-axis', ...VERTICAL});
        axis.add_child(new St.Label({text: String(peak), y_expand: true, y_align: Clutter.ActorAlign.START}));
        axis.add_child(new St.Label({text: String(peak / 2), y_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        axis.add_child(new St.Label({text: '0', y_expand: true, y_align: Clutter.ActorAlign.END}));
        body.add_child(axis);
        chart.add_child(body);
        const hours = new St.BoxLayout({style_class: 'nexnotch-water-hours'});
        hours.layout_manager.homogeneous = true;
        data.forEach((d, i) => hours.add_child(new St.Label({text: i % 3 === 0 ? String(d.hour).padStart(2, '0') : ''})));
        const row = new St.BoxLayout();
        row.add_child(hours);
        hours.x_expand = true;
        row.add_child(new St.Widget({style_class: 'nexnotch-water-axis-gap'}));
        chart.add_child(row);
        return chart;
    }

    _paintBars(area, data, peak) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const gap = 5, bw = (w - gap * (data.length - 1)) / data.length, r = 4;
        const rect = (x, y, height) => {
            const rr = Math.min(r, height / 2, bw / 2);
            cr.newSubPath();
            cr.arc(x + bw - rr, y + rr, rr, -Math.PI / 2, 0);
            cr.arc(x + bw - rr, y + height - rr, rr, 0, Math.PI / 2);
            cr.arc(x + rr, y + height - rr, rr, Math.PI / 2, Math.PI);
            cr.arc(x + rr, y + rr, rr, Math.PI, 1.5 * Math.PI);
            cr.closePath();
        };
        data.forEach((d, i) => {
            const x = i * (bw + gap);
            cr.setSourceRGBA(0.15, 0.15, 0.16, 1);
            rect(x, 0, h);
            cr.fill();
            if (d.cups > 0) {
                const bh = Math.max(2 * r, h * Math.min(1, d.cups / peak));
                cr.setSourceRGBA(0.39, 0.82, 1, 1);
                rect(x, h - bh, bh);
                cr.fill();
            }
        });
        cr.$dispose();
    }

});
