import QtQuick
import QtQuick.Layouts

/* icon/art · up to three lines of text · optional trailing item */
RowLayout {
    id: card
    default property alias leading: lead.data
    property alias trailing: trail.data
    property var lines: []          // [[text, "caption"|"title"|"body"|"privacyTitle"|"privacyApp"]]
    property bool compact: false
    spacing: compact ? 9 : 11
    anchors.leftMargin: compact ? 13 : 13
    anchors.rightMargin: compact ? 13 : 18

    readonly property var styles: ({
        caption: {size: 10, weight: Font.Normal, color: Theme.textDim},
        title: {size: 13, weight: Font.DemiBold, color: Theme.text},
        body: {size: 12, weight: Font.Normal, color: Theme.textDim},
        privacyTitle: {size: 12, weight: Font.DemiBold, color: Theme.text},
        privacyApp: {size: 11, weight: Font.Normal, color: Theme.textDim},
    })

    Item {
        id: lead
        Layout.alignment: Qt.AlignVCenter
        implicitWidth: childrenRect.width
        implicitHeight: childrenRect.height
    }
    ColumnLayout {
        Layout.fillWidth: true
        Layout.alignment: Qt.AlignVCenter
        spacing: 1
        Repeater {
            model: card.lines.filter(l => !!l[0])
            NText {
                required property var modelData
                Layout.fillWidth: true
                text: modelData[0]
                size: card.styles[modelData[1]].size
                weight: card.styles[modelData[1]].weight
                color: card.styles[modelData[1]].color
            }
        }
    }
    Item {
        id: trail
        Layout.alignment: Qt.AlignVCenter
        implicitWidth: childrenRect.width
        implicitHeight: childrenRect.height
        visible: children.length > 0
    }
}
