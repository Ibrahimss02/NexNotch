import QtQuick
import org.kde.kirigami as Kirigami

/* A theme icon name, a file/qrc URL, or one of the notch's own glyphs
   ("own:moon" → icons/moon.svg). Symbolic and own icons take `color`. */
Kirigami.Icon {
    property string name: ""
    property int size: 16
    readonly property bool own: name.startsWith("own:")
    implicitWidth: size
    implicitHeight: size
    source: own ? Qt.resolvedUrl("../icons/" + name.slice(4) + ".svg") : name
    isMask: own || name.endsWith("-symbolic")
    color: Theme.text
    roundToIconSize: false
}
