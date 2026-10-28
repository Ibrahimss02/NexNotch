import QtQuick
import org.kde.kitemmodels as KItemModels
import org.kde.plasma.networkmanagement as PlasmaNM

/* Wi-Fi and airplane mode through plasma-nm, the library behind Plasma's
   network widget: the same network list, the same connect calls, and the
   same airplane mode (Wi-Fi and mobile broadband off, Bluetooth adapters
   powered down; undone the same way).
   CONTRACT: airplaneMode (bool), setAirplaneMode(on). */
QtObject {
    id: root

    /* as Plasma reads it: the switch, while the radios really are off (a
       resume or a manual Wi-Fi switch can turn them back on) */
    readonly property bool airplaneMode: _airplaneFlag && (!wifiEnabled || !wifiHwEnabled)
                                         && (!_enabled.wwanEnabled || !_enabled.wwanHwEnabled)
    property bool _airplaneFlag: false
    readonly property bool wifiAvailable: _devices.wirelessDeviceAvailable
    readonly property bool wifiEnabled: _enabled.wirelessEnabled
    readonly property bool wifiHwEnabled: _enabled.wirelessHwEnabled
    readonly property string ssid: _wireless.wifiSSID
    readonly property bool scanning: _handler.scanning
    /* [{id, name, signal, secure, known, state: "connected"|"connecting"|"", connectionPath, devicePath, specificPath}] */
    property var networks: []

    property PlasmaNM.Handler _handler: PlasmaNM.Handler {}
    property PlasmaNM.EnabledConnections _enabled: PlasmaNM.EnabledConnections {}
    property PlasmaNM.AvailableDevices _devices: PlasmaNM.AvailableDevices {}
    property PlasmaNM.WirelessStatus _wireless: PlasmaNM.WirelessStatus {}
    /* the widget's own sorting: connected first, then known, then by signal */
    property PlasmaNM.AppletProxyModel _model: PlasmaNM.AppletProxyModel { sourceModel: PlasmaNM.NetworkModel {} }

    function setWifiEnabled(on) { _handler.enableWireless(on); }
    function scan() { if (wifiEnabled) _handler.requestScan(""); }

    function _sync() {
        const get = (i, role) => _model.data(_model.index(i, 0), _model.KItemModels.KRoleNames.role(role));
        const list = [];
        for (let i = 0; i < _model.rowCount(); i++) {
            if (get(i, "Type") !== PlasmaNM.Enums.Wireless) continue;
            const state = get(i, "ConnectionState");
            const security = get(i, "SecurityType");
            list.push({
                id: get(i, "ItemUniqueName"),
                name: get(i, "Name"),
                signal: get(i, "Signal") ?? 0,
                secure: security !== PlasmaNM.Enums.NoneSecurity && security !== PlasmaNM.Enums.OWE,
                known: !!get(i, "ConnectionPath"),
                state: state === PlasmaNM.Enums.Activated ? "connected" : state === PlasmaNM.Enums.Activating ? "connecting" : "",
                connectionPath: get(i, "ConnectionPath") ?? "",
                devicePath: get(i, "DevicePath") ?? "",
                specificPath: get(i, "SpecificPath") ?? "",
            });
        }
        if (JSON.stringify(list) !== JSON.stringify(networks)) networks = list;
    }
    property Connections _rows: Connections {
        target: root._model
        function onRowsInserted() { Qt.callLater(root._sync); }
        function onRowsRemoved() { Qt.callLater(root._sync); }
        function onRowsMoved() { Qt.callLater(root._sync); }
        function onDataChanged() { Qt.callLater(root._sync); }
        function onModelReset() { Qt.callLater(root._sync); }
        function onLayoutChanged() { Qt.callLater(root._sync); }
    }

    /* Known and open networks connect right away; a secured network we have
       no password for goes to Plasma's network settings, which ask for it. */
    function activate(net) {
        if (net.state) _handler.deactivateConnection(net.connectionPath, net.devicePath);
        else if (net.known) _handler.activateConnection(net.connectionPath, net.devicePath, net.specificPath);
        else if (!net.secure) _handler.addAndActivateConnection(net.devicePath, net.specificPath);
        else openSettings();
    }
    function openSettings() { Sys.runDetached(["systemsettings", "kcm_networkmanagement"]); }

    /* Plasma keeps the switch in ~/.config/plasma-nm; read it from the file
       so a change made in Plasma's widget shows here too */
    readonly property string _rc: Sys.home + "/.config/plasma-nm"
    function _readAirplane() {
        const text = String(Sys.readFile(_rc) ?? "");
        _airplaneFlag = /^AirplaneModeEnabled=true$/m.test(text);
    }
    function setAirplaneMode(on) {
        _handler.enableAirplaneMode(on);
        PlasmaNM.Configuration.airplaneModeEnabled = on;
        Sys.run(["kwriteconfig6", "--file", "plasma-nm", "--group", "General", "--key", "AirplaneModeEnabled", "--type", "bool", String(on)],
                () => { Sys.watchFile(root._rc); root._readAirplane(); });
        _airplaneFlag = on;
    }
    property Connections _file: Connections {
        target: Sys
        function onFileChanged(path) { if (path === root._rc) root._readAirplane(); }
    }

    Component.onCompleted: {
        _readAirplane();
        Sys.watchFile(_rc);
        _sync();
    }
}
