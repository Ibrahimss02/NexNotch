.pragma library

/* The built-in island themes. A theme re-paints the notch (pill, open
   island and peeks); the shape, sizes and motion stay the app's. "plain" is
   the stock look and leaves every token to Theme.qml's defaults.

   bg/card/tile        notch fill, card fill, icon-tile fill
   text/dim/accent     primary and secondary text, highlight; onAccent sits on accent
   frame/frameW        outline stroke along the notch; frameIn an inner second line
   cardBorder          hairline inside cards
   glow                {color, blur, y} soft shadow under the notch
   offset              {color, x, y} hard shadow (Neon's magenta misprint)
   font/titleFont/clockFont, titleItalic, fontScale/titleScale   type
   cardRadius/iconRadius/barRadius, cornerRadius   corners (null = the user's own)
   dotOff, track, battery   page dots, progress tracks, the pill's battery fill
   enter               a themes/<name>.qml entrance played over card peeks
   scene               a themes/<name>.qml ambient scene around notification peeks;
                       peekInset keeps the text clear of it
   stepped             pixel-stepped corners instead of round ones
   peek                inside a notification: tileBorder, icon, title, titleCase
                       (upper | snake), meta, metaFormat, metaFont, metaCase, body,
                       bodyPrefix, glitch, enso (brush ring for a tile), seal
   ear/earRight        ornament art in icons/ (70×48, left ear; mirrored for the
                       right unless earRight gives its own) */

const base = {
    font: "Inter", titleFont: "Inter", clockFont: "Inter", titleItalic: false,
    fontScale: 1, titleScale: 1, clockSize: 31, pillClockSize: 13,
    cardRadius: 18, iconRadius: 18, barRadius: 2, cornerRadius: null,
    frameW: 1.2, frameIn: "transparent", offset: null, earRight: ""
};

function make(id, name, desc, t) {
    return Object.assign({id: id, name: name, desc: desc, ear: "theme-" + id}, base, t);
}

var themes = {
    loong: make("loong", "Golden Loong", "Lacquer red, a double gold rim, serif clock, gold dots and a cloud at each ear.", {
        bg: "#1A0606", card: "#2A0B0B", tile: "#3A0E0E", text: "#FFE9B0", dim: "#E0B9A8",
        accent: "#F2C14E", onAccent: "#2A0606", frame: "#C9A227", frameW: 1.5, frameIn: Qt.rgba(201/255, 162/255, 39/255, 0.45),
        cardBorder: Qt.rgba(201/255, 162/255, 39/255, 0.35), titleFont: "Noto Serif CJK SC", clockFont: "Noto Serif CJK SC",
        clockSize: 30, pillClockSize: 14, cardRadius: 16, dotOff: Qt.rgba(242/255, 193/255, 78/255, 0.3),
        track: Qt.rgba(1, 233/255, 176/255, 0.18), battery: "#F2C14E", glow: {color: Qt.rgba(200/255, 16/255, 46/255, 0.35), blur: 50, y: 18},
        enter: "LoongFlyby"
    }),
    neon: make("neon", "Neon Circuit", "Mono type throughout, cyan rims with a magenta offset, square tiles and traces off the ears.", {
        bg: "#07040F", card: "#0E0A1C", tile: "#1A0B24", text: "#E6F7FF", dim: "#9AA6D6",
        accent: "#00E5FF", onAccent: "#07040F", frame: "#00E5FF", cardBorder: Qt.rgba(0, 229/255, 1, 0.35),
        font: "JetBrains Mono", titleFont: "JetBrains Mono", clockFont: "JetBrains Mono", fontScale: 0.92, titleScale: 0.93,
        clockSize: 28, pillClockSize: 13, cardRadius: 6, iconRadius: 4, barRadius: 0,
        dotOff: Qt.rgba(0, 229/255, 1, 0.25), track: Qt.rgba(0, 229/255, 1, 0.18), battery: "#00E5FF",
        glow: {color: Qt.rgba(0, 229/255, 1, 0.25), blur: 50, y: 18}, offset: {color: Qt.rgba(1, 43/255, 214/255, 0.5), x: -3, y: 2},
        scene: "NeonScene",
        peek: {tileBorder: "#FF2BD6", icon: "#FF2BD6", title: "#00E5FF", titleCase: "snake", meta: "#FF7BE5", metaFormat: "[%1]", body: "#C3CCFF", bodyPrefix: "> ", glitch: true}
    }),
    sakura: make("sakura", "Sakura", "Italic serif clock, petal-pink accents and a blossoming sprig at each ear.", {
        bg: "#140A10", card: "#22121A", tile: "#3A1A26", text: "#FFE3EC", dim: "#CDB0BB",
        accent: "#F7B6C8", onAccent: "#140A10", frame: Qt.rgba(244/255, 167/255, 192/255, 0.5), cardBorder: Qt.rgba(244/255, 167/255, 192/255, 0.18),
        titleFont: "Fraunces", clockFont: "Fraunces", titleItalic: true, titleScale: 1.07, clockSize: 34, pillClockSize: 15, cardRadius: 20,
        dotOff: Qt.rgba(247/255, 182/255, 200/255, 0.3), track: Qt.rgba(247/255, 182/255, 200/255, 0.2), battery: "#F7B6C8",
        glow: {color: Qt.rgba(247/255, 182/255, 200/255, 0.15), blur: 50, y: 18},
        scene: "SakuraScene"
    }),
    pixel: make("pixel", "Pixel Quest", "Pixel font, square cards with 2 px borders, stepped ears and a coin on each side.", {
        bg: "#1A1C2C", card: "#262B44", tile: "#333C57", text: "#F4F4F4", dim: "#94B0C2",
        accent: "#FFCD75", onAccent: "#1A1C2C", frame: "#F4F4F4", frameW: 2, cardBorder: "#566C86", cardBorderW: 2,
        font: "VT323", titleFont: "Press Start 2P", clockFont: "Press Start 2P", fontScale: 1.3, titleScale: 0.72,
        clockSize: 22, pillClockSize: 10, cardRadius: 0, iconRadius: 0, barRadius: 0, cornerRadius: 10,
        dotOff: "#566C86", track: "#333C57", battery: "#38B764", glow: null,
        scene: "PixelScene", stepped: true,
        peek: {title: "#FFCD75", titleCase: "upper", meta: "#73EFF7", metaFont: "Press Start 2P", metaCase: "upper", body: "#F4F4F4"}
    }),
    koi: make("koi", "Koi Pond", "Pond blues with koi-orange touches; lily pads and a koi at the ears.", {
        bg: "#04161F", card: "#0A2430", tile: "#0B3340", text: "#E6FAFF", dim: "#9CC3D1",
        accent: "#64D2FF", onAccent: "#04161F", frame: Qt.rgba(100/255, 210/255, 1, 0.45), cardBorder: Qt.rgba(100/255, 210/255, 1, 0.15),
        cardRadius: 20, dotOff: Qt.rgba(100/255, 210/255, 1, 0.3), track: Qt.rgba(100/255, 210/255, 1, 0.2), battery: "#64D2FF",
        glow: {color: Qt.rgba(100/255, 210/255, 1, 0.18), blur: 50, y: 18},
        scene: "KoiScene"
    }),
    cosmic: make("cosmic", "Cosmic", "Violet starlight, soft glow, a ringed planet at each ear.", {
        bg: "#070616", card: "#120F2A", tile: "#1E1A44", text: "#EDEBFF", dim: "#ABA8CC",
        accent: "#A5A4FF", onAccent: "#070616", frame: Qt.rgba(165/255, 164/255, 1, 0.5), cardBorder: Qt.rgba(165/255, 164/255, 1, 0.18),
        cardRadius: 20, dotOff: Qt.rgba(165/255, 164/255, 1, 0.3), track: Qt.rgba(165/255, 164/255, 1, 0.2), battery: "#A5A4FF",
        glow: {color: Qt.rgba(124/255, 92/255, 1, 0.35), blur: 50, y: 18},
        scene: "CosmicScene"
    }),
    neko: make("neko", "Neko", "Rounded type, extra-soft cards, pink accents and a tail curling off each ear.", {
        bg: "#1B1420", card: "#2A1F2E", tile: "#3A2433", text: "#FFE0EA", dim: "#CDB8C9",
        accent: "#FF9EB5", onAccent: "#1B1420", frame: Qt.rgba(1, 158/255, 181/255, 0.5), cardBorder: Qt.rgba(1, 158/255, 181/255, 0.15),
        titleFont: "Fredoka", clockFont: "Fredoka", titleScale: 1.07, clockSize: 34, pillClockSize: 15, cardRadius: 24, iconRadius: 14,
        dotOff: Qt.rgba(1, 158/255, 181/255, 0.3), track: Qt.rgba(1, 158/255, 181/255, 0.2), battery: "#FF9EB5",
        glow: {color: Qt.rgba(1, 158/255, 181/255, 0.15), blur: 50, y: 18},
        scene: "NekoScene"
    }),
    frost: make("frost", "Frost", "Icy rims, blue-white accents; icicles and snowflakes at the ears.", {
        bg: "#0A1622", card: "#11243A", tile: "#10304A", text: "#E6F6FF", dim: "#9BB7C9",
        accent: "#8FD3FF", onAccent: "#0A1622", frame: Qt.rgba(180/255, 225/255, 1, 0.65), cardBorder: Qt.rgba(180/255, 225/255, 1, 0.2),
        cardRadius: 16, dotOff: Qt.rgba(143/255, 211/255, 1, 0.3), track: Qt.rgba(143/255, 211/255, 1, 0.2), battery: "#8FD3FF",
        glow: {color: Qt.rgba(143/255, 211/255, 1, 0.2), blur: 50, y: 18},
        scene: "FrostScene"
    }),
    storm: make("storm", "Storm", "Electric-blue rims, a thundercloud with lightning at each ear.", {
        bg: "#0B0F1A", card: "#141B2E", tile: "#1A2340", text: "#E8EEFF", dim: "#A5ADC8",
        accent: "#9FB4FF", onAccent: "#0B0F1A", frame: "#5B7FFF", cardBorder: Qt.rgba(91/255, 127/255, 1, 0.3),
        cardRadius: 16, dotOff: Qt.rgba(159/255, 180/255, 1, 0.3), track: Qt.rgba(159/255, 180/255, 1, 0.2), battery: "#FFF7A8",
        glow: {color: Qt.rgba(91/255, 127/255, 1, 0.25), blur: 50, y: 18},
        scene: "StormScene"
    }),
    sumi: make("sumi", "Sumi-e", "The light theme: rice-paper cards, ink rims, a brush flick and red seal at the ears.", {
        light: true, bg: "#EFE7D6", card: "#E6DAC2", tile: "#D8CAAE", text: "#1A1A1A", dim: "#4A4238",
        accent: "#8E1B1B", onAccent: "#F7EFE0", frame: "#1A1A1A", frameW: 1.8, cardBorder: Qt.rgba(26/255, 26/255, 26/255, 0.15),
        titleFont: "Noto Serif CJK SC", clockFont: "Noto Serif CJK SC", clockSize: 30, pillClockSize: 14, cardRadius: 12,
        dotOff: Qt.rgba(26/255, 26/255, 26/255, 0.25), track: Qt.rgba(26/255, 26/255, 26/255, 0.15), battery: "#2E7D32",
        glow: {color: Qt.rgba(0, 0, 0, 0.35), blur: 50, y: 18}, earRight: "theme-sumi-right",
        scene: "SumiScene", peekInset: 62,
        peek: {enso: true, icon: "#3A332B", seal: "墨", meta: "#8E1B1B"}
    })
};

var order = ["plain", "loong", "neon", "sakura", "pixel", "koi", "cosmic", "neko", "frost", "storm", "sumi"];
