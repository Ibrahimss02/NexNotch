import QtQuick

/* the drink-water reminder, with a Drink button right on it */
Item {
    id: peek
    property var notch
    PeekCard {
        anchors.fill: parent
        lines: [["Time for water", "title"], [`${Services.water.cups} of ${Config.waterGoal} cups today`, "body"]]
        Rectangle {
            width: 43; height: 43; radius: 22
            color: "#0B3340"
            NIcon { anchors.centerIn: parent; name: "own:water-cup"; size: 22; color: Theme.cyan }
        }
        trailing: NButton {
            implicitWidth: drinkLabel.implicitWidth + 28
            implicitHeight: 31
            radius: 15
            color: Theme.cyan; hoverColor: "#8FE0FF"; pressColor: "#8FE0FF"
            accessibleName: "Log a cup of water"
            onClicked: { Services.water.drink(); peek.notch.dismissPeek(false); }
            NText { id: drinkLabel; anchors.centerIn: parent; text: "Drink"; size: 12; weight: Font.DemiBold; color: "black" }
        }
    }
}
