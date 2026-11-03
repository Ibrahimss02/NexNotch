import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami
import "../Themes.js" as Themes

SettingsPage {
    Item {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: "Theme"
    }
    GridLayout {
        Layout.preferredWidth: Kirigami.Units.gridUnit * 34
        columns: 4
        columnSpacing: Kirigami.Units.smallSpacing * 2
        rowSpacing: Kirigami.Units.smallSpacing * 2

        Repeater {
            model: Themes.order
            delegate: QQC2.Button {
                id: card
                required property string modelData
                readonly property var t: Themes.themes[modelData] ?? null
                Layout.fillWidth: true
                Layout.preferredWidth: 1
                checkable: true
                checked: Config.theme === modelData
                onClicked: Config.theme = modelData
                Accessible.name: name.text
                padding: Kirigami.Units.smallSpacing * 2

                contentItem: ColumnLayout {
                    spacing: Kirigami.Units.smallSpacing
                    /* the pill in the theme's colours, its frame and ear art */
                    Rectangle {
                        Layout.fillWidth: true
                        implicitHeight: 40
                        radius: 4
                        color: "#23264F"
                        clip: true
                        Rectangle {
                            id: mini
                            anchors.horizontalCenter: parent.horizontalCenter
                            width: Math.round(parent.width * 0.5); height: 16
                            color: card.t?.bg ?? "#000000"
                            bottomLeftRadius: card.t?.cornerRadius ? 3 : 9
                            bottomRightRadius: bottomLeftRadius
                            border.color: card.t?.frame ?? "transparent"
                            border.width: card.t ? 1 : 0
                        }
                        Repeater {
                            model: card.t ? [false, true] : []
                            Image {
                                required property bool modelData
                                width: 28; height: 19
                                x: modelData ? mini.x + mini.width - 2 : mini.x - width + 2
                                source: Qt.resolvedUrl("../icons/" + (modelData ? (card.t.earRight || card.t.ear) : card.t.ear) + ".svg")
                                sourceSize: Qt.size(70, 48)
                                mirror: modelData && !card.t.earRight
                            }
                        }
                    }
                    QQC2.Label {
                        id: name
                        Layout.fillWidth: true
                        text: card.t?.name ?? "Plain"
                        font.bold: true
                        elide: Text.ElideRight
                    }
                    QQC2.Label {
                        Layout.fillWidth: true
                        text: card.t?.light ? "Built-in · light" : "Built-in"
                        font: Kirigami.Theme.smallFont
                        opacity: 0.7
                    }
                }
                QQC2.ToolTip.text: card.t?.desc ?? "The stock black notch, with your own colours from Appearance."
                QQC2.ToolTip.visible: hovered
                QQC2.ToolTip.delay: Kirigami.Units.toolTipDelay
            }
        }
    }
    QQC2.Button {
        text: "Show a test notification"
        icon.name: "notifications"
        onClicked: Sys.commandReceived("peek", "notification")
    }
    SettingsHint { text: "A theme paints the pill, the open island and the peeks you choose below. Size, corners and timing stay your own." }

    Item {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: "Use the theme for"
    }
    Repeater {
        model: [
            ["notification", "Notifications"],
            ["music", "Music"],
            ["toggle", "Toggles and volume (Do Not Disturb, Airplane, Caps Lock)"],
            ["charger", "Charger and battery"],
            ["water", "Water reminder and Shelf"],
        ]
        delegate: QQC2.CheckBox {
            required property var modelData
            required property int index
            Kirigami.FormData.label: index === 0 ? "Peeks:" : ""
            text: modelData[1]
            checked: Config.themePeeks.includes(modelData[0])
            onToggled: Config.themePeeks = checked ? Config.themePeeks.concat([modelData[0]])
                : Config.themePeeks.filter(k => k !== modelData[0])
        }
    }
    QQC2.CheckBox {
        text: "Camera, mic, recording, sharing"
        enabled: false
        checked: false
    }
    SettingsHint { text: "Privacy indicators always stay plain so nothing can disguise them." }
}
