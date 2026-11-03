import QtQuick

/* Text in the notch's type: white, the theme font, tabular figures. `title`
   takes the theme's display face instead (a serif, a pixel font…). */
Text {
    property int size: 12
    property int weight: Font.Normal
    property bool tnum: false
    property bool title: false
    color: Theme.text
    font.family: title ? Theme.titleFont : Theme.font
    font.italic: title && Theme.titleItalic
    font.pixelSize: Math.round(size * (title ? Theme.titleScale : Theme.fontScale))
    font.weight: weight
    font.features: tnum ? {"tnum": 1} : ({})
    elide: Text.ElideRight
    maximumLineCount: wrapMode === Text.NoWrap ? 1 : 100
    verticalAlignment: Text.AlignVCenter
    textFormat: Text.PlainText
}
