#include "windows.h"
#include "sys.h"

#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusPendingCallWatcher>
#include <QDBusPendingReply>
#include <QDir>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QGuiApplication>
#include <QJSEngine>
#include <QTimer>

static const QString KWIN = QStringLiteral("org.kde.KWin");
static const QString SCRIPTING = QStringLiteral("org.kde.kwin.Scripting");
static const QString PLUGIN = QStringLiteral("nexnotch-windows");

/* KWin 6 scripting API; captions change as browsers switch tabs */
/* KWin 6 scripting API. Besides titles (browsers retitle as tabs switch) it
   reports where a window sits against the top of its screen, so the notch
   can float clear of a window that reaches up under it. Only changes are
   sent: a window being dragged would otherwise call once per frame. */
static const char *WATCH_SCRIPT = R"JS(
const sent = {};
function report(w) {
    if (!w.normalWindow || w.skipTaskbar) return;
    const id = w.internalId.toString();
    const g = w.frameGeometry, o = w.output ? w.output.geometry : g;
    const centre = o.x + o.width / 2;
    const shown = !w.minimized
        && (w.onAllDesktops || w.desktops.some(d => d === workspace.currentDesktop))
        && (w.activities.length === 0 || w.activities.includes(workspace.currentActivity));
    /* one JSON argument: callDBus drops arguments past a handful */
    const state = JSON.stringify({title: w.caption || "", appClass: w.resourceClass || "",
        desktopFile: w.desktopFileName || "", pid: w.pid || 0, output: w.output ? w.output.name : "",
        topGap: Math.round(g.y - o.y), spansCentre: g.x <= centre && g.x + g.width >= centre,
        fullScreen: !!w.fullScreen, shown});
    if (sent[id] === state) return;
    sent[id] = state;
    callDBus("io.nexvar.NexNotch", "/Windows", "io.nexvar.NexNotch.Windows", "update", id, state);
}
function track(w) {
    report(w);
    for (const s of [w.captionChanged, w.frameGeometryChanged, w.fullScreenChanged, w.minimizedChanged,
                     w.desktopsChanged, w.activitiesChanged, w.outputChanged])
        if (s) s.connect(() => report(w));
}
workspace.windowList().forEach(track);
workspace.windowAdded.connect(track);
workspace.windowRemoved.connect(w => {
    delete sent[w.internalId.toString()];
    callDBus("io.nexvar.NexNotch", "/Windows", "io.nexvar.NexNotch.Windows", "removed", w.internalId.toString());
});
workspace.currentDesktopChanged.connect(() => workspace.windowList().forEach(report));
workspace.currentActivityChanged.connect(() => workspace.windowList().forEach(report));
)JS";

Windows::Windows(QObject *parent)
    : QObject(parent)
{
}

Windows::~Windows()
{
    QDBusMessage msg = QDBusMessage::createMethodCall(KWIN, QStringLiteral("/Scripting"), SCRIPTING, QStringLiteral("unloadScript"));
    msg.setArguments({PLUGIN});
    QDBusConnection::sessionBus().call(msg, QDBus::Block, 500);
}

Windows *Windows::create(QQmlEngine *, QJSEngine *)
{
    /* started by main() for the real instance only: a --test run must not
       replace the running notch's KWin script */
    QJSEngine::setObjectOwnership(instance(), QJSEngine::CppOwnership);
    return instance();
}

Windows *Windows::instance()
{
    static Windows *w = new Windows(qApp);
    return w;
}

QString Windows::writeScript(const QString &name, const QString &source) const
{
    const QString dir = Sys::instance()->cacheDir() + QStringLiteral("/kwin");
    QDir().mkpath(dir);
    const QString path = dir + QLatin1Char('/') + name + QStringLiteral(".js");
    QFile f(path);
    if (!f.open(QIODevice::WriteOnly | QIODevice::Truncate)) return {};
    f.write(source.toUtf8());
    return path;
}

/* load → run; KWin keeps the watcher alive until it's unloaded */
static void loadAndRun(QObject *ctx, const QString &path, const QString &plugin, std::function<void(bool)> done)
{
    QDBusConnection bus = QDBusConnection::sessionBus();
    QDBusMessage unload = QDBusMessage::createMethodCall(KWIN, QStringLiteral("/Scripting"), SCRIPTING, QStringLiteral("unloadScript"));
    unload.setArguments({plugin});
    bus.call(unload, QDBus::Block, 1000);
    QDBusMessage load = QDBusMessage::createMethodCall(KWIN, QStringLiteral("/Scripting"), SCRIPTING, QStringLiteral("loadScript"));
    load.setArguments({path, plugin});
    auto *w = new QDBusPendingCallWatcher(bus.asyncCall(load), ctx);
    QObject::connect(w, &QDBusPendingCallWatcher::finished, ctx, [done](QDBusPendingCallWatcher *w) {
        QDBusPendingReply<int> reply = *w;
        w->deleteLater();
        if (reply.isError() || reply.value() < 0) {
            qWarning() << "nexnotch: KWin loadScript failed" << reply.error().message();
            done(false);
            return;
        }
        QDBusMessage run = QDBusMessage::createMethodCall(KWIN, QStringLiteral("/Scripting/Script%1").arg(reply.value()),
                                                          QStringLiteral("org.kde.kwin.Script"), QStringLiteral("run"));
        QDBusConnection::sessionBus().asyncCall(run);
        done(true);
    });
}

void Windows::start()
{
    if (m_started) return;
    m_started = true;
    QDBusConnection::sessionBus().registerObject(QStringLiteral("/Windows"), this, QDBusConnection::ExportScriptableSlots);
    const QString path = writeScript(PLUGIN, QString::fromUtf8(WATCH_SCRIPT));
    if (path.isEmpty()) return;
    loadAndRun(this, path, PLUGIN, [this](bool ok) {
        if (ok == m_available) return;
        m_available = ok;
        Q_EMIT availableChanged();
    });
}

QVariantList Windows::windows() const
{
    QVariantList out;
    for (const QString &id : m_order) out.append(m_windows.value(id));
    return out;
}

void Windows::update(const QString &id, const QString &state)
{
    QVariantMap w = QJsonDocument::fromJson(state.toUtf8()).object().toVariantMap();
    if (w.isEmpty()) return;
    w.insert(QStringLiteral("id"), id);
    if (!m_windows.contains(id)) m_order.append(id);
    m_windows.insert(id, w);
    Q_EMIT windowsChanged();
}

void Windows::removed(const QString &id)
{
    if (!m_windows.remove(id)) return;
    m_order.removeAll(id);
    Q_EMIT windowClosed(id);
    Q_EMIT windowsChanged();
}

void Windows::runOneShot(const QString &name, const QString &source)
{
    const QString plugin = QStringLiteral("nexnotch-%1-%2").arg(name).arg(++m_oneShot);
    const QString path = writeScript(QStringLiteral("oneshot"), source);
    if (path.isEmpty()) return;
    loadAndRun(this, path, plugin, [plugin](bool) {
        /* it has run by now; drop it so KWin doesn't keep a pile of them */
        QTimer::singleShot(1500, [plugin]() {
            QDBusMessage unload = QDBusMessage::createMethodCall(KWIN, QStringLiteral("/Scripting"), SCRIPTING, QStringLiteral("unloadScript"));
            unload.setArguments({plugin});
            QDBusConnection::sessionBus().asyncCall(unload);
        });
    });
}

static QString jsString(const QString &s)
{
    QString out = s;
    out.replace(QLatin1Char('\\'), QLatin1String("\\\\")).replace(QLatin1Char('"'), QLatin1String("\\\""))
       .replace(QLatin1Char('\n'), QLatin1String("\\n"));
    return QLatin1Char('"') + out + QLatin1Char('"');
}

void Windows::activate(const QString &id)
{
    runOneShot(QStringLiteral("activate"), QStringLiteral(
        "for (const w of workspace.windowList()) if (w.internalId.toString() === %1) { workspace.activeWindow = w; break; }")
        .arg(jsString(id)));
}

void Windows::activateApp(const QString &app)
{
    const QString needle = app.toLower();
    for (const QString &id : m_order) {
        const QVariantMap w = m_windows.value(id);
        for (const char *key : {"desktopFile", "appClass"}) {
            if (!needle.isEmpty() && w.value(QLatin1String(key)).toString().toLower().contains(needle)) {
                activate(id);
                return;
            }
        }
    }
}
