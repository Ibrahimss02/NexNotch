import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup?version=3.0';
import Secret from 'gi://Secret';

/* Reads the Antigravity CLI's (`agy`) own OAuth token from the GNOME keyring
   (service=gemini, username=antigravity) and asks Google's Cloud Code
   endpoint — the same one `agy` uses — how much of each model quota is left.
   The token is only ever sent to cloudcode-pa.googleapis.com, and nothing is
   written back. We never refresh the token ourselves: if it has expired we
   show a hint to open `agy`, which renews it. */
const MODELS_URL = 'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels';
const PROJECT_FILE = GLib.build_filenamev([GLib.get_home_dir(), '.gemini', 'antigravity-cli', 'cache', 'default_project_id.txt']);

const SCHEMA = new Secret.Schema('org.freedesktop.Secret.Generic', Secret.SchemaFlags.DONT_MATCH_NAME, {
    service: Secret.SchemaAttributeType.STRING,
    username: Secret.SchemaAttributeType.STRING,
});

const PROVIDER_NAMES = {
    MODEL_PROVIDER_GOOGLE: 'Gemini',
    MODEL_PROVIDER_ANTHROPIC: 'Claude',
    MODEL_PROVIDER_OPENAI: 'GPT-OSS',
};

export const AntigravityUsage = GObject.registerClass({
    Signals: {
        'updated': {},
    },
}, class AntigravityUsage extends GObject.Object {
    _init(settings) {
        super._init();
        this._settings = settings;
        this._soup = new Soup.Session();
        this._soup.set_timeout(15);
        this._groups = null;
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

    _fail(message) {
        this._lastError = message;
        this.emit('updated');
    }

    _fetch() {
        const cancellable = this._cancellable;
        Secret.password_lookup(SCHEMA, {service: 'gemini', username: 'antigravity'}, cancellable, (_src, res) => {
            if (cancellable.is_cancelled()) return;
            let token;
            try {
                const raw = Secret.password_lookup_finish(res);
                if (!raw) { this._fail('No Antigravity login found (run `agy` once to sign in)'); return; }
                const json = JSON.parse(raw);
                token = json?.token?.access_token;
                const expiry = Date.parse(json?.token?.expiry ?? '');
                if (!token) { this._fail('Antigravity login has no access token'); return; }
                if (expiry && expiry < Date.now() + 30 * 1000) {
                    this._fail('Antigravity login expired — open `agy` for a moment to refresh it');
                    return;
                }
            } catch (e) {
                this._fail(`Could not read Antigravity login: ${e?.message ?? e}`);
                return;
            }
            this._readProject(cancellable, project => this._request(token, project, cancellable));
        });
    }

    _readProject(cancellable, callback) {
        Gio.File.new_for_path(PROJECT_FILE).load_contents_async(cancellable, (file, res) => {
            if (cancellable.is_cancelled()) return;
            let project = null;
            try {
                const [, bytes] = file.load_contents_finish(res);
                project = new TextDecoder().decode(bytes).trim() || null;
            } catch (_) {}
            callback(project);
        });
    }

    _request(token, project, cancellable) {
        const msg = Soup.Message.new('POST', MODELS_URL);
        msg.request_headers.append('Authorization', `Bearer ${token}`);
        msg.request_headers.append('User-Agent', 'antigravity');
        const body = JSON.stringify(project ? {project} : {});
        msg.set_request_body_from_bytes('application/json', new GLib.Bytes(new TextEncoder().encode(body)));
        this._soup.send_and_read_async(msg, GLib.PRIORITY_LOW, cancellable, (session, res) => {
            if (cancellable.is_cancelled()) return;
            try {
                const bytes = session.send_and_read_finish(res);
                if (msg.status_code === 401) {
                    this._fail('Antigravity login expired — open `agy` for a moment to refresh it');
                    return;
                }
                if (msg.status_code < 200 || msg.status_code >= 300) {
                    this._fail(`Quota check failed (${msg.status_code})`);
                    return;
                }
                const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                this._groups = this._groupModels(data?.models ?? {});
                this._lastError = null;
                this.emit('updated');
            } catch (e) {
                logError(e, 'nexnotch:antigravityusage');
                this._fail(String(e?.message ?? e));
            }
        });
    }

    /* Models that share a quota report identical numbers, so one ring per
       (remaining, reset) pair, named after the provider(s) in it. */
    _groupModels(models) {
        const groups = new Map();
        for (const m of Object.values(models)) {
            const q = m?.quotaInfo;
            if (!q) continue;
            // proto3 JSON omits zero values: a quota with no remainingFraction is used up
            const remaining = q.remainingFraction ?? 0;
            const key = `${remaining}|${q.resetTime ?? ''}`;
            if (!groups.has(key))
                groups.set(key, {remaining, resetTime: q.resetTime, providers: new Set(), models: []});
            const g = groups.get(key);
            g.providers.add(PROVIDER_NAMES[m.modelProvider] ?? 'Other');
            g.models.push(m.displayName ?? '');
        }
        return [...groups.values()]
            .map(g => ({...g, label: [...g.providers].join(' + ')}))
            .sort((a, b) => a.label.localeCompare(b.label));
    }

    render() {
        const box = new St.BoxLayout({style_class: 'nexnotch-claude', vertical: true, x_expand: true, y_expand: true});

        if (this._lastError && !this._groups) {
            box.add_child(new St.Label({
                text: 'Antigravity usage unavailable', style_class: 'nexnotch-empty', x_align: Clutter.ActorAlign.CENTER,
            }));
            box.add_child(new St.Label({
                text: this._lastError, style_class: 'nexnotch-empty', x_align: Clutter.ActorAlign.CENTER,
            }));
            box.add_child(this._refreshRow());
            return box;
        }
        if (!this._groups) {
            box.add_child(new St.Label({
                text: 'Loading Antigravity usage…', style_class: 'nexnotch-empty', x_align: Clutter.ActorAlign.CENTER,
            }));
            return box;
        }

        const rings = new St.BoxLayout({style_class: 'nexnotch-claude-rings', x_expand: true, x_align: Clutter.ActorAlign.CENTER});
        for (const g of this._groups)
            rings.add_child(this._ring(g.label, (1 - g.remaining) * 100, g.resetTime));
        box.add_child(rings);
        if (this._lastError) {
            box.add_child(new St.Label({
                text: `Last refresh failed: ${this._lastError}`, style_class: 'nexnotch-claude-reset', x_align: Clutter.ActorAlign.CENTER,
            }));
        }
        box.add_child(this._refreshRow());

        return box;
    }

    _refreshRow() {
        const row = new St.BoxLayout({style_class: 'nexnotch-claude-refresh-row', x_expand: true});
        const minutes = Math.max(1, this._settings.get_int('claude-usage-refresh'));
        row.add_child(new St.Label({
            text: `Auto-refreshes every ${minutes} min`,
            style_class: 'nexnotch-claude-refresh-label',
            x_expand: true,
        }));
        const btn = new St.Button({style_class: 'nexnotch-claude-refresh-btn', label: '↻ Refresh', can_focus: true});
        btn.connect('clicked', () => { btn.label = 'Refreshing…'; this._fetch(); });
        row.add_child(btn);
        return row;
    }

    /* pct is the share USED, so the colours match the Claude tab:
       amber above 70% used, red above 90%. The label shows what is left. */
    _ring(label, pct, resetsAt) {
        pct = Math.max(0, Math.min(100, pct ?? 0));
        const col = new St.BoxLayout({style_class: 'nexnotch-claude-ringcol', vertical: true, x_align: Clutter.ActorAlign.CENTER});

        const SIZE = 72;
        const wrap = new St.Widget({layout_manager: new Clutter.BinLayout(), width: SIZE, height: SIZE});
        const area = new St.DrawingArea({style_class: 'nexnotch-claude-ring', width: SIZE, height: SIZE});
        area.connect('repaint', () => this._paintRing(area, pct, SIZE));
        wrap.add_child(area);

        const pctClass = pct > 90 ? 'danger' : (pct > 70 ? 'warn' : null);
        const pctLabel = new St.Label({
            text: `${(100 - pct).toFixed(0)}%`,
            style_class: 'nexnotch-claude-ring-pct',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        if (pctClass) pctLabel.add_style_class_name(pctClass);
        wrap.add_child(pctLabel);

        col.add_child(wrap);
        col.add_child(new St.Label({text: `${label} left`, style_class: 'nexnotch-claude-label', x_align: Clutter.ActorAlign.CENTER}));

        if (resetsAt) {
            try {
                const d = new Date(resetsAt);
                col.add_child(new St.Label({
                    text: `Resets ${d.toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}`,
                    style_class: 'nexnotch-claude-reset',
                    x_align: Clutter.ActorAlign.CENTER,
                }));
            } catch (_) {}
        }

        return col;
    }

    _paintRing(area, pct, size) {
        const cr = area.get_context();
        const thick = 6;
        const cx = size / 2, cy = size / 2, r = size / 2 - thick / 2;

        cr.setLineWidth(thick);
        try { cr.setLineCap(1); } catch (_) {} // 1 = Cairo.LineCap.ROUND

        /* track */
        cr.setSourceRGBA(1, 1, 1, 0.12);
        cr.arc(cx, cy, r, 0, 2 * Math.PI);
        cr.stroke();

        /* remaining arc, starting at 12 o'clock, clockwise */
        const frac = (100 - pct) / 100;
        if (frac > 0) {
            let color;
            if (pct > 90)      color = [1, 0.4, 0.35];
            else if (pct > 70) color = [1, 0.75, 0.3];
            else               color = [0.45, 0.85, 0.55];
            cr.setSourceRGBA(color[0], color[1], color[2], 0.95);
            cr.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * 2 * Math.PI);
            cr.stroke();
        }
        cr.$dispose();
    }
});
