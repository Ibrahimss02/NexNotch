import QtQuick

/* Pixel Quest: a slime hopping by the right end, a spinning coin and +1
   at the left. */
Scene {
    id: s
    Image {
        visible: !s.back
        x: s.cx + 228; y: 40
        width: 42; height: 30
        smooth: false
        sourceSize: Qt.size(84, 60)
        source: s.art("pixel-slime")
        SequentialAnimation on y {
            running: s.live; loops: Animation.Infinite
            NumberAnimation { to: 33; duration: 450; easing.type: Easing.InOutSine }
            NumberAnimation { to: 40; duration: 450; easing.type: Easing.InOutSine }
        }
    }
    Image {
        id: coin
        visible: !s.back
        x: s.cx - 262; y: 22
        width: 24; height: 24
        smooth: false
        sourceSize: Qt.size(48, 48)
        source: s.art("pixel-coin")
        transform: Scale { id: flip; origin.x: 12; xScale: 1 }
        SequentialAnimation {
            running: s.live; loops: Animation.Infinite
            NumberAnimation { target: flip; property: "xScale"; to: 0.15; duration: 600 }
            NumberAnimation { target: flip; property: "xScale"; to: 1; duration: 600 }
        }
    }
    Text {
        id: plus
        visible: !s.back && s.live
        x: s.cx - 236; y: 14
        text: "+1"
        color: "#FFCD75"
        font.family: "Press Start 2P"; font.pixelSize: 8
        SequentialAnimation {
            running: s.live; loops: Animation.Infinite
            ParallelAnimation {
                NumberAnimation { target: plus; property: "y"; from: 14; to: -12; duration: 1200; easing.type: Easing.OutQuad }
                SequentialAnimation {
                    NumberAnimation { target: plus; property: "opacity"; from: 0; to: 1; duration: 240 }
                    NumberAnimation { target: plus; property: "opacity"; to: 0; duration: 960 }
                }
            }
        }
    }
}
