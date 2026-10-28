import QtQuick
import QtQuick.Controls as QQC2

/* An integer Config key, clamped to the GNOME schema's range */
QQC2.SpinBox {
    required property string key
    property string unit: ""

    editable: true
    value: Config[key]
    onValueModified: Config[key] = value
    textFromValue: v => unit ? `${v} ${unit}` : `${v}`
    valueFromText: t => parseInt(t) || 0
}
