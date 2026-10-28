#pragma once

#include <QFileSystemWatcher>
#include <QJSValue>
#include <QNetworkAccessManager>
#include <QObject>
#include <QQmlEngine>
#include <QTimer>
#include <QVariant>
#include <QtQml/qqmlregistration.h>

class KModifierKeyInfo;

/* Everything QML can't do by itself: files, processes, downloads, the
   clipboard, app lookups, image work and a few desktop states that have no
   D-Bus API (Caps Lock, camera in use). */
class Sys : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(QString home READ home CONSTANT)
    Q_PROPERTY(QString configDir READ configDir CONSTANT)
    Q_PROPERTY(QString cacheDir READ cacheDir CONSTANT)
    Q_PROPERTY(QString dataDir READ dataDir CONSTANT)
    Q_PROPERTY(QString version READ version CONSTANT)
    Q_PROPERTY(bool capsLock READ capsLock NOTIFY capsLockChanged)
    Q_PROPERTY(bool cameraActive READ cameraActive NOTIFY cameraActiveChanged)
    Q_PROPERTY(bool watchCamera READ watchCamera WRITE setWatchCamera NOTIFY watchCameraChanged)

public:
    explicit Sys(QObject *parent);   // no default: QML must use create(), not a second instance
    static Sys *create(QQmlEngine *, QJSEngine *);
    static Sys *instance();

    QString home() const;
    QString configDir() const;
    QString cacheDir() const;
    QString dataDir() const;
    QString version() const { return QStringLiteral(NEXNOTCH_VERSION); }
    bool capsLock() const;
    bool cameraActive() const { return m_camera; }
    bool watchCamera() const { return m_cameraTimer.isActive(); }
    void setWatchCamera(bool on);

    /* files: null when missing */
    Q_INVOKABLE QVariant readFile(const QString &path) const;
    Q_INVOKABLE bool writeFile(const QString &path, const QString &text) const;
    Q_INVOKABLE bool exists(const QString &path) const;
    Q_INVOKABLE bool mkdir(const QString &path) const;
    Q_INVOKABLE bool remove(const QString &path) const;
    Q_INVOKABLE bool trash(const QString &path) const;
    Q_INVOKABLE QVariantMap fileInfo(const QString &pathOrUrl) const;
    Q_INVOKABLE QVariantList listDir(const QString &path) const;
    Q_INVOKABLE void watchFile(const QString &path);
    Q_INVOKABLE QString toLocalPath(const QString &pathOrUrl) const;
    Q_INVOKABLE QString toUrl(const QString &path) const;

    /* processes: callback(exitCode, stdout, stderr) */
    Q_INVOKABLE void run(const QStringList &argv, const QJSValue &callback = QJSValue());
    Q_INVOKABLE bool runDetached(const QStringList &argv) const;
    Q_INVOKABLE bool hasProgram(const QString &name) const;
    Q_INVOKABLE void openUrl(const QString &url) const;

    /* network: callback(ok) / callback(status, body) */
    Q_INVOKABLE void download(const QString &url, const QString &path, const QJSValue &callback);
    Q_INVOKABLE void http(const QString &method, const QString &url, const QVariantMap &headers,
                          const QString &body, const QJSValue &callback);

    Q_INVOKABLE QString hash(const QString &text, const QString &algo = QStringLiteral("sha256")) const;
    Q_INVOKABLE double monotonicMs() const;
    Q_INVOKABLE QString env(const QString &name) const;
    Q_INVOKABLE QString hostname() const;
    /* ~/.config/autostart entry starting this binary at login */
    Q_INVOKABLE void setAutostart(bool on) const;

    /* clipboard */
    Q_INVOKABLE void copyText(const QString &text) const;
    Q_INVOKABLE void copyFiles(const QStringList &urls) const;

    /* apps: {name, icon, exec} for a desktop id such as "org.kde.elisa" */
    Q_INVOKABLE QVariantMap appInfo(const QString &desktopId) const;
    Q_INVOKABLE bool launchApp(const QString &desktopId) const;
    Q_INVOKABLE QString mimeIcon(const QString &pathOrUrl) const;
    /* {total, used} bytes over local block-device filesystems, each device once */
    Q_INVOKABLE QVariantMap storageInfo() const;

    /* covers: {accent, blur} — a readable accent colour and a heavily
       blurred copy for the player background, cached beside the art */
    Q_INVOKABLE QVariant coverColors(const QString &path);

Q_SIGNALS:
    void capsLockChanged();
    void cameraActiveChanged();
    void watchCameraChanged();
    void fileChanged(const QString &path);
    void toggleRequested();
    void commandReceived(const QString &command, const QString &arg);

private:
    void scanCamera();

    KModifierKeyInfo *m_keys = nullptr;
    QFileSystemWatcher m_watcher;
    QNetworkAccessManager m_net;
    QTimer m_cameraTimer;
    bool m_camera = false;
    bool m_scanning = false;
    QHash<QString, QVariant> m_coverCache;
};
