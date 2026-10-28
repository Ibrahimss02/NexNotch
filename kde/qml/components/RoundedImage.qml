import QtQuick
import QtQuick.Effects

/* An image cropped to a rounded rectangle (clip only cuts square corners) */
Item {
    id: root
    property alias source: img.source
    property alias status: img.status
    property alias sourceSize: img.sourceSize
    property alias fillMode: img.fillMode
    property real radius: 0
    readonly property bool ready: img.status === Image.Ready

    Image {
        id: img
        anchors.fill: parent
        visible: false
        fillMode: Image.PreserveAspectCrop
        asynchronous: true
    }
    Rectangle {
        id: mask
        anchors.fill: parent
        radius: root.radius
        visible: false
        layer.enabled: true
        layer.smooth: true
    }
    MultiEffect {
        anchors.fill: parent
        visible: root.ready
        source: img
        maskEnabled: true
        maskSource: mask
        maskThresholdMin: 0.5
        maskSpreadAtMin: 1.0
    }
}
