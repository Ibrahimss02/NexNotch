import QtQuick

/* CONTRACT: cups (today), drink(), due() when a reminder is due (Config.showWater, waterInterval)

   Drink-water reminder (water.js): every `waterInterval` minutes due()
   fires and the countdown restarts straight away; drinking restarts it too.
   Today's cups (one timestamp each) are kept in water.json in the data dir.
   The countdown runs on the monotonic clock, which stops during suspend, so
   it pauses with the laptop. */
QtObject {
    id: root

    readonly property int chartHours: 11
    readonly property string logFile: Sys.dataDir + "/water.json"
    readonly property bool running: Config.showWater

    property var _log: _load()                  // {date: "YYYY-MM-DD", drinks: [unix seconds]}
    property double _startedAt: Sys.monotonicMs()
    property double _now: Sys.monotonicMs()      // ticks, so bindings on level follow the clock

    readonly property int cups: _log.drinks.length
    /* countdown left, 1 → 0 */
    readonly property real level: running
        ? Math.max(0, 1 - (_now - _startedAt) / (Math.max(1, Config.waterInterval) * 60000)) : 1
    readonly property int minutesLeft: Math.max(1, Math.ceil(level * Config.waterInterval))

    signal due()

    function drink() {
        _today();
        _log = {date: _log.date, drinks: [..._log.drinks, Math.floor(Date.now() / 1000)]};
        Sys.writeFile(logFile, JSON.stringify(_log));
        _restart();
    }

    /* cups per hour for the last chartHours hours, oldest first: [{hour, cups}] */
    function hourly() {
        const now = new Date();
        const hours = Array.from({length: chartHours}, (_, i) => {
            const d = new Date(now);
            d.setHours(now.getHours() - (chartHours - 1 - i), 0, 0, 0);
            return {start: d.getTime() / 1000, hour: d.getHours(), cups: 0};
        });
        for (const t of _log.drinks) {
            const h = hours.find(x => t >= x.start && t < x.start + 3600);
            if (h) h.cups++;
        }
        return hours;
    }

    function _restart() {
        _startedAt = _now = Sys.monotonicMs();
    }

    function _dateKey() {
        return Qt.formatDate(new Date(), "yyyy-MM-dd");
    }

    /* a new day starts an empty log */
    function _today() {
        if (_log.date !== _dateKey()) _log = {date: _dateKey(), drinks: []};
    }

    function _load() {
        try {
            const log = JSON.parse(Sys.readFile(logFile) ?? "");
            if (log && Array.isArray(log.drinks)) return log;
        } catch (e) {}
        return {date: "", drinks: []};
    }

    onRunningChanged: _restart()
    property Connections _config: Connections {
        target: Config
        function onWaterIntervalChanged() { root._restart(); }
    }

    property Timer _tick: Timer {
        interval: 5000
        repeat: true
        running: true
        onTriggered: {
            root._today();
            root._now = Sys.monotonicMs();
            if (root.running && root.level <= 0) {
                root._restart();
                root.due();
            }
        }
    }

    Component.onCompleted: _today()
}
