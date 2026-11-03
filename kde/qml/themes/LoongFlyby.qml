import QtQuick
import QtQuick.Effects

/* Golden Loong's entrance: the dragon dives from the screen edge, swings
   under the peek and climbs away past the right ear, chasing its pearl. The
   peek's text is uncovered just behind its head. Afterwards, with ambient
   motion on, gold dust keeps rising under the peek until it closes.
   Laid out on the notch's own coordinates; the path is the design's,
   drawn for a 440-wide peek and stretched to the real width. */
Item {
    id: fly
    required property Item host     // the notch; it is still springing open when this starts
    x: (host.width - peekWidth) / 2
    property real peekWidth: 440
    property real peekHeight: 76
    property real speed: 1          // Plasma's animation-speed factor
    property bool ambient: true
    property color cover: Theme.bg

    readonly property real sx: peekWidth / 440
    readonly property int ms: Math.round(2100 * speed)

    /* the design's path, as cubic segments */
    readonly property var segs: [
        [[-70, -40], [-50, 20], [-40, 96], [40, 120]],
        [[40, 120], [130, 148], [330, 148], [410, 120]],
        [[410, 120], [476, 96], [494, 46], [472, 8]],
        [[472, 8], [464, -8], [454, -24], [444, -44]],
    ]
    /* points every `step` px of arc length: [x, y, degrees] */
    readonly property real step: 2
    readonly property var table: {
        const pts = [];
        for (const s of segs) {
            for (let i = pts.length ? 1 : 0; i <= 120; i++) {
                const t = i / 120, u = 1 - t;
                const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
                pts.push([(a * s[0][0] + b * s[1][0] + c * s[2][0] + d * s[3][0]) * sx,
                          a * s[0][1] + b * s[1][1] + c * s[2][1] + d * s[3][1]]);
            }
        }
        const out = [];
        let acc = 0, next = 0;
        for (let i = 1; i < pts.length; i++) {
            const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
            const len = Math.hypot(x1 - x0, y1 - y0);
            const ang = Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI;
            while (next <= acc + len) {
                const f = len ? (next - acc) / len : 0;
                out.push([x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, ang]);
                next += step;
            }
            acc += len;
        }
        return out;
    }
    readonly property real length: (table.length - 1) * step
    readonly property real bodyLength: length * 0.45
    function at(s) { return table[Math.max(0, Math.min(table.length - 1, Math.round(s / step)))]; }

    Behavior on opacity { NumberAnimation { duration: 140 } }

    property real head: 0           // arc length the head has reached
    property bool flying: true

    /* gold flash on the rim as it rounds the peek */
    RectangularShadow {
        x: -fly.x; width: fly.host.width; height: fly.host.height
        radius: 38
        blur: 64
        offset.y: 14
        color: Qt.rgba(242 / 255, 193 / 255, 78 / 255, 0.6)
        opacity: 0
        SequentialAnimation on opacity {
            PauseAnimation { duration: 0.08 * 6000 * fly.speed }
            NumberAnimation { to: 1; duration: 0.1 * 6000 * fly.speed; easing.type: Easing.OutQuad }
            NumberAnimation { to: 0; duration: 0.16 * 6000 * fly.speed; easing.type: Easing.InOutQuad }
        }
    }

    /* the text's cover: shrinks towards the right edge as the head passes */
    Rectangle {
        id: wipe
        property real remain: 1         // share of the content still covered
        x: -fly.x + fly.host.width - 5 - width; y: 5
        width: Math.max(0, fly.host.width - 10) * remain; height: Math.max(0, fly.host.height - 10)
        radius: Math.min(33, height / 2)
        color: fly.cover
        SequentialAnimation on remain {
            PauseAnimation { duration: 0.08 * 6000 * fly.speed }
            NumberAnimation { to: 0; duration: 0.14 * 6000 * fly.speed; easing.type: Easing.Linear }
        }
    }

    /* body: overlapping scale discs, gold fringe below, tapering to the tail */
    readonly property int beads: Math.ceil(bodyLength / 5)
    Item {
        visible: fly.flying
        Repeater {
            model: fly.beads
            Rectangle {
                required property int index
                readonly property real s: fly.head - index * 5
                readonly property var p: fly.at(s)
                readonly property real taper: index < fly.beads * 0.6 ? 1 : 1 - 0.65 * (index - fly.beads * 0.6) / (fly.beads * 0.4)
                visible: s >= 0 && index % 3 === 0
                width: 28 * taper; height: width; radius: width / 2
                x: p[0] - width / 2; y: p[1] - height / 2
                color: "transparent"
                border.color: "#D9A520"
                border.width: 2.5 * taper
            }
        }
        Repeater {
            model: fly.beads
            Rectangle {
                id: bead
                required property int index
                readonly property real s: fly.head - index * 5
                readonly property var p: fly.at(s)
                readonly property real taper: index < fly.beads * 0.6 ? 1 : 1 - 0.65 * (index - fly.beads * 0.6) / (fly.beads * 0.4)
                z: fly.beads - index
                visible: s >= 0
                width: 20 * taper; height: width; radius: width / 2
                x: p[0] - width / 2; y: p[1] - height / 2
                color: "#5A0610"
                Rectangle {
                    anchors.centerIn: parent
                    width: parent.width * 0.8; height: width; radius: width / 2
                    color: bead.index % 2 ? "#C8102E" : "#9E0B26"
                    Rectangle {
                        visible: bead.index % 2 === 0
                        anchors.centerIn: parent
                        width: 4; height: 4; radius: 2
                        color: "#F2C14E"
                    }
                }
            }
        }
        Image {
            id: headArt
            readonly property var p: fly.at(fly.head)
            z: fly.beads + 1
            source: Qt.resolvedUrl("../icons/loong-head.svg")
            sourceSize: Qt.size(360, 176)
            width: 180; height: 88
            /* the art's anchor (40, 30) rides the path */
            x: p[0] - 80; y: p[1] - 54
            transformOrigin: Item.TopLeft
            transform: Rotation { origin.x: 80; origin.y: 54; angle: headArt.p[2] }
        }
    }

    NumberAnimation on head {
        from: 0; to: fly.length
        duration: fly.ms
        easing.type: Easing.Linear
        onFinished: fly.flying = false
    }

    /* ambient: gold dust rising from under the peek */
    Repeater {
        model: fly.ambient ? [[0.30, -8, 2600, 200], [0.48, 10, 3100, 1400], [0.66, -6, 2200, 900], [0.82, 8, 2800, 2000]] : []
        Rectangle {
            id: mote
            required property var modelData
            width: 3; height: 3; radius: 1.5
            color: "#FFE9A8"
            x: fly.peekWidth * modelData[0]
            y: fly.peekHeight + 54
            opacity: 0
            layer.enabled: true
            layer.effect: MultiEffect { shadowEnabled: true; shadowColor: "#F2C14E"; shadowBlur: 0.6; shadowHorizontalOffset: 0; shadowVerticalOffset: 0 }
            SequentialAnimation {
                running: true
                loops: Animation.Infinite
                PauseAnimation { duration: mote.modelData[3] }
                ParallelAnimation {
                    NumberAnimation { target: mote; property: "y"; from: fly.peekHeight + 54; to: fly.peekHeight - 26; duration: mote.modelData[2]; easing.type: Easing.OutQuad }
                    NumberAnimation { target: mote; property: "x"; from: fly.peekWidth * mote.modelData[0]; to: fly.peekWidth * mote.modelData[0] + mote.modelData[1]; duration: mote.modelData[2] }
                    SequentialAnimation {
                        NumberAnimation { target: mote; property: "opacity"; to: 1; duration: mote.modelData[2] * 0.15 }
                        NumberAnimation { target: mote; property: "opacity"; to: 0; duration: mote.modelData[2] * 0.85 }
                    }
                }
            }
        }
    }
}
