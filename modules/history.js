import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {VERTICAL} from './ui.js';

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
        const box = new St.BoxLayout({style_class: 'nexnotch-hist', ...VERTICAL, x_expand: true, y_expand: true});
        if (musicCard) box.add_child(musicCard);
        const items = this._items();
        const header = new St.BoxLayout({style_class: 'nexnotch-hist-header', x_expand: true});
        header.add_child(new St.Label({text: 'Notifications', style_class: 'nexnotch-hist-heading',
            x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        if (items.length) {
            const clear = new St.Button({style_class: 'nexnotch-pill-btn', label: 'Clear', can_focus: true});
            clear.connect('clicked', () => {
                for (const {n} of this._items()) n.destroy();
            });
            header.add_child(clear);
        }
        box.add_child(header);

        if (!items.length) {
            box.add_child(new St.Label({text: 'No notifications', style_class: 'nexnotch-hist-empty', x_align: Clutter.ActorAlign.CENTER}));
            return box;
        }

        const list = new St.BoxLayout({...VERTICAL, x_expand: true, style_class: 'nexnotch-hist-list'});
        for (const {source, n} of items) {
            const card = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true, track_hover: true, reactive: true});
            const row = new St.BoxLayout({style_class: 'nexnotch-hist-card', x_expand: true});
            const icon = new St.Bin({style_class: 'nexnotch-hist-icon', y_align: Clutter.ActorAlign.CENTER,
                child: new St.Icon({gicon: n.gicon ?? source.icon ?? Gio.ThemedIcon.new('dialog-information-symbolic'), icon_size: 20})});
            row.add_child(icon);
            const col = new St.BoxLayout({...VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            const titleRow = new St.BoxLayout({x_expand: true});
            const title = new St.Label({text: n.title || source.title || '', style_class: 'nexnotch-hist-title', x_expand: true});
            title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            titleRow.add_child(title);
            titleRow.add_child(new St.Label({text: timeLabel(n.datetime.to_unix()), style_class: 'nexnotch-hist-time'}));
            col.add_child(titleRow);
            const text = (n.body ?? '').replace(/\s+/g, ' ').trim();
            if (text) {
                const body = new St.Label({text, style_class: 'nexnotch-hist-body', x_expand: true});
                body.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                col.add_child(body);
            }
            row.add_child(col);
            const open = new St.Button({child: row, x_expand: true, can_focus: true, accessible_name: title.text});
            open.connect('clicked', () => {
                n.activate();
                this._notch?._collapse?.();
            });
            card.add_child(open);

            const dismiss = new St.Button({style_class: 'nexnotch-hist-dismiss', opacity: 0,
                child: new St.Icon({icon_name: 'window-close-symbolic'}),
                accessible_name: 'Dismiss notification', can_focus: true});
            dismiss.set_position(2, 2);   // on the icon's corner
            dismiss.connect('clicked', () => n.destroy());
            card.add_child(dismiss);
            card.connect('notify::hover', () => dismiss.ease({opacity: card.hover ? 255 : 0, duration: 120}));
            list.add_child(card);
        }
        /* no visible bar (it drew under the cards); the bottom fades instead */
        const scroll = new St.ScrollView({style_class: 'nexnotch-hist-scroll', x_expand: true, y_expand: true,
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.EXTERNAL});
        scroll.set_child(list);
        box.add_child(scroll);
        return box;
    }
});
