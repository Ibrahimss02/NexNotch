import QtQuick
import QtQuick.Controls as QQC2

/* A boolean Config key; changes apply as soon as it's flipped */
QQC2.Switch {
    required property string key
    checked: Config[key]
    onToggled: Config[key] = checked
}
