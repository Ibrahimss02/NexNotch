import QtQuick
import QtQuick.Layouts
import QtQuick.Shapes

/* The notch: a pill at the top centre that springs open into the tabbed hub
   on hover and peeks open for events. Ported from the GNOME extension's
   notch.js; the timings, sizes and spring are the same. */
Item {
    id: notch

    // ——— tunables (notch.js) ———
    readonly property int hoverDelayMs: 180
    readonly property int collapseDelayMs: 300
    readonly property int animMs: 260
    readonly property int peekDurationMs: 4000
    readonly property int peekUnhoverMs: 400
    readonly property int osdMs: 1500
    readonly property int powerPeekMs: 3000
    readonly property int shelfPeekMs: 2200
    readonly property real slidePx: 48       // how far tab content slides on a switch
    readonly property real pagePx: 220       // drag distance per tab; past half of it the tab flips
    readonly property int flickMs: 180       // how far ahead a flick's speed is projected
    readonly property int maxFlickTabs: 3
    readonly property int maxExpandedHeight: 640

    readonly property var tabIds: ["history", "system", "claude", "calendar", "notes", "shelf", "weather", "pomodoro", "water", "quick"]
    readonly property var tabFiles: ({history: "HistoryTab", system: "SystemTab", claude: "ClaudeTab", calendar: "CalendarTab",
        notes: "NotesTab", shelf: "ShelfTab", weather: "WeatherTab", pomodoro: "PomodoroTab", water: "WaterTab", quick: "QuickTab"})
    readonly property var tabLabels: ({history: "Notifs", system: "System", calendar: "Cal", notes: "Notes", weather: "Weather",
        pomodoro: "Timer", quick: "Quick", claude: "Limits", shelf: "Shelf", water: "Water"})

    // ——— state ———
    property bool expanded: false
    property bool peekActive: false
    property string activeTab: "history"
    property var peekItem: null
    property var peekOpts: ({})
    property string submenuReturn: ""     // a list opened from another tab visits Quick, then goes back
    property bool shelfPending: false     // a drop while collapsed: the next open shows the Shelf
    property string shelfDrop: ""         // "" | "hover" while a drag is over the notch
    /* held open while typing a note, seeking, or dropping */
    property bool notesFocused: false
    property bool seeking: false
    property bool wantsKeyboard: notesFocused

    readonly property int cwMin: Config.collapsedWidth
    readonly property int ch: Config.collapsedHeight
    readonly property int ew: Config.expandedWidth
    readonly property int eh: Config.expandedHeight
    readonly property real radius: Math.round(Math.min(Config.cornerRadius, height / 2))

    /* A window behind the notch: it lets go of the screen edge and floats as
       an island, rounded all round. At rest it hides, shrunk to a small spot
       that still opens it on hover; peeks still show. */
    property bool covered: false
    readonly property int islandGap: 8
    readonly property int islandWidth: 120
    readonly property bool compact: covered && !expanded && !peekActive
    onCompactChanged: resizeCollapsed(true)
    opacity: compact ? 0 : 1
    Behavior on opacity { NumberAnimation { duration: 220 } }

    signal openSettings(string page)

    width: cwMin
    height: ch
    clip: false

    function tabEnabled(id) {
        if (id === "system") return Config.showSystem;
        if (id === "calendar") return Config.showCalendar;
        if (id === "claude") return Config.showClaudeUsage;
        return true;
    }
    readonly property var tabOrder: tabIds.filter(id => tabEnabled(id))
    onTabOrderChanged: if (!tabEnabled(activeTab)) switchTab("history")

    Component.onCompleted: {
        const last = Config.lastTab;
        activeTab = tabIds.includes(last) && tabEnabled(last) ? last : "history";
        resizeCollapsed(false);
    }

    // ——— size animation ———

    /* A damped spring: past the target, back, settled. Lower damping bounces
       more; the stiffness is picked so it has settled by `duration`. */
    property real _w0: 0
    property real _h0: 0
    property real _w1: 0
    property real _h1: 0
    property real _damping: 0.6
    property int _springMs: 640
    property real springT: 0
    property var _springDone: null
    property real targetH: ch
    NumberAnimation {
        id: springAnim
        target: notch; property: "springT"
        from: 0; to: 1; easing.type: Easing.Linear
        onFinished: {
            notch.width = notch._w1;
            notch.height = notch._h1;
            const done = notch._springDone;
            notch._springDone = null;
            done?.();
        }
    }
    onSpringTChanged: {
        if (!springAnim.running) return;
        const z = _damping, d = _springMs / 1000;
        const omega = 5.3 / (z * d);
        const omegaD = omega * Math.sqrt(1 - z * z);
        const t = springT * d;
        const p = 1 - Math.exp(-z * omega * t) * (Math.cos(omegaD * t) + z * omega / omegaD * Math.sin(omegaD * t));
        width = _w0 + (_w1 - _w0) * p;
        height = Math.max(1, _h0 + (_h1 - _h0) * p);
    }
    function springTo(w, h, duration, damping, done) {
        stopSizeAnim();
        targetH = h;
        _w0 = width; _h0 = height; _w1 = w; _h1 = h;
        _damping = damping; _springMs = duration; _springDone = done ?? null;
        springAnim.duration = duration;
        springAnim.start();
    }
    ParallelAnimation {
        id: easeAnim
        property alias w: wAnim.to
        property alias h: hAnim.to
        property int ms: 180
        property int curve: Easing.OutExpo
        NumberAnimation { id: wAnim; target: notch; property: "width"; duration: easeAnim.ms; easing.type: easeAnim.curve }
        NumberAnimation { id: hAnim; target: notch; property: "height"; duration: easeAnim.ms; easing.type: easeAnim.curve }
    }
    function easeTo(w, h, ms, curve) {
        stopSizeAnim();
        targetH = h;
        easeAnim.w = w; easeAnim.h = h; easeAnim.ms = ms; easeAnim.curve = curve ?? Easing.OutExpo;
        easeAnim.start();
    }
    function stopSizeAnim() {
        if (springAnim.running) { springAnim.stop(); _springDone = null; }
        easeAnim.stop();
    }

    function collapsedWidth() { return Math.max(cwMin, Math.ceil(pill.implicitWidth)); }
    /* the size it rests at: the pill, or the island's bare capsule */
    function restWidth() { return compact ? islandWidth : collapsedWidth(); }
    function resizeCollapsed(animate) {
        if (expanded || peekActive) return;
        const w = restWidth();
        if (animate === false) { stopSizeAnim(); width = w; height = ch; targetH = ch; }
        else if (Math.abs(w - width) > 0.5 || Math.abs(height - ch) > 0.5) easeTo(w, ch, 220, Easing.OutExpo);
    }
    onCwMinChanged: resizeCollapsed(false)
    onChChanged: resizeCollapsed(false)
    onEwChanged: if (expanded) { stopSizeAnim(); width = ew; height = expandedHeight(); }

    // ——— hover → expand / collapse ———

    property bool hovered: hover.hovered
    onHoveredChanged: {
        if (hovered) { keyboardOpened = false; scheduleExpand(); }
        else scheduleCollapse();
    }
    HoverHandler { id: hover }

    Timer {
        id: hoverTimer
        interval: notch.hoverDelayMs
        onTriggered: {
            if (notch.peekActive || pill.buttonHovered) return;
            if (notch.hovered) notch.expand();
        }
    }
    Timer {
        id: collapseTimer
        interval: notch.collapseDelayMs
        onTriggered: {
            if (notch.hovered || notch.notesFocused || notch.seeking || notch.shelfDrop) { restart(); return; }
            notch.collapse();
        }
    }
    function scheduleExpand() {
        if (expanded) { collapseTimer.stop(); return; }
        /* Don't hijack a notification click: while a peek shows, hovering
           means "I'm moving to click it", not "open the notch". */
        if (peekActive) return;
        hoverTimer.restart();
    }
    function scheduleCollapse() {
        hoverTimer.stop();
        if (!expanded || keyboardOpened) return;
        collapseTimer.restart();
    }

    /* opened with Super+N: stays until toggled, Escape, or a hover-and-leave */
    property bool keyboardOpened: false
    function toggle() {
        if (expanded) collapse();
        else { expand(); keyboardOpened = !hovered; }
    }

    function expand() {
        if (peekActive) dismissPeek(true);
        expanded = true;
        expandedLayer.visible = true;
        clock.update();
        contentHost.tx = 0;
        contentHost.opacity = 1;
        switchTab(shelfPending ? "shelf" : activeTab);
        shelfPending = false;
        springTo(ew, expandedHeight(), 640, 0.6);
        pillFade.stop();
        pill.opacity = 0;
        expandIn.restart();
    }

    function collapse() {
        keyboardOpened = false;
        if (submenuReturn) { activeTab = submenuReturn; submenuReturn = ""; }
        shelfDrop = "";
        notesFocused = false;
        expanded = false;
        /* The notch closes over its content (clipped) and the pill fades in
           before that content is gone, so it never shrinks as an empty box. */
        springTo(restWidth(), ch, 520, 0.78);
        pill.opacity = 0;
        pillFade.restart();
        expandOut.restart();
    }

    SequentialAnimation {
        id: pillFade
        PauseAnimation { duration: notch.animMs * 0.45 }
        NumberAnimation { target: pill; property: "opacity"; to: 1; duration: notch.animMs * 0.8; easing.type: Easing.OutQuad }
    }
    ParallelAnimation {
        id: expandIn
        NumberAnimation { target: expandedLayer; property: "opacity"; from: 0; to: 1; duration: notch.animMs; easing.type: Easing.OutCubic }
        NumberAnimation { target: expandedLayer; property: "scale"; from: 0.97; to: 1; duration: notch.animMs; easing.type: Easing.OutCubic }
    }
    SequentialAnimation {
        id: expandOut
        NumberAnimation { target: expandedLayer; property: "opacity"; to: 0; duration: notch.animMs * 0.9; easing.type: Easing.InQuad }
        ScriptAction { script: if (!notch.expanded) expandedLayer.visible = false }
    }

    // ——— tabs ———

    function switchTab(id) {
        if (activeTab === "notes" && id !== "notes") notesFocused = false;
        activeTab = id;
        if (!submenuReturn && Config.lastTab !== id) Config.lastTab = id;
    }

    /* Slide the current tab out, swap, and slide the new one in from the
       side it came from. dir: +1 = next (content moves left). */
    function goToTab(id, dir) {
        const order = tabOrder;
        dir = dir || Math.sign(order.indexOf(id) - order.indexOf(activeTab)) || 1;
        slideOut.stop(); slideIn.stop(); settle.stop();
        if (id === activeTab || !expanded) {
            if (id !== activeTab) switchTab(id);
            settle.start();
            return;
        }
        slideOut.dir = dir;
        slideOut.next = id;
        slideOut.start();
    }
    function stepTab(step) {
        const order = tabOrder;
        const next = order[order.indexOf(activeTab) + step];
        if (next) goToTab(next, step);
    }
    SequentialAnimation {
        id: slideOut
        property int dir: 1
        property string next: ""
        ParallelAnimation {
            NumberAnimation { target: contentHost; property: "tx"; to: -slideOut.dir * notch.slidePx; duration: 110; easing.type: Easing.InQuad }
            NumberAnimation { target: contentHost; property: "opacity"; to: 0; duration: 110; easing.type: Easing.InQuad }
        }
        ScriptAction { script: { notch.switchTab(slideOut.next); contentHost.tx = slideOut.dir * notch.slidePx; slideIn.start(); } }
    }
    ParallelAnimation {
        id: slideIn
        NumberAnimation { target: contentHost; property: "tx"; to: 0; duration: 300; easing.type: Easing.OutCubic }
        NumberAnimation { target: contentHost; property: "opacity"; to: 1; duration: 300; easing.type: Easing.OutCubic }
    }
    ParallelAnimation {
        id: settle
        NumberAnimation { target: contentHost; property: "tx"; to: 0; duration: 320; easing.type: Easing.OutBack }
        NumberAnimation { target: contentHost; property: "opacity"; to: 1; duration: 320 }
    }

    /* a list opened from another tab (the player's Output) visits Quick
       without becoming the last tab, and goes back when it closes */
    function visitQuick(submenu) {
        Services.quickSubmenu = submenu;
        if (activeTab === "quick") return;
        submenuReturn = activeTab;
        goToTab("quick");
    }
    function closeSubmenu() {
        const back = submenuReturn;
        submenuReturn = "";
        if (back && expanded) goToTab(back);
    }

    function expandedHeight() {
        const natural = expandedCol.topPadding + header.height + expandedCol.spacing
            + (tabLoader.item?.implicitHeight ?? 0) + expandedCol.spacing + dots.height + expandedCol.bottomPadding;
        return Math.max(eh, Math.min(maxExpandedHeight, Math.ceil(natural)));
    }
    function resizeExpanded() {
        if (!expanded) return;
        const target = expandedHeight();
        /* already heading there (e.g. expand still running): don't restart the spring */
        if (Math.abs(targetH - target) > 2) springTo(ew, target, 460, 0.75);
    }

    // ——— swipe between tabs ———

    property var _swipe: null
    Timer { id: swipeEnd; interval: 180; onTriggered: notch.endSwipe() }

    /* Touchpad: content follows the fingers and flips tabs mid-gesture every
       half page, so a long swipe runs through several; on release a flick's
       speed carries on up to maxFlickTabs more. */
    function onSwipe(dx, dy, finished) {
        const s = _swipe ?? (_swipe = {x: 0, y: 0, axis: null, pages: 0, track: []});
        s.x += dx; s.y += dy;
        if (!s.axis && Math.hypot(s.x, s.y) > 6) s.axis = Math.abs(s.x) > Math.abs(s.y) ? "x" : "y";
        if (finished) swipeEnd.stop(); else swipeEnd.restart();
        if (s.axis !== "x") {
            if (finished) _swipe = null;
            return s.axis === null && Math.abs(s.x) > Math.abs(s.y);
        }
        const finger = s.x;
        const now = Sys.monotonicMs();
        s.track.push([now, finger]);
        while (s.track.length > 2 && now - s.track[0][0] > 100) s.track.shift();
        const order = tabOrder;
        let i = order.indexOf(activeTab);
        let t = finger + s.pages * pagePx;
        while (t < -pagePx / 2 && i < order.length - 1) { s.pages++; t += pagePx; switchTab(order[++i]); }
        while (t > pagePx / 2 && i > 0) { s.pages--; t -= pagePx; switchTab(order[--i]); }
        if ((t < 0 && i >= order.length - 1) || (t > 0 && i <= 0)) t *= 0.3;   // rubber band at the ends
        slideOut.stop(); slideIn.stop(); settle.stop();
        contentHost.tx = t;
        contentHost.opacity = 1 - Math.min(0.6, Math.abs(t) / pagePx);
        if (finished) endSwipe();
        return true;
    }
    function endSwipe() {
        const s = _swipe;
        _swipe = null;
        swipeEnd.stop();
        if (s?.axis !== "x") return;
        const [t0, x0] = s.track[0] ?? [0, 0];
        const [t1, x1] = s.track[s.track.length - 1] ?? [0, 0];
        const velocity = t1 > t0 ? (x1 - x0) / (t1 - t0) : 0;   // px per ms
        const projected = contentHost.tx + velocity * flickMs;
        const order = tabOrder, i = order.indexOf(activeTab);
        const steps = Math.max(-maxFlickTabs, Math.min(maxFlickTabs, Math.round(-projected / pagePx)));
        const target = Math.max(0, Math.min(order.length - 1, i + steps));
        goToTab(order[target], Math.sign(target - i));
    }
    property double _lastWheelStep: 0

    // ——— peeks ———

    /* `component` fills the notch at width×height for `duration` ms (0 =
       until dismissed). Hovering holds it open; leaving dismisses. With
       fit, the height follows the peek's implicitHeight (clamped). */
    function showPeek(component, props, opts) {
        if (expanded) return null;
        dismissPeek(true);
        opts = Object.assign({duration: peekDurationMs, hold: true, onClick: null, fit: false, minHeight: 72, maxHeight: 240}, opts);
        const item = component.createObject(peekHost, Object.assign({notch: notch}, props ?? {}));
        if (!item) return null;
        item.anchors.fill = peekHost;
        peekItem = item;
        peekOpts = opts;
        peekActive = true;
        pill.visible = false;
        item.opacity = 0;
        peekIn.target = item;
        peekIn.restart();
        const h = opts.fit ? fitHeight(item) : opts.height;
        springTo(opts.width, h, 520, 0.68);
        if (opts.duration) armPeekTimer(opts.duration);
        else peekTimer.stop();
        return item;
    }
    function fitHeight(item) {
        return Math.max(peekOpts.minHeight, Math.min(peekOpts.maxHeight, Math.ceil(item.implicitHeight)));
    }
    function refit() {
        if (!peekActive || !peekOpts.fit || !peekItem) return;
        easeTo(peekOpts.width, fitHeight(peekItem), 260, Easing.OutQuint);
    }
    function armPeekTimer(ms) { peekTimer.interval = ms; peekTimer.restart(); }
    Timer { id: peekTimer; onTriggered: notch.dismissPeek(false) }
    NumberAnimation { id: peekIn; property: "opacity"; to: 1; duration: 180; easing.type: Easing.OutQuad }

    function dismissPeek(immediate) {
        peekTimer.stop();
        if (!peekActive) return;
        peekActive = false;
        const item = peekItem;
        peekItem = null;
        const finalize = () => {
            item?.destroy();
            if (expanded || peekActive) return;
            pill.visible = true;
            pill.opacity = 1;
            easeTo(restWidth(), ch, 220, Easing.OutExpo);
        };
        if (immediate) finalize(); else Qt.callLater(finalize);
    }

    property bool peekHovered: peekHover.hovered
    onPeekHoveredChanged: {
        if (!peekActive || !peekOpts.hold) return;
        if (peekHovered) peekTimer.stop();
        else armPeekTimer(peekUnhoverMs);
    }

    // ——— drop files on the notch → Shelf ———

    property int _dropCount: 0
    property bool _dropPeek: false
    function onDropZone(state) {
        const shelf = Services.shelf;
        if (state === "end") {
            const added = shelf.items.length - _dropCount;
            const wasPeek = _dropPeek;
            shelfDrop = "";
            _dropPeek = false;
            if (expanded) return;
            shelfPending = shelfPending || added > 0;   // the next open shows the Shelf
            if (added > 0) peeks.shelfAdded(shelf.items.length);
            else if (wasPeek) dismissPeek(false);
            return;
        }
        if (!shelfDrop) _dropCount = shelf.items.length;
        shelfDrop = state;
        if (expanded) {
            if (activeTab !== "shelf") switchTab("shelf");
        } else {
            _dropPeek = true;
            peeks.drop(state);
        }
    }

    // ——— drawing ———

    /* lyrics on: the pill fades from the notch colour into the cover's */
    readonly property color lyricTint: pill.mode === "lyric" ? Qt.darker(Services.media.accent, 2) : "transparent"

    Rectangle {
        id: bg
        anchors.fill: parent
        color: Theme.bg
        topLeftRadius: notch.covered ? notch.radius : 0
        topRightRadius: notch.covered ? notch.radius : 0
        bottomLeftRadius: notch.radius
        bottomRightRadius: notch.radius
        gradient: notch.lyricTint.a > 0 && !notch.expanded ? lyricGradient : null
        Gradient {
            id: lyricGradient
            GradientStop { position: 0; color: Theme.bg }
            GradientStop { position: 1; color: notch.lyricTint }
        }
    }

    /* concave corners either side of the top edge, so the notch flows out of
       the screen edge instead of starting with a hard step */
    Repeater {
        model: [false, true]
        Shape {
            required property bool modelData
            width: Theme.earPx; height: Theme.earPx
            x: modelData ? notch.width : -Theme.earPx
            y: 0
            opacity: notch.covered ? 0 : 1
            Behavior on opacity { NumberAnimation { duration: 160 } }
            preferredRendererType: Shape.CurveRenderer
            ShapePath {
                fillColor: Theme.bg
                strokeColor: "transparent"
                startX: modelData ? 0 : Theme.earPx; startY: 0
                PathLine { x: modelData ? Theme.earPx : 0; y: 0 }
                PathArc {
                    x: modelData ? 0 : Theme.earPx; y: Theme.earPx
                    radiusX: Theme.earPx; radiusY: Theme.earPx
                    /* centred on the ear's outer bottom corner: the curve bends in */
                    direction: modelData ? PathArc.Counterclockwise : PathArc.Clockwise
                }
                PathLine { x: modelData ? 0 : Theme.earPx; y: 0 }
            }
        }
    }

    Item {
        id: clipper
        anchors.fill: parent
        clip: true      // swiped tab content must not spill past the background

        Pill {
            id: pill
            notch: notch
            width: Math.max(notch.width, implicitWidth)
            height: notch.ch
            anchors.horizontalCenter: parent.horizontalCenter
            onImplicitWidthChanged: notch.resizeCollapsed(true)
        }

        Item {
            id: expandedLayer
            visible: false
            opacity: 0
            width: notch.ew
            height: Math.max(notch.targetH, notch.height)
            anchors.horizontalCenter: parent.horizontalCenter
            transformOrigin: Item.Top

            ColumnLayout {
                id: expandedCol
                anchors.fill: parent
                property int topPadding: 20
                property int bottomPadding: 13
                anchors.topMargin: topPadding
                anchors.bottomMargin: bottomPadding
                anchors.leftMargin: 20
                anchors.rightMargin: 20
                spacing: 14

                RowLayout {
                    id: header
                    Layout.fillWidth: true
                    Layout.leftMargin: 7
                    Layout.rightMargin: 7
                    NText { text: clock.time; size: 31; weight: Font.DemiBold; tnum: true; font.letterSpacing: -0.6 }
                    Item { Layout.fillWidth: true }
                    ColumnLayout {
                        spacing: 0
                        NText { Layout.alignment: Qt.AlignRight; text: clock.weekday; size: 12; weight: Font.DemiBold }
                        NText { Layout.alignment: Qt.AlignRight; text: clock.dayMonth; size: 12; color: Theme.textDim }
                    }
                }

                Item {
                    id: contentHost
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    property real tx: 0
                    transform: Translate { x: contentHost.tx }
                    Loader {
                        id: tabLoader
                        width: parent.width
                        height: Math.max(parent.height, implicitHeight)
                        active: notch.expanded || expandedLayer.visible
                        source: active ? Qt.resolvedUrl("tabs/" + notch.tabFiles[notch.activeTab] + ".qml") : ""
                        onLoaded: {
                            item.notch = notch;
                            Qt.callLater(notch.resizeExpanded);
                        }
                    }
                    Connections {
                        target: tabLoader.item
                        ignoreUnknownSignals: true
                        function onImplicitHeightChanged() { Qt.callLater(notch.resizeExpanded); }
                    }
                }

                /* tabs change by swiping; the dots show where you are and can be clicked */
                Row {
                    id: dots
                    Layout.alignment: Qt.AlignHCenter
                    Layout.topMargin: 2
                    spacing: 5
                    Repeater {
                        model: notch.tabOrder
                        Rectangle {
                            required property string modelData
                            readonly property bool current: modelData === notch.activeTab
                            width: current ? 16 : 5
                            height: 5; radius: 3
                            color: current ? Theme.text : dotMouse.containsMouse ? "#7C7C80" : Theme.disabled
                            Behavior on width { NumberAnimation { duration: 200 } }
                            Accessible.role: Accessible.PageTab
                            Accessible.name: notch.tabLabels[modelData]
                            MouseArea {
                                id: dotMouse
                                anchors.fill: parent
                                anchors.margins: -4
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: notch.goToTab(parent.modelData)
                            }
                        }
                    }
                }
            }
        }

        Item {
            id: peekHost
            anchors.fill: parent
            HoverHandler { id: peekHover; enabled: notch.peekActive }
            /* under the peek, so its own buttons (Drink, Stop) keep their clicks */
            MouseArea {
                anchors.fill: parent
                z: -1
                enabled: notch.peekActive && !!notch.peekOpts.onClick
                cursorShape: Qt.PointingHandCursor
                onClicked: {
                    const cb = notch.peekOpts.onClick;
                    notch.dismissPeek(false);
                    cb?.();
                }
            }
        }
    }

    Connections {
        target: notch.peekItem
        ignoreUnknownSignals: true
        function onImplicitHeightChanged() { notch.refit(); }
    }

    /* Horizontal swipes change tabs. On top of everything so a scrolling list
       inside a tab can't eat them; vertical scrolling passes on. */
    MouseArea {
        anchors.fill: parent
        enabled: notch.expanded
        acceptedButtons: Qt.NoButton
        onWheel: wheel => {
            const touchpad = wheel.pixelDelta.x !== 0 || wheel.pixelDelta.y !== 0;
            const shift = wheel.modifiers & Qt.ShiftModifier;
            if (touchpad && !shift) {
                const finished = wheel.phase === Qt.ScrollEnd;
                wheel.accepted = notch.onSwipe(wheel.pixelDelta.x, wheel.pixelDelta.y, finished) || !!notch._swipe && notch._swipe.axis === "x";
                return;
            }
            const d = Math.abs(wheel.angleDelta.x) > Math.abs(wheel.angleDelta.y) ? wheel.angleDelta.x : shift ? wheel.angleDelta.y : 0;
            if (!d) { wheel.accepted = false; return; }
            const now = Sys.monotonicMs();
            if (now - notch._lastWheelStep > 250) {
                notch._lastWheelStep = now;
                notch.stepTab(d < 0 ? 1 : -1);
            }
            wheel.accepted = true;
        }
    }

    DropArea {
        anchors.fill: parent
        anchors.margins: -8
        keys: ["text/uri-list"]
        /* a shelf tile being dragged out starts over the notch: not a drop */
        onEntered: drag => {
            if (drag.hasUrls && !Services.shelf.draggingOut) notch.onDropZone("hover");
            else drag.accepted = false;
        }
        onExited: if (notch.shelfDrop) notch.onDropZone("end")
        onDropped: drop => {
            if (drop.hasUrls) {
                Services.shelf.addUrls(drop.urls.map(u => String(u)));
                drop.acceptProposedAction();
            }
            notch.onDropZone("end");
        }
    }

    Keys.onEscapePressed: if (expanded) collapse()

    // ——— the clock (pill, header, rec/meeting pills) ———

    QtObject {
        id: clock
        property string time: ""
        property string weekday: ""
        property string dayMonth: ""
        property string compactDate: ""
        function update() {
            const now = new Date();
            const h12 = Config.clockFormat === "12h";
            const fmt = (h12 ? "hh:mm" : "HH:mm") + (Config.showSeconds ? ":ss" : "") + (h12 ? " AP" : "");
            time = now.toLocaleTimeString(Qt.locale(), fmt);
            weekday = now.toLocaleDateString(Qt.locale(), "dddd");
            const month = now.toLocaleDateString(Qt.locale(), "MMMM");
            dayMonth = `${now.getDate()} ${month}`;
            /* full month name if ≤5 chars, otherwise its first 3 */
            compactDate = `${now.getDate()} ${month.length <= 5 ? month : month.slice(0, 3)}`;
            const period = Config.showSeconds ? 1000 : 60000;
            clockTimer.interval = Math.max(20, period - (Date.now() % period));
            clockTimer.restart();
        }
    }
    property alias clock: clock
    Timer { id: clockTimer; onTriggered: clock.update() }
    Connections {
        target: Config
        function onClockFormatChanged() { clock.update(); }
        function onShowSecondsChanged() { clock.update(); }
    }
    Component.onDestruction: clockTimer.stop()

    /* Timers stop counting during suspend; on resume the pending tick fires
       late and the clock would be minutes behind until it does. */
    property int _sleepSig: DBus.connectSignal("system", "org.freedesktop.login1", "/org/freedesktop/login1",
                                               "org.freedesktop.login1.Manager", "PrepareForSleep")
    Connections {
        target: DBus
        function onSignalReceived(id, member, args) { if (id === notch._sleepSig && !args[0]) clock.update(); }
    }
    Timer { interval: 1; running: true; onTriggered: clock.update() }

    // ——— peek factory ———

    Peeks { id: peeks; notch: notch }
    property alias peeks: peeks
}
