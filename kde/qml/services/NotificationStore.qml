import QtQuick

/* Notification history and the feed that drives the peeks. Plasma keeps its
   own history too; this one is what the notch shows, newest first. Entries
   leave when the user dismisses them or the app withdraws them — not when a
   popup merely times out. */
QtObject {
    id: root
    readonly property int maxRows: 50
    property var items: []          // [{id, appName, appIcon, summary, body, actions, image, desktopEntry, time, …}]
    property var _selfClosed: ({})  // ids NexNotch closed for auto-dismiss: keep them in history

    signal peek(var n)

    readonly property bool suppress: Config.showNotifications && Config.notifSuppressNative
    onSuppressChanged: Notifications.suppressPopups = suppress
    Component.onCompleted: Notifications.suppressPopups = suppress

    property Connections _feed: Connections {
        target: Notifications
        function onNotified(n) {
            const list = root.items.filter(i => i.id !== n.id && i.id !== n.replaces);
            if (!n.transient) list.unshift(n);
            root.items = list.slice(0, root.maxRows);
            root.peek(n);
            /* the native popup is gone after notif-auto-dismiss seconds; critical ones stay */
            if (Config.notifAutoDismiss > 0 && n.urgency !== 2 && !Config.notifSuppressNative)
                root._autoClose(n.id, Config.notifAutoDismiss * 1000);
        }
        function onClosed(id, reason) {
            if (reason !== 2 && reason !== 3) return;
            if (root._selfClosed[id]) { delete root._selfClosed[id]; return; }
            root.items = root.items.filter(i => i.id !== id);
        }
    }

    function _autoClose(id, ms) {
        const t = Qt.createQmlObject("import QtQuick; Timer { repeat: false }", root);
        t.interval = ms;
        t.triggered.connect(() => {
            if (root.items.some(i => i.id === id)) { root._selfClosed[id] = true; Notifications.close(id); }
            t.destroy();
        });
        t.start();
    }

    /* click: the notification's default action, else bring its app forward */
    function activate(n) {
        if (n.actions?.some(a => a.key === "default")) Notifications.invokeAction(n.id, "default");
        else if (n.desktopEntry) {
            const before = Windows.windows.length;
            Windows.activateApp(n.desktopEntry);
            if (!Windows.available || !before) Sys.launchApp(n.desktopEntry);
        }
        dismiss(n.id);
    }

    function invoke(n, key) {
        Notifications.invokeAction(n.id, key);
        dismiss(n.id);
    }

    function dismiss(id) {
        root.items = root.items.filter(i => i.id !== id);
        Notifications.close(id);
    }

    function clear() {
        for (const i of root.items) Notifications.close(i.id);
        root.items = [];
    }

    /* "14:05" today, "3 Oct" before */
    function timeLabel(ms) {
        const t = new Date(ms), now = new Date();
        return t.toDateString() === now.toDateString()
            ? t.toLocaleTimeString(Qt.locale(), Config.clockFormat === "12h" ? "h:mm AP" : "HH:mm")
            : t.toLocaleDateString(Qt.locale(), "d MMM");
    }

    /* icon for a notification: its image, the app's icon, or a bell */
    function iconFor(n) {
        if (n.appIcon) return n.appIcon;
        if (n.desktopEntry) {
            const app = Sys.appInfo(n.desktopEntry);
            if (app.icon) return app.icon;
        }
        return "preferences-desktop-notification-symbolic";
    }
}
