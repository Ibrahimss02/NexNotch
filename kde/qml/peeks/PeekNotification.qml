import QtQuick
import QtQuick.Layouts

/* A notification, like a native banner: hover holds it open and shows the
   whole body and its actions; click opens it, ✕ dismisses it. */
Item {
    id: peek
    property var notch
    property var n: ({})
    readonly property bool open: hover.hovered
    readonly property string bodyText: {
        /* Plasma allows a little markup; the notch shows plain text, clamped */
        let body = (n.body ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
        const lines = body.split("\n");
        if (lines.length > 6) body = lines.slice(0, 6).join("\n") + "\n…";
        if (body.length > 360) body = body.slice(0, 360) + "…";
        return body.trim();
    }
    implicitHeight: Math.max(iconTile.height, textCol.implicitHeight) + 20 + 14
    scale: 0.94
    Component.onCompleted: popIn.start()
    NumberAnimation { id: popIn; target: peek; property: "scale"; to: 1; duration: 300; easing.type: Easing.OutBack }
    transformOrigin: Item.Top

    HoverHandler { id: hover }
    /* behind the buttons, so ✕ and the actions keep their own clicks */
    MouseArea {
        anchors.fill: parent
        cursorShape: Qt.PointingHandCursor
        onClicked: { Services.notifications.activate(peek.n); peek.notch.dismissPeek(false); }
    }

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: 14
        anchors.rightMargin: 12
        anchors.topMargin: 10
        anchors.bottomMargin: 10
        spacing: 12

        /* the dismiss button rides on the icon's corner, so it takes no room */
        Item {
            Layout.alignment: Qt.AlignVCenter
            implicitWidth: 43; implicitHeight: 43
            Rectangle {
                id: iconTile
                width: 43; height: 43; radius: 12
                color: Theme.surface
                RoundedImage {
                    visible: !!peek.n.image
                    anchors.fill: parent
                    radius: 12
                    source: peek.n.image ?? ""
                }
                NIcon {
                    visible: !peek.n.image
                    anchors.centerIn: parent
                    name: Services.notifications.iconFor(peek.n)
                    size: 28
                }
            }
            NButton {
                x: -7; y: -7
                width: 18; height: 18; radius: 9
                opacity: peek.open ? 1 : 0
                color: Theme.dot; hoverColor: "#8E8E93"; pressColor: "#8E8E93"
                accessibleName: "Dismiss notification"
                onClicked: { Services.notifications.dismiss(peek.n.id); peek.notch.dismissPeek(false); }
                Rectangle { anchors.fill: parent; radius: 9; color: "transparent"; border.color: "black"; border.width: 1 }
                NIcon { anchors.centerIn: parent; name: "window-close-symbolic"; size: 9 }
                Behavior on opacity { NumberAnimation { duration: 120 } }
            }
        }

        ColumnLayout {
            id: textCol
            Layout.fillWidth: true
            Layout.alignment: Qt.AlignVCenter
            spacing: 1
            RowLayout {
                Layout.fillWidth: true
                NText { Layout.fillWidth: true; text: peek.n.summary || peek.n.appName || "Notification"; size: 13; weight: Font.DemiBold }
                NText { text: "now"; size: 11; color: Theme.textDim; leftPadding: 6 }
            }
            NText {
                Layout.fillWidth: true
                visible: !!peek.bodyText
                text: peek.bodyText
                size: 12
                color: Theme.textDim
                wrapMode: peek.open ? Text.Wrap : Text.NoWrap
                maximumLineCount: peek.open ? 8 : 1
            }
            Flow {
                Layout.fillWidth: true
                Layout.topMargin: 6
                visible: peek.open && actions.count > 0
                spacing: 6
                Repeater {
                    id: actions
                    model: (peek.n.actions ?? []).filter(a => a.key !== "default" && a.key !== "inline-reply")
                    NButton {
                        id: actionBtn
                        required property var modelData
                        implicitWidth: label.implicitWidth + 24
                        implicitHeight: 24
                        color: Qt.rgba(1, 1, 1, 0.1); hoverColor: Qt.rgba(1, 1, 1, 0.18)
                        onClicked: { Services.notifications.invoke(peek.n, modelData.key); peek.notch.dismissPeek(false); }
                        NText { id: label; anchors.centerIn: parent; text: actionBtn.modelData.label; size: 11; weight: Font.DemiBold }
                    }
                }
            }
        }
    }
}
