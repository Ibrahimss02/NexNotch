#pragma once

#include <QDBusConnection>
#include <QDBusMessage>
#include <QJSValue>
#include <QObject>
#include <QQmlEngine>

/* Generic D-Bus for QML. Arguments are converted from a signature string
   ("su", "a{sv}", …); replies and signals come back as plain JS values. */
class DBus : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

public:
    explicit DBus(QObject *parent);   // no default: QML must use create(), not a second instance
    static DBus *create(QQmlEngine *, QJSEngine *);
    static DBus *instance();

    /* callback(outArgs: array, error: string|undefined) */
    Q_INVOKABLE void call(const QString &bus, const QString &service, const QString &path,
                          const QString &iface, const QString &method,
                          const QVariantList &args = {}, const QString &signature = {},
                          const QJSValue &callback = QJSValue(), int timeoutMs = 5000);
    Q_INVOKABLE void getProperty(const QString &bus, const QString &service, const QString &path,
                                 const QString &iface, const QString &name, const QJSValue &callback);
    Q_INVOKABLE void getAll(const QString &bus, const QString &service, const QString &path,
                            const QString &iface, const QJSValue &callback);
    Q_INVOKABLE void setProperty(const QString &bus, const QString &service, const QString &path,
                                 const QString &iface, const QString &name, const QVariant &value,
                                 const QString &signature, const QJSValue &callback = QJSValue());

    /* Delivers matching signals as signalReceived(id, member, args, path);
       empty strings match anything. Returns an id for disconnectSignal. */
    Q_INVOKABLE int connectSignal(const QString &bus, const QString &service, const QString &path,
                                  const QString &iface, const QString &name);
    Q_INVOKABLE void disconnectSignal(int id);

    /* nameOwnerChanged(name, owner) whenever it changes; also once now */
    Q_INVOKABLE void watchName(const QString &bus, const QString &name);

    static QVariant toJs(const QVariant &v);
    static QVariant fromJs(const QVariant &v, const QString &sig);

Q_SIGNALS:
    void signalReceived(int id, const QString &member, const QVariantList &args, const QString &path);
    void nameOwnerChanged(const QString &name, const QString &owner);

private:
    struct Sub {
        QString bus, service, path, iface, name;
        QObject *receiver;
    };
    QHash<int, Sub> m_subs;
    int m_nextId = 1;
};
