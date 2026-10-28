import QtQuick

/* Everything that makes the notch peek open: notifications, a new track,
   the charger, volume/brightness, toggles, camera/mic, meetings, water and
   the shelf. Sizes are the GNOME extension's. */
QtObject {
    id: peeks
    property var notch
    readonly property bool allowed: Config.showNotifications
    readonly property bool quiet: Services.status.dnd

    property Component notificationComp: PeekNotification {}
    property Component musicComp: PeekMusic {}
    property Component chargerComp: PeekCharger {}
    property Component osdComp: PeekOsd {}
    property Component toggleComp: PeekToggle {}
    property Component privacyComp: PeekPrivacy {}
    property Component waterComp: PeekWater {}
    property Component dropComp: PeekDrop {}
    property Component shelfAddedComp: PeekShelfAdded {}
    property Component screenshotComp: PeekScreenshot {}

    function isScreenshot(n) {
        return /spectacle/i.test(n.desktopEntry + " " + n.appName) && !!(n.image || n.urls?.length);
    }

    function notification(n) {
        if (notch.expanded || !allowed) return;
        /* a screenshot is the user's own action, so it shows even in DND */
        const shot = isScreenshot(n);
        if (quiet && !shot && n.urgency !== 2) return;
        if (shot) {
            notch.showPeek(screenshotComp, {n}, {width: 306, height: 65, duration: notch.powerPeekMs,
                onClick: () => Services.notifications.activate(n)});
            return;
        }
        notch.showPeek(notificationComp, {n}, {width: 440, fit: true, minHeight: 72, maxHeight: 240});
    }

    function music(info) {
        if (quiet || !allowed) return;
        notch.showPeek(musicComp, {info}, {width: 324, height: 72,
            onClick: () => { notch.switchTab("history"); notch.expand(); }});
    }

    /* charger plugged in or out; UPower reports it at once, unlike the battery poll */
    function charger(info) {
        if (!allowed) return;
        notch.showPeek(chargerComp, {info}, {width: 212, height: notch.ch, duration: notch.powerPeekMs});
    }

    /* repeated key presses update the same peek and keep it open */
    function osd(icon, level, maxLevel, label) {
        if (notch.expanded) return;
        const cur = notch.peekItem;
        if (cur && cur.isOsd) {
            cur.icon = icon; cur.level = level; cur.maxLevel = maxLevel; cur.label = label;
            notch.armPeekTimer(notch.osdMs);
            return;
        }
        notch.showPeek(osdComp, {icon, level, maxLevel, label}, {width: 270, height: 32, duration: notch.osdMs, hold: false});
    }

    /* "Do Not Disturb · On" / "Airplane Mode · Off" / "Caps Lock · On" */
    function toggle(kind, on) {
        if (!allowed) return;
        notch.showPeek(toggleComp, {kind, on}, {width: kind === "capslock" ? 212 : 252, height: notch.ch, duration: notch.powerPeekMs});
    }

    /* camera or mic just started: which one, and the app using the mic */
    function privacy(kind) {
        if (!allowed) return;
        const app = kind === "mic" ? Services.status.micApp : "";
        notch.showPeek(privacyComp, {kind, title: kind === "camera" ? "Camera in use" : "Microphone in use", subtitle: app ? `by ${app}` : ""},
            {width: 270, height: 47, duration: notch.powerPeekMs});
    }

    function meeting() {
        if (!allowed || !Services.status.meeting) return;
        notch.showPeek(privacyComp, {kind: "camera", title: "In a meeting", subtitle: Services.status.meeting.service},
            {width: 270, height: 47, duration: notch.powerPeekMs, onClick: () => Services.status.goToMeeting()});
    }

    function water() {
        if (quiet || !allowed) return;
        notch.showPeek(waterComp, {}, {width: 324, height: 72,
            onClick: () => { notch.switchTab("water"); notch.expand(); }});
    }

    /* A drag over the notch: a big drop zone while it's there. */
    function drop(state) {
        const cur = notch.peekItem;
        if (cur && cur.isDrop) { cur.dropState = state; return; }
        if (state === "hover") notch.showPeek(dropComp, {dropState: state}, {width: 504, height: 170, duration: 0, hold: false});
        else notch.showPeek(dropComp, {dropState: state}, {width: 288, height: 54, duration: 0, hold: false});
    }

    function shelfAdded(n) {
        notch.showPeek(shelfAddedComp, {count: n}, {width: 234, height: notch.ch, duration: notch.shelfPeekMs,
            onClick: () => { notch.switchTab("shelf"); notch.expand(); }});
    }

    property Connections _notifs: Connections {
        target: Services.notifications
        function onPeek(n) { peeks.notification(n); }
    }
    property Connections _media: Connections {
        target: Services.media
        function onTrackStarted(info) { peeks.music(info); }
    }
    property Connections _power: Connections {
        target: Services.power
        function onChargerChanged(info) { peeks.charger(info); }
    }
    property Connections _audio: Connections {
        target: Services.audio
        function onOsd(icon, level, maxLevel, label) { peeks.osd(icon, level, maxLevel, label); }
    }
    property Connections _brightness: Connections {
        target: Services.brightness
        function onOsd(icon, level, maxLevel, label) { peeks.osd(icon, level, maxLevel, label); }
    }
    property Connections _status: Connections {
        target: Services.status
        function onToggled(kind, on) { peeks.toggle(kind, on); }
        function onPrivacyStarted(kind) { peeks.privacy(kind); }
        function onMeetingStarted() { peeks.meeting(); }
    }
    property Connections _water: Connections {
        target: Services.water
        function onDue() { peeks.water(); }
    }
}
