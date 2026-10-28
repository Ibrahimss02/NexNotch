import QtQuick

/* Time-synced lyrics from LRCLIB (lrclib.net, free, no account). Only
   called when the user turns lyrics on; it sends the track's title,
   artist, album and length. Results, including "not found", are cached
   in ~/.cache/nexnotch/lyrics so each song is looked up once. */
QtObject {
    id: root
    readonly property string api: "https://lrclib.net/api"
    readonly property string cacheDir: Sys.cacheDir + "/lyrics"
    property var memory: ({})     // key -> result
    property var pending: ({})    // key -> Promise

    /* "[01:02.34] line" (a line may carry several stamps) -> [{t: ms, text}] */
    function parseLrc(lrc) {
        const lines = [];
        for (const raw of (lrc ?? "").split("\n")) {
            const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
            if (!stamps.length) continue;
            const text = raw.replace(/\[[^\]]*\]/g, "").trim();
            for (const m of stamps)
                lines.push({t: Math.round((Number(m[1]) * 60 + Number(m[2])) * 1000), text});
        }
        return lines.sort((a, b) => a.t - b.t);
    }

    /* index of the line playing at posMs, or -1 before the first line */
    function lineAt(lines, posMs) {
        let lo = 0, hi = lines.length - 1, found = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (lines[mid].t <= posMs) { found = mid; lo = mid + 1; } else hi = mid - 1;
        }
        return found;
    }

    /* -> Promise<{synced: [{t, text}] | null, plain: string | null, instrumental} | null> */
    function get(info) {
        if (!info?.title) return Promise.resolve(null);
        const seconds = Math.round((info.length ?? 0) / 1e6);
        const key = `${info.artist}|${info.title}|${info.album}|${seconds}`;
        if (key in memory) return Promise.resolve(memory[key]);
        if (key in pending) return pending[key];
        const promise = lookup(key, info, seconds).then(result => {
            memory[key] = result;
            delete pending[key];
            return result;
        });
        pending[key] = promise;
        return promise;
    }

    function shape(stored) {
        if (!stored || stored.notFound) return null;
        const synced = stored.syncedLyrics ? parseLrc(stored.syncedLyrics) : null;
        return {synced: synced?.length ? synced : null, plain: stored.plainLyrics, instrumental: stored.instrumental};
    }

    /* -> parsed JSON, null for "not found" (404), undefined on network error */
    function request(endpoint, params) {
        return new Promise(resolve => {
            const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
            Sys.http("GET", `${api}/${endpoint}?${query}`, {}, "", (status, body) => {
                try {
                    if (status === 200) resolve(JSON.parse(body));
                    else resolve(status === 404 ? null : undefined);
                } catch (_) { resolve(undefined); }
            });
        });
    }

    function lookup(key, info, seconds) {
        const file = `${cacheDir}/${Sys.hash(key)}`;
        const raw = Sys.readFile(file);
        if (raw !== null) {
            try { return Promise.resolve(shape(JSON.parse(raw))); } catch (_) {}
        }
        const params = {track_name: info.title, artist_name: info.artist ?? ""};
        if (info.album) params.album_name = info.album;
        if (seconds) params.duration = String(seconds);
        return request("get", params).then(data => {
            if (data !== null) return data;
            /* no exact match (album/duration differ): best search hit */
            return request("search", {track_name: info.title, artist_name: info.artist ?? ""}).then(hits =>
                Array.isArray(hits) ? (hits.find(h => h.syncedLyrics) ?? hits[0] ?? null) : hits);
        }).then(data => {
            if (data === undefined) return null;   // network trouble: don't cache, retry next time
            const stored = data
                ? {syncedLyrics: data.syncedLyrics ?? null, plainLyrics: data.plainLyrics ?? null, instrumental: !!data.instrumental}
                : {notFound: true};
            Sys.writeFile(file, JSON.stringify(stored));
            return shape(stored);
        });
    }
}
