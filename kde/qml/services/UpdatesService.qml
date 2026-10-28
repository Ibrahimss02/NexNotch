import QtQuick

/* Once a day (updates.js), asks GitHub for the latest release and, when it's
   newer than this build, posts a desktop notification about it, once per
   version. Nothing is downloaded or installed. Off with Config.checkUpdates. */
QtObject {
    id: root

    readonly property string repo: "Ibrahimss02/NexNotch"
    readonly property int daySec: 24 * 3600
    property string _releaseUrl: ""
    property int _notifId: 0

    /* "1.10.0" > "1.9.2"; a leading "v" is ignored */
    function isNewer(a, b) {
        const parse = v => String(v).replace(/^v/i, "").split(/[.-]/).map(n => parseInt(n, 10) || 0);
        const [x, y] = [parse(a), parse(b)];
        for (let i = 0; i < Math.max(x.length, y.length); i++)
            if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
        return false;
    }

    /* a minute after start at the soonest, then a day after the last check */
    function schedule() {
        _timer.stop();
        if (!Config.checkUpdates) return;
        const now = Math.floor(Date.now() / 1000);
        _timer.interval = Math.max(60, Config.updateLastCheck + daySec - now) * 1000;
        _timer.start();
    }

    function check() {
        Config.updateLastCheck = Math.floor(Date.now() / 1000);
        Sys.http("GET", `https://api.github.com/repos/${repo}/releases/latest`,
            {"Accept": "application/vnd.github+json"}, "", (status, body) => {
                let release = null;
                try { if (status === 200) release = JSON.parse(body); } catch (e) {}
                const version = String(release?.tag_name ?? "").replace(/^v/i, "");
                if (version && isNewer(version, Sys.version) && Config.updateNotified !== version) {
                    Config.updateNotified = version;
                    _notify(version, release.html_url);
                }
                schedule();
            });
    }

    function _notify(version, url) {
        _releaseUrl = url;
        DBus.call("session", "org.freedesktop.Notifications", "/org/freedesktop/Notifications",
            "org.freedesktop.Notifications", "Notify",
            ["NexNotch", 0, "software-update-available", `NexNotch ${version} is available`,
             `You have ${Sys.version}. Update with git pull && make kde-install in your NexNotch checkout.`,
             ["default", "View release", "view", "View release"], {"desktop-entry": "io.nexvar.NexNotch"}, -1],
            "susssasa{sv}i", (out, err) => {
                if (err) console.warn("nexnotch: update notify:", err);
                else root._notifId = out[0];
            });
    }

    property Timer _timer: Timer {
        onTriggered: root.check()
    }

    /* clicking the notification or its button opens the release page */
    property int _actionSig: DBus.connectSignal("session", "org.freedesktop.Notifications",
        "/org/freedesktop/Notifications", "org.freedesktop.Notifications", "ActionInvoked")
    property Connections _signals: Connections {
        target: DBus
        function onSignalReceived(id, member, args) {
            if (id === root._actionSig && root._notifId && args[0] === root._notifId) Sys.openUrl(root._releaseUrl);
        }
    }

    property Connections _config: Connections {
        target: Config
        function onCheckUpdatesChanged() { root.schedule(); }
    }

    Component.onCompleted: schedule()
}
