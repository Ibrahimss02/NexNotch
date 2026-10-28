import QtQuick

/* Spectacle's "Screenshot taken" notification, as a thumbnail + check */
Item {
    id: peek
    property var notch
    property var n: ({})
    readonly property string thumb: n.image || (n.urls?.[0] ?? "")
    PeekCard {
        anchors.fill: parent
        lines: [["Screenshot", "title"], [/clipboard/i.test(peek.n.body) ? "Copied to clipboard" : (peek.n.summary || "Saved"), "body"]]
        Rectangle {
            width: 58; height: 38; radius: 8
            color: "#2A2F7A"
            border.color: Theme.surfaceHi
            RoundedImage { anchors.fill: parent; anchors.margins: 1; radius: 7; source: peek.thumb; sourceSize.width: 120 }
        }
        trailing: Rectangle {
            width: 22; height: 22; radius: 11; color: Theme.green
            NIcon { anchors.centerIn: parent; name: "object-select-symbolic"; size: 13; color: "black" }
        }
    }
}
