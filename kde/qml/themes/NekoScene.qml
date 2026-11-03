import QtQuick

/* Neko: the cat hugs the peek, its tail swishing off the left end, its
   face peeking round the right and its paws over the bottom edge. */
Scene {
    id: s
    Image {
        visible: s.back
        x: s.cx - 252; y: 18
        width: 40; height: 72
        sourceSize: Qt.size(80, 144)
        source: s.art("neko-tail")
        transform: Rotation { id: swish; origin.x: 20; origin.y: 2; angle: 0 }
        SequentialAnimation {
            running: s.live; loops: Animation.Infinite
            NumberAnimation { target: swish; property: "angle"; from: -12; to: 14; duration: 1200; easing.type: Easing.InOutSine }
            NumberAnimation { target: swish; property: "angle"; from: 14; to: -12; duration: 1200; easing.type: Easing.InOutSine }
        }
    }
    Item {
        visible: s.back
        x: s.cx + 212; y: 22
        width: 52; height: 46
        Image { anchors.fill: parent; sourceSize: Qt.size(104, 92); source: s.art("neko-face") }
        Image {
            y: 19; width: 52; height: 12
            sourceSize: Qt.size(104, 24)
            source: s.art("neko-eyes")
            transform: Scale { id: lid; origin.y: 6; yScale: 1 }
            SequentialAnimation {
                running: s.live; loops: Animation.Infinite
                PauseAnimation { duration: 3680 }
                NumberAnimation { target: lid; property: "yScale"; to: 0.1; duration: 120 }
                NumberAnimation { target: lid; property: "yScale"; to: 1; duration: 200 }
            }
        }
    }
    Repeater {
        model: s.back ? [] : [-120, 72]
        Image {
            required property real modelData
            x: s.cx + modelData; y: 66
            width: 26; height: 18
            sourceSize: Qt.size(52, 36)
            source: s.art("neko-paw")
        }
    }
}
