import QtQuick
import QtQuick.Layouts

/* Plasma's volume / brightness OSD, drawn in the notch */
Item {
    id: peek
    property var notch
    readonly property bool isOsd: true
    property string icon: ""
    property real level: -1          // < 0: no level (e.g. a device switch)
    property real maxLevel: 1
    property string label: ""
    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: 18; anchors.rightMargin: 18
        spacing: 12
        NIcon { name: peek.icon; size: 18 }
        BarLevel {
            Layout.fillWidth: true
            visible: peek.level >= 0
            value: Math.max(0, peek.level)
            maximum: peek.maxLevel > 0 ? peek.maxLevel : 1
        }
        /* with a level, the percentage; the label (often a device name) only without one */
        NText {
            Layout.fillWidth: peek.level < 0
            Layout.minimumWidth: 34
            Layout.maximumWidth: 180
            horizontalAlignment: Text.AlignRight
            text: peek.level >= 0 ? `${Math.round(peek.level * 100)}%` : peek.label
            size: 11; weight: Font.DemiBold; tnum: true
            color: Qt.rgba(1, 1, 1, 0.75)
        }
    }
}
