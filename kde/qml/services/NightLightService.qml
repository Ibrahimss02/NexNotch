import QtQuick

/* KWin's Night Light. The switch is its "Active" setting in kwinrc, which
   KWin picks up as soon as it's written with --notify, the same thing the
   Night Light settings page changes. */
QtObject {
    id: root

    property bool available: false
    property bool enabled: false
    property bool running: false        // tinting right now (not daytime)
    property bool inhibited: false      // paused, e.g. from Plasma's widget
    property int temperature: 6500

    readonly property string svc: "org.kde.KWin"
    readonly property string path: "/org/kde/KWin/NightLight"
    readonly property string iface: "org.kde.KWin.NightLight"

    function setEnabled(on) {
        enabled = on;
        Sys.run(["kwriteconfig6", "--file", "kwinrc", "--group", "NightColor", "--key", "Active", "--notify", "--type", "bool", String(on)]);
    }
    function toggle() { setEnabled(!enabled); }
    function openSettings() { Sys.runDetached(["systemsettings", "kcm_nightlight"]); }

    function _apply(p) {
        if (p.available !== undefined) available = p.available;
        if (p.enabled !== undefined) enabled = p.enabled;
        if (p.running !== undefined) running = p.running;
        if (p.inhibited !== undefined) inhibited = p.inhibited;
        if (p.currentTemperature !== undefined) temperature = p.currentTemperature;
    }
    function _read() { DBus.getAll("session", svc, path, iface, props => { if (props) _apply(props); }); }

    property int _sig: 0
    property Connections _dbus: Connections {
        target: DBus
        function onSignalReceived(id, member, args) {
            if (id === root._sig && args[0] === root.iface) root._apply(args[1]);
        }
        function onNameOwnerChanged(name, owner) { if (name === root.svc && owner) root._read(); }
    }
    Component.onCompleted: {
        _sig = DBus.connectSignal("session", svc, path, "org.freedesktop.DBus.Properties", "PropertiesChanged");
        DBus.watchName("session", svc);
    }
}
