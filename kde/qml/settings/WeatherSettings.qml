import QtQuick
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

SettingsPage {
    Item {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: "Primary location"
    }
    SettingsText { key: "weatherLocation"; placeholderText: "By IP address"; Kirigami.FormData.label: "Location:" }
    SettingsText { key: "weatherLocationLabel"; placeholderText: "e.g. Home"; Kirigami.FormData.label: "Label:" }
    SettingsHint {
        text: "Powered by wttr.in — no API key. A city (“Istanbul”), district (“Kadıköy, Istanbul”), coordinates (“41.02,28.99”), airport code (“IST”) or a ~-prefixed place (“~Eiffel Tower”). Empty finds you by IP address."
    }

    Item {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: "Secondary location"
    }
    SettingsText { key: "weatherLocation2"; placeholderText: "Off"; Kirigami.FormData.label: "Location:" }
    SettingsText { key: "weatherLocation2Label"; placeholderText: "e.g. Work"; Kirigami.FormData.label: "Label:" }
    SettingsHint { text: "For splitting the week between two cities (or neighbourhoods). Same format; empty turns it off." }

    Item {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: "Options"
    }
    QQC2.ComboBox {
        Kirigami.FormData.label: "Units:"
        model: ["Metric (°C, km/h)", "Imperial (°F, mph)"]
        currentIndex: Config.weatherUnit === "imperial" ? 1 : 0
        onActivated: i => Config.weatherUnit = i === 1 ? "imperial" : "metric"
    }
    SettingsSpin { key: "weatherRefresh"; from: 5; to: 240; stepSize: 5; unit: "min"; Kirigami.FormData.label: "Refresh every:" }
}
