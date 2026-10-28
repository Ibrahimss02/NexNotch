import QtQuick
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

SettingsPage {
    SettingsSwitch { key: "showNotifications"; text: "Show notifications in the notch"; Kirigami.FormData.label: "Peek:" }

    SettingsSwitch {
        key: "notifSuppressNative"; text: "Hide Plasma's own notification popups"
        Kirigami.FormData.label: "Plasma popups:"
        enabled: Config.showNotifications
    }
    SettingsHint {
        text: "Your eyes only need to watch the notch. This uses Plasma's “an app is inhibiting notifications” mechanism, so while NexNotch runs the bell in the system tray shows a Do Not Disturb–like state. Notifications still go to Plasma's history."
    }
    SettingsSpin {
        key: "notifAutoDismiss"; from: 0; to: 120
        Kirigami.FormData.label: "Close popups after:"
        enabled: !Config.showNotifications || !Config.notifSuppressNative
        textFromValue: v => v === 0 ? "Never" : `${v} s`
        valueFromText: t => parseInt(t) || 0
    }
    SettingsHint { text: "When Plasma's popups are shown: non-critical ones close by themselves after this long." }

    Item {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: "On-screen display"
    }
    SettingsSwitch { key: "replaceOsd"; text: "Show volume and brightness changes in the notch"; Kirigami.FormData.label: "OSD:" }
    SettingsHint { text: "Instead of Plasma's on-screen display in the middle of the screen." }

    Item {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: "Do Not Disturb"
    }
    QQC2.Switch {
        Kirigami.FormData.label: "Now:"
        text: "Do Not Disturb"
        checked: Notifications.doNotDisturb
        onToggled: Notifications.setDoNotDisturb(checked)
    }
    SettingsHint {
        text: "Also in the notch's Quick tab and Plasma's notifications applet. It's Plasma's own Do Not Disturb, so it silences other apps' popups too."
    }
}
