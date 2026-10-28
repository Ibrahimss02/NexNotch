import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami
import org.kde.kquickcontrols as KQC

/* The toggle shortcut is a KGlobalAccel action (component "nexnotch",
   action "toggle-notch", registered in main.cpp), so it lives in Plasma's
   shortcut store: read and set it over kglobalaccel's D-Bus, the way
   System Settings' Shortcuts module does. */
SettingsPage {
    id: page
    readonly property var actionId: ["nexnotch", "toggle-notch", "NexNotch", "Toggle the notch"]
    property bool loaded: false

    function load() {
        DBus.call("session", "org.kde.kglobalaccel", "/kglobalaccel", "org.kde.KGlobalAccel",
                  "shortcut", [actionId], "as", (out, err) => {
            if (err) console.warn("nexnotch: reading the shortcut failed:", err);
            /* one QKeySequence as Qt key-combination ints; we use the first */
            keys.keySequence = out?.[0]?.[0] ?? 0;
            page.loaded = !err;
        });
    }
    function save(combo) {
        DBus.call("session", "org.kde.kglobalaccel", "/kglobalaccel", "org.kde.KGlobalAccel",
                  "setForeignShortcut", [actionId, combo ? [combo] : []], "asai", (out, err) => {
            if (err) console.warn("nexnotch: setting the shortcut failed:", err);
            load();
        });
    }

    Component.onCompleted: load()
    /* changed elsewhere (System Settings) while we're open */
    property int _sub: DBus.connectSignal("session", "org.kde.kglobalaccel", "/kglobalaccel",
                                          "org.kde.KGlobalAccel", "yourShortcutGotChanged")
    Component.onDestruction: DBus.disconnectSignal(_sub)
    Connections {
        target: DBus
        function onSignalReceived(id, member, args) {
            if (id === page._sub && args[0]?.[0] === "nexnotch") page.load();
        }
    }

    KQC.KeySequenceItem {
        id: keys
        Kirigami.FormData.label: "Toggle the notch:"
        enabled: page.loaded
        multiKeyShortcutsAllowed: false
        checkForConflictsAgainst: KQC.ShortcutType.GlobalShortcuts | KQC.ShortcutType.StandardShortcuts
        /* QKeySequence ↔ int converts through the property type */
        property int combo: keySequence
        onKeySequenceModified: page.save(combo)
    }
    SettingsHint { text: "Expands or collapses the notch. The default is Meta+N." }

    QQC2.Button {
        Kirigami.FormData.label: "All shortcuts:"
        text: "Open System Settings…"
        icon.name: "preferences-desktop-keyboard-shortcut"
        onClicked: {
            if (!Sys.runDetached(["systemsettings", "kcm_keys"]))
                Sys.runDetached(["kcmshell6", "kcm_keys"]);
        }
    }
    SettingsHint { text: "Search for NexNotch there to see or change it alongside the rest." }

    SettingsHint {
        Kirigami.FormData.label: "From a script:"
        text: "<i>nexnotch-kde --toggle</i>, <i>--settings</i> or <i>--quit</i> act on the running notch."
    }
}
