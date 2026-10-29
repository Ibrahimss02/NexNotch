import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

const DAY_S = 24 * 3600;

/* "1.10.0" > "1.9.2"; a leading "v" is ignored */
export function isNewer(a, b) {
    const parse = v => v.replace(/^v/i, '').split(/[.-]/).map(n => parseInt(n, 10) || 0);
    const [x, y] = [parse(a), parse(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
    }
    return false;
}

/* Once a day, asks GitHub for the latest release of the repo in
   metadata.json's url and, when it's newer than this install, posts a
   notification linking to it (once per version). Nothing is downloaded or
   installed. Off with the check-updates setting. */
export class UpdateChecker {
    constructor(settings, metadata) {
        this._settings = settings;
        this._current = metadata['version-name'] ?? String(metadata.version ?? '0');
        this._repo = metadata.url?.match(/github\.com\/([^/]+\/[^/#?]+?)(?:\.git)?\/?$/)?.[1] ?? null;
        this._cancellable = new Gio.Cancellable();
    }

    start() {
        if (!this._repo) return;
        this._settingsId = this._settings.connect('changed::check-updates', () => this._schedule());
        this._schedule(true);
    }

    stop() {
        if (this._timer) { GLib.source_remove(this._timer); this._timer = 0; }
        if (this._settingsId) { this._settings.disconnect(this._settingsId); this._settingsId = 0; }
        this._cancellable.cancel();
        this._session?.abort();
    }

    /* a minute after login, then a day after the last check */
    _schedule(atLogin = false) {
        if (this._timer) { GLib.source_remove(this._timer); this._timer = 0; }
        if (!this._settings.get_boolean('check-updates')) return;
        const now = Math.floor(Date.now() / 1000);
        const wait = atLogin ? 60 : Math.max(60, this._settings.get_int64('update-last-check') + DAY_S - now);
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, wait, () => {
            this._timer = 0;
            this._check();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _check() {
        this._settings.set_int64('update-last-check', Math.floor(Date.now() / 1000));
        const release = await this._latest();
        if (this._cancellable.is_cancelled()) return;
        const version = release?.tag_name?.replace(/^v/i, '');
        if (version && isNewer(version, this._current) && this._settings.get_string('update-notified') !== version) {
            this._settings.set_string('update-notified', version);
            this._notify(version, release.html_url);
        }
        this._schedule();
    }

    /* GitHub's latest release (never a draft or pre-release), or null */
    _latest() {
        return new Promise(resolve => {
            this._session ??= new Soup.Session({timeout: 15, user_agent: `NexNotch/${this._current}`});
            const msg = Soup.Message.new('GET', `https://api.github.com/repos/${this._repo}/releases/latest`);
            msg.request_headers.append('Accept', 'application/vnd.github+json');
            this._session.send_and_read_async(msg, GLib.PRIORITY_LOW, this._cancellable, (s, res) => {
                try {
                    const bytes = s.send_and_read_finish(res);
                    resolve(msg.status_code === 200 ? JSON.parse(new TextDecoder().decode(bytes.get_data())) : null);
                } catch (_) { resolve(null); }
            });
        });
    }

    _notify(version, url) {
        const source = new MessageTray.Source({title: 'NexNotch', iconName: 'software-update-available-symbolic'});
        Main.messageTray.add(source);
        const notification = new MessageTray.Notification({
            source,
            title: `NexNotch ${version} is available`,
            body: `You have ${this._current}. Update with git pull && make install, then log out and back in.`,
        });
        const open = () => {
            try {
                Gio.AppInfo.launch_default_for_uri(url, global.create_app_launch_context(0, -1));
            } catch (e) { logError(e, 'nexnotch:updates'); }
        };
        notification.addAction('View release', open);
        notification.connect('activated', open);
        source.addNotification(notification);
    }
}
