#pragma once

#include <KConfigWatcher>
#include <QDBusVirtualObject>
#include <QObject>
#include <QQmlEngine>

/* Plasma keeps owning org.freedesktop.Notifications; NexNotch registers as
   one of its watchers (org.kde.NotificationManager.RegisterWatcher, what KDE
   Connect uses). Plasma then forwards every Notify and close to
   /NotificationWatcher here, and lets watchers invoke actions. */
class Notifications : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(bool connected READ connected NOTIFY connectedChanged)
    Q_PROPERTY(bool suppressPopups READ suppressPopups WRITE setSuppressPopups NOTIFY suppressPopupsChanged)
    Q_PROPERTY(bool doNotDisturb READ doNotDisturb NOTIFY doNotDisturbChanged)

public:
    explicit Notifications(QObject *parent);   // no default: QML must use create(), not a second instance
    ~Notifications() override;
    static Notifications *create(QQmlEngine *, QJSEngine *);

    bool connected() const { return m_connected; }
    bool suppressPopups() const { return m_suppress; }
    void setSuppressPopups(bool on);
    bool doNotDisturb() const { return m_dnd; }

    Q_INVOKABLE void invokeAction(uint id, const QString &key);
    Q_INVOKABLE void close(uint id);
    /* Plasma's own Do Not Disturb, the one its bell toggles */
    Q_INVOKABLE void setDoNotDisturb(bool on);

    void handleNotify(const QVariantList &args);
    void handleClose(uint id);

Q_SIGNALS:
    /* n: {id, appName, appIcon, desktopEntry, summary, body, actions:[{key,label}],
           image, urgency, category, timeout, time, replaces} */
    void notified(const QVariantMap &n);
    /* reason: 1 expired, 2 dismissed, 3 closed by the app, 0 unknown (watcher forward) */
    void closed(uint id, uint reason);
    void connectedChanged();
    void suppressPopupsChanged();
    void doNotDisturbChanged();

private Q_SLOTS:
    void handleClosedSignal(uint id, uint reason) { Q_EMIT closed(id, reason); }

private:
    void registerWatcher();
    void applyInhibit();
    void readDnd();

    bool m_connected = false;
    bool m_suppress = false;
    bool m_dnd = false;
    uint m_cookie = 0;
    QDBusVirtualObject *m_object = nullptr;
    KConfigWatcher::Ptr m_configWatcher;
};
