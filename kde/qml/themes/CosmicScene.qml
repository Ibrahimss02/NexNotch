import QtQuick

/* Cosmic: stars twinkling around and inside the peek, a shooting star, a
   ringed planet by the right ear with its moon in orbit. */
Scene {
    id: s
    Repeater {
        model: s.back ? [[-200, 110, 2, "#FFFFFF", 2200, 0], [60, 140, 2, "#FFFFFF", 3000, 0.33], [200, 96, 3, "#A5A4FF", 2600, 0.2], [-270, 30, 2, "#FFFFFF", 1800, 0]]
                      : [[-100, 14, 2, "#FFFFFF", 2000, 0], [40, 58, 2, "#FFFFFF", 2700, 0.45], [110, 10, 2, "#A5A4FF", 1600, 0.25]]
        Rectangle {
            id: star
            required property var modelData
            x: s.cx + modelData[0]; y: modelData[1]
            width: modelData[2]; height: width; radius: width / 2
            color: modelData[3]
            property real clock: 0.5
            readonly property real t: (clock + modelData[5]) % 1
            opacity: 0.2 + 0.8 * (1 - Math.abs(2 * t - 1))
            NumberAnimation on clock { from: 0; to: 1; duration: star.modelData[4]; loops: Animation.Infinite; running: s.live }
        }
    }
    Rectangle {
        id: shoot
        visible: !s.back && s.live
        width: 70; height: 2; radius: 1
        rotation: -18
        transformOrigin: Item.Left
        gradient: Gradient {
            orientation: Gradient.Horizontal
            GradientStop { position: 0; color: "#FFFFFF" }
            GradientStop { position: 1; color: "transparent" }
        }
        property real clock: 0
        readonly property real k: clock < 0.7 ? 0 : Math.min(1, (clock - 0.7) / 0.18)
        x: s.cx + 201 - 280 * k; y: 40 + 90 * k
        opacity: clock < 0.7 ? 0 : clock < 0.72 ? (clock - 0.7) / 0.02 : Math.max(0, 1 - k)
        NumberAnimation on clock { from: 0; to: 1; duration: 5000; loops: Animation.Infinite; running: s.live }
    }
    Item {
        visible: !s.back
        x: s.cx + 212; y: -6
        width: 64; height: 64
        Image { anchors.fill: parent; sourceSize: Qt.size(128, 128); source: s.art("cosmic-planet") }
        Item {
            x: 32; y: 30
            NumberAnimation on rotation { from: 0; to: 360; duration: 6000; loops: Animation.Infinite; running: s.live }
            Rectangle { x: -2.5; y: -26.5; width: 5; height: 5; radius: 2.5; color: "#EDEBFF" }
        }
    }
}
