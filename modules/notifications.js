import GObject from 'gi://GObject';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const NotificationPeek = GObject.registerClass({
    Signals: {
        'peek': {param_types: [GObject.TYPE_JSOBJECT, GObject.TYPE_JSOBJECT]},
        'history-changed': {},
    },
}, class NotificationPeek extends GObject.Object {
    _init(settings) {
        super._init();
        this._settings = settings;
        this._sourceAddedId = 0;
        this._sourceConns = new Map();
        this._pendingDismiss = new Map();
    }

    start() {
        const tray = Main.messageTray;
        if (!tray) return;
        this._sourceAddedId = tray.connect('source-added', (_, source) => this._trackSource(source));
        this._sourceRemovedId = tray.connect('source-removed', () => this._historyChanged());
        for (const source of tray.getSources()) this._trackSource(source);
    }

    /* Everything still in GNOME's message tray, newest first. */
    history() {
        const items = [];
        for (const source of Main.messageTray?.getSources() ?? []) {
            for (const notif of source.notifications ?? [])
                items.push({source, notif});
        }
        const t = n => n.datetime?.to_unix?.() ?? 0;
        return items.sort((a, b) => t(b.notif) - t(a.notif));
    }

    _historyChanged() {
        if (this._historyIdle) return;   // coalesce bursts (e.g. "clear all")
        this._historyIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._historyIdle = 0;
            this.emit('history-changed');
            return GLib.SOURCE_REMOVE;
        });
    }

    stop() {
        if (this._sourceAddedId) {
            try { Main.messageTray.disconnect(this._sourceAddedId); } catch (_) {}
            this._sourceAddedId = 0;
        }
        if (this._sourceRemovedId) {
            try { Main.messageTray.disconnect(this._sourceRemovedId); } catch (_) {}
            this._sourceRemovedId = 0;
        }
        if (this._historyIdle) { GLib.source_remove(this._historyIdle); this._historyIdle = 0; }
        for (const [source, rec] of this._sourceConns) {
            try { if (rec?.addedId)   source.disconnect(rec.addedId);   } catch (_) {}
            try { if (rec?.removedId) source.disconnect(rec.removedId); } catch (_) {}
            try { if (rec?.destroyId) source.disconnect(rec.destroyId); } catch (_) {}
        }
        this._sourceConns.clear();
        for (const t of this._pendingDismiss.values()) GLib.source_remove(t);
        this._pendingDismiss.clear();
    }

    destroy() { this.stop(); }

    _trackSource(source) {
        if (this._sourceConns.has(source)) return;
        const addedId = source.connect('notification-added', (_, notif) => this._onNotif(source, notif));
        const removedId = source.connect('notification-removed', () => this._historyChanged());
        const destroyId = source.connect('destroy', () => {
            const rec = this._sourceConns.get(source);
            if (rec?.addedId)   { try { source.disconnect(rec.addedId); }   catch (_) {} }
            if (rec?.removedId) { try { source.disconnect(rec.removedId); } catch (_) {} }
            this._sourceConns.delete(source);
            this._historyChanged();
        });
        this._sourceConns.set(source, {addedId, removedId, destroyId});
    }

    _onNotif(source, notif) {
        this.emit('peek', source, notif);
        this._historyChanged();

        const ttl = this._settings.get_int('notif-auto-dismiss');
        if (ttl <= 0) return;
        if (this._isResident(notif)) return;

        const timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, ttl, () => {
            this._pendingDismiss.delete(notif);
            try {
                if (notif && typeof notif.destroy === 'function') notif.destroy();
            } catch (e) { logError(e, 'nexnotch:notifications'); }
            return GLib.SOURCE_REMOVE;
        });
        this._pendingDismiss.set(notif, timer);

        try {
            notif.connect?.('destroy', () => {
                const t = this._pendingDismiss.get(notif);
                if (t) { GLib.source_remove(t); this._pendingDismiss.delete(notif); }
            });
        } catch (_) {}
    }

    _isResident(notif) {
        if (!notif) return false;
        if (notif.resident) return true;
        if (notif.urgency === 2) return true;
        if (notif.isTransient === false && notif.acknowledged === false && notif.urgency === 2) return true;
        return false;
    }
});
