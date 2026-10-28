import QtQuick

/* What the pill shows beside the clock and toasts when it changes: Do Not
   Disturb, airplane mode, camera and mic in use, Caps Lock — plus the two
   states that take the whole pill over: a meeting, and screen recording or
   sharing. */
QtObject {
    id: root

    readonly property bool dnd: Notifications.doNotDisturb
    readonly property bool airplane: !!Services.network?.airplaneMode
    readonly property bool camera: Sys.cameraActive
    readonly property bool mic: !!Services.audio?.micInUse
    readonly property bool capsLock: Sys.capsLock

    signal toggled(string kind, bool on)        // dnd / airplane / capslock
    signal privacyStarted(string kind)          // camera / mic, outside a meeting
    signal meetingStarted()

    Component.onCompleted: Sys.watchCamera = true
    onDndChanged: toggled("dnd", dnd)
    onAirplaneChanged: toggled("airplane", airplane)
    onCapsLockChanged: toggled("capslock", capsLock)
    onCameraChanged: { syncMeeting(); if (camera && !meeting) privacyStarted("camera"); }
    onMicChanged: { syncMeeting(); if (mic && !meeting) privacyStarted("mic"); }

    /* the app using the mic, for "Microphone in use · by Firefox" */
    readonly property string micApp: Services.audio?.micStreams?.[0]?.app ?? ""

    // ——— meetings ———

    /* window titles (a browser shows its tab's) that mean a call */
    readonly property var meetings: [
        [/^Meet\b|Google Meet/, "Google Meet"],
        [/\bZoom (Meeting|Webinar|Workplace)\b/i, "Zoom"],
        [/Microsoft Teams/i, "Teams"],
        [/Jitsi Meet/i, "Jitsi"],
        [/\bWebex\b/i, "Webex"],
        [/\bWhereby\b/i, "Whereby"],
        [/\bhuddle\b.*\bSlack\b/i, "Slack huddle"],
    ]
    property var meeting: null      // {service, windowId, since, closed}
    property string meetingText: ""

    function serviceOf(title) { return meetings.find(([re]) => re.test(title ?? ""))?.[1] ?? null; }

    /* A browser names its mic stream after the tab using it, whichever tab
       is showing, so streams come first; window titles cover native apps
       and the camera alone. */
    function findMeeting() {
        let service = null, app = null;
        for (const s of Services.audio?.micStreams ?? []) {
            service = serviceOf(s.name) ?? serviceOf(s.title);
            if (service) { app = (s.binary || s.app || "").toLowerCase(); break; }
        }
        const wins = Windows.windows;
        for (const w of wins) {
            const found = serviceOf(w.title);
            if (found && (!service || found === service)) return {windowId: w.id, service: found};
        }
        if (!service) return null;
        /* the call's tab isn't the one showing: fall back to its browser's window */
        const w = wins.find(w => app && ((w.desktopFile || "").toLowerCase().includes(app) || (w.appClass || "").toLowerCase().includes(app)));
        return {windowId: w?.id ?? "", service};
    }

    /* A window titled like a call while the camera or mic is on means a
       meeting. It lasts until both go off or its window closes, so
       switching browser tabs meanwhile doesn't end it. */
    function syncMeeting() {
        const live = camera || mic;
        const was = meeting;
        let m = live && was && !was.closed ? was : null;
        if (live && !m) {
            const hit = findMeeting();
            if (hit) m = Object.assign(hit, {since: Date.now(), closed: false});
        }
        meeting = m;
        tickMeeting();
        if (m && !was) meetingStarted();
    }

    function tickMeeting() {
        if (!meeting) { meetingText = ""; return; }
        const s = Math.floor((Date.now() - meeting.since) / 1000);
        const pad = n => String(n).padStart(2, "0");
        const time = s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
        meetingText = `${meeting.service} · ${time}`;
    }

    function goToMeeting() {
        if (meeting?.windowId && !meeting.closed) Windows.activate(meeting.windowId);
    }

    property Timer _meetTimer: Timer {
        interval: 1000; repeat: true
        running: !!root.meeting
        onTriggered: root.tickMeeting()
    }
    property Connections _windows: Connections {
        target: Windows
        function onWindowsChanged() { if (root.camera || root.mic) root.syncMeeting(); }
        function onWindowClosed(id) {
            if (root.meeting?.windowId === id) { root.meeting.closed = true; root.syncMeeting(); }
        }
    }
    property Connections _streams: Connections {
        target: Services.audio
        ignoreUnknownSignals: true
        function onMicStreamsChanged() { if (root.camera || root.mic) root.syncMeeting(); }
    }

    // ——— screen recording / sharing ———

    /* Spectacle's recording and the portal's screen-sharing both put an item
       in the system tray while they run; watch the tray for them. */
    property string captureMode: ""     // "" | "rec" | "share"
    property double captureSince: 0
    property string captureItem: ""     // "service/path" of the tray item, for Stop
    property string captureText: "REC"
    property var _sni: ({})             // "service/path" -> {id, title, icon}
    readonly property string watcher: "org.kde.StatusNotifierWatcher"

    function classify(item) {
        const s = `${item.id} ${item.title} ${item.icon}`;
        if (/spectacle|media-record|recording/i.test(s)) return "rec";
        if (/screen.?shar|screencast|remote.?desktop|xdg-desktop-portal|portal/i.test(s)) return "share";
        return "";
    }

    function readItem(key) {
        const slash = key.indexOf("/");
        const service = slash > 0 ? key.slice(0, slash) : key;
        const path = slash > 0 ? key.slice(slash) : "/StatusNotifierItem";
        DBus.getAll("session", service, path, "org.kde.StatusNotifierItem", (props, err) => {
            if (!props) return;
            const map = Object.assign({}, _sni);
            map[key] = {id: props.Id ?? "", title: props.Title ?? "", icon: props.IconName ?? "", service, path};
            _sni = map;
            syncCapture();
        });
    }

    function syncCapture() {
        let mode = "", item = "";
        for (const [key, it] of Object.entries(_sni)) {
            const c = classify(it);
            if (c === "rec" || (c === "share" && mode !== "rec")) { mode = c; item = key; }
        }
        captureItem = item;
        if (mode === captureMode) return;
        captureMode = mode;
        captureSince = mode ? Date.now() : 0;
        tickCapture();
    }

    function tickCapture() {
        if (captureMode !== "rec") { captureText = "REC"; return; }
        const s = Math.floor((Date.now() - captureSince) / 1000);
        captureText = `REC ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }

    /* clicking either tray item stops it, as clicking it in the tray does */
    function stopCapture() {
        const it = _sni[captureItem];
        if (!it) return;
        DBus.call("session", it.service, it.path, "org.kde.StatusNotifierItem", "Activate", [0, 0], "ii");
    }

    property Timer _capTimer: Timer {
        interval: 1000; repeat: true
        running: root.captureMode === "rec"
        onTriggered: root.tickCapture()
    }

    property int _regSig: 0
    property int _unregSig: 0
    property Connections _dbus: Connections {
        target: DBus
        function onSignalReceived(id, member, args) {
            if (id === root._regSig) root.readItem(args[0]);
            else if (id === root._unregSig) {
                const map = Object.assign({}, root._sni);
                delete map[args[0]];
                root._sni = map;
                root.syncCapture();
            }
        }
    }
    function startTray() {
        _regSig = DBus.connectSignal("session", watcher, "/StatusNotifierWatcher", watcher, "StatusNotifierItemRegistered");
        _unregSig = DBus.connectSignal("session", watcher, "/StatusNotifierWatcher", watcher, "StatusNotifierItemUnregistered");
        DBus.getProperty("session", watcher, "/StatusNotifierWatcher", watcher, "RegisteredStatusNotifierItems", items => {
            for (const key of items ?? []) readItem(key);
        });
    }
    property Timer _trayStart: Timer { interval: 1; running: true; onTriggered: root.startTray() }
}
