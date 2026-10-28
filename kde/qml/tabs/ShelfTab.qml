import QtQuick

/* Shelf: the files dropped on the notch as tiles (shelf.js render()).
   Click opens, the copy button puts the file on the clipboard, and a tile
   dragged out of the notch drops the file into any app. While a drag
   hovers the open notch the grid gives way to a big drop zone. */
Item {
    id: tab
    property var notch
    readonly property var shelf: Services.shelf
    readonly property var items: shelf.items
    readonly property bool dropping: notch?.shelfDrop === "hover"
    readonly property int perRow: 5
    implicitHeight: col.implicitHeight

    function count(n) { return `${n} item${n === 1 ? "" : "s"}`; }

    /* files may have moved or gone since the shelf was last shown */
    Component.onCompleted: shelf.refresh()

    Column {
        id: col
        width: parent.width
        spacing: 14

        Item {
            x: 7
            width: parent.width - 14
            height: 27
            Row {
                anchors.verticalCenter: parent.verticalCenter
                spacing: 7
                NText { id: title; text: "Shelf"; size: 15; weight: Font.DemiBold }
                NText {
                    visible: tab.items.length > 0
                    anchors.baseline: title.baseline
                    text: tab.count(tab.items.length)
                    size: 12; weight: Font.Medium; color: Theme.textDim
                }
            }
            NButton {
                visible: tab.items.length > 0 && !tab.dropping
                anchors.right: parent.right
                implicitWidth: clearLabel.implicitWidth + 26
                implicitHeight: 27
                radius: 14
                color: Theme.surface; hoverColor: Theme.surfaceHi
                onClicked: tab.shelf.clear()
                NText { id: clearLabel; anchors.centerIn: parent; text: "Clear"; size: 12; weight: Font.Medium }
            }
        }

        Rectangle {
            visible: tab.dropping
            width: parent.width
            height: 117
            radius: 25
            color: "#08182C"
            border.color: Theme.blue
            border.width: 2
            Column {
                anchors.horizontalCenter: parent.horizontalCenter
                y: 18
                spacing: 7
                Rectangle {
                    anchors.horizontalCenter: parent.horizontalCenter
                    width: 43; height: 43; radius: 22
                    color: Theme.blue
                    NIcon { anchors.centerIn: parent; name: "folder-download-symbolic"; size: 20 }
                }
                NText { anchors.horizontalCenter: parent.horizontalCenter; text: "Release to add to Shelf"; size: 15; weight: Font.DemiBold }
                NText {
                    anchors.horizontalCenter: parent.horizontalCenter
                    text: tab.items.length ? `${tab.count(tab.items.length)} already on the shelf` : "Files stay where they are"
                    size: 12; color: Theme.textDim
                }
            }
        }

        /* rows rather than a horizontal strip: sideways swipes change tabs.
           Hidden, not destroyed, during a drop: a tile may be the drag's source. */
        Flickable {
            visible: !tab.dropping
            width: parent.width
            height: Math.min(270, grid.height)
            contentHeight: grid.height
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            interactive: contentHeight > height

            Grid {
                id: grid
                /* placed as a full row, so tiles don't shift as items come and go */
                x: (tab.width - tab.perRow * 112 - (tab.perRow - 1) * spacing) / 2
                columns: tab.perRow
                spacing: 9
                Repeater {
                    model: tab.items
                    ShelfTile { required property var modelData; item: modelData }
                }
                Rectangle {
                    width: 112; height: 126
                    radius: 20
                    color: "transparent"
                    border.color: "#48484A"
                    border.width: 1.5
                    Column {
                        y: 32
                        width: parent.width
                        spacing: 7
                        NIcon { anchors.horizontalCenter: parent.horizontalCenter; name: "list-add-symbolic"; size: 20; color: Theme.textDim }
                        NText {
                            x: 11
                            width: parent.width - 22
                            text: "Drop files on the island"
                            size: 11; color: Theme.textDim
                            wrapMode: Text.WordWrap
                            horizontalAlignment: Text.AlignHCenter
                        }
                    }
                }
            }
        }

        NText {
            visible: !tab.dropping
            anchors.horizontalCenter: parent.horizontalCenter
            text: "Click to open · copy to paste it anywhere"
            size: 11; color: Theme.textDim
        }
    }

    component ShelfTile: Item {
        id: tile
        property var item
        property var grab: null        // a snapshot of the tile, as the drag's picture
        width: 112; height: 126

        NButton {
            id: body
            anchors.fill: parent
            implicitWidth: 112; implicitHeight: 126
            opacity: tile.item.exists ? 1 : 0.45
            radius: 20
            color: "#1C1C1E"; hoverColor: "#232326"; pressColor: "#2C2C2E"
            accessibleName: tile.item.name
            onClicked: tab.shelf.open(tile.item.url)
            onHoveredChanged: if (hovered && !tile.grab) tile.grabToImage(r => tile.grab = r)

            Column {
                anchors.bottom: parent.bottom
                anchors.bottomMargin: 13
                x: 9
                width: parent.width - 18
                Item {
                    anchors.horizontalCenter: parent.horizontalCenter
                    width: 43; height: 50
                    RoundedImage {
                        id: thumb
                        width: 43; height: 43
                        radius: 8
                        source: tile.item.thumb
                        sourceSize: Qt.size(86, 86)
                    }
                    NIcon {
                        visible: !thumb.ready
                        name: tile.item.icon
                        size: 43
                        isMask: false
                    }
                }
                NText {
                    width: parent.width
                    horizontalAlignment: Text.AlignHCenter
                    text: tile.item.name
                    elide: Text.ElideMiddle
                    size: 12; weight: Font.DemiBold
                }
                NText {
                    width: parent.width
                    horizontalAlignment: Text.AlignHCenter
                    topPadding: 1.8
                    text: !tile.item.exists ? "Missing" : tile.item.isDir ? "Folder" : tab.shelf.formatSize(tile.item.size)
                    size: 10; color: Theme.textDim
                }
            }
        }

        /* drag the file out to another app; under the buttons so they still click */
        Item {
            anchors.fill: parent
            enabled: tile.item.exists
            Drag.dragType: Drag.Automatic
            Drag.supportedActions: Qt.CopyAction
            Drag.mimeData: ({"text/uri-list": tile.item.url + "\r\n"})
            Drag.imageSource: tile.grab?.url ?? ""
            Drag.hotSpot: Qt.point(width / 2, height / 2)
            Drag.active: dragOut.active
            Drag.onDragFinished: tab.shelf.draggingOut = false
            DragHandler {
                id: dragOut
                target: null
                onActiveChanged: if (active) tab.shelf.draggingOut = true
            }
        }

        /* copy appears on hover; remove is always there */
        ShelfAct {
            anchors.left: parent.left
            icon: "edit-copy-symbolic"
            accessibleName: "Copy file"
            visible: tile.item.exists
            opacity: body.hovered || hovered ? 1 : 0
            Behavior on opacity { NumberAnimation { duration: 120 } }
            onClicked: tab.shelf.copy(tile.item.url)
        }
        ShelfAct {
            anchors.right: parent.right
            icon: "window-close-symbolic"
            accessibleName: "Remove from shelf"
            onClicked: tab.shelf.remove(tile.item.url)
        }
    }

    component ShelfAct: NButton {
        id: act
        property string icon
        anchors.top: parent.top
        anchors.margins: 7
        implicitWidth: 20; implicitHeight: 20
        radius: 10
        color: Theme.surfaceHi; hoverColor: Theme.disabled; pressColor: Theme.disabled
        NIcon { anchors.centerIn: parent; name: act.icon; size: 9; color: "#E5E5EA" }
    }
}
