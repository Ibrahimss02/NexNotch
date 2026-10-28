import QtQuick
import QtCore

/* Quick notes (notes.js), saved as markdown in the notes folder under a
   dd-mm-yy folder per day, named after the title (or the first words).
   Drafts live here rather than in the tab, so switching tabs or closing the
   notch keeps what's being typed. */
QtObject {
    id: root

    /* {uid, title, body, filePath}; edited in place so the cards (and their
       focus and cursor) survive typing */
    property ListModel drafts: ListModel {}
    property var _dirty: ({})        // uid → true, waiting for the debounced save

    readonly property string folder: Config.notesFolder
        || Sys.toLocalPath(String(StandardPaths.writableLocation(StandardPaths.DocumentsLocation))) + "/NexNotch Notes"

    function _uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

    function newDraft() {
        drafts.append({uid: _uid(), title: "", body: "", filePath: ""});
    }

    function _index(uid) {
        for (let i = 0; i < drafts.count; i++) if (drafts.get(i).uid === uid) return i;
        return -1;
    }

    function edit(uid, title, body) {
        const i = _index(uid);
        if (i < 0) return;
        drafts.setProperty(i, "title", title);
        drafts.setProperty(i, "body", body);
        _dirty[uid] = true;
        _debounce.restart();
    }

    function saveNow(uid) {
        delete _dirty[uid];
        _save(_index(uid));
    }

    function remove(uid) {
        const i = _index(uid);
        if (i < 0) return;
        delete _dirty[uid];
        const path = drafts.get(i).filePath;
        if (path) Sys.remove(path);
        drafts.remove(i);
        if (drafts.count === 0) newDraft();
    }

    function _slug(text) {
        const s = (text || "").trim().toLowerCase()
            .replace(/[^a-z0-9ığüşöçİĞÜŞÖÇ\s-]/gi, "")
            .replace(/\s+/g, "-")
            .slice(0, 48)
            .replace(/^-+|-+$/g, "");
        return s || "note";
    }

    function _save(i) {
        if (i < 0) return;
        const d = drafts.get(i);
        if (!d.title.trim() && !d.body.trim()) return;
        const dayDir = `${folder}/${Qt.formatDate(new Date(), "dd-MM-yy")}`;
        const base = _slug(d.title || d.body);
        let target = `${dayDir}/${base}.md`;
        if (d.filePath && d.filePath !== target) {
            /* renamed since the last save: move rather than leave the old file */
            Sys.remove(d.filePath);
        } else if (!d.filePath) {
            /* don't clobber an unrelated note with the same name */
            for (let n = 1; Sys.exists(target); n++) target = `${dayDir}/${base}-${n}.md`;
        }
        const content = d.title.trim() ? `# ${d.title.trim()}\n\n${d.body}` : d.body;
        if (Sys.writeFile(target, content)) drafts.setProperty(i, "filePath", target);
        else console.warn("nexnotch: notes: can't write", target);
    }

    function _flush() {
        for (const uid in _dirty) _save(_index(uid));
        _dirty = {};
    }

    property Timer _debounce: Timer {
        interval: 800
        onTriggered: root._flush()
    }

    Component.onCompleted: newDraft()
    Component.onDestruction: _flush()
}
