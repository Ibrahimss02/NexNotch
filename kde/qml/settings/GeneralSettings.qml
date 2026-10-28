import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

SettingsPage {
    Item {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: "Modules"
    }
    SettingsSwitch { key: "showSystem"; text: "System monitor"; Kirigami.FormData.label: "Show:" }
    SettingsSwitch { key: "showNotifications"; text: "Dynamic notification peek" }
    SettingsSwitch { key: "showCalendar"; text: "Calendar" }
    SettingsSwitch { key: "showTasks"; text: "Tasks" }
    SettingsSwitch { key: "showClaudeUsage"; text: "Claude Code usage" }

    Item {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: "Drink water"
    }
    SettingsSwitch { key: "showWater"; text: "Drink-water reminders"; Kirigami.FormData.label: "Reminders:" }
    SettingsSpin { key: "waterInterval"; from: 1; to: 120; unit: "min"; enabled: Config.showWater; Kirigami.FormData.label: "Remind every:" }
    SettingsSpin { key: "waterGoal"; from: 1; to: 30; unit: Config.waterGoal === 1 ? "cup" : "cups"; Kirigami.FormData.label: "Daily goal:" }
    SettingsHint { text: "The Water tab tracks the cups you drink today; reminders come on the interval." }

    Item {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: "Desktop"
    }
    SettingsSwitch { key: "autostart"; text: "Start NexNotch when I log in"; Kirigami.FormData.label: "Startup:" }
    SettingsSwitch { key: "reserveSpace"; text: "Reserve space for the notch"; Kirigami.FormData.label: "Windows:" }
    SettingsHint { text: "Maximized windows stop below the collapsed notch instead of sliding under it. Turn off to let windows use the full height." }
    SettingsSwitch { key: "islandWhenCovered"; text: "Hide when a window is behind the notch" }
    SettingsHint { text: "With a window reaching up under it, the notch disappears. Hovering its spot at the top still opens it, as a floating island, and notifications still show." }
    SettingsHint {
        Kirigami.FormData.label: "Panel clock:"
        color: Kirigami.Theme.textColor
        font: Kirigami.Theme.defaultFont
        text: "The notch shows the time and date, so Plasma's Digital Clock may be redundant: right-click it in the panel and choose <i>Remove</i>."
    }

    Item {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: "Performance"
    }
    SettingsSpin { key: "pollInterval"; from: 1; to: 30; unit: "s"; Kirigami.FormData.label: "System poll interval:" }
    SettingsHint { text: "1 s is real-time; 3 s is lighter on the CPU." }

    Item {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: "Updates"
    }
    SettingsSwitch { key: "checkUpdates"; text: "Check for updates"; Kirigami.FormData.label: "GitHub:" }
    SettingsHint { text: `Once a day, asks GitHub for the latest release and tells you about a newer one. Installed: ${Sys.version}` }
}
