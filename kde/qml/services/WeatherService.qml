import QtQuick

/* Weather from wttr.in's j1 JSON, as weather.js: a primary and an optional
   secondary location (empty primary = located by IP), refreshed every
   Config.weatherRefresh minutes. The last good reply of each is cached so the
   tab has something to show straight after login. */
QtObject {
    id: root

    readonly property bool hasSecond: Config.weatherLocation2.trim() !== ""
    readonly property string label1: Config.weatherLocationLabel || Config.weatherLocation || "Primary"
    readonly property string label2: Config.weatherLocation2Label || Config.weatherLocation2
    property int active: 1                  // which location the tab shows
    readonly property var current: _view(active === 2 && hasSecond ? _data2 : _data1)
    property string error: ""
    readonly property bool imperial: Config.weatherUnit === "imperial"

    function refresh() {
        _fetch(1);
        if (hasSecond) _fetch(2);
    }

    /* wttr.in weather codes → icon names */
    function icon(code) {
        const c = Number(code);
        if (c === 113) return "weather-clear-symbolic";
        if (c === 116) return "weather-few-clouds-symbolic";
        if ([143, 248, 260].includes(c)) return "weather-fog-symbolic";
        if ([200, 386, 389, 392, 395].includes(c)) return "weather-storm-symbolic";
        if ([179, 182, 185, 227, 230, 317, 320, 323, 326, 329, 332, 335, 338, 350, 362, 365, 368, 371, 374, 377].includes(c)) return "weather-snow-symbolic";
        if ([176, 263, 266, 281, 284, 293, 296, 353].includes(c)) return "weather-showers-scattered-symbolic";
        if ([299, 302, 305, 308, 311, 314, 356, 359].includes(c)) return "weather-showers-symbolic";
        return "weather-overcast-symbolic";
    }

    property var _data1: null
    property var _data2: null

    function _cachePath(slot) { return `${Sys.cacheDir}/weather-${slot}.json`; }
    function _load(slot) {
        try {
            const d = JSON.parse(Sys.readFile(_cachePath(slot)) || "null");
            /* a cached reply for another place would mislead */
            return d && d._loc === (slot === 2 ? Config.weatherLocation2 : Config.weatherLocation) ? d : null;
        } catch (e) { return null; }
    }

    function _fetch(slot) {
        const loc = (slot === 2 ? Config.weatherLocation2 : Config.weatherLocation).trim();
        Sys.http("GET", `https://wttr.in/${encodeURIComponent(loc)}?format=j1`, {}, "", (code, body) => {
            if (code < 200 || code >= 300) { error = code ? `wttr.in ${code}` : "offline"; return; }
            let data;
            try { data = JSON.parse(body); }
            catch (e) { error = "wttr.in returned non-JSON (rate-limited?)"; return; }
            if (!data.current_condition?.length) { error = "wttr.in: unknown location"; return; }
            data._loc = slot === 2 ? Config.weatherLocation2 : Config.weatherLocation;
            Sys.writeFile(_cachePath(slot), JSON.stringify(data));
            if (slot === 2) _data2 = data; else _data1 = data;
            error = "";
        });
    }

    /* the j1 reply reduced to what the tab shows, in the chosen unit */
    function _view(d) {
        const cur = d?.current_condition?.[0];
        if (!cur) return null;
        const f = imperial;
        const t = (c, fh) => Number(f ? fh : c);
        const uv = Number(cur.uvIndex);
        return {
            area: d.nearest_area?.[0]?.areaName?.[0]?.value ?? "—",
            desc: cur.weatherDesc?.[0]?.value ?? "",
            code: cur.weatherCode,
            temp: t(cur.temp_C, cur.temp_F),
            feels: t(cur.FeelsLikeC, cur.FeelsLikeF),
            humidity: Number(cur.humidity),
            wind: Number(f ? cur.windspeedMiles : cur.windspeedKmph),
            windUnit: f ? "mph" : "km/h",
            uv,
            uvWord: uv <= 2 ? "Low" : uv <= 5 ? "Moderate" : uv <= 7 ? "High" : uv <= 10 ? "Very high" : "Extreme",
            days: (d.weather ?? []).slice(0, 3).map(w => ({
                date: w.date,
                code: w.hourly?.[4]?.weatherCode,   // midday
                min: t(w.mintempC, w.mintempF),
                max: t(w.maxtempC, w.maxtempF),
            })),
        };
    }

    property Timer _timer: Timer {
        interval: Math.max(5, Config.weatherRefresh) * 60000
        repeat: true; running: true
        onTriggered: root.refresh()
    }
    property Connections _config: Connections {
        target: Config
        function onWeatherLocationChanged() { root._data1 = null; root._fetch(1); }
        function onWeatherLocation2Changed() {
            root._data2 = null;
            if (root.hasSecond) root._fetch(2);
            /* the secondary was on show and is gone: back to the primary */
            else root.active = 1;
        }
    }

    Component.onCompleted: {
        _data1 = _load(1);
        if (hasSecond) _data2 = _load(2);
        refresh();
    }
}
