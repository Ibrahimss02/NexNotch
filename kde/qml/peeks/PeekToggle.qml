import QtQuick
import QtQuick.Layouts

/* "Do Not Disturb · On", "Airplane Mode · Off", "Caps Lock · On" */
Item {
    id: peek
    property var notch
    property string kind: "dnd"
    property bool on: true
    readonly property var spec: ({dnd: ["Do Not Disturb", "moon", Theme.indigo], airplane: ["Airplane Mode", "airplane", Theme.orange],
        capslock: ["Caps Lock", "capslock", Theme.text]})[kind]
    readonly property color tint: on ? spec[2] : Theme.textDim
    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: 13; anchors.rightMargin: 13
        spacing: 9
        Row {
            Layout.fillWidth: true
            spacing: 7
            NIcon { anchors.verticalCenter: parent.verticalCenter; name: "own:" + peek.spec[1]; size: 14; color: peek.tint; opacity: peek.on ? 1 : 0.43 }
            NText { anchors.verticalCenter: parent.verticalCenter; text: peek.spec[0]; size: 12; weight: Font.DemiBold; color: peek.tint }
        }
        NText { text: peek.on ? "On" : "Off"; size: 12; weight: Font.DemiBold; color: peek.tint }
    }
}
