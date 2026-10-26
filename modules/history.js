import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const MAX_ROWS = 50;

function timeLabel(unix) {
    const t = GLib.DateTime.new_from_unix_local(unix);
    const now = GLib.DateTime.new_now_local();
    return t.format(t.get_day_of_year() === now.get_day_of_year() && t.get_year() === now.get_year()
        ? '%H:%M' : '%d %b');
}

/* Reads GNOME's own notification list (the one the date menu shows), so
   history is whatever the Shell still holds — nothing stored on our side. */
export const NotificationHistory = GObject.registerClass({
    Signals: {
        'updated': {},
    },
}, class NotificationHistory extends GObject.Object {
    _init(notch) {
        super._init();
        this._notch = notch;
    }

    start() {
        const tray = Main.messageTray;
        if (!tray) return;
        tray.connectObject(
            'source-added', (_, source) => { this._track(source); this.emit('updated'); },
            'source-removed', () => this.emit('updated'),
            this);
        for (const source of tray.getSources()) this._track(source);
    }

    stop() {
        try {
            Main.messageTray.disconnectObject(this);
            for (const source of Main.messageTray.getSources()) source.disconnectObject(this);
        } catch (_) {}
    }

    destroy() { this.stop(); }

    _track(source) {
        source.connectObject(
            'notification-added', () => this.emit('updated'),
            'notification-removed', () => this.emit('updated'),
            this);
    }

    _items() {
        return Main.messageTray.getSources()
            .flatMap(source => source.notifications.map(n => ({source, n})))
            .sort((a, b) => b.n.datetime.to_unix() - a.n.datetime.to_unix())
            .slice(0, MAX_ROWS);
    }

    render(musicCard) {
        const box = new St.BoxLayout({style_class: 'nexnotch-notes', vertical: true, x_expand: true, y_expand: true});
        const header = new St.BoxLayout({style_class: 'nexnotch-notes-header', x_expand: true});
        header.add_child(new St.Label({text: 'Notifications', style_class: 'nexnotch-notes-heading',
            x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        box.add_child(header);
        if (musicCard) box.insert_child_below(musicCard, header);

        const items = this._items();
        if (!items.length) {
            box.add_child(new St.Label({text: 'No notifications.', style_class: 'nexnotch-notes-info'}));
            return box;
        }

        const clear = new St.Button({style_class: 'nexnotch-notes-clear', label: 'Clear all', can_focus: true});
        clear.connect('clicked', () => {
            for (const {n} of this._items()) n.destroy();
        });
        header.add_child(clear);

        const scroll = new St.ScrollView({style_class: 'nexnotch-notes-scroll', x_expand: true, y_expand: true});
        const list = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'nexnotch-notes-list'});
        for (const {source, n} of items) {
            const card = new St.BoxLayout({style_class: 'nexnotch-notes-card', x_expand: true});

            const row = new St.BoxLayout({style_class: 'nexnotch-scratch-row', x_expand: true});
            row.add_child(new St.Icon({
                gicon: n.gicon ?? source.icon ?? Gio.ThemedIcon.new('dialog-information-symbolic'),
                icon_size: 24, y_align: Clutter.ActorAlign.CENTER,
            }));
            const col = new St.BoxLayout({vertical: true, x_expand: true});
            const titleRow = new St.BoxLayout({x_expand: true});
            titleRow.add_child(new St.Label({text: n.title || source.title || '', style_class: 'nexnotch-scratch-title', x_expand: true}));
            titleRow.add_child(new St.Label({text: timeLabel(n.datetime.to_unix()), style_class: 'nexnotch-scratch-time'}));
            col.add_child(titleRow);
            const body = (n.body ?? '').replace(/\s+/g, ' ').trim();
            if (body) col.add_child(new St.Label({text: body, style_class: 'nexnotch-scratch-preview'}));
            row.add_child(col);

            const open = new St.Button({child: row, x_expand: true, can_focus: true});
            open.connect('clicked', () => {
                n.activate();
                this._notch?._collapse?.();
            });
            card.add_child(open);

            const dismiss = new St.Button({style_class: 'nexnotch-peek-dismiss', label: '✕',
                y_align: Clutter.ActorAlign.CENTER, accessible_name: 'Dismiss notification', can_focus: true});
            dismiss.connect('clicked', () => n.destroy());
            card.add_child(dismiss);

            list.add_child(card);
        }
        scroll.set_child(list);
        box.add_child(scroll);
        return box;
    }
});
