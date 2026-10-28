import QtQuick

/* The battery from UPower's DisplayDevice (the composite of every laptop
   battery), kept live from its PropertiesChanged, and the charger being
   plugged in or out, which UPower signals the moment it happens.

   CONTRACT:
   battery: null on desktops, else {capacity: 0–100, status: "charging"|"discharging"|"full"|"not charging",
            plugged: bool, timeToEmpty: s, timeToFull: s}
   chargerChanged(info): immediately when the charger is plugged/unplugged (UPower),
            info = {plugged: bool, percentage: number|null, state: "charging"|"discharging"|"full"|"pending"} */
QtObject {
    id: root
    property var battery: null
    signal chargerChanged(var info)

    readonly property string _svc: "org.freedesktop.UPower"
    readonly property string _path: "/org/freedesktop/UPower"
    readonly property string _devPath: "/org/freedesktop/UPower/devices/DisplayDevice"
    readonly property string _devIface: "org.freedesktop.UPower.Device"
    readonly property string _props: "org.freedesktop.DBus.Properties"

    property var _dev: ({})             // the DisplayDevice's properties
    property var _onBattery: undefined  // undefined until the first read, so startup never peeks

    /* UPower device states */
    readonly property var _states: ({1: "charging", 2: "discharging", 3: "discharging", 4: "full", 5: "not charging", 6: "discharging"})

    function _sync() {
        const d = _dev;
        if (!d.IsPresent || d.Type !== 2) { battery = null; return; }   // no battery (desktop, or only a UPS/mouse)
        battery = {
            capacity: Math.round(d.Percentage ?? 0),
            status: _states[d.State] ?? "discharging",
            plugged: _onBattery === false,
            timeToEmpty: Number(d.TimeToEmpty ?? 0),
            timeToFull: Number(d.TimeToFull ?? 0),
        };
    }

    function _readDevice(then) {
        DBus.getAll("system", _svc, _devPath, _devIface, (map, err) => {
            if (err) return;
            _dev = map;
            _sync();
            if (then) then();
        });
    }

    function _setOnBattery(value) {
        if (value === _onBattery) return;
        const first = _onBattery === undefined;
        _onBattery = value;
        _sync();
        if (!first) _settle.restart();
    }

    function _readOnBattery() {
        DBus.getProperty("system", _svc, _path, _svc, "OnBattery", (value, err) => { if (!err) _setOnBattery(value); });
    }

    /* UPower updates State and Percentage a moment after OnBattery flips */
    property Timer _settle: Timer {
        interval: 800
        onTriggered: root._readDevice(() => {
            if (!root.battery) return;
            const s = root._dev.State;
            root.chargerChanged({
                plugged: root._onBattery === false,
                percentage: root._dev.Percentage ?? null,
                state: s === 1 ? "charging" : s === 4 ? "full" : s === 5 ? "pending" : "discharging",
            });
        })
    }

    property int _mainSig: DBus.connectSignal("system", _svc, _path, _props, "PropertiesChanged")
    property int _devSig: DBus.connectSignal("system", _svc, _devPath, _props, "PropertiesChanged")
    property Connections _signals: Connections {
        target: DBus
        function onSignalReceived(id, member, args) {
            if (id === root._mainSig) {
                /* the signal carries the new value, or names it as invalidated */
                if ("OnBattery" in args[1]) root._setOnBattery(args[1].OnBattery);
                else if ((args[2] ?? []).includes("OnBattery")) root._readOnBattery();
            } else if (id === root._devSig) {
                root._dev = Object.assign({}, root._dev, args[1]);
                root._sync();
            }
        }
        /* fires once at startup too, then whenever upowerd restarts */
        function onNameOwnerChanged(name, owner) {
            if (name !== root._svc || !owner) return;
            root._readOnBattery();
            root._readDevice();
        }
    }

    Component.onCompleted: DBus.watchName("system", _svc)
}
