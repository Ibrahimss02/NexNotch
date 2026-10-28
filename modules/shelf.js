import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {VERTICAL} from './ui.js';

const HELPER = GLib.build_filenamev([GLib.path_get_dirname(import.meta.url.replace('file://', '')), 'dropzone.js']);
const PER_ROW = 5;
const NEAR_PX = 80;   // how close a drag must come to the notch to open the drop zone

/* File shelf. GNOME Shell sees a drag move but never its files on Wayland,
   so each drag starts an invisible helper window (dropzone.js): 1×1 px out of
   the way, then over the notch once the drag comes near, to receive the drop.
   GTK takes about a second to start, hence starting at drag begin. Items are kept as
   URIs in the shelf-items setting; files stay where they are. */
export const Shelf = GObject.registerClass({
    Signals: {
        'updated': {},
        // 'near' (drag close, drop window up) | 'hover' (over it) | 'end'
        'drop-zone': {param_types: [GObject.TYPE_STRING]},
    },
}, class Shelf extends GObject.Object {
    _init(settings, notch) {
        super._init();
        this._settings = settings;
        this._notch = notch;
    }

    start() {
        const dnd = global.backend.get_dnd();
        this._dndIds = [
            dnd.connect('dnd-enter', () => this._startHelper()),
            dnd.connect('dnd-position-change', (_d, x, y) => this._onDragMove(x, y)),
            dnd.connect('dnd-leave', () => this._onDragEnd()),
        ];
        this._winId = global.display.connect('window-created', (_d, win) => this._onWindow(win));
    }

    stop() {
        const dnd = global.backend.get_dnd();
        for (const id of this._dndIds ?? []) dnd.disconnect(id);
        this._dndIds = [];
        if (this._winId) { global.display.disconnect(this._winId); this._winId = 0; }
        this._killHelper();
    }

    destroy() { this.stop(); }

    items() { return this._settings.get_strv('shelf-items'); }

    add(uris) {
        const items = this.items().filter(u => !uris.includes(u));
        this._settings.set_strv('shelf-items', [...items, ...uris]);
        this.emit('updated');
    }

    remove(uri) {
        this._settings.set_strv('shelf-items', this.items().filter(u => u !== uri));
        this.emit('updated');
    }

    clear() {
        this._settings.set_strv('shelf-items', []);
        this.emit('updated');
    }

    /* ——— drop window ——— */

    _onDragMove(x, y) {
        if (this._near || !this._helper) return;
        const [nx, ny] = this._notch.get_transformed_position();
        const [nw, nh] = this._notch.get_transformed_size();
        if (x < nx - NEAR_PX || x > nx + nw + NEAR_PX || y > ny + nh + NEAR_PX) return;
        this._near = true;
        this.emit('drop-zone', 'near');
        this._placeHelper();
    }

    _startHelper() {
        if (this._helper) return;
        try {
            this._helper = Gio.Subprocess.new(['gjs', '-m', HELPER],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) { logError(e, 'nexnotch:shelf:helper'); return; }
        const helper = this._helper;
        this._helperPid = Number(helper.get_identifier());
        const stdout = new Gio.DataInputStream({base_stream: helper.get_stdout_pipe()});
        const readLine = () => stdout.read_line_async(GLib.PRIORITY_DEFAULT, null, (s, res) => {
            let line;
            try { [line] = s.read_line_finish_utf8(res); } catch (_) { line = null; }
            if (line === null) return;   // helper exited
            this._onHelperLine(line);
            readLine();
        });
        readLine();
        helper.wait_async(null, () => {
            if (this._helper === helper) this._helper = this._helperWin = null;
        });
    }

    _onHelperLine(line) {
        if (line === 'enter') this.emit('drop-zone', 'hover');
        else if (line === 'leave') this.emit('drop-zone', 'near');
        else if (line.startsWith('drop ')) {
            try { this.add(JSON.parse(line.slice(5))); } catch (e) { logError(e, 'nexnotch:shelf:drop'); }
        }
    }

    _onWindow(win) {
        if (!this._helper || win.get_pid() !== this._helperPid) return;
        this._helperWin = win;
        /* invisible but still takes the drop; skip the open animation, which
           would fade the window back in */
        const actor = win.get_compositor_private();
        Main.wm.skipNextEffect(actor);
        actor.opacity = 0;
        actor.connectObject('notify::opacity', () => { if (actor.opacity) actor.opacity = 0; }, this);
        win.make_above();
        this._placeHelper();
        /* follow the notch as it grows into the drop zone */
        this._notch.connectObject('notify::width', () => this._placeHelper(),
            'notify::height', () => this._placeHelper(), this);
        win.connect('unmanaged', () => {
            this._notch.disconnectObject(this);
            if (this._helperWin === win) this._helperWin = null;
        });
    }

    _placeHelper() {
        const win = this._helperWin;
        if (!win) return;
        if (!this._near) { win.move_resize_frame(false, 0, 0, 1, 1); return; }
        const [x, y] = this._notch.get_transformed_position();
        const [w, h] = this._notch.get_transformed_size();
        /* a "user" move: otherwise the work area (top bar / strut) would push
           the window below the top of the notch */
        win.move_resize_frame(true, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    }

    _onDragEnd() {
        /* no early return on a gone helper: it quits by itself after a drop,
           and the notch must still leave drop mode */
        const wasNear = this._near;
        this._near = false;
        /* the drop line can arrive just after the drag ends */
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            this._killHelper();
            if (wasNear) this.emit('drop-zone', 'end');
            return GLib.SOURCE_REMOVE;
        });
    }

    _killHelper() {
        this._notch.disconnectObject(this);
        this._helperWin?.get_compositor_private()?.disconnectObject(this);
        try { this._helper?.force_exit(); } catch (_) {}
        this._helper = this._helperWin = null;
    }

    /* ——— tab ——— */

    render(dropState) {
        const items = this.items();
        const box = new St.BoxLayout({style_class: 'nexnotch-shelf', ...VERTICAL, x_expand: true});
        const head = new St.BoxLayout({style_class: 'nexnotch-shelf-head', x_expand: true});
        const title = new St.BoxLayout({x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'nexnotch-shelf-title-box'});
        title.add_child(new St.Label({text: 'Shelf', style_class: 'nexnotch-section-title'}));
        if (items.length) title.add_child(new St.Label({text: `${items.length} item${items.length === 1 ? '' : 's'}`,
            style_class: 'nexnotch-shelf-count', y_align: Clutter.ActorAlign.END}));
        head.add_child(title);
        if (items.length) {
            const clear = new St.Button({style_class: 'nexnotch-pill-btn', label: 'Clear', can_focus: true});
            clear.connect('clicked', () => this.clear());
            head.add_child(clear);
        }
        box.add_child(head);

        if (dropState) {
            const zone = new St.BoxLayout({style_class: 'nexnotch-drop-zone tab', ...VERTICAL, x_expand: true});
            zone.add_child(new St.Bin({style_class: 'nexnotch-drop-disc', x_align: Clutter.ActorAlign.CENTER,
                child: new St.Icon({icon_name: 'folder-download-symbolic', style_class: 'nexnotch-drop-disc-icon'})}));
            zone.add_child(new St.Label({text: dropState === 'hover' ? 'Release to add to Shelf' : 'Drop files here',
                style_class: 'nexnotch-drop-title', x_align: Clutter.ActorAlign.CENTER}));
            zone.add_child(new St.Label({text: items.length ? `${items.length} item${items.length === 1 ? '' : 's'} already on the shelf` : 'Files stay where they are',
                style_class: 'nexnotch-drop-sub', x_align: Clutter.ActorAlign.CENTER}));
            box.add_child(zone);
            return box;
        }

        /* rows rather than a horizontal strip: sideways swipes change tabs */
        const grid = new St.BoxLayout({style_class: 'nexnotch-shelf-grid', ...VERTICAL});
        let row = null;
        const tiles = [...items.map(uri => this._tile(uri)), this._dropTile()];
        tiles.forEach((tile, i) => {
            if (i % PER_ROW === 0) grid.add_child(row = new St.BoxLayout({style_class: 'nexnotch-shelf-row'}));
            row.add_child(tile);
        });
        const scroll = new St.ScrollView({style_class: 'nexnotch-shelf-scroll', hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC, overlay_scrollbars: true, x_expand: true});
        scroll.set_child(grid);
        box.add_child(scroll);
        box.add_child(new St.Label({text: 'Click to open · copy to paste it anywhere', style_class: 'nexnotch-shelf-hint',
            x_align: Clutter.ActorAlign.CENTER}));
        return box;
    }

    _dropTile() {
        const tile = new St.BoxLayout({style_class: 'nexnotch-shelf-drop', ...VERTICAL, width: 112, height: 126});
        tile.add_child(new St.Icon({icon_name: 'list-add-symbolic', style_class: 'nexnotch-shelf-drop-icon', x_align: Clutter.ActorAlign.CENTER}));
        const label = new St.Label({text: 'Drop files on the island', style_class: 'nexnotch-shelf-drop-label', x_expand: true});
        label.clutter_text.line_wrap = true;
        label.clutter_text.line_alignment = Pango.Alignment.CENTER;
        tile.add_child(label);
        return tile;
    }

    _tile(uri) {
        const file = Gio.File.new_for_uri(uri);
        const wrap = new St.Widget({layout_manager: new Clutter.BinLayout(), track_hover: true, reactive: true, width: 112, height: 126});
        const tile = new St.Button({style_class: 'nexnotch-shelf-tile', can_focus: true, accessible_name: file.get_basename(),
            x_expand: true, y_expand: true});
        const col = new St.BoxLayout({...VERTICAL, y_align: Clutter.ActorAlign.END, x_expand: true});
        const icon = new St.Icon({gicon: Gio.ThemedIcon.new('text-x-generic'), icon_size: 43, x_align: Clutter.ActorAlign.CENTER,
            style_class: 'nexnotch-shelf-icon'});
        const name = new St.Label({text: file.get_basename(), style_class: 'nexnotch-shelf-name', x_align: Clutter.ActorAlign.CENTER});
        name.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
        const sub = new St.Label({text: '', style_class: 'nexnotch-shelf-sub', x_align: Clutter.ActorAlign.CENTER});
        col.add_child(icon);
        col.add_child(name);
        col.add_child(sub);
        tile.set_child(col);
        tile.connect('clicked', () => {
            try { Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1)); }
            catch (e) { logError(e, 'nexnotch:shelf:open'); }
        });
        wrap.add_child(tile);

        const act = (iconName, label, cls, cb) => {
            const b = new St.Button({style_class: `nexnotch-shelf-act ${cls}`, child: new St.Icon({icon_name: iconName}),
                accessible_name: label, can_focus: true, x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.START});
            b.connect('clicked', cb);
            return b;
        };
        /* copy (paste into Files, chats…) appears on hover; remove is always there */
        const copy = act('edit-copy-symbolic', 'Copy file', 'copy', () => {
            St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD, 'text/uri-list',
                new GLib.Bytes(new TextEncoder().encode(`${uri}\r\n`)));
        });
        copy.x_align = Clutter.ActorAlign.START;
        copy.opacity = 0;
        const remove = act('window-close-symbolic', 'Remove from shelf', 'remove', () => this.remove(uri));
        remove.x_align = Clutter.ActorAlign.END;
        wrap.add_child(copy);
        wrap.add_child(remove);
        wrap.connect('notify::hover', () => copy.ease({opacity: wrap.hover ? 255 : 0, duration: 120}));

        file.query_info_async('standard::icon,standard::size,standard::type,thumbnail::path',
            Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, null, (f, res) => {
                try {
                    const info = f.query_info_finish(res);
                    const thumb = info.get_attribute_byte_string('thumbnail::path');
                    icon.gicon = thumb ? Gio.FileIcon.new(Gio.File.new_for_path(thumb)) : info.get_icon();
                    sub.text = info.get_file_type() === Gio.FileType.DIRECTORY
                        ? 'Folder' : GLib.format_size(info.get_size());
                } catch (_) {
                    sub.text = 'Missing';
                    tile.add_style_class_name('missing');
                }
            });
        return wrap;
    }
});
