import QtQuick

/* CONTRACT: items: [{url, name, icon, …}] from Config.shelfItems, addUrls(urls) → count added

   File shelf (shelf.js): files dropped on the notch are kept as URIs in
   Config.shelfItems; the files themselves stay where they are. On KDE the
   notch's own DropArea receives the drop, so the GNOME drop-window helper
   isn't needed. */
QtObject {
    id: root

    /* [{url, name, path, exists, isDir, size, mime, icon, thumb}] */
    property var items: _read()
    /* one of our tiles is being dragged out: the notch sees that drag too */
    property bool draggingOut: false

    readonly property string _thumbDir: (Sys.env("XDG_CACHE_HOME") || Sys.home + "/.cache") + "/thumbnails"

    function uris() { return Array.from(Config.shelfItems); }

    function _read() {
        return uris().map(url => {
            const fi = Sys.fileInfo(url);
            return {
                url, exists: fi.exists,
                name: fi.name ?? decodeURIComponent(url.split("/").pop()),
                path: fi.path ?? Sys.toLocalPath(url),
                isDir: !!fi.isDir, size: fi.size ?? 0, mime: fi.mime ?? "",
                icon: fi.icon || (fi.isDir ? "folder" : "text-x-generic"),
                thumb: fi.exists ? _thumb(url, fi.mime) : "",
            };
        });
    }

    /* the freedesktop thumbnail cache (what Dolphin made), else the image itself */
    function _thumb(url, mime) {
        const md5 = Sys.hash(_canon(Sys.toLocalPath(url)), "md5");
        for (const size of ["large", "normal"]) {
            const p = `${_thumbDir}/${size}/${md5}.png`;
            if (Sys.exists(p)) return Sys.toUrl(p);
        }
        return mime.startsWith("image/") ? url : "";
    }

    function _save(list) { Config.shelfItems = list; }

    /* "file:///a%20b&c": URIs arrive both encoded and not, so they're stored
       encoded the way QUrl does it (the thumbnail cache's names hash that)
       and compared by path */
    function _canon(path) {
        return "file://" + path.split("/")
            .map(p => encodeURIComponent(p).replace(/%(24|26|2B|2C|3B|3D|3A|40)/g, decodeURIComponent)).join("/");
    }

    /* local files only, deduped; dropping one again moves it to the end */
    function addUrls(urls) {
        const add = [];
        for (const u of urls ?? []) {
            const s = String(u);
            if (!s.startsWith("file:") && !s.startsWith("/")) continue;
            const fi = Sys.fileInfo(s);
            if (fi.exists && !add.includes(fi.path)) add.push(fi.path);
        }
        if (!add.length) return 0;
        const old = uris();
        const oldPaths = old.map(u => Sys.toLocalPath(u));
        _save([...old.filter((u, i) => !add.includes(oldPaths[i])), ...add.map(_canon)]);
        return add.filter(p => !oldPaths.includes(p)).length;
    }

    function remove(url) { _save(uris().filter(u => u !== url)); }
    function clear() { _save([]); }
    function open(url) { Sys.openUrl(url); }
    /* pasteable into Dolphin, chats, … */
    function copy(url) { Sys.copyFiles([url]); }

    function formatSize(bytes) {
        if (bytes < 1000) return `${bytes} bytes`;
        const units = ["kB", "MB", "GB", "TB"];
        let v = bytes, i = -1;
        do { v /= 1000; i++; } while (v >= 1000 && i < units.length - 1);
        return `${v.toFixed(1)} ${units[i]}`;
    }

    /* renamed or deleted files show as missing; the tab checks again when shown */
    function refresh() { items = _read(); }

    property Connections _config: Connections {
        target: Config
        function onShelfItemsChanged() { root.refresh(); }
    }
}
