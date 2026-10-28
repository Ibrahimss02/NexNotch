import QtQuick
import QtQuick.Layouts

/* Cal: the month grid (red today, a blue dot under days with events; click
   a day to see it) beside the agenda — Up next, or the chosen day. With a
   Google account and tasks on, the agenda card flips to Google Tasks. */
Item {
    id: tab
    property var notch
    readonly property var cal: Services.calendar
    property bool showTasks: false
    readonly property bool tasksMode: showTasks && cal.tasksAvailable
    implicitHeight: month.implicitHeight

    readonly property double todayStart: { const n = new Date(cal.now); return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime(); }

    function hm(ms) { return Qt.formatTime(new Date(ms), Config.clockFormat === "12h" ? "h:mm AP" : "hh:mm"); }
    function sameDay(a, b) { return a.toDateString() === b.toDateString(); }
    /* calendar.js _formatTime */
    function when(ev, timeOnly) {
        if (timeOnly) return ev.allDay ? "All day" : hm(ev.start);
        const d = new Date(ev.start), now = new Date(cal.now);
        const time = ev.allDay ? "—" : hm(ev.start);
        if (sameDay(d, now)) return `Today ${time}`;
        if (sameDay(d, new Date(now.getTime() + 86400000))) return `Tom ${time}`;
        return Qt.locale().toString(d, "ddd d") + (ev.allDay ? "" : ` ${time}`);
    }
    /* calendar.js _formatDue */
    function due(ms) {
        const diff = Math.round((ms - todayStart) / 86400000);
        if (diff < 0) return `${-diff}d late`;
        if (diff === 0) return "today";
        if (diff === 1) return "tom";
        if (diff < 7) return `${diff}d`;
        return Qt.locale().toString(new Date(ms), "d MMM");
    }

    /* the text fields hold the notch open and take the keyboard */
    Component.onDestruction: if (notch) notch.notesFocused = false

    RowLayout {
        anchors.fill: parent
        spacing: 9

        /* nexnotch-cal-month */
        Rectangle {
            id: month
            readonly property var view: new Date(new Date(cal.now).getFullYear(), new Date(cal.now).getMonth() + cal.monthOffset, 1)
            readonly property int year: view.getFullYear()
            readonly property int mon: view.getMonth()
            readonly property int lead: (view.getDay() + 6) % 7      // Monday first
            readonly property int days: new Date(year, mon + 1, 0).getDate()
            readonly property var eventDays: {
                const s = new Set();
                for (const e of cal.events) {
                    const d = new Date(e.start);
                    if (d.getFullYear() === year && d.getMonth() === mon) s.add(d.getDate());
                }
                return s;
            }
            Layout.preferredWidth: 241
            Layout.alignment: Qt.AlignTop
            implicitHeight: monthCol.implicitHeight + 24
            radius: 23
            color: "#1C1C1E"

            Column {
                id: monthCol
                anchors { left: parent.left; right: parent.right; top: parent.top; leftMargin: 14; rightMargin: 14; topMargin: 13 }
                spacing: 1.8

                RowLayout {
                    width: parent.width
                    spacing: 2
                    Row {
                        Layout.fillWidth: true
                        Layout.leftMargin: 3
                        spacing: 5
                        NText { text: Qt.locale().standaloneMonthName(month.mon); size: 14; weight: Font.DemiBold; color: Theme.red }
                        NText { text: month.year; size: 14; weight: Font.DemiBold }
                    }
                    Repeater {
                        model: [["go-previous-symbolic", -1, "Previous month"], ["go-next-symbolic", 1, "Next month"]]
                        NButton {
                            id: navBtn
                            required property var modelData
                            implicitWidth: 29; implicitHeight: 29
                            hoverColor: Theme.surface
                            accessibleName: modelData[2]
                            onClicked: { cal.selectedDay = null; cal.monthOffset += modelData[1]; }
                            NIcon { anchors.centerIn: parent; name: navBtn.modelData[0]; size: 14; color: Theme.red }
                        }
                    }
                }
                Item { width: 1; height: 3 }

                Row {
                    Repeater {
                        model: ["M", "T", "W", "T", "F", "S", "S"]
                        NText {
                            required property string modelData
                            width: monthCol.width / 7; height: 20
                            horizontalAlignment: Text.AlignHCenter
                            text: modelData
                            size: 10; weight: Font.DemiBold; color: "#8E8E93"
                        }
                    }
                }

                Grid {
                    columns: 7
                    rowSpacing: 1.8
                    Repeater {
                        model: Math.ceil((month.lead + month.days) / 7) * 7
                        Item {
                            id: cell
                            required property int index
                            readonly property int day: index - month.lead + 1
                            readonly property bool real: day >= 1 && day <= month.days
                            readonly property var date: new Date(month.year, month.mon, day)
                            readonly property bool today: real && sameDay(date, new Date(cal.now))
                            readonly property bool selected: real && !!cal.selectedDay && cal.selectedDay.getTime() === date.getTime()
                            width: monthCol.width / 7; height: 31
                            NButton {
                                visible: cell.real
                                anchors.horizontalCenter: parent.horizontalCenter
                                width: 27; height: 27
                                radius: 14
                                color: cell.today ? Theme.red : cell.selected ? "#48484A" : "transparent"
                                hoverColor: cell.today ? Theme.red : cell.selected ? "#48484A" : Theme.surface
                                accessibleName: Qt.locale().toString(cell.date, Locale.LongFormat)
                                onClicked: cal.selectedDay = cell.selected ? null : cell.date
                                Rectangle {
                                    visible: cell.today && cell.selected
                                    anchors.centerIn: parent
                                    width: 23; height: 23; radius: 11.5
                                    color: "transparent"
                                    border { width: 2; color: "white" }
                                }
                                NText {
                                    anchors.centerIn: parent
                                    text: cell.day
                                    size: 13; tnum: true
                                    weight: cell.today || cell.selected ? Font.DemiBold : Font.Normal
                                    color: cell.today || cell.selected ? Theme.text : "#E5E5EA"
                                }
                            }
                            Rectangle {
                                visible: cell.real && month.eventDays.has(cell.day)
                                anchors.horizontalCenter: parent.horizontalCenter
                                y: 28
                                width: 4; height: 4; radius: 1.8
                                color: Theme.blue
                            }
                        }
                    }
                }
            }
        }

        /* nexnotch-cal-agenda */
        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            radius: 23
            color: "#1C1C1E"

            ColumnLayout {
                anchors { fill: parent; leftMargin: 16; rightMargin: 16; topMargin: 14; bottomMargin: 14 }
                spacing: 7

                RowLayout {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 22
                    NText {
                        Layout.fillWidth: true
                        text: tab.tasksMode ? "TASKS"
                            : cal.selectedDay ? Qt.locale().toString(cal.selectedDay, "ddd d MMM").toUpperCase() : "UP NEXT"
                        size: 11; weight: Font.DemiBold; color: Theme.textDim
                        font.letterSpacing: 0.5
                    }
                    /* events | tasks */
                    Rectangle {
                        visible: cal.tasksAvailable
                        implicitWidth: modeRow.implicitWidth + 3.6
                        implicitHeight: 22
                        radius: 7
                        color: Theme.surface
                        Row {
                            id: modeRow
                            anchors.centerIn: parent
                            spacing: 1.8
                            Repeater {
                                model: [[false, "Events"], [true, "Tasks"]]
                                NButton {
                                    id: modeBtn
                                    required property var modelData
                                    readonly property bool on: tab.showTasks === modelData[0]
                                    implicitWidth: modeLabel.implicitWidth + 16
                                    implicitHeight: 19
                                    radius: 5.5
                                    color: on ? "#48484A" : "transparent"
                                    hoverColor: on ? "#48484A" : Theme.surfaceHi
                                    accessibleName: modelData[1]
                                    onClicked: tab.showTasks = modelData[0]
                                    NText {
                                        id: modeLabel
                                        anchors.centerIn: parent
                                        text: modeBtn.modelData[1]
                                        size: 11
                                        weight: modeBtn.on ? Font.DemiBold : Font.Medium
                                        color: modeBtn.on ? Theme.text : "#E5E5EA"
                                    }
                                }
                            }
                        }
                    }
                }

                Loader {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    sourceComponent: tab.tasksMode ? tasksView : agendaView
                }
            }
        }
    }

    Component {
        id: agendaView
        Item {
            readonly property var list: {
                const day = cal.selectedDay;
                if (!day) return cal.events.filter(e => e.end >= cal.now).slice(0, 24);
                const from = day.getTime(), to = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
                return cal.events.filter(e => e.start < to && Math.max(e.end, e.start + 1) > from);
            }

            /* nexnotch-cal-empty */
            Column {
                visible: parent.list.length === 0
                anchors.centerIn: parent
                width: parent.width
                spacing: 9
                NIcon { anchors.horizontalCenter: parent.horizontalCenter; name: "view-calendar-month-symbolic"; size: 31; color: "#636366" }
                NText {
                    width: parent.width
                    horizontalAlignment: Text.AlignHCenter
                    text: cal.selectedDay ? "No events" : "No more events today"
                    size: 14; weight: Font.DemiBold
                }
                NText {
                    readonly property bool none: cal.calendars.length === 0
                    width: parent.width
                    horizontalAlignment: Text.AlignHCenter
                    wrapMode: Text.WordWrap
                    text: none ? "Add an iCal link or a Google account in Settings." : "Events from your connected calendars show here."
                    size: 12; color: Theme.textDim
                    MouseArea {
                        anchors.fill: parent
                        enabled: parent.none
                        cursorShape: Qt.PointingHandCursor
                        onClicked: tab.notch.openSettings("calendar")
                    }
                }
            }

            ListView {
                anchors.fill: parent
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                model: parent.list
                delegate: Item {
                    id: row
                    required property var modelData
                    required property int index
                    width: ListView.view.width
                    height: 36
                    Rectangle {
                        anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
                        height: 1
                        color: Theme.surface
                    }
                    RowLayout {
                        anchors.fill: parent
                        spacing: 11
                        NText {
                            Layout.preferredWidth: 83
                            text: tab.when(row.modelData, !!cal.selectedDay)
                            size: 12; weight: Font.Bold; color: Theme.textDim; tnum: true
                            font.letterSpacing: 0.3
                        }
                        /* which calendar it's from */
                        Rectangle {
                            Layout.preferredWidth: 3; Layout.preferredHeight: 14
                            radius: 1.5
                            color: row.modelData.color || Theme.blue
                        }
                        NText {
                            Layout.fillWidth: true
                            text: row.modelData.summary
                            size: 14; weight: Font.Medium
                        }
                    }
                }
            }
        }
    }

    Component {
        id: tasksView
        ColumnLayout {
            id: tv
            spacing: 6
            /* list tabs as in calendar.js: "All" plus one per list */
            property string active: "All"
            readonly property var lists: cal.taskLists.filter(l => {
                const on = cal._list(Config.tasksEnabledLists);
                return !on.length || on.includes(l.id) || on.includes(l.name);
            })
            readonly property var items: active === "All" ? cal.tasks : cal.tasks.filter(t => t.listId === active)
            readonly property string target: active !== "All" ? active : lists.length === 1 ? lists[0].id : ""
            property bool composing: false

            Flickable {
                visible: tv.lists.length > 1
                Layout.fillWidth: true
                Layout.preferredHeight: 26
                contentWidth: listRow.implicitWidth
                flickableDirection: Flickable.HorizontalFlick
                boundsBehavior: Flickable.StopAtBounds
                clip: true
                Row {
                    id: listRow
                    spacing: 4
                    Repeater {
                        model: [{id: "All", name: "All", n: cal.tasks.length}]
                            .concat(tv.lists.map(l => ({id: l.id, name: l.name, n: cal.tasks.filter(t => t.listId === l.id).length})))
                        NButton {
                            id: listBtn
                            required property var modelData
                            readonly property bool on: tv.active === modelData.id
                            implicitWidth: listLabel.implicitWidth + 18
                            implicitHeight: 26
                            radius: 7
                            color: on ? "#48484A" : "transparent"
                            hoverColor: on ? "#48484A" : Theme.surface
                            onClicked: { tv.active = modelData.id; tv.composing = false; }
                            NText {
                                id: listLabel
                                anchors.centerIn: parent
                                text: `${listBtn.modelData.name} · ${listBtn.modelData.n}`
                                size: 12
                                weight: listBtn.on ? Font.DemiBold : Font.Medium
                                color: listBtn.on ? Theme.text : Theme.textDim
                            }
                        }
                    }
                }
            }

            /* + Add task, or the compose card */
            NButton {
                visible: !tv.composing
                enabled: tv.target !== ""
                implicitWidth: addLabel.implicitWidth + 24
                implicitHeight: 24
                color: Qt.rgba(120 / 255, 170 / 255, 1, 0.14)
                hoverColor: Qt.rgba(120 / 255, 170 / 255, 1, 0.24)
                accessibleName: "Add task"
                onClicked: tv.composing = true
                NText { id: addLabel; anchors.centerIn: parent; text: "+ Add task"; size: 11; weight: Font.Bold; color: Qt.rgba(120 / 255, 170 / 255, 1, 0.92) }
            }
            Rectangle {
                id: composeCard
                visible: tv.composing
                Layout.fillWidth: true
                implicitHeight: compose.implicitHeight + 16
                radius: 12
                color: Theme.surface
                onVisibleChanged: if (visible) titleField.forceActiveFocus()
                ColumnLayout {
                    id: compose
                    anchors { left: parent.left; right: parent.right; top: parent.top; margins: 8; leftMargin: 10; rightMargin: 10 }
                    spacing: 6
                    TaskField { id: titleField; placeholder: "Task title"; onAccepted: composeCard.submit(); onCancelled: tv.composing = false }
                    TaskField { id: notesField; placeholder: "Description (optional)"; size: 12; onAccepted: composeCard.submit(); onCancelled: tv.composing = false }
                    RowLayout {
                        Layout.alignment: Qt.AlignRight
                        spacing: 8
                        NButton {
                            implicitWidth: cancelLabel.implicitWidth + 24; implicitHeight: 24
                            color: Qt.rgba(1, 1, 1, 0.06)
                            onClicked: tv.composing = false
                            NText { id: cancelLabel; anchors.centerIn: parent; text: "Cancel"; size: 11; weight: Font.Bold; color: Theme.textMuted }
                        }
                        NButton {
                            implicitWidth: okLabel.implicitWidth + 24; implicitHeight: 24
                            enabled: titleField.text.trim() !== ""
                            color: Qt.rgba(120 / 255, 170 / 255, 1, 0.35)
                            hoverColor: Qt.rgba(120 / 255, 170 / 255, 1, 0.5)
                            onClicked: composeCard.submit()
                            NText { id: okLabel; anchors.centerIn: parent; text: "Add"; size: 11; weight: Font.Bold }
                        }
                    }
                }
                function submit() {
                    if (!titleField.text.trim()) return;
                    cal.addTask(tv.target, titleField.text, notesField.text);
                    titleField.text = notesField.text = "";
                    tv.composing = false;
                }
            }

            NText {
                visible: tv.items.length === 0 && !tv.composing
                Layout.fillWidth: true
                Layout.fillHeight: true
                horizontalAlignment: Text.AlignHCenter
                text: "No pending tasks"
                size: 12; color: Theme.textDim
            }
            ListView {
                visible: tv.items.length > 0
                Layout.fillWidth: true
                Layout.fillHeight: true
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                model: tv.items
                delegate: Item {
                    id: task
                    required property var modelData
                    width: ListView.view.width
                    height: tagText.visible ? 42 : 34
                    Rectangle {
                        anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
                        height: 1
                        color: Theme.surface
                    }
                    RowLayout {
                        anchors.fill: parent
                        spacing: 9
                        NButton {
                            implicitWidth: 18; implicitHeight: 18
                            color: task.modelData.done ? Theme.green : "transparent"
                            hoverColor: task.modelData.done ? Theme.green : Theme.hover
                            accessibleName: task.modelData.done ? "Mark as not done" : "Mark as done"
                            onClicked: cal.toggleTask(task.modelData)
                            Rectangle {
                                anchors.fill: parent
                                radius: 9
                                color: "transparent"
                                border { width: 1.5; color: task.modelData.done ? Theme.green : "#636366" }
                            }
                            NText {
                                visible: task.modelData.done
                                anchors.centerIn: parent
                                text: "✓"; size: 12; weight: Font.Bold; color: "black"
                            }
                        }
                        Column {
                            Layout.fillWidth: true
                            NText {
                                width: parent.width
                                text: task.modelData.title
                                size: 13; weight: Font.Medium
                                color: task.modelData.done ? Qt.rgba(1, 1, 1, 0.4) : Theme.text
                                font.strikeout: task.modelData.done
                            }
                            NText {
                                id: tagText
                                visible: tv.active === "All" && tv.lists.length > 1
                                width: parent.width
                                text: task.modelData.list
                                size: 10; weight: Font.DemiBold; color: Theme.textFaint
                            }
                        }
                        NText {
                            visible: task.modelData.due > 0
                            text: tab.due(task.modelData.due)
                            size: 11; weight: Font.DemiBold; tnum: true
                            color: task.modelData.due < tab.todayStart ? Theme.red : Theme.orange
                        }
                    }
                }
            }
        }
    }

    /* a borderless line edit on a hairline, like the GNOME compose card */
    component TaskField: Item {
        property alias text: input.text
        property string placeholder
        property int size: 13
        signal accepted()
        signal cancelled()
        Layout.fillWidth: true
        implicitHeight: input.implicitHeight + 9
        function forceActiveFocus() { input.forceActiveFocus(); }
        TextInput {
            id: input
            anchors { left: parent.left; right: parent.right; verticalCenter: parent.verticalCenter }
            color: Theme.text
            font.family: Theme.font
            font.pixelSize: parent.size
            selectByMouse: true
            selectionColor: Theme.blue
            clip: true
            onActiveFocusChanged: if (tab.notch) tab.notch.notesFocused = activeFocus
            onAccepted: parent.accepted()
            Keys.onEscapePressed: parent.cancelled()
            NText {
                visible: !input.text
                anchors.verticalCenter: parent.verticalCenter
                text: parent.parent.placeholder
                size: parent.parent.size; color: Theme.textFaint
            }
        }
        Rectangle {
            anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
            height: 1
            color: Qt.rgba(1, 1, 1, 0.08)
        }
    }
}
