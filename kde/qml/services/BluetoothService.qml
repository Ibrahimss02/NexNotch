import QtQuick
import org.kde.bluezqt as BluezQt

/* Bluetooth through BluezQt, as Plasma's Bluetooth widget does it: the
   switch unblocks the radio and powers the adapters; paired devices
   connect and disconnect from the list. */
QtObject {
    id: root

    readonly property var manager: BluezQt.Manager
    readonly property bool available: manager.adapters.length > 0
    readonly property bool enabled: manager.bluetoothOperational
    /* [{address, name, icon, connected, busy, battery (-1 = unknown)}], connected first */
    property var devices: []
    readonly property var connectedDevices: devices.filter(d => d.connected)
    property var _busy: ({})            // address -> true while a (dis)connect runs

    function setEnabled(on) {
        manager.bluetoothBlocked = !on;
        for (const a of manager.adapters) a.powered = on;
    }

    function deviceIcon(d) {
        switch (d.type) {
        case BluezQt.Device.Headset: return "audio-headset-symbolic";
        case BluezQt.Device.Headphones: return "audio-headphones-symbolic";
        case BluezQt.Device.AudioVideo: return "audio-speakers-symbolic";
        case BluezQt.Device.Keyboard: return "input-keyboard-symbolic";
        case BluezQt.Device.Mouse: return "input-mouse-symbolic";
        case BluezQt.Device.Joypad: return "input-gamepad-symbolic";
        case BluezQt.Device.Tablet: return "input-tablet-symbolic";
        case BluezQt.Device.Phone: return "smartphone-symbolic";
        case BluezQt.Device.Computer: return "computer-symbolic";
        case BluezQt.Device.Printer: return "printer-symbolic";
        case BluezQt.Device.Camera: return "camera-photo-symbolic";
        default: return "preferences-system-bluetooth-symbolic";
        }
    }

    function _sync() {
        devices = manager.devices.filter(d => d.paired)
            .map(d => ({
                address: d.address,
                name: d.name,
                icon: deviceIcon(d),
                connected: d.connected,
                busy: !!_busy[d.address],
                battery: d.battery ? d.battery.percentage : -1,
            }))
            .sort((a, b) => (b.connected - a.connected) || a.name.localeCompare(b.name));
    }

    function toggleDevice(address) {
        const d = manager.deviceForAddress(address);
        if (!d || _busy[address]) return;
        _setBusy(address, true);
        const call = d.connected ? d.disconnectFromDevice() : d.connectToDevice();
        call.finished.connect(() => _setBusy(address, false));
    }
    function _setBusy(address, on) {
        const b = Object.assign({}, _busy);
        if (on) b[address] = true; else delete b[address];
        _busy = b;
        _sync();
    }

    function openSettings() { Sys.runDetached(["systemsettings", "kcm_bluetooth"]); }

    property Connections _manager: Connections {
        target: root.manager
        function onDeviceAdded() { Qt.callLater(root._sync); }
        function onDeviceRemoved() { Qt.callLater(root._sync); }
        function onDeviceChanged() { Qt.callLater(root._sync); }
        function onInitFinished() { Qt.callLater(root._sync); }
    }
    Component.onCompleted: _sync()
}
