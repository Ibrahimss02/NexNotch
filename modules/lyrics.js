import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

/* Time-synced lyrics from LRCLIB (lrclib.net, free, no account). Only
   called when the user turns lyrics on; it sends the track's title,
   artist, album and length. Results, including "not found", are cached
   in ~/.cache/nexnotch/lyrics so each song is looked up once. */
const API = 'https://lrclib.net/api';
const USER_AGENT = 'NexNotch (https://github.com/NexVar/NexNotch)';
const CACHE_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'nexnotch', 'lyrics']);

/* "[01:02.34] line" (a line may carry several stamps) -> [{t: ms, text}] */
export function parseLrc(lrc) {
    const lines = [];
    for (const raw of (lrc ?? '').split('\n')) {
        const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
        if (!stamps.length) continue;
        const text = raw.replace(/\[[^\]]*\]/g, '').trim();
        for (const m of stamps)
            lines.push({t: Math.round((Number(m[1]) * 60 + Number(m[2])) * 1000), text});
    }
    return lines.sort((a, b) => a.t - b.t);
}

/* index of the line playing at posMs, or -1 before the first line */
export function lineAt(lines, posMs) {
    let lo = 0, hi = lines.length - 1, found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lines[mid].t <= posMs) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found;
}

export class Lyrics {
    constructor() {
        this._memory = new Map();    // key -> result
        this._pending = new Map();   // key -> Promise
        this._cancellable = new Gio.Cancellable();
    }

    destroy() {
        this._cancellable.cancel();
        this._session?.abort();
    }

    /* -> {synced: [{t, text}] | null, plain: string | null, instrumental} */
    get(info) {
        if (!info?.title) return Promise.resolve(null);
        const seconds = Math.round((info.length ?? 0) / 1e6);
        const key = `${info.artist}|${info.title}|${info.album}|${seconds}`;
        if (this._memory.has(key)) return Promise.resolve(this._memory.get(key));
        if (this._pending.has(key)) return this._pending.get(key);

        const promise = this._lookup(key, info, seconds).then(result => {
            this._memory.set(key, result);
            this._pending.delete(key);
            return result;
        });
        this._pending.set(key, promise);
        return promise;
    }

    async _lookup(key, info, seconds) {
        const file = Gio.File.new_for_path(GLib.build_filenamev([
            CACHE_DIR, GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, key, -1)]));
        const cached = await this._readJson(file);
        if (cached !== undefined) return this._shape(cached);

        const params = {track_name: info.title, artist_name: info.artist ?? ''};
        if (info.album) params.album_name = info.album;
        if (seconds) params.duration = String(seconds);
        let data = await this._request('get', params);
        if (data === null) {
            /* no exact match (album/duration differ): best search hit */
            const hits = await this._request('search', {track_name: info.title, artist_name: info.artist ?? ''});
            data = Array.isArray(hits) ? (hits.find(h => h.syncedLyrics) ?? hits[0] ?? null) : hits;
        }
        if (data === undefined) return null;   // network trouble: don't cache, retry next time
        const stored = data
            ? {syncedLyrics: data.syncedLyrics ?? null, plainLyrics: data.plainLyrics ?? null, instrumental: !!data.instrumental}
            : {notFound: true};
        this._writeJson(file, stored);
        return this._shape(stored);
    }

    _shape(stored) {
        if (!stored || stored.notFound) return null;
        const synced = stored.syncedLyrics ? parseLrc(stored.syncedLyrics) : null;
        return {synced: synced?.length ? synced : null, plain: stored.plainLyrics, instrumental: stored.instrumental};
    }

    /* -> parsed JSON, null for "not found" (404), undefined on network error */
    _request(endpoint, params) {
        return new Promise(resolve => {
            this._session ??= new Soup.Session({timeout: 10, user_agent: USER_AGENT});
            const query = Object.entries(params)
                .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
            const msg = Soup.Message.new('GET', `${API}/${endpoint}?${query}`);
            if (!msg) { resolve(null); return; }
            this._session.send_and_read_async(msg, GLib.PRIORITY_LOW, this._cancellable, (s, res) => {
                try {
                    const bytes = s.send_and_read_finish(res);
                    if (msg.status_code === 200) resolve(JSON.parse(new TextDecoder().decode(bytes.get_data())));
                    else resolve(msg.status_code === 404 ? null : undefined);
                } catch (_) { resolve(undefined); }
            });
        });
    }

    _readJson(file) {
        return new Promise(resolve => {
            file.load_contents_async(this._cancellable, (f, res) => {
                try {
                    const [, bytes] = f.load_contents_finish(res);
                    resolve(JSON.parse(new TextDecoder().decode(bytes)));
                } catch (_) { resolve(undefined); }
            });
        });
    }

    _writeJson(file, value) {
        try {
            GLib.mkdir_with_parents(CACHE_DIR, 0o700);
            const bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(value)));
            file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.NONE, this._cancellable,
                (f, res) => { try { f.replace_contents_finish(res); } catch (_) {} });
        } catch (_) {}
    }
}
