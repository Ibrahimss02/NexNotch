#pragma once

#include <QHash>
#include <QObject>
#include <QQmlEngine>
#include <QTimeZone>
#include <QVariantMap>
#include <QtQml/qqmlregistration.h>

class QTcpServer;

/* What the calendar needs beyond Sys: the installed-app OAuth loopback flow
   (a one-shot HTTP listener on 127.0.0.1 that catches Google's redirect),
   PKCE helpers, a file only the user can read for the refresh token, and
   time-zone conversion for iCal TZID times (JS has no tz database). */
class OAuth : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

public:
    explicit OAuth(QObject *parent = nullptr);

    /* starts listening on a free 127.0.0.1 port; 0 on failure */
    Q_INVOKABLE int listen();
    Q_INVOKABLE void close();

    /* url-safe random string from `bytes` random bytes; S256 code challenge */
    Q_INVOKABLE QString randomToken(int bytes = 32) const;
    Q_INVOKABLE QString pkceChallenge(const QString &verifier) const;

    /* written atomically with mode 0600 */
    Q_INVOKABLE bool writePrivate(const QString &path, const QString &text) const;

    /* `wallMs` is a wall-clock time encoded as if it were UTC; returns the
       real epoch ms of that wall time in zone `tzid` (IANA, Windows or a
       vendor prefixed id like /mozilla.org/…/Europe/Berlin), NaN if unknown */
    Q_INVOKABLE double zonedToEpoch(const QString &tzid, double wallMs);

Q_SIGNALS:
    /* the redirect's query, e.g. {code, state} or {error} */
    void redirected(const QVariantMap &params);

private:
    QTimeZone zone(const QString &tzid);

    QTcpServer *m_server = nullptr;
    QHash<QString, QTimeZone> m_zones;
};
