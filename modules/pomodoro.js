import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import {Ring} from './ui.js';
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

const LOG_DIR  = GLib.build_filenamev([GLib.get_user_data_dir(), 'nexnotch']);
const LOG_FILE = GLib.build_filenamev([LOG_DIR, 'pomodoro.jsonl']);

function _appendSession(entry) {
    try {
        GLib.mkdir_with_parents(LOG_DIR, 0o755);
        const line = JSON.stringify(entry) + '\n';
        const file = Gio.File.new_for_path(LOG_FILE);
        const stream = file.append_to(Gio.FileCreateFlags.NONE, null);
        stream.write_all(line, null);
        stream.close(null);
    } catch (e) { logError(e, 'nexnotch:pomodoro:log'); }
}

export function readSessions() {
    try {
        const [ok, bytes] = GLib.file_get_contents(LOG_FILE);
        if (!ok) return [];
        const text = new TextDecoder().decode(bytes);
        return text.split('\n').filter(Boolean).map(l => {
            try { return JSON.parse(l); } catch (_) { return null; }
        }).filter(Boolean);
    } catch (_) { return []; }
}

export const Pomodoro = GObject.registerClass({
    Signals: {
        'tick':  {},
        'state': {param_types: [GObject.TYPE_STRING]},
    },
}, class Pomodoro extends GObject.Object {
    _init(settings) {
        super._init();
        this._settings = settings;
        this._state  = 'idle';       // idle | work | break | longbreak | paused
        this._prev   = null;
        this._remain = 0;
        this._cycle  = 0;
        this._timer  = 0;
    }

    start() {}
    stop() { if (this._timer) { GLib.source_remove(this._timer); this._timer = 0; } }
    destroy() { this.stop(); }

    _activePreset() {
        const s = this._settings.get_string('pomodoro-active-preset') || '25/5';
        const m = s.match(/^(\d+)\s*\/\s*(\d+)/);
        if (!m) return {work: 25, brk: 5};
        return {work: Number(m[1]), brk: Number(m[2])};
    }

    startWork() {
        const {work} = this._activePreset();
        this._state  = 'work';
        this._remain = work * 60;
        this._cycle++;
        this._run();
    }

    startBreak() {
        const cycles = this._settings.get_int('pomodoro-cycles');
        const isLong = this._cycle > 0 && this._cycle % cycles === 0;
        const {brk} = this._activePreset();
        this._state  = isLong ? 'longbreak' : 'break';
        this._remain = isLong
            ? this._settings.get_int('pomodoro-long') * 60
            : brk * 60;
        this._run();
    }

    pause() {
        if (this._timer) { GLib.source_remove(this._timer); this._timer = 0; }
        this._prev  = this._state;
        this._state = 'paused';
        this.emit('state', this._state);
    }

    resume() {
        if (this._prev) {
            this._state = this._prev;
            this._prev = null;
            /* keep the original _startedAt — we're continuing, not restarting */
            this.emit('state', this._state);
            this.emit('tick');
            if (this._timer) GLib.source_remove(this._timer);
            this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 1, () => {
                this._remain--;
                if (this._remain <= 0) { this._timer = 0; this._onComplete(); return GLib.SOURCE_REMOVE; }
                this.emit('tick');
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    reset() {
        if (this._timer) { GLib.source_remove(this._timer); this._timer = 0; }
        /* Log the aborted session with completed=false so the dashboard can
           distinguish finished from skipped pomodoros. */
        if (this._startedAt && (this._state === 'work' || this._state === 'break' || this._state === 'longbreak')) {
            this._logCompleted(false);
        }
        this._state  = 'idle';
        this._remain = 0;
        this._cycle  = 0;
        this._startedAt = null;
        this.emit('state', this._state);
    }

    _run() {
        this._startedAt = new Date();
        this.emit('state', this._state);
        this.emit('tick');
        if (this._timer) GLib.source_remove(this._timer);
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 1, () => {
            this._remain--;
            if (this._remain <= 0) {
                this._timer = 0;
                this._onComplete();
                return GLib.SOURCE_REMOVE;
            }
            this.emit('tick');
            return GLib.SOURCE_CONTINUE;
        });
    }

    _onComplete() {
        const wasWork = this._state === 'work';
        this._logCompleted(true);
        this._notify(wasWork ? 'Work cycle complete' : 'Break over',
                     wasWork ? 'Time for a break!' : 'Back to work.');
        if (wasWork) this.startBreak();
        else         this.startWork();
    }

    _logCompleted(completed) {
        if (!this._startedAt) return;
        const {work, brk} = this._activePreset();
        const longMin = this._settings.get_int('pomodoro-long');
        let plannedSec;
        if      (this._state === 'work')      plannedSec = work * 60;
        else if (this._state === 'longbreak') plannedSec = longMin * 60;
        else                                  plannedSec = brk * 60;
        const endedAt = new Date();
        _appendSession({
            started_at: this._startedAt.toISOString(),
            ended_at:   endedAt.toISOString(),
            kind:       this._state,
            preset:     this._settings.get_string('pomodoro-active-preset'),
            duration_sec: Math.round((endedAt - this._startedAt) / 1000),
            planned_sec:  plannedSec,
            completed,
        });
        /* guard against double-logging if reset fires after _onComplete has
           already consumed this session but before the new startWork/startBreak
           assigns a fresh _startedAt */
        this._startedAt = null;
    }

    _notify(title, body) {
        try {
            const source = MessageTray.getSystemSource?.() ?? Main.messageTray.getSources()?.[0];
            const notif = new MessageTray.Notification({
                source, title, body,
                isTransient: true,
            });
            source.addNotification(notif);
        } catch (_) {
            try {
                const ns = GLib.find_program_in_path('notify-send');
                if (!ns) return;
                Gio.Subprocess.new([ns, '-u', 'normal', title, body],
                    Gio.SubprocessFlags.STDERR_SILENCE);
            } catch (e) { logError(e, 'nexnotch:pomodoro:notify'); }
        }
    }

    adjustMinutes(delta) {
        if (this._state === 'idle') return;
        this._remain = Math.max(1, this._remain + delta * 60);
        this.emit('tick');
    }

    isActive() { return this._state !== 'idle' && this._state !== 'paused'; }
    getState() { return this._state; }
    getRemain() { return this._remain; }

    formatRemain() {
        const m = Math.floor(this._remain / 60);
        const s = this._remain % 60;
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    render() {
        const box = new St.BoxLayout({style_class: 'nexnotch-pomo', vertical: true, x_expand: true});
        const {work, brk} = this._activePreset();

        const seg = new St.BoxLayout({style_class: 'nexnotch-segmented', x_align: Clutter.ActorAlign.CENTER, accessible_name: 'Focus / break length'});
        const activePreset = this._settings.get_string('pomodoro-active-preset');
        for (const p of this._settings.get_strv('pomodoro-presets')) {
            const btn = new St.Button({style_class: 'nexnotch-segment', label: p.replace('/', ' / '), can_focus: true});
            if (p === activePreset) btn.add_style_pseudo_class('checked');
            btn.connect('clicked', () => {
                this._settings.set_string('pomodoro-active-preset', p);
                if (this._state !== 'idle') this.reset();
                this.emit('state', this._state);
            });
            seg.add_child(btn);
        }
        box.add_child(seg);

        const main = new St.BoxLayout({style_class: 'nexnotch-pomo-main', x_align: Clutter.ActorAlign.CENTER});
        const round = (label, cls, cb) => {
            const b = new St.Button({style_class: `nexnotch-pomo-round ${cls}`, label, can_focus: true, y_align: Clutter.ActorAlign.CENTER});
            b.connect('clicked', cb);
            return b;
        };
        main.add_child(round('Reset', '', () => this.reset()));

        const resting = this._state === 'break' || this._state === 'longbreak' ||
            (this._state === 'paused' && (this._prev === 'break' || this._prev === 'longbreak'));
        const total = this._totalForState() || work * 60;
        const frac = this._state === 'idle' ? 1 : Math.max(0, Math.min(1, this._remain / total));
        const wrap = new St.Widget({layout_manager: new Clutter.BinLayout(), width: 189, height: 189});
        wrap.add_child(new Ring({size: 189, thickness: 7, track: '#2C2C2E', color: resting ? '#30D158' : '#FF9F0A', frac,
            accessibleName: `${this._stateLabel()}, ${this.formatRemain()}`}));
        const center = new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        center.add_child(new St.Label({text: this._state === 'idle' ? `${String(work).padStart(2, '0')}:00` : this.formatRemain(),
            style_class: 'nexnotch-pomo-big', x_align: Clutter.ActorAlign.CENTER}));
        center.add_child(new St.Label({text: this._state === 'idle' ? 'Focus' : this._stateLabel(),
            style_class: 'nexnotch-pomo-state', x_align: Clutter.ActorAlign.CENTER}));
        wrap.add_child(center);
        main.add_child(wrap);

        if (this._state === 'idle') main.add_child(round('Start', 'go', () => this.startWork()));
        else if (this._state === 'paused') main.add_child(round('Resume', 'go', () => this.resume()));
        else main.add_child(round('Pause', 'hold', () => this.pause()));
        box.add_child(main);

        const foot = new St.BoxLayout({style_class: 'nexnotch-pomo-foot', x_align: Clutter.ActorAlign.CENTER});
        const cycles = Math.max(1, this._settings.get_int('pomodoro-cycles'));
        const done = this._cycle % cycles || (this._cycle && this._state !== 'work' ? cycles : 0);
        for (let i = 0; i < cycles; i++) {
            const dot = new St.Widget({style_class: 'nexnotch-pomo-dot', y_align: Clutter.ActorAlign.CENTER});
            if (i < done) dot.add_style_pseudo_class('checked');
            foot.add_child(dot);
        }
        foot.add_child(new St.Label({text: `Cycle ${this._cycle} of ${cycles} · ${work} min focus, ${brk} min break`,
            style_class: 'nexnotch-pomo-cycles', y_align: Clutter.ActorAlign.CENTER}));
        if (this._state !== 'idle') {
            for (const [label, delta, name] of [['−1m', -1, 'Subtract one minute'], ['+1m', 1, 'Add one minute']]) {
                const b = new St.Button({style_class: 'nexnotch-pill-btn small', label, accessible_name: name, can_focus: true});
                b.connect('clicked', () => this.adjustMinutes(delta));
                foot.add_child(b);
            }
        }
        box.add_child(foot);
        return box;
    }

    _totalForState() {
        const {work, brk} = this._activePreset();
        if (this._state === 'work')      return work * 60;
        if (this._state === 'longbreak') return this._settings.get_int('pomodoro-long') * 60;
        if (this._state === 'break')     return brk * 60;
        return 0;
    }

    _stateLabel() {
        return {
            idle:      'Ready',
            work:      'Focus',
            break:     'Short break',
            longbreak: 'Long break',
            paused:    'Paused',
        }[this._state] ?? this._state;
    }
});
