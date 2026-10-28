import QtQuick
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

/* One settings page: a scrolling Kirigami.FormLayout, the way System
   Settings' modules are laid out. Children go straight into the form. */
QQC2.ScrollView {
    id: root
    default property alias content: form.data

    /* sized by the window, not by the form (that would loop through contentWidth) */
    implicitWidth: Kirigami.Units.gridUnit * 30
    implicitHeight: Kirigami.Units.gridUnit * 20
    contentWidth: availableWidth
    topPadding: Kirigami.Units.largeSpacing * 2
    bottomPadding: Kirigami.Units.largeSpacing * 2
    QQC2.ScrollBar.horizontal.policy: QQC2.ScrollBar.AlwaysOff

    Kirigami.FormLayout {
        id: form
        width: root.availableWidth
    }
}
