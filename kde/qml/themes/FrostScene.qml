import QtQuick

/* Frost: snow falling behind, icicles along the underside with one drip,
   a crystal at each end. */
Scene {
    id: s
    Repeater {
        model: s.back ? [[-240, 4, "#FFFFFF", 7000, 0], [-150, 3, "#E6F6FF", 9000, 0.33], [-30, 4, "#FFFFFF", 8000, 0.62],
                         [90, 3, "#E6F6FF", 6500, 0.23], [200, 4, "#FFFFFF", 7500, 0.56]] : []
        Mote {
            required property var modelData
            live: s.live
            x0: s.cx + modelData[0]; y0: -10
            width: modelData[1]; height: width; radius: width / 2
            color: modelData[2]
            ms: modelData[3]; phase: modelData[4]
            dx: 20; dy: 240
        }
    }
    Image {
        visible: !s.back
        x: s.cx - 182; y: s.peekHeight - 1
        width: 364; height: 34
        sourceSize: Qt.size(728, 68)
        source: s.art("frost-icicles")
    }
    Mote {
        visible: !s.back
        live: s.live
        x0: s.cx + 72; y0: s.peekHeight + 30
        width: 4; height: 6; radius: 2
        color: "#CFEFFF"
        ms: 3000; start: 0.6; fadeIn: 0.12
        dy: 60
    }
    Repeater {
        model: s.back ? [] : [[-244, 4, 18], [228, 6, 14]]
        Image {
            required property var modelData
            x: s.cx + modelData[0]; y: modelData[1]
            width: modelData[2]; height: width
            sourceSize: Qt.size(36, 36)
            source: s.art("frost-flake")
        }
    }
}
