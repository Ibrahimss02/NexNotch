#pragma once

#include <QQmlEngine>
#include <QQuickWindow>
#include <QRect>

/* The notch's surface: a transparent layer-shell window pinned to the top
   centre of the primary screen. Only `inputRect` takes the pointer —
   everywhere else clicks fall through to the windows beneath — and the
   keyboard is taken only while `keyboardFocus` is set (typing a note). */
class NotchWindow : public QQuickWindow
{
    Q_OBJECT
    QML_ELEMENT

    Q_PROPERTY(QRect inputRect READ inputRect WRITE setInputRect NOTIFY inputRectChanged)
    Q_PROPERTY(bool keyboardFocus READ keyboardFocus WRITE setKeyboardFocus NOTIFY keyboardFocusChanged)
    Q_PROPERTY(int exclusiveZone READ exclusiveZone WRITE setExclusiveZone NOTIFY exclusiveZoneChanged)
    Q_PROPERTY(QRect blurRect READ blurRect WRITE setBlurRect NOTIFY blurRectChanged)
    Q_PROPERTY(int blurRadius READ blurRadius WRITE setBlurRadius NOTIFY blurRectChanged)
    Q_PROPERTY(bool layerShell READ layerShell CONSTANT)

public:
    explicit NotchWindow(QWindow *parent = nullptr);

    QRect inputRect() const { return m_input; }
    void setInputRect(const QRect &r);
    bool keyboardFocus() const { return m_keyboard; }
    void setKeyboardFocus(bool on);
    int exclusiveZone() const { return m_zone; }
    void setExclusiveZone(int zone);
    QRect blurRect() const { return m_blur; }
    void setBlurRect(const QRect &r);
    int blurRadius() const { return m_blurRadius; }
    void setBlurRadius(int r);
    bool layerShell() const { return m_layerShell; }

    Q_INVOKABLE bool screenshot(const QString &path);

Q_SIGNALS:
    void inputRectChanged();
    void keyboardFocusChanged();
    void exclusiveZoneChanged();
    void blurRectChanged();

protected:
    bool event(QEvent *e) override;

private:
    void applyMask();
    void applyBlur();

    QRect m_input;
    QRect m_blur;
    int m_blurRadius = 0;
    bool m_keyboard = false;
    int m_zone = 0;
    bool m_layerShell = false;
};
