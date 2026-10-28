import QtQuick
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

SettingsPage {
    QQC2.ComboBox {
        Kirigami.FormData.label: "Time format:"
        model: ["24-hour (14:05)", "12-hour (2:05 PM)"]
        currentIndex: Config.clockFormat === "12h" ? 1 : 0
        onActivated: i => Config.clockFormat = i === 1 ? "12h" : "24h"
    }
    SettingsSwitch { key: "showSeconds"; text: "Show seconds"; Kirigami.FormData.label: "Collapsed pill:" }
    SettingsSwitch { key: "showDate"; text: "Show the date" }
    SettingsSwitch { key: "showMediaPill"; text: "Show the playing music" }

    Item {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: "Lyrics"
    }
    SettingsSwitch { key: "lyricsEnabled"; text: "Show synced lyrics"; Kirigami.FormData.label: "Music:" }
    SettingsHint { text: "In the player and, while music plays, in the collapsed pill. Lyrics are looked up on lrclib.net." }
}
