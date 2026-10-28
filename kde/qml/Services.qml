pragma Singleton
import QtQuick

/* One instance of every service, shared by the notch, its tabs and the
   settings window. Each service starts and stops itself from Config. */
QtObject {
    /* a Quick list opened from another tab ("output"), shown on the Quick tab */
    property string quickSubmenu: ""
    readonly property MediaService media: MediaService {}
    readonly property NotificationStore notifications: NotificationStore {}
    readonly property StatusService status: StatusService {}
    readonly property PowerService power: PowerService {}
    readonly property SystemStats system: SystemStats {}
    readonly property ClaudeService claude: ClaudeService {}
    readonly property AudioService audio: AudioService {}
    readonly property BrightnessService brightness: BrightnessService {}
    readonly property NetworkService network: NetworkService {}
    readonly property BluetoothService bluetooth: BluetoothService {}
    readonly property PowerProfilesService powerProfiles: PowerProfilesService {}
    readonly property NightLightService nightLight: NightLightService {}
    readonly property StyleService style: StyleService {}
    readonly property SessionService session: SessionService {}
    readonly property WeatherService weather: WeatherService {}
    readonly property CalendarService calendar: CalendarService {}
    readonly property NotesService notes: NotesService {}
    readonly property ShelfService shelf: ShelfService {}
    readonly property PomodoroService pomodoro: PomodoroService {}
    readonly property WaterService water: WaterService {}
    readonly property UpdatesService updates: UpdatesService {}
}
