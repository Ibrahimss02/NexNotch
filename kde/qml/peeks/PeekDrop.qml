import QtQuick
import QtQuick.Layouts

/* A file dragged onto the notch: a big drop zone (hover), or a slim
   "drop to add" pill */
Item {
    id: peek
    property var notch
    readonly property bool isDrop: true
    property string dropState: "hover"
    readonly property int count: Services.shelf.items.length
    readonly property string itemsText: `${count} item${count === 1 ? "" : "s"}`

    Item {
        anchors.fill: parent
        anchors.margins: 13
        visible: peek.dropState === "hover"
        Rectangle {
            anchors.fill: parent
            radius: 25
            color: "#08182C"
            border.color: Theme.blue
            border.width: 2
            Column {
                anchors.horizontalCenter: parent.horizontalCenter
                y: 23
                spacing: 7
                Rectangle {
                    anchors.horizontalCenter: parent.horizontalCenter
                    width: 43; height: 43; radius: 22; color: Theme.blue
                    NIcon { anchors.centerIn: parent; name: "folder-download-symbolic"; size: 20 }
                }
                NText { anchors.horizontalCenter: parent.horizontalCenter; text: "Release to add to Shelf"; size: 14; weight: Font.DemiBold }
                NText { anchors.horizontalCenter: parent.horizontalCenter; text: peek.count ? `${peek.itemsText} already on the shelf` : "Files stay where they are"
                    size: 12; color: Theme.textDim }
            }
        }
    }
    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: 20; anchors.rightMargin: 20
        visible: peek.dropState !== "hover"
        spacing: 9
        NIcon { name: "folder-download-symbolic"; size: 18; color: Theme.blue }
        NText { Layout.fillWidth: true; text: "Drop to add to Shelf"; size: 13; weight: Font.DemiBold }
        NText { visible: peek.count > 0; text: peek.itemsText; size: 11; color: Theme.textDim }
    }
}
