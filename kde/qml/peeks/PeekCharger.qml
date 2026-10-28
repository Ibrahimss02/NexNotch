import QtQuick
import QtQuick.Layouts

/* charger plugged in / unplugged */
Item {
    id: peek
    property var notch
    property var info: ({})
    readonly property int pct: info.percentage === null || info.percentage === undefined ? -1 : Math.round(info.percentage)
    readonly property string title: !info.plugged ? "On battery" : info.state === "full" ? "Fully charged"
        : info.state === "pending" ? "Not charging" : "Charging"
    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: 13; anchors.rightMargin: 13
        spacing: 9
        Row {
            Layout.fillWidth: true
            spacing: 7
            NIcon { visible: !!peek.info.plugged; anchors.verticalCenter: parent.verticalCenter; name: "own:bolt"; size: 13; color: Theme.green }
            BatteryGlyph {
                visible: !peek.info.plugged
                anchors.verticalCenter: parent.verticalCenter
                level: Math.max(0, peek.pct) / 100
                color: peek.pct >= 0 && peek.pct < 20 ? Theme.red : Theme.text
            }
            NText { anchors.verticalCenter: parent.verticalCenter; text: peek.title; size: 12; weight: Font.DemiBold; color: peek.info.plugged ? Theme.green : Theme.text }
        }
        NText { visible: peek.pct >= 0; text: `${peek.pct}%`; size: 13; weight: Font.DemiBold; tnum: true; color: peek.info.plugged ? Theme.green : Theme.text }
    }
}
