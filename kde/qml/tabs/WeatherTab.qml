import QtQuick
import QtQuick.Layouts

/* Weather: the location switcher (with two places configured), a hero card
   with the place, sky and temperature beside four tiles, then three days
   with their low..high on a shared scale. */
Item {
    id: tab
    property var notch
    readonly property var w: Services.weather
    readonly property var v: w.current
    implicitHeight: col.implicitHeight

    ColumnLayout {
        id: col
        width: parent.width
        spacing: 14

        /* nexnotch-segmented */
        Rectangle {
            Layout.alignment: Qt.AlignHCenter
            visible: tab.w.hasSecond
            implicitWidth: seg.implicitWidth + 3.6
            implicitHeight: seg.implicitHeight + 3.6
            radius: 9
            color: "#1C1C1E"
            Row {
                id: seg
                anchors.centerIn: parent
                spacing: 1.8
                Repeater {
                    model: [[1, tab.w.label1], [2, tab.w.label2]]
                    NButton {
                        id: segBtn
                        required property var modelData
                        readonly property bool on: tab.w.active === modelData[0]
                        implicitWidth: Math.max(76, segLabel.implicitWidth + 18)
                        implicitHeight: 27
                        radius: 7
                        color: on ? "#48484A" : "transparent"
                        hoverColor: on ? "#48484A" : Theme.surface
                        accessibleName: modelData[1]
                        onClicked: tab.w.active = modelData[0]
                        NText {
                            id: segLabel
                            anchors.centerIn: parent
                            text: segBtn.modelData[1]
                            size: 12
                            weight: segBtn.on ? Font.DemiBold : Font.Medium
                            color: segBtn.on ? Theme.text : "#E5E5EA"
                        }
                    }
                }
            }
        }

        /* nexnotch-weather-msg */
        Rectangle {
            Layout.fillWidth: true
            visible: !tab.v
            implicitHeight: msg.implicitHeight + 44
            radius: 23
            color: "#1C1C1E"
            Column {
                id: msg
                anchors.centerIn: parent
                width: parent.width - 44
                spacing: 5
                NText {
                    width: parent.width
                    horizontalAlignment: Text.AlignHCenter
                    text: tab.w.error ? "Weather unavailable" : "Loading weather…"
                    size: 15; weight: Font.DemiBold
                }
                NText {
                    width: parent.width
                    horizontalAlignment: Text.AlignHCenter
                    visible: !!tab.w.error
                    text: tab.w.error
                    size: 12; color: Theme.textDim
                }
            }
        }

        RowLayout {
            visible: !!tab.v
            Layout.fillWidth: true
            spacing: 9

            /* nexnotch-weather-hero */
            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                Layout.minimumHeight: 124
                radius: 23
                color: "#1C1C1E"

                ColumnLayout {
                    anchors { left: parent.left; right: parent.right; top: parent.top; margins: 14; leftMargin: 18; rightMargin: 18 }
                    spacing: 0
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 5
                        NText { Layout.maximumWidth: 210; text: tab.v?.area ?? ""; size: 15; weight: Font.DemiBold }
                        NIcon { name: "mark-location-symbolic"; size: 11 }
                        Item { Layout.fillWidth: true }
                    }
                    NText {
                        Layout.fillWidth: true
                        Layout.rightMargin: 44
                        text: tab.v?.desc ?? ""
                        size: 12; color: Theme.textDim
                    }
                }
                NIcon {
                    anchors { right: parent.right; top: parent.top; rightMargin: 18; topMargin: 14 }
                    name: tab.w.icon(tab.v?.code)
                    size: 36
                    color: "#C7C7CC"
                }
                NText {
                    id: temp
                    anchors { left: parent.left; bottom: parent.bottom; leftMargin: 14; bottomMargin: 6 }
                    text: `${tab.v?.temp ?? ""}°`
                    size: 65; weight: Font.Light; tnum: true
                    font.letterSpacing: -2
                }
                NText {
                    anchors { right: parent.right; bottom: parent.bottom; rightMargin: 18; bottomMargin: 23 }
                    readonly property var d0: tab.v?.days?.[0]
                    visible: !!d0
                    text: d0 ? `H:${d0.max}°  L:${d0.min}°` : ""
                    size: 12; color: Theme.textDim; tnum: true
                }
            }

            /* nexnotch-weather-tiles */
            GridLayout {
                Layout.preferredWidth: 270
                Layout.maximumWidth: 270
                columns: 2
                rowSpacing: 9; columnSpacing: 9
                uniformCellWidths: true
                Repeater {
                    model: tab.v ? [
                        ["FEELS LIKE", `${tab.v.feels}°`, ""],
                        ["HUMIDITY", `${tab.v.humidity}%`, ""],
                        ["WIND", String(tab.v.wind), tab.v.windUnit],
                        ["UV INDEX", String(tab.v.uv), tab.v.uvWord],
                    ] : []
                    WeatherTile {
                        required property var modelData
                        Layout.fillWidth: true
                        label: modelData[0]; value: modelData[1]; unit: modelData[2]
                    }
                }
            }
        }

        /* nexnotch-weather-days */
        Rectangle {
            Layout.fillWidth: true
            visible: !!tab.v && tab.v.days.length > 0
            implicitHeight: days.implicitHeight + 8
            radius: 23
            color: "#1C1C1E"
            Column {
                id: days
                readonly property var list: tab.v?.days ?? []
                readonly property real lo: Math.min(...list.map(d => d.min))
                readonly property real hi: Math.max(...list.map(d => d.max))
                anchors { left: parent.left; right: parent.right; verticalCenter: parent.verticalCenter; leftMargin: 18; rightMargin: 18 }
                Repeater {
                    model: days.list
                    Item {
                        id: dayRow
                        required property var modelData
                        required property int index
                        width: days.width
                        height: 43
                        Rectangle {
                            visible: dayRow.index < days.list.length - 1
                            anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
                            height: 1
                            color: Theme.surface
                        }
                        RowLayout {
                            anchors.fill: parent
                            spacing: 11
                            NText {
                                Layout.preferredWidth: 65
                                text: {
                                    if (dayRow.index === 0) return "Today";
                                    const [y, m, d] = dayRow.modelData.date.split("-").map(Number);
                                    return Qt.locale().toString(new Date(y, m - 1, d), "ddd");
                                }
                                size: 14; weight: Font.DemiBold
                            }
                            NIcon {
                                Layout.preferredWidth: 32
                                name: tab.w.icon(dayRow.modelData.code)
                                size: 20
                                color: "#C7C7CC"
                            }
                            NText {
                                Layout.preferredWidth: 36
                                horizontalAlignment: Text.AlignRight
                                text: `${dayRow.modelData.min}°`
                                size: 14; color: Theme.textDim; tnum: true
                            }
                            TempRange {
                                Layout.fillWidth: true
                                lo: days.lo; hi: days.hi
                                min: dayRow.modelData.min; max: dayRow.modelData.max
                                now: dayRow.index === 0 ? tab.v.temp : NaN
                            }
                            NText {
                                Layout.preferredWidth: 36
                                text: `${dayRow.modelData.max}°`
                                size: 14; tnum: true
                            }
                        }
                    }
                }
            }
        }
    }

    /* nexnotch-weather-tile */
    component WeatherTile: Rectangle {
        property string label
        property string value
        property string unit
        implicitHeight: tileCol.implicitHeight + 22
        radius: 18
        color: "#1C1C1E"
        Column {
            id: tileCol
            anchors { left: parent.left; right: parent.right; verticalCenter: parent.verticalCenter; leftMargin: 13; rightMargin: 13 }
            spacing: 4
            NText { text: label; size: 10; weight: Font.DemiBold; color: Theme.textDim; font.letterSpacing: 0.4 }
            Row {
                spacing: 4
                NText { id: valueText; text: value; size: 20; weight: Font.Medium; tnum: true }
                NText {
                    anchors.baseline: valueText.baseline
                    visible: unit !== ""
                    text: unit
                    size: 12; color: Theme.textDim
                }
            }
        }
    }

    /* the day's low..high on the days' shared scale; a dot marks the current temperature */
    component TempRange: Item {
        property real lo
        property real hi
        property real min
        property real max
        property real now: NaN
        readonly property real span: Math.max(1, hi - lo)
        function xOf(t) { return 2.5 + (width - 5) * ((t - lo) / span); }
        implicitHeight: 13
        Rectangle {
            anchors.verticalCenter: parent.verticalCenter
            width: parent.width; height: 5; radius: 2.5
            color: "#2C2C2E"
        }
        Rectangle {
            anchors.verticalCenter: parent.verticalCenter
            x: parent.xOf(parent.min) - 2.5
            width: Math.max(5, parent.xOf(parent.max) - parent.xOf(parent.min) + 5); height: 5; radius: 2.5
            color: Theme.orange
        }
        Rectangle {
            visible: !isNaN(parent.now)
            anchors.verticalCenter: parent.verticalCenter
            x: parent.xOf(Math.min(parent.hi, Math.max(parent.lo, parent.now))) - 6.5
            width: 13; height: 13; radius: 6.5
            color: "#1C1C1E"
            Rectangle { anchors.centerIn: parent; width: 9; height: 9; radius: 4.5; color: "white" }
        }
    }
}
