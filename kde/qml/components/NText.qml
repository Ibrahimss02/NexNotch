import QtQuick

/* Text in the notch's type: white, the theme font, tabular figures. */
Text {
    property int size: 12
    property int weight: Font.Normal
    property bool tnum: false
    color: Theme.text
    font.family: Theme.font
    font.pixelSize: size
    font.weight: weight
    font.features: tnum ? {"tnum": 1} : ({})
    elide: Text.ElideRight
    maximumLineCount: wrapMode === Text.NoWrap ? 1 : 100
    verticalAlignment: Text.AlignVCenter
    textFormat: Text.PlainText
}
