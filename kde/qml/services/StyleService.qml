import QtQuick

/* Dark Style: flips Plasma's colour scheme between the user's own light
   and dark ones (Breeze Light / Breeze Dark until we've seen theirs). The
   scheme in use is remembered as the light or dark choice before each
   switch, so going back restores exactly what they had. Apps, GTK ones
   included (Plasma syncs those), follow the scheme. */
QtObject {
    id: root

    property bool dark: true
    property string scheme: ""          // the colour scheme in use
    property var schemes: []            // installed ones

    readonly property string _globals: Sys.home + "/.config/kdeglobals"

    /* darkness from the scheme's own window colour, whatever its name */
    function _readDark() {
        const text = String(Sys.readFile(_globals) ?? "");
        const window = text.split(/^\[/m).find(g => g.startsWith("Colors:Window]")) ?? "";
        const m = window.match(/^BackgroundNormal=(\d+),(\d+),(\d+)/m);
        if (m) dark = (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 < 0.5;
    }
    function _readScheme(then) {
        Sys.run(["plasma-apply-colorscheme", "--list-schemes"], (code, out) => {
            const lines = String(out).split("\n").map(l => l.match(/^\s*\*\s+(\S+)(.*)$/)).filter(Boolean);
            schemes = lines.map(m => m[1]);
            scheme = lines.find(m => /current/.test(m[2]))?.[1] ?? scheme;
            then?.();
        });
    }
    function refresh() { _readDark(); _readScheme(); }

    function setDark(on) {
        _readScheme(() => {
            _readDark();
            if (on === dark) return;
            if (scheme) {
                if (dark) Config.darkColorScheme = scheme;
                else Config.lightColorScheme = scheme;
            }
            const own = on ? Config.darkColorScheme : Config.lightColorScheme;
            const target = schemes.includes(own) ? own : on ? "BreezeDark" : "BreezeLight";
            dark = on;
            Sys.run(["plasma-apply-colorscheme", target], () => root.refresh());
        });
    }
    function toggle() { setDark(!dark); }

    /* Plasma announces a new palette over D-Bus; the file watch covers the rest */
    property int _sig: 0
    property Connections _dbus: Connections {
        target: DBus
        function onSignalReceived(id, member, args) { if (id === root._sig && args[0] === 0) root.refresh(); }
    }
    property Connections _file: Connections {
        target: Sys
        function onFileChanged(path) { if (path === root._globals) root._readDark(); }
    }
    Component.onCompleted: {
        _sig = DBus.connectSignal("session", "", "/KGlobalSettings", "org.kde.KGlobalSettings", "notifyChange");
        Sys.watchFile(_globals);
        refresh();
    }
}
