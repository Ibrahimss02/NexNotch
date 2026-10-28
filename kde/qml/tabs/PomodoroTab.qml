import QtQuick

/* Timer: preset picker, Reset · ring · Start/Pause/Resume, and the cycle
   dots with ±1 minute while a session runs (pomodoro.js render()). */
Item {
    id: tab
    property var notch
    readonly property var pomo: Services.pomodoro
    implicitHeight: col.implicitHeight

    Column {
        id: col
        width: parent.width
        topPadding: 8; bottomPadding: 8
        spacing: 14

        /* focus / break length */
        Rectangle {
            anchors.horizontalCenter: parent.horizontalCenter
            width: seg.width + 3.6; height: seg.height + 3.6
            radius: 9
            color: "#1C1C1E"
            Row {
                id: seg
                anchors.centerIn: parent
                spacing: 1.8
                Repeater {
                    model: Config.pomodoroPresets
                    NButton {
                        id: segBtn
                        required property string modelData
                        readonly property bool on: modelData === Config.pomodoroActivePreset
                        implicitWidth: Math.max(76, segLabel.implicitWidth + 18)
                        implicitHeight: 27
                        radius: 7
                        color: on ? "#48484A" : "transparent"
                        hoverColor: on ? "#48484A" : Theme.surface
                        accessibleName: `${modelData} minutes`
                        onClicked: tab.pomo.setPreset(modelData)
                        NText {
                            id: segLabel
                            anchors.centerIn: parent
                            text: modelData.replace("/", " / ")
                            size: 12
                            weight: segBtn.on ? Font.DemiBold : Font.Medium
                            color: segBtn.on ? Theme.text : "#E5E5EA"
                        }
                    }
                }
            }
        }

        Row {
            anchors.horizontalCenter: parent.horizontalCenter
            spacing: 50

            PomoRound {
                anchors.verticalCenter: parent.verticalCenter
                label: "Reset"
                onClicked: tab.pomo.reset()
            }

            Item {
                width: 189; height: 189
                Ring {
                    anchors.fill: parent
                    size: 189
                    thickness: 7
                    track: Theme.surface
                    color: tab.pomo.resting ? Theme.green : Theme.orange
                    frac: tab.pomo.state === "idle" ? 1 : tab.pomo.remain / Math.max(1, tab.pomo.total || tab.pomo.preset.work * 60)
                    Accessible.role: Accessible.ProgressBar
                    Accessible.name: `${tab.pomo.stateLabel}, ${tab.pomo.remainText}`
                }
                Column {
                    anchors.centerIn: parent
                    NText {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: tab.pomo.state === "idle" ? `${String(tab.pomo.preset.work).padStart(2, "0")}:00` : tab.pomo.remainText
                        size: 47; weight: Font.Light; tnum: true
                        font.letterSpacing: -1.4
                    }
                    NText {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: tab.pomo.state === "idle" ? "Focus" : tab.pomo.stateLabel
                        size: 12; weight: Font.DemiBold; color: Theme.textDim
                        font.letterSpacing: 0.4
                    }
                }
            }

            PomoRound {
                anchors.verticalCenter: parent.verticalCenter
                readonly property string st: tab.pomo.state
                label: st === "idle" ? "Start" : st === "paused" ? "Resume" : "Pause"
                kind: st === "idle" || st === "paused" ? "go" : "hold"
                onClicked: st === "idle" ? tab.pomo.startWork() : st === "paused" ? tab.pomo.resume() : tab.pomo.pause()
            }
        }

        Row {
            anchors.horizontalCenter: parent.horizontalCenter
            spacing: 5
            readonly property int done: tab.pomo.cycle % tab.pomo.cycles
                || (tab.pomo.cycle && tab.pomo.state !== "work" ? tab.pomo.cycles : 0)
            Repeater {
                model: tab.pomo.cycles
                Rectangle {
                    required property int index
                    anchors.verticalCenter: parent.verticalCenter
                    width: 7; height: 7; radius: 3.5
                    color: index < parent.done ? Theme.orange : "#48484A"
                }
            }
            NText {
                anchors.verticalCenter: parent.verticalCenter
                leftPadding: 5
                text: `Cycle ${tab.pomo.cycle} of ${tab.pomo.cycles} · ${tab.pomo.preset.work} min focus, ${tab.pomo.preset.brk} min break`
                size: 12; weight: Font.Medium; color: Theme.textDim
            }
            Repeater {
                model: tab.pomo.state === "idle" ? [] : [["−1m", -1, "Subtract one minute"], ["+1m", 1, "Add one minute"]]
                Item {
                    required property var modelData
                    anchors.verticalCenter: parent.verticalCenter
                    width: adj.width + 4; height: adj.height
                    NButton {
                        id: adj
                        x: 4
                        implicitWidth: adjLabel.implicitWidth + 18
                        implicitHeight: 23
                        radius: 12
                        color: Theme.surface; hoverColor: Theme.surfaceHi
                        accessibleName: modelData[2]
                        onClicked: tab.pomo.adjustMinutes(modelData[1])
                        NText { id: adjLabel; anchors.centerIn: parent; text: modelData[0]; size: 11; weight: Font.Medium }
                    }
                }
            }
        }
    }

    /* the round side buttons: a disc, a black gap, then a ring in its colour */
    component PomoRound: NButton {
        id: btn
        property string label
        property string kind: ""
        readonly property color base: kind === "go" ? "#0E3A1C" : kind === "hold" ? "#3A2A0E" : "#333336"
        readonly property color fg: kind === "go" ? Theme.green : kind === "hold" ? Theme.orange : Theme.text
        implicitWidth: 76; implicitHeight: 76
        radius: 38
        color: base
        hoverColor: base
        pressColor: base
        accessibleName: label
        Rectangle {
            anchors.centerIn: parent
            width: 72; height: 72; radius: 36
            color: "black"
            Rectangle {
                anchors.centerIn: parent
                width: 68; height: 68; radius: 34
                color: btn.pressed || btn.hovered
                    ? (btn.kind === "go" ? "#134A25" : btn.kind === "hold" ? "#4A3612" : "#3D3D40") : btn.base
                Behavior on color { ColorAnimation { duration: 120 } }
            }
        }
        NText {
            anchors.centerIn: parent
            text: btn.label
            size: 14
            weight: btn.kind ? Font.DemiBold : Font.Medium
            color: btn.fg
        }
    }
}
