import QtQuick
import QtQuick.Layouts
import QtQuick.Dialogs
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

/* A colour Config key (#RRGGBB, or #AARRGGBB when translucent): a swatch
   that opens the colour dialog with an opacity channel, and the value. */
RowLayout {
    id: root
    required property string key
    property string title: ""
    readonly property color value: Config[key]

    spacing: Kirigami.Units.smallSpacing

    QQC2.Button {
        id: button
        implicitWidth: Kirigami.Units.gridUnit * 3
        Accessible.name: root.title
        QQC2.ToolTip.text: root.title
        QQC2.ToolTip.visible: hovered && root.title !== ""
        QQC2.ToolTip.delay: Kirigami.Units.toolTipDelay
        onClicked: {
            dialog.selectedColor = root.value;
            dialog.open();
        }

        contentItem: Item {
            /* a checkerboard behind, so the opacity shows */
            Canvas {
                anchors.fill: swatch
                visible: root.value.a < 1
                onPaint: {
                    const c = getContext("2d"), s = 4;
                    for (let y = 0; y < height; y += s)
                        for (let x = 0; x < width; x += s) {
                            c.fillStyle = (x / s + y / s) % 2 ? "#ffffff" : "#c0c0c0";
                            c.fillRect(x, y, s, s);
                        }
                }
            }
            Rectangle {
                id: swatch
                anchors.fill: parent
                anchors.margins: 1
                color: root.value
                border.color: Qt.rgba(0.5, 0.5, 0.5, 0.6)
            }
        }
    }

    QQC2.Label {
        text: {
            const v = root.value, hex = n => Math.round(n * 255).toString(16).padStart(2, "0").toUpperCase();
            return `#${hex(v.r)}${hex(v.g)}${hex(v.b)}` + (v.a < 1 ? ` · ${Math.round(v.a * 100)}%` : "");
        }
        font: Kirigami.Theme.fixedWidthFont
        color: Kirigami.Theme.disabledTextColor
    }

    ColorDialog {
        id: dialog
        title: root.title
        options: ColorDialog.ShowAlphaChannel
        onAccepted: Config[root.key] = selectedColor.toString()
    }
}
