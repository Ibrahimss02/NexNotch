import QtQuick

/* Sumi-e: a red sun rising in the paper behind the text, bamboo in faint
   ink beside it. */
Scene {
    id: s
    Item {
        visible: !s.back
        width: s.peekWidth; height: s.peekHeight
        clip: true
        Rectangle {
            x: s.peekWidth - 8 - 64; y: -14
            width: 64; height: 64; radius: 32
            color: "#C8102E"
            opacity: 0.85
            SequentialAnimation on scale {
                running: s.live; loops: Animation.Infinite
                NumberAnimation { to: 1.06; duration: 3000; easing.type: Easing.InOutSine }
                NumberAnimation { to: 1; duration: 3000; easing.type: Easing.InOutSine }
            }
        }
        Image {
            x: s.peekWidth - 120; y: 0
            width: 120; height: 76
            sourceSize: Qt.size(240, 152)
            source: s.art("sumi-bamboo")
        }
    }
}
