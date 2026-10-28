import QtQuick

/* camera / mic in use, and "In a meeting" */
Item {
    id: peek
    property var notch
    property string kind: "camera"
    property string title: ""
    property string subtitle: ""
    PeekCard {
        anchors.fill: parent
        anchors.leftMargin: 9; anchors.rightMargin: 14
        compact: true
        lines: [[peek.title, "privacyTitle"], [peek.subtitle, "privacyApp"]]
        Rectangle {
            width: 31; height: 31; radius: 16
            color: peek.kind === "camera" ? "#0E3A1C" : "#3A2A0E"
            NIcon { anchors.centerIn: parent; name: peek.kind === "camera" ? "own:camera" : "own:mic"; size: 15
                color: peek.kind === "camera" ? Theme.green : Theme.orange }
        }
    }
}
