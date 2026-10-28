import QtQuick
import QtQuick.Layouts
import org.kde.kirigami as Kirigami

/* Quick: Plasma's quick settings inside the notch. Volume and brightness
   as full-height pills, a card of toggles with lists (Wi-Fi, Bluetooth,
   power mode) beside small tiles, mic / camera / device battery chips and
   the power buttons (log out, restart and power off take a second tap).
   A toggle's › opens its list in place of all that; the player's Output
   button opens the output list here through Services.quickSubmenu. */
Item {
    id: tab
    property var notch
    property string submenu: ""         // "" | "output" | "wifi" | "bluetooth" | "power"

    readonly property var audio: Services.audio
    readonly property var light: Services.brightness
    readonly property var net: Services.network
    readonly property var bt: Services.bluetooth
    readonly property var ppd: Services.powerProfiles
    readonly property var night: Services.nightLight
    readonly property var style: Services.style
    readonly property var session: Services.session
    /* on toggles and checks, the system's accent (GNOME's -st-accent-color), not the notch's translucent one */
    readonly property color sysAccent: Kirigami.Theme.highlightColor

    implicitHeight: submenu ? subView.implicitHeight : mainView.implicitHeight

    function openSubmenu(id) {
        submenu = id;
        if (id === "wifi") net.scan();
    }
    /* by the user: back, or a pick that settles it; a visit from another tab goes back there */
    function closeSubmenu() {
        submenu = "";
        if (Services.quickSubmenu) {
            Services.quickSubmenu = "";
            notch?.closeSubmenu();
        }
    }
    Connections {
        target: Services
        function onQuickSubmenuChanged() { if (Services.quickSubmenu) tab.openSubmenu(Services.quickSubmenu); }
    }

    // ——— keyboard layout (the tile) and device batteries (the chips) ———

    property string layoutName: ""
    property int layoutCount: 0
    property int _layoutSig: 0
    function readLayout() {
        const kb = ["session", "org.kde.keyboard", "/Layouts", "org.kde.KeyboardLayouts"];
        DBus.call(...kb, "getLayoutsList", [], "", list => {
            DBus.call(...kb, "getLayout", [], "", cur => {
                const all = list?.[0] ?? [];
                layoutCount = all.length;
                layoutName = String(all[cur?.[0] ?? 0]?.[0] ?? "").toUpperCase();
            });
        });
    }
    function nextLayout() {
        if (layoutCount > 1) DBus.call("session", "org.kde.keyboard", "/Layouts", "org.kde.KeyboardLayouts", "switchToNextLayout");
    }

    /* UPower's devices with a model name and a charge: mice, headsets, phones
       (not the laptop's own battery, nor line power) */
    property var batteries: []
    function readBatteries() {
        const up = "org.freedesktop.UPower";
        DBus.call("system", up, "/org/freedesktop/UPower", up, "EnumerateDevices", [], "", out => {
            const paths = out?.[0] ?? [];
            const found = [];
            let pending = paths.length;
            if (!pending) batteries = [];
            for (const path of paths) DBus.getAll("system", up, path, up + ".Device", p => {
                if (p && p.Type !== 1 && !p.PowerSupply && (p.Model ?? "").trim() && Number.isFinite(p.Percentage))
                    found.push({model: p.Model.trim(), pct: Math.round(p.Percentage)});
                if (--pending === 0) batteries = found.sort((a, b) => a.model.localeCompare(b.model));
            });
        });
    }
    Timer { interval: 15000; repeat: true; running: true; onTriggered: tab.readBatteries() }

    Connections {
        target: DBus
        function onSignalReceived(id) { if (id === tab._layoutSig) tab.readLayout(); }
    }
    Component.onCompleted: {
        if (Services.quickSubmenu) openSubmenu(Services.quickSubmenu);
        _layoutSig = DBus.connectSignal("session", "org.kde.keyboard", "/Layouts", "org.kde.KeyboardLayouts", "layoutChanged");
        readLayout();
        readBatteries();
        style.refresh();
    }
    Component.onDestruction: {
        DBus.disconnectSignal(_layoutSig);
        Services.quickSubmenu = "";
    }

    // ——— pieces ———

    /* a full-height pill whose white fill is the level, the icon inside it;
       past 100 % (Plasma's "raise maximum volume") the fill turns orange */
    component LevelPill: Item {
        id: pill
        property real value: 0              // 0..maxValue
        property real maxValue: 1
        property string icon
        property bool iconToggles: false    // a tap on the icon (not a drag) is iconClicked
        property string accessibleName
        property bool dragging: false
        property real dragValue: 0
        readonly property real shown: Math.max(0, Math.min(maxValue, dragging ? dragValue : value))
        readonly property real fillW: shown > 0 ? Math.max(height, width * shown / maxValue) : 0
        signal moved(real v)
        signal iconClicked()
        implicitHeight: 43
        Layout.fillWidth: true
        Accessible.role: Accessible.Slider
        Accessible.name: accessibleName

        Rectangle {
            anchors.fill: parent
            radius: height / 2
            color: Theme.surface
            Rectangle {
                id: fill
                width: pill.fillW; height: parent.height; radius: height / 2
                color: Theme.text
                readonly property real knee: pill.width / pill.maxValue / Math.max(1, width)
                gradient: pill.shown > 1 ? over : undefined
                Gradient {
                    id: over
                    orientation: Gradient.Horizontal
                    GradientStop { position: 0; color: Theme.text }
                    GradientStop { position: fill.knee; color: Theme.text }
                    GradientStop { position: fill.knee + 0.001; color: Theme.orange }
                    GradientStop { position: 1; color: Theme.orange }
                }
            }
        }
        NIcon {
            x: 14
            anchors.verticalCenter: parent.verticalCenter
            name: pill.icon
            size: 18
            color: pill.shown / pill.maxValue > 0.1 ? "#000000" : Theme.textDim
        }
        MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            preventStealing: true
            property real startX: 0
            readonly property bool onIcon: pill.iconToggles && startX < 44
            function set(x) {
                pill.dragging = true;
                pill.dragValue = Math.max(0, Math.min(1, x / pill.width)) * pill.maxValue;
                pill.moved(pill.dragValue);
            }
            onPressed: m => { startX = m.x; if (!onIcon) set(m.x); }
            onPositionChanged: m => { if (pressed && (pill.dragging || Math.abs(m.x - startX) > 4)) set(m.x); }
            onReleased: m => {
                if (!pill.dragging && onIcon) pill.iconClicked();
                pill.dragging = false;
            }
            onCanceled: pill.dragging = false
        }
    }

    /* a toggle in the card: the circle switches it, the label (with its ›) opens its list */
    component BigToggle: RowLayout {
        id: big
        property string icon
        property string title
        property string subtitle
        property bool checked: false
        property bool hasMenu: false
        property bool usable: true
        signal toggled()
        signal opened()
        spacing: 9
        Layout.fillWidth: true
        Layout.preferredWidth: 1
        Layout.minimumHeight: 58
        NButton {
            implicitWidth: 43; implicitHeight: 43
            radius: 21.5
            enabled: big.usable
            color: big.checked ? tab.sysAccent : Theme.surfaceHi
            hoverColor: big.checked ? Qt.lighter(tab.sysAccent, 1.12) : Theme.disabled
            accessibleName: big.title
            onClicked: big.toggled()
            NIcon { anchors.centerIn: parent; name: big.icon; size: 20 }
        }
        NButton {
            Layout.fillWidth: true
            implicitWidth: 40
            implicitHeight: 40
            radius: 14
            hoverColor: Qt.rgba(1, 1, 1, 0.06)
            enabled: big.usable
            accessibleName: big.hasMenu ? `${big.title} options` : big.title
            onClicked: big.hasMenu ? big.opened() : big.toggled()
            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 6; anchors.rightMargin: 4
                spacing: 2
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 1
                    NText { Layout.fillWidth: true; text: big.title; size: 12; weight: Font.DemiBold }
                    NText { Layout.fillWidth: true; text: big.subtitle; size: 11; color: Theme.textDim }
                }
                NIcon { visible: big.hasMenu; name: "go-next-symbolic"; size: 13; color: "#8E8E93" }
            }
        }
    }

    /* a plain toggle: icon on top, name below, white when on */
    component SmallToggle: NButton {
        id: small
        property string icon
        property string title
        Layout.fillWidth: true
        Layout.preferredWidth: 1
        implicitHeight: 75
        radius: 23
        color: checked ? Theme.text : "#1C1C1E"
        hoverColor: checked ? "#E5E5EA" : "#26262A"
        accessibleName: title
        NIcon {
            x: 14; y: 13
            name: small.icon; size: 20
            color: small.checked ? "#000000" : Theme.text
        }
        NText {
            x: 14; width: parent.width - 28
            anchors.bottom: parent.bottom; anchors.bottomMargin: 13
            text: small.title; size: 12; weight: Font.DemiBold
            color: small.checked ? "#000000" : Theme.text
        }
    }

    component Chip: Rectangle {
        id: chip
        property string icon
        property string text
        property color tint: Theme.textDim
        implicitWidth: chipRow.implicitWidth + 22
        implicitHeight: 27
        radius: 14
        color: "#1C1C1E"
        Row {
            id: chipRow
            anchors.centerIn: parent
            spacing: 5
            NIcon { anchors.verticalCenter: parent.verticalCenter; name: chip.icon; size: 13; color: chip.tint }
            NText { anchors.verticalCenter: parent.verticalCenter; text: chip.text; size: 11; color: chip.tint }
        }
    }

    /* Lock and Suspend act on one tap; the rest arm on the first (red, with
       a check mark) and act on a second within 3 s */
    component PowerButton: NButton {
        id: power
        property string icon
        property string label
        property bool armable: false
        property bool danger: false
        property bool armed: false
        signal fire()
        implicitWidth: 43; implicitHeight: 43
        radius: 21.5
        color: armed ? Theme.red : danger ? "#3A1210" : "#1C1C1E"
        hoverColor: armed ? Theme.red : danger ? "#4A1A16" : Theme.surface
        accessibleName: armable ? `${label} (click twice to confirm)` : label
        Timer { id: disarm; interval: 3000; onTriggered: power.armed = false }
        onClicked: {
            if (!armable) { fire(); return; }
            armed = !armed;
            if (armed) disarm.restart();
            else { disarm.stop(); fire(); }
        }
        NIcon {
            anchors.centerIn: parent
            name: power.armed ? "object-select-symbolic" : power.icon
            size: 18
            color: power.danger && !power.armed ? Theme.red : Theme.text
        }
    }

    // ——— the main view ———

    ColumnLayout {
        id: mainView
        width: parent.width
        visible: !tab.submenu
        spacing: 13

        ColumnLayout {
            Layout.fillWidth: true
            spacing: 9
            RowLayout {
                Layout.fillWidth: true
                spacing: 7
                LevelPill {
                    accessibleName: "Volume"
                    value: tab.audio.muted ? 0 : tab.audio.volume
                    maxValue: tab.audio.maxVolume
                    icon: tab.audio.volumeIcon(tab.audio.volume, tab.audio.muted)
                    iconToggles: true
                    onMoved: v => tab.audio.setVolume(v)
                    onIconClicked: tab.audio.toggleMute()
                }
                NButton {
                    implicitWidth: 43; implicitHeight: 43
                    radius: 21.5
                    color: Theme.surface
                    hoverColor: Theme.surfaceHi
                    accessibleName: "Sound output"
                    onClicked: tab.openSubmenu("output")
                    NIcon { anchors.centerIn: parent; name: "pan-down-symbolic"; size: 12 }
                }
            }
            LevelPill {
                visible: tab.light.brightness >= 0
                accessibleName: "Brightness"
                value: Math.max(0, tab.light.brightness)
                icon: "brightness-high-symbolic"
                onMoved: v => tab.light.setBrightness(v)
            }
            LevelPill {
                visible: tab.light.keyboard >= 0
                accessibleName: "Keyboard backlight"
                value: Math.max(0, tab.light.keyboard)
                icon: "input-keyboard-symbolic"
                onMoved: v => tab.light.setKeyboard(v)
            }
        }

        RowLayout {
            Layout.fillWidth: true
            spacing: 9
            /* the card takes more of the width: its labels need it, the tiles don't */
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredWidth: 6
                Layout.alignment: Qt.AlignTop
                implicitHeight: bigGrid.implicitHeight + 26
                radius: 25
                color: "#1C1C1E"
                GridLayout {
                    id: bigGrid
                    anchors.left: parent.left; anchors.right: parent.right; anchors.top: parent.top
                    anchors.margins: 13
                    columns: 2
                    rowSpacing: 7; columnSpacing: 7
                    BigToggle {
                        title: "Wi-Fi"
                        usable: tab.net.wifiAvailable
                        checked: tab.net.wifiEnabled && tab.net.wifiAvailable
                        icon: !checked ? "network-wireless-disconnected-symbolic" : "network-wireless-symbolic"
                        subtitle: !tab.net.wifiAvailable ? "Unavailable" : !tab.net.wifiEnabled ? "Off" : tab.net.ssid || "Not connected"
                        hasMenu: checked
                        onToggled: tab.net.setWifiEnabled(!tab.net.wifiEnabled)
                        onOpened: tab.openSubmenu("wifi")
                    }
                    BigToggle {
                        readonly property var on: tab.bt.connectedDevices
                        title: "Bluetooth"
                        usable: tab.bt.available
                        checked: tab.bt.enabled
                        icon: checked ? "network-bluetooth-symbolic" : "network-bluetooth-inactive-symbolic"
                        subtitle: !tab.bt.available ? "Unavailable" : !checked ? "Off"
                                : on.length === 1 ? on[0].name : on.length > 1 ? `${on.length} devices` : "On"
                        hasMenu: checked
                        onToggled: tab.bt.setEnabled(!tab.bt.enabled)
                        onOpened: tab.openSubmenu("bluetooth")
                    }
                    BigToggle {
                        title: "Power Mode"
                        usable: tab.ppd.available
                        checked: tab.ppd.available && tab.ppd.active !== "balanced"
                        icon: tab.ppd.icon
                        subtitle: tab.ppd.available ? tab.ppd.label : "Unavailable"
                        hasMenu: tab.ppd.profiles.length > 1
                        onToggled: tab.ppd.toggle()
                        onOpened: tab.openSubmenu("power")
                    }
                    BigToggle {
                        title: "Night Light"
                        usable: tab.night.available
                        checked: tab.night.enabled
                        icon: checked ? "redshift-status-on-symbolic" : "redshift-status-off-symbolic"
                        subtitle: !tab.night.available ? "Unavailable" : !checked ? "Off" : tab.night.inhibited ? "Paused"
                                : tab.night.running ? `${tab.night.temperature} K` : "On"
                        onToggled: tab.night.toggle()
                    }
                }
            }
            GridLayout {
                Layout.fillWidth: true
                Layout.preferredWidth: 5
                Layout.alignment: Qt.AlignTop
                columns: 2
                rowSpacing: 9; columnSpacing: 9
                SmallToggle {
                    title: "Dark Style"; icon: "contrast-symbolic"
                    checked: tab.style.dark
                    onClicked: tab.style.toggle()
                }
                SmallToggle {
                    title: "Do Not Disturb"; icon: "notifications-disabled-symbolic"
                    checked: Notifications.doNotDisturb
                    onClicked: Notifications.setDoNotDisturb(!Notifications.doNotDisturb)
                }
                SmallToggle {
                    title: "Airplane Mode"; icon: "network-flightmode-on-symbolic"
                    checked: tab.net.airplaneMode
                    onClicked: tab.net.setAirplaneMode(!tab.net.airplaneMode)
                }
                SmallToggle {
                    title: `Layout · ${tab.layoutName || "—"}`; icon: "input-keyboard-symbolic"
                    hoverColor: tab.layoutCount > 1 ? "#26262A" : color
                    accessibleName: tab.layoutCount > 1 ? "Switch keyboard layout" : title
                    onClicked: tab.nextLayout()
                }
            }
        }

        Row {
            Layout.alignment: Qt.AlignHCenter
            spacing: 7
            Chip {
                readonly property bool on: tab.audio.micInUse
                icon: on ? "audio-input-microphone-symbolic" : "microphone-sensitivity-muted-symbolic"
                text: on ? "Mic in use" : "Mic off"
                tint: on ? Theme.orange : Theme.textDim
            }
            Chip {
                readonly property bool on: Sys.cameraActive
                icon: on ? "camera-web-symbolic" : "camera-off-symbolic"
                text: on ? "Camera in use" : "Camera off"
                tint: on ? Theme.orange : Theme.textDim
            }
            Repeater {
                model: tab.batteries.slice(0, 3)
                Chip {
                    required property var modelData
                    icon: `battery-${String(Math.min(100, Math.round(modelData.pct / 10) * 10)).padStart(3, "0")}-symbolic`
                    text: `${modelData.model} · ${modelData.pct}%`
                    tint: modelData.pct < 20 ? Theme.red : "#E5E5EA"
                }
            }
        }

        Row {
            Layout.alignment: Qt.AlignHCenter
            spacing: 13
            NButton {
                anchors.verticalCenter: parent.verticalCenter
                implicitWidth: 31; implicitHeight: 31
                color: "#1C1C1E"; hoverColor: Theme.surface
                accessibleName: "NexNotch settings"
                onClicked: tab.notch.openSettings("")
                NIcon { anchors.centerIn: parent; name: "own:sliders"; size: 14; color: Theme.textDim }
            }
            PowerButton {
                label: "System Settings"; icon: "emblem-system-symbolic"
                onFire: { Sys.runDetached(["systemsettings"]); tab.notch.collapse(); }
            }
            PowerButton { label: "Lock"; icon: "system-lock-screen-symbolic"; onFire: tab.session.lock() }
            PowerButton {
                label: "Suspend"; icon: "weather-clear-night-symbolic"
                enabled: tab.session.canSuspend
                onFire: tab.session.suspend()
            }
            PowerButton { label: "Log out"; icon: "system-log-out-symbolic"; armable: true; onFire: tab.session.logout() }
            PowerButton { label: "Restart"; icon: "system-reboot-symbolic"; armable: true; onFire: tab.session.reboot() }
            PowerButton { label: "Power off"; icon: "system-shutdown-symbolic"; armable: true; danger: true; onFire: tab.session.powerOff() }
        }
    }

    // ——— a toggle's list ———

    function signalIcon(s) {
        const level = s >= 80 ? "excellent" : s >= 55 ? "good" : s >= 30 ? "ok" : s >= 5 ? "weak" : "none";
        return `network-wireless-signal-${level}-symbolic`;
    }

    /* rows as {key, icon, label, detail, detailColor, secure, checked} */
    readonly property var items: {
        switch (submenu) {
        case "output":
            return audio.sinks.map(s => ({key: s.id, icon: s.icon, label: s.description, checked: s.isDefault}));
        case "wifi":
            return net.networks.map(n => ({key: n, icon: signalIcon(n.signal), label: n.name, secure: n.secure,
                                           detail: n.state === "connected" ? "Connected" : n.state === "connecting" ? "Connecting…" : "",
                                           checked: n.state === "connected"}));
        case "bluetooth":
            return bt.devices.map(d => ({key: d.address, icon: d.icon, label: d.name, checked: d.connected,
                                         detail: d.busy ? (d.connected ? "Disconnecting…" : "Connecting…") : d.battery >= 0 ? `${d.battery}%` : "",
                                         detailColor: !d.busy && d.battery >= 0 ? (d.battery < 20 ? Theme.red : Theme.green) : Theme.textDim}));
        case "power":
            return ppd.profiles.map(p => ({key: p, icon: ppd.icons[p], label: ppd.labels[p], checked: ppd.active === p,
                                           detail: p === "performance" && ppd.degraded ? "Limited" : ""}));
        }
        return [];
    }
    readonly property var submenus: ({
        output: {title: "Sound Output", empty: "No outputs", settings: "Sound Settings", kcm: "kcm_pulseaudio"},
        wifi: {title: "Wi-Fi", empty: net.wifiEnabled ? "Looking for networks…" : "Wi-Fi is off", settings: "Network Settings", kcm: "kcm_networkmanagement"},
        bluetooth: {title: "Bluetooth", empty: bt.enabled ? "No paired devices" : "Bluetooth is off", settings: "Bluetooth Settings", kcm: "kcm_bluetooth"},
        power: {title: "Power Mode", empty: "Power profiles are unavailable", settings: "Power Settings", kcm: "kcm_powerdevilprofilesconfig"},
    })
    readonly property var current: submenus[submenu] ?? submenus.output

    function pick(item) {
        switch (submenu) {
        case "output": audio.setDefaultSink(item.key); closeSubmenu(); break;
        case "wifi": net.activate(item.key); break;
        case "bluetooth": bt.toggleDevice(item.key); break;
        case "power": ppd.setProfile(item.key); closeSubmenu(); break;
        }
    }
    function openSettings() {
        Sys.runDetached(["systemsettings", current.kcm]);
        notch?.collapse();
    }

    component MenuRow: NButton {
        id: row
        property string icon
        property string label
        property string detail
        property color detailColor: Theme.textDim
        property bool secure: false
        width: parent?.width ?? 0
        implicitWidth: 100
        implicitHeight: 38
        radius: 12
        hoverColor: Qt.rgba(1, 1, 1, 0.08)
        accessibleName: label
        RowLayout {
            anchors.fill: parent
            anchors.leftMargin: 12; anchors.rightMargin: 12
            spacing: 10
            NIcon { name: row.icon; size: 16 }
            NText { Layout.fillWidth: true; text: row.label; size: 12; weight: row.checked ? Font.DemiBold : Font.Normal }
            NIcon { visible: row.secure; name: "object-locked-symbolic"; size: 12; color: Theme.textDim }
            NText { visible: !!row.detail; text: row.detail; size: 11; weight: Font.DemiBold; tnum: true; color: row.detailColor }
            NIcon { visible: row.checked; name: "object-select-symbolic"; size: 14; color: tab.sysAccent }
        }
    }

    ColumnLayout {
        id: subView
        width: parent.width
        visible: !!tab.submenu
        spacing: 6

        RowLayout {
            Layout.fillWidth: true
            spacing: 8
            NButton {
                implicitWidth: 28; implicitHeight: 28
                radius: 14
                hoverColor: Qt.rgba(1, 1, 1, 0.14)
                accessibleName: "Back"
                onClicked: tab.closeSubmenu()
                NIcon { anchors.centerIn: parent; name: "go-previous-symbolic"; size: 16; color: Qt.rgba(1, 1, 1, 0.8) }
            }
            NText { Layout.fillWidth: true; text: tab.current.title; size: 13; weight: Font.DemiBold }
        }

        Rectangle {
            Layout.fillWidth: true
            implicitHeight: listCol.implicitHeight + 12
            radius: 18
            color: Qt.rgba(1, 1, 1, 0.06)
            ColumnLayout {
                id: listCol
                anchors.left: parent.left; anchors.right: parent.right; anchors.top: parent.top
                anchors.margins: 6
                spacing: 0
                Flickable {
                    Layout.fillWidth: true
                    Layout.preferredHeight: Math.min(contentHeight, 38 * 6)
                    visible: tab.items.length > 0
                    contentHeight: rows.implicitHeight
                    interactive: contentHeight > height
                    boundsBehavior: Flickable.StopAtBounds
                    clip: true
                    Column {
                        id: rows
                        width: parent.width
                        Repeater {
                            model: tab.items
                            MenuRow {
                                required property var modelData
                                icon: modelData.icon
                                label: modelData.label
                                detail: modelData.detail ?? ""
                                detailColor: modelData.detailColor ?? Theme.textDim
                                secure: !!modelData.secure
                                checked: !!modelData.checked
                                onClicked: tab.pick(modelData)
                            }
                        }
                    }
                }
                NText {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 38
                    visible: tab.items.length === 0
                    leftPadding: 12
                    text: tab.current.empty; size: 12; color: Theme.textDim
                }
                Rectangle { Layout.fillWidth: true; Layout.margins: 6; implicitHeight: 1; color: Theme.hairline }
                MenuRow {
                    Layout.fillWidth: true
                    icon: "configure-symbolic"
                    label: tab.current.settings
                    onClicked: tab.openSettings()
                }
            }
        }
    }
}
