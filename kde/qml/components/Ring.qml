import QtQuick
import QtQuick.Shapes

/* Progress ring: track circle plus a round-capped arc from 12 o'clock. */
Item {
    id: root
    property real size: 64
    property real thickness: 6
    property color track: Theme.surface
    property color color: Theme.blue
    property real frac: 0
    implicitWidth: size
    implicitHeight: size
    readonly property real r: Math.min(width, height) / 2 - thickness / 2

    Shape {
        anchors.fill: parent
        preferredRendererType: Shape.CurveRenderer
        ShapePath {
            strokeColor: root.track
            strokeWidth: root.thickness
            fillColor: "transparent"
            PathAngleArc { centerX: root.width / 2; centerY: root.height / 2; radiusX: root.r; radiusY: root.r; startAngle: 0; sweepAngle: 360 }
        }
        ShapePath {
            strokeColor: root.frac > 0 ? root.color : "transparent"
            strokeWidth: root.thickness
            fillColor: "transparent"
            capStyle: ShapePath.RoundCap
            PathAngleArc { centerX: root.width / 2; centerY: root.height / 2; radiusX: root.r; radiusY: root.r
                startAngle: -90; sweepAngle: 360 * Math.min(1, Math.max(0, root.frac)) }
        }
    }
}
