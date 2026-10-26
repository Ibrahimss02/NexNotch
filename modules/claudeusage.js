import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import {Ring} from './ui.js';
import Soup from 'gi://Soup?version=3.0';

/* Reads the local Claude Code CLI's own OAuth token (the same one the
   `claude` binary already holds) and asks Anthropic's usage endpoint how
   much of the current session/weekly quota has been used. This is the
   same undocumented-but-first-party endpoint the `claude` CLI itself
   queries — no credentials are read from or sent to anywhere other than
   api.anthropic.com, and nothing is written back. If the CLI has never
   logged in (or the token can't be refreshed), we just show "unavailable"
   rather than trying to perform an OAuth flow ourselves. */
const CREDENTIALS_PATH = GLib.build_filenamev([GLib.get_home_dir(), '.claude', '.credentials.json']);
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

export const ClaudeUsage = GObject.registerClass({
    Signals: {
        'updated': {},
    },
}, class ClaudeUsage extends GObject.Object {
    _init(settings) {
        super._init();
        this._settings = settings;
        this._soup = new Soup.Session();
        this._soup.set_timeout(10);
        this._data = null;
        this._lastError = null;
        this._timer = 0;
        this._cancellable = new Gio.Cancellable();
    }

    start() {
        this._fetch();
        this._restartTimer();
        this._settingsSig = this._settings.connect('changed::claude-usage-refresh', () => this._restartTimer());
    }

    _restartTimer() {
        if (this._timer) { GLib.source_remove(this._timer); this._timer = 0; }
        const minutes = Math.max(1, this._settings.get_int('claude-usage-refresh'));
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, minutes * 60, () => {
            this._fetch();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stop() {
        if (this._cancellable) { try { this._cancellable.cancel(); } catch (_) {} }
        this._cancellable = new Gio.Cancellable();
        if (this._timer) { GLib.source_remove(this._timer); this._timer = 0; }
        if (this._settingsSig) { this._settings.disconnect(this._settingsSig); this._settingsSig = 0; }
    }

    destroy() { this.stop(); }

    _readToken() {
        try {
            const [ok, bytes] = GLib.file_get_contents(CREDENTIALS_PATH);
            if (!ok) return null;
            const json = JSON.parse(new TextDecoder().decode(bytes));
            return json?.claudeAiOauth?.accessToken ?? null;
        } catch (_) {
            return null;
        }
    }

    _fetch() {
        const token = this._readToken();
        if (!token) {
            this._lastError = 'No Claude Code login found (run `claude` once to sign in)';
            this.emit('updated');
            return;
        }
        const msg = Soup.Message.new('GET', USAGE_URL);
        msg.request_headers.append('Authorization', `Bearer ${token}`);
        msg.request_headers.append('anthropic-version', '2023-06-01');
        this._soup.send_and_read_async(msg, GLib.PRIORITY_LOW, this._cancellable, (session, res) => {
            if (this._cancellable?.is_cancelled()) return;
            try {
                const bytes = session.send_and_read_finish(res);
                const text = new TextDecoder().decode(bytes.get_data());
                if (msg.status_code < 200 || msg.status_code >= 300) {
                    this._lastError = `Usage check failed (${msg.status_code}) — try running \`claude\` to refresh your session`;
                    this.emit('updated');
                    return;
                }
                this._data = JSON.parse(text);
                this._lastError = null;
                this.emit('updated');
            } catch (e) {
                this._lastError = String(e?.message ?? e);
                logError(e, 'nexnotch:claudeusage');
                this.emit('updated');
            }
        });
    }

    render() {
        const box = new St.BoxLayout({style_class: 'nexnotch-claude', vertical: true, x_expand: true});
        if (!this._data) {
            const msg = new St.BoxLayout({style_class: 'nexnotch-card nexnotch-claude-msg', vertical: true, x_expand: true});
            msg.add_child(new St.Label({text: this._lastError ? 'Claude usage unavailable' : 'Loading Claude usage…',
                style_class: 'nexnotch-section-title', x_align: Clutter.ActorAlign.CENTER}));
            if (this._lastError) msg.add_child(new St.Label({text: this._lastError, style_class: 'nexnotch-muted', x_align: Clutter.ActorAlign.CENTER}));
            box.add_child(msg);
            if (this._lastError) box.add_child(this._refreshRow());
            return box;
        }
        const cards = new St.BoxLayout({style_class: 'nexnotch-claude-cards', x_expand: true});
        cards.layout_manager.homogeneous = true;
        const {five_hour: fiveHour, seven_day: sevenDay} = this._data;
        if (fiveHour) cards.add_child(this._ring('Session', '5-hour window', fiveHour.utilization, fiveHour.resets_at, ['#FF9F0A', '#3A2A0E']));
        if (sevenDay) cards.add_child(this._ring('Weekly', 'All models', sevenDay.utilization, sevenDay.resets_at, ['#0A84FF', '#0B2A4D']));
        box.add_child(cards);
        box.add_child(this._refreshRow());
        return box;
    }

    _refreshRow() {
        const row = new St.BoxLayout({style_class: 'nexnotch-claude-footer', x_expand: true});
        const minutes = Math.max(1, this._settings.get_int('claude-usage-refresh'));
        row.add_child(new St.Label({text: `Auto-refreshes every ${minutes} min`, style_class: 'nexnotch-claude-footer-label',
            x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        const box = new St.BoxLayout({style_class: 'nexnotch-pill-btn-box'});
        box.add_child(new St.Icon({icon_name: 'view-refresh-symbolic', style_class: 'nexnotch-pill-btn-icon', y_align: Clutter.ActorAlign.CENTER}));
        const label = new St.Label({text: 'Refresh', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(label);
        const btn = new St.Button({style_class: 'nexnotch-pill-btn', child: box, can_focus: true});
        btn.connect('clicked', () => { label.text = 'Refreshing…'; this._fetch(); });
        row.add_child(btn);
        return row;
    }

    _ring(title, subtitle, pct, resetsAt, [color, track]) {
        pct = Math.max(0, Math.min(100, pct ?? 0));
        if (pct > 90) [color, track] = ['#FF453A', '#3A1210'];
        const card = new St.BoxLayout({style_class: 'nexnotch-claude-card', x_expand: true});
        const wrap = new St.Widget({layout_manager: new Clutter.BinLayout(), width: 86, height: 86, y_align: Clutter.ActorAlign.CENTER});
        wrap.add_child(new Ring({size: 86, thickness: 10, track, color, frac: pct / 100, accessibleName: `${title} ${pct.toFixed(0)}% used`}));
        wrap.add_child(new St.Label({text: `${pct.toFixed(0)}%`, style_class: 'nexnotch-claude-pct',
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
        card.add_child(wrap);
        const text = new St.BoxLayout({vertical: true, style_class: 'nexnotch-claude-text', y_align: Clutter.ActorAlign.CENTER});
        text.add_child(new St.Label({text: title, style_class: 'nexnotch-claude-title'}));
        text.add_child(new St.Label({text: subtitle, style_class: 'nexnotch-muted'}));
        if (resetsAt) {
            const d = new Date(resetsAt);
            const sameDay = d.toDateString() === new Date().toDateString();
            const time = d.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
            const when = sameDay ? time : `${d.toLocaleDateString([], {weekday: 'short'})} ${d.getDate()} ${d.toLocaleDateString([], {month: 'short'})}, ${time}`;
            text.add_child(new St.Label({text: `Resets ${when}`, style_class: 'nexnotch-claude-reset', style: `color: ${color};`}));
        }
        card.add_child(text);
        return card;
    }

});
