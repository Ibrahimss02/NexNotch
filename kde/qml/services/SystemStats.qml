import QtQuick

/* Live system figures for the System tab, read straight from /proc and /sys.
   Rates (CPU, network, disk) are deltas between two ticks.

   CONTRACT:
   focused: set by the System tab while it's visible (poll at Config.pollInterval, else 3×).
   stats: {cpu, ram, swap (%), netRx, netTx, diskR, diskW (KB/s), diskUsed, diskTotal (bytes),
           temp (°C, 0 = no sensor), load: [1, 5, 15 min], uptime (s)} */
QtObject {
    id: root
    property bool focused: false
    property var stats: null

    readonly property bool active: Config.showSystem

    property var _lastCpu: null
    property var _lastNet: null
    property var _lastDisk: null
    property var _tempInputs: []
    property real _diskUsed: 0
    property real _diskTotal: 0

    function _read(path) { return Sys.readFile(path) ?? ""; }

    function _cpu() {
        const p = _read("/proc/stat").split("\n")[0].split(/\s+/).slice(1).map(Number);
        const idle = p[3] + (p[4] ?? 0);
        const total = p.reduce((a, b) => a + b, 0);
        const last = _lastCpu;
        _lastCpu = {idle, total};
        if (!last || total <= last.total) return 0;
        return (1 - (idle - last.idle) / (total - last.total)) * 100;
    }

    function _mem() {
        const text = _read("/proc/meminfo");
        const get = k => Number(text.match(new RegExp(`^${k}:\\s+(\\d+)`, "m"))?.[1] ?? 0);
        const memTotal = get("MemTotal"), swapTotal = get("SwapTotal");
        return {
            ram: memTotal > 0 ? (memTotal - get("MemAvailable")) / memTotal * 100 : 0,
            swap: swapTotal > 0 ? (swapTotal - get("SwapFree")) / swapTotal * 100 : 0,
        };
    }

    /* KB/s of a cumulative counter pair since the last tick */
    function _rate(last, a, b, now, scale) {
        if (!last) return [0, 0];
        const dt = (now - last.t) / 1000;
        return dt > 0 ? [(a - last.a) * scale / dt, (b - last.b) * scale / dt] : [0, 0];
    }

    function _net(now) {
        let rx = 0, tx = 0;
        for (const line of _read("/proc/net/dev").split("\n").slice(2)) {
            const m = line.trim().match(/^([^:]+):\s+(.+)$/);
            if (!m) continue;
            /* physical links only: skip loopback, containers, bridges and VPN tunnels */
            if (/^(lo$|docker|veth|br-|virbr|tun)/.test(m[1].trim())) continue;
            const cols = m[2].split(/\s+/).map(Number);
            rx += cols[0]; tx += cols[8];
        }
        const r = _rate(_lastNet, rx, tx, now, 1 / 1024);
        _lastNet = {a: rx, b: tx, t: now};
        return r;
    }

    function _disk(now) {
        let rd = 0, wr = 0;
        for (const line of _read("/proc/diskstats").split("\n")) {
            const p = line.trim().split(/\s+/);
            if (p.length < 14) continue;
            const name = p[2];
            /* whole disks only, so partitions aren't counted twice */
            if (/^(loop|ram|dm-|sr|zram)/.test(name)) continue;
            if (/\d$/.test(name) && !/^(nvme\d+n\d+|mmcblk\d+)$/.test(name)) continue;
            rd += Number(p[5]); wr += Number(p[9]);
        }
        const r = _rate(_lastDisk, rd, wr, now, 512 / 1024);   // 512-byte sectors
        _lastDisk = {a: rd, b: wr, t: now};
        return r;
    }

    /* The CPU package sensor when there is one: firmware-backed sensors (ACPI
       zones, WMI, batteries) can take tens of ms per read. */
    function _findSensors() {
        const cpuNames = ["coretemp", "k10temp", "zenpower", "cpu_thermal"];
        const all = [];
        for (const dir of Sys.listDir("/sys/class/hwmon")) {
            const name = _read(`${dir.path}/name`).trim();
            for (const f of Sys.listDir(dir.path))
                if (/^temp\d+_input$/.test(f.name)) all.push({path: f.path, name});
        }
        const cpu = all.filter(h => cpuNames.includes(h.name));
        if (cpu.length) return cpu.map(h => h.path);
        return all.map(h => h.path).concat(Sys.listDir("/sys/class/thermal")
            .filter(z => z.name.startsWith("thermal_zone")).map(z => `${z.path}/temp`));
    }

    function _temp() {
        let max = 0;
        for (const p of _tempInputs) {
            const v = Number(_read(p).trim());
            if (v > max && v < 150000) max = v;
        }
        return max / 1000;
    }

    function tick() {
        const now = Sys.monotonicMs();
        const mem = _mem();
        const [netRx, netTx] = _net(now);
        const [diskR, diskW] = _disk(now);
        const up = _read("/proc/uptime").split(" ");
        stats = {
            cpu: _cpu(), ram: mem.ram, swap: mem.swap,
            netRx, netTx, diskR, diskW,
            diskUsed: _diskUsed, diskTotal: _diskTotal,
            temp: _temp(),
            load: _read("/proc/loadavg").split(" ").slice(0, 3).map(Number),
            uptime: Number(up[0]) || 0,
        };
    }

    /* Filesystem capacity — only while the tab is on screen, once a minute,
       as it barely changes. */
    function _tickCapacity() {
        const s = Sys.storageInfo();
        _diskTotal = s.total ?? 0;
        _diskUsed = s.used ?? 0;
        if (stats) stats = Object.assign({}, stats, {diskUsed: _diskUsed, diskTotal: _diskTotal});
    }

    property Timer _timer: Timer {
        interval: Math.max(1, Config.pollInterval) * 1000 * (root.focused ? 1 : 3)
        running: root.active
        repeat: true
        triggeredOnStart: true
        onTriggered: root.tick()
    }
    property Timer _capacityTimer: Timer {
        interval: 60000
        running: root.active && root.focused
        repeat: true
        triggeredOnStart: true
        onTriggered: root._tickCapacity()
    }

    /* the tab just opened: show fresh figures rather than up to 3 s old ones */
    onFocusedChanged: if (focused && active) tick()
    onActiveChanged: if (!active) { _lastCpu = _lastNet = _lastDisk = null; stats = null; }
    Component.onCompleted: _tempInputs = _findSensors()
}
