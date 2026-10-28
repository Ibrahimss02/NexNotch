import QtQuick
import QtQuick.Layouts

/* Now Playing: the blurred cover fills the card under a shade; cover,
   source, title and a waveform; a seekable progress line; transport; and
   optionally the synced lyrics. */
Rectangle {
    id: card
    property var notch
    readonly property var media: Services.media
    readonly property var info: media.info ?? ({})
    readonly property color accent: media.accent

    radius: 27
    color: "#26262A"
    clip: true
    implicitHeight: shade.implicitHeight

    RoundedImage {
        anchors.fill: parent
        radius: card.radius
        source: card.media.blurPath
    }

    Rectangle {
        id: shade
        anchors.fill: parent
        radius: 27
        color: Qt.rgba(0, 0, 0, 0.42)
        implicitHeight: col.implicitHeight + 14 + 11

        ColumnLayout {
            id: col
            anchors.fill: parent
            anchors.leftMargin: 16; anchors.rightMargin: 16
            anchors.topMargin: 14; anchors.bottomMargin: 11
            spacing: 11

            RowLayout {
                spacing: 13
                Rectangle {
                    implicitWidth: 65; implicitHeight: 65; radius: 14
                    color: "#6E4659"
                    NIcon { anchors.centerIn: parent; visible: !art.ready; name: card.media.appIcon(card.info.desktopEntry); size: 26 }
                    RoundedImage {
                        id: art
                        anchors.fill: parent
                        radius: 14
                        source: card.media.artPath
                        sourceSize: Qt.size(130, 130)
                    }
                }
                ColumnLayout {
                    Layout.fillWidth: true
                    Layout.alignment: Qt.AlignVCenter
                    spacing: 2
                    NButton {
                        implicitWidth: srcRow.implicitWidth
                        implicitHeight: srcRow.implicitHeight
                        Layout.maximumWidth: parent.width
                        hoverColor: "transparent"; pressColor: "transparent"
                        accessibleName: "Show the player"
                        onClicked: { card.media.raise(); card.notch.collapse(); }
                        Row {
                            id: srcRow
                            spacing: 5
                            Rectangle { anchors.verticalCenter: parent.verticalCenter; width: 6; height: 6; radius: 3; color: Theme.green }
                            NText {
                                anchors.verticalCenter: parent.verticalCenter
                                width: Math.min(implicitWidth, col.width - 160)
                                text: [card.info.app, Services.audio.sinkName].filter(Boolean).join(" · ")
                                size: 11; color: Theme.textDim
                            }
                        }
                    }
                    NText { Layout.fillWidth: true; text: card.info.title || "Unknown"; size: 16; weight: Font.DemiBold }
                    NText { Layout.fillWidth: true; visible: !!card.info.artist; text: card.info.artist ?? ""; size: 13; color: Theme.textDim }
                }
                Waveform { bars: 5; barWidth: 4; barHeight: 20; color: card.accent; playing: !!card.info.playing }
            }

            /* position is polled each second and advanced locally in between */
            RowLayout {
                id: progress
                spacing: 11
                readonly property double len: card.info.length || 0
                property double pos: 0
                function fmt(us) {
                    const sec = Math.max(0, Math.floor(us / 1e6));
                    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
                }
                Timer {
                    interval: 250; repeat: true; triggeredOnStart: true
                    running: card.visible
                    onTriggered: progress.pos = card.media.position()
                }
                NText {
                    Layout.minimumWidth: 31
                    text: progress.fmt(bar.dragging ? bar.dragValue * progress.len : progress.pos)
                    size: 11; tnum: true; color: Theme.textDim
                }
                NSlider {
                    id: bar
                    Layout.fillWidth: true
                    interactive: !!card.info.canSeek
                    value: progress.len ? progress.pos / progress.len : 0
                    onDraggingChanged: card.notch.seeking = dragging
                    onReleased: v => { card.media.seekFraction(v); progress.pos = v * progress.len; }
                    Accessible.name: "Playback position"
                }
                NText {
                    Layout.minimumWidth: 31
                    horizontalAlignment: Text.AlignRight
                    text: progress.len ? `−${progress.fmt(Math.max(0, progress.len - progress.pos))}` : ""
                    size: 11; tnum: true; color: Theme.textDim
                }
            }

            RowLayout {
                spacing: 0
                PlayerButton {
                    icon: "format-justify-left-symbolic"; accessibleName: "Lyrics"
                    checked: Config.lyricsEnabled
                    onClicked: Config.lyricsEnabled = !Config.lyricsEnabled
                }
                Item { Layout.fillWidth: true }
                Row {
                    spacing: 20
                    PlayerButton {
                        icon: "media-playlist-shuffle-symbolic"; accessibleName: "Shuffle"
                        enabled: typeof card.info.shuffle === "boolean"
                        checked: !!card.info.shuffle
                        onClicked: card.media.toggleShuffle()
                    }
                    PlayerButton {
                        icon: "media-skip-backward-symbolic"; accessibleName: "Previous track"; main: true
                        enabled: !!card.info.canPrev
                        onClicked: card.media.previous()
                    }
                    PlayerButton {
                        icon: card.info.playing ? "media-playback-pause-symbolic" : "media-playback-start-symbolic"
                        accessibleName: card.info.playing ? "Pause" : "Play"; main: true; big: true
                        enabled: !!(card.info.canPlay || card.info.canPause)
                        onClicked: card.media.playPause()
                    }
                    PlayerButton {
                        icon: "media-skip-forward-symbolic"; accessibleName: "Next track"; main: true
                        enabled: !!card.info.canNext
                        onClicked: card.media.next()
                    }
                    PlayerButton {
                        icon: card.info.loop === "Track" ? "media-playlist-repeat-song-symbolic" : "media-playlist-repeat-symbolic"
                        accessibleName: "Repeat"
                        enabled: typeof card.info.loop === "string"
                        checked: !!card.info.loop && card.info.loop !== "None"
                        onClicked: card.media.cycleLoop()
                    }
                }
                Item { Layout.fillWidth: true }
                PlayerButton {
                    icon: "audio-card-symbolic"; accessibleName: "Audio output"
                    tint: card.accent
                    onClicked: card.notch.visitQuick("output")
                }
            }

            Lyrics {
                Layout.fillWidth: true
                visible: Config.lyricsEnabled
                info: card.info
                position: progress.pos
            }
        }
    }

    component PlayerButton: NButton {
        id: pb
        property string icon
        property bool main: false
        property bool big: false
        property color tint: "transparent"
        implicitWidth: big ? 47 : 40
        implicitHeight: implicitWidth
        opacity: 1
        NIcon {
            anchors.centerIn: parent
            name: pb.icon
            size: pb.big ? 25 : pb.main ? 22 : 16
            color: !pb.enabled ? Theme.disabled : pb.checked ? card.accent : pb.tint.a > 0 ? pb.tint : pb.main ? Theme.text : Theme.textDim
        }
    }

    /* previous / current / next lyric line; moving to the next line starts a
       row lower and glides up, like scrolling */
    component Lyrics: Item {
        id: lyr
        property var info
        property double position: 0
        property var lines: null
        property string message: "Loading lyrics…"
        property int shown: -2
        property string key: ""
        implicitHeight: Math.max(84, box.implicitHeight + 14)
        clip: true

        function load() {
            const k = `${info?.artist}|${info?.title}|${info?.album}`;
            if (!visible || k === key) return;
            key = k;
            lines = null;
            shown = -2;
            message = "Loading lyrics…";
            Services.media.lyrics.get(info).then(result => {
                if (lyr.key !== k) return;
                if (!result) lyr.message = "No lyrics found for this song";
                else if (result.instrumental) lyr.message = "♪ Instrumental";
                else if (!result.synced) lyr.message = "Only unsynced lyrics are available";
                else { lyr.lines = result.synced; lyr.sync(); }
            });
        }
        onInfoChanged: load()
        onVisibleChanged: load()
        Component.onCompleted: load()
        onPositionChanged: sync()

        function sync() {
            if (!lines) return;
            const i = Services.media.lyrics.lineAt(lines, position / 1000);
            if (i === shown) return;
            const step = i === shown + 1 ? prev.height + box.spacing : 0;
            shown = i;
            glide.stop();
            box.dy = step;
            if (step) glide.start();
        }

        ColumnLayout {
            id: box
            property real dy: 0
            width: parent.width
            y: 10 + dy
            spacing: 4
            NText {
                id: prev
                Layout.fillWidth: true
                horizontalAlignment: Text.AlignHCenter
                text: lyr.lines?.[lyr.shown - 1]?.text ?? ""
                size: 11; color: Qt.rgba(1, 1, 1, 0.45)
            }
            NText {
                Layout.fillWidth: true
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.WordWrap
                maximumLineCount: 2
                text: !lyr.lines ? lyr.message : lyr.shown >= 0 ? (lyr.lines[lyr.shown].text || "♪") : "♪"
                size: 14; weight: Font.Bold
            }
            NText {
                Layout.fillWidth: true
                horizontalAlignment: Text.AlignHCenter
                text: lyr.lines?.[lyr.shown + 1]?.text ?? ""
                size: 11; color: Qt.rgba(1, 1, 1, 0.45)
            }
        }
        NumberAnimation { id: glide; target: box; property: "dy"; to: 0; duration: 340; easing.type: Easing.OutCubic }
    }
}
