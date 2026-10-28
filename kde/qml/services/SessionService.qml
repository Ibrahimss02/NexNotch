import QtQuick

/* Lock, suspend, log out, restart, power off. Logging out and shutting down
   go through Plasma's session manager (org.kde.Shutdown), which saves the
   session and closes apps properly, without its own confirmation screen:
   the Quick tab already asks for a second tap. */
QtObject {
    id: root

    property bool canSuspend: true

    readonly property string login1: "org.freedesktop.login1"
    readonly property string login1Path: "/org/freedesktop/login1"
    readonly property string login1Iface: "org.freedesktop.login1.Manager"

    function lock() { DBus.call("session", "org.freedesktop.ScreenSaver", "/ScreenSaver", "org.freedesktop.ScreenSaver", "Lock"); }
    function suspend() { DBus.call("system", login1, login1Path, login1Iface, "Suspend", [true], "b"); }
    function logout() { _shutdown("logout", "TerminateSession"); }
    function reboot() { _shutdown("logoutAndReboot", "Reboot"); }
    function powerOff() { _shutdown("logoutAndShutdown", "PowerOff"); }

    /* without Plasma's session manager, logind does it directly (only then:
       a slow reply means the logout is under way) */
    function _shutdown(method, fallback) {
        DBus.call("session", "org.kde.Shutdown", "/Shutdown", "org.kde.Shutdown", method, [], "", (out, err) => {
            if (!/ServiceUnknown|NameHasNoOwner/.test(err ?? "")) return;
            console.warn("nexnotch: session:", err);
            if (fallback === "TerminateSession") DBus.call("system", login1, login1Path, login1Iface, fallback, [Sys.env("XDG_SESSION_ID")], "s");
            else DBus.call("system", login1, login1Path, login1Iface, fallback, [true], "b");
        });
    }

    Component.onCompleted: DBus.call("system", login1, login1Path, login1Iface, "CanSuspend", [], "", out => {
        canSuspend = ["yes", "challenge"].includes(out?.[0]);
    })
}
