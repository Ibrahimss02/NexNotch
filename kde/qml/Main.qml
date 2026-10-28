import QtQuick

/* The app: the notch's layer-shell window, the settings window, and the
   commands a second `nexnotch-kde --command …` (or the shortcut) sends. */
QtObject {
    id: app
    required property bool testMode
    required property bool openSettings
    required property string startCommand
    required property string startArg

    readonly property int margin: 8          // pointer slack around the notch, like GNOME's _pointerInside

    property NotchWindow window: NotchWindow {
        id: win
        title: "NexNotch"
        width: Math.max(Config.expandedWidth, 504) + 2 * Theme.earPx + 2 * app.margin + 40
        height: notch.maxExpandedHeight + 2 * app.margin
        exclusiveZone: Config.reserveSpace ? Config.collapsedHeight : 0
        keyboardFocus: notch.wantsKeyboard || (notch.expanded && notch.keyboardOpened)

        /* the pointer only lands on the notch (and where it's growing to);
           everywhere else it falls through to the windows below */
        inputRect: {
            const grow = notch.expanded ? app.margin : 0;
            const w = Math.max(notch.width, notch.expanded ? notch.ew : 0, notch.peekActive ? (notch.peekOpts.width ?? 0) : 0)
                + 2 * Theme.earPx + 2 * grow;
            const h = notch.y + Math.max(notch.height, notch.targetH) + grow;
            return Qt.rect(Math.floor((width - w) / 2), 0, Math.ceil(w), Math.ceil(h));
        }
        /* translucent background colours get KWin's blur behind them */
        blurRect: Theme.bg.a < 1 ? Qt.rect(notch.x, notch.y, notch.width, notch.height) : Qt.rect(0, 0, 0, 0)
        blurRadius: notch.radius

        Notch {
            id: notch
            x: Math.round((win.width - width) / 2)
            y: covered ? islandGap : 0
            Behavior on y { NumberAnimation { duration: 260; easing.type: Easing.OutCubic } }
            focus: true
            /* windows on this screen reaching up under the notch's centre line */
            readonly property var reaching: Config.islandWhenCovered
                ? Windows.windows.filter(w => w.shown && w.spansCentre && (!win.screen || w.output === win.screen.name)
                                              && (w.fullScreen || w.topGap < Config.collapsedHeight))
                : []
            /* ignored for a moment at start: until the reserved strip applies,
               maximized windows still reach the top edge */
            property bool settled: false
            Timer { interval: 1500; running: true; onTriggered: notch.settled = true }
            covered: settled && reaching.length > 0
            onOpenSettings: page => app.showSettings(page)
        }
        Component.onCompleted: visible = true
    }

    property Loader settings: Loader {
        active: false
        source: Qt.resolvedUrl("settings/SettingsWindow.qml")
        onLoaded: item.closing.connect(() => Qt.callLater(() => active = false))
    }
    function showSettings(page) {
        settings.active = true;
        if (page) settings.item.page = page;
        settings.item.show();
        settings.item.raise();
        settings.item.requestActivate();
    }

    property Connections commands: Connections {
        target: Sys
        function onToggleRequested() { notch.toggle(); }
        function onCommandReceived(name, arg) { app.command(name, arg); }
    }

    function command(name, arg) {
        switch (name) {
        case "toggle": notch.toggle(); break;
        case "expand": if (arg) notch.switchTab(arg); if (!notch.expanded) notch.expand(); break;
        case "collapse": if (notch.expanded) notch.collapse(); break;
        case "tab": notch.goToTab(arg); break;
        case "settings": showSettings(arg); break;
        case "screenshot": win.screenshot(arg || `${Sys.cacheDir}/screenshot.png`); break;
        case "peek": demoPeek(arg); break;
        case "shot": shot(arg); break;
        default: console.warn("nexnotch: unknown command", name);
        }
    }

    /* sample peeks, for trying the look: --command peek --arg charger */
    function demoPeek(kind) {
        const p = notch.peeks;
        if (notch.expanded) notch.collapse();
        switch (kind) {
        case "notification": p.notification({id: 0, appName: "Messages", summary: "Ada Lovelace", body: "Are we still on for the demo at four? I've got the new engine diagrams ready.",
            appIcon: "mail-unread", actions: [{key: "reply", label: "Reply"}, {key: "later", label: "Later"}], image: "", urgency: 1}); break;
        case "music": p.music(Services.media.info ?? {title: "Song Title", artist: "Artist"}); break;
        case "charger": p.charger({plugged: true, percentage: 76, state: "charging"}); break;
        case "unplug": p.charger({plugged: false, percentage: 15, state: "discharging"}); break;
        case "osd": p.osd("audio-volume-medium-symbolic", 0.62, 1, ""); break;
        case "dnd": p.toggle("dnd", true); break;
        case "airplane": p.toggle("airplane", false); break;
        case "capslock": p.toggle("capslock", true); break;
        case "camera": case "mic": p.privacy(kind); break;
        case "water": p.water(); break;
        case "drop": p.drop("hover"); break;
        case "droppill": p.drop("pill"); break;
        case "shelf": p.shelfAdded(3); break;
        default: console.warn("nexnotch: peeks are notification music charger unplug osd dnd airplane capslock camera mic water drop droppill shelf");
        }
    }

    /* For development: "tab=weather;peek=;wait=1500;out=/tmp/x.png;quit" opens
       a tab (or shows a peek), waits, saves a screenshot of the window, and
       optionally quits. "settings=<page>" captures that settings page instead.
       Works with QT_QPA_PLATFORM=offscreen. */
    function shot(spec) {
        const o = {};
        for (const part of (spec || "").split(";")) {
            const [k, v] = part.split("=");
            if (k) o[k.trim()] = v === undefined ? true : v;
        }
        if (o.tab) { notch.switchTab(o.tab); notch.expand(); }
        if (o.peek) demoPeek(o.peek);
        /* the island states, without a real window under the notch */
        if (o.island) notch.covered = true;
        if (o.settings) showSettings(o.settings === true ? "" : o.settings);
        const t = Qt.createQmlObject("import QtQuick; Timer {}", app);
        t.interval = Number(o.wait ?? 1500);
        t.triggered.connect(() => {
            const out = o.out || `${Sys.cacheDir}/shot.png`;
            if (o.settings) {
                settings.item.contentItem.children[0].grabToImage(r => {
                    console.warn("nexnotch: shot", r.saveToFile(out) ? out : "FAILED");
                    if (o.quit) Qt.quit();
                });
                return;
            }
            console.warn("nexnotch: shot", win.screenshot(out) ? out : "FAILED");
            if (o.quit) Qt.quit();
        });
        t.start();
    }

    Component.onCompleted: {
        if (openSettings) showSettings("");
        if (startCommand) Qt.callLater(() => command(startCommand, startArg));
        if (!testMode) Sys.setAutostart(Config.autostart);
    }
    property Connections _autostart: Connections {
        target: Config
        function onAutostartChanged() { if (!app.testMode) Sys.setAutostart(Config.autostart); }
    }
}
