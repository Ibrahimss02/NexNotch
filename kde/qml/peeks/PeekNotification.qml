import QtQuick
import QtQuick.Layouts
import QtQuick.Shapes

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
    /* a theme's touches: tile, title case, timestamp and body styling */
    readonly property var look: Theme.peek
    function cased(s, how) {
        if (how === "upper") return s.toUpperCase();
        if (how === "snake") return s.toUpperCase().replace(/\s+/g, "_");
        return s;
    }
    /* the icon sits concentric with the notch's rounded end: same inset on all sides */
    readonly property int inset: 14
    implicitHeight: Math.max(iconTile.height, textCol.implicitHeight) + 2 * inset
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
        anchors.leftMargin: peek.inset
        anchors.rightMargin: peek.inset + 6 + Theme.peekInset
        anchors.topMargin: peek.inset
        anchors.bottomMargin: peek.inset
        spacing: 12

        /* the dismiss button rides on the icon's corner, so it takes no room */
        Item {
            Layout.alignment: Qt.AlignTop
            implicitWidth: 44; implicitHeight: 44
            Rectangle {
                id: iconTile
                width: 44; height: 44
                radius: Theme.themed ? Math.min(width / 2, Theme.iconRadius + 4) : Math.min(width / 2, Math.max(8, peek.notch.radius - peek.inset))
                color: peek.look.enso ? "transparent" : Theme.surface
                border.color: peek.look.tileBorder ?? "transparent"
                border.width: peek.look.tileBorder ? 1 : 0
                /* Sumi-e: an open ink ring instead of a tile */
                Shape {
                    visible: !!peek.look.enso
                    anchors.fill: parent
                    preferredRendererType: Shape.CurveRenderer
                    ShapePath {
                        fillColor: "transparent"; strokeColor: Theme.text; strokeWidth: 3.6; capStyle: ShapePath.RoundCap
                        PathSvg { path: "M24 4 A18 18 0 1 1 8 12" }
                    }
                }
                RoundedImage {
                    visible: !!peek.n.image
                    anchors.fill: parent
                    radius: iconTile.radius
                    source: peek.n.image ?? ""
                }
                NIcon {
                    visible: !peek.n.image
                    anchors.centerIn: parent
                    name: Services.notifications.iconFor(peek.n)
                    size: peek.look.enso ? 18 : 28
                    color: peek.look.icon ?? (Theme.themed ? Theme.accent : Theme.text)
                }
            }
            NButton {
                x: -3; y: -3
                width: 18; height: 18; radius: 9
                opacity: peek.open ? 1 : 0
                color: Theme.dot; hoverColor: Theme.textTertiary; pressColor: Theme.textTertiary
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
            Layout.alignment: implicitHeight < iconTile.height ? Qt.AlignVCenter : Qt.AlignTop
            spacing: 1
            /* Neon: the text jumps a pixel now and then */
            transform: Translate { id: jitter }
            SequentialAnimation {
                running: !!peek.look.glitch && Config.themeMotion === "full"
                loops: Animation.Infinite
                PauseAnimation { duration: 3220 }
                PropertyAction { target: jitter; property: "x"; value: -2 }
                PropertyAction { target: jitter; property: "y"; value: 1 }
                PauseAnimation { duration: 70 }
                PropertyAction { target: jitter; property: "x"; value: 2 }
                PropertyAction { target: jitter; property: "y"; value: -1 }
                PauseAnimation { duration: 70 }
                PropertyAction { target: jitter; property: "x"; value: -1 }
                PropertyAction { target: jitter; property: "y"; value: 0 }
                PauseAnimation { duration: 70 }
                PropertyAction { target: jitter; property: "x"; value: 0 }
            }
            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                NText {
                    Layout.fillWidth: !peek.look.seal
                    Layout.maximumWidth: peek.look.seal ? textCol.width - 80 : -1
                    text: peek.cased(peek.n.summary || peek.n.appName || "Notification", peek.look.titleCase)
                    size: 13; weight: Font.DemiBold; title: true
                    color: peek.look.title ?? Theme.text
                    font.letterSpacing: peek.look.titleCase ? 0.5 : 0
                }
                /* Sumi-e's red seal after the name */
                Rectangle {
                    visible: !!peek.look.seal
                    width: 17; height: 17; radius: 2
                    color: "#B22222"
                    Text { anchors.centerIn: parent; text: peek.look.seal ?? ""; color: "#F7EFE0"; font.family: "Noto Serif CJK SC"; font.weight: Font.Black; font.pixelSize: 11 }
                }
                Item { visible: !!peek.look.seal; Layout.fillWidth: true }
                NText {
                    text: (peek.look.metaFormat ?? "%1").arg(peek.cased("now", peek.look.metaCase))
                    size: peek.look.metaFont ? 8 : 11
                    font.family: peek.look.metaFont ?? Theme.font
                    color: peek.look.meta ?? (Theme.themed ? Theme.accent : Theme.textDim)
                    leftPadding: 6
                }
            }
            NText {
                Layout.fillWidth: true
                visible: !!peek.bodyText
                text: (peek.look.bodyPrefix ?? "") + peek.bodyText
                size: 12
                color: peek.look.body ?? Theme.textDim
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
                        color: Qt.alpha(Theme.text, 0.1); hoverColor: Qt.alpha(Theme.text, 0.18)
                        onClicked: { Services.notifications.invoke(peek.n, modelData.key); peek.notch.dismissPeek(false); }
                        NText { id: label; anchors.centerIn: parent; text: actionBtn.modelData.label; size: 11; weight: Font.DemiBold }
                    }
                }
            }
        }
    }
}
