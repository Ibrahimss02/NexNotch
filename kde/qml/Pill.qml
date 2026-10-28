import QtQuick
import QtQuick.Layouts

/* The collapsed notch: battery · clock · date, status icons, timer chip and
   a waveform while music plays. Screen recording/sharing, a meeting, or the
   lyric being sung take the whole pill over, in that order. */
Item {
    id: pill
    property var notch
    readonly property var status: Services.status
    readonly property var media: Services.media
    readonly property var power: Services.power
    readonly property var pomo: Services.pomodoro

    readonly property string mode: status.captureMode ? status.captureMode
        : status.meeting ? "meet"
        : lyricLines.length ? "lyric" : ""
    readonly property bool buttonHovered: stopRec.hovered || stopShare.hovered || meetBtn.hovered

    readonly property var current: mode === "rec" ? recRow : mode === "share" ? shareRow
        : mode === "meet" ? meetRow : mode === "lyric" ? lyricRow : normalRow
    implicitWidth: current.implicitWidth + current.anchors.leftMargin + current.anchors.rightMargin

    // ——— battery ———
    readonly property var battery: power.battery
    readonly property bool batteryShown: {
        const b = battery;
        if (!b) return false;
        const draining = b.status === "discharging";
        return draining || b.plugged || b.capacity > 0;   // desktop with no real battery: hidden
    }
    readonly property color batteryColor: {
        const b = battery;
        if (!b) return Config.batteryNormalColor;
        if (b.plugged || b.status === "charging") return Config.batteryChargingColor;
        if (b.status === "discharging" && b.capacity < 20) return Config.batteryLowColor;
        return Config.batteryNormalColor;
    }

    // ——— normal: battery · clock · date ———
    RowLayout {
        id: normalRow
        visible: pill.mode === ""
        anchors.fill: parent
        anchors.leftMargin: 14
        anchors.rightMargin: 14
        spacing: 0

        Row {
            spacing: 5
            visible: pill.batteryShown
            Layout.alignment: Qt.AlignVCenter
            BatteryGlyph {
                anchors.verticalCenter: parent.verticalCenter
                level: (pill.battery?.capacity ?? 0) / 100
                color: pill.batteryColor
            }
            NText {
                anchors.verticalCenter: parent.verticalCenter
                text: `${pill.battery?.capacity ?? 0}%`
                size: 12; weight: Font.DemiBold; tnum: true
            }
        }
        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true
            implicitWidth: clockText.implicitWidth + 24
            NText {
                id: clockText
                anchors.centerIn: parent
                text: pill.notch.clock.time
                size: 13; weight: Font.DemiBold; tnum: true
                color: Qt.rgba(1, 1, 1, 0.96)
            }
        }
        Row {
            Layout.alignment: Qt.AlignVCenter
            spacing: 0
            NText {
                anchors.verticalCenter: parent.verticalCenter
                visible: Config.showDate && !pomoChip.visible
                text: pill.notch.clock.compactDate
                size: 11; weight: Font.Medium
                color: Theme.textMuted
            }
            /* DND / airplane icons and camera / mic dots, after the date */
            Row {
                anchors.verticalCenter: parent.verticalCenter
                visible: pill.status.dnd || pill.status.airplane || pill.status.camera || pill.status.mic
                leftPadding: 6
                spacing: 5
                NIcon { anchors.verticalCenter: parent.verticalCenter; visible: pill.status.dnd; name: "own:moon"; size: 12 }
                NIcon { anchors.verticalCenter: parent.verticalCenter; visible: pill.status.airplane; name: "own:airplane"; size: 12 }
                Rectangle { anchors.verticalCenter: parent.verticalCenter; visible: pill.status.camera; width: 7; height: 7; radius: 4; color: Theme.green }
                Rectangle { anchors.verticalCenter: parent.verticalCenter; visible: pill.status.mic; width: 7; height: 7; radius: 4; color: Theme.orange }
            }
            Row {
                id: pomoChip
                anchors.verticalCenter: parent.verticalCenter
                visible: pill.pomo.active || pill.pomo.state === "paused"
                spacing: 4
                readonly property color tint: pill.pomo.state === "paused" ? Theme.textDim
                    : (pill.pomo.state === "break" || pill.pomo.state === "longbreak") ? Theme.green : Theme.orange
                NIcon { anchors.verticalCenter: parent.verticalCenter; name: "alarm-symbolic"; size: 13; color: pomoChip.tint }
                NText {
                    anchors.verticalCenter: parent.verticalCenter
                    text: pill.pomo.remainText
                    size: 11; weight: Font.DemiBold; tnum: true
                    color: pomoChip.tint
                    leftPadding: 4; rightPadding: 4
                }
            }
            Item {
                visible: pill.media.active && Config.showMediaPill
                width: wave.width + 9
                height: wave.height
                anchors.verticalCenter: parent.verticalCenter
                Waveform {
                    id: wave
                    x: 9
                    bars: 4
                    color: pill.media.accent
                    playing: !!pill.media.info?.playing
                }
            }
        }
    }

    // ——— recording: ● REC 0:12 · clock · ■ ———
    RowLayout {
        id: recRow
        visible: pill.mode === "rec"
        anchors.fill: parent
        anchors.leftMargin: 13
        anchors.rightMargin: 5
        spacing: 6
        Rectangle {
            width: 8; height: 8; radius: 4; color: Theme.red
            SequentialAnimation on opacity {
                running: recRow.visible; loops: Animation.Infinite
                NumberAnimation { to: 0.35; duration: 600; easing.type: Easing.InOutSine }
                NumberAnimation { to: 1; duration: 600; easing.type: Easing.InOutSine }
            }
        }
        NText { text: pill.status.captureText; size: 12; weight: Font.DemiBold; tnum: true; color: Theme.red }
        NText {
            Layout.fillWidth: true
            horizontalAlignment: Text.AlignHCenter
            text: pill.notch.clock.time
            size: 13; weight: Font.DemiBold; tnum: true
            leftPadding: 12; rightPadding: 12
        }
        NButton {
            id: stopRec
            implicitWidth: 40; implicitHeight: 25; radius: 13
            color: "#3A1210"; hoverColor: "#5A1A16"; pressColor: "#5A1A16"
            accessibleName: "Stop recording"
            onClicked: pill.status.stopCapture()
            Rectangle { anchors.centerIn: parent; width: 9; height: 9; radius: 2; color: Theme.red }
        }
    }

    // ——— sharing: ▣ Sharing screen · Stop ———
    RowLayout {
        id: shareRow
        visible: pill.mode === "share"
        anchors.fill: parent
        anchors.leftMargin: 13
        anchors.rightMargin: 5
        spacing: 6
        NIcon { name: "own:screen-share"; size: 14; color: Theme.purple }
        NText { Layout.fillWidth: true; text: "Sharing screen"; size: 12; weight: Font.DemiBold; color: Theme.purple; rightPadding: 11 }
        NButton {
            id: stopShare
            implicitWidth: stopLabel.implicitWidth + 22; implicitHeight: 25; radius: 13
            color: "#3A1210"; hoverColor: "#5A1A16"; pressColor: "#5A1A16"
            accessibleName: "Stop sharing"
            onClicked: pill.status.stopCapture()
            NText { id: stopLabel; anchors.centerIn: parent; text: "Stop"; size: 11; weight: Font.DemiBold; color: Theme.red }
        }
    }

    // ——— in a meeting: which one and for how long; click to go back to it ———
    RowLayout {
        id: meetRow
        visible: pill.mode === "meet"
        anchors.fill: parent
        anchors.leftMargin: 14
        anchors.rightMargin: 14
        spacing: 0
        NButton {
            id: meetBtn
            implicitWidth: meetChip.implicitWidth + 8
            implicitHeight: 24
            radius: 12
            hoverColor: "transparent"; pressColor: "transparent"
            accessibleName: "Go to the meeting"
            onClicked: pill.status.goToMeeting()
            Row {
                id: meetChip
                anchors.centerIn: parent
                spacing: 6
                NIcon { anchors.verticalCenter: parent.verticalCenter; name: "own:camera"; size: 14; color: Theme.green }
                NText { anchors.verticalCenter: parent.verticalCenter; text: pill.status.meetingText; size: 12; weight: Font.DemiBold; tnum: true; color: Theme.green }
            }
        }
        NText {
            Layout.fillWidth: true
            horizontalAlignment: Text.AlignHCenter
            text: pill.notch.clock.time
            size: 13; weight: Font.DemiBold; tnum: true
            leftPadding: 12; rightPadding: 12
        }
        Row {
            spacing: 5
            Rectangle { anchors.verticalCenter: parent.verticalCenter; visible: pill.status.camera; width: 7; height: 7; radius: 4; color: Theme.green }
            Rectangle { anchors.verticalCenter: parent.verticalCenter; visible: pill.status.mic; width: 7; height: 7; radius: 4; color: Theme.orange }
        }
    }

    // ——— lyrics on: the line being sung replaces the pill ———
    property var lyricLines: []
    property string lyricKey: ""
    property int lyricShown: -2
    readonly property bool lyricsWanted: Config.lyricsEnabled && Config.showMediaPill && !!media.info?.playing && !!media.info?.title
    readonly property string wantedKey: lyricsWanted ? `${media.info.artist}|${media.info.title}|${media.info.album}` : ""
    onWantedKeyChanged: {
        if (wantedKey === lyricKey) return;
        lyricKey = wantedKey;
        lyricLines = [];
        lyricShown = -2;
        if (!wantedKey) return;
        const key = wantedKey;
        media.lyrics.get(media.info).then(result => {
            if (pill.lyricKey !== key) return;
            pill.lyricLines = result?.synced ?? [];
            pill.tickLyric();
        });
    }
    function tickLyric() {
        const lines = lyricLines;
        if (!lines.length) return;
        const i = media.lyrics.lineAt(lines, media.position() / 1000);
        if (i === lyricShown) return;
        lyricShown = i;
        const text = i >= 0 ? (lines[i].text || "• • •") : (media.info?.title ?? "• • •");
        if (!lyricText.text || !lyricRow.visible) { lyricText.text = text; return; }
        lyricSwap.next = text;
        lyricSwap.restart();
    }
    Timer { interval: 250; repeat: true; running: pill.lyricLines.length > 0; onTriggered: pill.tickLyric() }

    RowLayout {
        id: lyricRow
        visible: pill.mode === "lyric"
        anchors.fill: parent
        anchors.leftMargin: 16
        anchors.rightMargin: 18
        spacing: 9
        NIcon { name: "own:note"; size: 14; color: pill.media.accent }
        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true
            implicitWidth: Math.min(340, lyricText.implicitWidth)
            clip: true
            NText {
                id: lyricText
                width: parent.width
                anchors.verticalCenter: parent.verticalCenter
                property real dy: 0
                transform: Translate { y: lyricText.dy }
                size: 12; weight: Font.DemiBold
            }
        }
    }
    SequentialAnimation {
        id: lyricSwap
        property string next: ""
        ParallelAnimation {
            NumberAnimation { target: lyricText; property: "dy"; to: -10; duration: 160; easing.type: Easing.InQuad }
            NumberAnimation { target: lyricText; property: "opacity"; to: 0; duration: 160; easing.type: Easing.InQuad }
        }
        ScriptAction { script: { lyricText.text = lyricSwap.next; lyricText.dy = 10; } }
        ParallelAnimation {
            NumberAnimation { target: lyricText; property: "dy"; to: 0; duration: 260; easing.type: Easing.OutCubic }
            NumberAnimation { target: lyricText; property: "opacity"; to: 1; duration: 260; easing.type: Easing.OutCubic }
        }
    }
}
