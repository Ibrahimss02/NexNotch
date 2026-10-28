import QtQuick
import QtQuick.Layouts

/* Notifs: the Now Playing card (while something plays or is paused) above
   the notification history, newest first. */
Item {
    id: tab
    property var notch
    readonly property var store: Services.notifications
    implicitHeight: col.implicitHeight

    ColumnLayout {
        id: col
        width: parent.width
        spacing: 11

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
