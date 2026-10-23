import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_PATH   = '/org/mpris/MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';

/* One interface per XML: makeProxyWrapper only reads the first interface of
   a node, so a combined XML silently drops the whole Player interface. */
const ROOT_IFACE_XML = `
<node>
  <interface name="org.mpris.MediaPlayer2">
    <property name="Identity"     type="s" access="read"/>
    <property name="DesktopEntry" type="s" access="read"/>
    <method name="Raise"/>
  </interface>
</node>`;

const PLAYER_IFACE_XML = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Metadata"       type="a{sv}" access="read"/>
    <property name="CanGoNext"      type="b" access="read"/>
    <property name="CanGoPrevious"  type="b" access="read"/>
    <property name="CanPlay"        type="b" access="read"/>
    <property name="CanPause"       type="b" access="read"/>
    <property name="CanSeek"        type="b" access="read"/>
    <method name="PlayPause"/>
    <method name="Next"/>
    <method name="Previous"/>
    <method name="SetPosition">
      <arg type="o" direction="in"/>
      <arg type="x" direction="in"/>
    </method>
  </interface>
</node>`;

const RootProxy   = Gio.DBusProxy.makeProxyWrapper(ROOT_IFACE_XML);
const PlayerProxy = Gio.DBusProxy.makeProxyWrapper(PLAYER_IFACE_XML);

function _unwrap(v) {
    return (v && typeof v.deep_unpack === 'function') ? v.deep_unpack() : v;
}

function _extractMeta(metadata) {
    if (!metadata) return {};
    const get = key => (metadata[key] ? _unwrap(metadata[key]) : null);
    const artist = get('xesam:artist');
    return {
        title:   get('xesam:title')  ?? '',
        artist:  Array.isArray(artist) ? artist.join(', ') : (artist ?? ''),
        album:   get('xesam:album')  ?? '',
        artUrl:  get('mpris:artUrl') ?? '',
        length:  Number(get('mpris:length') ?? 0),   // microseconds
        trackId: get('mpris:trackid') ?? '',
    };
}

export const MprisWatcher = GObject.registerClass({
    Signals: {
        'changed': {param_types: [GObject.TYPE_JSOBJECT]},
    },
}, class MprisWatcher extends GObject.Object {
    _init() {
        super._init();
        this._players = new Map();   // busName -> {root, player, propId}
        this._active  = null;        // {name, player, root, status, meta}
        this._cancellable = new Gio.Cancellable();
    }

    start() {
        this._stopped = false;
        this._cancellable = new Gio.Cancellable();
        this._nameOwnerId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus',
            'org.freedesktop.DBus',
            'NameOwnerChanged',
            '/org/freedesktop/DBus',
            null,
            Gio.DBusSignalFlags.NONE,
            (conn, sender, path, iface, signal, params) => {
                const [name, oldOwner, newOwner] = params.deepUnpack();
                if (!name.startsWith(MPRIS_PREFIX)) return;
                if (newOwner && !oldOwner) this._addPlayer(name);
                if (oldOwner && !newOwner) this._removePlayer(name);
            });
        this._listExistingPlayers().catch(e => logError(e, 'nexnotch:mpris'));
    }

    stop() {
        this._stopped = true;
        try { this._cancellable.cancel(); } catch (_) {}
        if (this._nameOwnerId) {
            try { Gio.DBus.session.signal_unsubscribe(this._nameOwnerId); } catch (_) {}
            this._nameOwnerId = 0;
        }
        for (const p of this._players.values()) {
            try { p.player.disconnect(p.propId); } catch (_) {}
        }
        this._players.clear();
        this._active = null;
    }

    destroy() { this.stop(); }

    async _listExistingPlayers() {
        const reply = await new Promise((resolve, reject) => {
            Gio.DBus.session.call(
                'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames',
                null, null, Gio.DBusCallFlags.NONE, -1, this._cancellable,
                (_, res) => {
                    try { resolve(Gio.DBus.session.call_finish(res)); } catch (e) { reject(e); }
                });
        });
        const [names] = reply.deepUnpack();
        for (const n of names) if (n.startsWith(MPRIS_PREFIX)) this._addPlayer(n);
    }

    /* Proxies are created asynchronously so a slow player can't stall the shell. */
    _makeProxy(Wrapper, busName) {
        return new Promise((resolve, reject) => {
            Wrapper(Gio.DBus.session, busName, MPRIS_PATH, (proxy, error) => {
                if (error) reject(error); else resolve(proxy);
            }, this._cancellable);
        });
    }

    async _addPlayer(busName) {
        if (this._players.has(busName)) return;
        this._players.set(busName, null);   // reserve while connecting
        try {
            const [root, player] = await Promise.all([
                this._makeProxy(RootProxy, busName),
                this._makeProxy(PlayerProxy, busName),
            ]);
            if (this._stopped || !this._players.has(busName)) return;
            const propId = player.connect('g-properties-changed', () => {
                if (!this._stopped) this._recompute();
            });
            this._players.set(busName, {root, player, propId});
            this._recompute();
        } catch (e) {
            this._players.delete(busName);
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e, 'nexnotch:mpris:add');
        }
    }

    _removePlayer(busName) {
        const p = this._players.get(busName);
        this._players.delete(busName);
        if (p) { try { p.player.disconnect(p.propId); } catch (_) {} }
        this._recompute();
    }

    _recompute() {
        /* Prefer a playing player; otherwise keep the current one if it is
           merely paused, so the notch doesn't jump between paused players. */
        let best = null;
        for (const [name, p] of this._players) {
            if (!p) continue;
            const status = p.player.PlaybackStatus;
            if (status === 'Playing') { best = {name, ...p, status}; break; }
            if (status === 'Paused' && (!best || name === this._active?.name))
                best = {name, ...p, status};
        }
        if (!best) {
            this._active = null;
            this.emit('changed', {playing: false, paused: false});
            return;
        }
        const meta = _extractMeta(best.player.Metadata);
        this._active = {...best, meta};
        const p = best.player;
        this.emit('changed', {
            playing:  best.status === 'Playing',
            paused:   best.status === 'Paused',
            bus:      best.name,
            icon:     best.root.DesktopEntry || 'audio-x-generic-symbolic',
            identity: best.root.Identity || '',
            ...meta,
            canNext:  p.CanGoNext !== false,
            canPrev:  p.CanGoPrevious !== false,
            canPlay:  p.CanPlay !== false,
            canPause: p.CanPause !== false,
            canSeek:  p.CanSeek === true && meta.length > 0 && !!meta.trackId,
        });
    }

    isActive() { return !!this._active; }

    playPause() { this._callActive('PlayPauseRemote'); }
    next()      { this._callActive('NextRemote'); }
    previous()  { this._callActive('PreviousRemote'); }
    raise()     { try { this._active?.root.RaiseRemote(() => {}); } catch (_) {} }

    /* Position isn't reliably signalled by players, so it is polled. */
    getPosition() {
        return new Promise(resolve => {
            if (!this._active) { resolve(0); return; }
            Gio.DBus.session.call(
                this._active.name, MPRIS_PATH, 'org.freedesktop.DBus.Properties', 'Get',
                new GLib.Variant('(ss)', [PLAYER_IFACE, 'Position']), new GLib.VariantType('(v)'),
                Gio.DBusCallFlags.NONE, 1000, this._cancellable,
                (conn, res) => {
                    try { resolve(Number(conn.call_finish(res).deepUnpack()[0].deepUnpack())); }
                    catch (_) { resolve(0); }
                });
        });
    }

    setPosition(us) {
        const a = this._active;
        if (!a?.meta?.trackId) return;
        try { a.player.SetPositionRemote(a.meta.trackId, Math.round(us), () => {}); }
        catch (e) { logError(e, 'nexnotch:mpris:seek'); }
    }

    _callActive(method) {
        if (!this._active?.player) return;
        try { this._active.player[method](() => {}); } catch (e) { logError(e, 'nexnotch:mpris:call'); }
    }
});
