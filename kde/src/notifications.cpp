#include "notifications.h"
#include "dbusbridge.h"
#include "sys.h"

#include <KConfigGroup>
#include <KConfigWatcher>
#include <KSharedConfig>

#include <QDBusArgument>
#include <QDBusConnection>
#include <QDBusConnectionInterface>
#include <QDBusMessage>
#include <QDBusServiceWatcher>
#include <QDateTime>
#include <QDir>
#include <QGuiApplication>
#include <QImage>
#include <QJSEngine>
#include <QUrl>

static const QString SERVICE = QStringLiteral("org.freedesktop.Notifications");
static const QString PATH = QStringLiteral("/org/freedesktop/Notifications");
static const QString IFACE = QStringLiteral("org.freedesktop.Notifications");
static const QString KDE_IFACE = QStringLiteral("org.kde.NotificationManager");

/* what Plasma calls on watchers; taken whole so signature changes can't break it */
class WatcherObject : public QDBusVirtualObject
{
public:
    explicit WatcherObject(Notifications *owner)
        : QDBusVirtualObject(owner), m_owner(owner) {}

    QString introspect(const QString &) const override
    {
        return QStringLiteral(
            "<interface name=\"org.kde.NotificationWatcher\">"
            "<method name=\"Notify\"><arg type=\"u\"/><arg type=\"s\"/><arg type=\"u\"/><arg type=\"s\"/>"
            "<arg type=\"s\"/><arg type=\"s\"/><arg type=\"as\"/><arg type=\"a{sv}\"/><arg type=\"i\"/></method>"
            "<method name=\"CloseNotification\"><arg type=\"u\"/></method>"
            "</interface>");
    }

    bool handleMessage(const QDBusMessage &msg, const QDBusConnection &conn) override
    {
        if (msg.member() == QLatin1String("Notify")) m_owner->handleNotify(msg.arguments());
        else if (msg.member() == QLatin1String("CloseNotification")) m_owner->handleClose(msg.arguments().value(0).toUInt());
        else return false;
        if (!msg.isReplyRequired()) return true;
        conn.send(msg.createReply());
        return true;
    }

private:
    Notifications *m_owner;
};

Notifications::Notifications(QObject *parent)
    : QObject(parent)
{
    QDBusConnection bus = QDBusConnection::sessionBus();
    m_object = new WatcherObject(this);
    bus.registerVirtualObject(QStringLiteral("/NotificationWatcher"), m_object);

    /* plasmashell restarting drops its watcher list: register again */
    auto *watcher = new QDBusServiceWatcher(SERVICE, bus, QDBusServiceWatcher::WatchForOwnerChange, this);
    connect(watcher, &QDBusServiceWatcher::serviceOwnerChanged, this, [this](const QString &, const QString &, const QString &owner) {
        m_cookie = 0;
        if (owner.isEmpty()) {
            m_connected = false;
            Q_EMIT connectedChanged();
            return;
        }
        registerWatcher();
        applyInhibit();
    });
    bus.connect(SERVICE, PATH, IFACE, QStringLiteral("NotificationClosed"), this, SLOT(handleClosedSignal(uint, uint)));
    registerWatcher();

    auto config = KSharedConfig::openConfig(QStringLiteral("plasmanotifyrc"));
    m_configWatcher = KConfigWatcher::create(config);
    connect(m_configWatcher.data(), &KConfigWatcher::configChanged, this, [this](const KConfigGroup &group) {
        if (group.name() == QLatin1String("DoNotDisturb")) readDnd();
    });
    readDnd();
}

Notifications::~Notifications()
{
    if (m_cookie) {
        QDBusMessage msg = QDBusMessage::createMethodCall(SERVICE, PATH, IFACE, QStringLiteral("UnInhibit"));
        msg.setArguments({m_cookie});
        QDBusConnection::sessionBus().call(msg, QDBus::Block, 500);
    }
    QDBusMessage msg = QDBusMessage::createMethodCall(SERVICE, PATH, KDE_IFACE, QStringLiteral("UnRegisterWatcher"));
    QDBusConnection::sessionBus().call(msg, QDBus::Block, 500);
}

Notifications *Notifications::create(QQmlEngine *, QJSEngine *)
{
    static Notifications *instance = new Notifications(qApp);
    QJSEngine::setObjectOwnership(instance, QJSEngine::CppOwnership);
    return instance;
}

void Notifications::registerWatcher()
{
    QDBusMessage msg = QDBusMessage::createMethodCall(SERVICE, PATH, KDE_IFACE, QStringLiteral("RegisterWatcher"));
    auto *w = new QDBusPendingCallWatcher(QDBusConnection::sessionBus().asyncCall(msg), this);
    connect(w, &QDBusPendingCallWatcher::finished, this, [this](QDBusPendingCallWatcher *w) {
        const bool ok = !w->isError();
        if (!ok) qWarning() << "nexnotch: RegisterWatcher failed:" << w->error().message();
        w->deleteLater();
        if (ok != m_connected) {
            m_connected = ok;
            Q_EMIT connectedChanged();
        }
    });
}

/* the freedesktop image-data hint: (iiibiiay) width, height, rowstride, alpha, bps, channels, data */
static QString saveImageData(const QVariant &hint, uint id)
{
    if (hint.metaType() != QMetaType::fromType<QDBusArgument>()) return {};
    const QDBusArgument arg = hint.value<QDBusArgument>();
    int w = 0, h = 0, stride = 0, bps = 0, channels = 0;
    bool alpha = false;
    QByteArray data;
    arg.beginStructure();
    arg >> w >> h >> stride >> alpha >> bps >> channels >> data;
    arg.endStructure();
    if (w <= 0 || h <= 0 || bps != 8 || (channels != 3 && channels != 4) || data.size() < stride * (h - 1) + w * channels) return {};
    QImage img(reinterpret_cast<const uchar *>(data.constData()), w, h, stride,
               alpha ? QImage::Format_RGBA8888 : QImage::Format_RGB888);
    const QString dir = Sys::instance()->cacheDir() + QStringLiteral("/notifications");
    QDir().mkpath(dir);
    const QString path = QStringLiteral("%1/%2.png").arg(dir).arg(id);
    if (!img.copy().save(path, "PNG")) return {};
    return QUrl::fromLocalFile(path).toString() + QStringLiteral("?") + QString::number(QDateTime::currentMSecsSinceEpoch());
}

void Notifications::handleNotify(const QVariantList &args)
{
    if (args.size() < 9) return;
    const uint id = args.at(0).toUInt();
    const QStringList rawActions = args.at(6).toStringList();
    QVariantMap hints;
    const QVariant hintsArg = args.at(7);
    if (hintsArg.metaType() == QMetaType::fromType<QDBusArgument>()) {
        /* image-data must be read raw: toJs would turn it into a list */
        const QDBusArgument dbusHints = hintsArg.value<QDBusArgument>();
        dbusHints.beginMap();
        while (!dbusHints.atEnd()) {
            QString key;
            QDBusVariant value;
            dbusHints.beginMapEntry();
            dbusHints >> key >> value;
            dbusHints.endMapEntry();
            hints.insert(key, value.variant());
        }
        dbusHints.endMap();
    } else {
        hints = hintsArg.toMap();
    }

    QVariantList actions;
    for (int i = 0; i + 1 < rawActions.size(); i += 2)
        actions.append(QVariantMap{{QStringLiteral("key"), rawActions.at(i)}, {QStringLiteral("label"), rawActions.at(i + 1)}});

    QString image;
    for (const char *key : {"image-data", "image_data", "icon_data"}) {
        if (hints.contains(QLatin1String(key))) { image = saveImageData(hints.value(QLatin1String(key)), id); break; }
    }
    if (image.isEmpty()) {
        const QString p = hints.value(QStringLiteral("image-path"), hints.value(QStringLiteral("image_path"))).toString();
        if (!p.isEmpty()) image = p.startsWith(QLatin1Char('/')) ? QUrl::fromLocalFile(p).toString() : p;
    }

    const QVariantMap n{
        {QStringLiteral("id"), id},
        {QStringLiteral("appName"), args.at(1).toString()},
        {QStringLiteral("replaces"), args.at(2).toUInt()},
        {QStringLiteral("appIcon"), args.at(3).toString()},
        {QStringLiteral("summary"), args.at(4).toString()},
        {QStringLiteral("body"), args.at(5).toString()},
        {QStringLiteral("actions"), actions},
        {QStringLiteral("image"), image},
        {QStringLiteral("desktopEntry"), hints.value(QStringLiteral("desktop-entry")).toString()},
        {QStringLiteral("urgency"), hints.value(QStringLiteral("urgency"), 1).toInt()},
        {QStringLiteral("category"), hints.value(QStringLiteral("category")).toString()},
        {QStringLiteral("transient"), hints.value(QStringLiteral("transient")).toBool()},
        {QStringLiteral("urls"), hints.value(QStringLiteral("x-kde-urls")).toStringList()},
        {QStringLiteral("timeout"), args.at(8).toInt()},
        {QStringLiteral("time"), QDateTime::currentMSecsSinceEpoch()},
    };
    Q_EMIT notified(n);
}

void Notifications::handleClose(uint id) { Q_EMIT closed(id, 0); }

void Notifications::invokeAction(uint id, const QString &key)
{
    QDBusMessage msg = QDBusMessage::createMethodCall(SERVICE, PATH, KDE_IFACE, QStringLiteral("InvokeAction"));
    msg.setArguments({id, key});
    QDBusConnection::sessionBus().asyncCall(msg);
}

void Notifications::close(uint id)
{
    QDBusMessage msg = QDBusMessage::createMethodCall(SERVICE, PATH, IFACE, QStringLiteral("CloseNotification"));
    msg.setArguments({id});
    QDBusConnection::sessionBus().asyncCall(msg);
}

void Notifications::setSuppressPopups(bool on)
{
    if (on == m_suppress) return;
    m_suppress = on;
    applyInhibit();
    Q_EMIT suppressPopupsChanged();
}

/* Plasma's popups stay quiet while an app holds an inhibition; the history
   and NexNotch's watcher feed still get every notification. */
void Notifications::applyInhibit()
{
    QDBusConnection bus = QDBusConnection::sessionBus();
    if (m_suppress && !m_cookie) {
        QDBusMessage msg = QDBusMessage::createMethodCall(SERVICE, PATH, IFACE, QStringLiteral("Inhibit"));
        msg.setArguments({QStringLiteral("io.nexvar.NexNotch"), QStringLiteral("Notifications are shown in the notch"), QVariantMap()});
        auto *w = new QDBusPendingCallWatcher(bus.asyncCall(msg), this);
        connect(w, &QDBusPendingCallWatcher::finished, this, [this](QDBusPendingCallWatcher *w) {
            QDBusPendingReply<uint> reply = *w;
            if (!reply.isError()) m_cookie = reply.value();
            w->deleteLater();
            if (!m_suppress) applyInhibit();   // turned off meanwhile
        });
    } else if (!m_suppress && m_cookie) {
        QDBusMessage msg = QDBusMessage::createMethodCall(SERVICE, PATH, IFACE, QStringLiteral("UnInhibit"));
        msg.setArguments({m_cookie});
        bus.asyncCall(msg);
        m_cookie = 0;
    }
}

void Notifications::readDnd()
{
    auto config = KSharedConfig::openConfig(QStringLiteral("plasmanotifyrc"));
    config->reparseConfiguration();
    const QDateTime until = config->group(QStringLiteral("DoNotDisturb")).readEntry(QStringLiteral("Until"), QDateTime());
    const bool on = until.isValid() && until > QDateTime::currentDateTime();
    if (on != m_dnd) {
        m_dnd = on;
        Q_EMIT doNotDisturbChanged();
    }
}

void Notifications::setDoNotDisturb(bool on)
{
    auto config = KSharedConfig::openConfig(QStringLiteral("plasmanotifyrc"));
    KConfigGroup group = config->group(QStringLiteral("DoNotDisturb"));
    /* what Plasma's own "until turned off" writes */
    if (on) group.writeEntry(QStringLiteral("Until"), QDateTime::currentDateTime().addYears(1), KConfig::Notify);
    else group.revertToDefault(QStringLiteral("Until"), KConfig::Notify);
    config->sync();
    readDnd();
}
