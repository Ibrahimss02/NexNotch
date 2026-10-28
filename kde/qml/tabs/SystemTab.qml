import QtQuick
import QtQuick.Layouts

/* System: a row of stat cards (CPU, memory, battery, uptime) above a list
   of live rates — network, disk, temperature, load — and storage. Polls
   fast only while shown. */
Item {
    id: tab
    property var notch
    readonly property var s: Services.system.stats ?? {cpu: 0, ram: 0, swap: 0, netRx: 0, netTx: 0, diskR: 0, diskW: 0,
                                                       diskUsed: 0, diskTotal: 0, temp: 0, load: [0, 0, 0], uptime: 0}
    readonly property var battery: Services.power.battery
    implicitHeight: col.implicitHeight

    Component.onCompleted: Services.system.focused = true
    Component.onDestruction: Services.system.focused = false

    function timeFmt(minutes) {
        if (minutes < 60) return `${minutes}m`;
        const h = Math.floor(minutes / 60), m = minutes % 60;
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    function upFmt(sec) {
        const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
        return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
    }
    function kbFmt(kb) {
        if (kb < 1) return `${(kb * 1024).toFixed(0)} B/s`;
        if (kb < 1024) return `${kb.toFixed(1)} KB/s`;
        return `${(kb / 1024).toFixed(2)} MB/s`;
    }
    function gbFmt(bytes) { return `${(bytes / 1024 ** 3).toFixed(0)} GB`; }

    readonly property string batterySub: {
        const b = battery;
        if (!b) return "";
        const secs = b.status === "charging" ? b.timeToFull : b.status === "discharging" ? b.timeToEmpty : 0;
        if (secs > 0) return `${timeFmt(Math.round(secs / 60))} ${b.status === "charging" ? "to full" : "left"}`;
        return b.status.charAt(0).toUpperCase() + b.status.slice(1);
    }

    component StatCard: Rectangle {
        id: card
        property string label
        property string value
        property color valueColor: Theme.text
        property real bar: -1               // percent, or -1 for the sub line instead
        property color barColor: Theme.blue
        property string sub
        Layout.fillWidth: true
        Layout.fillHeight: true
        Layout.preferredWidth: 1            // equal widths, like a homogeneous box
        implicitHeight: cardCol.implicitHeight + 26
        radius: 22
        color: "#1C1C1E"
        ColumnLayout {
            id: cardCol
            anchors.left: parent.left; anchors.right: parent.right; anchors.top: parent.top
            anchors.margins: 13; anchors.leftMargin: 14; anchors.rightMargin: 14
            spacing: 5
            NText { Layout.fillWidth: true; text: card.label; size: 11; weight: Font.Medium; color: Theme.textDim }
            NText {
                Layout.fillWidth: true
                text: card.value; size: 25; weight: Font.DemiBold; tnum: true; color: card.valueColor
                font.letterSpacing: -0.5
            }
            BarLevel {
                Layout.fillWidth: true
                visible: card.bar >= 0
                value: Math.min(1, card.bar / 100)
                barHeight: 4; track: Theme.surface; fill: card.barColor
            }
            NText { Layout.fillWidth: true; visible: card.bar < 0; text: card.sub; size: 11; color: Theme.textDim }
        }
    }

    component StatRow: Item {
        id: row
        property string icon
        property color iconColor
        property string label
        property string value
        property color valueColor: Theme.textDim
        property bool last: false
        Layout.fillWidth: true
        implicitHeight: 41
        RowLayout {
            anchors.fill: parent
            spacing: 11
            NIcon { name: row.icon; size: 16; color: row.iconColor }
            NText { Layout.fillWidth: true; text: row.label; size: 14 }
            NText { text: row.value; size: 14; tnum: true; color: row.valueColor }
        }
        Rectangle { visible: !row.last; anchors.bottom: parent.bottom; width: parent.width; height: 1; color: Theme.surface }
    }

    ColumnLayout {
        id: col
        width: parent.width
        spacing: 14

        RowLayout {
            Layout.fillWidth: true
            Layout.margins: 2
            spacing: 9
            StatCard { label: "CPU"; value: `${tab.s.cpu.toFixed(0)}%`; bar: tab.s.cpu; barColor: Theme.blue }
            StatCard { label: "Memory"; value: `${tab.s.ram.toFixed(0)}%`; bar: tab.s.ram; barColor: Theme.purple }
            StatCard {
                visible: !!tab.battery
                label: "Battery"
                value: `${tab.battery?.capacity ?? 0}%`
                valueColor: tab.battery?.plugged ? Theme.green : (tab.battery?.capacity ?? 100) < 20 ? Theme.red : Theme.text
                sub: tab.batterySub
            }
            StatCard {
                label: "Uptime"
                value: tab.upFmt(tab.s.uptime)
                sub: tab.s.swap > 0 ? `Swap ${tab.s.swap.toFixed(0)}%` : "No swap in use"
            }
        }

        Rectangle {
            Layout.fillWidth: true
            implicitHeight: list.implicitHeight + 8
            radius: 23
            color: "#1C1C1E"
            ColumnLayout {
                id: list
                anchors.fill: parent
                anchors.topMargin: 4; anchors.bottomMargin: 4
                anchors.leftMargin: 16; anchors.rightMargin: 16
                spacing: 0
                StatRow {
                    icon: "network-wired-activated-symbolic"; iconColor: Theme.blue; label: "Network"
                    value: `↓ ${tab.kbFmt(tab.s.netRx)}   ↑ ${tab.kbFmt(tab.s.netTx)}`
                }
                StatRow {
                    icon: "drive-harddisk-symbolic"; iconColor: Theme.cyan; label: "Disk"
                    value: `Read ${tab.kbFmt(tab.s.diskR)}   Write ${tab.kbFmt(tab.s.diskW)}`
                }
                StatRow {
                    visible: tab.s.temp > 0
                    icon: "temperature-normal-symbolic"; iconColor: Theme.orange; label: "Temperature"
                    value: `${tab.s.temp.toFixed(0)} °C`
                }
                StatRow {
                    icon: "speedometer-symbolic"; iconColor: Theme.green; label: "Load average"
                    value: tab.s.load.map(x => x.toFixed(2)).join(" · ")
                    last: !storage.visible
                }
                ColumnLayout {
                    id: storage
                    readonly property real free: tab.s.diskTotal - tab.s.diskUsed
                    Layout.fillWidth: true
                    visible: tab.s.diskTotal > 0
                    spacing: 0
                    StatRow {
                        icon: "drive-harddisk-root-symbolic"; iconColor: Theme.orange; label: "Storage"; last: true
                        value: `${tab.gbFmt(tab.s.diskUsed)} of ${tab.gbFmt(tab.s.diskTotal)} · ${tab.gbFmt(storage.free)} free`
                        valueColor: storage.free / tab.s.diskTotal < 0.1 ? Theme.orange : Theme.textDim
                    }
                    BarLevel {
                        Layout.fillWidth: true
                        Layout.leftMargin: 27; Layout.bottomMargin: 11
                        value: tab.s.diskUsed / Math.max(1, tab.s.diskTotal)
                        barHeight: 5; track: Theme.surface; fill: Theme.orange
                    }
                }
            }
        }
    }
}
