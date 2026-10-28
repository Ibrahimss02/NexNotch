import QtQuick

/* Notes: draft cards (title + body) saved as markdown as you type
   (notes.js render()). The notch is a layer-shell surface that only takes
   the keyboard while notch.notesFocused is set, so a field raises it before
   taking focus, and the last field to lose focus drops it — the KDE side of
   GNOME's modal grab. Enter in the title moves to the body, Enter in the
   body saves, Shift+Enter is a new line, Escape lets go of the keyboard. */
Item {
    id: tab
    property var notch
    readonly property var notes: Services.notes
    property int focusedFields: 0
    implicitHeight: col.implicitHeight

    function fieldFocus(on) {
        focusedFields += on ? 1 : -1;
        if (on) notch.notesFocused = true;
        /* checked once focus settles, so moving between fields keeps it */
        else Qt.callLater(() => { if (tab.focusedFields <= 0 && tab.notch) tab.notch.notesFocused = false; });
    }

    Column {
        id: col
        width: parent.width
        spacing: 8

        Item {
            width: parent.width
            height: newBtn.height + 2
            NText {
                anchors.verticalCenter: newBtn.verticalCenter
                text: "Notes"
                size: 11; weight: Font.Bold
                color: Qt.rgba(1, 1, 1, 0.7)
                font.letterSpacing: 0.4
            }
            NButton {
                id: newBtn
                anchors.right: parent.right
                implicitWidth: newLabel.implicitWidth + 24
                implicitHeight: newLabel.implicitHeight + 6
                color: Qt.rgba(120 / 255, 170 / 255, 1, 0.22)
                hoverColor: Qt.rgba(120 / 255, 170 / 255, 1, 0.35)
                pressColor: hoverColor
                accessibleName: "New note"
                onClicked: tab.notes.newDraft()
                NText {
                    id: newLabel
                    anchors.centerIn: parent
                    text: "+ New"
                    size: 10; weight: Font.Bold
                    color: newBtn.hovered ? Theme.text : Qt.rgba(1, 1, 1, 0.85)
                }
            }
        }

        Flickable {
            width: parent.width
            height: Math.min(300, list.height)
            contentHeight: list.height
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            interactive: contentHeight > height

            Column {
                id: list
                width: parent.width
                spacing: 10
                Repeater {
                    model: tab.notes.drafts
                    NoteCard {}
                }
            }
        }
    }

    component NoteCard: Rectangle {
        id: card
        required property string uid
        required property string title
        required property string body
        required property string filePath
        width: list.width
        height: cardCol.implicitHeight + 20
        radius: 10
        color: hover.hovered ? Qt.rgba(1, 1, 1, 0.08) : Qt.rgba(1, 1, 1, 0.03)
        border.color: Qt.rgba(1, 1, 1, 0.06)
        border.width: 1
        HoverHandler { id: hover }

        function changed() { tab.notes.edit(uid, titleField.text, bodyField.text); }

        Column {
            id: cardCol
            x: 10; y: 10
            width: parent.width - 20
            spacing: 6

            NoteField {
                id: titleField
                width: parent.width
                placeholder: "Title (optional)"
                initial: card.title
                bold: true
                onEdited: card.changed()
                onEnter: bodyField.focusField()
            }
            NoteField {
                id: bodyField
                width: parent.width
                minHeight: 56
                placeholder: "Type your note… (Enter saves, Shift+Enter for a new line)"
                initial: card.body
                onEdited: card.changed()
                onEnter: tab.notes.saveNow(card.uid)
            }
            Item {
                width: parent.width
                height: delBtn.height
                NText {
                    anchors.left: parent.left
                    anchors.right: delBtn.left
                    anchors.rightMargin: 8
                    anchors.verticalCenter: parent.verticalCenter
                    text: card.filePath ? `Saved → ${card.filePath.replace(Sys.home, "~")}` : "Not saved yet"
                    elide: Text.ElideMiddle
                    size: 9; color: Qt.rgba(1, 1, 1, 0.35)
                }
                NButton {
                    id: delBtn
                    anchors.right: parent.right
                    implicitWidth: delLabel.implicitWidth + 20
                    implicitHeight: delLabel.implicitHeight + 6
                    color: Qt.rgba(1, 1, 1, 0.06)
                    hoverColor: Qt.rgba(1, 120 / 255, 120 / 255, 0.2)
                    pressColor: hoverColor
                    accessibleName: "Delete note"
                    onClicked: tab.notes.remove(card.uid)
                    NText {
                        id: delLabel
                        anchors.centerIn: parent
                        text: "Delete"
                        size: 10
                        color: delBtn.hovered ? Theme.text : Qt.rgba(1, 1, 1, 0.7)
                    }
                }
            }
        }
    }

    /* a GNOME-style entry: wrapping, multi-line, with a placeholder */
    component NoteField: Rectangle {
        id: field
        property string placeholder
        property string initial
        property bool bold: false
        property real minHeight: 0
        readonly property alias text: edit.text
        signal edited()
        signal enter()

        function focusField() {
            tab.notch.notesFocused = true;
            edit.forceActiveFocus();
        }

        height: Math.max(minHeight, edit.implicitHeight + 16)
        radius: 9
        color: Qt.rgba(1, 1, 1, 0.08)
        border.width: edit.activeFocus ? 2 : 0
        border.color: Qt.rgba(10 / 255, 132 / 255, 1, 0.8)

        TextEdit {
            id: edit
            x: 10; y: 8
            width: parent.width - 20
            color: Theme.text
            selectionColor: Theme.blue
            selectedTextColor: Theme.text
            font.family: Theme.font
            font.pixelSize: 13
            font.weight: field.bold ? Font.DemiBold : Font.Normal
            wrapMode: TextEdit.Wrap
            textFormat: TextEdit.PlainText
            selectByMouse: true
            property bool ready: false
            Component.onCompleted: { text = field.initial; ready = true; }
            onTextChanged: if (ready) field.edited()
            onActiveFocusChanged: tab.fieldFocus(activeFocus)
            Keys.onReturnPressed: e => field.key(e)
            Keys.onEnterPressed: e => field.key(e)
            Keys.onEscapePressed: tab.forceActiveFocus()
        }
        NText {
            x: edit.x; y: edit.y
            width: edit.width
            visible: !edit.text && !edit.preeditText
            text: field.placeholder
            size: 13
            weight: edit.font.weight
            wrapMode: Text.Wrap
            color: Qt.rgba(1, 1, 1, 0.4)
            verticalAlignment: Text.AlignTop
        }
        /* raise the keyboard before the click lands in the text */
        MouseArea {
            anchors.fill: parent
            cursorShape: Qt.IBeamCursor
            onPressed: m => { field.focusField(); m.accepted = false; }
        }

        function key(e) {
            if (e.modifiers & Qt.ShiftModifier) { e.accepted = false; return; }
            field.enter();
        }
    }
}
