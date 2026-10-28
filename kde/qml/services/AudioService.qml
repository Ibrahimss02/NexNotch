import QtQuick
import org.kde.plasma.private.volume as PA

/* Volume, outputs and microphone use, through plasma-pa (the library the
   Plasma volume widget runs on).
   CONTRACT: volume 0..1 (1 = 100 %, up to maxVolume), muted, sinkName,
   sinks [{id, description, icon, isDefault}], setDefaultSink(id), setVolume(v),
   toggleMute(), micInUse, micStreams [{app, name (media name: a browser's
   tab title), title, binary}], micMuted, toggleMicMute(),
   osd(icon, level, maxLevel, label) for changes made elsewhere while
   Config.replaceOsd. */
QtObject {
    id: root

    readonly property real normal: 65536    // PA_VOLUME_NORM
    readonly property var sink: PA.PreferredDevice.sink
    readonly property var source: PA.PreferredDevice.source
    readonly property real maxVolume: _paConfig.raiseMaximumVolume ? 1.5 : 1
    property PA.GlobalConfig _paConfig: PA.GlobalConfig {}      // plasma-pa's settings (plasmaparc)
    readonly property real volume: sink ? sink.volume / normal : 0
    readonly property bool muted: sink?.muted ?? false
    readonly property string sinkName: sink?.description ?? ""
    property var sinks: []
    readonly property bool micInUse: micStreams.length > 0
    property var micStreams: []
    readonly property bool micMuted: source?.muted ?? false

    signal osd(string icon, real level, real maxLevel, string label)

    function volumeIcon(v, mute) {
        if (mute || v <= 0) return "audio-volume-muted-symbolic";
        return v < 0.34 ? "audio-volume-low-symbolic" : v < 0.67 ? "audio-volume-medium-symbolic" : "audio-volume-high-symbolic";
    }
    function sinkIcon(s) {
        const ff = s.formFactor || "";
        if (/head(phone|set)/.test(ff) || /headphone|headset/i.test(s.iconName)) return "audio-headphones-symbolic";
        if (/hdmi|displayport/i.test(s.name) || s.iconName === "video-display") return "computer-symbolic";
        return "audio-speakers-symbolic";
    }

    /* changes we make ourselves (slider, mute button, output list) show no OSD */
    property double _ownUntil: 0
    function _own() { _ownUntil = Date.now() + 600; }

    function setVolume(v) {
        if (!sink) return;
        _own();
        sink.muted = false;
        sink.volume = Math.round(Math.max(0, Math.min(maxVolume, v)) * normal);
    }
    function toggleMute() { if (sink) { _own(); sink.muted = !sink.muted; } }
    function toggleMicMute() { if (source) source.muted = !source.muted; }
    function setDefaultSink(id) {
        const s = _sinkObjects().find(o => o.index === id);
        if (s) { _own(); s.default = true; }
    }

    // ——— outputs ———

    property PA.SinkModel _sinkModel: PA.SinkModel {}
    function _rows(model) {
        const out = [];
        for (let i = 0; i < model.count; i++) out.push(model.data(model.index(i, 0), model.role("PulseObject")));
        return out;
    }
    /* as the Plasma widget lists them: no dummy output, no unplugged ports */
    function _sinkObjects() {
        return _rows(_sinkModel).filter(s => s && s.name !== "auto_null"
            && !(s.ports.length === 1 && s.ports[0].availability === PA.Port.Unavailable));
    }
    function _syncSinks() {
        sinks = _sinkObjects().map(s => ({id: s.index, description: s.description, icon: sinkIcon(s), isDefault: s.default}));
    }
    property Connections _sinkRows: Connections {
        target: root._sinkModel
        function onRowsInserted() { Qt.callLater(root._syncSinks); }
        function onRowsRemoved() { Qt.callLater(root._syncSinks); }
        function onDataChanged() { Qt.callLater(root._syncSinks); }
        function onModelReset() { Qt.callLater(root._syncSinks); }
    }

    // ——— OSD ———

    /* what's already there at startup isn't news */
    property bool _settled: false
    property Timer _settle: Timer { interval: 2000; running: true; onTriggered: root._settled = true }
    function _showOsd() {
        if (!_settled || !Config.replaceOsd || Date.now() < _ownUntil) return;
        osd(volumeIcon(volume, muted), muted ? 0 : volume, maxVolume, sinkName);
    }
    property Connections _sinkLevel: Connections {
        target: root.sink
        function onVolumeChanged() { root._showOsd(); }
        function onMutedChanged() { root._showOsd(); }
    }
    property string _lastSink: ""
    onSinkChanged: {
        const name = sink?.name ?? "";
        if (_lastSink && name && name !== _lastSink && _settled && Config.replaceOsd && Date.now() >= _ownUntil)
            osd(sinkIcon(sink), -1, 1, sinkName);
        if (name) _lastSink = name;
        _syncSinks();
    }

    /* Plasma's own volume, mute and output-switch OSDs (plasma-pa's kded
       module, which watches plasmaparc) step aside while ours show; the
       user's own settings come back when replaceOsd goes off or we quit. */
    readonly property var _osdKeys: ["VolumeOsd", "MuteOsd", "DefaultOutputDeviceOsd"]
    /* read from the file, not _paConfig: that one is a snapshot from startup */
    function _readPa(key) {
        const text = String(Sys.readFile(Sys.home + "/.config/plasmaparc") ?? "");
        const general = text.split(/^\[/m).find(g => g.startsWith("General]")) ?? "";
        const m = general.match(new RegExp(`^${key}=(\\w+)`, "m"));
        return m ? m[1] === "true" : true;
    }
    /* "on" is plasma-pa's default: drop our entry rather than write it */
    function _writePa(key, on) {
        Sys.runDetached(["kwriteconfig6", "--file", "plasmaparc", "--group", "General", "--key", key, "--notify",
                         ...(on ? ["--delete"] : ["--type", "bool", "false"])]);
    }
    function _syncPlasmaOsd() {
        if (Config.replaceOsd) {
            if (!Config.plasmaOsdBackup) {
                const saved = {};
                for (const key of _osdKeys) saved[key] = _readPa(key);
                Config.plasmaOsdBackup = JSON.stringify(saved);
            }
            for (const key of _osdKeys) _writePa(key, false);
        } else _restorePlasmaOsd();
    }
    function _restorePlasmaOsd() {
        if (!Config.plasmaOsdBackup) return;
        let saved = {};
        try { saved = JSON.parse(Config.plasmaOsdBackup); } catch (e) {}
        for (const key of _osdKeys) _writePa(key, saved[key] ?? true);
        Config.plasmaOsdBackup = "";
    }
    property Connections _config: Connections {
        target: Config
        function onReplaceOsdChanged() { root._syncPlasmaOsd(); }
    }
    property Connections _app: Connections {
        target: Qt.application
        function onAboutToQuit() { root._restorePlasmaOsd(); }
    }

    // ——— microphone ———

    /* Recording streams that are a person using the mic: not level meters
       (Plasma's and pavucontrol's peak detection), not monitors of an
       output, not paused ones. */
    readonly property var _skipApps: ["org.PulseAudio.pavucontrol", "org.gnome.VolumeControl", "com.saivert.pwvucontrol",
                                      "org.kde.plasmashell", "org.kde.kmixd", "org.kde.kmix", "org.kde.plasma.volume"]
    readonly property var _skipBinaries: ["pavucontrol", "pwvucontrol", "plasmashell", "kded6", "systemsettings", "kmix", "nexnotch-kde"]
    property PA.SourceOutputModel _outputModel: PA.SourceOutputModel {}
    property PA.SourceModel _sourceModel: PA.SourceModel {}
    function _syncMic() {
        const monitors = new Set(_rows(_sourceModel).filter(s => s && /\.monitor$/.test(s.name)).map(s => s.index));
        const streams = [];
        for (const o of _rows(_outputModel)) {
            if (!o || o.virtualStream || o.corked || monitors.has(o.deviceIndex)) continue;
            const p = o.properties ?? {};
            const binary = p["application.process.binary"] ?? "";
            if (_skipApps.includes(p["application.id"]) || _skipBinaries.includes(binary)) continue;
            if (p["stream.monitor"] === "true" || /peak detect/i.test(p["media.name"] ?? "")) continue;
            streams.push({
                app: p["application.name"] || o.client?.name || binary,
                name: p["media.name"] ?? o.name ?? "",
                title: p["media.title"] ?? "",
                binary,
            });
        }
        if (JSON.stringify(streams) !== JSON.stringify(micStreams)) micStreams = streams;
    }
    property Connections _outputRows: Connections {
        target: root._outputModel
        function onRowsInserted() { Qt.callLater(root._syncMic); }
        function onRowsRemoved() { Qt.callLater(root._syncMic); }
        function onDataChanged() { Qt.callLater(root._syncMic); }
        function onModelReset() { Qt.callLater(root._syncMic); }
    }

    Component.onCompleted: { _syncSinks(); _syncMic(); _syncPlasmaOsd(); }
}
