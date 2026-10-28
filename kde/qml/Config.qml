pragma Singleton
import QtQuick
import QtCore

/* The GNOME schema's keys (org.gnome.shell.extensions.nexnotch), camelCased,
   plus the KDE-only ones at the end. Stored in ~/.config/nexnotch/nexnotch.conf;
   the notch and the settings window share this one object, so changes apply
   live. */
Settings {
    location: StandardPaths.writableLocation(StandardPaths.GenericConfigLocation) + "/nexnotch/nexnotch.conf"

    // modules
    property bool showSystem: true
    property bool showNotifications: true
    property bool showCalendar: true
    property bool showTasks: true
    property bool showWater: true
    property int waterInterval: 10          // minutes, 1–120
    property int waterGoal: 8               // cups, 1–30
    property bool showClaudeUsage: true

    // clock
    property bool showDate: true
    property bool showSeconds: false
    property bool showMediaPill: true
    property bool checkUpdates: true
    property double updateLastCheck: 0      // unix seconds
    property string updateNotified: ""
    property bool lyricsEnabled: false
    property string clockFormat: "24h"      // 24h | 12h

    // size
    property int collapsedWidth: 234        // 140–480
    property int collapsedHeight: 32        // 24–56
    property int expandedWidth: 648         // 420–960
    property int expandedHeight: 280        // 200–480
    property list<string> shelfItems: []             // file URIs
    property string lastTab: "history"
    property int cornerRadius: 40           // 0–60

    // colors
    property string bgColor: "#000000"
    property string accentColor: "#5278aaff"   // rgba(120,170,255,0.32) as #AARRGGBB
    property string batteryChargingColor: "#30D158"
    property string batteryNormalColor: "#ffffff"
    property string batteryLowColor: "#FF453A"

    // performance
    property int pollInterval: 1            // seconds, 1–30

    // notifications
    property int notifAutoDismiss: 8        // seconds, 0 = never
    property bool notifSuppressNative: true // hide Plasma's own popups while the notch shows them

    // notes
    property string notesFolder: ""         // empty = ~/Documents/NexNotch Notes

    // weather
    property string weatherLocation: ""     // city or lat,lon; empty = by IP
    property string weatherLocationLabel: ""
    property string weatherLocation2: ""
    property string weatherLocation2Label: ""
    property string weatherUnit: "metric"   // metric | imperial
    property int weatherRefresh: 30         // minutes, 5–240

    // claude usage
    property int claudeUsageRefresh: 15     // minutes, 5–120

    // pomodoro
    property int pomodoroLong: 15
    property int pomodoroCycles: 4
    property list<string> pomodoroPresets: ["50/10", "25/5", "10/2"]
    property string pomodoroActivePreset: "25/5"

    // calendar / tasks filters (empty = all)
    property list<string> calendarEnabledSources: []
    property list<string> tasksEnabledLists: []

    // ——— KDE only ———
    property bool reserveSpace: true        // maximized windows stop below the collapsed notch
    property bool islandWhenCovered: true   // hidden while a window is behind it; opens as a floating island
    property bool replaceOsd: true          // volume/brightness OSD in the notch instead of Plasma's
    property var calendarFeeds: []          // [{name, url, color}] iCal (.ics) links, e.g. Google's secret address
    property string googleClientId: ""      // optional: Google Calendar + Tasks through your own OAuth client
    property string googleClientSecret: ""
    property bool autostart: true

    // quick settings
    property string plasmaOsdBackup: ""     // plasma-pa's own OSD switches while ours replace them (JSON)
    property string lightColorScheme: ""    // the user's own light / dark colour schemes, for Dark Style
    property string darkColorScheme: ""
}
