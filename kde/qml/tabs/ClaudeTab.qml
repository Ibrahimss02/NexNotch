import QtQuick
import QtQuick.Layouts

/* Limits: Claude Code's session (five-hour) and weekly usage as rings,
   with when each resets, and a refresh button. */
Item {
    id: tab
    property var notch
    readonly property var claude: Services.claude
    readonly property var usage: claude.usage
    implicitHeight: col.implicitHeight

    /* "6:00 PM" today, else "Wed 29 Oct, 6:00 PM" */
    function resetText(iso) {
        const d = new Date(iso), loc = Qt.locale();
        const time = d.toLocaleTimeString(loc, Locale.ShortFormat);
        if (d.toDateString() === new Date().toDateString()) return `Resets ${time}`;
        return `Resets ${loc.dayName(d.getDay(), Locale.ShortFormat)} ${d.getDate()} ${loc.monthName(d.getMonth(), Locale.ShortFormat)}, ${time}`;
    }

    component UsageCard: Rectangle {
        id: card
        property string title
        property string subtitle
        property var limit                  // {utilization, resets_at}
        property color baseColor
        property color baseTrack
        readonly property real pct: Math.max(0, Math.min(100, limit?.utilization ?? 0))
        readonly property bool high: pct > 90
        readonly property color ringColor: high ? Theme.red : baseColor
        Layout.fillWidth: true
        Layout.preferredWidth: 1            // equal widths, like a homogeneous box
        implicitHeight: row.implicitHeight + 32
        radius: 23
        color: "#1C1C1E"
        RowLayout {
            id: row
            anchors.fill: parent
            anchors.leftMargin: 18; anchors.rightMargin: 18
            spacing: 16
            Ring {
                size: 86; thickness: 10
                track: card.high ? "#3A1210" : card.baseTrack
                color: card.ringColor
                frac: card.pct / 100
                Accessible.name: `${card.title} ${card.pct.toFixed(0)}% used`
                NText { anchors.centerIn: parent; text: `${card.pct.toFixed(0)}%`; size: 18; weight: Font.DemiBold; tnum: true }
            }
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 4
                NText { Layout.fillWidth: true; text: card.title; size: 15; weight: Font.DemiBold }
                NText { Layout.fillWidth: true; text: card.subtitle; size: 12; color: Theme.textDim }
                NText {
                    Layout.fillWidth: true
                    visible: !!card.limit?.resets_at
                    text: visible ? tab.resetText(card.limit.resets_at) : ""
                    size: 12; tnum: true; color: card.ringColor
                }
            }
        }
    }

    ColumnLayout {
        id: col
        width: parent.width
        spacing: 14

        Rectangle {
            visible: !tab.usage
            Layout.fillWidth: true
            implicitHeight: msg.implicitHeight + 44
            radius: 23
            color: "#1C1C1E"
            ColumnLayout {
                id: msg
                anchors.centerIn: parent
                width: parent.width - 44
                spacing: 5
                NText {
                    Layout.alignment: Qt.AlignHCenter
                    text: tab.claude.error ? "Claude usage unavailable" : "Loading Claude usage…"
                    size: 15; weight: Font.DemiBold
                }
                NText {
                    Layout.fillWidth: true
                    visible: !!tab.claude.error
                    text: tab.claude.error
                    horizontalAlignment: Text.AlignHCenter
                    wrapMode: Text.WordWrap
                    size: 12; color: Theme.textDim
                }
            }
        }

        RowLayout {
            visible: !!tab.usage
            Layout.fillWidth: true
            spacing: 9
            UsageCard {
                visible: !!tab.usage?.five_hour
                title: "Session"; subtitle: "5-hour window"
                limit: tab.usage?.five_hour
                baseColor: Theme.orange; baseTrack: "#3A2A0E"
            }
            UsageCard {
                visible: !!tab.usage?.seven_day
                title: "Weekly"; subtitle: "All models"
                limit: tab.usage?.seven_day
                baseColor: Theme.blue; baseTrack: "#0B2A4D"
            }
        }

        RowLayout {
            visible: !!tab.usage || !!tab.claude.error
            Layout.fillWidth: true
            Layout.leftMargin: 7; Layout.rightMargin: 7
            NText {
                Layout.fillWidth: true
                text: `Auto-refreshes every ${Math.max(1, Config.claudeUsageRefresh)} min`
                size: 11; color: Theme.textDim
            }
            NButton {
                implicitWidth: btnRow.implicitWidth + 26
                implicitHeight: 27
                radius: 14
                color: Theme.surface; hoverColor: Theme.surfaceHi
                accessibleName: "Refresh"
                onClicked: tab.claude.refresh()
                Row {
                    id: btnRow
                    anchors.centerIn: parent
                    spacing: 5
                    NIcon { anchors.verticalCenter: parent.verticalCenter; name: "view-refresh-symbolic"; size: 13 }
                    NText {
                        anchors.verticalCenter: parent.verticalCenter
                        text: tab.claude.loading ? "Refreshing…" : "Refresh"
                        size: 12; weight: Font.Medium
                    }
                }
            }
        }
    }
}
