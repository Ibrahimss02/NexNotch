import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Pango from 'gi://Pango';
import Soup from 'gi://Soup?version=3.0';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SystemMonitor}    from './modules/system.js';
import {NotificationPeek} from './modules/notifications.js';
import {CalendarPeek}     from './modules/calendar.js';
import {MprisWatcher}     from './modules/mpris.js';
import {Notes}            from './modules/notes.js';
import {Weather}          from './modules/weather.js';
import {Pomodoro}         from './modules/pomodoro.js';
import {QuickHub}         from './modules/quick.js';
import {Stats}            from './modules/stats.js';
import {AntigravityUsage} from './modules/antigravityusage.js';
import {WaveBar}          from './modules/wavebar.js';
import {Lyrics, lineAt}   from './modules/lyrics.js';
import {PowerWatcher, State as PowerState} from './modules/power.js';

const HOVER_DELAY_MS    = 180;
const COLLAPSE_DELAY_MS = 300;
const ANIM_MS           = 200;
const PEEK_DURATION_MS  = 5500;
const MEDIA_PEEK_MS     = 4000;
const POWER_PEEK_MS     = 3000;

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
            weather:       new Weather(this._settings),
            pomodoro:      new Pomodoro(this._settings),
            quick:         new QuickHub(this._settings),
            stats:         new Stats(this._settings),
            claude:        new AntigravityUsage(this._settings),
            power:         new PowerWatcher(),
        };
        this._modules.notes.setGrabActor(this);
        this._modules.notes.connect('updated', () => { if (this._expanded && this._activeTab === 'notes') this._renderTab(); });
        /* show pomodoro mini label at startup with idle styling */
        this._pomoUpdateId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._pomoUpdateId = 0;
            if (this._stopped) return GLib.SOURCE_REMOVE;
            this._updatePomodoroIndicator();
            return GLib.SOURCE_REMOVE;
        });

        this._modules.system.connect('updated',             (_, s)      => this._onSystemUpdated(s));
        this._modules.notifications.connect('peek',         (_, src, n) => this._peekNotification(src, n));
        this._modules.quick.connect('request-collapse', () => { if (this._expanded) this._collapse(); });
        this._modules.power.connect('charger-changed', (_, info) => this._peekCharger(info));
        this._modules.notifications.connect('history-changed', () => {
            if (this._expanded && this._activeTab === 'media') this._renderTab();
        });
        this._modules.calendar.connect('updated', () => {
            if (this._expanded && (this._activeTab === 'calendar' || this._activeTab === 'tasks')) {
                this._renderTab();
            }
        });
        this._modules.mpris.connect('changed',              (_, info)   => this._updateMedia(info));
        this._modules.weather.connect('updated',            ()          => { if (this._expanded && this._activeTab === 'weather') this._renderTab(); });
        this._modules.pomodoro.connect('tick',              ()          => { if (this._expanded && this._activeTab === 'pomodoro') this._renderTab(); this._updatePomodoroIndicator(); });
        this._modules.pomodoro.connect('state',             ()          => { if (this._expanded && this._activeTab === 'pomodoro') this._renderTab(); this._updatePomodoroIndicator(); });
        this._modules.quick.connect('updated',              ()          => { if (this._expanded && this._activeTab === 'quick') this._renderTab(); this._updatePrivacyIndicator(); });
        this._modules.claude.connect('updated',              ()          => { if (this._expanded && this._activeTab === 'claude') this._renderTab(); });

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

    _measureCollapsedWidth() {
        try {
            this._balanceClusters();
            const [, natW] = this._collapsed.get_preferred_width(this._ch);
            return Math.max(this._cwMin, natW);
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
        const radius   = this._settings.get_int('corner-radius');
        const bgStyle = `
            background-color: ${bg};
            border-radius: 0 0 ${radius}px ${radius}px;
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-top: 0;
        `;
        this._bg.set_style(bgStyle);
        this.set_style(`background-color: ${bg};`);

        /* Clutter.Color belt — bypasses CSS entirely so blur-my-shell/other
           panel effects cannot leak through. Applied on top of set_style. */
        try {
            const [ok, col] = Clutter.Color.from_string(bg);
            if (ok) {
                this._bg.set_background_color(col);
                this.set_background_color(col);
            }
        } catch (_) {}

        for (const [tid, btn] of Object.entries(this._tabButtons ?? {})) {
            if (tid === this._activeTab) {
                btn.set_style(`background-color: rgba(255,255,255,0.14); color: white; border-radius: 7px; box-shadow: 0 1px 2px rgba(0,0,0,0.35);`);
            } else {
                btn.set_style('background-color: transparent; color: rgba(255,255,255,0.58); border-radius: 7px;');
            }
        }
        this._accentColor = accent;
        this._bgStyle = bgStyle;

        this._updateBatteryIcon();
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
            if (this._expanded) this.set_size(this._ew, this._eh);
            this._applyColors();
        }
        if (['bg-color', 'accent-color', 'corner-radius',
             'battery-charging-color', 'battery-normal-color', 'battery-low-color'].includes(key)) {
            this._applyColors();
        }
        if (key === 'hide-datemenu') this._hideDateMenuIfRequested();
        if (key === 'clock-format' || key === 'show-seconds' || key === 'show-date') {
            this._updateClocks();
            this._resizeCollapsed();
        }
        if (key.startsWith('show-') && key !== 'show-seconds' && key !== 'show-date') {
            for (const [id, btn] of Object.entries(this._tabButtons ?? {})) {
                btn.visible = this._tabEnabled(id);
            }
            /* If the currently-active tab was disabled, switch to System. */
            if (!this._tabEnabled(this._activeTab)) this._switchTab('system');
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
            x_expand: true, y_expand: true,
        });
        this.add_child(this._collapsed);

        /* left cluster */
        this._leftCluster = new St.BoxLayout({style_class: 'nexnotch-cluster nexnotch-left', vertical: false});
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
        this._leftCluster.add_child(this._batteryIcon);
        this._leftCluster.add_child(this._mediaIcon);
        /* music pill — extends the collapsed notch with track title + artist
           in the Dynamic Island / NotchNook style when MPRIS is active */
        this._musicPill = new St.BoxLayout({
            style_class: 'nexnotch-music-pill',
            vertical: false,
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._musicTitle  = new St.Label({style_class: 'nexnotch-music-title', y_align: Clutter.ActorAlign.CENTER});
        this._musicArtist = new St.Label({style_class: 'nexnotch-music-artist', y_align: Clutter.ActorAlign.CENTER});
        this._musicSep    = new St.Label({text: ' · ', style_class: 'nexnotch-music-sep', y_align: Clutter.ActorAlign.CENTER});
        /* long titles/artists are capped by CSS max-width and end in "…" */
        this._musicTitle.clutter_text.ellipsize  = Pango.EllipsizeMode.END;
        this._musicArtist.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._musicPill.add_child(this._musicTitle);
        this._musicPill.add_child(this._musicSep);
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
        this._centerCluster.add_child(this._clockLabel);

        /* right cluster: date */
        this._rightCluster = new St.BoxLayout({style_class: 'nexnotch-cluster nexnotch-right', vertical: false});
        // pinned to the right edge, mirroring the battery on the left
        this._dateLabelC = new St.Label({text: '', style_class: 'nexnotch-date-mini', x_expand: true, x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER});
        /* pomoLabel now lives in _leftCluster (user-preferred position) */
        this._rightCluster.add_child(this._dateLabelC);

        this._collapsed.add_child(this._leftCluster);
        this._collapsed.add_child(this._centerCluster);
        this._collapsed.add_child(this._rightCluster);

        /* expanded layer */
        this._expandedLayer = new St.BoxLayout({
            style_class: 'nexnotch-expanded',
            vertical: true,
            x_expand: true, y_expand: true,
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

        this._tabs = new St.BoxLayout({style_class: 'nexnotch-tabs', vertical: false});
        this._content = new St.Bin({style_class: 'nexnotch-content', x_expand: true, y_expand: true});
        this._expandedLayer.add_child(this._tabs);
        this._expandedLayer.add_child(this._content);

        this._tabButtons = {};
        const tabIds = ['media', 'system', 'claude', 'calendar', 'weather', 'pomodoro', 'quick'];
        for (const id of tabIds) {
            const btn = new St.Button({
                style_class: 'nexnotch-tab',
                label: this._tabLabel(id),
                can_focus: true,
                x_expand: true,
                track_hover: true,
                visible: this._tabEnabled(id),
            });
            btn.connect('clicked', () => this._switchTab(id));
            this._tabs.add_child(btn);
            this._tabButtons[id] = btn;
        }

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
            media:  'Main',
            system: 'System', calendar: 'Cal', tasks: 'Tasks',
            notes:  'Notes',  weather:  'Weather', pomodoro: 'Timer',
            stats:  'Stats',  quick: 'Quick', claude: 'Limits',
        }[id] ?? id;
    }

    _tabEnabled(id) {
        if (id === 'media') return true;   // Main: player + notification history
        const key = {
            system:   'show-system',
            calendar: 'show-calendar',
            tasks:    'show-tasks',
            notes:    null,
            weather:  null,
            pomodoro: null,
            stats:    null,
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
        this._switchTab('media');
        this._startClock();
        /* The notch shows notifications itself. Blocking GNOME's banners
           (rather than closing them, which deletes the notification) keeps
           every notification in the history. */
        this._syncBannerBlock = () => {
            Main.messageTray.bannerBlocked = this._settings.get_boolean('notif-suppress-native');
        };
        this._bannerSettingId = this._settings.connect('changed::notif-suppress-native', this._syncBannerBlock);
        this._syncBannerBlock();
        this._updateBatteryIcon();
        /* only peek for songs that start after login, not the one already playing */
        this._mediaArmId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
            this._mediaArmId = 0;
            this._mediaArmed = true;
            return GLib.SOURCE_REMOVE;
        });
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
        if (name === 'calendar')      return this._tabEnabled('calendar') || this._tabEnabled('tasks');
        if (name === 'system')        return this._settings.get_boolean('show-system');
        if (name === 'notifications') return this._settings.get_boolean('show-notifications');
        if (name === 'claude')        return this._settings.get_boolean('show-claude-usage');
        if (name === 'notes' || name === 'stats') return false; // tabs removed
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
        if (this._mediaArmId)   { GLib.source_remove(this._mediaArmId);   this._mediaArmId   = 0; }
        if (this._bannerSettingId) { this._settings.disconnect(this._bannerSettingId); this._bannerSettingId = 0; }
        Main.messageTray.bannerBlocked = false;
        if (this._mediaTimer)   { GLib.source_remove(this._mediaTimer);   this._mediaTimer   = 0; }
        if (this._lyricsTimer)  { GLib.source_remove(this._lyricsTimer);  this._lyricsTimer  = 0; }
        this._lyrics?.destroy();
        this._lyrics = null;
        this._mediaCard = null;
        for (const m of Object.values(this._modules)) m.stop?.();
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
            if (this.hover || this._pointerInside() || this._notesFocused) {
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
        /* Build the tab before animating so the first frames don't stall. */
        this._updateClocks();
        this._renderTab();
        this.remove_all_transitions();
        this.ease({
            width: this._ew, height: this._eh,
            duration: ANIM_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
        this._collapsed.ease({opacity: 0, duration: ANIM_MS * 0.4, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this._collapsed.hide()});
        this._expandedLayer.opacity = 0;
        this._expandedLayer.scale_x = 0.96; this._expandedLayer.scale_y = 0.96;
        this._expandedLayer.set_pivot_point(0.5, 0);
        this._expandedLayer.ease({
            opacity: 255, scale_x: 1, scale_y: 1,
            duration: ANIM_MS * 1.1, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        /* Auto-fit height to content after it's laid out. */
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (this._stopped) return GLib.SOURCE_REMOVE;
            if (this._expanded) this._resizeExpanded();
            return GLib.SOURCE_REMOVE;
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
        this.ease({
            width: targetW, height: this._ch,
            duration: ANIM_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
        this._collapsed.ease({opacity: 255, duration: ANIM_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._expandedLayer.set_pivot_point(0.5, 0);
        this._expandedLayer.ease({
            opacity: 0, scale_x: 0.96, scale_y: 0.96,
            duration: ANIM_MS * 0.5, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => { this._expandedLayer.visible = false; },
        });
    }

    _switchTab(id) {
        if (this._activeTab === 'notes' && id !== 'notes') {
            this._modules?.notes?._releaseGrab?.();
        }
        this._activeTab = id;
        /* Bump system poll to user-selected fast rate only when user is
           actually looking at the system tab, otherwise fall back to 3x */
        this._modules?.system?.setFocused?.(this._expanded && id === 'system');
        this._modules?.quick?.setFocused?.(this._expanded && id === 'quick');
        const accent = this._accentColor ?? this._settings.get_string('accent-color');
        for (const [tid, btn] of Object.entries(this._tabButtons)) {
            if (tid === id) {
                btn.add_style_pseudo_class('active');
                btn.set_style(`background-color: rgba(255,255,255,0.14); color: white; border-radius: 7px; box-shadow: 0 1px 2px rgba(0,0,0,0.35);`);
            } else {
                btn.remove_style_pseudo_class('active');
                btn.set_style('background-color: transparent; color: rgba(255,255,255,0.58); border-radius: 7px;');
            }
        }
        this._renderTab();
    }

    _resizeExpanded() {
        if (!this._expanded || !this._expandedLayer) return;
        try {
            const [, natH] = this._expandedLayer.get_preferred_height(this._ew - 36);
            const target = Math.max(this._eh, Math.min(760, natH + 32));   // room for player + lyrics + history
            if (Math.abs(this.height - target) > 2) {
                this.ease({
                    width: this._ew, height: target,
                    duration: 180, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
            }
        } catch (_) {}
    }

    _renderTab() {
        if (!this._expanded) return;
        const mod = {
            media:    {render: () => this._buildMainTab()},
            system:   this._modules.system,
            calendar: this._modules.calendar,
            tasks:    this._modules.calendar,
            notes:    this._modules.notes,
            weather:  this._modules.weather,
            pomodoro: this._modules.pomodoro,
            stats:    this._modules.stats,
            quick:    this._modules.quick,
            claude:   this._modules.claude,
        }[this._activeTab];
        /* Music has its own tab now, so the System tab no longer gets a
           music card (system.render accepts null). */
        const extraArg = this._activeTab === 'system' ? null : this._activeTab;
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
        if (!battery) { this._batteryIcon.visible = false; return; }
        const cap = battery.capacity;
        const status = (battery.status ?? '').toLowerCase();
        const plugged = !!battery.plugged;

        const draining = status === 'discharging';
        const charging = status === 'charging' || (plugged && !draining && cap < 100);
        const low = draining && cap < 20;

        /* Desktop with no real battery drain: hide icon entirely. */
        if (!draining && !plugged && cap === 0) {
            const wasVisible = this._batteryIcon.visible;
            this._batteryIcon.visible = false;
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
        if (!wasVisible) this._resizeCollapsed();
    }

    _mediaPresent() {
        return !!(this._latestMedia?.playing || this._latestMedia?.paused);
    }

    _updateMedia(info) {
        const prev = this._latestMedia;
        this._latestMedia = info;
        const present = this._mediaPresent();
        const playing = !!info?.playing;

        if (present) {
            this._mediaIcon.icon_name = this._resolveMediaIcon(info.icon) ?? 'audio-x-generic-symbolic';
            this._mediaIcon.opacity = playing ? 255 : 150;
        }
        this._mediaIcon.visible = present;
        this._musicTitle.text  = info?.title ?? '';
        this._musicArtist.text = info?.artist ?? '';
        this._musicSep.visible = !!info?.artist;
        /* Dynamic Island: while playing, the pill is just icon · title · artist */
        this._setMediaMode(playing && !!info.title);
        this._resizeCollapsed();

        /* "Now playing" peek whenever playback starts or the track changes.
           _mediaArmed stays false for the first seconds after login so the
           song that was already playing doesn't pop up. */
        const key = info?.title ? `${info.bus}|${info.title}|${info.artist}` : null;
        const trackChanged = key !== this._mediaKey;
        const started = playing && !prev?.playing;
        if (key) this._mediaKey = key;
        if (this._mediaArmed && playing && key && (trackChanged || started)) {
            if (!this._expanded) this._switchTab('media');   // next expand opens the player
            this._peekMedia(info);
        }

        if (this._expanded && this._activeTab === 'media' &&
            (trackChanged || playing !== !!prev?.playing))
            this._renderTab();
    }

    /* While playing, the track sits on the left next to the battery and the
       clock moves right, next to the date. */
    _setMediaMode(on) {
        this._mediaMode = on;
        this._musicPill.visible = on;
        const target = on ? this._rightCluster : this._centerCluster;
        if (this._clockLabel.get_parent() === target) return;
        this._clockLabel.get_parent()?.remove_child(this._clockLabel);
        if (on) this._rightCluster.insert_child_at_index(this._clockLabel, 0);
        else this._centerCluster.add_child(this._clockLabel);
    }

    /* Equal side widths keep the centred clock dead centre. Not needed in
       media mode, where the clock sits on the right. */
    _balanceClusters() {
        const sides = [this._leftCluster, this._rightCluster];
        sides.forEach(c => c.set_style(null));
        if (this._mediaMode) return;
        const w = Math.ceil(Math.max(...sides.map(c => c.get_preferred_width(-1)[1])));
        sides.forEach(c => c.set_style(`min-width: ${w}px;`));
    }

    /* Album art as a local file: file:// URLs are used directly, https ones
       (Spotify) are downloaded once into ~/.cache/nexnotch/art. */
    _loadArt(url, callback) {
        if (!url) return;
        /* Always call back on a later main-loop turn: callers only register
           the widget the art is for after calling us, so an immediate
           callback (cached art) would be dropped. */
        const later = path => GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (!this._stopped) callback(path);
            return GLib.SOURCE_REMOVE;
        });
        if (url.startsWith('file://')) { later(decodeURIComponent(url.slice(7))); return; }
        if (!url.startsWith('https://')) return;
        const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'nexnotch', 'art']);
        const path = GLib.build_filenamev([dir, GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, url, -1)]);
        if (GLib.file_test(path, GLib.FileTest.EXISTS)) { later(path); return; }
        const msg = Soup.Message.new('GET', url);
        if (!msg) return;
        GLib.mkdir_with_parents(dir, 0o700);
        this._artSoup ??= new Soup.Session({timeout: 10});
        this._artSoup.send_and_read_async(msg, GLib.PRIORITY_LOW, null, (session, res) => {
            try {
                const bytes = session.send_and_read_finish(res);
                if (this._stopped || msg.status_code !== 200) return;
                Gio.File.new_for_path(path).replace_contents_bytes_async(bytes, null, false,
                    Gio.FileCreateFlags.NONE, null, (file, r) => {
                        try { file.replace_contents_finish(r); callback(path); }
                        catch (e) { logError(e, 'nexnotch:art'); }
                    });
            } catch (e) { logError(e, 'nexnotch:art'); }
        });
    }

    _formatTime(us) {
        const s = Math.max(0, Math.floor(us / 1e6));
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    _ellipsized(text, styleClass) {
        const label = new St.Label({text, style_class: styleClass, x_expand: true});
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        return label;
    }

    _peekMedia(info) {
        if (this._expanded) return;
        if (!this._settings.get_boolean('show-notifications')) return;
        if (this._dndActive()) return;

        const art = new St.Bin({style_class: 'nexnotch-media-peek-art', y_align: Clutter.ActorAlign.CENTER});
        art.set_child(new St.Icon({icon_name: this._resolveMediaIcon(info.icon) ?? 'audio-x-generic-symbolic', icon_size: 26}));
        const peek = this._showCompactPeek(art, [
            [`Now playing${info.identity ? ` · ${info.identity}` : ''}`, 'nexnotch-media-peek-caption'],
            [info.title || 'Unknown', 'nexnotch-media-peek-title'],
            [info.artist, 'nexnotch-media-peek-artist'],
        ], {
            isMedia: true,
            duration: MEDIA_PEEK_MS,
            onClick: () => { this._switchTab('media'); this._expand(); },   // open the Music tab
        });
        this._loadArt(info.artUrl, path => {
            if (this._peekLayer !== peek) return;
            art.set_style(`background-image: url("file://${path}");`);
            art.child?.hide();
        });
    }

    /* Charger plugged in or out. Shown even with Do Not Disturb on, like a
       status light: it is the notch reporting the laptop's own state. */
    _peekCharger(info) {
        const pct = info.percentage === null ? null : Math.round(info.percentage);
        const charging = info.state === PowerState.CHARGING;
        // update the pill's battery icon now rather than at the next poll
        this._updateBatteryIcon({
            capacity: pct ?? 0,
            status: charging ? 'charging' : (info.plugged ? 'not charging' : 'discharging'),
            plugged: info.plugged,
        });
        if (this._expanded || !this._settings.get_boolean('show-notifications')) return;

        let title, detail = '', iconName, color;
        if (!info.plugged) {
            title = 'On battery';
            if (info.timeToEmpty > 0) detail = `${this._formatDuration(info.timeToEmpty)} left`;
            iconName = pct >= 90 ? 'battery-full-symbolic' : pct >= 55 ? 'battery-good-symbolic'
                : pct >= 25 ? 'battery-low-symbolic' : 'battery-caution-symbolic';
            color = this._settings.get_string(pct < 20 ? 'battery-low-color' : 'battery-normal-color');
        } else {
            if (info.state === PowerState.FULLY_CHARGED) title = 'Fully charged';
            else if (info.state === PowerState.PENDING_CHARGE) title = 'Plugged in, not charging';   // e.g. a charge limit
            else title = 'Charging';
            if (charging && info.timeToFull > 0) detail = `${this._formatDuration(info.timeToFull)} until full`;
            iconName = 'battery-full-charging-symbolic';
            color = this._settings.get_string('battery-charging-color');
        }

        const icon = new St.Bin({style_class: 'nexnotch-power-peek-icon', y_align: Clutter.ActorAlign.CENTER});
        icon.set_child(new St.Icon({icon_name: iconName, icon_size: 24, style: `color: ${color};`}));
        this._showCompactPeek(icon, [
            [info.plugged ? 'Charger connected' : 'Charger disconnected', 'nexnotch-media-peek-caption'],
            [title, 'nexnotch-media-peek-title'],
            [[pct === null ? '' : `${pct}%`, detail].filter(Boolean).join(' · '), 'nexnotch-media-peek-artist'],
        ], {duration: POWER_PEEK_MS});
    }

    _formatDuration(seconds) {
        const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
        return h ? `${h}h ${m}m` : `${m}m`;
    }

    /* Small peek: a leading widget (art/icon) and up to three text lines.
       Hovering holds it open, leaving dismisses it. Returns the peek. */
    _showCompactPeek(leading, lines, {onClick = null, duration, isMedia = false}) {
        this._dismissPeek(true);

        const peek = new St.BoxLayout({
            style_class: 'nexnotch-peek nexnotch-media-peek',
            vertical: false, x_expand: true, y_expand: true,
            reactive: true, track_hover: true,
        });
        peek.set_style(this._bgStyle);
        if (onClick) {
            peek.connect('button-release-event', (_a, event) => {
                if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
                this._dismissPeek(true);
                onClick();
                return Clutter.EVENT_STOP;
            });
        }

        peek.add_child(leading);
        const text = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'nexnotch-peek-text'});
        for (const [str, cls] of lines)
            if (str) text.add_child(this._ellipsized(str, cls));
        peek.add_child(text);

        this.add_child(peek);
        this._peekLayer  = peek;
        this._peekActive = true;
        this._peekIsMedia = isMedia;
        this._collapsed.hide();

        this.remove_all_transitions();
        peek.opacity = 0;
        peek.set_pivot_point(0.5, 0);
        peek.ease({opacity: 255, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this.ease({width: 420, height: 68, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});

        /* same as notification peeks: hovering holds it, leaving dismisses */
        let hovered = false;
        peek.connect('notify::hover', () => {
            if (this._peekLayer !== peek) return;
            if (peek.hover) {
                hovered = true;
                if (this._peekTimer) { GLib.source_remove(this._peekTimer); this._peekTimer = 0; }
            } else if (hovered) {
                this._dismissPeek(false);
            }
        });

        this._peekTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration, () => {
            this._peekTimer = 0; this._dismissPeek(false); return GLib.SOURCE_REMOVE;
        });
        return peek;
    }

    /* Music tab: album art behind a dark shade, app + output row, title,
       artist, seekable progress and transport controls. */
    _buildMediaCard() {
        const info = this._latestMedia;
        if (!this._mediaPresent())
            return new St.Label({text: 'Nothing playing', style_class: 'nexnotch-empty', x_align: Clutter.ActorAlign.CENTER});
        const mpris = this._modules.mpris;

        const card = new St.Widget({style_class: 'nexnotch-media-card', layout_manager: new Clutter.BinLayout(), x_expand: true});
        const shade = new St.BoxLayout({style_class: 'nexnotch-media-shade', vertical: true, x_expand: true, y_expand: true});
        card.add_child(shade);
        const cover = new St.Bin({style_class: 'nexnotch-media-cover', y_align: Clutter.ActorAlign.CENTER});
        cover.set_child(new St.Icon({icon_name: this._resolveMediaIcon(info.icon) ?? 'audio-x-generic-symbolic', icon_size: 28}));
        this._loadArt(info.artUrl, path => {
            if (this._mediaCard !== card) return;
            const url = `url("file://${path}")`;
            card.set_style(`background-image: ${url};`);
            cover.set_style(`background-image: ${url};`);
            cover.child?.hide();
        });

        const top = new St.BoxLayout({style_class: 'nexnotch-media-top'});
        top.add_child(new St.Icon({icon_name: this._resolveMediaIcon(info.icon) ?? 'audio-x-generic-symbolic', icon_size: 14, y_align: Clutter.ActorAlign.CENTER}));
        const appBtn = new St.Button({
            style_class: 'nexnotch-media-app', label: info.identity || 'Media',
            x_expand: true, x_align: Clutter.ActorAlign.START, can_focus: true,
        });
        appBtn.connect('clicked', () => { mpris.raise(); this._collapse(); });
        top.add_child(appBtn);
        /* lyrics are off until asked for: turning them on is what sends the
           track to lrclib.net */
        const lyricsBtn = new St.Button({style_class: 'nexnotch-media-output', label: 'Lyrics', can_focus: true});
        if (this._showLyrics) lyricsBtn.add_style_pseudo_class('checked');
        lyricsBtn.connect('clicked', () => {
            this._showLyrics = !this._showLyrics;
            this._renderTab();
        });
        top.add_child(lyricsBtn);
        const output = new St.Button({style_class: 'nexnotch-media-output', label: 'Media output', can_focus: true});
        output.connect('clicked', () => {
            /* GNOME's output picker (from the volume slider); Settings as fallback */
            const slider = this._modules.quick.outputSlider();
            if (slider?.menu) { this._modules.quick.openSubmenu(slider); return; }
            this._collapse();
            try { Gio.Subprocess.new(['gnome-control-center', 'sound'], Gio.SubprocessFlags.NONE); }
            catch (e) { logError(e, 'nexnotch:media:output'); }
        });
        top.add_child(output);
        shade.add_child(top);

        /* cover + title/artist */
        const track = new St.BoxLayout({style_class: 'nexnotch-media-track', x_expand: true});
        track.add_child(cover);
        const text = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        text.add_child(this._ellipsized(info.title || 'Unknown', 'nexnotch-media-title'));
        if (info.artist) text.add_child(this._ellipsized(info.artist, 'nexnotch-media-artist'));
        track.add_child(text);
        shade.add_child(track);

        /* wavy progress — click/drag seeks; the position is polled once a second */
        const wave = new WaveBar();
        wave.reactive = info.canSeek;
        const times = new St.BoxLayout({style_class: 'nexnotch-media-times'});
        const elapsed = new St.Label({text: '0:00', x_expand: true});
        times.add_child(elapsed);
        times.add_child(new St.Label({text: info.length ? this._formatTime(info.length) : '', x_align: Clutter.ActorAlign.END}));
        shade.add_child(wave);
        shade.add_child(times);
        let dragging = false;
        wave.connect('scrub', (_w, v) => {
            dragging = true;
            elapsed.text = this._formatTime(v * info.length);
        });
        wave.connect('seek', (_w, v) => {
            dragging = false;
            mpris.setPosition(v * info.length);
            wave.setProgress(v * info.length, info.length, info.playing);
        });

        const ctrls = new St.BoxLayout({style_class: 'nexnotch-media-ctrls', x_align: Clutter.ActorAlign.CENTER});
        const mk = (iconName, cb, accName, enabled, big = false) => {
            const b = new St.Button({
                style_class: 'nexnotch-media-btn' + (big ? ' big' : ''),
                child: new St.Icon({icon_name: iconName}),
                accessible_name: accName, can_focus: true, reactive: enabled,
            });
            if (!enabled) b.add_style_class_name('disabled');
            else b.connect('clicked', cb);
            return b;
        };
        ctrls.add_child(mk('media-skip-backward-symbolic', () => mpris.previous(), 'Previous track', info.canPrev));
        ctrls.add_child(mk(info.playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic',
            () => mpris.playPause(), 'Play/pause', info.canPlay || info.canPause, true));
        ctrls.add_child(mk('media-skip-forward-symbolic', () => mpris.next(), 'Next track', info.canNext));
        shade.add_child(ctrls);

        this._mediaCard = card;
        if (this._showLyrics) shade.add_child(this._buildLyrics(card, info, wave));
        const update = () => {
            mpris.getPosition().then(pos => {
                if (this._mediaCard !== card || dragging || !info.length) return;
                wave.setProgress(pos, info.length, info.playing);
                elapsed.text = this._formatTime(pos);
            });
        };
        update();
        if (this._mediaTimer) GLib.source_remove(this._mediaTimer);
        this._mediaTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            if (this._stopped || this._mediaCard !== card || !this._expanded || this._activeTab !== 'media') {
                this._mediaTimer = 0;
                return GLib.SOURCE_REMOVE;
            }
            update();
            return GLib.SOURCE_CONTINUE;
        });
        return card;
    }

    /* previous / current / next lyric line, following the wave bar's
       (smoothly extrapolated) position */
    _buildLyrics(card, info, wave) {
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

        let lines = null;
        let shown = -2;
        const sync = () => {
            if (!lines) return;
            const i = lineAt(lines, (wave.value * info.length) / 1000);
            if (i === shown) return;
            shown = i;
            prev.text = lines[i - 1]?.text ?? '';
            cur.text  = i >= 0 ? (lines[i].text || '♪') : '♪';
            next.text = lines[i + 1]?.text ?? '';
        };

        this._lyrics ??= new Lyrics();
        this._lyrics.get(info).then(result => {
            if (this._mediaCard !== card) return;
            if (!result) cur.text = 'No lyrics found for this song';
            else if (result.instrumental) cur.text = '♪ Instrumental';
            else if (!result.synced) cur.text = 'Only unsynced lyrics are available';
            else { lines = result.synced; sync(); }
        });

        if (this._lyricsTimer) GLib.source_remove(this._lyricsTimer);
        this._lyricsTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            if (this._stopped || this._mediaCard !== card || !this._expanded || this._activeTab !== 'media') {
                this._lyricsTimer = 0;
                return GLib.SOURCE_REMOVE;
            }
            sync();
            return GLib.SOURCE_CONTINUE;
        });
        return box;
    }

    /* Main tab: the player (while something is playing) above the
       notification history. */
    _buildMainTab() {
        const box = new St.BoxLayout({style_class: 'nexnotch-main', vertical: true, x_expand: true, y_expand: true});
        if (this._mediaPresent()) box.add_child(this._buildMediaCard());
        else this._mediaCard = null;
        box.add_child(this._buildHistory());
        return box;
    }

    _buildHistory() {
        const items = this._modules.notifications.history();
        const section = new St.BoxLayout({style_class: 'nexnotch-hist', vertical: true, x_expand: true});

        const header = new St.BoxLayout({style_class: 'nexnotch-hist-header'});
        header.add_child(new St.Label({text: 'Notifications', style_class: 'nexnotch-hist-heading', x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        if (items.length) {
            const clear = new St.Button({style_class: 'nexnotch-hist-clear', label: 'Clear all', can_focus: true});
            clear.connect('clicked', () => items.forEach(({notif}) => notif.destroy()));
            header.add_child(clear);
        }
        section.add_child(header);

        if (!items.length) {
            section.add_child(new St.Label({text: 'No notifications', style_class: 'nexnotch-hist-empty', x_align: Clutter.ActorAlign.CENTER}));
            return section;
        }

        const list = new St.BoxLayout({style_class: 'nexnotch-hist-list', vertical: true, x_expand: true});
        for (const {source, notif} of items) list.add_child(this._historyRow(source, notif));
        const scroll = new St.ScrollView({
            style_class: 'nexnotch-hist-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
        });
        scroll.set_child(list);
        section.add_child(scroll);
        return section;
    }

    _historyRow(source, notif) {
        const row = new St.BoxLayout({style_class: 'nexnotch-hist-row', reactive: true, track_hover: true, x_expand: true});
        /* click: open it in its app, like GNOME's own list */
        row.connect('button-release-event', (_a, event) => {
            if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
            try { notif.activate(); } catch (e) { logError(e, 'nexnotch:hist:activate'); }
            this._collapse();
            return Clutter.EVENT_STOP;
        });

        row.add_child(new St.Icon({gicon: this._resolveNotifIcon(source, notif), icon_size: 24, style_class: 'nexnotch-hist-icon', y_align: Clutter.ActorAlign.START}));

        const text = new St.BoxLayout({vertical: true, x_expand: true});
        const meta = new St.BoxLayout();
        meta.add_child(this._ellipsized(source?.title ?? '', 'nexnotch-hist-app'));
        meta.add_child(new St.Label({text: this._historyTime(notif.datetime), style_class: 'nexnotch-hist-time'}));
        text.add_child(meta);
        text.add_child(this._ellipsized(notif.title ?? '', 'nexnotch-hist-title'));
        const body = (notif.body ?? '').trim();
        if (body) {
            const b = new St.Label({text: body.length > 220 ? `${body.slice(0, 220)}…` : body, style_class: 'nexnotch-hist-body', x_expand: true});
            b.clutter_text.line_wrap = true;
            b.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            b.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            text.add_child(b);
        }
        row.add_child(text);

        /* ✕ deletes it for good */
        const del = new St.Button({style_class: 'nexnotch-hist-delete', label: '✕', y_align: Clutter.ActorAlign.START, accessible_name: 'Delete notification', can_focus: true});
        del.connect('clicked', () => notif.destroy());
        del.connect('button-release-event', () => Clutter.EVENT_STOP);
        row.add_child(del);
        return row;
    }

    _historyTime(datetime) {
        if (!datetime) return '';
        const now = GLib.DateTime.new_now_local();
        const sameDay = datetime.get_year() === now.get_year() && datetime.get_day_of_year() === now.get_day_of_year();
        return datetime.format(sameDay ? '%H:%M' : '%d %b');
    }

    _resolveMediaIcon(desktopEntry) {
        if (!desktopEntry) return null;
        const app = Shell.AppSystem.get_default().lookup_app(`${desktopEntry}.desktop`);
        if (app) {
            const gicon = app.get_app_info()?.get_icon();
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

    _peekNotification(source, notif) {
        if (this._expanded) return;
        if (!this._settings.get_boolean('show-notifications')) return;   /* master off */
        if (this._dndActive()) return;   /* respect GNOME's Do Not Disturb */
        /* a player's own "song changed" notification would just repeat the
           now-playing peek that is already showing */
        if (this._peekActive && this._peekIsMedia) return;
        this._dismissPeek(true);

        const title = notif?.title ?? source?.title ?? 'Notification';
        const fullBody = (notif?.body ?? notif?.bannerBodyText ?? '').trim();
        /* short preview; hovering the peek reveals the whole text */
        const firstLines = fullBody.split('\n').slice(0, 2).join('\n');
        const shortBody = firstLines.length > 140 ? `${firstLines.slice(0, 140)}…`
            : firstLines + (firstLines.length < fullBody.length ? ' …' : '');
        const body = shortBody;
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
            if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
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
            gicon, icon_size: 28,
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
        const bodyLabel = new St.Label({text: body, style_class: 'nexnotch-peek-body', visible: !!body});
        bodyLabel.clutter_text.line_wrap = true;
        bodyLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        textCol.add_child(bodyLabel);
        peek.add_child(textCol);

        const dismissBtn = new St.Button({
            style_class: 'nexnotch-peek-dismiss',
            label: '✕',
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: 'Dismiss notification',
            can_focus: true,
        });
        /* ✕ deletes the notification; just moving away only dismisses it */
        dismissBtn.connect('clicked', () => {
            this._dismissPeek(false);
            try { notif?.destroy(); } catch (e) { logError(e, 'nexnotch:peek:delete'); }
        });
        /* Stop the click from bubbling up to the peek (which would activate
           the notification on top of deleting it). */
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
        const fit = maxH => GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (this._peekLayer !== peek) return GLib.SOURCE_REMOVE;
            const width = 540;
            const [, natH] = peek.get_preferred_height(width - 40);
            const h = Math.max(72, Math.min(maxH, natH + 20));
            this.ease({width, height: h, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
            return GLib.SOURCE_REMOVE;
        });
        fit(200);

        /* Hover: hold it open and reveal the full text. Leaving: dismiss
           it, but it stays in the Main tab's history. */
        let hovered = false;
        peek.connect('notify::hover', () => {
            if (this._peekLayer !== peek) return;
            if (peek.hover && !hovered) {
                hovered = true;
                if (this._peekTimer) { GLib.source_remove(this._peekTimer); this._peekTimer = 0; }
                if (fullBody !== shortBody) {
                    bodyLabel.text = fullBody;
                    fit(480);
                }
            } else if (!peek.hover && hovered) {
                this._dismissPeek(false);
            }
        });

        this._peekTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PEEK_DURATION_MS, () => {
            this._peekTimer = 0; this._dismissPeek(false); return GLib.SOURCE_REMOVE;
        });
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
        this._peekIsMedia = false;
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
