import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

SettingsPage {
    id: page

    function removePreset(p) {
        const next = Config.pomodoroPresets.filter(x => x !== p);
        if (!next.length) return;
        Config.pomodoroPresets = next;
        if (Config.pomodoroActivePreset === p) Config.pomodoroActivePreset = next[0];
    }
    function addPreset(work, rest) {
        const p = `${work}/${rest}`;
        if (!Config.pomodoroPresets.includes(p)) Config.pomodoroPresets = [...Config.pomodoroPresets, p];
    }

    Item {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: "Presets"
    }
    ColumnLayout {
        Kirigami.FormData.label: "Work / break:"
        Kirigami.FormData.buddyFor: presets.count ? presets.itemAt(0) : null
        spacing: 0

        QQC2.ButtonGroup { id: group }
        Repeater {
            id: presets
            model: Config.pomodoroPresets
            delegate: RowLayout {
                id: row
                required property string modelData
                QQC2.RadioButton {
                    Layout.minimumWidth: Kirigami.Units.gridUnit * 8
                    QQC2.ButtonGroup.group: group
                    text: row.modelData.replace("/", " / ") + " min"
                    checked: Config.pomodoroActivePreset === row.modelData
                    onToggled: if (checked) Config.pomodoroActivePreset = row.modelData
                }
                QQC2.ToolButton {
                    icon.name: "edit-delete-remove"
                    display: QQC2.AbstractButton.IconOnly
                    text: `Remove ${row.modelData}`
                    enabled: presets.count > 1
                    QQC2.ToolTip.text: text
                    QQC2.ToolTip.visible: hovered
                    QQC2.ToolTip.delay: Kirigami.Units.toolTipDelay
                    onClicked: page.removePreset(row.modelData)
                }
            }
        }
    }
    RowLayout {
        Kirigami.FormData.label: "New preset:"
        QQC2.SpinBox { id: work; from: 1; to: 180; value: 25; editable: true; Accessible.name: "Work minutes" }
        QQC2.Label { text: "/" }
        QQC2.SpinBox { id: rest; from: 1; to: 60; value: 5; editable: true; Accessible.name: "Break minutes" }
        QQC2.Label { text: "min" }
        QQC2.Button {
            text: "Add"
            icon.name: "list-add"
            enabled: !Config.pomodoroPresets.includes(`${work.value}/${rest.value}`)
            onClicked: page.addPreset(work.value, rest.value)
        }
    }
    SettingsHint { text: "Each preset is work and short-break minutes; the selected one is what the Pomodoro tab starts." }

    Item {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: "Long break"
    }
    SettingsSpin { key: "pomodoroLong"; from: 1; to: 60; unit: "min"; Kirigami.FormData.label: "Long break:" }
    SettingsSpin { key: "pomodoroCycles"; from: 1; to: 10; Kirigami.FormData.label: "Work cycles before it:" }
}
