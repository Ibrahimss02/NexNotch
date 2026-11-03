import QtQuick
import QtQuick.Layouts

/* Notifs: what's live (recording, sharing, a meeting, camera or mic), the
   Now Playing card (while something plays or is paused), then the
   notification history, newest first. */
Item {
    id: tab
    property var notch
    readonly property var store: Services.notifications
    readonly property var status: Services.status
    implicitHeight: col.implicitHeight

    ColumnLayout {
        id: col
        width: parent.width
        spacing: 11

        LiveRow {
            visible: tab.status.captureMode === "rec"
            tint: Theme.red
            title: "Screen recording"
            subtitle: tab.status.captureText.replace(/^REC\s*/, "")
            action: "Stop"
            onAct: tab.status.stopCapture()
        }
        LiveRow {
            visible: tab.status.captureMode === "share"
            icon: "own:screen-share"
            tint: Theme.purple
            title: "Sharing screen"
            subtitle: tab.status._sni[tab.status.captureItem]?.title ?? ""
            action: "Stop"
            onAct: tab.status.stopCapture()
        }
        LiveRow {
            visible: !!tab.status.meeting
            icon: "own:camera"
            tint: Theme.green
            title: tab.status.meeting?.service ?? ""
            subtitle: tab.status.meetingText.split(" · ").pop()
            action: "Open"
            onAct: { tab.status.goToMeeting(); tab.notch.collapse(); }
        }
        LiveRow {
            visible: tab.status.camera && !tab.status.meeting
            icon: "own:camera"
            tint: Theme.green
            title: "Camera in use"
        }
        LiveRow {
            visible: tab.status.mic && !tab.status.meeting
            icon: "own:mic"
            tint: Theme.orange
            title: "Microphone in use"
            subtitle: tab.status.micApp ? `by ${tab.status.micApp}` : ""
        }

        MusicCard {
            Layout.fillWidth: true
            visible: Services.media.active
            notch: tab.notch
        }

        RowLayout {
            Layout.fillWidth: true
            Layout.leftMargin: 7; Layout.rightMargin: 7
            Layout.topMargin: 2
            NText { Layout.fillWidth: true; text: "Notifications"; size: 15; weight: Font.DemiBold }
            NButton {
                visible: tab.store.items.length > 0
                implicitWidth: clearLabel.implicitWidth + 26
                implicitHeight: 27
                radius: 14
                color: Theme.surface; hoverColor: Theme.surfaceHi
                onClicked: tab.store.clear()
                NText { id: clearLabel; anchors.centerIn: parent; text: "Clear"; size: 12; weight: Font.Medium }
            }
        }

        NText {
            Layout.alignment: Qt.AlignHCenter
            visible: tab.store.items.length === 0
            text: "No notifications"
            size: 12; color: Theme.textDim
            topPadding: 9; bottomPadding: 5
        }

        /* no visible bar (it would draw over the cards); the bottom fades instead */
        ListView {
            id: list
            Layout.fillWidth: true
            Layout.preferredHeight: Math.min(261, contentHeight)
            visible: count > 0
            clip: true
            spacing: 7
            boundsBehavior: Flickable.StopAtBounds
            model: tab.store.items
            delegate: HistoryCard {
                required property var modelData
                width: list.width
                n: modelData
            }
            Rectangle {
                visible: list.contentHeight > list.height && !list.atYEnd
                anchors.bottom: parent.bottom
                width: parent.width; height: 28
                gradient: Gradient {
                    GradientStop { position: 0; color: "transparent" }
                    GradientStop { position: 1; color: Theme.bg }
                }
            }
        }
    }

    /* one live thing: tinted icon (a pulsing dot without one), what and how long, and its action */
    component LiveRow: Rectangle {
        id: lr
        property string icon: ""
        property color tint: Theme.text
        property string title: ""
        property string subtitle: ""
        property string action: ""
        readonly property bool stop: action === "Stop"
        signal act()
        Layout.fillWidth: true
        implicitHeight: lrRow.implicitHeight + 22
        radius: 20
        color: "#1C1C1E"

        RowLayout {
            id: lrRow
            anchors.fill: parent
            anchors.leftMargin: 11; anchors.rightMargin: 11
            anchors.topMargin: 11; anchors.bottomMargin: 11
            spacing: 11
            Rectangle {
                Layout.alignment: Qt.AlignVCenter
                implicitWidth: 36; implicitHeight: 36; radius: 18
                color: Qt.rgba(lr.tint.r, lr.tint.g, lr.tint.b, 0.16)
                NIcon { anchors.centerIn: parent; visible: !!lr.icon; name: lr.icon; size: 17; color: lr.tint }
                Rectangle {
                    anchors.centerIn: parent
                    visible: !lr.icon
                    width: 10; height: 10; radius: 5
                    color: lr.tint
                    SequentialAnimation on opacity {
                        running: lr.visible && !lr.icon; loops: Animation.Infinite
                        NumberAnimation { to: 0.35; duration: 600; easing.type: Easing.InOutSine }
                        NumberAnimation { to: 1; duration: 600; easing.type: Easing.InOutSine }
                    }
                }
            }
            ColumnLayout {
                Layout.fillWidth: true
                Layout.alignment: Qt.AlignVCenter
                spacing: 2
                NText { Layout.fillWidth: true; text: lr.title; size: 14; weight: Font.DemiBold }
                NText { Layout.fillWidth: true; visible: !!lr.subtitle; text: lr.subtitle; size: 12; tnum: true; color: Theme.textDim }
            }
            NButton {
                visible: !!lr.action
                Layout.alignment: Qt.AlignVCenter
                implicitWidth: actRow.implicitWidth + 26
                implicitHeight: 28
                radius: 14
                color: lr.stop ? "#3A1210" : Theme.surface
                hoverColor: lr.stop ? "#5A1A16" : Theme.surfaceHi
                pressColor: hoverColor
                accessibleName: lr.action
                onClicked: lr.act()
                Row {
                    id: actRow
                    anchors.centerIn: parent
                    spacing: 6
                    Rectangle { visible: lr.stop; anchors.verticalCenter: parent.verticalCenter; width: 8; height: 8; radius: 2; color: Theme.red }
                    NText { text: lr.action; size: 12; weight: Font.DemiBold; color: lr.stop ? Theme.red : Theme.text }
                }
            }
        }
    }

    component HistoryCard: Item {
        id: hc
        property var n
        implicitHeight: row.implicitHeight + 22
        HoverHandler { id: hcHover }

        Rectangle {
            anchors.fill: parent
            radius: 20
            color: hcHover.hovered ? "#232326" : "#1C1C1E"
        }
        MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: { tab.store.activate(hc.n); tab.notch.collapse(); }
        }
        RowLayout {
            id: row
            anchors.fill: parent
            anchors.leftMargin: 11; anchors.rightMargin: 14
            anchors.topMargin: 11; anchors.bottomMargin: 11
            spacing: 11
            Rectangle {
                Layout.alignment: Qt.AlignVCenter
                implicitWidth: 36; implicitHeight: 36; radius: 9
                color: Theme.surface
                RoundedImage {
                    anchors.fill: parent
                    visible: !!hc.n.image
                    radius: 9
                    source: hc.n.image ?? ""
                }
                NIcon { anchors.centerIn: parent; visible: !hc.n.image; name: tab.store.iconFor(hc.n); size: 20 }
            }
            ColumnLayout {
                Layout.fillWidth: true
                Layout.alignment: Qt.AlignVCenter
                spacing: 2
                RowLayout {
                    Layout.fillWidth: true
                    NText { Layout.fillWidth: true; text: hc.n.summary || hc.n.appName || ""; size: 14; weight: Font.DemiBold }
                    NText { text: tab.store.timeLabel(hc.n.time); size: 11; color: Theme.textDim; leftPadding: 7 }
                }
                NText {
                    Layout.fillWidth: true
                    readonly property string plain: (hc.n.body ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
                    visible: !!plain
                    text: plain
                    size: 12; color: Theme.textDim
                }
            }
        }
        /* dismiss rides on the icon's corner */
        NButton {
            x: 2; y: 2
            width: 18; height: 18; radius: 9
            opacity: hcHover.hovered ? 1 : 0
            Behavior on opacity { NumberAnimation { duration: 120 } }
            color: Theme.dot; hoverColor: "#8E8E93"; pressColor: "#8E8E93"
            accessibleName: "Dismiss notification"
            onClicked: tab.store.dismiss(hc.n.id)
            Rectangle { anchors.fill: parent; radius: 9; color: "transparent"; border.color: "black"; border.width: 1 }
            NIcon { anchors.centerIn: parent; name: "window-close-symbolic"; size: 9 }
        }
    }
}
