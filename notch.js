import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import Soup from 'gi://Soup?version=3.0';
import GdkPixbuf from 'gi://GdkPixbuf';

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';
import {BarLevel} from 'resource:///org/gnome/shell/ui/barLevel.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';
import {getRfkillManager} from 'resource:///org/gnome/shell/ui/status/rfkill.js';

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
import {WaterReminder, CUP_ICON} from './modules/water.js';
import {Shelf} from './modules/shelf.js';
import {BatteryGlyph, Waveform, VERTICAL} from './modules/ui.js';
import {UpdateChecker} from './modules/updates.js';

const HOVER_DELAY_MS    = 180;
const ISLAND_WIDTH      = 120;   // the hidden notch's hover spot
const ISLAND_DWELL_MS   = 500;   // hidden, it opens only if the cursor stays
const COLLAPSE_DELAY_MS = 300;
const ANIM_MS           = 260;
const PEEK_DURATION_MS  = 4000;
const PEEK_UNHOVER_MS   = 400;
const OSD_MS            = 1500;  // same as GNOME's own OSD
const OSD_SIZE          = [270, 32];
const POWER_PEEK_MS     = 3000;
const SHELF_PEEK_MS     = 2200;
const DEFAULT_ACCENT    = '#1DB954';   // Spotify green, when there's no cover to take a colour from
const SLIDE_PX          = 48;    // how far tab content slides on a switch
const PAGE_PX           = 220;   // drag distance per tab; past half of it the tab flips
const FLICK_MS          = 180;   // how far ahead a flick's speed is projected
const MAX_FLICK_TABS    = 3;
const SCROLL_UNIT_PX    = 10;    // Clutter reports touchpad scroll in ~10 px units
const ICONS_DIR = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('icons');
const ownIcon = name => Gio.FileIcon.new(ICONS_DIR.get_child(`${name}.svg`));
/* window titles (a browser shows its tab's) that mean a call */
const MEETINGS = [
    [/^Meet\b|Google Meet/, 'Google Meet'],
    [/\bZoom (Meeting|Webinar|Workplace)\b/i, 'Zoom'],
    [/Microsoft Teams/i, 'Teams'],
    [/Jitsi Meet/i, 'Jitsi'],
    [/\bWebex\b/i, 'Webex'],
    [/\bWhereby\b/i, 'Whereby'],
    [/\bhuddle\b.*\bSlack\b/i, 'Slack huddle'],
];
const TAB_IDS = ['history', 'system', 'claude', 'calendar', 'notes', 'shelf', 'weather', 'pomodoro', 'water', 'quick'];

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
        this._covered     = false;
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
            shelf:         new Shelf(this._settings, this),
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
        this._modules.pomodoro.connect('tick',              ()          => { this._refreshTab('pomodoro'); this._updatePomodoroIndicator(); });
        this._modules.pomodoro.connect('state',             ()          => { if (this._expanded && this._activeTab === 'pomodoro') this._renderTab(); this._updatePomodoroIndicator(); });
        this._modules.quick.connect('updated',              ()          => { if (this._expanded && this._activeTab === 'quick') this._renderTab(); this._updatePrivacyIndicator(); });
        this._modules.claude.connect('updated',              ()          => { if (this._expanded && this._activeTab === 'claude') this._renderTab(); });
        /* a list opened from another tab (the player's Output) visits Quick
           without becoming the last tab, and goes back when it closes */
        this._modules.quick.connect('show-submenu', () => {
            if (this._activeTab === 'quick') { this._renderTab(); return; }
            this._submenuReturn = this._activeTab;
            this._goToTab('quick');
        });
        this._modules.quick.connect('submenu-closed', () => {
            const back = this._submenuReturn;
            this._submenuReturn = null;
            if (back && this._expanded) this._goToTab(back);
        });
        this._modules.quick.connect('open-settings', (_, which) => {
            this._collapse();
            if (which === 'nexnotch') this._extension.openPreferences();
            else Gio.Subprocess.new(['gnome-control-center'], Gio.SubprocessFlags.NONE);
        });
        this._modules.power.connect('charger-changed',      (_, info)   => this._peekCharger(info));
        /* the countdown only shows whole minutes: refresh when that changes */
        this._modules.water.connect('level', (_, level) => {
            const mins = Math.ceil(level * this._settings.get_int('water-interval'));
            if (mins !== this._waterMins) { this._waterMins = mins; this._refreshTab('water'); }
        });
        this._modules.water.connect('changed',              ()          => { if (this._expanded && this._activeTab === 'water') this._renderTab(); });
        this._modules.water.connect('due',                  ()          => this._peekWater());
        this._modules.shelf.connect('updated',              ()          => { if (this._expanded && this._activeTab === 'shelf') this._renderTab(); });
        this._modules.shelf.connect('drop-zone',            (_, state)  => this._onDropZone(state));

        this._hoverHandlerId = this.connect('notify::hover', () => this._onHoverChanged());
        this.connect('notify::height', () => this._syncRadius());
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
            this._collapsed.set_width(-1);
            const [, natW] = this._collapsed.get_preferred_width(this._ch);
            const w = Math.max(this._cwMin, natW);
            this._collapsed.set_width(w);
            return w;
        } catch (_) { return this._cwMin; }
    }

    /* A window behind the notch (see extension.js): it floats as an island,
       rounded all round, and at rest hides to a spot that still opens it on
       hover. */
    setCovered(covered) {
        if (covered === this._covered) return;
        this._covered = covered;
        this._syncCompact();
        this._resizeCollapsed();
    }

    _compact() {
        return this._covered && !this._expanded && !this._peekActive;
    }

    _restWidth() {
        return this._compact() ? ISLAND_WIDTH : this._measureCollapsedWidth();
    }

    _syncCompact() {
        const compact = this._compact();
        if (compact) this._collapsed.hide();
        else if (!this._expanded && !this._peekActive) this._collapsed.show();
        if (!compact || !this.hover) this._islandDot.hide();
        this._syncRadius(true);
    }

    _resizeCollapsed(animate = true) {
        if (this._expanded || this._peekActive) return;
        const target = this._restWidth();
        if (animate) {
            this._stopSizeAnim();
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
        this._syncRadius(true);

        this._accentColor = accent;

        this._updateBatteryIcon();
    }

    _bgStyleFor(radius) {
        const compact = this._compact?.();
        /* the lyric pill fades from the notch colour into the cover's */
        const gradient = this._lyricTint && !this._expanded && !compact
            ? `background-gradient-direction: vertical; background-gradient-start: ${this._bgColor}; background-gradient-end: ${this._lyricTint};`
            : '';
        return `
            background-color: ${compact ? 'transparent' : this._bgColor};
            border-radius: ${this._radiiFor(radius)};
            ${gradient}
        `;
    }

    /* floating as an island, the top corners round too */
    _radiiFor(radius) {
        const top = this._covered ? radius : 0;
        return `${top}px ${top}px ${radius}px ${radius}px`;
    }

    /* The notch paints its own background too (blur-my-shell defence), so
       both get the radius or its corners would show square behind _bg. */
    _setRadius(radius) {
        this._bg.set_style(this._bgStyleFor(radius));
        this.set_style(`background-color: ${this._compact?.() ? 'transparent' : this._bgColor}; border-radius: ${this._radiiFor(radius)};`);
    }

    /* Bottom corners follow the height: a half-round pill when small, up to
       corner-radius when open. Continuous, so nothing snaps at the end. */
    _syncRadius(force = false) {
        const r = Math.round(Math.min(this._radius, this.height / 2));
        if (!force && r === this._curRadius) return;
        this._curRadius = r;
        this._setRadius(r);
    }

    /* ease() has no spring mode (and a progress func can't be set from
       GJS), so a timeline drives a damped spring: past the target, back,
       settled. Lower damping bounces more; the stiffness is picked so the
       spring has settled by `duration`. */
    _springEase({width, height}, duration, damping = 0.6, onComplete = undefined) {
        this._stopSizeAnim();
        this._targetH = height;
        const [w0, h0] = [this.width, this.height];
        const omega = 5.3 / (damping * duration / 1000);
        const omegaD = omega * Math.sqrt(1 - damping * damping);
        const timeline = new Clutter.Timeline({actor: this, duration});
        timeline.connect('new-frame', (_tl, elapsed) => {
            const t = elapsed / 1000;
            const p = 1 - Math.exp(-damping * omega * t) *
                (Math.cos(omegaD * t) + damping * omega / omegaD * Math.sin(omegaD * t));
            this.set_size(w0 + (width - w0) * p, Math.max(1, h0 + (height - h0) * p));
        });
        timeline.connect('completed', () => {
            this._springTl = null;
            this.set_size(width, height);
            onComplete?.();
        });
        this._springTl = timeline;
        timeline.start();
    }

    _stopSizeAnim() {
        this.remove_all_transitions();
        this._springTl?.stop();
        this._springTl = null;
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
            if (this._expanded) { this._stopSizeAnim(); this.set_size(this._ew, this._expandedHeight()); }
            this._applyColors();
        }
        if (['bg-color', 'accent-color', 'corner-radius',
             'battery-charging-color', 'battery-normal-color', 'battery-low-color'].includes(key)) {
            this._applyColors();
        }
        if (key === 'hide-datemenu') this._hideDateMenuIfRequested();
        if (key === 'show-media-pill') this._updateMedia(this._latestMedia);
        if (key === 'lyrics-enabled') this._syncLyricPill();
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
        /* hidden notch, hovered: a dot first, the notch only after a dwell */
        this._islandDot = new St.Widget({style_class: 'nexnotch-island-dot', visible: false,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._islandDot);

        /* collapsed layout:  [battery] [media]   HH:MM   [date]   [shelf#] */
        this._collapsed = new St.BoxLayout({
            style_class: 'nexnotch-collapsed',
            /* fixed size, pinned top-centre: stays put while the notch grows */
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.START,
            height: this._ch,
        });
        this.add_child(this._collapsed);

        /* left: battery · centre: clock · right: date, timer, playing waveform */
        this._leftCluster = new St.BoxLayout({style_class: 'nexnotch-cluster nexnotch-left'});
        this._batteryIcon = new BatteryGlyph();
        this._batteryIcon.visible = false;
        this._batteryPct = new St.Label({text: '', style_class: 'nexnotch-battery-pct', visible: false, y_align: Clutter.ActorAlign.CENTER});
        this._leftCluster.add_child(this._batteryIcon);
        this._leftCluster.add_child(this._batteryPct);

        this._centerCluster = new St.BoxLayout({
            style_class: 'nexnotch-cluster nexnotch-center',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._clockLabel = new St.Label({text: '', style_class: 'nexnotch-clock', y_align: Clutter.ActorAlign.CENTER});
        this._centerCluster.add_child(this._clockLabel);

        this._rightCluster = new St.BoxLayout({style_class: 'nexnotch-cluster nexnotch-right'});
        this._dateLabelC = new St.Label({text: '', style_class: 'nexnotch-date-mini', x_expand: true, x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER});
        this._pomoChip = new St.BoxLayout({style_class: 'nexnotch-pomo-chip', visible: false, x_expand: true,
            x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER});
        this._pomoChip.add_child(new St.Icon({icon_name: 'alarm-symbolic', style_class: 'nexnotch-pomo-chip-icon', y_align: Clutter.ActorAlign.CENTER}));
        this._pomoLabel = new St.Label({text: '', style_class: 'nexnotch-pomo-mini', y_align: Clutter.ActorAlign.CENTER});
        this._pomoChip.add_child(this._pomoLabel);
        this._wave = new Waveform(4);
        this._wave.visible = false;
        /* DND / airplane icons and camera / mic dots, after the date */
        this._statusBox = new St.BoxLayout({style_class: 'nexnotch-status', visible: false, y_align: Clutter.ActorAlign.CENTER});
        this._statusIcons = {
            dnd: new St.Icon({gicon: ownIcon('moon'), style_class: 'nexnotch-status-icon'}),
            airplane: new St.Icon({gicon: ownIcon('airplane'), style_class: 'nexnotch-status-icon'}),
            camera: new St.Widget({style_class: 'nexnotch-status-dot camera'}),
            mic: new St.Widget({style_class: 'nexnotch-status-dot mic'}),
        };
        for (const w of Object.values(this._statusIcons)) {
            w.visible = false;
            w.y_align = Clutter.ActorAlign.CENTER;
            this._statusBox.add_child(w);
        }
        this._rightCluster.add_child(this._dateLabelC);
        this._rightCluster.add_child(this._statusBox);
        this._rightCluster.add_child(this._pomoChip);
        this._rightCluster.add_child(this._wave);

        this._collapsed.add_child(this._leftCluster);
        this._collapsed.add_child(this._centerCluster);
        this._collapsed.add_child(this._rightCluster);

        /* screen recording / sharing take over the pill: what's happening + a stop button */
        this._pillBtns = [];
        const stopBtn = (child, name) => {
            const b = new St.Button({style_class: 'nexnotch-capture-stop', child, can_focus: true, track_hover: true,
                y_align: Clutter.ActorAlign.CENTER, accessible_name: name});
            b.connect('clicked', () => this._stopCapture());
            this._pillBtns.push(b);
            return b;
        };
        this._recBox = new St.BoxLayout({style_class: 'nexnotch-capture-box', x_expand: true, visible: false});
        const rec = new St.BoxLayout({style_class: 'nexnotch-rec', y_align: Clutter.ActorAlign.CENTER});
        this._recDot = new St.Widget({style_class: 'nexnotch-rec-dot', y_align: Clutter.ActorAlign.CENTER});
        this._recTime = new St.Label({text: 'REC', y_align: Clutter.ActorAlign.CENTER});
        rec.add_child(this._recDot);
        rec.add_child(this._recTime);
        this._recClock = new St.Label({style_class: 'nexnotch-clock', x_expand: true,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        this._recBox.add_child(rec);
        this._recBox.add_child(this._recClock);
        const stopRec = stopBtn(new St.Widget({style_class: 'nexnotch-capture-square'}), 'Stop recording');
        stopRec.add_style_class_name('square');
        this._recBox.add_child(stopRec);
        this._shareBox = new St.BoxLayout({style_class: 'nexnotch-capture-box', x_expand: true, visible: false});
        const share = new St.BoxLayout({style_class: 'nexnotch-share', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        share.add_child(new St.Icon({gicon: ownIcon('screen-share'), style_class: 'nexnotch-share-icon', y_align: Clutter.ActorAlign.CENTER}));
        share.add_child(new St.Label({text: 'Sharing screen', y_align: Clutter.ActorAlign.CENTER}));
        this._shareBox.add_child(share);
        const stopShare = stopBtn(new St.Label({text: 'Stop'}), 'Stop sharing');
        stopShare.add_style_class_name('text');
        this._shareBox.add_child(stopShare);
        this._collapsed.add_child(this._recBox);
        this._collapsed.add_child(this._shareBox);

        /* lyrics on: the line being sung replaces the pill's contents */
        this._lyricBox = new St.BoxLayout({style_class: 'nexnotch-lyric-pill', x_expand: true, visible: false});
        this._lyricBox.add_child(new St.Icon({gicon: ownIcon('note'), style_class: 'nexnotch-lyric-note', y_align: Clutter.ActorAlign.CENTER}));
        this._lyricLabel = new St.Label({style_class: 'nexnotch-lyric-text', y_align: Clutter.ActorAlign.CENTER});
        this._lyricLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._lyricBox.add_child(this._lyricLabel);
        this._collapsed.add_child(this._lyricBox);

        /* in a meeting: which one and for how long; click to go back to it */
        this._meetBox = new St.BoxLayout({style_class: 'nexnotch-meet-pill', x_expand: true, visible: false});
        const meetChip = new St.BoxLayout({style_class: 'nexnotch-meet', y_align: Clutter.ActorAlign.CENTER});
        meetChip.add_child(new St.Icon({gicon: ownIcon('camera'), style_class: 'nexnotch-meet-icon', y_align: Clutter.ActorAlign.CENTER}));
        this._meetLabel = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        meetChip.add_child(this._meetLabel);
        const meetBtn = new St.Button({child: meetChip, can_focus: true, track_hover: true,
            y_align: Clutter.ActorAlign.CENTER, accessible_name: 'Go to the meeting'});
        meetBtn.connect('clicked', () => this._goToMeeting());
        this._pillBtns.push(meetBtn);
        this._meetClock = new St.Label({style_class: 'nexnotch-clock', x_expand: true,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        const meetDots = new St.BoxLayout({style_class: 'nexnotch-status', y_align: Clutter.ActorAlign.CENTER});
        this._meetDots = {
            camera: new St.Widget({style_class: 'nexnotch-status-dot camera', y_align: Clutter.ActorAlign.CENTER}),
            mic: new St.Widget({style_class: 'nexnotch-status-dot mic', y_align: Clutter.ActorAlign.CENTER}),
        };
        meetDots.add_child(this._meetDots.camera);
        meetDots.add_child(this._meetDots.mic);
        this._meetBox.add_child(meetBtn);
        this._meetBox.add_child(this._meetClock);
        this._meetBox.add_child(meetDots);
        this._collapsed.add_child(this._meetBox);

        /* expanded layer */
        this._expandedLayer = new St.BoxLayout({
            style_class: 'nexnotch-expanded',
            ...VERTICAL,
            /* laid out once at the final size; the growing notch reveals it */
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.START,
            width: this._ew,
            opacity: 0,
            visible: false,
        });
        this.add_child(this._expandedLayer);

        this._header = new St.BoxLayout({style_class: 'nexnotch-header'});
        this._bigClock  = new St.Label({text: '', style_class: 'nexnotch-big-clock'});
        const dateCol = new St.BoxLayout({...VERTICAL, x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER});
        this._dateLabel  = new St.Label({text: '', style_class: 'nexnotch-date', x_align: Clutter.ActorAlign.END});
        this._monthLabel = new St.Label({text: '', style_class: 'nexnotch-date-month', x_align: Clutter.ActorAlign.END});
        dateCol.add_child(this._dateLabel);
        dateCol.add_child(this._monthLabel);
        this._header.add_child(this._bigClock);
        this._header.add_child(new St.Widget({x_expand: true}));
        this._header.add_child(dateCol);
        this._expandedLayer.add_child(this._header);

        /* tabs change by swiping; the dots show where you are and can be clicked */
        this._content = new St.Bin({style_class: 'nexnotch-content', x_expand: true, y_expand: true});
        this._dots = new St.BoxLayout({style_class: 'nexnotch-dots', x_align: Clutter.ActorAlign.CENTER});
        this._expandedLayer.add_child(this._content);
        this._expandedLayer.add_child(this._dots);
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
            quick: 'Quick', claude: 'Limits', shelf: 'Shelf', water: 'Water',
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
            shelf:    null,
            water:    null,
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
        this._watchStatus();
        this._updates = new UpdateChecker(this._settings, this._extension.metadata);
        this._updates.start();
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
        const mode = rec?.visible ? 'rec' : share?.visible ? 'share' : null;
        const time = `REC ${rec?._label?.text ?? ''}`.trim();
        const grew = time.length !== this._recTime.text.length;
        this._recTime.text = time;
        if (mode === this._captureMode) {
            if (grew && mode === 'rec') this._resizeCollapsed();
            return;
        }
        this._captureMode = mode;
        this._recDot.remove_all_transitions();
        this._recDot.opacity = 255;
        if (mode === 'rec') {
            this._recDot.ease({opacity: 90, duration: 600, mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                repeatCount: -1, autoReverse: true});
        }
        this._applyPillMode();
    }

    /* what the collapsed pill shows: recording/sharing, else lyrics, else
       battery · clock · date */
    _applyPillMode() {
        const mode = this._captureMode ?? (this._meeting ? 'meet' : null) ?? (this._lyricLines?.length ? 'lyric' : null);
        for (const c of [this._leftCluster, this._centerCluster, this._rightCluster]) c.visible = !mode;
        this._recBox.visible = mode === 'rec';
        this._shareBox.visible = mode === 'share';
        this._lyricBox.visible = mode === 'lyric';
        this._meetBox.visible = mode === 'meet';
        if (mode === 'rec' || mode === 'share') this._collapsed.add_style_class_name('capture');
        else this._collapsed.remove_style_class_name('capture');
        const tint = mode === 'lyric' ? this._shade(this._accent ?? DEFAULT_ACCENT, 0.5) : null;
        if (tint !== this._lyricTint) {
            this._lyricTint = tint;
            this._syncRadius(true);
        }
        this._resizeCollapsed();
    }

    /* Lyrics on and a track playing: fetch its synced lines and follow the
       playback position. No synced lyrics means the normal pill. */
    _syncLyricPill() {
        const info = this._latestMedia;
        const on = this._settings.get_boolean('lyrics-enabled') && this._settings.get_boolean('show-media-pill') &&
            !!info?.playing && !!info.title;
        const key = on ? `${info.artist}|${info.title}|${info.album}` : null;
        if (key !== this._lyricKey) {
            this._lyricKey = key;
            this._lyricLines = null;
            this._lyricShown = -2;
            if (key) {
                this._lyrics ??= new Lyrics();
                this._lyrics.get(info).then(result => {
                    if (this._lyricKey !== key) return;
                    this._lyricLines = result?.synced ?? null;
                    this._pollLyricPosition();
                    this._applyPillMode();
                });
            }
        }
        if (key && !this._lyricTimer) {
            let ticks = 0;
            this._lyricTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                if (++ticks % 4 === 0) this._pollLyricPosition();
                else this._tickLyric();
                return GLib.SOURCE_CONTINUE;
            });
            this._pollLyricPosition();
        } else if (!key && this._lyricTimer) {
            GLib.source_remove(this._lyricTimer);
            this._lyricTimer = 0;
        }
        this._applyPillMode();
    }

    _pollLyricPosition() {
        this._modules.mpris.position(us => {
            this._lyricPos = us;
            this._lyricPosAt = GLib.get_monotonic_time();
            this._tickLyric();
        });
    }

    _tickLyric() {
        const lines = this._lyricLines;
        if (!lines?.length || this._lyricPosAt === undefined) return;
        const us = this._lyricPos + (this._latestMedia?.playing ? GLib.get_monotonic_time() - this._lyricPosAt : 0);
        const i = lineAt(lines, us / 1000);
        if (i === this._lyricShown) return;
        this._lyricShown = i;
        const text = i >= 0 ? (lines[i].text || '• • •') : (this._latestMedia?.title ?? '• • •');
        const label = this._lyricLabel;
        label.remove_all_transitions();
        if (!label.text || !label.is_mapped()) {
            label.text = text;
            label.translation_y = 0;
            label.opacity = 255;
            this._resizeCollapsed();
            return;
        }
        label.ease({translation_y: -10, opacity: 0, duration: 160, mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                label.text = text;
                label.translation_y = 10;
                this._resizeCollapsed();
                label.ease({translation_y: 0, opacity: 255, duration: 260, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
            }});
    }

    /* a hex colour scaled toward black */
    _shade(hex, f) {
        const c = parseInt(hex.slice(1), 16);
        const ch = v => Math.round(v * f).toString(16).padStart(2, '0');
        return `#${ch(c >> 16 & 255)}${ch(c >> 8 & 255)}${ch(c & 255)}`;
    }

    _stopCapture() {
        if (Main.screenshotUI.screencast_in_progress) Main.screenshotUI.stopScreencast();
        else Main.panel.statusArea.screenSharing?._stopSharing?.();
    }

    /* DND, airplane mode, camera and mic: shown in the pill while on, with a
       toast when they change */
    _watchStatus() {
        this._statusState = {};
        this._dndSettings ??= new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._dndSettings.connectObject('changed::show-banners', () => this._onStatus('dnd'), this);
        this._rfkill = getRfkillManager();
        this._rfkill.connectObject('notify::airplane-mode', () => this._onStatus('airplane'), this);
        this._watchPrivacy();
        this._watchMeetings();
        /* Caps Lock only gets the toast, no icon in the pill */
        this._keymap = global.stage.context.get_backend().get_default_seat().get_keymap();
        this._capsLock = this._keymap.get_caps_lock_state();
        this._keymap.connectObject('state-changed', () => {
            const on = this._keymap.get_caps_lock_state();
            if (on === this._capsLock) return;
            this._capsLock = on;
            this._peekToggle('capslock', on);
        }, this);
    }

    /* quick settings creates its indicators asynchronously */
    _watchPrivacy(tries = 0) {
        const qs = Main.panel.statusArea.quickSettings;
        const cam = qs?._camera?._indicator, mic = qs?._volumeInput?._indicator;
        if ((!cam || !mic) && tries < 10) {
            this._privacyRetry = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 2, () => {
                this._privacyRetry = 0;
                this._watchPrivacy(tries + 1);
                return GLib.SOURCE_REMOVE;
            });
            this._syncStatus();
            return;
        }
        cam?.connectObject('notify::visible', () => this._onStatus('camera'), this);
        mic?.connectObject('notify::visible', () => this._onStatus('mic'), this);
        this._privacy = {cam, mic};
        this._syncStatus();
    }

    _statusOn(kind) {
        if (kind === 'dnd') return this._dndActive();
        if (kind === 'airplane') return !!this._rfkill?.airplaneMode;
        if (kind === 'camera') return !!this._privacy?.cam?.visible;
        return !!this._privacy?.mic?.visible;
    }

    _syncStatus() {
        let any = false;
        for (const [kind, w] of Object.entries(this._statusIcons)) {
            w.visible = this._statusState[kind] = this._statusOn(kind);
            any ||= w.visible;
        }
        this._statusBox.visible = any;
        this._resizeCollapsed();
        this._syncMeeting();
    }

    _onStatus(kind) {
        const on = this._statusOn(kind);
        if (on === this._statusState[kind]) return;
        this._syncStatus();
        if (kind === 'camera' || kind === 'mic') {
            if (on && !this._meeting) this._peekPrivacy(kind);
        } else {
            this._peekToggle(kind, on);
        }
    }

    /* A window titled like a call while the camera or mic is on means a
       meeting. It lasts until both go off or its window closes, so
       switching browser tabs meanwhile doesn't end it. */
    _watchMeetings() {
        const track = win => win.connectObject(
            'notify::title', () => this._syncMeeting(),
            'unmanaged', () => {
                if (this._meeting?.win === win) this._meeting.closed = true;
                this._syncMeeting();
            }, this);
        global.get_window_actors().forEach(a => track(a.meta_window));
        global.display.connectObject('window-created', (_d, win) => track(win), this);
    }

    /* A browser names its mic stream after the tab using it, whichever tab
       is showing, so streams come first; window titles cover native apps
       and the camera alone. */
    _findMeeting() {
        const serviceOf = title => MEETINGS.find(([re]) => re.test(title ?? ''))?.[1] ?? null;
        let service = null, app = null;   // app: the stream's owner, e.g. "Zen"
        try {
            for (const out of Volume.getMixerControl().get_source_outputs()) {
                if (service) break;
                service = serviceOf(out.get_description());
                if (service) app = out.get_name()?.toLowerCase();
            }
        } catch (_) {}
        const wins = global.get_window_actors().map(a => a.meta_window);
        for (const win of wins) {
            const found = serviceOf(win.get_title());
            if (found && (!service || found === service)) return {win, service: found};
        }
        if (!service) return null;
        /* the call's tab isn't the one showing: fall back to its browser's window */
        const tracker = Shell.WindowTracker.get_default();
        const win = wins.find(w => tracker.get_window_app(w)?.get_name()?.toLowerCase() === app ||
            w.get_wm_class()?.toLowerCase().includes(app)) ?? null;
        return {win, service};
    }

    _syncMeeting() {
        if (!this._statusState) return;
        const live = this._statusState.camera || this._statusState.mic;
        const was = this._meeting;
        let m = live && was && !was.closed ? was : null;
        if (live && !m) {
            const hit = this._findMeeting();
            if (hit) m = {...hit, since: GLib.get_monotonic_time()};
        }
        this._meeting = m;
        for (const [kind, dot] of Object.entries(this._meetDots)) dot.visible = !!this._statusState[kind];
        if (m && !this._meetTimer) {
            this._tickMeeting();
            this._meetTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._tickMeeting();
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!m && this._meetTimer) {
            GLib.source_remove(this._meetTimer);
            this._meetTimer = 0;
        }
        if (m !== was) this._applyPillMode();
        if (m && !was) this._peekMeeting();
    }

    _tickMeeting() {
        if (!this._meeting) return;
        const s = Math.floor((GLib.get_monotonic_time() - this._meeting.since) / 1e6);
        const pad = n => String(n).padStart(2, '0');
        const time = s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
            : `${Math.floor(s / 60)}:${pad(s % 60)}`;
        const text = `${this._meeting.service} · ${time}`;
        const grew = text.length !== this._meetLabel.text.length;
        this._meetLabel.text = text;
        if (grew) this._resizeCollapsed();
    }

    _goToMeeting() {
        if (this._meeting?.win && !this._meeting.closed) Main.activateWindow(this._meeting.win);
    }

    _stopStatus() {
        if (this._privacyRetry) { GLib.source_remove(this._privacyRetry); this._privacyRetry = 0; }
        if (this._meetTimer) { GLib.source_remove(this._meetTimer); this._meetTimer = 0; }
        global.display.disconnectObject(this);
        global.get_window_actors().forEach(a => a.meta_window.disconnectObject(this));
        this._dndSettings?.disconnectObject(this);
        this._rfkill?.disconnectObject(this);
        this._keymap?.disconnectObject(this);
        this._privacy?.cam?.disconnectObject(this);
        this._privacy?.mic?.disconnectObject(this);
        this._privacy = null;
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
        if (this._lyricTimer) { GLib.source_remove(this._lyricTimer); this._lyricTimer = 0; }
        this._updates?.stop();
        this._updates = null;
        this._springTl?.stop();
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
        this._recDot?.remove_all_transitions();
        this._stopStatus();
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
        this._recClock.text = time;
        this._meetClock.text = time;
        this._bigClock.text   = time;
        this._dateLabelC.text = this._formatCompactDate(now);
        this._dateLabelC.visible = showDate && !this._pomoChip.visible;
        this._dateLabel.text  = now.toLocaleDateString([], {weekday: 'long'});
        this._monthLabel.text = `${now.getDate()} ${now.toLocaleDateString([], {month: 'long'})}`;
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
        if (this._compact()) {
            this._islandDot.show();
            this._islandDot.opacity = 0;
            this._islandDot.ease({opacity: 255, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        }
        /* Don't hijack a notification click: when a peek is visible, the
           user's hover intent is almost always "I'm moving to click the
           banner", not "expand the notch". Suppress expansion while peek
           is up; they can still click the peek body to activate it, or
           wait for the peek to time out before hovering expands. */
        if (this._peekActive) return;
        this._clearHoverTimeout();
        this._hoverTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._compact() ? ISLAND_DWELL_MS : HOVER_DELAY_MS, () => {
            this._hoverTimeout = 0;
            if (this._peekActive) return GLib.SOURCE_REMOVE;
            if (this._pillBtns.some(b => b.hover)) return GLib.SOURCE_REMOVE;
            if (this.hover || this._pointerInside()) this._expand();
            return GLib.SOURCE_REMOVE;
        });
    }

    _scheduleCollapse() {
        this._clearHoverTimeout();
        this._islandDot.hide();
        if (!this._expanded) return;
        this._clearCollapseTimeout();
        this._collapseTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, COLLAPSE_DELAY_MS, () => {
            this._collapseTimeout = 0;
            if (this.hover || this._pointerInside() || this._notesFocused || this._seeking || this._shelfDrop) {
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
        this._islandDot.hide();
        this._syncRadius(true);
        this._expandedLayer.visible = true;
        this._updateClocks();
        this._content.remove_all_transitions();
        this._content.translation_x = 0;
        this._content.opacity = 255;
        this._switchTab(this._shelfPending ? 'shelf' : this._activeTab);
        this._shelfPending = false;
        this._stopSizeAnim();
        this._springEase({width: this._ew, height: this._expandedHeight()}, 640, 0.6);
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
        if (this._passThrough) this._setPassThrough(false);
        if (this._submenuReturn) {   // closed mid-visit: reopen where you were
            this._activeTab = this._submenuReturn;
            this._submenuReturn = null;
        }
        this._shelfDrop = null;
        this._modules?.notes?._releaseGrab?.();
        this._expanded = false;
        this._syncRadius(true);
        this._modules?.system?.setFocused?.(false);
        this._modules?.quick?.setFocused?.(false);
        this._collapsed.show();
        this._stopSizeAnim();
        const targetW = this._restWidth();
        this._springEase({width: targetW, height: this._ch}, 520, 0.78);
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
        this._syncCompact();
    }

    _switchTab(id) {
        if (this._activeTab === 'notes' && id !== 'notes') {
            this._modules?.notes?._releaseGrab?.();
        }
        this._activeTab = id;
        if (!this._submenuReturn && this._settings.get_string('last-tab') !== id) this._settings.set_string('last-tab', id);
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
            this._springEase({width: this._ew, height: target}, 460, 0.75);
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
            water:    {render: () => this._modules.water.render({onSettings: () => { this._collapse(); this._extension.openPreferences(); }})},
            shelf:    {render: () => this._modules.shelf.render(this._shelfDrop)},
            quick:    this._modules.quick,
            claude:   this._modules.claude,
        }[this._activeTab];
        /* System tab gets an optional music card passed in so the whole
           bottom-right corner can be used for media controls when MPRIS
           has an active player. */
        const extraArg = this._activeTab === 'history' ? this._getMusicCard() : this._activeTab;
        const child = mod?.render?.(extraArg);
        /* set_child only unparents the old content; destroy it so its
           cleanups (player timer, Quick mirrors) run now, not at some GC */
        const old = this._content.get_child();
        this._content.set_child(child ?? new St.Label({text: '—', x_align: Clutter.ActorAlign.CENTER}));
        if (old && old !== child) old.destroy();
        if (this._passThrough) this._setPassThrough(true);
        /* nudge height after child lays out */
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (this._stopped) return GLib.SOURCE_REMOVE;
            if (this._expanded) this._resizeExpanded();
            return GLib.SOURCE_REMOVE;
        });
    }

    /* Timer-driven refresh of a tab. Skipped while a mouse button is held:
       rebuilding mid-click would swap the button out from under the press.
       The next tick catches up. */
    _refreshTab(id) {
        if (!this._expanded || this._activeTab !== id) return;
        const [, , mods] = global.get_pointer();
        if (mods & (Clutter.ModifierType.BUTTON1_MASK | Clutter.ModifierType.BUTTON3_MASK)) return;
        this._renderTab();
    }

    _onSystemUpdated(stats) {
        this._latestStats = stats;
        this._updateBatteryIcon(stats.battery);
        this._refreshTab('system');
    }

    _updateBatteryIcon(battery) {
        battery = battery ?? this._latestStats?.battery;
        if (!battery) { this._batteryIcon.visible = this._batteryPct.visible = false; return; }
        const cap = battery.capacity;
        const status = (battery.status ?? '').toLowerCase();
        const plugged = !!battery.plugged;
        const draining = status === 'discharging';

        /* Desktop with no real battery drain: hide icon entirely. */
        if (!draining && !plugged && cap === 0) {
            const wasVisible = this._batteryIcon.visible;
            this._batteryIcon.visible = this._batteryPct.visible = false;
            if (wasVisible) this._resizeCollapsed();
            return;
        }

        const color = plugged || status === 'charging' ? '#30D158' : draining && cap < 20 ? '#FF453A' : '#FFFFFF';
        const wasVisible = this._batteryIcon.visible;
        this._batteryIcon.set(cap / 100, color);
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
        /* the pill shows a live waveform while something plays */
        if (info?.artUrl !== this._accentUrl) {
            this._accentUrl = info?.artUrl;
            this._accent = DEFAULT_ACCENT;
            this._wave.setColor(DEFAULT_ACCENT);
            this._loadArt(info?.artUrl, path => {
                if (this._accentUrl !== info.artUrl) return;
                this._accent = this._coverColors(path)?.accent ?? DEFAULT_ACCENT;
                this._wave.setColor(this._accent);
                this._applyPillMode();
            });
        }
        this._syncLyricPill();
        const show = !!(info?.playing || info?.paused) && this._settings.get_boolean('show-media-pill');
        const changed = show !== this._wave.visible;
        this._wave.visible = show;
        this._wave.setPlaying(show && !!info.playing);
        if (changed) this._resizeCollapsed();
        if (this._expanded && this._activeTab === 'history') this._renderTab();
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

    /* Now Playing card: art-tinted, cover + source + title, waveform, a
       seekable progress line and transport controls. */
    _buildMusicCard() {
        const info = this._latestMedia;
        if (!info || (!info.playing && !info.paused)) return null;
        const mpris = this._modules.mpris;
        /* the blurred cover fills the card; a shade on top keeps text readable */
        const outer = new St.Widget({style_class: 'nexnotch-player', layout_manager: new Clutter.BinLayout(), x_expand: true});
        const card = new St.BoxLayout({style_class: 'nexnotch-player-shade', ...VERTICAL, x_expand: true, y_expand: true});
        outer.add_child(card);
        const accentActors = [];   // tinted with the cover's colour once it loads

        const top = new St.BoxLayout({style_class: 'nexnotch-player-top'});
        const art = new St.Bin({style_class: 'nexnotch-player-art', y_align: Clutter.ActorAlign.CENTER});
        art.set_child(new St.Icon({icon_name: this._resolveMediaIcon(info.icon) ?? 'audio-x-generic-symbolic', icon_size: 26}));
        top.add_child(art);
        const text = new St.BoxLayout({...VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'nexnotch-player-text'});
        let sink = '';
        try { sink = Volume.getMixerControl().get_default_sink()?.get_description() ?? ''; } catch (_) {}
        const srcBox = new St.BoxLayout({style_class: 'nexnotch-player-source-box'});
        srcBox.add_child(new St.Widget({style_class: 'nexnotch-player-dot', y_align: Clutter.ActorAlign.CENTER}));
        srcBox.add_child(this._ellipsized([info.app, sink].filter(Boolean).join(' · '), 'nexnotch-player-source'));
        const source = new St.Button({child: srcBox, x_align: Clutter.ActorAlign.START, can_focus: true, accessible_name: 'Show the player'});
        source.connect('clicked', () => { mpris.raise(); this._collapse(); });
        text.add_child(source);
        text.add_child(this._ellipsized(info.title || 'Unknown', 'nexnotch-player-title'));
        if (info.artist) text.add_child(this._ellipsized(info.artist, 'nexnotch-player-artist'));
        top.add_child(text);
        const wave = new Waveform(5, 'nexnotch-wave large');
        wave.setPlaying(!!info.playing);
        top.add_child(wave);
        card.add_child(top);

        const len = info.length || 0;
        const fmt = us => {
            const sec = Math.max(0, Math.floor(us / 1e6));
            return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
        };
        const progress = new St.BoxLayout({style_class: 'nexnotch-player-progress'});
        const elapsed = new St.Label({text: '0:00', style_class: 'nexnotch-player-time', y_align: Clutter.ActorAlign.CENTER});
        const remain = new St.Label({text: '', style_class: 'nexnotch-player-time end', y_align: Clutter.ActorAlign.CENTER});
        const bar = new Slider(0);
        bar.add_style_class_name('nexnotch-player-bar');
        bar.x_expand = true;
        bar.reactive = !!info.canSeek;
        bar.accessible_name = 'Playback position';
        progress.add_child(elapsed);
        progress.add_child(bar);
        progress.add_child(remain);
        card.add_child(progress);

        let syncLyrics = null, dragging = false, holdUntil = 0;
        let basePos = 0, baseTime = GLib.get_monotonic_time();
        const current = () => basePos + (info.playing ? GLib.get_monotonic_time() - baseTime : 0);
        const show = us => {
            if (!dragging) bar.value = len ? Math.min(1, Math.max(0, us / len)) : 0;
            elapsed.text = fmt(us);
            remain.text = len ? `−${fmt(Math.max(0, len - us))}` : '';
            syncLyrics?.(us);
        };
        bar.connect('drag-begin', () => { dragging = this._seeking = true; });
        bar.connect('notify::value', () => { if (dragging) elapsed.text = fmt(bar.value * len); });
        bar.connect('drag-end', () => {
            dragging = this._seeking = false;
            mpris.seekFraction(bar.value);
            basePos = bar.value * len;
            baseTime = GLib.get_monotonic_time();
            holdUntil = baseTime + 1200000;
            show(basePos);
        });

        const ctrls = new St.BoxLayout({style_class: 'nexnotch-player-ctrls'});
        const btn = (iconName, cb, name, {enabled = true, active = false, cls = ''} = {}) => {
            const b = new St.Button({style_class: `nexnotch-player-btn ${cls}`, child: new St.Icon({icon_name: iconName}),
                accessible_name: name, can_focus: true, reactive: enabled, y_align: Clutter.ActorAlign.CENTER});
            if (!enabled) b.add_style_class_name('disabled');
            if (active) b.add_style_pseudo_class('checked');
            if (enabled && (active || cls.includes('accent'))) accentActors.push(b);
            if (enabled) b.connect('clicked', cb);
            return b;
        };
        ctrls.add_child(btn('format-justify-left-symbolic', () => {
            this._settings.set_boolean('lyrics-enabled', !this._settings.get_boolean('lyrics-enabled'));
            this._musicCardInfo = null;
            this._renderTab();
        }, 'Lyrics', {active: this._settings.get_boolean('lyrics-enabled')}));
        ctrls.add_child(new St.Widget({x_expand: true}));
        const center = new St.BoxLayout({style_class: 'nexnotch-player-transport'});
        center.add_child(btn('media-playlist-shuffle-symbolic', () => mpris.toggleShuffle(), 'Shuffle',
            {enabled: typeof info.shuffle === 'boolean', active: !!info.shuffle}));
        center.add_child(btn('media-skip-backward-symbolic', () => mpris.previous(), 'Previous track', {enabled: info.canPrev, cls: 'main'}));
        center.add_child(btn(info.playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic',
            () => mpris.playPause(), info.playing ? 'Pause' : 'Play', {enabled: info.canPlay || info.canPause, cls: 'main big'}));
        center.add_child(btn('media-skip-forward-symbolic', () => mpris.next(), 'Next track', {enabled: info.canNext, cls: 'main'}));
        center.add_child(btn(info.loop === 'Track' ? 'media-playlist-repeat-song-symbolic' : 'media-playlist-repeat-symbolic',
            () => mpris.cycleLoop(), 'Repeat', {enabled: typeof info.loop === 'string', active: !!info.loop && info.loop !== 'None'}));
        ctrls.add_child(center);
        ctrls.add_child(new St.Widget({x_expand: true}));
        ctrls.add_child(btn('audio-card-symbolic', () => {
            /* GNOME's own output picker from the volume slider; Settings as fallback */
            const slider = this._modules.quick.outputSlider();
            if (slider?.menu) { this._modules.quick.openSubmenu(slider); return; }
            try { Gio.Subprocess.new(['gnome-control-center', 'sound'], Gio.SubprocessFlags.NONE); } catch (e) { logError(e, 'nexnotch:output'); }
            this._collapse();
        }, 'Audio output', {cls: 'accent'}));
        card.add_child(ctrls);

        let alive = true;
        if (this._settings.get_boolean('lyrics-enabled')) {
            const lyr = this._buildLyrics(info, () => alive);
            card.add_child(lyr.box);
            syncLyrics = lyr.sync;
        }
        const tint = accent => {
            wave.setColor(accent);
            accentActors.forEach(a => a.set_style(`color: ${accent};`));
        };
        tint(this._accent ?? DEFAULT_ACCENT);
        this._loadArt(info.artUrl, path => {
            if (!alive) return;
            art.set_style(`background-image: url("file://${path}");`);
            art.child?.hide();
            const colors = this._coverColors(path);
            if (!colors) return;
            outer.set_style(`background-image: url("file://${colors.blur}");`);
            tint(colors.accent);
        });

        /* position is polled each second and advanced locally in between */
        let ticks = 0;
        const poll = () => mpris.position(us => {
            if (!alive || dragging || GLib.get_monotonic_time() < holdUntil) return;
            basePos = us;
            baseTime = GLib.get_monotonic_time();
            show(us);
        });
        poll();
        const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            if (++ticks % 4 === 0) poll();
            else if (!dragging) show(current());
            return GLib.SOURCE_CONTINUE;
        });
        outer.connect('destroy', () => {
            alive = false;
            GLib.source_remove(timer);
            if (dragging) this._seeking = false;
            if (this._musicCard === outer) this._musicCard = null;
        });
        return outer;
    }

    /* From the cover: a heavily blurred copy for the card background (shrunk
       to 24 px and scaled back up, cached beside the art) and a vibrant accent
       colour lifted to a readable brightness. Cached per cover. */
    _coverColors(path) {
        this._coverCache ??= new Map();
        if (this._coverCache.has(path)) return this._coverCache.get(path);
        let result = null;
        try {
            const small = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, 24, 24, false);
            const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'nexnotch', 'art']);
            GLib.mkdir_with_parents(dir, 0o755);
            const blur = GLib.build_filenamev([dir, `${GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, path, -1)}-bg.png`]);
            if (!GLib.file_test(blur, GLib.FileTest.EXISTS)) {
                /* whole cover squeezed to the card's 3:1, upscaled in doublings for a smooth blur */
                let pb = small.scale_simple(12, 12, GdkPixbuf.InterpType.BILINEAR), w = 12, h = 12;
                while (w < 576 || h < 192) {
                    w = Math.min(576, w * 2); h = Math.min(192, h * 2);
                    pb = pb.scale_simple(w, h, GdkPixbuf.InterpType.BILINEAR);
                }
                pb.savev(blur, 'png', [], []);
            }
            const px = small.get_pixels(), stride = small.get_rowstride(), n = small.get_n_channels();
            let best = null, bestScore = -1;
            for (let y = 0; y < small.get_height(); y++) {
                for (let x = 0; x < small.get_width(); x++) {
                    const i = y * stride + x * n;
                    const [r, g, b] = [px[i] / 255, px[i + 1] / 255, px[i + 2] / 255];
                    const max = Math.max(r, g, b), min = Math.min(r, g, b);
                    const sat = max ? (max - min) / max : 0;
                    const score = sat * max * (max > 0.15 ? 1 : 0);
                    if (score > bestScore) { bestScore = score; best = [r, g, b]; }
                }
            }
            result = {blur, accent: bestScore > 0.12 ? this._readable(best) : DEFAULT_ACCENT};
        } catch (e) { logError(e, 'nexnotch:cover'); }
        this._coverCache.set(path, result);
        return result;
    }

    /* keep the hue, force enough saturation and lightness to read on dark */
    _readable([r, g, b]) {
        const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
        let h = 0;
        if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        h = (h * 60 + 360) % 360;
        const l = Math.min(0.72, Math.max(0.6, (max + min) / 2));
        const sl = Math.max(0.6, d / (1 - Math.abs(max + min - 1) || 1));
        const c = (1 - Math.abs(2 * l - 1)) * Math.min(1, sl), xx = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
        const [r1, g1, b1] = h < 60 ? [c, xx, 0] : h < 120 ? [xx, c, 0] : h < 180 ? [0, c, xx] : h < 240 ? [0, xx, c] : h < 300 ? [xx, 0, c] : [c, 0, xx];
        const hex = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
        return `#${hex(r1)}${hex(g1)}${hex(b1)}`;
    }

    /* previous / current / next lyric line; sync(us) follows the wave position */
    _buildLyrics(info, alive) {
        const box = new St.BoxLayout({style_class: 'nexnotch-lyrics', ...VERTICAL, x_expand: true});
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
            const step = i === shown + 1 && box.is_mapped() ? prev.height + box.get_theme_node().get_length('spacing') : 0;
            shown = i;
            prev.text = lines[i - 1]?.text ?? '';
            cur.text  = i >= 0 ? (lines[i].text || '♪') : '♪';
            next.text = lines[i + 1]?.text ?? '';
            /* moving to the next line: start a row lower and glide up, like scrolling */
            box.remove_all_transitions();
            box.translation_y = step;
            if (step) box.ease({translation_y: 0, duration: 340, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        };

        this._lyrics ??= new Lyrics();
        this._lyrics.get(info).then(result => {
            if (!alive()) return;
            if (!result) cur.text = 'No lyrics found for this song';
            else if (result.instrumental) cur.text = '♪ Instrumental';
            else if (!result.synced) cur.text = 'Only unsynced lyrics are available';
            else { lines = result.synced; sync(lastUs); }
        });
        return {box: new St.Bin({child: box, x_expand: true, clip_to_allocation: true}), sync};
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

    /* Compact peek: `content` fills the notch at width×height for `duration`
       ms (0 = until dismissed). Hovering holds it open; leaving dismisses. */
    _showPeek(content, {width, height, duration = PEEK_DURATION_MS, onClick = null, hold = true}) {
        if (this._expanded) return null;
        this._dismissPeek(true);
        const peek = new St.BoxLayout({style_class: 'nexnotch-peek-host', x_expand: true, y_expand: true,
            reactive: true, track_hover: true});
        peek.add_child(content);
        if (onClick) {
            peek.connect('button-release-event', (_a, event) => {
                if (event.get_button() !== 1 || this._peekLayer !== peek) return Clutter.EVENT_PROPAGATE;
                this._dismissPeek(false);
                onClick();
                return Clutter.EVENT_STOP;
            });
        }
        this.add_child(peek);
        this._peekLayer = peek;
        this._peekActive = true;
        this._syncCompact();
        this._collapsed.hide();
        this._stopSizeAnim();
        peek.opacity = 0;
        peek.ease({opacity: 255, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._springEase({width, height}, 520, 0.68);
        if (hold) {
            peek.connect('notify::hover', () => {
                if (this._peekLayer !== peek) return;
                if (peek.hover) this._clearPeekTimer();
                else this._armPeekTimer(PEEK_UNHOVER_MS);
            });
        }
        if (duration) this._armPeekTimer(duration);
        return peek;
    }

    _armPeekTimer(ms) {
        this._clearPeekTimer();
        this._peekTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._peekTimer = 0;
            this._dismissPeek(false);
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearPeekTimer() {
        if (this._peekTimer) { GLib.source_remove(this._peekTimer); this._peekTimer = 0; }
    }

    _ellipsized(text, styleClass) {
        const label = new St.Label({text, style_class: styleClass, x_expand: true});
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        return label;
    }

    /* icon/art · three lines of text · optional trailing widget; 360×80 */
    _peekCard(leading, lines, trailing = null) {
        const row = new St.BoxLayout({style_class: 'nexnotch-peek-row', x_expand: true});
        row.add_child(leading);
        const text = new St.BoxLayout({...VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'nexnotch-peek-text'});
        for (const [str, cls] of lines) if (str) text.add_child(this._ellipsized(str, cls));
        row.add_child(text);
        if (trailing) row.add_child(trailing);
        return row;
    }

    _peekMusic(info) {
        if (this._dndActive() || !this._settings.get_boolean('show-notifications')) return;
        const art = new St.Bin({style_class: 'nexnotch-peek-art', y_align: Clutter.ActorAlign.CENTER});
        art.set_child(new St.Icon({icon_name: this._resolveMediaIcon(info.icon) ?? 'audio-x-generic-symbolic', icon_size: 22}));
        const wave = new Waveform(5, 'nexnotch-wave large');
        wave.setColor(this._accent ?? DEFAULT_ACCENT);
        wave.setPlaying(true);
        const peek = this._showPeek(this._peekCard(art, [
            ['Now Playing', 'nexnotch-peek-caption'],
            [info.title || 'Unknown', 'nexnotch-peek-title'],
            [info.artist, 'nexnotch-peek-body'],
        ], wave), {width: 324, height: 72, onClick: () => { this._switchTab('history'); this._expand(); }});
        this._loadArt(info.artUrl, path => {
            if (!peek || this._peekLayer !== peek) return;
            art.set_style(`background-image: url("file://${path}");`);
            art.child?.hide();
            wave.setColor(this._coverColors(path)?.accent ?? DEFAULT_ACCENT);
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
        if (!this._settings.get_boolean('show-notifications')) return;
        const row = new St.BoxLayout({style_class: 'nexnotch-peek-row compact', x_expand: true});
        const left = new St.BoxLayout({style_class: 'nexnotch-peek-charge', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        let title;
        if (!info.plugged) title = 'On battery';
        else if (info.state === PowerState.FULLY_CHARGED) title = 'Fully charged';
        else if (info.state === PowerState.PENDING_CHARGE) title = 'Not charging';
        else title = 'Charging';
        if (info.plugged) {
            left.add_style_class_name('plugged');
            left.add_child(new St.Icon({gicon: ownIcon('bolt'), style_class: 'nexnotch-peek-charge-icon', y_align: Clutter.ActorAlign.CENTER}));
        } else {
            const glyph = new BatteryGlyph();
            glyph.set((pct ?? 0) / 100, pct !== null && pct < 20 ? '#FF453A' : '#FFFFFF');
            left.add_child(glyph);
        }
        left.add_child(new St.Label({text: title, y_align: Clutter.ActorAlign.CENTER}));
        row.add_child(left);
        if (pct !== null) {
            const value = new St.Label({text: `${pct}%`, style_class: 'nexnotch-peek-charge-pct', y_align: Clutter.ActorAlign.CENTER});
            if (info.plugged) value.add_style_class_name('plugged');
            row.add_child(value);
        }
        this._showPeek(row, {width: 212, height: this._ch, duration: POWER_PEEK_MS});
    }

    /* GNOME's volume / brightness OSD, drawn in the notch. Repeated key
       presses update the same peek and keep it open. Returns false when the
       notch can't show it (expanded, or hidden for fullscreen) so GNOME's
       own OSD is used instead. */
    showOsd(icon, label, level, maxLevel) {
        if (this._expanded || !this.is_mapped()) return false;
        let o = this._osd;
        if (!o || this._peekLayer !== o.peek) {
            const row = new St.BoxLayout({style_class: 'nexnotch-peek-row compact nexnotch-osd', x_expand: true});
            o = this._osd = {
                icon: new St.Icon({style_class: 'nexnotch-osd-icon', y_align: Clutter.ActorAlign.CENTER}),
                level: new BarLevel({style_class: 'nexnotch-osd-level', x_expand: true, y_align: Clutter.ActorAlign.CENTER}),
                text: new St.Label({style_class: 'nexnotch-osd-label', y_align: Clutter.ActorAlign.CENTER}),
            };
            o.text.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            row.add_child(o.icon);
            row.add_child(o.level);
            row.add_child(o.text);
            o.level.value = level ?? 0;
            o.peek = this._showPeek(row, {width: OSD_SIZE[0], height: OSD_SIZE[1], duration: OSD_MS, hold: false});
        } else {
            if (level != null) o.level.ease_property('value', level, {duration: 100, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            this._armPeekTimer(OSD_MS);
        }
        o.icon.gicon = icon;
        o.level.maximum_value = maxLevel > 0 ? maxLevel : 1;
        o.level.visible = level != null;
        /* with a level, the percentage; the label (often a device name) only for level-less OSDs */
        o.text.text = level != null ? `${Math.round(level * 100)}%` : (label ?? '');
        return true;
    }

    /* While the shelf's drop window sits under the notch, nothing in the
       notch, nor the top bar beneath it, may be reactive, or the drag would
       land there instead of the window. Widgets rebuilt during a drag get the
       same treatment. (The top bar can't react during a drag anyway.) */
    _setPassThrough(on) {
        this._passThrough = on;
        const walk = actor => {
            if (on && actor._wasReactive === undefined) {
                actor._wasReactive = actor.reactive;
                actor.reactive = false;
            } else if (!on && actor._wasReactive !== undefined) {
                actor.reactive = actor._wasReactive;
                delete actor._wasReactive;
            }
            for (const child of actor.get_children()) walk(child);
        };
        walk(this);
        walk(Main.layoutManager.panelBox);
    }

    /* A drag near the notch: collapsed, it grows into a drop target (a pill,
       then a big zone while hovered); expanded, the Shelf tab takes the drop. */
    _onDropZone(state) {
        const shelf = this._modules.shelf;
        if (state === 'end') {
            this._setPassThrough(false);
            const added = shelf.items().length - (this._dropCount ?? 0);
            const wasPeek = this._dropPeek;
            this._shelfDrop = null;
            this._dropPeek = false;
            if (this._expanded) { if (this._activeTab === 'shelf') this._renderTab(); return; }
            this._shelfPending ||= added > 0;   // the next open shows the Shelf
            if (added > 0) this._peekShelfAdded(shelf.items().length);
            else if (wasPeek) this._dismissPeek(false);
            return;
        }
        if (!this._shelfDrop) this._dropCount = shelf.items().length;
        this._shelfDrop = state;
        if (this._expanded) {
            if (this._activeTab !== 'shelf') this._switchTab('shelf');
            else this._renderTab();
        } else {
            this._dropPeek = true;
            this._peekDrop(state);
        }
        this._setPassThrough(true);
    }

    _peekDrop(state) {
        const n = this._modules.shelf.items().length;
        const items = `${n} item${n === 1 ? '' : 's'}`;
        const icon = cls => new St.Icon({icon_name: 'folder-download-symbolic', style_class: cls, y_align: Clutter.ActorAlign.CENTER});
        if (state === 'hover') {
            const zone = new St.BoxLayout({style_class: 'nexnotch-drop-zone', ...VERTICAL, x_expand: true, y_expand: true});
            const disc = new St.Bin({style_class: 'nexnotch-drop-disc', x_align: Clutter.ActorAlign.CENTER, child: icon('nexnotch-drop-disc-icon')});
            zone.add_child(disc);
            zone.add_child(new St.Label({text: 'Release to add to Shelf', style_class: 'nexnotch-drop-title', x_align: Clutter.ActorAlign.CENTER}));
            zone.add_child(new St.Label({text: n ? `${items} already on the shelf` : 'Files stay where they are',
                style_class: 'nexnotch-drop-sub', x_align: Clutter.ActorAlign.CENTER}));
            const wrap = new St.Bin({style_class: 'nexnotch-drop-wrap', x_expand: true, y_expand: true, child: zone});
            this._showPeek(wrap, {width: 504, height: 170, duration: 0, hold: false});
            return;
        }
        const row = new St.BoxLayout({style_class: 'nexnotch-peek-row nexnotch-drop-pill', x_expand: true});
        row.add_child(icon('nexnotch-drop-pill-icon'));
        row.add_child(new St.Label({text: 'Drop to add to Shelf', style_class: 'nexnotch-drop-pill-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        if (n) row.add_child(new St.Label({text: items, style_class: 'nexnotch-drop-pill-count', y_align: Clutter.ActorAlign.CENTER}));
        this._showPeek(row, {width: 288, height: 54, duration: 0, hold: false});
    }

    _peekShelfAdded(n) {
        const row = new St.BoxLayout({style_class: 'nexnotch-peek-row compact', x_expand: true});
        const left = new St.BoxLayout({style_class: 'nexnotch-peek-added', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        left.add_child(new St.Bin({style_class: 'nexnotch-peek-added-check', y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: 'object-select-symbolic', style_class: 'nexnotch-peek-added-icon'})}));
        left.add_child(new St.Label({text: 'Added to Shelf', y_align: Clutter.ActorAlign.CENTER}));
        row.add_child(left);
        row.add_child(new St.Label({text: `${n} item${n === 1 ? '' : 's'}`, style_class: 'nexnotch-peek-muted', y_align: Clutter.ActorAlign.CENTER}));
        this._showPeek(row, {width: 234, height: this._ch, duration: SHELF_PEEK_MS,
            onClick: () => { this._switchTab('shelf'); this._expand(); }});
    }

    /* "Do Not Disturb · On" / "Airplane Mode · Off" / "Caps Lock · On" */
    _peekToggle(kind, on) {
        if (!this._settings.get_boolean('show-notifications')) return;
        const [name, iconName] = {dnd: ['Do Not Disturb', 'moon'], airplane: ['Airplane Mode', 'airplane'],
            capslock: ['Caps Lock', 'capslock']}[kind];
        const row = new St.BoxLayout({style_class: `nexnotch-peek-row compact nexnotch-peek-toggle ${kind}`, x_expand: true});
        if (!on) row.add_style_class_name('off');
        const left = new St.BoxLayout({style_class: 'nexnotch-peek-toggle-name', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        left.add_child(new St.Icon({gicon: ownIcon(iconName), style_class: 'nexnotch-peek-toggle-icon',
            opacity: on ? 255 : 110, y_align: Clutter.ActorAlign.CENTER}));
        left.add_child(new St.Label({text: name, y_align: Clutter.ActorAlign.CENTER}));
        row.add_child(left);
        row.add_child(new St.Label({text: on ? 'On' : 'Off', style_class: 'nexnotch-peek-toggle-state', y_align: Clutter.ActorAlign.CENTER}));
        this._showPeek(row, {width: kind === 'capslock' ? 212 : 252, height: this._ch, duration: POWER_PEEK_MS});
    }

    /* camera or mic just started: which one, and the app using the mic */
    _peekPrivacy(kind) {
        if (!this._settings.get_boolean('show-notifications')) return;
        const cam = kind === 'camera';
        const badge = new St.Bin({style_class: `nexnotch-peek-privacy-badge ${kind}`, y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({gicon: ownIcon(cam ? 'camera' : 'mic'), style_class: 'nexnotch-peek-privacy-icon'})});
        const app = cam ? null : this._micApp();
        const row = this._peekCard(badge, [
            [cam ? 'Camera in use' : 'Microphone in use', 'nexnotch-peek-privacy-title'],
            [app ? `by ${app}` : null, 'nexnotch-peek-privacy-app'],
        ]);
        row.add_style_class_name('privacy');
        this._showPeek(row, {width: 270, height: 47, duration: POWER_PEEK_MS});
    }

    _peekMeeting() {
        if (!this._settings.get_boolean('show-notifications')) return;
        const badge = new St.Bin({style_class: 'nexnotch-peek-privacy-badge camera', y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({gicon: ownIcon('camera'), style_class: 'nexnotch-peek-privacy-icon'})});
        const row = this._peekCard(badge, [['In a meeting', 'nexnotch-peek-privacy-title'], [this._meeting.service, 'nexnotch-peek-privacy-app']]);
        row.add_style_class_name('privacy');
        this._showPeek(row, {width: 270, height: 47, duration: POWER_PEEK_MS, onClick: () => this._goToMeeting()});
    }

    _micApp() {
        const skipped = ['org.gnome.VolumeControl', 'org.PulseAudio.pavucontrol'];
        const out = Volume.getMixerControl().get_source_outputs().find(o => !skipped.includes(o.get_application_id()));
        if (!out) return null;
        const id = out.get_application_id();
        return (id && Shell.AppSystem.get_default().lookup_app(`${id}.desktop`)?.get_name()) || out.get_name() || null;
    }

    /* GNOME's "Screenshot captured" notification, as a thumbnail + check */
    _peekScreenshot(notif) {
        const thumb = new St.Bin({style_class: 'nexnotch-peek-shot', y_align: Clutter.ActorAlign.CENTER,
            child: new Clutter.Actor({content: notif.gicon, content_gravity: Clutter.ContentGravity.RESIZE_ASPECT,
                x_expand: true, y_expand: true})});
        const check = new St.Bin({style_class: 'nexnotch-peek-shot-check', y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: 'object-select-symbolic', style_class: 'nexnotch-peek-shot-check-icon'})});
        const row = this._peekCard(thumb, [['Screenshot', 'nexnotch-peek-title'], ['Copied to clipboard', 'nexnotch-peek-body']], check);
        this._showPeek(row, {width: 306, height: 65, duration: POWER_PEEK_MS, onClick: () => notif.activate()});
    }

    _peekWater() {
        if (this._dndActive() || !this._settings.get_boolean('show-notifications')) return;
        const water = this._modules.water;
        const disc = new St.Bin({style_class: 'nexnotch-peek-water', y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({gicon: CUP_ICON, icon_size: 22})});
        const drink = new St.Button({style_class: 'nexnotch-peek-drink', label: 'Drink', can_focus: true,
            y_align: Clutter.ActorAlign.CENTER, accessible_name: 'Log a cup of water'});
        drink.connect('clicked', () => { water.drink(); this._dismissPeek(false); });
        this._showPeek(this._peekCard(disc, [
            ['Time for water', 'nexnotch-peek-title'],
            [`${water.cups()} of ${this._settings.get_int('water-goal')} cups today`, 'nexnotch-peek-body'],
        ], drink), {width: 324, height: 72, onClick: () => { this._switchTab('water'); this._expand(); }});
    }

    _resolveMediaIcon(desktopEntry) {
        if (!desktopEntry) return null;
        const app = Shell.AppSystem.get_default().lookup_app(`${desktopEntry}.desktop`)?.get_app_info();
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
        if (!this._pomoChip) return;
        const state = p?.getState();
        const show = !!p && (p.isActive() || state === 'paused');
        const was = this._pomoChip.visible;
        this._pomoChip.visible = show;
        if (show) {
            this._pomoLabel.text = p.formatRemain();
            this._pomoChip.remove_style_class_name('break');
            this._pomoChip.remove_style_class_name('paused');
            if (state === 'break' || state === 'longbreak') this._pomoChip.add_style_class_name('break');
            else if (state === 'paused') this._pomoChip.add_style_class_name('paused');
        }
        if (show !== was) {
            this._dateLabelC.visible = this._settings.get_boolean('show-date') && !show;
            this._resizeCollapsed();
        }
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
        /* a screenshot is the user's own action, so it shows even in DND */
        const shot = source?.iconName === 'screenshooter-symbolic' && notif?.gicon instanceof St.ImageContent;
        if (this._dndActive() && !shot) return;   /* respect GNOME's Do Not Disturb */
        this._dismissPeek(true);
        if (this._settings.get_boolean('notif-suppress-native')) {
            this._killBanner(0); this._killBanner(60); this._killBanner(220);
        }
        if (shot) { this._peekScreenshot(notif); return; }

        const title = notif?.title ?? source?.title ?? 'Notification';
        let body  = notif?.bannerBodyText ?? notif?.body ?? '';
        /* clamp extremely long notifications */
        const lines = body.split('\n');
        if (lines.length > 6) body = lines.slice(0, 6).join('\n') + '\n…';
        if (body.length > 360) body = body.slice(0, 360) + '…';
        const timeStr = 'now';

        const peek = new St.BoxLayout({
            style_class: 'nexnotch-peek', x_expand: true, y_expand: true,
            reactive: true,
            track_hover: true,
            can_focus: true,
        });

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
        const iconBin = new St.Bin({style_class: 'nexnotch-peek-icon-bin'});
        iconBin.set_child(new St.Icon({
            gicon, icon_size: iconSize,
            style_class: 'nexnotch-peek-icon',
        }));
        /* the dismiss button rides on the icon's corner, so it takes no room */
        const iconWrap = new St.Widget({layout_manager: new Clutter.BinLayout(), y_align: Clutter.ActorAlign.CENTER});
        iconWrap.add_child(iconBin);
        peek.add_child(iconWrap);

        const textCol = new St.BoxLayout({
            ...VERTICAL, x_expand: true, y_expand: true,
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
            child: new St.Icon({icon_name: 'window-close-symbolic'}),
            accessible_name: 'Dismiss notification',
            can_focus: true,
        });
        dismissBtn.set_position(-7, -7);
        dismissBtn.opacity = 0;
        dismissBtn.connect('clicked', () => {
            try { notif?.destroy?.(); } catch (e) { logError(e, 'nexnotch:peek:dismiss'); }
            this._dismissPeek(false);
        });
        /* Stop the click from bubbling up to the peek (which would activate
           the notification on top of dismissing it). */
        dismissBtn.connect('button-release-event', () => Clutter.EVENT_STOP);
        iconWrap.add_child(dismissBtn);

        this.add_child(peek);
        this._peekLayer  = peek;
        this._peekActive = true;
        this._syncCompact();
        this._collapsed.hide();

        this._stopSizeAnim();
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
            const width = 440;
            const [, natH] = peek.get_preferred_height(width - 40);
            const h = Math.max(72, Math.min(240, natH + 22));
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
            dismissBtn.opacity = open ? 255 : 0;
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
                this._syncCompact();
                this._stopSizeAnim();
                this.ease({width: this._restWidth(), height: this._ch, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_EXPO});
            }
        };
        if (immediate) finalize();
        else GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { finalize(); return GLib.SOURCE_REMOVE; });
    }

});
