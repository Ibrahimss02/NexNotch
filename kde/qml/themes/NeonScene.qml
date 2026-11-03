import QtQuick
import QtQuick.Shapes

/* Neon Circuit: traces run off both ears and under the peek, with light
   pulses racing along them. */
Scene {
    id: s
    readonly property real ox: cx - 300      // the design's 600-wide canvas
    readonly property var traces: [
        ["M70 0 L70 18 L58 30 L58 66 L40 84 L8 84", "#00E5FF", 2200, 0],
        ["M530 0 L530 18 L542 30 L542 60 L562 80 L592 80", "#FF2BD6", 2600, 1000],
        ["M150 94 L300 94 L312 106 L450 106", "#00E5FF", 3000, 400],
    ]
    Shape {
        visible: s.back
        x: s.ox
        preferredRendererType: Shape.CurveRenderer
        ShapePath { fillColor: "transparent"; strokeColor: "#1F3D66"; strokeWidth: 1.5; PathSvg { path: s.traces[0][0] } }
        ShapePath { fillColor: "transparent"; strokeColor: "#1F3D66"; strokeWidth: 1.5; PathSvg { path: s.traces[1][0] } }
        ShapePath { fillColor: "transparent"; strokeColor: "#1F3D66"; strokeWidth: 1.5; PathSvg { path: s.traces[2][0] } }
    }
    Repeater {
        model: s.back ? s.traces : []
        Shape {
            id: pulse
            required property var modelData
            x: s.ox
            preferredRendererType: Shape.CurveRenderer
            ShapePath {
                id: sp
                fillColor: "transparent"
                strokeColor: pulse.modelData[1]
                strokeWidth: 2
                strokeStyle: ShapePath.DashLine
                dashPattern: [6, 94]
                dashOffset: 100
                PathSvg { path: pulse.modelData[0] }
            }
            SequentialAnimation {
                running: s.live
                PauseAnimation { duration: pulse.modelData[3] }
                NumberAnimation { target: sp; property: "dashOffset"; from: 100; to: 0; duration: pulse.modelData[2]; loops: Animation.Infinite }
            }
        }
    }
    Repeater {
        model: s.back ? [[8, 84, "#00E5FF", 3], [592, 80, "#FF2BD6", 3], [450, 106, "#00E5FF", 3]] : []
        Rectangle {
            required property var modelData
            x: s.ox + modelData[0] - modelData[3]; y: modelData[1] - modelData[3]
            width: modelData[3] * 2; height: width; radius: width / 2
            color: modelData[2]
        }
    }
}
