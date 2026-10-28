import QtQuick

/* A thin level: track plus fill; past 100 % the overdrive part turns red. */
Item {
    id: root
    property real value: 0          // 0..maximum
    property real maximum: 1
    property color track: Theme.surfaceHi
    property color fill: Theme.text
    property color overdrive: Theme.red
    property real barHeight: 5
    implicitHeight: barHeight
    implicitWidth: 120
    readonly property real frac: maximum > 0 ? Math.max(0, Math.min(1, value / maximum)) : 0
    readonly property real fullFrac: maximum > 0 ? Math.min(1, 1 / maximum) : 1

    Rectangle {
        anchors.verticalCenter: parent.verticalCenter
        width: parent.width; height: root.barHeight; radius: height / 2
        color: root.track
        Rectangle {
            width: parent.width * Math.min(root.frac, root.fullFrac); height: parent.height; radius: height / 2
            color: root.fill
            Behavior on width { NumberAnimation { duration: 100; easing.type: Easing.OutQuad } }
        }
        Rectangle {
            visible: root.frac > root.fullFrac
            x: parent.width * root.fullFrac
            width: parent.width * (root.frac - root.fullFrac); height: parent.height; radius: height / 2
            color: root.overdrive
        }
    }
}
