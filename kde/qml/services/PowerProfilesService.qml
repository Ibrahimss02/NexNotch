import QtQuick

/* Power mode from power-profiles-daemon (its UPower name, else the older
   net.hadess one). Changes go through PowerDevil when it's there, as
   Plasma's battery widget does, so PowerDevil keeps its own choice. */
QtObject {
    id: root

    property bool available: false
    property string active: ""                 // "power-saver" | "balanced" | "performance"
    property var profiles: []                  // the ones this machine offers, in that order
    property string degraded: ""               // why performance is held back, if it is
    property string _lastOther: "power-saver"  // the toggle switches between balanced and this

    readonly property var labels: ({"power-saver": "Power Saver", "balanced": "Balanced", "performance": "Performance"})
    readonly property var icons: ({"power-saver": "battery-profile-powersave-symbolic", "balanced": "battery-profile-balanced-symbolic",
                                   "performance": "battery-profile-performance-symbolic"})
    readonly property string label: labels[active] ?? active
    readonly property string icon: icons[active] ?? "battery-profile-balanced-symbolic"

    property var _bus: [
        {name: "org.freedesktop.UPower.PowerProfiles", path: "/org/freedesktop/UPower/PowerProfiles", iface: "org.freedesktop.UPower.PowerProfiles"},
        {name: "net.hadess.PowerProfiles", path: "/net/hadess/PowerProfiles", iface: "net.hadess.PowerProfiles"},
    ]
    property var _ppd: null
    property int _sig: 0

    function setProfile(name) {
        if (!available || name === active) return;
        active = name;
        DBus.call("session", "org.kde.Solid.PowerManagement", "/org/kde/Solid/PowerManagement/Actions/PowerProfile",
                  "org.kde.Solid.PowerManagement.Actions.PowerProfile", "setProfile", [name], "s", (out, err) => {
            if (err && _ppd) DBus.setProperty("system", _ppd.name, _ppd.path, _ppd.iface, "ActiveProfile", name, "s");
        });
    }
    function toggle() { setProfile(active === "balanced" ? _lastOther : "balanced"); }

    function _apply(props) {
        if (props.ActiveProfile !== undefined) {
            active = props.ActiveProfile;
            if (active !== "balanced") _lastOther = active;
        }
        if (props.Profiles !== undefined) {
            const have = props.Profiles.map(p => p.Profile);
            profiles = ["performance", "balanced", "power-saver"].filter(p => have.includes(p));
        }
        if (props.PerformanceDegraded !== undefined) degraded = props.PerformanceDegraded;
    }

    function _connect(i) {
        const b = _bus[i];
        if (!b) { available = false; return; }
        DBus.getAll("system", b.name, b.path, b.iface, (props, err) => {
            if (!props) { _connect(i + 1); return; }
            _ppd = b;
            available = true;
            _apply(props);
            _sig = DBus.connectSignal("system", b.name, b.path, "org.freedesktop.DBus.Properties", "PropertiesChanged");
        });
    }
    property Connections _dbus: Connections {
        target: DBus
        function onSignalReceived(id, member, args) {
            if (id === root._sig && args[0] === root._ppd?.iface) root._apply(args[1]);
        }
    }
    Component.onCompleted: _connect(0)
}
