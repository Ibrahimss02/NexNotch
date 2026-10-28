import QtQuick

/* Calendar events and Google Tasks. GNOME reads events from its
   CalendarServer (Evolution Data Server fed by Online Accounts); KDE has
   neither, so events come from iCal feeds (Config.calendarFeeds — Google's
   "secret address in iCal format", Outlook, Nextcloud…), parsed and expanded
   here, and from an optional Google account signed in with the user's own
   OAuth client (Calendar API events, and Tasks API like calendar.js). */
QtObject {
    id: root

    // ——— for the settings window ———
    readonly property var feeds: _list(Config.calendarFeeds).filter(f => f && f.url)
    property string googleAccount: ""
    property bool googleBusy: false
    property string googleError: ""
    readonly property var calendars: feeds.map(f => ({id: f.name, name: f.name, source: "iCal feed", color: f.color || ""}))
        .concat(_gCals.map(c => ({id: c.id, name: c.name, source: googleAccount, color: c.color})))
    property var taskLists: []              // [{id, name}]
    property string status: ""

    // ——— for the tab ———
    /* {id, summary, location, allDay, start, end (ms), source, color}, within
       range(), filtered by Config.calendarEnabledSources (feed names /
       Google calendar ids; empty = all) */
    readonly property var events: {
        const on = _list(Config.calendarEnabledSources);
        return on.length ? _allEvents.filter(e => on.includes(e.source)) : _allEvents;
    }
    /* pending {id, listId, list, title, notes, done, due (local-midnight ms
       or 0)}; Config.tasksEnabledLists holds list ids or titles */
    readonly property var tasks: {
        const on = _list(Config.tasksEnabledLists);
        return on.length ? _allTasks.filter(t => on.includes(t.listId) || on.includes(t.list)) : _allTasks;
    }
    readonly property bool tasksAvailable: Config.showTasks && googleAccount !== ""
    /* view state of the month grid, kept here so it survives the tab being
       unloaded on collapse (as in calendar.js) */
    property int monthOffset: 0
    property var selectedDay: null          // Date at local midnight
    property double now: Date.now()         // minute tick for "Up next"

    function addFeed(name, url, color) {
        url = String(url || "").trim().replace(/^webcals?:\/\//i, "https://");
        if (!url) return;
        const taken = feeds.map(f => f.name);
        let base = String(name || "").trim() || (url.match(/^\w+:\/\/([^/]+)/)?.[1] ?? "Calendar");
        let n = base;
        for (let i = 2; taken.includes(n); i++) n = `${base} ${i}`;
        const palette = ["#0A84FF", "#FF453A", "#30D158", "#FF9F0A", "#BF5AF2", "#64D2FF", "#FFD60A"];
        Config.calendarFeeds = feeds.concat([{name: n, url, color: color || palette[feeds.length % palette.length]}]);
    }
    function removeFeed(index) {
        const copy = feeds.slice();
        const [gone] = copy.splice(index, 1);
        if (gone) Sys.remove(_cachePath(gone.url));
        Config.calendarFeeds = copy;
    }

    function refresh() {
        for (const f of feeds) _fetchFeed(f);
        _refreshGoogle();
    }

    function signIn() {
        if (googleBusy) return;
        const id = String(Config.googleClientId || "").trim();
        if (!id || !String(Config.googleClientSecret || "").trim()) {
            googleError = "Add your Google OAuth client ID and secret first";
            return;
        }
        const port = OAuth.listen();
        if (!port) { googleError = "Couldn't open a local port for the sign-in"; return; }
        _auth = {verifier: OAuth.randomToken(48), state: OAuth.randomToken(16), redirect: `http://127.0.0.1:${port}`};
        googleError = "";
        googleBusy = true;
        _authTimeout.restart();
        Sys.openUrl("https://accounts.google.com/o/oauth2/v2/auth?" + _form({
            client_id: id, redirect_uri: _auth.redirect, response_type: "code", scope: _scopes,
            code_challenge: OAuth.pkceChallenge(_auth.verifier), code_challenge_method: "S256",
            state: _auth.state, access_type: "offline", prompt: "consent",
        }));
    }
    function signOut() {
        if (_g.refresh) Sys.http("POST", "https://oauth2.googleapis.com/revoke", {"Content-Type": "application/x-www-form-urlencoded"},
            _form({token: _g.refresh}), () => {});
        _forgetGoogle();
        googleError = "";
    }

    function toggleTask(t) {
        _allTasks = _allTasks.map(x => x.id === t.id ? Object.assign({}, x, {done: !x.done}) : x);
        _api("PATCH", `${_tasksApi}/lists/${t.listId}/tasks/${t.id}`, {status: t.done ? "needsAction" : "completed"},
            () => _tasksSoon.restart());
    }
    function addTask(listId, title, notes) {
        title = String(title || "").trim();
        if (!listId || !title) return;
        const body = {title};
        if (String(notes || "").trim()) body.notes = notes.trim();
        _api("POST", `${_tasksApi}/lists/${listId}/tasks`, body, () => _refreshTasks());
    }

    /* the range events are expanded for: the next two weeks for Up next,
       plus the whole month on view */
    function range() {
        const n = new Date(now);
        const first = new Date(n.getFullYear(), n.getMonth() + monthOffset, 1).getTime();
        const next = new Date(n.getFullYear(), n.getMonth() + monthOffset + 1, 1).getTime();
        return {since: Math.min(new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime(), first),
                until: Math.max(n.getTime() + 14 * 86400000, next)};
    }

    // ——— internals ———
    readonly property string _tasksApi: "https://tasks.googleapis.com/tasks/v1"
    readonly property string _calApi: "https://www.googleapis.com/calendar/v3"
    readonly property string _scopes: "openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/tasks"
    readonly property string _tokenFile: Sys.configDir + "/google-token.json"
    property var _allEvents: []
    property var _allTasks: []
    property var _gCals: []                 // [{id, name, color}]
    property var _feedData: ({})            // url → {masters, overrides, error, at}
    property var _gEvents: ({})             // calendar id → events in the range
    property int _gGen: 0                   // drops replies for an outdated range
    property var _g: ({refresh: "", access: "", expires: 0, waiting: null})
    property var _auth: null
    property string _day: new Date().toDateString()

    /* QSettings reads a one-element list back as the bare element */
    function _list(v) {
        if (!v) return [];
        if (Array.isArray(v)) return v;
        return typeof v === "string" || v.length === undefined ? [v] : Array.from(v);
    }
    function _form(o) { return Object.keys(o).map(k => `${k}=${encodeURIComponent(o[k])}`).join("&"); }
    function _cachePath(url) { return `${Sys.cacheDir}/calendar/${Sys.hash(url, "md5")}.ics`; }

    // iCal feeds

    function _syncFeeds() {
        const urls = feeds.map(f => f.url);
        for (const u of Object.keys(_feedData)) if (!urls.includes(u)) delete _feedData[u];
        for (const f of feeds) {
            if (_feedData[f.url]) continue;
            /* show the cached copy at once, then fetch */
            const cached = Sys.readFile(_cachePath(f.url));
            _feedData[f.url] = cached ? Object.assign(_ical.parse(cached), {error: "", at: 0}) : {masters: [], overrides: {}, error: "", at: 0};
            _fetchFeed(f);
        }
        _rebuild();
    }

    function _fetchFeed(f) {
        const url = f.url;
        Sys.http("GET", url, {}, "", (code, body) => {
            const d = _feedData[url];
            if (!d) return;   // removed meanwhile
            if (code >= 200 && code < 300 && body.includes("BEGIN:VCALENDAR")) {
                Sys.writeFile(_cachePath(url), body);
                _feedData[url] = Object.assign(_ical.parse(body), {error: "", at: Date.now()});
            } else {
                d.error = !code ? "offline" : code >= 200 && code < 300 ? "not an iCal file" : `HTTP ${code}`;
            }
            _rebuild();
        });
    }

    function _rebuild() {
        const {since, until} = range();
        const out = [];
        for (const f of feeds) {
            const d = _feedData[f.url];
            if (!d) continue;
            const evs = [];
            _ical.expand(d, since, until, evs);
            for (const e of evs) { e.source = f.name; e.color = f.color || Theme.blue; out.push(e); }
        }
        for (const c of _gCals) for (const e of _gEvents[c.id] ?? []) out.push(e);
        out.sort((a, b) => a.start - b.start || a.end - b.end);
        _allEvents = out;
        _updateStatus();
    }

    function _updateStatus() {
        const broken = feeds.filter(f => _feedData[f.url]?.error);
        const n = feeds.length + _gCals.length;
        status = broken.length ? `“${broken[0].name}”: ${_feedData[broken[0].url].error}`
            : googleError ? googleError
            : n ? `${n} calendar${n === 1 ? "" : "s"} · ${_allEvents.length} event${_allEvents.length === 1 ? "" : "s"} ahead`
            : "No calendars connected";
    }

    // Google

    function _loadGoogle() {
        try {
            const t = JSON.parse(Sys.readFile(_tokenFile) || "null");
            if (t?.refreshToken) { _g.refresh = t.refreshToken; googleAccount = t.account || ""; }
        } catch (e) { console.warn("nexnotch: calendar: unreadable", _tokenFile); }
    }

    function _forgetGoogle() {
        Sys.remove(_tokenFile);
        _g = {refresh: "", access: "", expires: 0, waiting: null};
        googleAccount = "";
        _gCals = [];
        _gEvents = {};
        taskLists = [];
        _allTasks = [];
        _rebuild();
    }

    /* cb(accessToken | ""), refreshing it when it's about to expire; callers
       arriving during a refresh wait for the same one */
    function _withToken(cb) {
        if (_g.access && Date.now() < _g.expires - 60000) return cb(_g.access);
        if (!_g.refresh) return cb("");
        if (_g.waiting) { _g.waiting.push(cb); return; }
        _g.waiting = [cb];
        Sys.http("POST", "https://oauth2.googleapis.com/token", {"Content-Type": "application/x-www-form-urlencoded"},
            _form({client_id: Config.googleClientId.trim(), client_secret: Config.googleClientSecret.trim(),
                   refresh_token: _g.refresh, grant_type: "refresh_token"}), (code, body) => {
                let r = {};
                try { r = JSON.parse(body); } catch (e) {}
                const waiting = _g.waiting;
                _g.waiting = null;
                if (code === 200 && r.access_token) {
                    _g.access = r.access_token;
                    _g.expires = Date.now() + (r.expires_in ?? 3600) * 1000;
                } else if (r.error === "invalid_grant") {
                    _forgetGoogle();
                    googleError = "Google access expired or was revoked — sign in again";
                } else if (code) {
                    googleError = `Google: ${r.error_description || r.error || "HTTP " + code}`;
                }
                for (const w of waiting ?? []) w(_g.access && Date.now() < _g.expires ? _g.access : "");
            });
    }

    /* cb(status, json) against a Google API with the account's token */
    function _api(method, url, body, cb) {
        _withToken(token => {
            if (!token) return cb(0, null);
            Sys.http(method, url, {Authorization: `Bearer ${token}`, "Content-Type": "application/json"},
                body ? JSON.stringify(body) : "", (code, text) => {
                    if (code === 401) _g.access = "";
                    let json = null;
                    try { json = JSON.parse(text); } catch (e) {}
                    if (code < 200 || code >= 300) console.warn("nexnotch: google", method, url.split("?")[0], code);
                    cb(code, json);
                });
        });
    }

    function _refreshGoogle() {
        if (!_g.refresh) return;
        _api("GET", `${_calApi}/users/me/calendarList?minAccessRole=reader&fields=items(id,summary,summaryOverride,backgroundColor)`, null, (code, r) => {
            if (code !== 200 || !r) return;
            _gCals = (r.items ?? []).map(c => ({id: c.id, name: c.summaryOverride || c.summary || c.id, color: c.backgroundColor || Theme.blue}));
            if (googleError.startsWith("Google:")) googleError = "";
            _fetchGoogleEvents();
        });
        _refreshTasks();
    }

    function _fetchGoogleEvents() {
        const gen = ++_gGen;
        const {since, until} = range();
        const fresh = {};
        for (const c of _gCals) {
            const q = _form({timeMin: new Date(since).toISOString(), timeMax: new Date(until).toISOString(), singleEvents: true,
                             orderBy: "startTime", maxResults: 250, fields: "items(id,summary,location,start,end,status)"});
            _api("GET", `${_calApi}/calendars/${encodeURIComponent(c.id)}/events?${q}`, null, (code, r) => {
                if (gen !== _gGen || code !== 200 || !r) return;
                const day = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).getTime(); };
                fresh[c.id] = (r.items ?? []).filter(e => e.status !== "cancelled" && e.start).map(e => {
                    const allDay = !e.start.dateTime;
                    return {id: `${c.id}/${e.id}`, summary: e.summary || "(No title)", location: e.location || "", allDay,
                            start: allDay ? day(e.start.date) : Date.parse(e.start.dateTime),
                            end: allDay ? day(e.end.date) : Date.parse(e.end.dateTime), source: c.id, color: c.color};
                });
                /* keep the previous range's events of slower calendars until theirs arrive */
                _gEvents = Object.assign({}, _gEvents, fresh);
                _rebuild();
            });
        }
    }

    function _refreshTasks() {
        if (!_g.refresh || !Config.showTasks) return;
        _api("GET", `${_tasksApi}/users/@me/lists?maxResults=100`, null, (code, r) => {
            if (code !== 200 || !r) return;
            const lists = (r.items ?? []).map(l => ({id: l.id, name: l.title || "Tasks"}));
            taskLists = lists;
            const all = [];
            let left = lists.length;
            if (!left) _allTasks = [];
            for (const l of lists) {
                _api("GET", `${_tasksApi}/lists/${l.id}/tasks?showCompleted=false&showHidden=false&maxResults=100`, null, (c2, r2) => {
                    for (const t of r2?.items ?? []) {
                        if (t.status === "completed") continue;
                        /* due is a date sent as UTC midnight */
                        const due = t.due ? new Date(Number(t.due.slice(0, 4)), Number(t.due.slice(5, 7)) - 1, Number(t.due.slice(8, 10))).getTime() : 0;
                        all.push({id: t.id, listId: l.id, list: l.name, title: t.title || "(untitled)", notes: t.notes || "", done: false, due});
                    }
                    if (--left) return;
                    all.sort((a, b) => (a.due || Infinity) - (b.due || Infinity));
                    _allTasks = all;
                });
            }
        });
    }

    function _onRedirect(p) {
        const a = _auth;
        if (!a) return;
        _auth = null;
        _authTimeout.stop();
        if (p.state !== a.state || !p.code) {
            googleBusy = false;
            googleError = p.error === "access_denied" ? "Sign-in cancelled" : `Sign-in failed${p.error ? ": " + p.error : ""}`;
            return;
        }
        Sys.http("POST", "https://oauth2.googleapis.com/token", {"Content-Type": "application/x-www-form-urlencoded"},
            _form({code: p.code, client_id: Config.googleClientId.trim(), client_secret: Config.googleClientSecret.trim(),
                   redirect_uri: a.redirect, grant_type: "authorization_code", code_verifier: a.verifier}), (code, body) => {
                let r = {};
                try { r = JSON.parse(body); } catch (e) {}
                if (code !== 200 || !r.refresh_token) {
                    googleBusy = false;
                    googleError = `Sign-in failed: ${r.error_description || r.error || (code ? "HTTP " + code : "offline")}`;
                    return;
                }
                _g = {refresh: r.refresh_token, access: r.access_token, expires: Date.now() + (r.expires_in ?? 3600) * 1000, waiting: null};
                _api("GET", "https://openidconnect.googleapis.com/v1/userinfo", null, (c2, info) => {
                    googleAccount = info?.email || "Google account";
                    OAuth.writePrivate(_tokenFile, JSON.stringify({account: googleAccount, refreshToken: _g.refresh}));
                    googleBusy = false;
                    googleError = "";
                    _refreshGoogle();
                });
            });
    }

    // ——— iCalendar (RFC 5545) ———
    property QtObject _ical: QtObject {
        readonly property double day: 86400000

        /* {masters: [event], overrides: {uid: [event]}}; times are
           {wall (wall clock as if UTC, ms), zone ("Z" | TZID | "" floating),
           date (VALUE=DATE)} */
        function parse(text) {
            const masters = [], overrides = {};
            let ev = null, depth = 0;   // depth: components nested in the VEVENT (VALARM)
            for (const line of text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
                const p = prop(line);
                if (!p) continue;
                if (p.name === "BEGIN") {
                    if (ev) depth++;
                    else if (p.value.toUpperCase() === "VEVENT") ev = {uid: "", summary: "", location: "", exdates: [], rdates: []};
                } else if (p.name === "END") {
                    if (ev && depth) depth--;
                    else if (ev) {
                        if (finish(ev)) {
                            if (ev.recurrenceId) (overrides[ev.uid] = overrides[ev.uid] ?? []).push(ev);
                            else masters.push(ev);
                        }
                        ev = null;
                    }
                } else if (ev && !depth) {
                    switch (p.name) {
                    case "UID": ev.uid = p.value; break;
                    case "SUMMARY": ev.summary = unescapeText(p.value); break;
                    case "LOCATION": ev.location = unescapeText(p.value); break;
                    case "STATUS": ev.status = p.value.toUpperCase(); break;
                    case "DTSTART": ev.start = time(p.value, p.params); break;
                    case "DTEND": ev.end = time(p.value, p.params); break;
                    case "DURATION": ev.duration = duration(p.value); break;
                    case "RRULE": ev.rrule = rrule(p.value, p.params); break;
                    case "EXDATE": ev.exdates.push(...p.value.split(",").map(v => time(v, p.params))); break;
                    case "RDATE": if (p.params.VALUE !== "PERIOD") ev.rdates.push(...p.value.split(",").map(v => time(v, p.params))); break;
                    case "RECURRENCE-ID": ev.recurrenceId = time(p.value, p.params); break;
                    }
                }
            }
            return {masters, overrides};
        }

        /* "NAME;P1=a;P2="b:c":value" → {name, params, value} */
        function prop(line) {
            let q = false, i = 0;
            for (; i < line.length; i++) {
                const c = line[i];
                if (c === '"') q = !q;
                else if (c === ":" && !q) break;
            }
            if (i >= line.length) return null;
            const head = line.slice(0, i).match(/(?:[^;"]|"[^"]*")+/g) ?? [""];
            const params = {};
            for (const kv of head.slice(1)) {
                const eq = kv.indexOf("=");
                if (eq > 0) params[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1).replace(/^"|"$/g, "");
            }
            return {name: head[0].toUpperCase(), params, value: line.slice(i + 1)};
        }

        function unescapeText(s) { return s.replace(/\\([\\;,nN])/g, (m, c) => c === "n" || c === "N" ? "\n" : c); }

        function time(v, params) {
            const m = v.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
            if (!m) return null;
            const date = !m[4] || params.VALUE === "DATE";
            const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], date ? 0 : +m[4], date ? 0 : +m[5], date ? 0 : +(m[6] ?? 0));
            return {wall, date, zone: date ? "" : m[7] ? "Z" : params.TZID || ""};
        }

        function duration(v) {
            const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
            if (!m) return null;
            const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 24 * 3600 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
            return m[1] === "-" ? -ms : ms;
        }

        function rrule(v, params) {
            const r = {freq: "", interval: 1, count: 0, until: null, byday: [], bymonthday: [], bymonth: [], bysetpos: [], wkst: 1};
            const wd = {SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6};
            const nums = s => s.split(",").map(Number).filter(n => n && !isNaN(n));
            for (const part of v.split(";")) {
                const [k, val = ""] = part.split("=");
                switch (k.toUpperCase()) {
                case "FREQ": r.freq = val.toUpperCase(); break;
                case "INTERVAL": r.interval = Math.max(1, +val || 1); break;
                case "COUNT": r.count = +val || 0; break;
                case "UNTIL": r.until = time(val, {}); break;
                case "WKST": r.wkst = wd[val.toUpperCase()] ?? 1; break;
                case "BYMONTHDAY": r.bymonthday = nums(val); break;
                case "BYMONTH": r.bymonth = nums(val); break;
                case "BYSETPOS": r.bysetpos = nums(val); break;
                case "BYDAY":
                    for (const d of val.toUpperCase().split(",")) {
                        const m = d.match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
                        if (m) r.byday.push({n: +(m[1] ?? 0), wd: wd[m[2]]});
                    }
                    break;
                }
            }
            return ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(r.freq) ? r : null;
        }

        /* duration as wall-clock ms; an all-day event without an end lasts its day */
        function finish(ev) {
            if (!ev.start) return false;
            if (ev.status === "CANCELLED" && !ev.recurrenceId) return false;
            ev.summary = ev.summary || "(No title)";
            ev.allDay = ev.start.date;
            if (ev.end && ev.end.zone === ev.start.zone) ev.dur = ev.end.wall - ev.start.wall;
            else if (ev.end) { ev.dur = epoch(ev.end) - epoch(ev.start); ev.exact = true; }
            else ev.dur = ev.duration ?? (ev.allDay ? day : 0);
            ev.dur = Math.max(0, ev.dur);
            ev.startMs = epoch(ev.start);
            return true;
        }

        function epoch(t) {
            if (t.zone === "Z") return t.wall;
            if (t.zone) {
                const ms = OAuth.zonedToEpoch(t.zone, t.wall);
                if (!isNaN(ms)) return ms;
            }
            const d = new Date(t.wall);   // floating: the wall time here
            return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()).getTime();
        }

        /* occurrences overlapping [since, until) pushed onto out */
        function expand(data, since, until, out) {
            for (const ev of data.masters) {
                const overridden = new Set((data.overrides[ev.uid] ?? []).map(o => epoch(o.recurrenceId)));
                if (!ev.rrule && !ev.rdates.length) {
                    if (!overridden.has(ev.startMs)) push(ev, ev.start.wall, ev.startMs, since, until, out);
                    continue;
                }
                const skip = new Set(ev.exdates.filter(Boolean).map(epoch));
                for (const o of overridden) skip.add(o);
                const emit = wall => {
                    const s = epoch({wall, zone: ev.start.zone});
                    if (!skip.has(s)) push(ev, wall, s, since, until, out);
                };
                if (ev.rrule) occurrences(ev, since, until, emit);
                else emit(ev.start.wall);
                for (const r of ev.rdates) if (r) emit(r.date && !ev.allDay ? r.wall + ev.start.wall % day : r.wall);
            }
            for (const uid in data.overrides)
                for (const o of data.overrides[uid])
                    if (o.status !== "CANCELLED") push(o, o.start.wall, o.startMs, since, until, out);
        }

        function push(ev, wall, s, since, until, out) {
            const e = ev.exact ? s + ev.dur : epoch({wall: wall + ev.dur, zone: ev.start.zone});
            if (s < until && Math.max(e, s + 1) > since)
                out.push({id: `${ev.uid}/${s}`, summary: ev.summary, location: ev.location, allDay: ev.allDay, start: s, end: e});
        }

        function wday(n) { return ((n + 4) % 7 + 7) % 7; }   // day number → 0 = Sunday (1970-01-01 was a Thursday)

        /* days of month (y, m) the rule picks; `dom` = DTSTART's day when nothing narrows it */
        function monthDays(r, y, m, dom) {
            const first = Date.UTC(y, m, 1) / day, dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
            const days = [];
            if (r.bymonthday.length) {
                for (const md of r.bymonthday) {
                    const d = md > 0 ? md : dim + md + 1;
                    if (d >= 1 && d <= dim && (!r.byday.length || r.byday.some(b => b.wd === wday(first + d - 1)))) days.push(first + d - 1);
                }
            } else if (r.byday.length) {
                for (const b of r.byday) {
                    const all = [];
                    for (let d = 0; d < dim; d++) if (wday(first + d) === b.wd) all.push(first + d);
                    if (!b.n) days.push(...all);
                    else { const x = all[b.n > 0 ? b.n - 1 : all.length + b.n]; if (x !== undefined) days.push(x); }
                }
            } else if (dom <= dim) days.push(first + dom - 1);
            return days;
        }

        /* walks the rule's periods (day / week / month / year) from DTSTART,
           calling emit(wall) for each occurrence until COUNT, UNTIL or the
           end of the range */
        function occurrences(ev, since, until, emit) {
            const r = ev.rrule, n = r.interval;
            const start = Math.floor(ev.start.wall / day), tod = ev.start.wall - start * day;
            const sd = new Date(start * day), sy = sd.getUTCFullYear(), sm = sd.getUTCMonth(), sdom = sd.getUTCDate();
            const untilMs = !r.until ? Infinity : r.until.zone === "Z" ? r.until.wall
                : epoch({wall: r.until.wall + (r.until.date ? day - 1 : 0), zone: r.until.date ? "" : ev.start.zone});
            const lastDay = Math.floor(until / day) + 2;
            /* without COUNT nothing before the range matters: skip ahead */
            let p = 0;
            if (!r.count && since > ev.startMs) {
                const gap = (since - ev.startMs) / day;
                p = Math.max(0, Math.floor(gap / ({DAILY: 1, WEEKLY: 7, MONTHLY: 31, YEARLY: 366}[r.freq] * n)) - 1);
            }
            let count = 0;
            for (let guard = 0; guard < 5000; guard++, p++) {
                let days, periodStart;
                if (r.freq === "DAILY") {
                    periodStart = start + p * n;
                    const d = new Date(periodStart * day);
                    days = (!r.byday.length || r.byday.some(b => b.wd === wday(periodStart)))
                        && (!r.bymonthday.length || r.bymonthday.includes(d.getUTCDate())) ? [periodStart] : [];
                } else if (r.freq === "WEEKLY") {
                    periodStart = start - (wday(start) - r.wkst + 7) % 7 + p * 7 * n;
                    days = (r.byday.length ? r.byday.map(b => b.wd) : [wday(start)]).map(w => periodStart + (w - r.wkst + 7) % 7);
                } else if (r.freq === "MONTHLY") {
                    const mi = sm + p * n, y = sy + Math.floor(mi / 12), m = mi % 12;
                    periodStart = Date.UTC(y, m, 1) / day;
                    days = monthDays(r, y, m, sdom);
                } else {
                    const y = sy + p * n;
                    periodStart = Date.UTC(y, 0, 1) / day;
                    days = [];
                    for (const m of r.bymonth.length ? r.bymonth.map(x => x - 1) : [sm]) days.push(...monthDays(r, y, m, sdom));
                }
                if (periodStart > lastDay) return;
                if (r.bymonth.length && r.freq !== "YEARLY")
                    days = days.filter(x => r.bymonth.includes(new Date(x * day).getUTCMonth() + 1));
                days = Array.from(new Set(days)).sort((a, b) => a - b);
                if (r.bysetpos.length) days = r.bysetpos.map(i => days[i > 0 ? i - 1 : days.length + i]).filter(x => x !== undefined).sort((a, b) => a - b);
                /* DTSTART is always the first occurrence */
                if (p === 0 && !days.includes(start)) days.unshift(start);
                for (const d of days) {
                    if (d < start) continue;
                    if (d > lastDay) return;
                    const wall = d * day + tod;
                    if (epoch({wall, zone: ev.start.zone}) > untilMs) return;
                    if (r.count && ++count > r.count) return;
                    emit(wall);
                }
            }
        }
    }

    property Timer _tick: Timer {
        interval: 60000; repeat: true; running: true
        onTriggered: {
            root.now = Date.now();
            const d = new Date().toDateString();
            if (d !== root._day) { root._day = d; root._rebuild(); }
        }
    }
    property Timer _feedTimer: Timer {
        interval: 15 * 60000; repeat: true; running: root.feeds.length > 0
        onTriggered: root.feeds.forEach(f => root._fetchFeed(f))
    }
    property Timer _googleTimer: Timer {
        interval: 5 * 60000; repeat: true; running: root.googleAccount !== ""
        onTriggered: root._refreshGoogle()
    }
    /* a ticked task stays (struck through) a moment before the list reloads */
    property Timer _tasksSoon: Timer { interval: 1500; onTriggered: root._refreshTasks() }
    property Timer _rangeTimer: Timer { interval: 250; onTriggered: root._fetchGoogleEvents() }
    property Timer _authTimeout: Timer {
        interval: 5 * 60000
        onTriggered: {
            OAuth.close();
            root._auth = null;
            root.googleBusy = false;
            root.googleError = "Sign-in timed out";
        }
    }

    onMonthOffsetChanged: { _rebuild(); _rangeTimer.restart(); }
    onGoogleErrorChanged: _updateStatus()

    property Connections _redirect: Connections {
        target: OAuth
        function onRedirected(params) { root._onRedirect(params); }
    }
    property Connections _config: Connections {
        target: Config
        function onCalendarFeedsChanged() { root._syncFeeds(); }
        function onShowTasksChanged() { if (Config.showTasks) root._refreshTasks(); else root._allTasks = []; }
    }

    Component.onCompleted: {
        _loadGoogle();
        _syncFeeds();
        _refreshGoogle();
    }
}
