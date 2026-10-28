import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

SettingsPage {
    Item {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: "Size"
    }
    SettingsSpin { key: "collapsedWidth"; from: 140; to: 480; stepSize: 5; unit: "px"; Kirigami.FormData.label: "Collapsed width:" }
    SettingsSpin { key: "collapsedHeight"; from: 24; to: 56; unit: "px"; Kirigami.FormData.label: "Collapsed height:" }
    SettingsSpin { key: "expandedWidth"; from: 420; to: 960; stepSize: 10; unit: "px"; Kirigami.FormData.label: "Expanded width:" }
    SettingsSpin { key: "expandedHeight"; from: 200; to: 480; stepSize: 10; unit: "px"; Kirigami.FormData.label: "Expanded height:" }
    SettingsHint { text: "The smallest height of the open notch; it grows to fit the tab." }
    SettingsSpin { key: "cornerRadius"; from: 0; to: 60; unit: "px"; Kirigami.FormData.label: "Corner radius:" }

    Item {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: "Colors"
    }
    SettingsColorButton { key: "bgColor"; title: "Background color"; Kirigami.FormData.label: "Background:" }
    SettingsColorButton { key: "accentColor"; title: "Accent color"; Kirigami.FormData.label: "Accent:" }
    SettingsHint { text: "Any color and opacity; a translucent background gets KWin's blur behind it." }

    Flow {
        Kirigami.FormData.label: "Presets:"
        Layout.fillWidth: true
        Layout.maximumWidth: Kirigami.Units.gridUnit * 26
        spacing: Kirigami.Units.smallSpacing

        /* the GNOME prefs' one-click looks, rgba() as there */
        Repeater {
            model: [
                ["Apple",    [0, 0, 0, 0.85],    [120, 170, 255, 0.28]],
                ["True",     [0, 0, 0, 1.00],    [140, 190, 255, 0.35]],
                ["Graphite", [22, 22, 26, 0.92], [180, 180, 190, 0.22]],
                ["Nord",     [46, 52, 64, 0.92], [136, 192, 208, 0.30]],
                ["Dracula",  [40, 42, 54, 0.92], [189, 147, 249, 0.32]],
            ]
            delegate: QQC2.Button {
                id: preset
                required property var modelData
                readonly property color bg: Qt.rgba(modelData[1][0] / 255, modelData[1][1] / 255, modelData[1][2] / 255, modelData[1][3])
                readonly property color accent: Qt.rgba(modelData[2][0] / 255, modelData[2][1] / 255, modelData[2][2] / 255, modelData[2][3])
                readonly property bool active: Qt.colorEqual(bg, Config.bgColor) && Qt.colorEqual(accent, Config.accentColor)
                Accessible.name: modelData[0]
                leftPadding: Kirigami.Units.largeSpacing
                rightPadding: Kirigami.Units.largeSpacing
                checked: active
                onClicked: {
                    Config.bgColor = bg.toString();
                    Config.accentColor = accent.toString();
                }
                /* a tiny pill in the preset's colours */
                contentItem: RowLayout {
                    spacing: Kirigami.Units.smallSpacing
                    Rectangle {
                        implicitWidth: Kirigami.Units.gridUnit * 1.5
                        implicitHeight: Kirigami.Units.gridUnit * 0.75
                        radius: height / 2
                        color: Qt.rgba(preset.bg.r, preset.bg.g, preset.bg.b, 1)
                        Rectangle {
                            anchors.centerIn: parent
                            width: parent.width - 6; height: parent.height - 6
                            radius: height / 2
                            color: Qt.tint(parent.color, preset.accent)
                        }
                    }
                    QQC2.Label { text: preset.modelData[0] }
                }
            }
        }
    }

    Item {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: "Battery icon"
    }
    SettingsColorButton { key: "batteryChargingColor"; title: "Charging"; Kirigami.FormData.label: "Charging:" }
    SettingsColorButton { key: "batteryNormalColor"; title: "Discharging"; Kirigami.FormData.label: "Discharging:" }
    SettingsColorButton { key: "batteryLowColor"; title: "Low battery"; Kirigami.FormData.label: "Low battery:" }
    SettingsHint { text: "The battery indicator in the collapsed pill." }
}
