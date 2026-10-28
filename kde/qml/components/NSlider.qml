import QtQuick

/* Draggable level (seek bar, volume). `value` 0..1 follows the model until
   dragged; `moved(v)` while dragging, `released(v)` at the end. */
Item {
    id: root
    property real value: 0
    property color track: Qt.rgba(1, 1, 1, 0.22)
    property color fill: Theme.text
    property real barHeight: 4
    property bool interactive: true
    property bool showHandle: false
    readonly property bool dragging: mouse.pressed
    readonly property real shown: dragging ? dragValue : Math.max(0, Math.min(1, value))
    property real dragValue: 0
    signal moved(real value)
    signal released(real value)
    implicitHeight: 13
    implicitWidth: 120

    function valueAt(x) { return Math.max(0, Math.min(1, x / width)); }

    Rectangle {
        anchors.verticalCenter: parent.verticalCenter
        width: parent.width
        height: mouse.containsMouse || root.dragging ? root.barHeight + 2 : root.barHeight
        radius: height / 2
        color: root.track
        Behavior on height { NumberAnimation { duration: 120 } }
        Rectangle {
            width: parent.width * root.shown; height: parent.height; radius: height / 2
            color: root.fill
        }
    }
    Rectangle {
        visible: root.showHandle || root.dragging
        width: 12; height: 12; radius: 6
        color: root.fill
        anchors.verticalCenter: parent.verticalCenter
        x: root.width * root.shown - width / 2
    }
    MouseArea {
        id: mouse
        anchors.fill: parent
        anchors.margins: -4
        enabled: root.interactive
        hoverEnabled: true
        cursorShape: root.interactive ? Qt.PointingHandCursor : Qt.ArrowCursor
        preventStealing: true
        onPressed: m => { root.dragValue = root.valueAt(m.x - 4); root.moved(root.dragValue); }
        onPositionChanged: m => { if (pressed) { root.dragValue = root.valueAt(m.x - 4); root.moved(root.dragValue); } }
        onReleased: root.released(root.dragValue)
    }
}
