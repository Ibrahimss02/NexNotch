import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

/* Watches UPower for the charger being plugged in or out. UPower signals
   the change immediately, unlike the system monitor's battery poll. */
const UPOWER_IFACE_XML = `
<node>
  <interface name="org.freedesktop.UPower">
    <property name="OnBattery" type="b" access="read"/>
  </interface>
</node>`;

const DEVICE_IFACE_XML = `
<node>
  <interface name="org.freedesktop.UPower.Device">
    <property name="Percentage"  type="d" access="read"/>
    <property name="State"       type="u" access="read"/>
    <property name="TimeToFull"  type="x" access="read"/>
    <property name="TimeToEmpty" type="x" access="read"/>
    <property name="IsPresent"   type="b" access="read"/>
  </interface>
</node>`;

const UPowerProxy = Gio.DBusProxy.makeProxyWrapper(UPOWER_IFACE_XML);
const DeviceProxy = Gio.DBusProxy.makeProxyWrapper(DEVICE_IFACE_XML);

/* UPower device states */
export const State = {CHARGING: 1, DISCHARGING: 2, FULLY_CHARGED: 4, PENDING_CHARGE: 5};

/* UPower updates State/percentage a moment after OnBattery flips */
const SETTLE_MS = 800;

export const PowerWatcher = GObject.registerClass({
    Signals: {
        // {plugged, percentage, state, timeToFull, timeToEmpty} (times in seconds)
        'charger-changed': {param_types: [GObject.TYPE_JSOBJECT]},
    },
}, class PowerWatcher extends GObject.Object {
    start() {
        this._stopped = false;
        this._cancellable = new Gio.Cancellable();
        UPowerProxy(Gio.DBus.system, 'org.freedesktop.UPower', '/org/freedesktop/UPower', (proxy, error) => {
            if (error || this._stopped) return;
            this._upower = proxy;
            this._onBattery = proxy.OnBattery;
            this._propsId = proxy.connect('g-properties-changed', () => this._check());
        }, this._cancellable);
        DeviceProxy(Gio.DBus.system, 'org.freedesktop.UPower', '/org/freedesktop/UPower/devices/DisplayDevice', (proxy, error) => {
            if (!error && !this._stopped) this._device = proxy;
        }, this._cancellable);
    }

    stop() {
        this._stopped = true;
        this._cancellable?.cancel();
        if (this._settleId) { GLib.source_remove(this._settleId); this._settleId = 0; }
        if (this._propsId) { this._upower?.disconnect(this._propsId); this._propsId = 0; }
        this._upower = this._device = null;
    }

    destroy() { this.stop(); }

    _check() {
        const onBattery = this._upower?.OnBattery;
        if (onBattery === undefined || onBattery === this._onBattery) return;
        this._onBattery = onBattery;
        if (this._settleId) GLib.source_remove(this._settleId);
        this._settleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_MS, () => {
            this._settleId = 0;
            const d = this._device;
            if (d && d.IsPresent === false) return GLib.SOURCE_REMOVE;   // desktop: no battery
            this.emit('charger-changed', {
                plugged: !this._onBattery,
                percentage: d?.Percentage ?? null,
                state: d?.State ?? 0,
                timeToFull: Number(d?.TimeToFull ?? 0),
                timeToEmpty: Number(d?.TimeToEmpty ?? 0),
            });
            return GLib.SOURCE_REMOVE;
        });
    }
});
