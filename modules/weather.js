import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup?version=3.0';

export const Weather = GObject.registerClass({
    Signals: {
        'updated': {},
    },
}, class Weather extends GObject.Object {
    _init(settings) {
        super._init();
        this._settings = settings;
        this._soup = new Soup.Session();
        this._soup.set_timeout(10);
        this._data = null;
        this._data2 = null;
        this._active = 1;
        this._timer = 0;
        this._lastFetch = 0;
        this._cancellable = new Gio.Cancellable();
    }

    start() {
        this._fetchAll();
        this._restartTimer();
        this._settingsSig  = this._settings.connect('changed::weather-location',   () => this._fetchAll());
        this._settingsSig2 = this._settings.connect('changed::weather-unit',       () => this._fetchAll());
        this._settingsSig3 = this._settings.connect('changed::weather-location-2', () => this._fetchAll());
        this._settingsSig4 = this._settings.connect('changed::weather-refresh',    () => this._restartTimer());
    }

    _fetchAll() {
        this._fetch(1);
        const loc2 = this._settings.get_string('weather-location-2');
        if (loc2 && loc2.trim()) this._fetch(2);
        else {
            this._data2 = null;
            /* If secondary was selected but just removed, fall back to primary */
            if (this._active === 2) this._active = 1;
            this.emit('updated');
        }
    }

    _restartTimer() {
        if (this._timer) { GLib.source_remove(this._timer); this._timer = 0; }
        const minutes = Math.max(1, this._settings.get_int('weather-refresh'));
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, minutes * 60, () => {
            this._fetchAll();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stop() {
        if (this._cancellable) { try { this._cancellable.cancel(); } catch (_) {} }
        this._cancellable = new Gio.Cancellable();
        if (this._timer) { GLib.source_remove(this._timer); this._timer = 0; }
        if (this._settingsSig)  { this._settings.disconnect(this._settingsSig);  this._settingsSig = 0; }
        if (this._settingsSig2) { this._settings.disconnect(this._settingsSig2); this._settingsSig2 = 0; }
        if (this._settingsSig3) { this._settings.disconnect(this._settingsSig3); this._settingsSig3 = 0; }
        if (this._settingsSig4) { this._settings.disconnect(this._settingsSig4); this._settingsSig4 = 0; }
    }

    destroy() { this.stop(); }

    _fetch(slot) {
        const key = slot === 2 ? 'weather-location-2' : 'weather-location';
        const loc  = this._settings.get_string(key) || '';
        const unit = this._settings.get_string('weather-unit') === 'imperial' ? 'u' : 'm';
        const url  = `https://wttr.in/${encodeURIComponent(loc)}?format=j1`;
        const msg  = Soup.Message.new('GET', url);
        msg.request_headers.append('User-Agent', 'nexnotch/0.1');
        this._soup.send_and_read_async(msg, GLib.PRIORITY_LOW, this._cancellable, (session, res) => {
            if (this._cancellable?.is_cancelled()) return;
            try {
                const bytes = session.send_and_read_finish(res);
                const text = new TextDecoder().decode(bytes.get_data());
                if (msg.status_code < 200 || msg.status_code >= 300) {
                    this._lastError = `wttr.in ${msg.status_code}`;
                    this.emit('updated');
                    return;
                }
                let data;
                try { data = JSON.parse(text); }
                catch (_) {
                    this._lastError = 'wttr.in returned non-JSON (rate-limited?)';
                    this.emit('updated');
                    return;
                }
                data._unit = unit;
                if (slot === 2) this._data2 = data;
                else            this._data  = data;
                this._lastError = null;
                this._lastFetch = Date.now();
                this.emit('updated');
            } catch (e) {
                this._lastError = String(e?.message ?? e);
                logError(e, 'nexnotch:weather');
                this.emit('updated');
            }
        });
    }

    render() {
        const box = new St.BoxLayout({style_class: 'nexnotch-weather', vertical: true, x_expand: true});
        const message = (title, sub) => {
            const card = new St.BoxLayout({style_class: 'nexnotch-card nexnotch-weather-msg', vertical: true, x_expand: true});
            card.add_child(new St.Label({text: title, style_class: 'nexnotch-section-title', x_align: Clutter.ActorAlign.CENTER}));
            if (sub) card.add_child(new St.Label({text: sub, style_class: 'nexnotch-muted', x_align: Clutter.ActorAlign.CENTER}));
            box.add_child(card);
            return box;
        };
        if (this._lastError && !this._data && !this._data2) return message('Weather unavailable', this._lastError);

        /* location switcher if two configured */
        const loc2 = this._settings.get_string('weather-location-2');
        if (loc2 && loc2.trim()) {
            const seg = new St.BoxLayout({style_class: 'nexnotch-segmented', x_align: Clutter.ActorAlign.CENTER});
            const lbl1 = this._settings.get_string('weather-location-label') || (this._settings.get_string('weather-location') || 'Primary');
            const lbl2 = this._settings.get_string('weather-location-2-label') || loc2;
            for (const [slot, label] of [[1, lbl1], [2, lbl2]]) {
                const btn = new St.Button({style_class: 'nexnotch-segment', label, can_focus: true});
                if ((this._active ?? 1) === slot) btn.add_style_pseudo_class('checked');
                btn.connect('clicked', () => { this._active = slot; this.emit('updated'); });
                seg.add_child(btn);
            }
            box.add_child(seg);
        }

        const data = this._active === 2 ? this._data2 : this._data;
        if (!data) return message('Loading weather…');

        try {
            const cur  = data.current_condition?.[0];
            const area = data.nearest_area?.[0]?.areaName?.[0]?.value ?? '—';
            const days = (data.weather ?? []).slice(0, 3);
            const f    = (data._unit ?? 'm') === 'u';
            const deg  = (c, fh) => `${f ? fh : c}°`;

            const top = new St.BoxLayout({style_class: 'nexnotch-weather-top', x_expand: true});
            const hero = new St.BoxLayout({style_class: 'nexnotch-card nexnotch-weather-hero', vertical: true, x_expand: true});
            const heroHead = new St.BoxLayout({x_expand: true});
            const place = new St.BoxLayout({vertical: true, x_expand: true});
            const name = new St.BoxLayout({style_class: 'nexnotch-weather-place'});
            name.add_child(new St.Label({text: area, style_class: 'nexnotch-section-title'}));
            name.add_child(new St.Icon({icon_name: 'find-location-symbolic', style_class: 'nexnotch-weather-pin', y_align: Clutter.ActorAlign.CENTER}));
            place.add_child(name);
            place.add_child(new St.Label({text: cur.weatherDesc?.[0]?.value ?? '', style_class: 'nexnotch-muted'}));
            heroHead.add_child(place);
            heroHead.add_child(new St.Icon({icon_name: this._icon(cur.weatherCode), style_class: 'nexnotch-weather-icon'}));
            hero.add_child(heroHead);
            const heroFoot = new St.BoxLayout({x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.END});
            heroFoot.add_child(new St.Label({text: deg(cur.temp_C, cur.temp_F), style_class: 'nexnotch-weather-temp', x_expand: true}));
            if (days[0]) heroFoot.add_child(new St.Label({text: `H:${deg(days[0].maxtempC, days[0].maxtempF)}  L:${deg(days[0].mintempC, days[0].mintempF)}`,
                style_class: 'nexnotch-weather-hl', y_align: Clutter.ActorAlign.END}));
            hero.add_child(heroFoot);
            top.add_child(hero);

            const tiles = new St.BoxLayout({style_class: 'nexnotch-weather-tiles', vertical: true});
            const uv = Number(cur.uvIndex);
            const uvWord = uv <= 2 ? 'Low' : uv <= 5 ? 'Moderate' : uv <= 7 ? 'High' : uv <= 10 ? 'Very high' : 'Extreme';
            const cells = [
                ['FEELS LIKE', deg(cur.FeelsLikeC, cur.FeelsLikeF), ''],
                ['HUMIDITY', `${cur.humidity}%`, ''],
                ['WIND', f ? cur.windspeedMiles : cur.windspeedKmph, f ? 'mph' : 'km/h'],
                ['UV INDEX', String(cur.uvIndex), uvWord],
            ];
            for (let i = 0; i < 4; i += 2) {
                const row = new St.BoxLayout({style_class: 'nexnotch-weather-tile-row'});
                row.layout_manager.homogeneous = true;
                for (const [label, value, unit] of cells.slice(i, i + 2)) row.add_child(this._metaCell(label, value, unit));
                tiles.add_child(row);
            }
            top.add_child(tiles);
            box.add_child(top);

            if (days.length) {
                const lo = Math.min(...days.map(d => Number(f ? d.mintempF : d.mintempC)));
                const hi = Math.max(...days.map(d => Number(f ? d.maxtempF : d.maxtempC)));
                const list = new St.BoxLayout({style_class: 'nexnotch-card nexnotch-weather-days', vertical: true, x_expand: true});
                days.forEach((d, i) => {
                    const row = new St.BoxLayout({style_class: `nexnotch-weather-day${i === days.length - 1 ? ' last' : ''}`, x_expand: true});
                    row.add_child(new St.Label({text: i === 0 ? 'Today' : new Date(d.date).toLocaleDateString([], {weekday: 'short'}),
                        style_class: 'nexnotch-weather-day-name', y_align: Clutter.ActorAlign.CENTER}));
                    const code = d.hourly?.[4]?.weatherCode;
                    row.add_child(new St.Icon({icon_name: this._icon(code), style_class: 'nexnotch-weather-day-icon', y_align: Clutter.ActorAlign.CENTER}));
                    const min = Number(f ? d.mintempF : d.mintempC), max = Number(f ? d.maxtempF : d.maxtempC);
                    row.add_child(new St.Label({text: `${min}°`, style_class: 'nexnotch-weather-day-min', y_align: Clutter.ActorAlign.CENTER}));
                    const now = i === 0 ? Number(f ? cur.temp_F : cur.temp_C) : null;
                    row.add_child(this._rangeBar(lo, hi, min, max, now));
                    row.add_child(new St.Label({text: `${max}°`, style_class: 'nexnotch-weather-day-max', y_align: Clutter.ActorAlign.CENTER}));
                    list.add_child(row);
                });
                box.add_child(list);
            }
        } catch (e) {
            logError(e, 'nexnotch:weather:render');
            return message('Weather data malformed');
        }
        return box;
    }

    _metaCell(label, value, unit) {
        const c = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'nexnotch-weather-tile'});
        c.add_child(new St.Label({text: label, style_class: 'nexnotch-weather-tile-label'}));
        const v = new St.BoxLayout({style_class: 'nexnotch-weather-tile-value-box'});
        v.add_child(new St.Label({text: `${value}`, style_class: 'nexnotch-weather-tile-value'}));
        if (unit) v.add_child(new St.Label({text: unit, style_class: 'nexnotch-weather-tile-unit', y_align: Clutter.ActorAlign.END}));
        c.add_child(v);
        return c;
    }

    /* wttr.in weather codes → icon names */
    _icon(code) {
        const c = Number(code);
        if (c === 113) return 'weather-clear-symbolic';
        if (c === 116) return 'weather-few-clouds-symbolic';
        if ([143, 248, 260].includes(c)) return 'weather-fog-symbolic';
        if ([200, 386, 389, 392, 395].includes(c)) return 'weather-storm-symbolic';
        if ([179, 182, 185, 227, 230, 317, 320, 323, 326, 329, 332, 335, 338, 350, 362, 365, 368, 371, 374, 377].includes(c)) return 'weather-snow-symbolic';
        if ([176, 263, 266, 281, 284, 293, 296, 353].includes(c)) return 'weather-showers-scattered-symbolic';
        if ([299, 302, 305, 308, 311, 314, 356, 359].includes(c)) return 'weather-showers-symbolic';
        return 'weather-overcast-symbolic';
    }

    /* the day's low..high on the week's scale; a dot marks the current temperature */
    _rangeBar(lo, hi, min, max, now) {
        const area = new St.DrawingArea({style_class: 'nexnotch-weather-range', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        area.connect('repaint', () => {
            const cr = area.get_context();
            const [w, h] = area.get_surface_size();
            const span = Math.max(1, hi - lo), r = 2.5, y = h / 2;
            const x = t => r + (w - 2 * r) * ((t - lo) / span);
            const pill = (x0, x1, rr) => {
                cr.newSubPath();
                cr.arc(x0, y, rr, Math.PI / 2, 1.5 * Math.PI);
                cr.arc(x1, y, rr, -Math.PI / 2, Math.PI / 2);
                cr.closePath();
            };
            cr.setSourceRGBA(0.17, 0.17, 0.18, 1);
            pill(r, w - r, r);
            cr.fill();
            cr.setSourceRGBA(1, 0.62, 0.04, 1);
            pill(x(min), Math.max(x(min), x(max)), r);
            cr.fill();
            if (now !== null) {
                cr.setSourceRGBA(0.11, 0.11, 0.12, 1);
                cr.arc(x(Math.min(hi, Math.max(lo, now))), y, 6.5, 0, 2 * Math.PI);
                cr.fill();
                cr.setSourceRGBA(1, 1, 1, 1);
                cr.arc(x(Math.min(hi, Math.max(lo, now))), y, 4.5, 0, 2 * Math.PI);
                cr.fill();
            }
            cr.$dispose();
        });
        return area;
    }
});
