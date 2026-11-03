import QtQuick

/* A theme's ambient scene around a notification peek, laid out on the
   peek's own coordinates (the design's 440 × 76), centred on the notch.
   The notch creates it twice: `back` sits behind the notch, the other
   layer above its fill but under the text. `live` runs the motion (Full);
   otherwise the art stands still. */
Item {
    id: scene
    required property Item host
    property real peekWidth: 440
    property real peekHeight: 76
    property bool live: true
    property bool back: false
    readonly property real cx: peekWidth / 2
    x: (host.width - peekWidth) / 2
    function art(name) { return Qt.resolvedUrl("../icons/scene-" + name + ".svg"); }
    Behavior on opacity { NumberAnimation { duration: 140 } }
}
