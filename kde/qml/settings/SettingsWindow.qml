import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

/* The settings window: the GNOME prefs' pages as a System Settings–style
   sidebar of Kirigami forms. Every control writes straight to Config, which
   the notch shares, so changes apply live — there's no Apply button.
   `page` picks the page by id ("weather", …); Main.showSettings sets it. */
QQC2.ApplicationWindow {
    id: win
    property string page: ""

    title: "NexNotch Settings"
    width: Kirigami.Units.gridUnit * 50
    height: Kirigami.Units.gridUnit * 38
    minimumWidth: Kirigami.Units.gridUnit * 36
    minimumHeight: Kirigami.Units.gridUnit * 24

    readonly property var pages: [
        {id: "general",       title: "General",       icon: "preferences-system",                    file: "GeneralSettings.qml"},
        {id: "appearance",    title: "Appearance",    icon: "preferences-desktop-color",             file: "AppearanceSettings.qml"},
        {id: "clock",         title: "Clock",         icon: "preferences-system-time",               file: "ClockSettings.qml"},
        {id: "notifications", title: "Notifications", icon: "preferences-desktop-notification-bell", file: "NotificationsSettings.qml"},
        {id: "weather",       title: "Weather",       icon: "weather-few-clouds",                    file: "WeatherSettings.qml"},
        {id: "claude",        title: "Claude",        icon: "utilities-terminal",                    file: "ClaudeSettings.qml"},
        {id: "pomodoro",      title: "Pomodoro",      icon: "chronometer",                           file: "PomodoroSettings.qml"},
        {id: "calendar",      title: "Calendar",      icon: "view-calendar",                         file: "CalendarSettings.qml"},
        {id: "shortcuts",     title: "Shortcuts",     icon: "preferences-desktop-keyboard-shortcut", file: "ShortcutsSettings.qml"},
    ]
    readonly property int current: Math.max(0, pages.findIndex(p => p.id === page.toLowerCase()))

    /* text fields commit on editingFinished; make sure the focused one does
       before the window goes away */
    onClosing: contentItem.forceActiveFocus()

    RowLayout {
        anchors.fill: parent
        spacing: 0

        /* sidebar, in the View colour set like System Settings' */
        Rectangle {
            Layout.fillHeight: true
            Layout.preferredWidth: Kirigami.Units.gridUnit * 12
            Kirigami.Theme.colorSet: Kirigami.Theme.View
            Kirigami.Theme.inherit: false
            color: Kirigami.Theme.backgroundColor

            ColumnLayout {
                anchors.fill: parent
                spacing: 0

                ListView {
                    id: sidebar
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    Layout.topMargin: Kirigami.Units.smallSpacing
                    clip: true
                    model: win.pages
                    keyNavigationEnabled: true
                    activeFocusOnTab: true
                    /* page and selection follow each other both ways (keyboard
                       navigation would break a plain binding) */
                    currentIndex: win.current
                    onCurrentIndexChanged: if (currentIndex >= 0) win.page = win.pages[currentIndex].id
                    Connections {
                        target: win
                        function onCurrentChanged() { sidebar.currentIndex = win.current; }
                    }

                    delegate: QQC2.ItemDelegate {
                        required property var modelData
                        required property int index
                        width: ListView.view.width
                        text: modelData.title
                        icon.name: modelData.icon
                        highlighted: ListView.isCurrentItem
                        onClicked: win.page = modelData.id
                    }
                }

                Kirigami.Separator { Layout.fillWidth: true }

                /* about */
                ColumnLayout {
                    Layout.fillWidth: true
                    Layout.margins: Kirigami.Units.largeSpacing
                    spacing: 0

                    RowLayout {
                        spacing: Kirigami.Units.smallSpacing
                        /* the app icon, once installed */
                        Kirigami.Icon {
                            source: Sys.appInfo("io.nexvar.NexNotch").icon ?? ""
                            visible: source !== ""
                            Layout.preferredWidth: Kirigami.Units.iconSizes.medium
                            Layout.preferredHeight: Kirigami.Units.iconSizes.medium
                        }
                        ColumnLayout {
                            spacing: 0
                            QQC2.Label { text: "NexNotch"; font.bold: true }
                            QQC2.Label {
                                text: `Version ${Sys.version}`
                                font: Kirigami.Theme.smallFont
                                color: Kirigami.Theme.disabledTextColor
                            }
                        }
                    }
                    QQC2.Label {
                        Layout.topMargin: Kirigami.Units.smallSpacing
                        text: "Built by NexVar"
                        font: Kirigami.Theme.smallFont
                    }
                    Kirigami.UrlButton {
                        url: "https://github.com/Ibrahimss02/NexNotch"
                        text: "GitHub repository"
                        font: Kirigami.Theme.smallFont
                    }
                }
            }
        }

        Kirigami.Separator { Layout.fillHeight: true }

        ColumnLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 0

            Kirigami.Heading {
                Layout.fillWidth: true
                Layout.margins: Kirigami.Units.largeSpacing
                Layout.leftMargin: Kirigami.Units.largeSpacing * 2
                level: 2
                text: win.pages[win.current].title
            }
            Kirigami.Separator { Layout.fillWidth: true }

            Loader {
                Layout.fillWidth: true
                Layout.fillHeight: true
                source: Qt.resolvedUrl(win.pages[win.current].file)
            }
        }
    }
}
