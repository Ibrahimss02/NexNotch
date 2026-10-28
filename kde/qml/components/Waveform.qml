import QtQuick

/* Animated level bars for "something is playing"; only the bars' scale
   moves, and the animation stops while nothing plays. */
Row {
    id: root
    property int bars: 4
    property color color: Theme.spotify
    property bool playing: false
    property real barWidth: 3
    property real barHeight: 14
    property real phase: 0
    readonly property var offsets: [0.1, 0.5, 0.3, 0.7, 0.2, 0.6]
    spacing: 3
    opacity: playing ? 1 : 0.59
    Accessible.name: "Playing"

    NumberAnimation on phase {
        from: 0; to: 1; duration: 900
        loops: Animation.Infinite
        running: root.playing && root.visible
    }
    Repeater {
        model: root.bars
        Rectangle {
            width: root.barWidth
            height: root.barHeight
            radius: root.barWidth * 0.6
            color: root.color
            transform: Scale {
                origin.y: root.barHeight / 2
                yScale: root.playing ? 0.35 + 0.65 * (0.5 - 0.5 * Math.cos(2 * Math.PI * (root.phase + root.offsets[index % 6]))) : 0.35
            }
        }
    }
}
