import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

/* Where events and tasks come from. GNOME reads them from GNOME Online
   Accounts; on KDE NexNotch fetches them itself, from iCal links and/or a
   Google account signed in through the user's own OAuth client. */
SettingsPage {
    id: page
    readonly property var cal: Services.calendar
    readonly property var account: cal?.googleAccount
    readonly property string accountName: !account ? "" : typeof account === "string" ? account : (account.email ?? account.name ?? "")

    /* calendar-enabled-sources / tasks-enabled-lists: empty = everything, as in
       GNOME; otherwise the ids that are on */
    function isOn(key, id) {
        return Config[key].length === 0 || Config[key].includes(id);
    }
    function setOn(key, all, id, on) {
        const cur = new Set(Config[key].length ? Config[key] : all);
        if (on) cur.add(id); else cur.delete(id);
        Config[key] = all.every(x => cur.has(x)) ? [] : all.filter(x => cur.has(x));
    }
    /* the last one that's on stays on: none would read as "all" */
    function isLast(key, all, id) {
        return isOn(key, id) && all.filter(x => isOn(key, x)).length === 1;
    }

    /* ——— iCal ——— */
    Item {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: "iCal feeds"
    }
    ColumnLayout {
        Kirigami.FormData.label: "Feeds:"
        Layout.fillWidth: true
        Layout.maximumWidth: Kirigami.Units.gridUnit * 22
        spacing: 0

        QQC2.Label {
            visible: !(page.cal?.feeds ?? []).length
            text: "None yet"
            color: Kirigami.Theme.disabledTextColor
        }
        Repeater {
            model: page.cal?.feeds ?? []
            delegate: RowLayout {
                id: feed
                required property var modelData
                required property int index
                Layout.fillWidth: true
                spacing: Kirigami.Units.smallSpacing

                Rectangle {
                    implicitWidth: Kirigami.Units.gridUnit * 0.6
                    implicitHeight: implicitWidth
                    radius: width / 2
                    color: feed.modelData.color || Kirigami.Theme.highlightColor
                }
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 0
                    QQC2.Label { Layout.fillWidth: true; text: feed.modelData.name || "Calendar"; elide: Text.ElideRight }
                    QQC2.Label {
                        Layout.fillWidth: true
                        text: feed.modelData.url
                        elide: Text.ElideMiddle
                        font: Kirigami.Theme.smallFont
                        color: Kirigami.Theme.disabledTextColor
                    }
                }
                QQC2.ToolButton {
                    icon.name: "edit-delete-remove"
                    display: QQC2.AbstractButton.IconOnly
                    text: `Remove ${feed.modelData.name || "feed"}`
                    QQC2.ToolTip.text: text
                    QQC2.ToolTip.visible: hovered
                    QQC2.ToolTip.delay: Kirigami.Units.toolTipDelay
                    onClicked: page.cal?.removeFeed?.(feed.index)
                }
            }
        }
    }

    QQC2.TextField {
        id: feedName
        Kirigami.FormData.label: "New feed:"
        Layout.fillWidth: true
        Layout.maximumWidth: Kirigami.Units.gridUnit * 22
        placeholderText: "Name, e.g. Work"
    }
    QQC2.TextField {
        id: feedUrl
        Layout.fillWidth: true
        Layout.maximumWidth: Kirigami.Units.gridUnit * 22
        placeholderText: "https://… .ics"
        inputMethodHints: Qt.ImhUrlCharactersOnly
        onAccepted: addFeed.clicked()
    }
    RowLayout {
        spacing: Kirigami.Units.smallSpacing
        /* the notch's palette, for telling feeds apart in the Calendar tab */
        Repeater {
            id: swatches
            property int picked: 0
            model: [Theme.blue, Theme.green, Theme.orange, Theme.red, Theme.purple, Theme.cyan, Theme.indigo]
            delegate: QQC2.AbstractButton {
                required property color modelData
                required property int index
                implicitWidth: Kirigami.Units.gridUnit * 1.2
                implicitHeight: implicitWidth
                checked: swatches.picked === index
                Accessible.name: `Color ${index + 1}`
                onClicked: swatches.picked = index
                contentItem: Rectangle {
                    radius: width / 2
                    color: parent.modelData
                    border.width: parent.checked ? 2 : 0
                    border.color: Kirigami.Theme.textColor
                }
            }
        }
        Item { Layout.fillWidth: true }
        QQC2.Button {
            id: addFeed
            text: "Add"
            icon.name: "list-add"
            enabled: /^(https?|webcal):\/\/\S+$/i.test(feedUrl.text.trim())
            onClicked: {
                page.cal?.addFeed?.(feedName.text.trim(), feedUrl.text.trim(), swatches.model[swatches.picked].toString());
                feedName.clear();
                feedUrl.clear();
            }
        }
    }
    SettingsHint {
        text: "Any calendar's iCal (.ics) link. For a Google calendar: Google Calendar › Settings › your calendar › Integrate calendar › <i>Secret address in iCal format</i> — read-only, no sign-in needed."
    }

    /* ——— Google ——— */
    Item {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: "Google account (optional)"
    }
    SettingsHint {
        text: "For Google Tasks and all your Google calendars at once, NexNotch signs in with your own OAuth client: in the <a href=\"https://console.cloud.google.com/\">Google Cloud Console</a> create a project, enable the <i>Google Calendar API</i> and <i>Google Tasks API</i>, then under Credentials create an OAuth client ID of type <i>Desktop app</i> and paste its ID and secret here."
    }
    SettingsText {
        key: "googleClientId"
        Kirigami.FormData.label: "Client ID:"
        placeholderText: "…apps.googleusercontent.com"
        enabled: !page.account
    }
    Kirigami.PasswordField {
        Kirigami.FormData.label: "Client secret:"
        Layout.fillWidth: true
        Layout.maximumWidth: Kirigami.Units.gridUnit * 22
        text: Config.googleClientSecret
        enabled: !page.account
        onEditingFinished: if (Config.googleClientSecret !== text.trim()) Config.googleClientSecret = text.trim()
    }
    RowLayout {
        Kirigami.FormData.label: "Account:"
        spacing: Kirigami.Units.smallSpacing

        QQC2.Label {
            visible: !!page.account
            text: `Signed in as ${page.accountName || "Google"}`
        }
        QQC2.Button {
            visible: !page.account
            text: "Sign in with Google…"
            icon.name: "im-user-online"
            enabled: !!page.cal?.signIn && !page.cal?.googleBusy && Config.googleClientId !== "" && Config.googleClientSecret !== ""
            onClicked: page.cal.signIn()
        }
        QQC2.Button {
            visible: !!page.account
            text: "Sign out"
            icon.name: "system-log-out"
            enabled: !page.cal?.googleBusy
            onClicked: page.cal?.signOut?.()
        }
        QQC2.BusyIndicator {
            visible: !!page.cal?.googleBusy
            running: visible
            Layout.preferredHeight: Kirigami.Units.iconSizes.smallMedium
            Layout.preferredWidth: Layout.preferredHeight
        }
    }
    SettingsHint {
        visible: !page.account
        text: "Signing in opens Google in your browser; the account's tokens stay on this computer."
    }
    Kirigami.InlineMessage {
        Layout.fillWidth: true
        Layout.maximumWidth: Kirigami.Units.gridUnit * 22
        type: Kirigami.MessageType.Error
        text: page.cal?.googleError ?? ""
        visible: text !== ""
    }

    /* ——— filters ——— */
    Item {
        Kirigami.FormData.isSection: true
        Kirigami.FormData.label: "Show"
    }
    QQC2.Label {
        Kirigami.FormData.label: "Calendars:"
        visible: !(page.cal?.calendars ?? []).length
        text: "None found yet"
        color: Kirigami.Theme.disabledTextColor
    }
    ColumnLayout {
        Kirigami.FormData.label: (page.cal?.calendars ?? []).length ? "Calendars:" : ""
        visible: (page.cal?.calendars ?? []).length > 0
        spacing: 0
        Repeater {
            model: page.cal?.calendars ?? []
            delegate: QQC2.CheckBox {
                required property var modelData
                text: modelData.source && modelData.source !== modelData.name ? `${modelData.name}  ·  ${modelData.source}` : modelData.name
                checked: page.isOn("calendarEnabledSources", modelData.id)
                enabled: !page.isLast("calendarEnabledSources", page.cal.calendars.map(c => c.id), modelData.id)
                onToggled: page.setOn("calendarEnabledSources", page.cal.calendars.map(c => c.id), modelData.id, checked)
            }
        }
    }
    QQC2.Label {
        Kirigami.FormData.label: "Task lists:"
        visible: !(page.cal?.taskLists ?? []).length
        text: page.account ? "None found yet" : "Needs a Google account"
        color: Kirigami.Theme.disabledTextColor
    }
    ColumnLayout {
        Kirigami.FormData.label: (page.cal?.taskLists ?? []).length ? "Task lists:" : ""
        visible: (page.cal?.taskLists ?? []).length > 0
        spacing: 0
        Repeater {
            model: page.cal?.taskLists ?? []
            delegate: QQC2.CheckBox {
                required property var modelData
                text: modelData.name
                checked: page.isOn("tasksEnabledLists", modelData.id)
                enabled: !page.isLast("tasksEnabledLists", page.cal.taskLists.map(l => l.id), modelData.id)
                onToggled: page.setOn("tasksEnabledLists", page.cal.taskLists.map(l => l.id), modelData.id, checked)
            }
        }
    }
    SettingsHint {
        visible: (page.cal?.status ?? "") !== ""
        text: page.cal?.status ?? ""
    }
}
