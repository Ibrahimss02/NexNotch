import QtQuick
import QtQuick.Layouts

/* confirms a drop; the next open shows the Shelf */
Item {
    id: peek
    property var notch
    property int count: 0
    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: 13; anchors.rightMargin: 13
        spacing: 9
        Row {
            Layout.fillWidth: true
            spacing: 7
            Rectangle {
                anchors.verticalCenter: parent.verticalCenter
                width: 16; height: 16; radius: 8; color: Theme.blue
                NIcon { anchors.centerIn: parent; name: "object-select-symbolic"; size: 10 }
            }
            NText { anchors.verticalCenter: parent.verticalCenter; text: "Added to Shelf"; size: 12; weight: Font.DemiBold }
        }
        NText { text: `${peek.count} item${peek.count === 1 ? "" : "s"}`; size: 12; tnum: true; color: Theme.textDim }
    }
}
