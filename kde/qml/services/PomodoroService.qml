import QtQuick

/* CONTRACT: state "idle"|"work"|"break"|"longbreak"|"paused",
   active (running, not paused), remainText "24:59"

   Pomodoro timer (pomodoro.js): focus/break lengths from the active preset
   ("25/5"), a long break every `pomodoroCycles` focus rounds. Every session
   that ends, finished or reset, is appended to pomodoro.jsonl in the data
   dir (the same log the GNOME extension keeps). */
QtObject {
    id: root

    property string state: "idle"
    property string prev: ""          // the state a pause interrupted
    property int remain: 0            // seconds
    property int cycle: 0             // focus rounds started since the last reset
    readonly property bool active: state !== "idle" && state !== "paused"
    readonly property bool resting: state === "break" || state === "longbreak"
        || (state === "paused" && (prev === "break" || prev === "longbreak"))
    readonly property string remainText: `${Math.floor(remain / 60)}:${String(remain % 60).padStart(2, "0")}`
    readonly property var preset: parsePreset(Config.pomodoroActivePreset)
    readonly property int cycles: Math.max(1, Config.pomodoroCycles)
    readonly property int total: totalFor(state === "paused" ? prev : state)
    readonly property string stateLabel: ({idle: "Ready", work: "Focus", break: "Short break",
        longbreak: "Long break", paused: "Paused"})[state] ?? state

    readonly property string logFile: Sys.dataDir + "/pomodoro.jsonl"
    property var _startedAt: null

    function parsePreset(s) {
        const m = String(s || "25/5").match(/^(\d+)\s*\/\s*(\d+)/);
        return m ? {work: Number(m[1]), brk: Number(m[2])} : {work: 25, brk: 5};
    }

    function totalFor(s) {
        if (s === "work") return preset.work * 60;
        if (s === "longbreak") return Config.pomodoroLong * 60;
        if (s === "break") return preset.brk * 60;
        return 0;
    }

    function startWork() {
        cycle++;
        _run("work");
    }

    function startBreak() {
        _run(cycle > 0 && cycle % cycles === 0 ? "longbreak" : "break");
    }

    function _run(s) {
        state = s;
        remain = totalFor(s);
        _startedAt = new Date();
        _tick.restart();
    }

    function pause() {
        if (!active) return;
        _tick.stop();
        prev = state;
        state = "paused";
    }

    /* continuing, not restarting: the session keeps its start time */
    function resume() {
        if (state !== "paused") return;
        state = prev;
        prev = "";
        _tick.restart();
    }

    function reset() {
        _tick.stop();
        /* aborted sessions are logged too, with completed=false */
        if (active) _log(false);
        state = "idle";
        prev = "";
        remain = 0;
        cycle = 0;
        _startedAt = null;
    }

    function adjustMinutes(delta) {
        if (state === "idle") return;
        remain = Math.max(1, remain + delta * 60);
    }

    function setPreset(p) {
        Config.pomodoroActivePreset = p;
        if (state !== "idle") reset();
    }

    function _complete() {
        const wasWork = state === "work";
        _log(true);
        _notify(wasWork ? "Work cycle complete" : "Break over", wasWork ? "Time for a break!" : "Back to work.");
        if (wasWork) startBreak();
        else startWork();
    }

    function _log(completed) {
        if (!_startedAt) return;
        const ended = new Date();
        const line = JSON.stringify({
            started_at: _startedAt.toISOString(),
            ended_at: ended.toISOString(),
            kind: state,
            preset: Config.pomodoroActivePreset,
            duration_sec: Math.round((ended - _startedAt) / 1000),
            planned_sec: totalFor(state),
            completed,
        }) + "\n";
        Sys.writeFile(logFile, (Sys.readFile(logFile) ?? "") + line);
        /* no double log if a reset follows before the next session starts */
        _startedAt = null;
    }

    /* straight to the notification server: notify-send isn't reliable here */
    function _notify(title, body) {
        DBus.call("session", "org.freedesktop.Notifications", "/org/freedesktop/Notifications",
            "org.freedesktop.Notifications", "Notify",
            ["NexNotch", 0, "alarm-symbolic", title, body, [],
             {"desktop-entry": "io.nexvar.NexNotch", "transient": true}, -1],
            "susssasa{sv}i", (out, err) => { if (err) console.warn("nexnotch: pomodoro notify:", err); });
    }

    property Timer _tick: Timer {
        interval: 1000
        repeat: true
        onTriggered: {
            root.remain--;
            if (root.remain <= 0) { stop(); root._complete(); }
        }
    }

}
