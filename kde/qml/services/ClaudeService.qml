import QtQuick

/* Reads the local Claude Code CLI's own OAuth token (the one the `claude`
   binary already holds) and asks Anthropic's usage endpoint how much of the
   current session/weekly quota has been used — the same first-party
   endpoint the CLI queries. The token is only ever sent to api.anthropic.com
   and nothing is written back. Without a login (or with an expired token)
   it reports "unavailable" rather than running an OAuth flow itself.

   CONTRACT:
   usage: the endpoint's reply, {five_hour: {utilization, resets_at}, seven_day: {…}, …}, or null
   error: why the last check failed ("" when it didn't)
   loading: a check is in flight
   refresh(): check now */
QtObject {
    id: root
    property var usage: null
    property string error: ""
    property bool loading: false

    readonly property bool active: Config.showClaudeUsage
    readonly property string _credentials: Sys.home + "/.claude/.credentials.json"

    function _token() {
        try { return JSON.parse(Sys.readFile(_credentials) ?? "null")?.claudeAiOauth?.accessToken ?? null; }
        catch (e) { return null; }
    }

    function refresh() {
        const token = _token();
        if (!token) { error = "No Claude Code login found (run `claude` once to sign in)"; return; }
        loading = true;
        Sys.http("GET", "https://api.anthropic.com/api/oauth/usage",
                 {"Authorization": `Bearer ${token}`, "anthropic-version": "2023-06-01"}, "",
                 (status, body) => {
            loading = false;
            if (!active) return;
            if (status < 200 || status >= 300) {
                error = status ? `Usage check failed (${status}) — try running \`claude\` to refresh your session`
                               : "Couldn't reach api.anthropic.com";
                return;
            }
            try { usage = JSON.parse(body); error = ""; }
            catch (e) { error = String(e.message ?? e); }
        });
    }

    property Timer _timer: Timer {
        interval: Math.max(1, Config.claudeUsageRefresh) * 60000
        running: root.active
        repeat: true
        triggeredOnStart: true
        onTriggered: root.refresh()
    }
    onActiveChanged: if (!active) { usage = null; error = ""; }
}
