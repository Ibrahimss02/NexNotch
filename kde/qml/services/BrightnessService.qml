import QtQuick

/* Screen and keyboard backlight through PowerDevil: org.kde.ScreenBrightness
   (internal panel first, else the first display, e.g. a DDC/CI monitor) and
   its keyboard brightness action. -1 = not there.
   CONTRACT: brightness 0..1 + setBrightness(v), keyboard 0..1 + setKeyboard(v),
   osd(icon, level, maxLevel, label) for changes made elsewhere while
   Config.replaceOsd. Plasma's own brightness OSD has no switch of its own
   (only plasmarc [OSD] Enabled, which silences every Plasma OSD), so it
   still shows beside ours. */
QtObject {
    id: root

    property real brightness: -1
    property real keyboard: -1
    property string displayLabel: ""
    signal osd(string icon, real level, real maxLevel, string label)

    readonly property string svc: "org.kde.ScreenBrightness"
    readonly property string kbSvc: "org.kde.Solid.PowerManagement"
    readonly property string kbPath: "/org/kde/Solid/PowerManagement/Actions/KeyboardBrightnessControl"
    readonly property string kbIface: "org.kde.Solid.PowerManagement.Actions.KeyboardBrightnessControl"
    /* our own changes carry this context, so they show no OSD; flag 1 suppresses Plasma's */
    readonly property string context: "nexnotch"

    property string _display: ""        // D-Bus name, e.g. "display0"
    property int _max: 0
    property int _kbMax: 0
    property bool _settled: false
    property Timer _settle: Timer { interval: 2000; running: true; onTriggered: root._settled = true }

    function _path(name) { return `/org/kde/ScreenBrightness/${name}`; }

    function _pickDisplay() {
        DBus.getProperty("session", svc, "/org/kde/ScreenBrightness", svc, "DisplaysDBusNames", (names, err) => {
            if (!names?.length) { _display = ""; brightness = -1; return; }
            let pending = names.length, chosen = null;
            for (const name of names) {
                DBus.getAll("session", svc, _path(name), "org.kde.ScreenBrightness.Display", props => {
                    if (props && (!chosen || (props.IsInternal && !chosen.props.IsInternal))) chosen = {name, props};
                    if (--pending > 0 || !chosen) return;
                    _display = chosen.name;
                    _max = chosen.props.MaxBrightness ?? 0;
                    displayLabel = chosen.props.Label ?? "";
                    brightness = _max > 0 ? chosen.props.Brightness / _max : -1;
                });
            }
        });
    }

    /* a slider sends a stream of values; DDC/CI monitors are slow, so pass
       on at most one every 60 ms, always ending on the last */
    property real _pendingScreen: -1
    property real _pendingKb: -1
    property Timer _throttle: Timer {
        interval: 60
        onTriggered: {
            if (root._pendingScreen >= 0 && root._display)
                DBus.call("session", root.svc, root._path(root._display), "org.kde.ScreenBrightness.Display", "SetBrightnessWithContext",
                          [Math.round(root._pendingScreen * root._max), 1, root.context], "ius");
            if (root._pendingKb >= 0)
                DBus.call("session", root.kbSvc, root.kbPath, root.kbIface, "setKeyboardBrightnessSilent", [Math.round(root._pendingKb * root._kbMax)], "i");
            root._pendingScreen = root._pendingKb = -1;
        }
    }
    function setBrightness(v) {
        if (brightness < 0 || _max <= 0) return;
        brightness = Math.max(0, Math.min(1, v));
        _pendingScreen = brightness;
        if (!_throttle.running) _throttle.start();
    }
    function setKeyboard(v) {
        if (keyboard < 0 || _kbMax <= 0) return;
        keyboard = Math.max(0, Math.min(1, v));
        _pendingKb = keyboard;
        _ownKbUntil = Date.now() + 600;
        if (!_throttle.running) _throttle.start();
    }

    function _readKeyboard() {
        DBus.call("session", kbSvc, kbPath, kbIface, "keyboardBrightnessMax", [], "", (out, err) => {
            _kbMax = out?.[0] ?? 0;
            if (err || _kbMax <= 0) { keyboard = -1; return; }
            DBus.call("session", kbSvc, kbPath, kbIface, "keyboardBrightness", [], "", (cur) => {
                keyboard = (cur?.[0] ?? 0) / _kbMax;
            });
        });
    }

    property double _ownKbUntil: 0
    property int _sigChanged: 0
    property int _sigRange: 0
    property int _sigAdded: 0
    property int _sigRemoved: 0
    property int _sigKb: 0
    property int _sigKbMax: 0
    property Connections _dbus: Connections {
        target: DBus
        function onSignalReceived(id, member, args) {
            if (id === root._sigChanged && args[0] === root._display) {
                root.brightness = root._max > 0 ? args[1] / root._max : -1;
                if (root._settled && Config.replaceOsd && args[3] !== root.context)
                    root.osd("brightness-high-symbolic", root.brightness, 1, root.displayLabel);
            } else if (id === root._sigRange && args[0] === root._display) {
                root._max = args[1];
                root.brightness = root._max > 0 ? args[2] / root._max : -1;
            } else if (id === root._sigAdded || id === root._sigRemoved) {
                root._pickDisplay();
            } else if (id === root._sigKb) {
                if (root._kbMax <= 0) { root._readKeyboard(); return; }
                root.keyboard = args[0] / root._kbMax;
                if (root._settled && Config.replaceOsd && Date.now() >= root._ownKbUntil)
                    root.osd("input-keyboard-symbolic", root.keyboard, 1, "Keyboard");
            } else if (id === root._sigKbMax) {
                root._kbMax = args[0];
            }
        }
        function onNameOwnerChanged(name, owner) {
            if (name === root.svc && owner) root._pickDisplay();
            if (name === root.kbSvc && owner) root._readKeyboard();
        }
    }

    Component.onCompleted: {
        const iface = "org.kde.ScreenBrightness";
        _sigChanged = DBus.connectSignal("session", svc, "/org/kde/ScreenBrightness", iface, "BrightnessChanged");
        _sigRange = DBus.connectSignal("session", svc, "/org/kde/ScreenBrightness", iface, "BrightnessRangeChanged");
        _sigAdded = DBus.connectSignal("session", svc, "/org/kde/ScreenBrightness", iface, "DisplayAdded");
        _sigRemoved = DBus.connectSignal("session", svc, "/org/kde/ScreenBrightness", iface, "DisplayRemoved");
        _sigKb = DBus.connectSignal("session", kbSvc, kbPath, kbIface, "keyboardBrightnessChanged");
        _sigKbMax = DBus.connectSignal("session", kbSvc, kbPath, kbIface, "keyboardBrightnessMaxChanged");
        DBus.watchName("session", svc);
        DBus.watchName("session", kbSvc);
        _pickDisplay();
        _readKeyboard();
    }
}
