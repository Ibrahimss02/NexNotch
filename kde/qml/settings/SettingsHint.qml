import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

/* The small explanatory text under a control (Adw's row subtitles and
   group descriptions in the GNOME prefs) */
QQC2.Label {
    Layout.fillWidth: true
    Layout.maximumWidth: Kirigami.Units.gridUnit * 22
    wrapMode: Text.Wrap
    font: Kirigami.Theme.smallFont
    color: Kirigami.Theme.disabledTextColor
    textFormat: Text.StyledText
    onLinkActivated: link => Qt.openUrlExternally(link)
}
