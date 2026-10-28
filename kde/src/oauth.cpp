#include "oauth.h"

#include <QCryptographicHash>
#include <QDateTime>
#include <QFile>
#include <QRandomGenerator>
#include <QSaveFile>
#include <QTcpServer>
#include <QTcpSocket>
#include <QUrl>
#include <QUrlQuery>
#include <cmath>

OAuth::OAuth(QObject *parent) : QObject(parent) {}

int OAuth::listen()
{
    close();
    m_server = new QTcpServer(this);
    if (!m_server->listen(QHostAddress::LocalHost, 0)) {
        close();
        return 0;
    }
    connect(m_server, &QTcpServer::newConnection, this, [this]() {
        while (QTcpSocket *s = m_server ? m_server->nextPendingConnection() : nullptr) {
            /* outlive the server, which close() deletes before the reply is flushed */
            s->setParent(this);
            connect(s, &QTcpSocket::disconnected, s, &QObject::deleteLater);
            connect(s, &QTcpSocket::readyRead, this, [this, s]() {
                /* only the request line matters; wait until the headers end */
                const QByteArray buf = s->property("buf").toByteArray() + s->readAll();
                s->setProperty("buf", buf);
                if (!buf.contains("\r\n\r\n")) return;
                const QList<QByteArray> line = buf.left(buf.indexOf("\r\n")).split(' ');
                const QUrl url(QString::fromLatin1(line.value(1)));
                const bool isRedirect = url.path() == QLatin1String("/");
                const QByteArray page = isRedirect
                    ? "<!doctype html><meta charset=utf-8><title>NexNotch</title>"
                      "<body style=\"font:16px sans-serif;background:#000;color:#fff;display:grid;place-items:center;height:90vh\">"
                      "<p>NexNotch is signed in. You can close this tab.</p>"
                    : QByteArray();
                s->write((isRedirect ? "HTTP/1.1 200 OK\r\n" : "HTTP/1.1 404 Not Found\r\n")
                         + QByteArray("Content-Type: text/html; charset=utf-8\r\nConnection: close\r\nContent-Length: ")
                         + QByteArray::number(page.size()) + "\r\n\r\n" + page);
                s->disconnectFromHost();
                if (!isRedirect) return;
                QVariantMap params;
                for (const auto &[k, v] : QUrlQuery(url).queryItems(QUrl::FullyDecoded))
                    params.insert(k, v);
                close();
                Q_EMIT redirected(params);
            });
        }
    });
    return m_server->serverPort();
}

void OAuth::close()
{
    if (!m_server) return;
    m_server->close();
    m_server->deleteLater();
    m_server = nullptr;
}

QString OAuth::randomToken(int bytes) const
{
    QByteArray b(qMax(1, bytes), Qt::Uninitialized);
    QRandomGenerator::system()->fillRange(reinterpret_cast<quint32 *>(b.data()), b.size() / 4);
    for (int i = b.size() / 4 * 4; i < b.size(); ++i)
        b[i] = char(QRandomGenerator::system()->generate());
    return QString::fromLatin1(b.toBase64(QByteArray::Base64UrlEncoding | QByteArray::OmitTrailingEquals));
}

QString OAuth::pkceChallenge(const QString &verifier) const
{
    return QString::fromLatin1(QCryptographicHash::hash(verifier.toLatin1(), QCryptographicHash::Sha256)
        .toBase64(QByteArray::Base64UrlEncoding | QByteArray::OmitTrailingEquals));
}

bool OAuth::writePrivate(const QString &path, const QString &text) const
{
    QSaveFile f(path);
    if (!f.open(QIODevice::WriteOnly)) return false;
    f.setPermissions(QFile::ReadOwner | QFile::WriteOwner);
    f.write(text.toUtf8());
    return f.commit();
}

QTimeZone OAuth::zone(const QString &tzid)
{
    const auto hit = m_zones.constFind(tzid);
    if (hit != m_zones.cend()) return *hit;
    QString id = tzid.trimmed();
    if (id.startsWith(QLatin1Char('"'))) id = id.mid(1, id.size() - 2);
    QTimeZone tz(id.toUtf8());
    if (!tz.isValid()) {
        const QByteArray iana = QTimeZone::windowsIdToDefaultIanaId(id.toUtf8());
        if (!iana.isEmpty()) tz = QTimeZone(iana);
    }
    /* "/freeassociation.sourceforge.net/Tzfile/Europe/London": try the
       longest trailing part that is a real zone */
    const QStringList parts = id.split(QLatin1Char('/'), Qt::SkipEmptyParts);
    for (int i = 0; !tz.isValid() && i < parts.size(); ++i)
        tz = QTimeZone(parts.mid(i).join(QLatin1Char('/')).toUtf8());
    m_zones.insert(tzid, tz);
    return tz;
}

double OAuth::zonedToEpoch(const QString &tzid, double wallMs)
{
    const QTimeZone tz = zone(tzid);
    if (!tz.isValid()) return std::nan("");
    const QDateTime wall = QDateTime::fromMSecsSinceEpoch(qint64(wallMs), QTimeZone::UTC);
    return double(QDateTime(wall.date(), wall.time(), tz).toMSecsSinceEpoch());
}
