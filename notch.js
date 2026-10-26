import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import Soup from 'gi://Soup?version=3.0';
import Graphene from 'gi://Graphene';

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';
import {BarLevel} from 'resource:///org/gnome/shell/ui/barLevel.js';

import {SystemMonitor}    from './modules/system.js';
import {NotificationPeek} from './modules/notifications.js';
import {CalendarPeek}     from './modules/calendar.js';
import {MprisWatcher}     from './modules/mpris.js';
import {Notes}            from './modules/notes.js';
import {NotificationHistory} from './modules/history.js';
import {Weather}          from './modules/weather.js';
import {Pomodoro}         from './modules/pomodoro.js';
import {QuickHub}         from './modules/quick.js';
import {ClaudeUsage}      from './modules/claudeusage.js';
import {Lyrics, lineAt}   from './modules/lyrics.js';
import {PowerWatcher, State as PowerState} from './modules/power.js';
import {WaterReminder, WaterCup} from './modules/water.js';

const HOVER_DELAY_MS    = 180;
const COLLAPSE_DELAY_MS = 300;
const ANIM_MS           = 260;
const PEEK_DURATION_MS  = 4000;
const PEEK_UNHOVER_MS   = 400;
const OSD_MS            = 1500;  // same as GNOME's own OSD
const OSD_SIZE          = [300, 44];
const SLIDE_PX          = 48;    // how far tab content slides on a switch
const PAGE_PX           = 220;   // drag distance per tab; past half of it the tab flips
const FLICK_MS          = 180;   // how far ahead a flick's speed is projected
const MAX_FLICK_TABS    = 3;
const SCROLL_UNIT_PX    = 10;    // Clutter reports touchpad scroll in ~10 px units
const TAB_IDS = ['history', 'system', 'claude', 'calendar', 'notes', 'weather', 'pomodoro', 'quick'];

export const Notch = GObject.registerClass(
class Notch extends St.Widget {
    _init(extension) {
        super._init({
            name: 'nexnotch',
            style_class: 'nexnotch',
            reactive: true,
            track_hover: true,
            can_focus: false,
            layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
        });

        this._extension = extension;
        this._settings  = extension.getSettings();
        this.clip_to_allocation = true;   // swiped tab content must not spill past the background

        this._expanded    = false;
        this._peekActive  = false;
        this._hoverTimeout    = 0;
        this._collapseTimeout = 0;
        this._clockTimer      = 0;
        this._activeTab = 'system';

        this._loadDims();
        this.set_size(this._cwMin, this._ch);

        this._buildLayers();
        this._setupDnd();
        this._applyColors();
        this._hideDateMenuIfRequested();

        this._modules = {
            system:        new SystemMonitor(this._settings),
            notifications: new NotificationPeek(this._settings),
            calendar:      new CalendarPeek(this._settings),
            mpris:         new MprisWatcher(),
            notes:         new Notes(this._settings),
            history:       new NotificationHistory(this),
            weather:       new Weather(this._settings),
            pomodoro:      new Pomodoro(this._settings),
            quick:         new QuickHub(this._settings),
            claude:        new ClaudeUsage(this._settings),
            power:         new PowerWatcher(),
            water:         new WaterReminder(this._settings),
        };
        this._modules.notes.setGrabActor(this);
        this._modules.notes.connect('updated', () => { if (this._expanded && this._activeTab === 'notes') this._renderTab(); });
        this._modules.history.connect('updated', () => { if (this._expanded && this._activeTab === 'history') this._renderTab(); });
        /* show pomodoro mini label at startup with idle styling */
        this._pomoUpdateId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._pomoUpdateId = 0;
            if (this._stopped) return GLib.SOURCE_REMOVE;
            this._updatePomodoroIndicator();
            return GLib.SOURCE_REMOVE;
        });

        this._modules.system.connect('updated',             (_, s)      => this._onSystemUpdated(s));
        this._modules.notifications.connect('peek',         (_, src, n) => this._peekNotification(src, n));
        this._modules.calendar.connect('updated', () => {
            if (this._expanded && this._activeTab === 'calendar') {
                this._renderTab();
            }
        });
        this._modules.mpris.connect('changed',              (_, info)   => this._updateMedia(info));
        this._modules.weather.connect('updated',            ()          => { if (this._expanded && this._activeTab === 'weather') this._renderTab(); });
        this._modules.pomodoro.connect('tick',              ()          => { if (this._expanded && this._activeTab === 'pomodoro') this._renderTab(); this._updatePomodoroIndicator(); });
        this._modules.pomodoro.connect('state',             ()          => { if (this._expanded && this._activeTab === 'pomodoro') this._renderTab(); this._updatePomodoroIndicator(); });
        this._modules.quick.connect('updated',              ()          => { if (this._expanded && this._activeTab === 'quick') this._renderTab(); this._updatePrivacyIndicator(); });
        this._modules.claude.connect('updated',              ()          => { if (this._expanded && this._activeTab === 'claude') this._renderTab(); });
        this._modules.quick.connect('show-submenu',         ()          => this._activeTab === 'quick' ? this._renderTab() : this._goToTab('quick'));
        this._modules.power.connect('charger-changed',      (_, info)   => this._peekCharger(info));
        this._modules.water.connect('level',                (_, level)  => this._waterCup.setLevel(level));
        this._modules.water.connect('due',                  ()          => this._peekWater());

        this._hoverHandlerId = this.connect('notify::hover', () => this._onHoverChanged());
        this.connect('destroy', () => this._onDestroy());

        this._settingsSig = this._settings.connect('changed', (_, key) => this._onSettingChanged(key));
    }

    _loadDims() {
        this._cwMin = this._settings.get_int('collapsed-width');
        this._ch    = this._settings.get_int('collapsed-height');
        this._ew    = this._settings.get_int('expanded-width');
        this._eh    = this._settings.get_int('expanded-height');
        this._radius = this._settings.get_int('corner-radius');
    }

    /* Clock sits centred, or beside the date while a track is in the pill. */
    _placeClock() {
        const target = this._musicPill.visible ? this._rightCluster : this._centerCluster;
        if (this._clockLabel.get_parent() === target) return;
        this._clockLabel.get_parent()?.remove_child(this._clockLabel);
        target.insert_child_at_index(this._clockLabel, 0);
    }

    _measureCollapsedWidth() {
        try {
            /* Equal-width sides keep a centred clock truly centred. */
            this._collapsed.set_width(-1);
            this._leftCluster.set_width(-1);
            this._rightCluster.set_width(-1);
            if (this._clockLabel.get_parent() === this._centerCluster) {
                const w = Math.max(this._leftCluster.get_preferred_width(this._ch)[1],
                    this._rightCluster.get_preferred_width(this._ch)[1]);
                this._leftCluster.set_width(w);
                this._rightCluster.set_width(w);
            }
            const [, natW] = this._collapsed.get_preferred_width(this._ch);
            const w = Math.max(this._cwMin, natW);
            this._collapsed.set_width(w);
            return w;
        } catch (_) { return this._cwMin; }
    }

    _resizeCollapsed(animate = true) {
        if (this._expanded || this._peekActive) return;
        const target = this._measureCollapsedWidth();
        if (animate) {
            this.remove_all_transitions();
            this.ease({
                width: target, height: this._ch,
                duration: 180, mode: Clutter.AnimationMode.EASE_OUT_EXPO,
            });
        } else {
            this.set_size(target, this._ch);
        }
    }

    _applyColors() {
        let bg = this._settings.get_string('bg-color') || '';
        if (!bg.match(/^rgba?\(/)) bg = 'rgb(0, 0, 0)';
        const accent   = this._settings.get_string('accent-color');
        this._bgColor = bg;
        const bgStyle = this._bgStyleFor(this._settings.get_int('corner-radius'));
        this._setRadius(this._settings.get_int('corner-radius'));

        this._accentColor = accent;
        this._bgStyle = bgStyle;

        this._updateBatteryIcon();
    }

    _bgStyleFor(radius) {
        return `
            background-color: ${this._bgColor};
            border-radius: 0 0 ${radius}px ${radius}px;
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-top: 0;
        `;
    }

    /* The notch paints its own background too (blur-my-shell defence), so
       both get the radius or its corners would show square behind _bg. */
    _setRadius(radius) {
        this._bg.set_style(this._bgStyleFor(radius));
        this.set_style(`background-color: ${this._bgColor}; border-radius: 0 0 ${radius}px ${radius}px;`);
    }

    /* ease() has no spring mode; a cubic-bezier that overshoots a little
       lets the notch settle softly instead of stopping dead. */
    _springEase(props, duration, overshoot = 1.12, onComplete = undefined) {
        this._targetH = props.height;
        this.ease({...props, duration, mode: Clutter.AnimationMode.EASE_OUT_QUINT, onComplete});
        for (const name of Object.keys(props)) {
            this.get_transition(name)?.set_cubic_bezier_progress(
                new Graphene.Point({x: 0.3, y: overshoot}), new Graphene.Point({x: 0.45, y: 1}));
        }
    }

    _hideDateMenuIfRequested() {
        const wantHide = this._settings.get_boolean('hide-datemenu');
        const dm = Main.panel.statusArea?.dateMenu;
        if (!dm?.container) return;
        if (wantHide) {
            if (this._dmWasVisible === undefined) this._dmWasVisible = dm.container.visible;
            dm.container.visible = false;
        } else if (this._dmWasVisible !== undefined) {
            dm.container.visible = this._dmWasVisible;
        }
    }

    _restoreDateMenu() {
        const dm = Main.panel.statusArea?.dateMenu;
        if (dm?.container && this._dmWasVisible !== undefined) {
            dm.container.visible = this._dmWasVisible;
        }
    }

    _onSettingChanged(key) {
        if (key.startsWith('collapsed-') || key.startsWith('expanded-') || key === 'corner-radius') {
            this._loadDims();
            if (!this._expanded && !this._peekActive) this._resizeCollapsed(false);
            this._collapsed.height = this._ch;
            this._expandedLayer.width = this._ew;
            if (this._expanded) this.set_size(this._ew, this._expandedHeight());
            this._applyColors();
        }
        if (['bg-color', 'accent-color', 'corner-radius',
             'battery-charging-color', 'battery-normal-color', 'battery-low-color'].includes(key)) {
            this._applyColors();
        }
        if (key === 'hide-datemenu') this._hideDateMenuIfRequested();
        if (key === 'show-water') {
            this._waterCup.visible = this._settings.get_boolean('show-water');
            this._waterCup.setLevel(1);
            this._resizeCollapsed();
        }
        if (key === 'show-media-pill') this._updateMedia(this._latestMedia);
        if (key === 'clock-format' || key === 'show-seconds' || key === 'show-date') {
            this._updateClocks();
            this._resizeCollapsed();
        }
        if (key.startsWith('show-') && key !== 'show-seconds' && key !== 'show-date') {
            /* If the currently-active tab was disabled, fall back to Notifs. */
            if (!this._tabEnabled(this._activeTab)) this._switchTab('history');
            else this._syncDots();
            /* also start/stop the corresponding module so polling matches UI */
            this._reconcileModulesWithPrefs();
        }
    }

    _buildLayers() {
        this._bg = new St.Widget({style_class: 'nexnotch-bg', x_expand: true, y_expand: true});
        this.add_child(this._bg);

        /* collapsed layout:  [battery] [media]   HH:MM   [date]   [shelf#] */
        this._collapsed = new St.BoxLayout({
            style_class: 'nexnotch-collapsed',
            vertical: false,
            /* fixed size, pinned top-centre: stays put while the notch grows */
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.START,
            height: this._ch,
        });
        this.add_child(this._collapsed);

        /* left cluster */
        this._leftCluster = new St.BoxLayout({style_class: 'nexnotch-cluster nexnotch-left', vertical: false});
        this._captureBtn = new St.Button({style_class: 'nexnotch-capture', visible: false, can_focus: true,
            track_hover: true, y_align: Clutter.ActorAlign.CENTER, accessible_name: 'Stop recording or sharing'});
        this._captureBtn.connect('clicked', () => this._stopCapture());
        this._leftCluster.add_child(this._captureBtn);
        this._batteryIcon = new St.Icon({
            icon_name: 'battery-full-symbolic',
            icon_size: 14,
            style_class: 'nexnotch-battery-icon',
            visible: false,
        });
        this._mediaIcon = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            icon_size: 14,
            style_class: 'nexnotch-media-icon',
            visible: false,
        });
        /* statusDot / privacyDot removed — see note above */
        /* statusDot (hot CPU/RAM/temp) and privacyDot (mic/cam) removed per
           user request — battery icon conveys charge, and user finds extra
           coloured dots redundant. Privacy state is still visible in the
           Quick tab. */
        this._pomoLabel = new St.Label({text: '', style_class: 'nexnotch-pomo-mini', visible: false, y_align: Clutter.ActorAlign.CENTER});
        this._leftCluster.add_child(this._pomoLabel);
        this._batteryPct = new St.Label({text: '', style_class: 'nexnotch-date-mini', visible: false, y_align: Clutter.ActorAlign.CENTER});
        this._leftCluster.add_child(this._batteryIcon);
        this._leftCluster.add_child(this._batteryPct);
        this._leftCluster.add_child(this._mediaIcon);
        /* music pill — extends the collapsed notch with track title + artist
           in the Dynamic Island / NotchNook style when MPRIS is active */
        this._musicPill = new St.BoxLayout({
            style_class: 'nexnotch-music-pill',
            vertical: false,
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._musicTitle  = new St.Label({style_class: 'nexnotch-music-title'});
        this._musicArtist = new St.Label({style_class: 'nexnotch-music-artist'});
        this._musicPill.add_child(this._musicTitle);
        this._musicPill.add_child(new St.Label({text: ' · ', style_class: 'nexnotch-music-sep'}));
        this._musicPill.add_child(this._musicArtist);
        this._leftCluster.add_child(this._musicPill);

        /* center clock */
        this._centerCluster = new St.BoxLayout({
            style_class: 'nexnotch-cluster nexnotch-center',
            vertical: false,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._clockLabel = new St.Label({text: '', style_class: 'nexnotch-clock', y_align: Clutter.ActorAlign.CENTER});

        /* right cluster: date */
        this._rightCluster = new St.BoxLayout({style_class: 'nexnotch-cluster nexnotch-right', vertical: false});
        this._dateLabelC = new St.Label({text: '', style_class: 'nexnotch-date-mini', x_expand: true, x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER});
        /* pomoLabel now lives in _leftCluster (user-preferred position) */
        this._centerCluster.add_child(this._clockLabel);
        this._rightCluster.add_child(this._dateLabelC);
        this._waterCup = new WaterCup();
        this._waterCup.visible = this._settings.get_boolean('show-water');
        this._rightCluster.add_child(this._waterCup);

        this._collapsed.add_child(this._leftCluster);
        this._collapsed.add_child(this._centerCluster);
        this._collapsed.add_child(this._rightCluster);

        /* expanded layer */
        this._expandedLayer = new St.BoxLayout({
            style_class: 'nexnotch-expanded',
            vertical: true,
            /* laid out once at the final size; the growing notch reveals it */
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.START,
            width: this._ew,
            opacity: 0,
            visible: false,
        });
        this.add_child(this._expandedLayer);

        this._header = new St.BoxLayout({style_class: 'nexnotch-header', vertical: false});
        this._bigClock  = new St.Label({text: '', style_class: 'nexnotch-big-clock'});
        const dateCol = new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER});
        this._dateLabel  = new St.Label({text: '', style_class: 'nexnotch-date', x_align: Clutter.ActorAlign.END});
        this._monthLabel = new St.Label({text: '', style_class: 'nexnotch-date-month', x_align: Clutter.ActorAlign.END});
        dateCol.add_child(this._dateLabel);
        dateCol.add_child(this._monthLabel);
        this._header.add_child(this._bigClock);
        this._header.add_child(new St.Widget({x_expand: true}));
        this._header.add_child(dateCol);
        this._expandedLayer.add_child(this._header);

        /* tabs change by swiping; the dots show where you are and can be clicked */
        const pager = new St.BoxLayout({style_class: 'nexnotch-pager', x_align: Clutter.ActorAlign.CENTER});
        this._tabName = new St.Label({style_class: 'nexnotch-tab-name', y_align: Clutter.ActorAlign.CENTER});
        this._dots = new St.BoxLayout({style_class: 'nexnotch-dots', y_align: Clutter.ActorAlign.CENTER});
        pager.add_child(this._tabName);
        pager.add_child(this._dots);
        this._content = new St.Bin({style_class: 'nexnotch-content', x_expand: true, y_expand: true});
        this._expandedLayer.add_child(pager);
        this._expandedLayer.add_child(this._content);
        this.connect('captured-event', (_a, event) => this._onCapturedEvent(event));

        this._peekLayer = null;
    }

    _setupDnd() {
        try {
            Main.wm.addKeybinding('shortcut-toggle',
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                () => this._expanded ? this._collapse() : this._expand());
            this._keybindings = ['shortcut-toggle'];
        } catch (e) { logError(e, 'nexnotch:keybinding'); }
    }

    _tabLabel(id) {
        return {
            history: 'Notifs', system: 'System', calendar: 'Cal',
            notes:  'Notes',  weather:  'Weather', pomodoro: 'Timer',
            quick: 'Quick', claude: 'Limits',
        }[id] ?? id;
    }

    _tabEnabled(id) {
        const key = {
            system:   'show-system',
            calendar: 'show-calendar',
            history:  null,
            notes:    null,
            weather:  null,
            pomodoro: null,
            quick:    null,
            claude:   'show-claude-usage',
        }[id];
        if (!key) return true;
        return this._settings.get_boolean(key);
    }

    start() {
        /* gate modules whose matching show-* key is off, so they don't poll
           resources in the background. start/stop is idempotent inside each
           module. */
        this._startEnabledModules();
        const last = this._settings.get_string('last-tab');
        this._switchTab(TAB_IDS.includes(last) && this._tabEnabled(last) ? last : 'history');
        this._startClock();
        this._updateBatteryIcon();
        this._watchCapture();
    }

    /* Mirror GNOME's own (hidden) top-bar recording/sharing indicators:
       they already track state and the recording timer. */
    _watchCapture() {
        const {screenRecording: rec, screenSharing: share} = Main.panel.statusArea;
        rec?.connectObject('notify::visible', () => this._syncCapture(), this);
        rec?._label?.connectObject('notify::text', () => this._syncCapture(), this);
        share?.connectObject('notify::visible', () => this._syncCapture(), this);
        this._syncCapture();
    }

    _syncCapture() {
        const {screenRecording: rec, screenSharing: share} = Main.panel.statusArea;
        const recording = !!rec?.visible;
        const label = recording ? `● ${rec._label?.text ?? ''}` : '● Sharing';
        const visible = recording || !!share?.visible;
        const resize = visible !== this._captureBtn.visible || label.length !== this._captureBtn.label?.length;
        this._captureBtn.label = label;
        this._captureBtn.visible = visible;
        if (resize) this._resizeCollapsed();
    }

    _stopCapture() {
        if (Main.screenshotUI.screencast_in_progress) Main.screenshotUI.stopScreencast();
        else Main.panel.statusArea.screenSharing?._stopSharing?.();
    }

    _startEnabledModules() {
        for (const [name, mod] of Object.entries(this._modules)) {
            if (this._moduleEnabled(name)) {
                try { mod.start?.(); mod._running = true; } catch (e) { logError(e); }
            } else {
                mod._running = false;
            }
        }
    }

    _reconcileModulesWithPrefs() {
        for (const [name, mod] of Object.entries(this._modules)) {
            const enabled = this._moduleEnabled(name);
            const running = !!mod._running;
            if (enabled && !running)  { try { mod.start?.(); mod._running = true;  } catch (e) { logError(e); } }
            if (!enabled && running)  { try { mod.stop?.();  mod._running = false; } catch (e) { logError(e); } }
        }
    }

    _moduleEnabled(name) {
        if (name === 'calendar')      return this._tabEnabled('calendar');
        if (name === 'system')        return this._settings.get_boolean('show-system');
        if (name === 'notifications') return this._settings.get_boolean('show-notifications');
        if (name === 'claude')        return this._settings.get_boolean('show-claude-usage');
        if (name === 'water')         return this._settings.get_boolean('show-water');
        return true;
    }

    stop() {
        this._stopped = true;
        this._clearHoverTimeout();
        this._clearCollapseTimeout();
        this._stopClock();
        if (this._wakeSigId && this._wakeProxy) { try { this._wakeProxy.disconnectSignal(this._wakeSigId); } catch (_) {} this._wakeSigId = 0; }
        this._wakeProxy = null;
        if (this._pomoUpdateId) { GLib.source_remove(this._pomoUpdateId); this._pomoUpdateId = 0; }
        if (this._peekTimer)    { GLib.source_remove(this._peekTimer);    this._peekTimer    = 0; }
        for (const id of this._bannerKillTimers ?? []) {
            try { GLib.source_remove(id); } catch (_) {}
        }
        this._bannerKillTimers?.clear();
        Main.panel.statusArea.screenRecording?.disconnectObject(this);
        Main.panel.statusArea.screenRecording?._label?.disconnectObject(this);
        Main.panel.statusArea.screenSharing?.disconnectObject(this);
        for (const m of Object.values(this._modules)) m.stop?.();
        this._lyrics?.destroy();
        this._lyrics = null;
        this._restoreDateMenu();
        if (this._settingsSig) { this._settings.disconnect(this._settingsSig); this._settingsSig = 0; }
        for (const key of this._keybindings ?? []) {
            try { Main.wm.removeKeybinding(key); } catch (_) {}
        }
        this._keybindings = [];
    }

    _onDestroy() {
        this._clearHoverTimeout();
        this._clearCollapseTimeout();
        this._stopClock();
        for (const m of Object.values(this._modules ?? {})) m.destroy?.();
        this._modules = {};
    }

    _startClock() {
        this._updateClocks();
        this._scheduleClockTick();
        this._watchWake();
    }

    /* GLib timers are driven by the monotonic clock, which stops advancing
       during suspend. On resume the pending tick fires late and shows a
       stale time for the rest of that period (up to a full minute) — this
       is the "clock is 1-2 min behind" symptom on laptops. Force an
       immediate resync when logind reports the system woke up. */
    _watchWake() {
        try {
            this._wakeProxy = new Gio.DBusProxy({
                g_connection: Gio.DBus.system,
                g_name: 'org.freedesktop.login1',
                g_object_path: '/org/freedesktop/login1',
                g_interface_name: 'org.freedesktop.login1.Manager',
            });
            this._wakeProxy.init(null);
            this._wakeSigId = this._wakeProxy.connectSignal('PrepareForSleep', (_p, _s, [starting]) => {
                if (!starting) { this._stopClock(); this._updateClocks(); this._scheduleClockTick(); }
            });
        } catch (e) { logError(e, 'nexnotch:wake-watch'); }
    }

    _scheduleClockTick() {
        const showSec = this._settings.get_boolean('show-seconds');
        const period  = showSec ? 1000 : 60000;
        const now = Date.now();
        const delay = Math.max(20, period - (now % period));
        this._clockTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._updateClocks();
            this._scheduleClockTick();
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopClock() {
        if (this._clockTimer) { GLib.source_remove(this._clockTimer); this._clockTimer = 0; }
    }

    _updateClocks() {
        const now = new Date();
        const showSec   = this._settings.get_boolean('show-seconds');
        const showDate  = this._settings.get_boolean('show-date');
        const h12       = this._settings.get_string('clock-format') === '12h';
        const timeOpts = {
            hour: '2-digit', minute: '2-digit',
            hour12: h12,
            ...(showSec ? {second: '2-digit'} : {}),
        };
        const time = now.toLocaleTimeString([], timeOpts);
        this._clockLabel.text = time;
        this._bigClock.text   = time;
        if (showDate) {
            this._dateLabelC.text = this._formatCompactDate(now);
            this._dateLabelC.visible = true;
        } else {
            this._dateLabelC.visible = false;
        }
        this._dateLabel.text  = now.toLocaleDateString([], {weekday: 'long', day: 'numeric'});
        this._monthLabel.text = now.toLocaleDateString([], {month: 'long'});
    }

    _formatCompactDate(d) {
        const day   = d.getDate();
        const month = d.toLocaleDateString([], {month: 'long'});
        /* Full name if ≤5 chars, otherwise first 3 chars (Turkish convention) */
        const display = month.length <= 5 ? month : month.slice(0, 3);
        return `${day} ${display}`;
    }

    _clearHoverTimeout()    { if (this._hoverTimeout)    { GLib.source_remove(this._hoverTimeout);    this._hoverTimeout = 0; } }
    _clearCollapseTimeout() { if (this._collapseTimeout) { GLib.source_remove(this._collapseTimeout); this._collapseTimeout = 0; } }

    _onHoverChanged() {
        if (this.hover) this._scheduleExpand();
        else            this._scheduleCollapse();
    }

    _pointerInside() {
        try {
            const [px, py] = global.get_pointer();
            const [ax, ay] = this.get_transformed_position();
            let aw, ah;
            if (this._expanded) { aw = this._ew; ah = this._eh; }
            else                { [aw, ah] = this.get_transformed_size(); }
            const margin = 8;
            return px >= (ax - margin) && px <= (ax + aw + margin) &&
                   py >= (ay - margin) && py <= (ay + ah + margin);
        } catch (_) { return this.hover; }
    }

    _scheduleExpand() {
        if (this._expanded) { this._clearCollapseTimeout(); return; }
        /* Don't hijack a notification click: when a peek is visible, the
           user's hover intent is almost always "I'm moving to click the
           banner", not "expand the notch". Suppress expansion while peek
           is up; they can still click the peek body to activate it, or
           wait for the peek to time out before hovering expands. */
        if (this._peekActive) return;
        this._clearHoverTimeout();
        this._hoverTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HOVER_DELAY_MS, () => {
            this._hoverTimeout = 0;
            if (this._peekActive) return GLib.SOURCE_REMOVE;
            if (this._captureBtn.hover) return GLib.SOURCE_REMOVE;
            if (this.hover || this._pointerInside()) this._expand();
            return GLib.SOURCE_REMOVE;
        });
    }

    _scheduleCollapse() {
        this._clearHoverTimeout();
        if (!this._expanded) return;
        this._clearCollapseTimeout();
        this._collapseTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, COLLAPSE_DELAY_MS, () => {
            this._collapseTimeout = 0;
            if (this.hover || this._pointerInside() || this._notesFocused || this._seeking) {
                this._scheduleCollapse();
                return GLib.SOURCE_REMOVE;
            }
            this._collapse();
            return GLib.SOURCE_REMOVE;
        });
    }

    _expand() {
        if (this._peekActive) this._dismissPeek(true);
        this._expanded = true;
        this._expandedLayer.visible = true;
        this._updateClocks();
        this._content.remove_all_transitions();
        this._content.translation_x = 0;
        this._content.opacity = 255;
        this._switchTab(this._activeTab);
        this.remove_all_transitions();
        this._springEase({width: this._ew, height: this._expandedHeight()}, ANIM_MS * 1.6);
        this._collapsed.ease({opacity: 0, duration: ANIM_MS * 0.3, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this._collapsed.hide()});
        /* content arrives with the shape, so a quick hover never shows an empty block */
        this._expandedLayer.opacity = 0;
        this._expandedLayer.scale_x = 0.97; this._expandedLayer.scale_y = 0.97;
        this._expandedLayer.set_pivot_point(0.5, 0);
        this._expandedLayer.ease({
            opacity: 255, scale_x: 1, scale_y: 1,
            duration: ANIM_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    _collapse() {
        this._modules?.notes?._releaseGrab?.();
        this._expanded = false;
        this._modules?.system?.setFocused?.(false);
        this._modules?.quick?.setFocused?.(false);
        this._collapsed.show();
        this.remove_all_transitions();
        const targetW = this._measureCollapsedWidth();
        this._springEase({width: targetW, height: this._ch}, ANIM_MS * 1.3, 1.04);
        /* The notch closes over its content (the clip trims it) and the pill
           fades in before that content is gone, so it never shrinks as an
           empty box. */
        this._collapsed.opacity = 0;
        this._collapsed.ease({opacity: 255, duration: ANIM_MS * 0.8, delay: ANIM_MS * 0.45, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._expandedLayer.ease({
            opacity: 0, scale_x: 1, scale_y: 1,
            duration: ANIM_MS * 0.9, mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => { this._expandedLayer.visible = false; },
        });
    }

    _switchTab(id) {
        if (this._activeTab === 'notes' && id !== 'notes') {
            this._modules?.notes?._releaseGrab?.();
        }
        this._activeTab = id;
        if (this._settings.get_string('last-tab') !== id) this._settings.set_string('last-tab', id);
        /* Bump system poll to user-selected fast rate only when user is
           actually looking at the system tab, otherwise fall back to 3x */
        this._modules?.system?.setFocused?.(this._expanded && id === 'system');
        this._modules?.quick?.setFocused?.(this._expanded && id === 'quick');
        this._syncDots();
        this._renderTab();
    }

    _tabOrder() {
        return TAB_IDS.filter(id => this._tabEnabled(id));
    }

    _syncDots() {
        this._tabName.text = this._tabLabel(this._activeTab);
        this._dots.destroy_all_children();
        for (const id of this._tabOrder()) {
            const dot = new St.Button({style_class: 'nexnotch-page-dot', can_focus: true,
                accessible_name: this._tabLabel(id), y_align: Clutter.ActorAlign.CENTER});
            if (id === this._activeTab) dot.add_style_pseudo_class('checked');
            dot.connect('clicked', () => this._goToTab(id));
            this._dots.add_child(dot);
        }
    }

    /* Slide the current tab out, swap, and slide the new one in from the
       side it came from. dir: +1 = next (content moves left). */
    _goToTab(id, dir = 0) {
        const order = this._tabOrder();
        dir ||= Math.sign(order.indexOf(id) - order.indexOf(this._activeTab)) || 1;
        const c = this._content;
        c.remove_all_transitions();
        if (id === this._activeTab || !this._expanded) {
            if (id !== this._activeTab) this._switchTab(id);
            c.ease({translation_x: 0, opacity: 255, duration: 320, mode: Clutter.AnimationMode.EASE_OUT_BACK});
            return;
        }
        c.ease({
            translation_x: -dir * SLIDE_PX, opacity: 0,
            duration: 110, mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                this._switchTab(id);
                c.translation_x = dir * SLIDE_PX;
                c.ease({translation_x: 0, opacity: 255, duration: 300, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
            },
        });
    }

    _stepTab(step) {
        const order = this._tabOrder();
        const next = order[order.indexOf(this._activeTab) + step];
        if (next) this._goToTab(next, step);
    }

    /* Horizontal swipes change tabs. Captured before children see them so a
       scroll view inside a tab can't eat them; vertical scrolling passes on. */
    _onCapturedEvent(event) {
        if (!this._expanded || event.type() !== Clutter.EventType.SCROLL) return Clutter.EVENT_PROPAGATE;
        const D = Clutter.ScrollDirection;
        const dirn = event.get_scroll_direction();
        const shift = !!(event.get_state() & Clutter.ModifierType.SHIFT_MASK);
        if (dirn === D.SMOOTH) {
            const [dx, dy] = event.get_scroll_delta();
            if (event.is_pointer_emulated())   // wheel's smooth twin of a discrete event
                return Math.abs(dx) > Math.abs(dy) || shift ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
            return this._onSwipe(dx, dy, event.get_time(), event.get_scroll_finish_flags() !== Clutter.ScrollFinishFlags.NONE);
        }
        const step = {[D.LEFT]: -1, [D.RIGHT]: 1, ...(shift ? {[D.UP]: -1, [D.DOWN]: 1} : {})}[dirn];
        if (step === undefined) return Clutter.EVENT_PROPAGATE;
        /* emulated discrete steps come from touchpad swipes, handled above */
        if (!event.is_pointer_emulated() && event.get_time() - (this._lastWheelStep ?? 0) > 250) {
            this._lastWheelStep = event.get_time();
            this._stepTab(step);
        }
        return Clutter.EVENT_STOP;
    }

    /* Touchpad: content follows the fingers and flips tabs mid-gesture
       every half page, so a long swipe runs through several; on release a
       flick's speed carries on up to MAX_FLICK_TABS more. */
    _onSwipe(dx, dy, time, finished) {
        const s = this._swipe ??= {x: 0, y: 0, axis: null, pages: 0, track: []};
        s.x += dx; s.y += dy;
        if (!s.axis && Math.hypot(s.x, s.y) > 0.6) s.axis = Math.abs(s.x) > Math.abs(s.y) ? 'x' : 'y';
        if (this._swipeEndId) GLib.source_remove(this._swipeEndId);
        this._swipeEndId = finished ? 0 : GLib.timeout_add(GLib.PRIORITY_DEFAULT, 180, () => {
            this._swipeEndId = 0;
            this._endSwipe();
            return GLib.SOURCE_REMOVE;
        });
        if (s.axis !== 'x') {
            if (finished) this._swipe = null;
            return Clutter.EVENT_PROPAGATE;
        }
        const finger = -s.x * SCROLL_UNIT_PX;
        s.track.push([time, finger]);
        while (s.track.length > 2 && time - s.track[0][0] > 100) s.track.shift();

        const order = this._tabOrder();
        let i = order.indexOf(this._activeTab);
        let t = finger + s.pages * PAGE_PX;
        while (t < -PAGE_PX / 2 && i < order.length - 1) { s.pages++; t += PAGE_PX; this._switchTab(order[++i]); }
        while (t > PAGE_PX / 2 && i > 0) { s.pages--; t -= PAGE_PX; this._switchTab(order[--i]); }
        if ((t < 0 && i >= order.length - 1) || (t > 0 && i <= 0)) t *= 0.3;   // rubber band at the ends
        this._content.remove_all_transitions();
        this._content.translation_x = t;
        this._content.opacity = Math.round(255 * (1 - Math.min(0.6, Math.abs(t) / PAGE_PX)));
        if (finished) this._endSwipe();
        return Clutter.EVENT_STOP;
    }

    _endSwipe() {
        const s = this._swipe;
        this._swipe = null;
        if (this._swipeEndId) { GLib.source_remove(this._swipeEndId); this._swipeEndId = 0; }
        if (s?.axis !== 'x') return;
        const [[t0, x0] = [0, 0], [t1, x1] = [0, 0]] = [s.track[0], s.track[s.track.length - 1]];
        const velocity = t1 > t0 ? (x1 - x0) / (t1 - t0) : 0;   // px per ms
        const projected = this._content.translation_x + velocity * FLICK_MS;
        const order = this._tabOrder(), i = order.indexOf(this._activeTab);
        const steps = Math.max(-MAX_FLICK_TABS, Math.min(MAX_FLICK_TABS, Math.round(-projected / PAGE_PX)));
        const target = Math.max(0, Math.min(order.length - 1, i + steps));
        this._goToTab(order[target], Math.sign(target - i));
    }

    _expandedHeight() {
        const layer = this._expandedLayer;
        let h = this._eh;
        try {
            layer.set_height(-1);
            const [, natH] = layer.get_preferred_height(this._ew);
            h = Math.max(this._eh, Math.min(640, natH + 32));
        } catch (_) {}
        layer.set_height(h);
        return h;
    }

    _resizeExpanded() {
        if (!this._expanded || !this._expandedLayer) return;
        const target = this._expandedHeight();
        /* already heading there (e.g. expand still running): don't restart the spring */
        if (Math.abs((this._targetH ?? this.height) - target) > 2)
            this._springEase({width: this._ew, height: target}, 340, 1.06);
    }

    _renderTab() {
        if (!this._expanded) return;
        const mod = {
            system:   this._modules.system,
            calendar: this._modules.calendar,
            notes:    this._modules.notes,
            history:  this._modules.history,
            weather:  this._modules.weather,
            pomodoro: this._modules.pomodoro,
            quick:    this._modules.quick,
            claude:   this._modules.claude,
        }[this._activeTab];
        /* System tab gets an optional music card passed in so the whole
           bottom-right corner can be used for media controls when MPRIS
           has an active player. */
        const extraArg = this._activeTab === 'system' || this._activeTab === 'history'
            ? this._getMusicCard()
            : this._activeTab;
        const child = mod?.render?.(extraArg);
        this._content.set_child(child ?? new St.Label({text: '—', x_align: Clutter.ActorAlign.CENTER}));
        /* nudge height after child lays out */
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (this._stopped) return GLib.SOURCE_REMOVE;
            if (this._expanded) this._resizeExpanded();
            return GLib.SOURCE_REMOVE;
        });
    }

    _onSystemUpdated(stats) {
        this._latestStats = stats;
        this._updateBatteryIcon(stats.battery);
        if (this._expanded && this._activeTab === 'system') this._renderTab();
    }

    _updateBatteryIcon(battery) {
        battery = battery ?? this._latestStats?.battery;
        if (!battery) { this._batteryIcon.visible = this._batteryPct.visible = false; return; }
        const cap = battery.capacity;
        const status = (battery.status ?? '').toLowerCase();
        const plugged = !!battery.plugged;

        const draining = status === 'discharging';
        const charging = status === 'charging' || (plugged && !draining && cap < 100);
        const low = draining && cap < 20;

        /* Desktop with no real battery drain: hide icon entirely. */
        if (!draining && !plugged && cap === 0) {
            const wasVisible = this._batteryIcon.visible;
            this._batteryIcon.visible = this._batteryPct.visible = false;
            if (wasVisible) this._resizeCollapsed();
            return;
        }

        let iconName;
        if (charging)         iconName = cap >= 95 ? 'battery-full-charging-symbolic' : 'battery-good-charging-symbolic';
        else if (cap >= 90)   iconName = 'battery-full-symbolic';
        else if (cap >= 55)   iconName = 'battery-good-symbolic';
        else if (cap >= 25)   iconName = 'battery-low-symbolic';
        else                  iconName = 'battery-caution-symbolic';

        let color;
        if (charging)      color = this._settings.get_string('battery-charging-color');
        else if (plugged)  color = this._settings.get_string('battery-charging-color'); /* plugged + full → green */
        else if (low)      color = this._settings.get_string('battery-low-color');
        else if (draining) color = this._settings.get_string('battery-normal-color');
        else               color = 'rgba(255, 255, 255, 0.78)';

        const wasVisible = this._batteryIcon.visible;
        this._batteryIcon.icon_name = iconName;
        this._batteryIcon.set_style(`color: ${color};`);
        this._batteryIcon.visible = true;
        this._batteryPct.text = `${cap}%`;
        this._batteryPct.visible = true;
        if (!wasVisible) this._resizeCollapsed();
    }

    _updateMedia(info) {
        this._latestMedia = info;
        if (info?.playing && info.title) {
            const key = `${info.title}\u0000${info.artist}`;
            if (key !== this._lastTrackKey) this._peekMusic(info);
            this._lastTrackKey = key;
        }
        const wasIconVisible = this._mediaIcon.visible;
        const wasPillVisible = this._musicPill?.visible;
        const wasText = `${this._musicTitle.text}${this._musicArtist.text}`;
        if ((!info?.playing && !info?.paused) || !this._settings.get_boolean('show-media-pill')) {
            this._mediaIcon.visible = false;
            if (this._musicPill) this._musicPill.visible = false;
        } else {
            const iconName = this._resolveMediaIcon(info.icon) ?? 'audio-x-generic-symbolic';
            this._mediaIcon.icon_name = iconName;
            this._mediaIcon.opacity = info.playing ? 255 : 150;
            this._mediaIcon.visible = true;
            /* Dynamic Island: extend the collapsed pill with the track */
            if (this._musicPill && info.title) {
                const clip = (t, n) => t.length > n ? `${t.slice(0, n - 1)}…` : t;
                const title = clip(info.title || '', 24);
                const artist = clip(info.artist || '', 22);
                this._musicTitle.text = title;
                this._musicArtist.text = artist;
                this._musicPill.visible = true;
            } else if (this._musicPill) {
                this._musicPill.visible = false;
            }
        }
        this._placeClock();
        if (this._mediaIcon.visible !== wasIconVisible ||
            (this._musicPill && this._musicPill.visible !== wasPillVisible) ||
            `${this._musicTitle.text}${this._musicArtist.text}` !== wasText) {
            this._resizeCollapsed();
        }
        /* Live-refresh System tab if music card is visible there */
        if (this._expanded && (this._activeTab === 'system' || this._activeTab === 'history')) this._renderTab();
    }

    /* Reuse the card across tab re-renders (System re-renders every second)
       so its wave and an in-progress seek drag survive; rebuild only when the
       media info changes. */
    _getMusicCard() {
        if (this._musicCard && (this._musicCardInfo === this._latestMedia || this._seeking)) {
            this._musicCard.get_parent()?.remove_child(this._musicCard);
            return this._musicCard;
        }
        this._musicCard?.destroy();
        this._musicCardInfo = this._latestMedia;
        this._musicCard = this._buildMusicCard();
        return this._musicCard;
    }

    _buildMusicCard() {
        const info = this._latestMedia;
        if (!info || (!info.playing && !info.paused)) return null;
        const mpris = this._modules.mpris;
        /* album art fills the card behind a dark shade */
        const outer = new St.Widget({style_class: 'nexnotch-music-card', layout_manager: new Clutter.BinLayout(), x_expand: true});
        const card = new St.BoxLayout({style_class: 'nexnotch-music-shade', vertical: true, x_expand: true, y_expand: true});
        outer.add_child(card);

        const head = new St.BoxLayout({style_class: 'nexnotch-music-head'});
        head.add_child(new St.Icon({icon_name: this._resolveMediaIcon(info.icon) ?? 'audio-x-generic-symbolic',
            icon_size: 16, y_align: Clutter.ActorAlign.CENTER}));
        let sink = '';
        try { sink = Volume.getMixerControl().get_default_sink()?.get_description() ?? ''; } catch (_) {}
        const appBtn = new St.Button({label: [info.app, sink].filter(Boolean).join(' · '),
            style_class: 'nexnotch-music-head-label', x_expand: true, x_align: Clutter.ActorAlign.START, can_focus: true});
        appBtn.connect('clicked', () => { mpris.raise(); this._collapse(); });
        head.add_child(appBtn);
        /* off until asked for: turning lyrics on is what sends the track to lrclib.net */
        const lyricsBtn = new St.Button({style_class: 'nexnotch-music-output', label: 'Lyrics', can_focus: true});
        if (this._showLyrics) lyricsBtn.add_style_pseudo_class('checked');
        lyricsBtn.connect('clicked', () => {
            this._showLyrics = !this._showLyrics;
            this._musicCardInfo = null;
            this._renderTab();
        });
        head.add_child(lyricsBtn);
        const output = new St.Button({style_class: 'nexnotch-music-output', label: 'Output', can_focus: true});
        output.connect('clicked', () => {
            /* GNOME's own output picker from the volume slider; Settings as fallback */
            const slider = this._modules.quick.outputSlider();
            if (slider?.menu) { this._modules.quick.openSubmenu(slider); return; }
            try { Gio.Subprocess.new(['gnome-control-center', 'sound'], Gio.SubprocessFlags.NONE); } catch (e) { logError(e, 'nexnotch:output'); }
            this._collapse();
        });
        head.add_child(output);
        card.add_child(head);

        const top = new St.BoxLayout({style_class: 'nexnotch-music-card-top'});
        const cover = new St.Bin({style_class: 'nexnotch-music-cover', y_align: Clutter.ActorAlign.CENTER});
        cover.set_child(new St.Icon({icon_name: this._resolveMediaIcon(info.icon) ?? 'audio-x-generic-symbolic', icon_size: 28, style_class: 'nexnotch-music-art-fallback'}));
        top.add_child(cover);
        const txt = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'nexnotch-music-txt', y_align: Clutter.ActorAlign.CENTER});
        txt.add_child(new St.Label({text: info.title || 'Unknown', style_class: 'nexnotch-music-card-title'}));
        txt.add_child(new St.Label({text: info.artist || '', style_class: 'nexnotch-music-card-artist'}));
        top.add_child(txt);
        card.add_child(top);

        const len = info.length || 0;
        let frac = 0, phase = 0, basePos = 0, baseTime = GLib.get_monotonic_time();
        let dragging = false, grab = null, holdUntil = 0;
        const wave = new St.DrawingArea({style_class: 'nexnotch-music-wave', x_expand: true, reactive: !!info.canSeek});
        wave.connect('repaint', () => this._paintWave(wave, frac, info.playing, phase));
        card.add_child(wave);

        const fmt = us => {
            const sec = Math.max(0, Math.floor(us / 1e6));
            return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
        };
        const times = new St.BoxLayout({style_class: 'nexnotch-music-times'});
        const elapsed = new St.Label({text: '0:00', x_expand: true});
        times.add_child(elapsed);
        times.add_child(new St.Label({text: len ? fmt(len) : ''}));
        card.add_child(times);

        let syncLyrics = null;
        const show = us => {
            frac = len ? Math.min(1, Math.max(0, us / len)) : 0;
            const t = fmt(us);
            if (elapsed.text !== t) elapsed.text = t;
            wave.queue_repaint();
            syncLyrics?.(us);
        };
        /* Position is polled once a second; in between, advance it locally. */
        const current = () => basePos + (info.playing ? GLib.get_monotonic_time() - baseTime : 0);

        /* Actor-bound timeline: frames only tick while the wave is mapped,
           so it costs nothing with the notch collapsed. */
        const flow = info.playing ? new Clutter.Timeline({actor: wave, duration: 1200, repeat_count: -1}) : null;
        flow?.connect('new-frame', () => {
            phase = flow.get_progress() * 2 * Math.PI;
            if (dragging) wave.queue_repaint();
            else show(current());
        });
        flow?.start();

        const fracAt = event => {
            const [x, y] = event.get_coords();
            const [ok, lx] = wave.transform_stage_point(x, y);
            return ok && wave.width > 0 ? Math.min(1, Math.max(0, lx / wave.width)) : frac;
        };
        const endDrag = () => {
            dragging = this._seeking = false;
            grab?.dismiss();
            grab = null;
        };
        wave.connect('button-press-event', (_a, event) => {
            dragging = this._seeking = true;
            grab = global.stage.grab(wave);
            show(fracAt(event) * len);
            return Clutter.EVENT_STOP;
        });
        wave.connect('motion-event', (_a, event) => {
            if (!dragging) return Clutter.EVENT_PROPAGATE;
            show(fracAt(event) * len);
            return Clutter.EVENT_STOP;
        });
        wave.connect('button-release-event', (_a, event) => {
            if (!dragging) return Clutter.EVENT_PROPAGATE;
            const f = fracAt(event);
            endDrag();
            mpris.seekFraction(f);
            basePos = f * len;
            baseTime = GLib.get_monotonic_time();
            holdUntil = baseTime + 1200000;
            show(basePos);
            return Clutter.EVENT_STOP;
        });

        let alive = true;
        this._loadArt(info.artUrl, path => {
            if (!alive) return;
            const url = `url("file://${path}")`;
            outer.set_style(`background-image: ${url};`);
            cover.set_style(`background-image: ${url};`);
            cover.child?.hide();
        });
        const tick = () => mpris.position(us => {
            if (!alive || dragging || GLib.get_monotonic_time() < holdUntil) return;
            basePos = us;
            baseTime = GLib.get_monotonic_time();
            show(us);
        });
        tick();
        const timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => { tick(); return GLib.SOURCE_CONTINUE; });
        outer.connect('destroy', () => {
            alive = false;
            GLib.source_remove(timer);
            flow?.stop();
            if (dragging) endDrag();
            if (this._musicCard === outer) this._musicCard = null;
        });

        const ctrls = new St.BoxLayout({style_class: 'nexnotch-music-ctrls', x_align: Clutter.ActorAlign.CENTER});
        const mk = (icon, cb, accName, enabled = true, extraClass = '') => {
            const b = new St.Button({style_class: `nexnotch-music-btn ${extraClass}`, child: new St.Icon({icon_name: icon, icon_size: 16}),
                accessible_name: accName, can_focus: true, reactive: enabled});
            if (!enabled) b.add_style_class_name('disabled');
            if (enabled) b.connect('clicked', cb);
            return b;
        };
        ctrls.add_child(mk('media-playlist-shuffle-symbolic', () => mpris.toggleShuffle(), 'Shuffle',
            typeof info.shuffle === 'boolean', info.shuffle ? 'active' : ''));
        ctrls.add_child(mk('media-skip-backward-symbolic', () => mpris.previous(), 'Previous track', info.canPrev));
        ctrls.add_child(mk(info.playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic',
            () => mpris.playPause(), 'Play/pause', info.canPlay || info.canPause, 'play'));
        ctrls.add_child(mk('media-skip-forward-symbolic', () => mpris.next(), 'Next track', info.canNext));
        ctrls.add_child(mk(info.loop === 'Track' ? 'media-playlist-repeat-song-symbolic' : 'media-playlist-repeat-symbolic',
            () => mpris.cycleLoop(), 'Repeat', typeof info.loop === 'string', info.loop && info.loop !== 'None' ? 'active' : ''));
        card.add_child(ctrls);
        if (this._showLyrics) {
            const lyr = this._buildLyrics(info, () => alive);
            card.add_child(lyr.box);
            syncLyrics = lyr.sync;
        }
        return outer;
    }

    /* previous / current / next lyric line; sync(us) follows the wave position */
    _buildLyrics(info, alive) {
        const box = new St.BoxLayout({style_class: 'nexnotch-lyrics', vertical: true, x_expand: true});
        const line = (cls, wrap) => {
            const l = new St.Label({style_class: cls, x_expand: true});
            l.clutter_text.line_alignment = Pango.Alignment.CENTER;
            if (wrap) {
                l.clutter_text.line_wrap = true;
                l.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            } else {
                l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            }
            return l;
        };
        const prev = line('nexnotch-lyrics-line', false);
        const cur  = line('nexnotch-lyrics-line nexnotch-lyrics-current', true);
        const next = line('nexnotch-lyrics-line', false);
        cur.text = 'Loading lyrics…';
        box.add_child(prev);
        box.add_child(cur);
        box.add_child(next);

        let lines = null, shown = -2, lastUs = 0;
        const sync = us => {
            lastUs = us;
            if (!lines) return;
            const i = lineAt(lines, us / 1000);
            if (i === shown) return;
            shown = i;
            prev.text = lines[i - 1]?.text ?? '';
            cur.text  = i >= 0 ? (lines[i].text || '♪') : '♪';
            next.text = lines[i + 1]?.text ?? '';
        };

        this._lyrics ??= new Lyrics();
        this._lyrics.get(info).then(result => {
            if (!alive()) return;
            if (!result) cur.text = 'No lyrics found for this song';
            else if (result.instrumental) cur.text = '♪ Instrumental';
            else if (!result.synced) cur.text = 'Only unsynced lyrics are available';
            else { lines = result.synced; sync(lastUs); }
        });
        return {box, sync};
    }

    _paintWave(area, frac, playing, phase = 0) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const r = 6, mid = h / 2, x = r + (w - 2 * r) * frac;
        cr.setLineWidth(3);
        try { cr.setLineCap(1); } catch (_) {} // 1 = Cairo.LineCap.ROUND
        cr.setSourceRGBA(1, 1, 1, 0.18);
        cr.moveTo(x, mid);
        cr.lineTo(w - r, mid);
        cr.stroke();
        cr.setSourceRGBA(1, 0.67, 0.24, 0.95);
        const amp = playing ? 3 : 0;
        cr.moveTo(r, mid);
        for (let i = r; i <= x; i++) cr.lineTo(i, mid + amp * Math.sin((i - r) / 4 - phase));
        cr.stroke();
        cr.arc(x, mid, r, 0, 2 * Math.PI);
        cr.fill();
        cr.$dispose();
    }

    /* file:// art is used in place; https art (Spotify) is cached by URL hash */
    _artPath(url) {
        if (url?.startsWith('file://')) return decodeURIComponent(url.slice(7));
        if (!url?.startsWith('https://')) return null;
        return GLib.build_filenamev([GLib.get_user_cache_dir(), 'nexnotch', 'art',
            GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, url, -1)]);
    }

    /* Always calls back on a later main-loop turn, so callers can finish
       building the widget the art is for first. */
    _loadArt(url, callback) {
        const path = this._artPath(url);
        if (!path) return;
        const later = () => GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (!this._stopped) callback(path);
            return GLib.SOURCE_REMOVE;
        });
        if (GLib.file_test(path, GLib.FileTest.EXISTS)) { later(); return; }
        if (!url.startsWith('https://')) return;
        const msg = Soup.Message.new('GET', url);
        if (!msg) return;
        GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o700);
        this._artSoup ??= new Soup.Session({timeout: 10});
        this._artSoup.send_and_read_async(msg, GLib.PRIORITY_LOW, null, (session, res) => {
            try {
                const bytes = session.send_and_read_finish(res);
                if (this._stopped || msg.status_code !== 200) return;
                Gio.File.new_for_path(path).replace_contents_bytes_async(bytes, null, false,
                    Gio.FileCreateFlags.NONE, null, (file, r) => {
                        try { file.replace_contents_finish(r); later(); }
                        catch (e) { logError(e, 'nexnotch:art'); }
                    });
            } catch (e) { logError(e, 'nexnotch:art'); }
        });
    }

    _peekMusic(info) {
        const mpris = this._modules.mpris;
        const peek = this._peekNotification(null, {
            title: info.title,
            body: [info.artist, info.album].filter(Boolean).join(' — '),
            gicon: Gio.ThemedIcon.new(this._resolveMediaIcon(info.icon) ?? 'audio-x-generic-symbolic'),
            actions: [
                {label: '⏮', activate: () => mpris.previous()},
                {label: '⏯', activate: () => mpris.playPause()},
                {label: '⏭', activate: () => mpris.next()},
            ],
            activate() {},
            destroy() {},
        }, 48);
        this._loadArt(info.artUrl, path => {
            if (!peek || this._peekLayer !== peek) return;
            peek.get_child_at_index(0).child.gicon = Gio.FileIcon.new(Gio.File.new_for_path(path));
        });
    }

    /* Charger plugged in or out; UPower reports it immediately, unlike the battery poll. */
    _peekCharger(info) {
        const pct = info.percentage === null ? null : Math.round(info.percentage);
        const charging = info.state === PowerState.CHARGING;
        this._modules.system.refreshBattery();
        this._updateBatteryIcon({
            capacity: pct ?? 0,
            status: charging ? 'charging' : (info.plugged ? 'not charging' : 'discharging'),
            plugged: info.plugged,
        });
        let title, detail = '';
        if (!info.plugged) {
            title = 'On battery';
            if (info.timeToEmpty > 0) detail = `${this._formatDuration(info.timeToEmpty)} left`;
        } else if (info.state === PowerState.FULLY_CHARGED) {
            title = 'Fully charged';
        } else if (info.state === PowerState.PENDING_CHARGE) {
            title = 'Plugged in, not charging';   // e.g. a charge limit
        } else {
            title = 'Charging';
            if (info.timeToFull > 0) detail = `${this._formatDuration(info.timeToFull)} until full`;
        }
        this._peekNotification(null, {
            title,
            body: [pct === null ? '' : `${pct}%`, detail].filter(Boolean).join(' · '),
            gicon: Gio.ThemedIcon.new(info.plugged ? 'battery-full-charging-symbolic' : 'battery-good-symbolic'),
            activate() {},
            destroy() {},
        });
    }

    /* GNOME's volume / brightness OSD, drawn in the notch. Repeated key
       presses update the same peek and keep it open. Returns false when the
       notch can't show it (expanded, or hidden for fullscreen) so GNOME's
       own OSD is used instead. */
    showOsd(icon, label, level, maxLevel) {
        if (this._expanded || !this.is_mapped()) return false;
        let o = this._osd;
        if (!o || this._peekLayer !== o.peek) {
            this._dismissPeek(true);
            const peek = new St.BoxLayout({style_class: 'nexnotch-peek nexnotch-osd', x_expand: true, y_expand: true});
            peek.set_style(this._bgStyle);
            o = this._osd = {
                peek,
                icon: new St.Icon({style_class: 'nexnotch-osd-icon', y_align: Clutter.ActorAlign.CENTER}),
                level: new BarLevel({style_class: 'nexnotch-osd-level', x_expand: true, y_align: Clutter.ActorAlign.CENTER}),
                text: new St.Label({style_class: 'nexnotch-osd-label', y_align: Clutter.ActorAlign.CENTER}),
            };
            o.text.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            peek.add_child(o.icon);
            peek.add_child(o.level);
            peek.add_child(o.text);
            this.add_child(peek);
            this._peekLayer = peek;
            this._peekActive = true;
            this._collapsed.hide();
            this.remove_all_transitions();
            peek.opacity = 0;
            peek.ease({opacity: 255, duration: 160, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            this._springEase({width: OSD_SIZE[0], height: OSD_SIZE[1]}, 320, 1.08);
            o.level.value = level ?? 0;
        } else if (level != null) {
            o.level.ease_property('value', level, {duration: 100, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
        o.icon.gicon = icon;
        o.level.maximum_value = maxLevel > 0 ? maxLevel : 1;
        o.level.visible = level != null;
        /* with a level, the percentage; the label (often a device name) only for level-less OSDs */
        o.text.text = level != null ? `${Math.round(level * 100)}%` : (label ?? '');
        if (this._peekTimer) GLib.source_remove(this._peekTimer);
        this._peekTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, OSD_MS, () => {
            this._peekTimer = 0;
            this._dismissPeek(false);
            return GLib.SOURCE_REMOVE;
        });
        return true;
    }

    _peekWater() {
        const mins = this._settings.get_int('water-interval');
        this._peekNotification(null, {
            title: 'Time to drink some water',
            body: `Next reminder in ${mins} min`,
            gicon: Gio.ThemedIcon.new('weather-showers-symbolic'),
            activate() {},
            destroy() {},
        });
    }

    _formatDuration(seconds) {
        const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
        return h ? `${h}h ${m}m` : `${m}m`;
    }

    _resolveMediaIcon(desktopEntry) {
        if (!desktopEntry) return null;
        const app = Gio.DesktopAppInfo.new(`${desktopEntry}.desktop`);
        if (app) {
            const gicon = app.get_icon();
            if (gicon) {
                const name = gicon.to_string?.();
                if (name && !name.startsWith('/')) return name;
            }
        }
        const fallback = {
            spotify:         'spotify-client',
            'org.gnome.Decibels': 'org.gnome.Decibels',
            firefox:         'firefox',
            vlc:             'vlc',
            rhythmbox:       'rhythmbox',
        }[desktopEntry.toLowerCase()];
        return fallback ?? 'audio-x-generic-symbolic';
    }

    _updatePomodoroIndicator() {
        const p = this._modules?.pomodoro;
        if (!this._pomoLabel) return;
        const wasVisible = this._pomoLabel.visible;
        this._pomoLabel.remove_style_class_name('break');
        this._pomoLabel.remove_style_class_name('paused');
        if (!p || (!p.isActive() && p.getState() !== 'paused')) {
            /* Idle — hide completely. Pomo label only appears once the
               user has actually started a session. */
            this._pomoLabel.visible = false;
        } else if (p.isActive()) {
            this._pomoLabel.text = p.formatRemain();
            this._pomoLabel.visible = true;
            if (p.getState() === 'break' || p.getState() === 'longbreak') {
                this._pomoLabel.add_style_class_name('break');
            }
        } else {
            this._pomoLabel.text = `⏸ ${p.formatRemain()}`;
            this._pomoLabel.visible = true;
            this._pomoLabel.add_style_class_name('paused');
        }
        if (this._pomoLabel.visible !== wasVisible) this._resizeCollapsed();
    }

    _dndActive() {
        try {
            this._dndSettings ??= new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
            return !this._dndSettings.get_boolean('show-banners');
        } catch (_) { return false; }
    }

    _updatePrivacyIndicator() {
        /* no-op — privacy dot removed from collapsed pill per user request.
           Mic/Camera status is still visible in the Quick tab pills. */
    }

    _peekNotification(source, notif, iconSize = 28) {
        if (this._expanded) return;
        if (!this._settings.get_boolean('show-notifications')) return;   /* master off */
        if (this._dndActive()) return;   /* respect GNOME's Do Not Disturb */
        this._dismissPeek(true);
        if (this._settings.get_boolean('notif-suppress-native')) {
            this._killBanner(0); this._killBanner(60); this._killBanner(220);
        }

        const title = notif?.title ?? source?.title ?? 'Notification';
        let body  = notif?.bannerBodyText ?? notif?.body ?? '';
        /* clamp extremely long notifications */
        const lines = body.split('\n');
        if (lines.length > 6) body = lines.slice(0, 6).join('\n') + '\n…';
        if (body.length > 360) body = body.slice(0, 360) + '…';
        const timeStr = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});

        const peek = new St.BoxLayout({
            style_class: 'nexnotch-peek',
            vertical: false, x_expand: true, y_expand: true,
            reactive: true,
            track_hover: true,
            can_focus: true,
        });
        peek.set_style(this._bgStyle);

        /* Clicking the body of the peek activates the notification (opens
           the source app, marks as read, etc.) — same as clicking a native
           banner. The dismiss button shortcuts out below. */
        peek.connect('button-release-event', (_a, event) => {
            if (event.get_button() !== 1 || this._peekLayer !== peek || !this._peekActive) return Clutter.EVENT_PROPAGATE;
            try {
                if (typeof notif?.activate === 'function') notif.activate();
                else if (typeof source?.open === 'function') source.open();
            } catch (e) { logError(e, 'nexnotch:peek:activate'); }
            this._dismissPeek(false);
            return Clutter.EVENT_STOP;
        });

        const gicon = this._resolveNotifIcon(source, notif);
        const iconBin = new St.Bin({style_class: 'nexnotch-peek-icon-bin', y_align: Clutter.ActorAlign.CENTER});
        iconBin.set_child(new St.Icon({
            gicon, icon_size: iconSize,
            style_class: 'nexnotch-peek-icon',
        }));
        peek.add_child(iconBin);

        const textCol = new St.BoxLayout({
            vertical: true, x_expand: true, y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'nexnotch-peek-text',
        });
        const titleRow = new St.BoxLayout();
        titleRow.add_child(new St.Label({text: title, style_class: 'nexnotch-peek-title', x_expand: true}));
        titleRow.add_child(new St.Label({text: timeStr, style_class: 'nexnotch-peek-time'}));
        textCol.add_child(titleRow);
        let bodyLabel = null;
        if (body) {
            bodyLabel = new St.Label({text: body, style_class: 'nexnotch-peek-body'});
            textCol.add_child(bodyLabel);
        }
        const actionRow = new St.BoxLayout({style_class: 'nexnotch-peek-actions', visible: false});
        for (const action of notif?.actions ?? []) {
            const btn = new St.Button({style_class: 'nexnotch-peek-action', label: action.label, can_focus: true});
            btn.connect('clicked', () => {
                try { action.activate(); } catch (e) { logError(e, 'nexnotch:peek:action'); }
                this._dismissPeek(false);
            });
            actionRow.add_child(btn);
        }
        textCol.add_child(actionRow);
        peek.add_child(textCol);

        const dismissBtn = new St.Button({
            style_class: 'nexnotch-peek-dismiss',
            label: '✕',
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: 'Dismiss notification',
            can_focus: true,
        });
        dismissBtn.connect('clicked', () => {
            try { notif?.destroy?.(); } catch (e) { logError(e, 'nexnotch:peek:dismiss'); }
            this._dismissPeek(false);
        });
        /* Stop the click from bubbling up to the peek (which would activate
           the notification on top of dismissing it). */
        dismissBtn.connect('button-release-event', () => Clutter.EVENT_STOP);
        peek.add_child(dismissBtn);

        this.add_child(peek);
        this._peekLayer  = peek;
        this._peekActive = true;
        this._collapsed.hide();

        this.remove_all_transitions();
        peek.opacity = 0;
        peek.set_pivot_point(0.5, 0);
        peek.scale_x = 0.94; peek.scale_y = 0.94;
        peek.ease({
            opacity: 255, scale_x: 1, scale_y: 1,
            duration: 300, mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });
        /* Fit size to actual text (multi-line messages, short toasts, etc.) */
        const fit = () => {
            if (!this._peekActive || this._peekLayer !== peek) return;
            const width = 540;
            const [, natH] = peek.get_preferred_height(width - 40);
            const h = Math.max(72, Math.min(260, natH + 20));
            this.ease({width, height: h, duration: 260, mode: Clutter.AnimationMode.EASE_OUT_QUINT});
        };
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { fit(); return GLib.SOURCE_REMOVE; });

        const startTimer = (ms = PEEK_DURATION_MS) => {
            if (this._peekTimer) GLib.source_remove(this._peekTimer);
            this._peekTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                this._peekTimer = 0; this._dismissPeek(false); return GLib.SOURCE_REMOVE;
            });
        };
        startTimer();

        /* Hover behaves like a native banner: hold it open, show the whole
           body and the notification's actions. */
        peek.connect('notify::hover', () => {
            if (!this._peekActive || this._peekLayer !== peek) return;
            const open = peek.hover;
            if (bodyLabel) {
                bodyLabel.clutter_text.line_wrap = open;
                bodyLabel.clutter_text.ellipsize = open ? Pango.EllipsizeMode.NONE : Pango.EllipsizeMode.END;
            }
            actionRow.visible = open && actionRow.get_n_children() > 0;
            if (open) {
                if (this._peekTimer) { GLib.source_remove(this._peekTimer); this._peekTimer = 0; }
            } else {
                startTimer(PEEK_UNHOVER_MS);
            }
            fit();
        });
        return peek;
    }

    _killBanner(delayMs) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
            this._bannerKillTimers?.delete(id);
            try { Main.messageTray._bannerBin?.hide?.(); } catch (_) {}
            return GLib.SOURCE_REMOVE;
        });
        (this._bannerKillTimers ??= new Set()).add(id);
    }

    _resolveNotifIcon(source, notif) {
        try {
            if (notif?.gicon)    return notif.gicon;
            if (source?.getIcon) return source.getIcon();
            if (source?.icon)    return source.icon;
        } catch (_) {}
        return Gio.ThemedIcon.new('dialog-information-symbolic');
    }

    _dismissPeek(immediate) {
        if (this._peekTimer) { GLib.source_remove(this._peekTimer); this._peekTimer = 0; }
        if (!this._peekActive) return;
        this._peekActive = false;
        const finalize = () => {
            this._peekLayer?.destroy();
            this._peekLayer = null;
            if (!this._expanded) {
                this._collapsed.show();
                this.ease({width: this._measureCollapsedWidth(), height: this._ch, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_EXPO});
            }
        };
        if (immediate) finalize();
        else GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { finalize(); return GLib.SOURCE_REMOVE; });
    }

});
