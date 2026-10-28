#pragma once

#include <QObject>
#include <QQmlEngine>
#include <QVariant>

/* Window titles for meeting detection, and activating a window. Wayland
   gives clients neither, so a small KWin script reports windows back over
   D-Bus, and activation runs a one-shot script. */
class Windows : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON
    Q_CLASSINFO("D-Bus Interface", "io.nexvar.NexNotch.Windows")

    /* [{id, title, appClass, desktopFile, pid, output (connector name), topGap (px from
       the screen's top edge), spansCentre (covers its screen's centre line), fullScreen,
       shown (not minimized, on the current desktop and activity)}] */
    Q_PROPERTY(QVariantList windows READ windows NOTIFY windowsChanged)
    Q_PROPERTY(bool available READ available NOTIFY availableChanged)

public:
    explicit Windows(QObject *parent);   // no default: QML must use create(), not a second instance
    ~Windows() override;
    static Windows *create(QQmlEngine *, QJSEngine *);
    static Windows *instance();

    QVariantList windows() const;
    bool available() const { return m_available; }

    Q_INVOKABLE void activate(const QString &id);
    /* the first window whose app id / class / desktop file contains `app` */
    Q_INVOKABLE void activateApp(const QString &app);

    void start();

public Q_SLOTS:
    /* state: JSON of the fields listed at `windows` */
    Q_SCRIPTABLE void update(const QString &id, const QString &state);
    Q_SCRIPTABLE void removed(const QString &id);

Q_SIGNALS:
    void windowsChanged();
    void availableChanged();
    void windowClosed(const QString &id);

private:
    void runOneShot(const QString &name, const QString &source);
    QString writeScript(const QString &name, const QString &source) const;

    QHash<QString, QVariantMap> m_windows;
    QStringList m_order;
    bool m_available = false;
    bool m_started = false;
    int m_oneShot = 0;
};
