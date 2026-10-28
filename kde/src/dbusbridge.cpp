#include "dbusbridge.h"

#include <QDBusArgument>
#include <QDBusConnectionInterface>
#include <QDBusMetaType>
#include <QDBusObjectPath>
#include <QDBusPendingCallWatcher>
#include <QDBusPendingReply>
#include <QDBusServiceWatcher>
#include <QDBusSignature>
#include <QDBusVariant>
#include <QGuiApplication>
#include <QJSEngine>

static DBus *s_instance = nullptr;

static QDBusConnection busFor(const QString &bus)
{
    return bus == QLatin1String("system") ? QDBusConnection::systemBus() : QDBusConnection::sessionBus();
}

/* one complete type from a signature: "a{sv}u" → "a{sv}" */
static QString nextType(const QString &sig, int &pos)
{
    const int start = pos;
    if (pos >= sig.size()) return {};
    const QChar c = sig.at(pos++);
    if (c == QLatin1Char('a')) {
        nextType(sig, pos);
    } else if (c == QLatin1Char('(') || c == QLatin1Char('{')) {
        const QChar close = c == QLatin1Char('(') ? QLatin1Char(')') : QLatin1Char('}');
        while (pos < sig.size() && sig.at(pos) != close) nextType(sig, pos);
        pos++;
    }
    return sig.mid(start, pos - start);
}

static QStringList splitSignature(const QString &sig)
{
    QStringList out;
    int pos = 0;
    while (pos < sig.size()) out.append(nextType(sig, pos));
    return out;
}

/* JS value → a QVariant QtDBus marshals as `sig` */
QVariant DBus::fromJs(const QVariant &value, const QString &sig)
{
    QVariant v = value;
    if (v.metaType() == QMetaType::fromType<QJSValue>()) v = v.value<QJSValue>().toVariant();
    if (sig.isEmpty()) return v;
    switch (sig.at(0).unicode()) {
    case 'y': return QVariant::fromValue(uchar(v.toUInt()));
    case 'b': return v.toBool();
    case 'n': return QVariant::fromValue(short(v.toInt()));
    case 'q': return QVariant::fromValue(ushort(v.toUInt()));
    case 'i': return v.toInt();
    case 'u': return v.toUInt();
    case 'x': return v.toLongLong();
    case 't': return v.toULongLong();
    case 'd': return v.toDouble();
    case 's': return v.toString();
    case 'o': return QVariant::fromValue(QDBusObjectPath(v.toString()));
    case 'g': return QVariant::fromValue(QDBusSignature(v.toString()));
    case 'v': {
        /* {type: "u", value: 3} picks the inner type; otherwise guessed */
        const QVariantMap m = v.toMap();
        if (v.metaType().id() == QMetaType::QVariantMap && m.contains(QStringLiteral("type")) && m.contains(QStringLiteral("value")))
            return QVariant::fromValue(QDBusVariant(fromJs(m.value(QStringLiteral("value")), m.value(QStringLiteral("type")).toString())));
        if (v.metaType().id() == QMetaType::Double) {
            const double d = v.toDouble();
            if (d == double(qint64(d))) return QVariant::fromValue(QDBusVariant(int(d)));
        }
        return QVariant::fromValue(QDBusVariant(v));
    }
    case 'a': {
        const QString inner = sig.mid(1);
        if (inner == QLatin1String("s")) return v.toStringList();
        if (inner == QLatin1String("y")) return v.toByteArray();
        if (inner.startsWith(QLatin1Char('{'))) {
            int pos = 1;
            const QString keySig = nextType(inner, pos);
            const QString valSig = nextType(inner, pos);
            const QVariantMap m = v.toMap();
            if (keySig == QLatin1String("s") && valSig == QLatin1String("v")) {
                QVariantMap out;
                for (auto it = m.cbegin(); it != m.cend(); ++it) out.insert(it.key(), fromJs(it.value(), QStringLiteral("v")).value<QDBusVariant>().variant());
                return out;
            }
            if (keySig == QLatin1String("s") && valSig == QLatin1String("s")) {
                QMap<QString, QString> out;
                for (auto it = m.cbegin(); it != m.cend(); ++it) out.insert(it.key(), it.value().toString());
                return QVariant::fromValue(out);
            }
            return m;
        }
        if (inner == QLatin1String("o")) {
            QList<QDBusObjectPath> out;
            for (const QVariant &e : v.toList()) out.append(QDBusObjectPath(e.toString()));
            return QVariant::fromValue(out);
        }
        if (inner == QLatin1String("u")) {
            QList<uint> out;
            for (const QVariant &e : v.toList()) out.append(e.toUInt());
            return QVariant::fromValue(out);
        }
        if (inner == QLatin1String("i")) {
            QList<int> out;
            for (const QVariant &e : v.toList()) out.append(e.toInt());
            return QVariant::fromValue(out);
        }
        return v.toList();
    }
    }
    return v;
}

static QVariant demarshal(const QDBusArgument &arg);

/* QtDBus values → plain QVariants QML understands */
QVariant DBus::toJs(const QVariant &v)
{
    if (v.metaType() == QMetaType::fromType<QDBusArgument>()) return demarshal(v.value<QDBusArgument>());
    if (v.metaType() == QMetaType::fromType<QDBusVariant>()) return toJs(v.value<QDBusVariant>().variant());
    if (v.metaType() == QMetaType::fromType<QDBusObjectPath>()) return v.value<QDBusObjectPath>().path();
    if (v.metaType() == QMetaType::fromType<QDBusSignature>()) return v.value<QDBusSignature>().signature();
    if (v.metaType().id() == QMetaType::QVariantList) {
        QVariantList out;
        for (const QVariant &e : v.toList()) out.append(toJs(e));
        return out;
    }
    if (v.metaType().id() == QMetaType::QVariantMap) {
        QVariantMap out;
        const QVariantMap m = v.toMap();
        for (auto it = m.cbegin(); it != m.cend(); ++it) out.insert(it.key(), toJs(it.value()));
        return out;
    }
    if (v.metaType().id() == QMetaType::UChar) return int(v.value<uchar>());
    return v;
}

static QVariant demarshal(const QDBusArgument &arg)
{
    switch (arg.currentType()) {
    case QDBusArgument::BasicType:
    case QDBusArgument::VariantType:
        return DBus::toJs(arg.asVariant());
    case QDBusArgument::ArrayType: {
        if (arg.currentSignature() == QLatin1String("ay")) {
            QByteArray bytes;
            arg >> bytes;
            return bytes;
        }
        QVariantList out;
        arg.beginArray();
        while (!arg.atEnd()) out.append(demarshal(arg));
        arg.endArray();
        return out;
    }
    case QDBusArgument::MapType: {
        QVariantMap out;
        arg.beginMap();
        while (!arg.atEnd()) {
            arg.beginMapEntry();
            const QVariant key = demarshal(arg);
            const QVariant val = demarshal(arg);
            arg.endMapEntry();
            out.insert(key.toString(), val);
        }
        arg.endMap();
        return out;
    }
    case QDBusArgument::StructureType: {
        QVariantList out;
        arg.beginStructure();
        while (!arg.atEnd()) out.append(demarshal(arg));
        arg.endStructure();
        return out;
    }
    default:
        return {};
    }
}

DBus::DBus(QObject *parent)
    : QObject(parent)
{
    s_instance = this;
}

DBus *DBus::create(QQmlEngine *, QJSEngine *)
{
    QJSEngine::setObjectOwnership(instance(), QJSEngine::CppOwnership);
    return instance();
}

DBus *DBus::instance()
{
    if (!s_instance) new DBus(qApp);
    return s_instance;
}

static void deliver(const QJSValue &callback, const QDBusMessage &reply)
{
    if (!callback.isCallable()) return;
    QJSValue cb = callback;
    QJSEngine *engine = qjsEngine(DBus::instance());
    if (!engine) return;
    if (reply.type() == QDBusMessage::ErrorMessage) {
        cb.call({QJSValue(), reply.errorName() + QStringLiteral(": ") + reply.errorMessage()});
        return;
    }
    QVariantList out;
    for (const QVariant &a : reply.arguments()) out.append(DBus::toJs(a));
    cb.call({engine->toScriptValue(out)});
}

void DBus::call(const QString &bus, const QString &service, const QString &path, const QString &iface,
                const QString &method, const QVariantList &args, const QString &signature,
                const QJSValue &callback, int timeoutMs)
{
    QDBusMessage msg = QDBusMessage::createMethodCall(service, path, iface, method);
    const QStringList types = splitSignature(signature);
    QVariantList converted;
    for (int i = 0; i < args.size(); i++) converted.append(fromJs(args.at(i), types.value(i)));
    msg.setArguments(converted);
    const QDBusPendingCall pending = busFor(bus).asyncCall(msg, timeoutMs);
    auto *watcher = new QDBusPendingCallWatcher(pending, this);
    connect(watcher, &QDBusPendingCallWatcher::finished, this, [callback](QDBusPendingCallWatcher *w) {
        deliver(callback, w->reply());
        w->deleteLater();
    });
}

/* Get / GetAll reply with one variant: hand back its value, not [value] */
static void callFirst(DBus *self, const QString &bus, QDBusMessage msg, const QJSValue &callback)
{
    auto *watcher = new QDBusPendingCallWatcher(busFor(bus).asyncCall(msg, 5000), self);
    QObject::connect(watcher, &QDBusPendingCallWatcher::finished, self, [callback](QDBusPendingCallWatcher *w) {
        const QDBusMessage reply = w->reply();
        w->deleteLater();
        QJSEngine *engine = qjsEngine(DBus::instance());
        if (!callback.isCallable() || !engine) return;
        QJSValue cb = callback;
        if (reply.type() == QDBusMessage::ErrorMessage) {
            cb.call({QJSValue(), reply.errorName() + QStringLiteral(": ") + reply.errorMessage()});
            return;
        }
        cb.call({engine->toScriptValue(DBus::toJs(reply.arguments().value(0)))});
    });
}

void DBus::getProperty(const QString &bus, const QString &service, const QString &path, const QString &iface,
                       const QString &name, const QJSValue &callback)
{
    QDBusMessage msg = QDBusMessage::createMethodCall(service, path, QStringLiteral("org.freedesktop.DBus.Properties"), QStringLiteral("Get"));
    msg.setArguments({iface, name});
    callFirst(this, bus, msg, callback);
}

void DBus::getAll(const QString &bus, const QString &service, const QString &path, const QString &iface,
                  const QJSValue &callback)
{
    QDBusMessage msg = QDBusMessage::createMethodCall(service, path, QStringLiteral("org.freedesktop.DBus.Properties"), QStringLiteral("GetAll"));
    msg.setArguments({iface});
    callFirst(this, bus, msg, callback);
}

void DBus::setProperty(const QString &bus, const QString &service, const QString &path, const QString &iface,
                       const QString &name, const QVariant &value, const QString &signature, const QJSValue &callback)
{
    call(bus, service, path, QStringLiteral("org.freedesktop.DBus.Properties"), QStringLiteral("Set"),
         {iface, name, QVariantMap{{QStringLiteral("type"), signature}, {QStringLiteral("value"), value}}},
         QStringLiteral("ssv"), callback);
}

/* receives one subscription's signals and forwards them with its id */
class SignalRelay : public QObject
{
    Q_OBJECT
public:
    SignalRelay(int id, DBus *bridge)
        : QObject(bridge), m_id(id), m_bridge(bridge) {}
public Q_SLOTS:
    void handle(const QDBusMessage &msg)
    {
        QVariantList out;
        for (const QVariant &a : msg.arguments()) out.append(DBus::toJs(a));
        Q_EMIT m_bridge->signalReceived(m_id, msg.member(), out, msg.path());
    }
private:
    int m_id;
    DBus *m_bridge;
};

int DBus::connectSignal(const QString &bus, const QString &service, const QString &path,
                        const QString &iface, const QString &name)
{
    const int id = m_nextId++;
    auto *relay = new SignalRelay(id, this);
    busFor(bus).connect(service, path, iface, name, relay, SLOT(handle(QDBusMessage)));
    m_subs.insert(id, {bus, service, path, iface, name, relay});
    return id;
}

void DBus::disconnectSignal(int id)
{
    const Sub s = m_subs.take(id);
    if (!s.receiver) return;
    busFor(s.bus).disconnect(s.service, s.path, s.iface, s.name, s.receiver, SLOT(handle(QDBusMessage)));
    s.receiver->deleteLater();
}

void DBus::watchName(const QString &bus, const QString &name)
{
    auto *watcher = new QDBusServiceWatcher(name, busFor(bus), QDBusServiceWatcher::WatchForOwnerChange, this);
    connect(watcher, &QDBusServiceWatcher::serviceOwnerChanged, this,
            [this](const QString &n, const QString &, const QString &owner) { Q_EMIT nameOwnerChanged(n, owner); });
    const auto reply = busFor(bus).interface()->serviceOwner(name);
    const QString owner = reply.isValid() ? reply.value() : QString();
    QMetaObject::invokeMethod(this, [this, name, owner]() { Q_EMIT nameOwnerChanged(name, owner); }, Qt::QueuedConnection);
}

#include "dbusbridge.moc"
