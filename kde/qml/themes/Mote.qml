import QtQuick

/* A looping particle: drifts by (dx, dy) and turns by `spin` over `ms`,
   fading in over the first `fadeIn` of the loop and out over the rest.
   Nothing shows before `start`. `phase` offsets it within the loop. */
Rectangle {
    id: mote
    property bool live: true
    property int ms: 6000
    property real phase: 0
    property real x0: 0
    property real y0: 0
    property real dx: 0
    property real dy: 0
    property real spin: 0
    property real start: 0
    property real fadeIn: 0.1
    property real peak: 1
    property real clock: 0
    readonly property real t: (clock + phase) % 1
    readonly property real k: t < start ? 0 : (t - start) / (1 - start)
    x: x0 + dx * k
    y: y0 + dy * k
    rotation: spin * k
    opacity: t < start ? 0 : k < fadeIn ? peak * k / fadeIn : peak * (1 - (k - fadeIn) / (1 - fadeIn))
    NumberAnimation on clock { from: 0; to: 1; duration: mote.ms; loops: Animation.Infinite; running: mote.live }
    Component.onCompleted: if (!live) clock = 0.35
}
