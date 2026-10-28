#include "notchwindow.h"

#include <KWindowEffects>
#include <LayerShellQt/Window>

#include <QGuiApplication>
#include <QPainterPath>
#include <QRegion>
#include <QScreen>

NotchWindow::NotchWindow(QWindow *parent)
    : QQuickWindow(parent)
{
    setColor(Qt::transparent);
    setFlag(Qt::FramelessWindowHint);
    setFlag(Qt::WindowDoesNotAcceptFocus, true);
    m_layerShell = QGuiApplication::platformName() == QLatin1String("wayland");
    if (m_layerShell) {
        auto *ls = LayerShellQt::Window::get(this);
        ls->setScope(QStringLiteral("nexnotch"));
        /* overlay, not top: it must still peek and open over fullscreen windows */
        ls->setLayer(LayerShellQt::Window::LayerOverlay);
        ls->setAnchors(LayerShellQt::Window::AnchorTop);
        ls->setExclusiveZone(0);
        ls->setKeyboardInteractivity(LayerShellQt::Window::KeyboardInteractivityNone);
        ls->setWantsToBeOnActiveScreen(false);
        ls->setScreen(QGuiApplication::primaryScreen());
        ls->setActivateOnShow(false);
    }
    setScreen(QGuiApplication::primaryScreen());
}

void NotchWindow::setInputRect(const QRect &r)
{
    if (r == m_input) return;
    m_input = r;
    applyMask();
    Q_EMIT inputRectChanged();
}

/* On Wayland a window mask is its input region: outside it, pointer events
   go to whatever is below. An empty mask would mean "everything", so a
   hidden notch keeps a 1 px corner. */
void NotchWindow::applyMask()
{
    if (!m_layerShell) return;   // offscreen (screenshots) has no input regions
    setMask(m_input.isValid() ? QRegion(m_input) : QRegion(0, 0, 1, 1));
}

void NotchWindow::setKeyboardFocus(bool on)
{
    if (on == m_keyboard) return;
    m_keyboard = on;
    setFlag(Qt::WindowDoesNotAcceptFocus, !on);
    if (m_layerShell) {
        LayerShellQt::Window::get(this)->setKeyboardInteractivity(
            on ? LayerShellQt::Window::KeyboardInteractivityOnDemand : LayerShellQt::Window::KeyboardInteractivityNone);
        if (on) requestActivate();
    }
    Q_EMIT keyboardFocusChanged();
}

void NotchWindow::setExclusiveZone(int zone)
{
    if (zone == m_zone) return;
    m_zone = zone;
    if (m_layerShell) LayerShellQt::Window::get(this)->setExclusiveZone(zone);
    Q_EMIT exclusiveZoneChanged();
}

void NotchWindow::setBlurRect(const QRect &r)
{
    if (r == m_blur) return;
    m_blur = r;
    applyBlur();
    Q_EMIT blurRectChanged();
}

void NotchWindow::setBlurRadius(int r)
{
    if (r == m_blurRadius) return;
    m_blurRadius = r;
    applyBlur();
    Q_EMIT blurRectChanged();
}

/* KWin blurs behind a translucent notch background; the region follows its
   rounded bottom corners. */
void NotchWindow::applyBlur()
{
    if (!isVisible() || !m_layerShell) return;
    if (!m_blur.isValid()) {
        KWindowEffects::enableBlurBehind(this, false);
        return;
    }
    QPainterPath path;
    const qreal r = qMin<qreal>(m_blurRadius, m_blur.height() / 2.0);
    path.moveTo(m_blur.topLeft());
    path.lineTo(m_blur.topRight());
    path.lineTo(m_blur.right(), m_blur.bottom() - r);
    path.quadTo(m_blur.right(), m_blur.bottom(), m_blur.right() - r, m_blur.bottom());
    path.lineTo(m_blur.left() + r, m_blur.bottom());
    path.quadTo(m_blur.left(), m_blur.bottom(), m_blur.left(), m_blur.bottom() - r);
    path.closeSubpath();
    KWindowEffects::enableBlurBehind(this, true, QRegion(path.toFillPolygon().toPolygon()));
}

bool NotchWindow::event(QEvent *e)
{
    const bool handled = QQuickWindow::event(e);
    if (e->type() == QEvent::Expose && isExposed()) {
        applyMask();
        applyBlur();
    }
    return handled;
}

bool NotchWindow::screenshot(const QString &path)
{
    return grabWindow().save(path);
}
