import QtQuick

/* Sakura: a blossoming branch over the right ear, a sprig at the left,
   petals drifting down and away. */
Scene {
    id: s
    Image {
        visible: !s.back
        x: s.cx - 300; y: 0
        width: 640; height: 120
        sourceSize: Qt.size(1280, 240)
        source: s.art("sakura")
    }
    Repeater {
        model: s.back ? [] : [[270, 30, 9, 6, "#F7B6C8", 5500, 0], [300, 20, 7, 5, "#FAD0DC", 6500, 0.34],
                             [250, 44, 8, 5, "#F7B6C8", 7000, 0.57], [120, 10, 7, 5, "#FAD0DC", 6000, 0.5]]
        Mote {
            required property var modelData
            live: s.live
            x0: s.cx + modelData[0]; y0: modelData[1]
            width: modelData[2]; height: modelData[3]; radius: height / 2
            color: modelData[4]
            ms: modelData[5]; phase: modelData[6]
            dx: -140; dy: 200; spin: 320
        }
    }
}
