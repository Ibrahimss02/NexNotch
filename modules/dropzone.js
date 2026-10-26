/* Drop target for the NexNotch shelf, run as its own process (gjs -m).
   On Wayland GNOME Shell can't receive dropped files itself, so during a
   drag the extension starts this invisible window over the notch and reads
   what lands on it from stdout: "enter", "leave", "drop <json uris>". */
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const app = new Gtk.Application({
    application_id: 'io.nexvar.NexNotch.DropZone',
    flags: Gio.ApplicationFlags.NON_UNIQUE,
});

app.connect('activate', () => {
    /* left opaque on purpose: GTK never sizes a transparent undecorated
       window; the extension hides it by making its window actor transparent */
    const win = new Gtk.Window({
        application: app, title: 'nexnotch-dropzone', decorated: false,
        default_width: 360, default_height: 60,
    });
    const target = new Gtk.DropTarget({actions: Gdk.DragAction.COPY});
    target.set_gtypes([Gdk.FileList.$gtype]);
    target.connect('enter', () => { print('enter'); return Gdk.DragAction.COPY; });
    target.connect('leave', () => print('leave'));
    target.connect('drop', (_t, list) => {
        print(`drop ${JSON.stringify(list.get_files().map(f => f.get_uri()))}`);
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { app.quit(); return GLib.SOURCE_REMOVE; });
        return true;
    });
    win.add_controller(target);
    win.present();
});

app.run([]);
