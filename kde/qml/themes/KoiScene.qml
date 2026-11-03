import QtQuick

/* Koi Pond: ripples spreading behind, a lily pad at the left ear, two koi
   swimming a loop under the peek. */
Scene {
    id: s
    Repeater {
        model: s.back ? [[-250, 70, 3200, 0], [180, 84, 3800, 0.42]] : []
        Rectangle {
            id: ripple
            required property var modelData
            x: s.cx + modelData[0]; y: modelData[1]
            width: 60; height: 60; radius: 30
            color: "transparent"
            border.color: Qt.rgba(100 / 255, 210 / 255, 1, 0.5)
            border.width: 1.5
            property real clock: 0.4
            readonly property real t: (clock + modelData[3]) % 1
            scale: 0.3 + 1.3 * t
            opacity: 0.7 * (1 - t)
            NumberAnimation on clock { from: 0; to: 1; duration: ripple.modelData[2]; loops: Animation.Infinite; running: s.live }
        }
    }
    Image {
        visible: !s.back
        x: s.cx - 270; y: 4
        width: 40; height: 40
        sourceSize: Qt.size(80, 80)
        source: s.art("koi-pad")
    }
    Repeater {
        model: s.back ? [] : [["koi-a", 0], ["koi-b", 0.5]]
        Item {
            id: fish
            required property var modelData
            property real clock: 0.3
            readonly property real t: (clock + modelData[1]) % 1
            PathInterpolator {
                id: swim
                progress: fish.t
                path: Path {
                    startX: s.cx - 261; startY: 0
                    PathCubic { x: s.cx + 261; y: 0; control1X: s.cx - 271; control1Y: 150; control2X: s.cx + 261; control2Y: 150 }
                }
            }
            x: swim.x - 18; y: swim.y - 8
            rotation: swim.angle === undefined ? 0 : -swim.angle
            opacity: t < 0.1 ? t / 0.1 : t > 0.9 ? (1 - t) / 0.1 : 1
            width: 36; height: 16
            Image { anchors.fill: parent; sourceSize: Qt.size(72, 32); source: s.art(fish.modelData[0]) }
            NumberAnimation on clock { from: 0; to: 1; duration: 7000; loops: Animation.Infinite; running: s.live }
        }
    }
}
