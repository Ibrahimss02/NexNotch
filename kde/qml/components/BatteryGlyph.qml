import QtQuick
import QtQuick.Shapes

/* iOS-style battery: grey outline, fill by level, drawn on a 24×12 grid. */
Item {
    id: root
    property real level: 1
    property color color: Theme.green
    implicitWidth: 22
    implicitHeight: 11
    readonly property real sx: width / 24
    readonly property real sy: height / 12

    Rectangle {
        x: 0.75 * root.sx; y: 0.75 * root.sy
        width: 20 * root.sx; height: 10.5 * root.sy
        radius: 3 * root.sx
        color: "transparent"
        border.color: Qt.rgba(0.56, 0.56, 0.58, 1)
        border.width: 1.5 * root.sx
    }
    Rectangle {
        x: 22 * root.sx; y: 4 * root.sy
        width: 1.6 * root.sx; height: 4 * root.sy
        radius: 0.8 * root.sx
        color: Qt.rgba(0.56, 0.56, 0.58, 1)
    }
    Rectangle {
        visible: root.level > 0
        x: 2.5 * root.sx; y: 2.5 * root.sy
        width: Math.max(1.6, 16.5 * Math.max(0, Math.min(1, root.level))) * root.sx
        height: 7 * root.sy
        radius: 1.6 * root.sx
        color: root.color
    }
}
