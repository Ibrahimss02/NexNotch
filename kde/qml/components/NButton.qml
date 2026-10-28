import QtQuick

/* Flat clickable: a hover/press tint behind whatever it holds. `contentItem`
   children are centred unless they anchor themselves. */
Item {
    id: root
    default property alias content: holder.data
    property color color: "transparent"
    property color hoverColor: Theme.hover
    property color pressColor: Theme.pressed
    property real radius: height / 2
    property bool checked: false
    property string accessibleName: ""
    property real padding: 0
    readonly property bool hovered: mouse.containsMouse
    readonly property bool pressed: mouse.pressed
    signal clicked(var mouse)
    signal rightClicked()

    implicitWidth: holder.childrenRect.width + padding * 2
    implicitHeight: holder.childrenRect.height + padding * 2
    opacity: enabled ? 1 : 0.4
    Accessible.role: Accessible.Button
    Accessible.name: accessibleName
    Accessible.onPressAction: if (enabled) clicked(null)

    Rectangle {
        anchors.fill: parent
        radius: root.radius
        color: !root.enabled ? root.color : mouse.pressed ? root.pressColor : mouse.containsMouse ? root.hoverColor : root.color
        Behavior on color { ColorAnimation { duration: 120 } }
    }
    Item {
        id: holder
        anchors.fill: parent
        anchors.margins: root.padding
    }
    MouseArea {
        id: mouse
        anchors.fill: parent
        enabled: root.enabled
        hoverEnabled: true
        acceptedButtons: Qt.LeftButton | Qt.RightButton
        cursorShape: root.enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
        onClicked: m => m.button === Qt.RightButton ? root.rightClicked() : root.clicked(m)
    }
}
