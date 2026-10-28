import QtQuick

/* Water: today's cups against the goal, Drink, the reminder switch with
   its countdown, and a chart of cups per hour (water.js render()). */
Item {
    id: tab
    property var notch
    readonly property var water: Services.water
    readonly property int goal: Math.max(1, Config.waterGoal)
    implicitHeight: Math.max(main.height, chart.height)

    function plural(n) { return `${n} cup${n === 1 ? "" : "s"}`; }

    Rectangle {
        id: main
        anchors.left: parent.left
        anchors.right: chart.left
        anchors.rightMargin: 9
        height: mainCol.implicitHeight + 16 + 11
        radius: 23
        color: "#1C1C1E"

        Column {
            id: mainCol
            x: 18; y: 16
            width: parent.width - 36
            spacing: 13

            Row {
                spacing: 16
                Item {
                    width: 97; height: 97
                    Ring {
                        anchors.fill: parent
                        size: 97
                        thickness: 11
                        track: "#0B3340"
                        color: Theme.cyan
                        frac: tab.water.cups / tab.goal
                        Accessible.role: Accessible.ProgressBar
                        Accessible.name: `${tab.water.cups} of ${tab.goal} cups`
                    }
                    Column {
                        anchors.centerIn: parent
                        NText { anchors.horizontalCenter: parent.horizontalCenter; text: tab.water.cups; size: 29; weight: Font.DemiBold; tnum: true }
                        NText { anchors.horizontalCenter: parent.horizontalCenter; text: `of ${tab.plural(tab.goal)}`; size: 11; color: Theme.textDim }
                    }
                }
                Column {
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 4
                    NText { text: "Water"; size: 15; weight: Font.DemiBold }
                    NText {
                        text: tab.water.cups >= tab.goal ? "Goal reached today" : `${tab.plural(tab.goal - tab.water.cups)} to go today`
                        size: 12; color: Theme.textDim
                    }
                    Row {
                        topPadding: 7
                        spacing: 7
                        NButton {
                            implicitWidth: drinkRow.implicitWidth + 32
                            implicitHeight: 36
                            radius: 18
                            color: Theme.cyan; hoverColor: "#8FE0FF"; pressColor: "#8FE0FF"
                            accessibleName: "Log a cup of water"
                            onClicked: tab.water.drink()
                            Row {
                                id: drinkRow
                                anchors.centerIn: parent
                                spacing: 5
                                NIcon { anchors.verticalCenter: parent.verticalCenter; name: "list-add-symbolic"; size: 14; color: "black" }
                                NText { anchors.verticalCenter: parent.verticalCenter; text: "Drink"; size: 13; weight: Font.DemiBold; color: "black" }
                            }
                        }
                        NButton {
                            implicitWidth: 36; implicitHeight: 36
                            color: Theme.surface; hoverColor: Theme.surfaceHi
                            accessibleName: "Water settings"
                            onClicked: tab.notch.openSettings("general")
                            NIcon { anchors.centerIn: parent; name: "emblem-system-symbolic"; size: 16 }
                        }
                    }
                }
            }

            /* reminders: on/off and the countdown to the next one */
            Item {
                width: parent.width
                height: 9 + Math.max(remCol.implicitHeight, toggle.height)
                Rectangle { width: parent.width; height: 1; color: Theme.surface }
                Column {
                    id: remCol
                    y: 9
                    anchors.left: parent.left
                    anchors.right: toggle.left
                    NText { text: "Reminders"; size: 14 }
                    NText { visible: Config.showWater; text: `Next in ${tab.water.minutesLeft} min`; size: 11; color: Theme.textDim }
                }
                NButton {
                    id: toggle
                    anchors.right: parent.right
                    anchors.verticalCenter: remCol.verticalCenter
                    implicitWidth: 42; implicitHeight: 24
                    color: Config.showWater ? Theme.blue : "#48484A"
                    hoverColor: Qt.lighter(color, 1.15)
                    pressColor: hoverColor
                    accessibleName: "Drink-water reminders"
                    checked: Config.showWater
                    Accessible.role: Accessible.CheckBox
                    Accessible.checked: checked
                    onClicked: Config.showWater = !Config.showWater
                    Rectangle {
                        width: 20; height: 20; radius: 10
                        anchors.verticalCenter: parent.verticalCenter
                        x: toggle.checked ? parent.width - width - 2 : 2
                        Behavior on x { NumberAnimation { duration: 120; easing.type: Easing.OutQuad } }
                    }
                }
            }
        }
    }

    /* cups per hour over the last hours */
    Rectangle {
        id: chart
        anchors.right: parent.right
        width: 238
        height: chartCol.implicitHeight + 14 + 13
        radius: 23
        color: "#1C1C1E"

        /* re-read with each drink and as the hours move on */
        readonly property var hours: { tab.water.cups; tab.water._now; return tab.water.hourly(); }
        readonly property int peak: Math.max(4, Math.ceil(Math.max(...hours.map(d => d.cups)) / 2) * 2)

        Column {
            id: chartCol
            x: 16; y: 14
            width: parent.width - 32
            spacing: 9

            Item {
                width: parent.width
                height: caps.implicitHeight
                NText { id: caps; text: "TODAY"; size: 11; weight: Font.DemiBold; color: Theme.textDim; font.letterSpacing: 0.5 }
                NText {
                    anchors.right: parent.right
                    text: tab.water.cups ? `${tab.plural(tab.water.cups)} logged` : "Nothing logged yet"
                    size: 11; color: Theme.textDim
                }
            }

            Row {
                width: parent.width
                spacing: 7
                Row {
                    id: bars
                    width: parent.width - axis.width - parent.spacing
                    height: 106
                    spacing: 5
                    readonly property real barW: (width - spacing * (chart.hours.length - 1)) / chart.hours.length
                    Repeater {
                        model: chart.hours
                        Rectangle {
                            required property var modelData
                            width: bars.barW; height: bars.height
                            radius: 4
                            color: "#262629"
                            Rectangle {
                                visible: modelData.cups > 0
                                anchors.bottom: parent.bottom
                                width: parent.width
                                height: Math.max(8, parent.height * Math.min(1, modelData.cups / chart.peak))
                                radius: 4
                                color: Theme.cyan
                            }
                        }
                    }
                }
                Item {
                    id: axis
                    width: 13; height: 106
                    NText { x: 6; anchors.top: parent.top; text: chart.peak; size: 10; color: "#8E8E93"; tnum: true }
                    NText { x: 6; anchors.verticalCenter: parent.verticalCenter; text: chart.peak / 2; size: 10; color: "#8E8E93"; tnum: true }
                    NText { x: 6; anchors.bottom: parent.bottom; text: "0"; size: 10; color: "#8E8E93"; tnum: true }
                }
            }

            Row {
                Repeater {
                    model: chart.hours
                    NText {
                        required property var modelData
                        required property int index
                        width: bars.barW + bars.spacing
                        text: index % 3 === 0 ? String(modelData.hour).padStart(2, "0") : ""
                        size: 10; color: "#8E8E93"; tnum: true
                        elide: Text.ElideNone
                    }
                }
            }
        }
    }
}
