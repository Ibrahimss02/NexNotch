#include "sys.h"

#include <KApplicationTrader>
#include <KIO/ApplicationLauncherJob>
#include <KModifierKeyInfo>
#include <KService>

#include <QClipboard>
#include <QCryptographicHash>
#include <QDesktopServices>
#include <QDir>
#include <QElapsedTimer>
#include <QFile>
#include <QFileInfo>
#include <QGuiApplication>
#include <QImage>
#include <QJSEngine>
#include <QMimeData>
#include <QMimeDatabase>
#include <QNetworkReply>
#include <QProcess>
#include <QQmlEngine>
#include <QSaveFile>
#include <QStandardPaths>
#include <QStorageInfo>
#include <QSysInfo>
#include <QUrl>
#include <QtConcurrent>
#include <cmath>

static Sys *s_instance = nullptr;
static QElapsedTimer s_clock;

Sys::Sys(QObject *parent)
    : QObject(parent)
{
    s_instance = this;
    s_clock.start();
    m_keys = new KModifierKeyInfo(this);
    connect(m_keys, &KModifierKeyInfo::keyLocked, this, [this](Qt::Key key, bool) {
        if (key == Qt::Key_CapsLock) Q_EMIT capsLockChanged();
    });
    connect(&m_watcher, &QFileSystemWatcher::fileChanged, this, [this](const QString &path) {
        /* editors and KConfig replace the file: watch the new one */
        if (!m_watcher.files().contains(path) && QFile::exists(path)) m_watcher.addPath(path);
        Q_EMIT fileChanged(path);
    });
    m_cameraTimer.setInterval(3000);
    connect(&m_cameraTimer, &QTimer::timeout, this, &Sys::scanCamera);
    m_net.setTransferTimeout(15000);
}

Sys *Sys::create(QQmlEngine *, QJSEngine *)
{
    QJSEngine::setObjectOwnership(instance(), QJSEngine::CppOwnership);
    return instance();
}

Sys *Sys::instance()
{
    if (!s_instance) new Sys(qApp);
    return s_instance;
}

QString Sys::home() const { return QDir::homePath(); }

QString Sys::configDir() const
{
    return QStandardPaths::writableLocation(QStandardPaths::GenericConfigLocation) + QStringLiteral("/nexnotch");
}

QString Sys::cacheDir() const
{
    return QStandardPaths::writableLocation(QStandardPaths::GenericCacheLocation) + QStringLiteral("/nexnotch");
}

QString Sys::dataDir() const
{
    return QStandardPaths::writableLocation(QStandardPaths::GenericDataLocation) + QStringLiteral("/nexnotch");
}

bool Sys::capsLock() const { return m_keys->isKeyLocked(Qt::Key_CapsLock); }

QString Sys::toLocalPath(const QString &pathOrUrl) const
{
    if (pathOrUrl.startsWith(QLatin1String("file:"))) return QUrl(pathOrUrl).toLocalFile();
    if (pathOrUrl.startsWith(QLatin1String("~/"))) return home() + pathOrUrl.mid(1);
    return pathOrUrl;
}

QString Sys::toUrl(const QString &path) const
{
    return QUrl::fromLocalFile(toLocalPath(path)).toString();
}

QVariant Sys::readFile(const QString &path) const
{
    QFile f(toLocalPath(path));
    if (!f.open(QIODevice::ReadOnly)) return QVariant();
    return QString::fromUtf8(f.readAll());
}

bool Sys::writeFile(const QString &path, const QString &text) const
{
    const QString local = toLocalPath(path);
    QDir().mkpath(QFileInfo(local).absolutePath());
    QSaveFile f(local);
    if (!f.open(QIODevice::WriteOnly)) return false;
    f.write(text.toUtf8());
    return f.commit();
}

bool Sys::exists(const QString &path) const { return QFileInfo::exists(toLocalPath(path)); }
bool Sys::mkdir(const QString &path) const { return QDir().mkpath(toLocalPath(path)); }

bool Sys::remove(const QString &path) const
{
    const QFileInfo fi(toLocalPath(path));
    if (fi.isDir()) return QDir(fi.absoluteFilePath()).removeRecursively();
    return QFile::remove(fi.absoluteFilePath());
}

bool Sys::trash(const QString &path) const { return QFile::moveToTrash(toLocalPath(path)); }

QVariantMap Sys::fileInfo(const QString &pathOrUrl) const
{
    const QFileInfo fi(toLocalPath(pathOrUrl));
    if (!fi.exists()) return {{QStringLiteral("exists"), false}};
    static QMimeDatabase mimes;
    const QMimeType mime = mimes.mimeTypeForFile(fi);
    return {
        {QStringLiteral("exists"), true},
        {QStringLiteral("path"), fi.absoluteFilePath()},
        {QStringLiteral("url"), QUrl::fromLocalFile(fi.absoluteFilePath()).toString()},
        {QStringLiteral("name"), fi.fileName()},
        {QStringLiteral("isDir"), fi.isDir()},
        {QStringLiteral("size"), fi.size()},
        {QStringLiteral("mtime"), fi.lastModified().toMSecsSinceEpoch()},
        {QStringLiteral("mime"), mime.name()},
        {QStringLiteral("icon"), mime.iconName()},
    };
}

QVariantList Sys::listDir(const QString &path) const
{
    QVariantList out;
    const QDir dir(toLocalPath(path));
    for (const QFileInfo &fi : dir.entryInfoList(QDir::AllEntries | QDir::NoDotAndDotDot, QDir::Name)) {
        out.append(QVariantMap{
            {QStringLiteral("name"), fi.fileName()},
            {QStringLiteral("path"), fi.absoluteFilePath()},
            {QStringLiteral("isDir"), fi.isDir()},
            {QStringLiteral("size"), fi.size()},
            {QStringLiteral("mtime"), fi.lastModified().toMSecsSinceEpoch()},
        });
    }
    return out;
}

void Sys::watchFile(const QString &path)
{
    const QString local = toLocalPath(path);
    if (!m_watcher.files().contains(local) && QFile::exists(local)) m_watcher.addPath(local);
}

void Sys::run(const QStringList &argv, const QJSValue &callback)
{
    if (argv.isEmpty()) return;
    auto *proc = new QProcess(this);
    connect(proc, &QProcess::finished, this, [proc, callback](int code, QProcess::ExitStatus status) {
        if (callback.isCallable()) {
            QJSValue cb = callback;
            cb.call({status == QProcess::NormalExit ? code : -1,
                     QString::fromUtf8(proc->readAllStandardOutput()),
                     QString::fromUtf8(proc->readAllStandardError())});
        }
        proc->deleteLater();
    });
    connect(proc, &QProcess::errorOccurred, this, [proc, callback](QProcess::ProcessError err) {
        if (err != QProcess::FailedToStart) return;
        if (callback.isCallable()) {
            QJSValue cb = callback;
            cb.call({-1, QString(), proc->errorString()});
        }
        proc->deleteLater();
    });
    proc->start(argv.first(), argv.mid(1));
}

bool Sys::runDetached(const QStringList &argv) const
{
    if (argv.isEmpty()) return false;
    return QProcess::startDetached(argv.first(), argv.mid(1));
}

bool Sys::hasProgram(const QString &name) const
{
    return !QStandardPaths::findExecutable(name).isEmpty();
}

void Sys::openUrl(const QString &url) const
{
    QDesktopServices::openUrl(url.contains(QLatin1String("://")) ? QUrl(url) : QUrl::fromLocalFile(toLocalPath(url)));
}

void Sys::download(const QString &url, const QString &path, const QJSValue &callback)
{
    QNetworkRequest req{QUrl(url)};
    req.setHeader(QNetworkRequest::UserAgentHeader, QStringLiteral("NexNotch/%1 (KDE)").arg(version()));
    QNetworkReply *reply = m_net.get(req);
    const QString local = toLocalPath(path);
    connect(reply, &QNetworkReply::finished, this, [reply, local, callback]() {
        bool ok = false;
        if (reply->error() == QNetworkReply::NoError) {
            QDir().mkpath(QFileInfo(local).absolutePath());
            QSaveFile f(local);
            if (f.open(QIODevice::WriteOnly)) {
                f.write(reply->readAll());
                ok = f.commit();
            }
        }
        if (callback.isCallable()) {
            QJSValue cb = callback;
            cb.call({ok});
        }
        reply->deleteLater();
    });
}

/* XMLHttpRequest can't set a User-Agent or send PATCH reliably; this can. */
void Sys::http(const QString &method, const QString &url, const QVariantMap &headers,
               const QString &body, const QJSValue &callback)
{
    QNetworkRequest req{QUrl(url)};
    req.setHeader(QNetworkRequest::UserAgentHeader, QStringLiteral("NexNotch/%1 (KDE)").arg(version()));
    for (auto it = headers.cbegin(); it != headers.cend(); ++it)
        req.setRawHeader(it.key().toUtf8(), it.value().toString().toUtf8());
    QNetworkReply *reply = m_net.sendCustomRequest(req, method.toUtf8(), body.toUtf8());
    connect(reply, &QNetworkReply::finished, this, [reply, callback]() {
        if (callback.isCallable()) {
            QJSValue cb = callback;
            cb.call({reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt(),
                     QString::fromUtf8(reply->readAll())});
        }
        reply->deleteLater();
    });
}

QString Sys::hash(const QString &text, const QString &algo) const
{
    const auto a = algo == QLatin1String("md5") ? QCryptographicHash::Md5 : QCryptographicHash::Sha256;
    return QString::fromLatin1(QCryptographicHash::hash(text.toUtf8(), a).toHex());
}

double Sys::monotonicMs() const { return double(s_clock.nsecsElapsed()) / 1e6; }
QString Sys::env(const QString &name) const { return qEnvironmentVariable(name.toUtf8().constData()); }
QString Sys::hostname() const { return QSysInfo::machineHostName(); }

void Sys::setAutostart(bool on) const
{
    const QString path = QStandardPaths::writableLocation(QStandardPaths::GenericConfigLocation)
        + QStringLiteral("/autostart/io.nexvar.NexNotch.desktop");
    if (!on) { QFile::remove(path); return; }
    writeFile(path, QStringLiteral(
        "[Desktop Entry]\nType=Application\nName=NexNotch\nComment=Dynamic Island for KDE Plasma\n"
        "Exec=%1\nIcon=io.nexvar.NexNotch\nX-KDE-autostart-phase=2\nX-GNOME-Autostart-enabled=true\nNoDisplay=true\n")
        .arg(QCoreApplication::applicationFilePath()));
}

void Sys::copyText(const QString &text) const { QGuiApplication::clipboard()->setText(text); }

void Sys::copyFiles(const QStringList &urls) const
{
    auto *data = new QMimeData;
    QList<QUrl> list;
    QByteArray gnome = "copy";
    for (const QString &u : urls) {
        const QUrl url = u.contains(QLatin1String("://")) ? QUrl(u) : QUrl::fromLocalFile(u);
        list.append(url);
        gnome += '\n' + url.toEncoded();
    }
    data->setUrls(list);
    /* file managers (Dolphin, Nautilus) paste files from these */
    data->setData(QStringLiteral("x-special/gnome-copied-files"), gnome);
    data->setData(QStringLiteral("application/x-kde-cutselection"), "0");
    QGuiApplication::clipboard()->setMimeData(data);
}

static KService::Ptr findService(const QString &desktopId)
{
    if (desktopId.isEmpty()) return {};
    QString id = desktopId;
    if (id.endsWith(QLatin1String(".desktop"))) id.chop(8);
    KService::Ptr s = KService::serviceByDesktopName(id);
    if (!s) s = KService::serviceByDesktopName(id.toLower());
    if (!s) s = KService::serviceByStorageId(id);
    if (!s) {
        /* "spotify" → "com.spotify.Client" and the like */
        const auto all = KApplicationTrader::query([&id](const KService::Ptr &svc) {
            return svc->desktopEntryName().endsWith(QLatin1Char('.') + id.toLower())
                || svc->exec().section(QLatin1Char(' '), 0, 0).endsWith(QLatin1Char('/') + id.toLower())
                || svc->exec().section(QLatin1Char(' '), 0, 0) == id.toLower();
        });
        if (!all.isEmpty()) s = all.first();
    }
    return s;
}

QVariantMap Sys::appInfo(const QString &desktopId) const
{
    const KService::Ptr s = findService(desktopId);
    if (!s) return {};
    return {
        {QStringLiteral("id"), s->desktopEntryName()},
        {QStringLiteral("name"), s->name()},
        {QStringLiteral("icon"), s->icon()},
        {QStringLiteral("exec"), s->exec()},
    };
}

bool Sys::launchApp(const QString &desktopId) const
{
    const KService::Ptr s = findService(desktopId);
    if (!s) return false;
    auto *job = new KIO::ApplicationLauncherJob(s);
    job->start();
    return true;
}

QString Sys::mimeIcon(const QString &pathOrUrl) const
{
    static QMimeDatabase mimes;
    return mimes.mimeTypeForFile(toLocalPath(pathOrUrl)).iconName();
}

/* Mounts come from /proc/self/mounts rather than QStorageInfo::mountedVolumes(),
   so only /dev/ filesystems are ever statted — a dead network mount would hang.
   btrfs subvolumes and bind mounts share a device and are counted once. */
QVariantMap Sys::storageInfo() const
{
    QFile mounts(QStringLiteral("/proc/self/mounts"));
    if (!mounts.open(QIODevice::ReadOnly)) return {};
    QSet<QString> seen;
    qint64 total = 0, used = 0;
    for (const QByteArray &line : mounts.readAll().split('\n')) {
        const QList<QByteArray> f = line.split(' ');
        if (f.size() < 2 || !f[0].startsWith("/dev/") || f[0].startsWith("/dev/loop")) continue;
        const QString device = QString::fromUtf8(f[0]);
        if (seen.contains(device)) continue;
        seen.insert(device);
        /* mount points escape spaces as \040 */
        const QStorageInfo info(QString::fromUtf8(f[1]).replace(QLatin1String("\\040"), QLatin1String(" ")));
        if (!info.isValid() || !info.isReady()) continue;
        total += info.bytesTotal();
        used += info.bytesTotal() - info.bytesFree();
    }
    return {{QStringLiteral("total"), total}, {QStringLiteral("used"), used}};
}

/* keep the hue, force enough saturation and lightness to read on dark */
static QString readable(double r, double g, double b)
{
    const double mx = std::max({r, g, b}), mn = std::min({r, g, b}), d = mx - mn;
    double h = 0;
    if (d > 0) h = mx == r ? std::fmod((g - b) / d, 6.0) : mx == g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = std::fmod(h * 60 + 360, 360);
    const double l = std::min(0.72, std::max(0.6, (mx + mn) / 2));
    double denom = 1 - std::abs(mx + mn - 1);
    if (denom == 0) denom = 1;
    const double sl = std::max(0.6, d / denom);
    const double c = (1 - std::abs(2 * l - 1)) * std::min(1.0, sl);
    const double x = c * (1 - std::abs(std::fmod(h / 60, 2) - 1)), m = l - c / 2;
    double r1, g1, b1;
    if (h < 60) { r1 = c; g1 = x; b1 = 0; }
    else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
    else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
    else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
    else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
    else { r1 = c; g1 = 0; b1 = x; }
    return QColor::fromRgbF(r1 + m, g1 + m, b1 + m).name();
}

QVariant Sys::coverColors(const QString &pathOrUrl)
{
    const QString path = toLocalPath(pathOrUrl);
    if (m_coverCache.contains(path)) return m_coverCache.value(path);
    QVariant result;
    QImage img(path);
    if (!img.isNull()) {
        const QImage small = img.scaled(24, 24, Qt::IgnoreAspectRatio, Qt::SmoothTransformation).convertToFormat(QImage::Format_RGB32);
        const QString dir = cacheDir() + QStringLiteral("/art");
        QDir().mkpath(dir);
        const QString blur = dir + QLatin1Char('/') + hash(path, QStringLiteral("md5")) + QStringLiteral("-bg.png");
        if (!QFile::exists(blur)) {
            /* whole cover squeezed to the card's 3:1, upscaled in doublings for a smooth blur */
            QImage pb = small.scaled(12, 12, Qt::IgnoreAspectRatio, Qt::SmoothTransformation);
            int w = 12, h = 12;
            while (w < 576 || h < 192) {
                w = std::min(576, w * 2);
                h = std::min(192, h * 2);
                pb = pb.scaled(w, h, Qt::IgnoreAspectRatio, Qt::SmoothTransformation);
            }
            pb.save(blur, "PNG");
        }
        double best[3] = {0, 0, 0}, bestScore = -1;
        for (int y = 0; y < small.height(); y++) {
            for (int x = 0; x < small.width(); x++) {
                const QRgb px = small.pixel(x, y);
                const double r = qRed(px) / 255.0, g = qGreen(px) / 255.0, b = qBlue(px) / 255.0;
                const double mx = std::max({r, g, b}), mn = std::min({r, g, b});
                const double sat = mx > 0 ? (mx - mn) / mx : 0;
                const double score = sat * mx * (mx > 0.15 ? 1 : 0);
                if (score > bestScore) { bestScore = score; best[0] = r; best[1] = g; best[2] = b; }
            }
        }
        result = QVariantMap{
            {QStringLiteral("blur"), QUrl::fromLocalFile(blur).toString()},
            {QStringLiteral("accent"), bestScore > 0.12 ? readable(best[0], best[1], best[2]) : QVariant()},
        };
    }
    m_coverCache.insert(path, result);
    return result;
}

void Sys::setWatchCamera(bool on)
{
    if (on == m_cameraTimer.isActive()) return;
    if (on) { m_cameraTimer.start(); scanCamera(); }
    else m_cameraTimer.stop();
    Q_EMIT watchCameraChanged();
}

/* No portal or Plasma API says "the camera is on", so look for a process of
   ours holding /dev/video* open — the same thing `fuser` does. Off the main
   thread: /proc walks take a few milliseconds. */
void Sys::scanCamera()
{
    if (m_scanning) return;
    m_scanning = true;
    auto future = QtConcurrent::run([]() {
        const QDir proc(QStringLiteral("/proc"));
        const QString self = QString::number(QCoreApplication::applicationPid());
        for (const QString &pid : proc.entryList(QDir::Dirs | QDir::NoDotAndDotDot)) {
            if (!pid.front().isDigit() || pid == self) continue;
            const QDir fds(QStringLiteral("/proc/%1/fd").arg(pid));
            for (const QFileInfo &fd : fds.entryInfoList(QDir::System | QDir::NoDotAndDotDot)) {
                if (fd.symLinkTarget().startsWith(QLatin1String("/dev/video"))) return true;
            }
        }
        return false;
    });
    auto *watcher = new QFutureWatcher<bool>(this);
    connect(watcher, &QFutureWatcher<bool>::finished, this, [this, watcher]() {
        m_scanning = false;
        const bool on = watcher->result();
        watcher->deleteLater();
        if (on != m_camera) {
            m_camera = on;
            Q_EMIT cameraActiveChanged();
        }
    });
    watcher->setFuture(future);
}
