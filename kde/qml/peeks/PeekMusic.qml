import QtQuick

/* "Now Playing" when a track starts or changes */
Item {
    id: peek
    property var notch
    property var info: ({})
    PeekCard {
        anchors.fill: parent
        lines: [["Now Playing", "caption"], [peek.info.title || "Unknown", "title"], [peek.info.artist, "body"]]
        Rectangle {
            width: 47; height: 47; radius: 13
            color: "#5B3A4B"
            NIcon { anchors.centerIn: parent; visible: !art.ready; name: Services.media.appIcon(peek.info.desktopEntry); size: 22 }
            RoundedImage {
                id: art
                anchors.fill: parent
                radius: 13
                source: Services.media.artPath
                sourceSize: Qt.size(94, 94)
            }
        }
        trailing: Waveform { bars: 5; barWidth: 4; barHeight: 20; color: Services.media.accent; playing: true }
    }
}
