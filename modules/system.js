import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import {BarLevel} from 'resource:///org/gnome/shell/ui/barLevel.js';
import {VERTICAL} from './ui.js';

const CPU_SENSORS = ['coretemp', 'k10temp', 'zenpower', 'cpu_thermal'];
const BATTERY_REFRESH_US = 30 * 1000 * 1000;

export const SystemMonitor = GObject.registerClass({
    Signals: {
        'updated': {param_types: [GObject.TYPE_JSOBJECT]},
    },
}, class SystemMonitor extends GObject.Object {
    _init(settings) {
        super._init();
        this._settings = settings;
        this._timer = 0;
        this._lastCpu = null;
        this._lastNet = null;
        this._lastNetTime = 0;
        this._lastDisk = null;
        this._lastDiskTime = 0;
        this._cpuCores = GLib.get_num_processors();
        /* Firmware-backed sensors (Dell WMI, ACPI zones, battery, NVMe) can
           take up to ~50 ms per read, all on the shell's main thread. The CPU
           sensor is the one shown and reads in microseconds, so use only it
           when present. */
        const hwmon = this._findHwmonInputs();
        const cpu = hwmon.filter(h => CPU_SENSORS.includes(h.name));
        this._hwmonInputs = cpu.length ? cpu : hwmon;
        this._thermalZones = cpu.length ? [] : this._findThermalZones();
        this._batteryPath = this._findBattery();
        this._stats = this._emptyStats();
        this._diskCapTimer = 0;
    }

    _emptyStats() {
        return {
            cpu: 0, ram: 0, swap: 0,
            net_rx: 0, net_tx: 0,
            disk_r: 0, disk_w: 0,
            disk_used: 0, disk_total: 0,
            temp: 0, temp_cpu: 0,
            load: [0, 0, 0],
            uptime: 0,
            battery: null,
        };
    }

    start() {
        this._focused = false;
        this._tick();
        this._restartTimer();
        this._settingsSig = this._settings.connect('changed::poll-interval', () => this._restartTimer());
        /* Disk capacity barely changes — poll it far less often than the
           rest of the stats instead of doing filesystem-info syscalls on
           every fast tick. */
        this._tickDiskCapacity();
        this._diskCapTimer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 60, () => {
            this._tickDiskCapacity();
            return GLib.SOURCE_CONTINUE;
        });
    }

    /* called by notch when expanded+system-tab visible vs collapsed/other.
       drops poll rate from the user-configured fast rate to 3x that when
       nothing actually looks at the values, saving most of the per-second
       /proc reads we used to do always. */
    setFocused(focused) {
        if (this._focused === focused) return;
        this._focused = focused;
        this._restartTimer();
    }

    _restartTimer() {
        if (this._timer) { GLib.source_remove(this._timer); this._timer = 0; }
        const base = Math.max(1, this._settings.get_int('poll-interval')) * 1000;
        const interval = this._focused ? base : base * 3;
        this._timer = GLib.timeout_add(GLib.PRIORITY_LOW, interval, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stop() {
        if (this._timer) { GLib.source_remove(this._timer); this._timer = 0; }
        if (this._diskCapTimer) { GLib.source_remove(this._diskCapTimer); this._diskCapTimer = 0; }
        if (this._settingsSig) { this._settings.disconnect(this._settingsSig); this._settingsSig = 0; }
    }

    destroy() { this.stop(); }

    _tick() {
        try {
            this._stats.cpu       = this._cpuUsage();
            const mem             = this._memUsage();
            this._stats.ram       = mem.ram;
            this._stats.swap      = mem.swap;
            const net             = this._netRate();
            this._stats.net_rx    = net.rx; this._stats.net_tx = net.tx;
            const disk            = this._diskRate();
            this._stats.disk_r    = disk.r; this._stats.disk_w = disk.w;
            this._stats.temp      = this._temperature();
            this._stats.load      = this._loadAvg();
            this._stats.uptime    = this._uptime();
            /* battery files are ACPI-backed (~15 ms) and change slowly;
               plug/unplug comes from UPower via refreshBattery() */
            if (GLib.get_monotonic_time() - (this._batteryAt ?? 0) > BATTERY_REFRESH_US) this.refreshBattery();
            this.emit('updated', this._stats);
        } catch (e) { logError(e, 'nexnotch:system'); }
    }

    _readFile(path) {
        try {
            const [ok, bytes] = GLib.file_get_contents(path);
            if (!ok) return '';
            return new TextDecoder().decode(bytes);
        } catch (_) { return ''; }
    }

    _cpuUsage() {
        const line = this._readFile('/proc/stat').split('\n')[0];
        const p = line.split(/\s+/).slice(1).map(Number);
        const idle = p[3] + (p[4] ?? 0);
        const total = p.reduce((a, b) => a + b, 0);
        if (!this._lastCpu) { this._lastCpu = {idle, total}; return 0; }
        const dIdle = idle - this._lastCpu.idle;
        const dTotal = total - this._lastCpu.total;
        this._lastCpu = {idle, total};
        return dTotal > 0 ? (1 - dIdle / dTotal) * 100 : 0;
    }

    _memUsage() {
        const text = this._readFile('/proc/meminfo');
        const get = k => {
            const m = text.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'));
            return m ? Number(m[1]) : 0;
        };
        const memTotal = get('MemTotal');
        const memAvail = get('MemAvailable');
        const swapTotal = get('SwapTotal');
        const swapFree  = get('SwapFree');
        return {
            ram:  memTotal  > 0 ? ((memTotal  - memAvail) / memTotal)  * 100 : 0,
            swap: swapTotal > 0 ? ((swapTotal - swapFree) / swapTotal) * 100 : 0,
        };
    }

    _netRate() {
        const lines = this._readFile('/proc/net/dev').split('\n').slice(2);
        let rx = 0, tx = 0;
        for (const line of lines) {
            const m = line.trim().match(/^([^:]+):\s+(.+)$/);
            if (!m) continue;
            const iface = m[1].trim();
            if (iface === 'lo' || iface.startsWith('docker') || iface.startsWith('veth') ||
                iface.startsWith('br-') || iface.startsWith('virbr') || iface.startsWith('tun')) continue;
            const cols = m[2].split(/\s+/).map(Number);
            rx += cols[0]; tx += cols[8];
        }
        const now = GLib.get_monotonic_time() / 1000;
        if (!this._lastNet) { this._lastNet = {rx, tx}; this._lastNetTime = now; return {rx: 0, tx: 0}; }
        const dt = (now - this._lastNetTime) / 1000;
        const drx = rx - this._lastNet.rx;
        const dtx = tx - this._lastNet.tx;
        this._lastNet = {rx, tx}; this._lastNetTime = now;
        return dt > 0 ? {rx: (drx / 1024) / dt, tx: (dtx / 1024) / dt} : {rx: 0, tx: 0};
    }

    _diskRate() {
        const lines = this._readFile('/proc/diskstats').split('\n');
        let r = 0, w = 0;
        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 14) continue;
            const name = parts[2];
            if (/^(loop|ram|dm-|sr)/.test(name)) continue;
            if (/\d+$/.test(name) && !/^nvme\d+n\d+$/.test(name)) continue;
            r += Number(parts[5]);
            w += Number(parts[9]);
        }
        const now = GLib.get_monotonic_time() / 1000;
        if (!this._lastDisk) { this._lastDisk = {r, w}; this._lastDiskTime = now; return {r: 0, w: 0}; }
        const dt = (now - this._lastDiskTime) / 1000;
        const dr = (r - this._lastDisk.r) * 512 / 1024;
        const dw = (w - this._lastDisk.w) * 512 / 1024;
        this._lastDisk = {r, w}; this._lastDiskTime = now;
        return dt > 0 ? {r: dr / dt, w: dw / dt} : {r: 0, w: 0};
    }

    _tickDiskCapacity() {
        try {
            const cap = this._diskCapacity();
            this._stats.disk_used  = cap.used;
            this._stats.disk_total = cap.total;
            this.emit('updated', this._stats);
        } catch (e) { logError(e, 'nexnotch:system:diskcap'); }
    }

    /* Sums real block-device filesystems (root disk, other internal
       drives) into one used/total figure — like macOS's "About This Mac"
       storage bar. Dedupes by source device so bind mounts / multiple
       mountpoints of the same partition aren't double-counted. */
    _diskCapacity() {
        const SKIP_FS = new Set([
            'tmpfs', 'devtmpfs', 'overlay', 'squashfs', 'proc', 'sysfs',
            'cgroup', 'cgroup2', 'devpts', 'ramfs', 'fuse.portal',
            'autofs', 'binfmt_misc', 'tracefs', 'debugfs', 'mqueue',
        ]);
        const seen = new Set();
        let total = 0, free = 0;
        const lines = this._readFile('/proc/mounts').split('\n');
        for (const line of lines) {
            const parts = line.split(' ');
            if (parts.length < 3) continue;
            const [source, mount, fstype] = parts;
            if (!source.startsWith('/dev/')) continue;
            if (SKIP_FS.has(fstype)) continue;
            if (seen.has(source)) continue;
            seen.add(source);
            try {
                const file = Gio.File.new_for_path(mount);
                const info = file.query_filesystem_info('filesystem::size,filesystem::free', null);
                total += info.get_attribute_uint64('filesystem::size');
                free  += info.get_attribute_uint64('filesystem::free');
            } catch (_) {}
        }
        return {total, free, used: total - free};
    }

    _findThermalZones() {
        const zones = [];
        try {
            const dir = Gio.File.new_for_path('/sys/class/thermal');
            const iter = dir.enumerate_children('standard::*', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = iter.next_file(null))) {
                const n = info.get_name();
                if (n.startsWith('thermal_zone')) zones.push(`/sys/class/thermal/${n}/temp`);
            }
        } catch (_) {}
        return zones;
    }

    _findHwmonInputs() {
        const inputs = [];
        try {
            const dir = Gio.File.new_for_path('/sys/class/hwmon');
            const iter = dir.enumerate_children('standard::*', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = iter.next_file(null))) {
                const base = `/sys/class/hwmon/${info.get_name()}`;
                const nameText = this._readFile(`${base}/name`).trim();
                const subdir = Gio.File.new_for_path(base);
                const subIter = subdir.enumerate_children('standard::*', Gio.FileQueryInfoFlags.NONE, null);
                let sub;
                while ((sub = subIter.next_file(null))) {
                    const n = sub.get_name();
                    if (/^temp\d+_input$/.test(n)) inputs.push({path: `${base}/${n}`, name: nameText});
                }
            }
        } catch (_) {}
        return inputs;
    }

    _temperature() {
        let max = 0;
        for (const p of this._thermalZones) {
            const v = Number(this._readFile(p).trim());
            if (v > max && v < 150000) max = v;
        }
        for (const h of this._hwmonInputs) {
            const v = Number(this._readFile(h.path).trim());
            if (v > max && v < 150000) max = v;
        }
        return max / 1000;
    }

    _loadAvg() {
        return this._readFile('/proc/loadavg').trim().split(' ').slice(0, 3).map(Number);
    }

    _uptime() {
        const text = this._readFile('/proc/uptime').trim().split(' ')[0];
        return Number(text);
    }

    _findBattery() {
        try {
            const dir = Gio.File.new_for_path('/sys/class/power_supply');
            const iter = dir.enumerate_children('standard::*', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = iter.next_file(null))) {
                const n = info.get_name();
                const type = this._readFile(`/sys/class/power_supply/${n}/type`).trim();
                if (type === 'Battery') return `/sys/class/power_supply/${n}`;
            }
        } catch (_) {}
        return null;
    }

    _acOnline() {
        try {
            const dir = Gio.File.new_for_path('/sys/class/power_supply');
            const iter = dir.enumerate_children('standard::*', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = iter.next_file(null))) {
                const n = info.get_name();
                const type = this._readFile(`/sys/class/power_supply/${n}/type`).trim();
                if (type === 'Mains' || type === 'USB' || type === 'USB_PD') {
                    const online = this._readFile(`/sys/class/power_supply/${n}/online`).trim();
                    if (online === '1') return true;
                }
            }
        } catch (_) {}
        return false;
    }

    refreshBattery() {
        this._stats.battery = this._battery();
        this._batteryAt = GLib.get_monotonic_time();
    }

    _battery() {
        if (!this._batteryPath) return null;
        const capacity = Number(this._readFile(`${this._batteryPath}/capacity`).trim());
        const status = this._readFile(`${this._batteryPath}/status`).trim();
        const plugged = this._acOnline();

        /* Remaining time estimate (like Vitals): energy_now / power_now,
           or charge_now / current_now depending on driver. */
        const readNum = (f) => {
            const v = Number(this._readFile(`${this._batteryPath}/${f}`).trim());
            return Number.isFinite(v) ? v : 0;
        };
        const energyNow = readNum('energy_now') || readNum('charge_now');
        const powerNow  = readNum('power_now')  || readNum('current_now');
        const energyFull = readNum('energy_full') || readNum('charge_full');

        let minutes = null;
        if (powerNow > 0 && energyNow > 0) {
            if (status === 'Discharging') {
                minutes = Math.round((energyNow / powerNow) * 60);
            } else if (status === 'Charging' && energyFull > energyNow) {
                minutes = Math.round(((energyFull - energyNow) / powerNow) * 60);
            }
        }
        return {capacity, status, minutes, plugged};
    }

    render() {
        const s = this._stats;
        const box = new St.BoxLayout({style_class: 'nexnotch-sys', ...VERTICAL, x_expand: true});

        const grid = new St.BoxLayout({style_class: 'nexnotch-sys-grid', x_expand: true});
        grid.layout_manager.homogeneous = true;
        const stat = (label, value, {bar = null, color = null, sub = '', valueCls = ''} = {}) => {
            const card = new St.BoxLayout({style_class: 'nexnotch-sys-stat', ...VERTICAL, x_expand: true});
            card.add_child(new St.Label({text: label, style_class: 'nexnotch-sys-stat-label'}));
            card.add_child(new St.Label({text: value, style_class: `nexnotch-sys-stat-value ${valueCls}`}));
            if (bar !== null) {
                const level = new BarLevel({style_class: 'nexnotch-sys-bar', x_expand: true});
                level.value = Math.min(1, bar / 100);
                level.set_style(`-barlevel-active-background-color: ${color};`);
                card.add_child(level);
            } else {
                card.add_child(new St.Label({text: sub, style_class: 'nexnotch-sys-stat-sub'}));
            }
            return card;
        };
        grid.add_child(stat('CPU', `${s.cpu.toFixed(0)}%`, {bar: s.cpu, color: '#0A84FF'}));
        grid.add_child(stat('Memory', `${s.ram.toFixed(0)}%`, {bar: s.ram, color: '#BF5AF2'}));
        if (s.battery) {
            const b = s.battery;
            const sub = b.minutes
                ? (b.status === 'Charging' ? `${this._timeFmt(b.minutes)} to full` : `${this._timeFmt(b.minutes)} left`)
                : b.status;
            grid.add_child(stat('Battery', `${b.capacity}%`, {sub, valueCls: b.plugged ? 'good' : b.capacity < 20 ? 'bad' : ''}));
        }
        grid.add_child(stat('Uptime', this._upFmt(s.uptime), {sub: s.swap > 0 ? `Swap ${s.swap.toFixed(0)}%` : 'No swap in use'}));
        box.add_child(grid);

        const list = new St.BoxLayout({style_class: 'nexnotch-card nexnotch-sys-list', ...VERTICAL, x_expand: true});
        const icon = (names, color) => new St.Icon({gicon: Gio.ThemedIcon.new_from_names(names),
            style_class: 'nexnotch-sys-row-icon', style: `color: ${color};`, y_align: Clutter.ActorAlign.CENTER});
        const row = (names, color, label, value, last = false) => {
            const r = new St.BoxLayout({style_class: `nexnotch-sys-row${last ? ' last' : ''}`, x_expand: true});
            const left = new St.BoxLayout({style_class: 'nexnotch-sys-row-left', x_expand: true});
            left.add_child(icon(names, color));
            left.add_child(new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER}));
            r.add_child(left);
            r.add_child(new St.Label({text: value, style_class: 'nexnotch-sys-row-value', y_align: Clutter.ActorAlign.CENTER}));
            return r;
        };
        list.add_child(row(['network-transmit-receive-symbolic'], '#0A84FF', 'Network',
            `↓ ${this._kbFmt(s.net_rx)}   ↑ ${this._kbFmt(s.net_tx)}`));
        list.add_child(row(['drive-harddisk-symbolic'], '#64D2FF', 'Disk',
            `Read ${this._kbFmt(s.disk_r)}   Write ${this._kbFmt(s.disk_w)}`));
        if (s.temp > 0) list.add_child(row(['temperature-symbolic', 'sensors-temperature-symbolic', 'weather-clear-symbolic'], '#FF9F0A', 'Temperature', `${s.temp.toFixed(0)} °C`));
        list.add_child(row(['power-profile-performance-symbolic', 'utilities-system-monitor-symbolic'], '#30D158', 'Load average',
            s.load.map(x => x.toFixed(2)).join(' · '), !(s.disk_total > 0)));
        if (s.disk_total > 0) {
            const free = s.disk_total - s.disk_used;
            const low = free / s.disk_total < 0.1;
            const storage = new St.BoxLayout({style_class: 'nexnotch-sys-storage', ...VERTICAL, x_expand: true});
            const head = row(['drive-harddisk-solidstate-symbolic', 'drive-harddisk-symbolic'], '#FF9F0A', 'Storage',
                `${this._gbFmt(s.disk_used)} of ${this._gbFmt(s.disk_total)} · ${this._gbFmt(free)} free`, true);
            if (low) head.get_last_child().add_style_class_name('warn');
            storage.add_child(head);
            const level = new BarLevel({style_class: 'nexnotch-sys-bar storage', x_expand: true});
            level.value = s.disk_used / s.disk_total;
            level.set_style('-barlevel-active-background-color: #FF9F0A;');
            storage.add_child(level);
            list.add_child(storage);
        }
        box.add_child(list);
        return box;
    }

    _timeFmt(minutes) {
        if (minutes < 60) return `${minutes}m`;
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }

    _gbFmt(bytes) {
        return `${(bytes / (1024 ** 3)).toFixed(0)} GB`;
    }

    _kbFmt(kb) {
        if (kb < 1)        return `${(kb * 1024).toFixed(0)} B/s`;
        if (kb < 1024)     return `${kb.toFixed(1)} KB/s`;
        return `${(kb / 1024).toFixed(2)} MB/s`;
    }

    _upFmt(sec) {
        const d = Math.floor(sec / 86400);
        const h = Math.floor((sec % 86400) / 3600);
        const m = Math.floor((sec % 3600) / 60);
        if (d > 0) return `${d}d ${h}h`;
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    }
});
