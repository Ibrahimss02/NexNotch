import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

/* A string Config key, written when editing finishes (Enter or leaving the
   field) so services don't refetch on every keystroke */
QQC2.TextField {
    required property string key
    Layout.fillWidth: true
    Layout.maximumWidth: Kirigami.Units.gridUnit * 22
    text: Config[key]
    onEditingFinished: if (Config[key] !== text.trim()) Config[key] = text.trim()
}
