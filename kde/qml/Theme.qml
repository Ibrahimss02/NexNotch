pragma Singleton
import QtQuick
import "Themes.js" as Themes

/* The palette and type of the GNOME extension's stylesheet.css (its later,
   Apple-like rules: #A1A1A6 secondary text, system green/orange/red), unless
   an island theme from Themes.js paints over it. `plain` is set while a peek
   the theme must not touch (camera, mic, recording) is showing. */
QtObject {
    property bool plain: false
    property string preview: ""     // dev shots: try a theme without saving it
    readonly property var selected: Themes.themes[preview || Config.theme] ?? null
    readonly property var t: plain ? null : selected
    readonly property bool themed: t !== null
    readonly property bool light: t?.light ?? false

    readonly property color bg: t?.bg ?? Config.bgColor
    readonly property color text: t?.text ?? "#ffffff"
    readonly property color textDim: t?.dim ?? "#A1A1A6"
    readonly property color textFaint: Qt.alpha(text, 0.45)
    readonly property color textMuted: Qt.alpha(text, 0.55)
    readonly property color hairline: Qt.alpha(text, 0.07)
    readonly property color textSoft: t ? Qt.alpha(t.text, 0.9) : "#E5E5EA"
    readonly property color textTertiary: t ? Qt.alpha(t.dim, 0.85) : "#8E8E93"
    readonly property color card: t?.card ?? "#1C1C1E"
    readonly property color cardHover: t ? (light ? Qt.darker(t.card, 1.06) : Qt.lighter(t.card, 1.25)) : "#232326"
    readonly property color surface: t?.tile ?? "#2C2C2E"       // icon tiles
    readonly property color surfaceHi: t ? (light ? Qt.darker(t.tile, 1.12) : Qt.lighter(t.tile, 1.35)) : "#3A3A3C"
    readonly property color hover: Qt.alpha(text, 0.10)
    readonly property color pressed: Qt.alpha(text, 0.16)
    readonly property color disabled: t?.dotOff ?? "#48484A"
    readonly property color dot: t ? Qt.alpha(t.dotOff, 0.8) : "#636366"
    readonly property color track: t?.track ?? "#48484A"
    readonly property color accent: t?.accent ?? "#ffffff"
    readonly property color onAccent: t?.onAccent ?? "#000000"
    readonly property color battery: t?.battery ?? Config.batteryNormalColor

    readonly property color frame: t?.frame ?? "transparent"
    readonly property real frameW: t ? t.frameW : 0
    readonly property color frameIn: t?.frameIn ?? "transparent"
    readonly property color cardBorder: t?.cardBorder ?? "transparent"
    readonly property real cardBorderW: t ? (t.cardBorderW ?? 1) : 0
    readonly property var glow: t?.glow ?? null
    readonly property var offset: t?.offset ?? null

    readonly property real cardRadius: t?.cardRadius ?? 23
    readonly property real iconRadius: t?.iconRadius ?? 14
    readonly property real barRadius: t?.barRadius ?? 2
    readonly property int cornerRadius: t?.cornerRadius ?? Config.cornerRadius

    /* system colours; a light theme takes the darker light-mode set so they read on paper */
    readonly property color green: light ? "#1E7B34" : "#30D158"
    readonly property color orange: light ? "#B25400" : "#FF9F0A"
    readonly property color red: light ? "#C21D12" : "#FF453A"
    readonly property color blue: light ? "#0058C2" : "#0A84FF"
    readonly property color cyan: light ? "#00718F" : "#64D2FF"
    readonly property color purple: light ? "#8E2BB5" : "#BF5AF2"
    readonly property color indigo: light ? "#4543C2" : "#A5A4FF"
    readonly property color spotify: "#1DB954"   // when there's no cover to take a colour from

    /* "SF Pro Display", "Inter", "Cantarell" in the GNOME CSS; whichever is installed */
    readonly property string systemFont: {
        const have = Qt.fontFamilies();
        for (const f of ["SF Pro Display", "Inter", "Inter Variable", "Cantarell", "Noto Sans"])
            if (have.includes(f)) return f;
        return Qt.application.font.family;
    }
    readonly property string font: t?.font ?? systemFont
    readonly property string titleFont: t?.titleFont ?? systemFont
    readonly property string clockFont: t?.clockFont ?? systemFont
    readonly property bool titleItalic: t?.titleItalic ?? false
    readonly property real fontScale: t?.fontScale ?? 1
    readonly property real titleScale: t?.titleScale ?? 1
    readonly property int clockSize: t?.clockSize ?? 31
    readonly property int pillClockSize: t?.pillClockSize ?? 13

    readonly property string earLeft: t ? t.ear : ""
    readonly property string earRight: t ? (t.earRight || t.ear) : ""
    readonly property bool earRightMirrored: !!t && !t.earRight

    /* translucent text: on a theme, never fainter than 70% so it stays readable on light cards */
    function fade(a) { return Qt.alpha(text, themed ? Math.max(a, 0.7) : a); }

    readonly property int anim: 260
    readonly property int earPx: 13          // radius of the concave top corners
}
