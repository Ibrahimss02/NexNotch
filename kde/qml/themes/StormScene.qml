import QtQuick
import QtQuick.Shapes

/* Storm: rain slanting behind, a thundercloud off the left end whose
   lightning lights the rim. */
Scene {
    id: s
    /* the flash curve from the design: 0 until 88 %, a double flicker, gone by 96 % */
    property real clock: 0
    readonly property real flash: {
        const c = clock;
        if (c < 0.88 || c > 0.96) return 0;
        if (c < 0.89) return (c - 0.88) / 0.01;
        if (c < 0.91) return 1 - 0.8 * (c - 0.89) / 0.02;
        if (c < 0.93) return 0.2 + 0.7 * (c - 0.91) / 0.02;
        return 0.9 * (1 - (c - 0.93) / 0.03);
    }
    NumberAnimation on clock { from: 0; to: 1; duration: 5000; loops: Animation.Infinite; running: s.live }

    Repeater {
        model: s.back ? [[-220, 1100, 0], [-130, 1300, 0.31], [-40, 1000, 0.7], [50, 1200, 0.17], [140, 1150, 0.78], [240, 1050, 0.48]] : []
        Mote {
            required property var modelData
            live: s.live
            x0: s.cx + modelData[0]; y0: -20
            width: 1; height: 14
            color: Qt.rgba(170 / 255, 190 / 255, 1, 0.55)
            rotation: 15
            spin: 0
            ms: modelData[1]; phase: modelData[2]
            dx: -60; dy: 260; peak: 0.8
        }
    }
    Shape {
        id: rim
        visible: !s.back
        opacity: s.flash * (1 - s.host.island)
        preferredRendererType: Shape.CurveRenderer
        readonly property real w: s.peekWidth
        readonly property real h: s.peekHeight
        readonly property real r: Math.min(38, h / 2)
        ShapePath {
            fillColor: "transparent"; strokeColor: "#E6ECFF"; strokeWidth: 2
            PathSvg { path: { const p = rim, w = p.w, h = p.h, r = p.r;
                return `M -13 0 A 13 13 0 0 1 0 13 L 0 ${h - r} A ${r} ${r} 0 0 0 ${r} ${h} L ${w - r} ${h} A ${r} ${r} 0 0 0 ${w} ${h - r} L ${w} 13 A 13 13 0 0 1 ${w + 13} 0`; } }
        }
    }
    Rectangle {
        visible: !s.back
        width: s.peekWidth; height: s.peekHeight
        radius: height / 2
        color: "transparent"
        border.color: "#E6ECFF"; border.width: 2
        opacity: s.flash * s.host.island
    }
    Item {
        visible: !s.back
        x: s.cx - 286; y: 0
        width: 90; height: 80
        Image { anchors.fill: parent; sourceSize: Qt.size(180, 160); source: s.art("storm-bolt"); opacity: s.flash }
        Image { anchors.fill: parent; sourceSize: Qt.size(180, 160); source: s.art("storm-cloud") }
    }
}
