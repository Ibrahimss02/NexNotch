import QtQuick
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

SettingsPage {
    SettingsSwitch { key: "showClaudeUsage"; text: "Show the Claude usage tab"; Kirigami.FormData.label: "Claude Code:" }
    SettingsSpin { key: "claudeUsageRefresh"; from: 5; to: 120; stepSize: 5; unit: "min"; enabled: Config.showClaudeUsage; Kirigami.FormData.label: "Refresh every:" }
    SettingsHint {
        text: "Reads the local Claude Code CLI session (the same login <i>claude</i> already uses) and shows the session and weekly quota use. Run <i>claude</i> once to sign in first."
    }
}
