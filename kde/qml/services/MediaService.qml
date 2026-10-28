import QtQuick
import org.kde.plasma.private.mpris as Mpris

/* The active MPRIS player, through Plasma's own multiplexer (the one its
   media widget uses): it already follows whichever player last started. */
QtObject {
    id: root

    property Mpris.Mpris2Model model: Mpris.Mpris2Model {}
    readonly property var player: model.currentPlayer

    /* plain snapshot the UI binds to; position is left out (see position()) */
    readonly property var info: {
        const p = player;
        if (!p) return null;
        const loop = {[Mpris.LoopStatus.None]: "None", [Mpris.LoopStatus.Track]: "Track", [Mpris.LoopStatus.Playlist]: "Playlist"}[p.loopStatus];
        const shuffle = p.shuffle === Mpris.ShuffleStatus.On ? true : p.shuffle === Mpris.ShuffleStatus.Off ? false : undefined;
        return {
            title: p.track || "",
            artist: p.artist || "",
            album: p.album || "",
            artUrl: p.artUrl ? String(p.artUrl) : "",
            playing: p.playbackStatus === Mpris.PlaybackStatus.Playing,
            paused: p.playbackStatus === Mpris.PlaybackStatus.Paused,
            length: p.length || 0,                 // µs
            canSeek: !!p.canSeek,
            canPrev: !!p.canGoPrevious,
            canNext: !!p.canGoNext,
            canPlay: !!p.canPlay,
            canPause: !!p.canPause,
            canRaise: !!p.canRaise,
            shuffle,
            loop,
            app: p.identity || "",
            desktopEntry: p.desktopEntry || "",
            icon: p.iconName || "",
        };
    }
    readonly property bool active: !!info && (info.playing || info.paused)

    /* cover art as a local file URL ("" until loaded) and colours taken from it */
    property string artPath: ""
    property string blurPath: ""
    property color accent: Theme.spotify
    readonly property LyricsService lyrics: LyricsService {}

    signal trackStarted(var info)
    property string _lastTrackKey: ""
    /* a track already playing when NexNotch starts isn't news */
    property bool _settled: false
    property Timer _settle: Timer { interval: 2000; running: true; onTriggered: root._settled = true }
    property string _artFor: ""

    onInfoChanged: {
        const i = info;
        if (i?.playing && i.title) {
            const key = i.title + "\u0000" + i.artist;
            if (key !== _lastTrackKey) {
                _lastTrackKey = key;
                if (_settled) trackStarted(i);
            }
        }
        if ((i?.artUrl ?? "") !== _artFor) loadArt(i?.artUrl ?? "");
    }

    /* file:// art is used in place; https art (Spotify) is cached by URL hash */
    function loadArt(url) {
        _artFor = url;
        artPath = "";
        blurPath = "";
        accent = Theme.spotify;
        if (!url) return;
        const apply = path => {
            if (_artFor !== url) return;
            artPath = Sys.toUrl(path);
            const c = Sys.coverColors(path);
            if (c) {
                blurPath = c.blur;
                if (c.accent) accent = c.accent;
            }
        };
        if (url.startsWith("file://")) { apply(Sys.toLocalPath(url)); return; }
        if (!url.startsWith("http")) return;
        const path = `${Sys.cacheDir}/art/${Sys.hash(url)}`;
        if (Sys.exists(path)) { Qt.callLater(apply, path); return; }
        Sys.download(url, path, ok => { if (ok) apply(path); });
    }

    /* current position in µs: last reported plus the time since, while playing */
    property double _basePos: 0
    property double _baseAt: 0
    function position() {
        if (!player) return 0;
        return _basePos + (info?.playing ? (Sys.monotonicMs() - _baseAt) * 1000 : 0);
    }
    function syncPosition() {
        if (!player) return;
        player.updatePosition();
        _basePos = player.position;
        _baseAt = Sys.monotonicMs();
    }
    property Connections _posWatch: Connections {
        target: root.player
        function onPositionChanged() { root._basePos = root.player.position; root._baseAt = Sys.monotonicMs(); }
    }
    property Timer _poll: Timer {
        interval: 1000; repeat: true
        running: !!root.info?.playing
        triggeredOnStart: true
        onTriggered: root.syncPosition()
    }

    function playPause() { player?.PlayPause(); }
    function next() { player?.Next(); }
    function previous() { player?.Previous(); }
    function raise() { if (player?.canRaise) player.Raise(); else if (info?.desktopEntry) Windows.activateApp(info.desktopEntry); }
    function seekFraction(f) {
        if (!player || !info?.length) return;
        const target = Math.max(0, Math.min(1, f)) * info.length;
        player.Seek(Math.round(target - player.position));
        _basePos = target;
        _baseAt = Sys.monotonicMs();
    }
    function toggleShuffle() {
        if (!player) return;
        player.shuffle = player.shuffle === Mpris.ShuffleStatus.On ? Mpris.ShuffleStatus.Off : Mpris.ShuffleStatus.On;
    }
    function cycleLoop() {
        if (!player) return;
        const L = Mpris.LoopStatus;
        player.loopStatus = player.loopStatus === L.None ? L.Playlist : player.loopStatus === L.Playlist ? L.Track : L.None;
    }

    /* an app icon for a desktop entry: the app's own, else a generic one */
    function appIcon(entry) {
        if (!entry) return "audio-x-generic-symbolic";
        const app = Sys.appInfo(entry);
        return app.icon || {spotify: "spotify-client"}[entry.toLowerCase()] || entry;
    }
}
