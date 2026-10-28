#include "sys.h"
#include "windows.h"

#include <KGlobalAccel>
#include <KSignalHandler>

#include <QAction>
#include <QApplication>
#include <QCommandLineParser>
#include <QDBusConnection>
#include <QDBusConnectionInterface>
#include <QDBusMessage>
#include <QIcon>
#include <QQmlApplicationEngine>
#include <QQuickStyle>
#include <QQuickWindow>

#include <csignal>

static const QString SERVICE = QStringLiteral("io.nexvar.NexNotch");

/* io.nexvar.NexNotch /App: how a second `nexnotch-kde --toggle`, a custom
   shortcut or a test script drives the running notch */
class AppService : public QObject
{
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "io.nexvar.NexNotch")
public:
    using QObject::QObject;
public Q_SLOTS:
    Q_SCRIPTABLE void Toggle() { Q_EMIT Sys::instance()->toggleRequested(); }
    Q_SCRIPTABLE void Command(const QString &name, const QString &arg) { Q_EMIT Sys::instance()->commandReceived(name, arg); }
    Q_SCRIPTABLE void Quit() { qApp->quit(); }
};

int main(int argc, char *argv[])
{
    QApplication::setDesktopFileName(SERVICE);
    QApplication app(argc, argv);
    app.setApplicationName(QStringLiteral("nexnotch"));
    app.setOrganizationName(QStringLiteral("nexnotch"));
    app.setApplicationDisplayName(QStringLiteral("NexNotch"));
    app.setApplicationVersion(QStringLiteral(NEXNOTCH_VERSION));
    app.setWindowIcon(QIcon::fromTheme(SERVICE, QIcon::fromTheme(QStringLiteral("preferences-desktop-notification"))));
    app.setQuitOnLastWindowClosed(false);

    /* logout, pkill or Ctrl+C: quit normally, so Plasma's popups, its volume
       OSD and the KWin script are handed back rather than left switched off */
    for (int sig : {SIGTERM, SIGINT, SIGHUP}) KSignalHandler::self()->watchSignal(sig);
    QObject::connect(KSignalHandler::self(), &KSignalHandler::signalReceived, &app, &QCoreApplication::quit);

    QCommandLineParser parser;
    parser.setApplicationDescription(QStringLiteral("Dynamic Island for KDE Plasma"));
    parser.addHelpOption();
    parser.addVersionOption();
    parser.addOptions({
        {QStringLiteral("toggle"), QStringLiteral("Expand or collapse the running notch.")},
        {QStringLiteral("settings"), QStringLiteral("Open the settings window.")},
        {QStringLiteral("quit"), QStringLiteral("Quit the running notch.")},
        {QStringLiteral("command"), QStringLiteral("Send a command (expand, collapse, tab, screenshot, peek…) to the running notch."), QStringLiteral("name")},
        {QStringLiteral("arg"), QStringLiteral("Argument for --command."), QStringLiteral("value")},
        {QStringLiteral("test"), QStringLiteral("Run beside the real notch (no shortcut, no single instance); for development.")},
    });
    parser.process(app);
    const bool test = parser.isSet(QStringLiteral("test"));

    QDBusConnection bus = QDBusConnection::sessionBus();
    const bool forward = parser.isSet(QStringLiteral("toggle")) || parser.isSet(QStringLiteral("settings"))
        || parser.isSet(QStringLiteral("quit")) || parser.isSet(QStringLiteral("command"));
    if (!test && bus.interface()->isServiceRegistered(SERVICE)) {
        /* already running: pass the request on */
        QDBusMessage msg;
        if (parser.isSet(QStringLiteral("quit")))
            msg = QDBusMessage::createMethodCall(SERVICE, QStringLiteral("/App"), SERVICE, QStringLiteral("Quit"));
        else if (parser.isSet(QStringLiteral("toggle")))
            msg = QDBusMessage::createMethodCall(SERVICE, QStringLiteral("/App"), SERVICE, QStringLiteral("Toggle"));
        else {
            msg = QDBusMessage::createMethodCall(SERVICE, QStringLiteral("/App"), SERVICE, QStringLiteral("Command"));
            msg.setArguments({parser.isSet(QStringLiteral("settings")) ? QStringLiteral("settings") : parser.value(QStringLiteral("command")),
                              parser.value(QStringLiteral("arg"))});
        }
        bus.call(msg, QDBus::Block, 3000);
        return 0;
    }
    if (parser.isSet(QStringLiteral("quit")) || parser.isSet(QStringLiteral("toggle"))) return 0;

    if (!test) {
        bus.registerObject(QStringLiteral("/App"), new AppService(&app), QDBusConnection::ExportScriptableSlots);
        if (!bus.registerService(SERVICE)) qWarning() << "nexnotch: could not own" << SERVICE;

        /* remappable in System Settings → Shortcuts → NexNotch */
        auto *toggle = new QAction(QStringLiteral("Toggle the notch"), &app);
        toggle->setObjectName(QStringLiteral("toggle-notch"));
        toggle->setProperty("componentName", QStringLiteral("nexnotch"));
        toggle->setProperty("componentDisplayName", QStringLiteral("NexNotch"));
        KGlobalAccel::self()->setDefaultShortcut(toggle, {QKeySequence(Qt::META | Qt::Key_N)});
        KGlobalAccel::self()->setShortcut(toggle, {QKeySequence(Qt::META | Qt::Key_N)});
        QObject::connect(toggle, &QAction::triggered, Sys::instance(), &Sys::toggleRequested);

        /* window titles feed meeting detection from the start, not from the first QML lookup */
        Windows::instance()->start();
    }

    /* the notch draws its own controls; the settings window uses Plasma's style */
    QQuickStyle::setStyle(QStringLiteral("org.kde.desktop"));
    QQuickStyle::setFallbackStyle(QStringLiteral("Fusion"));

    QQmlApplicationEngine engine;
    engine.setInitialProperties({
        {QStringLiteral("testMode"), test},
        {QStringLiteral("openSettings"), parser.isSet(QStringLiteral("settings"))},
        {QStringLiteral("startCommand"), parser.value(QStringLiteral("command"))},
        {QStringLiteral("startArg"), parser.value(QStringLiteral("arg"))},
    });
    QObject::connect(&engine, &QQmlApplicationEngine::objectCreationFailed, &app, []() { QCoreApplication::exit(1); }, Qt::QueuedConnection);
    engine.loadFromModule("NexNotch", "Main");
    return app.exec();
}

#include "main.moc"
