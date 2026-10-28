pragma Singleton
import QtQuick

/* The palette and type of the GNOME extension's stylesheet.css (its later,
   Apple-like rules: #A1A1A6 secondary text, system green/orange/red). */
QtObject {
    readonly property color bg: Config.bgColor
    readonly property color text: "#ffffff"
    readonly property color textDim: "#A1A1A6"
    readonly property color textFaint: Qt.rgba(1, 1, 1, 0.45)
    readonly property color textMuted: Qt.rgba(1, 1, 1, 0.55)
    readonly property color hairline: Qt.rgba(1, 1, 1, 0.07)
    readonly property color surface: "#2C2C2E"       // icon tiles, cards
    readonly property color surfaceHi: "#3A3A3C"
    readonly property color hover: Qt.rgba(1, 1, 1, 0.10)
    readonly property color pressed: Qt.rgba(1, 1, 1, 0.16)
    readonly property color disabled: "#48484A"
    readonly property color dot: "#636366"
    readonly property color accent: Config.accentColor

    readonly property color green: "#30D158"
    readonly property color orange: "#FF9F0A"
    readonly property color red: "#FF453A"
    readonly property color blue: "#0A84FF"
    readonly property color cyan: "#64D2FF"
    readonly property color purple: "#BF5AF2"
    readonly property color indigo: "#A5A4FF"
    readonly property color spotify: "#1DB954"   // when there's no cover to take a colour from

    /* "SF Pro Display", "Inter", "Cantarell" in the GNOME CSS; whichever is installed */
    readonly property string font: {
        const have = Qt.fontFamilies();
        for (const f of ["SF Pro Display", "Inter", "Inter Variable", "Cantarell", "Noto Sans"])
            if (have.includes(f)) return f;
        return Qt.application.font.family;
    }

    readonly property int anim: 260
    readonly property int earPx: 13          // radius of the concave top corners
}
