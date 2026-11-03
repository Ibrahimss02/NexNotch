import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

/* The island themes (the KDE port's kde/qml/Themes.js, same values). A theme
   repaints what is drawn inside the notch: fill, frame, cards and text. Not
   type: GNOME 50's St ignores an extension's font-family. The shape, sizes
   and motion stay the extension's. */
const t = (id, name, o) => ({id, name, cardRadius: 18, frameW: 1.2, ...o});
export const THEMES = {
    loong: t('loong', 'Golden Loong', {bg: '#1A0606', card: '#2A0B0B', tile: '#3A0E0E', text: '#FFE9B0', dim: '#E0B9A8',
        accent: '#F2C14E', frame: '#C9A227', frameW: 1.5, cardBorder: 'rgba(201, 162, 39, 0.35)', cardRadius: 16}),
    neon: t('neon', 'Neon Circuit', {bg: '#07040F', card: '#0E0A1C', tile: '#1A0B24', text: '#E6F7FF', dim: '#9AA6D6',
        accent: '#00E5FF', frame: '#00E5FF', cardBorder: 'rgba(0, 229, 255, 0.35)', cardRadius: 6}),
    sakura: t('sakura', 'Sakura', {bg: '#140A10', card: '#22121A', tile: '#3A1A26', text: '#FFE3EC', dim: '#CDB0BB',
        accent: '#F7B6C8', frame: 'rgba(244, 167, 192, 0.5)', cardBorder: 'rgba(244, 167, 192, 0.18)', cardRadius: 20}),
    pixel: t('pixel', 'Pixel Quest', {bg: '#1A1C2C', card: '#262B44', tile: '#333C57', text: '#F4F4F4', dim: '#94B0C2',
        accent: '#FFCD75', frame: '#F4F4F4', frameW: 2, cardBorder: '#566C86', cardRadius: 0, cornerRadius: 10}),
    koi: t('koi', 'Koi Pond', {bg: '#04161F', card: '#0A2430', tile: '#0B3340', text: '#E6FAFF', dim: '#9CC3D1',
        accent: '#64D2FF', frame: 'rgba(100, 210, 255, 0.45)', cardBorder: 'rgba(100, 210, 255, 0.15)', cardRadius: 20}),
    cosmic: t('cosmic', 'Cosmic', {bg: '#070616', card: '#120F2A', tile: '#1E1A44', text: '#EDEBFF', dim: '#ABA8CC',
        accent: '#A5A4FF', frame: 'rgba(165, 164, 255, 0.5)', cardBorder: 'rgba(165, 164, 255, 0.18)', cardRadius: 20}),
    neko: t('neko', 'Neko', {bg: '#1B1420', card: '#2A1F2E', tile: '#3A2433', text: '#FFE0EA', dim: '#CDB8C9',
        accent: '#FF9EB5', frame: 'rgba(255, 158, 181, 0.5)', cardBorder: 'rgba(255, 158, 181, 0.15)', cardRadius: 24}),
    frost: t('frost', 'Frost', {bg: '#0A1622', card: '#11243A', tile: '#10304A', text: '#E6F6FF', dim: '#9BB7C9',
        accent: '#8FD3FF', frame: 'rgba(180, 225, 255, 0.65)', cardBorder: 'rgba(180, 225, 255, 0.2)', cardRadius: 16}),
    storm: t('storm', 'Storm', {bg: '#0B0F1A', card: '#141B2E', tile: '#1A2340', text: '#E8EEFF', dim: '#A5ADC8',
        accent: '#9FB4FF', frame: '#5B7FFF', cardBorder: 'rgba(91, 127, 255, 0.3)', cardRadius: 16}),
    sumi: t('sumi', 'Sumi-e', {light: true, bg: '#EFE7D6', card: '#E6DAC2', tile: '#D8CAAE', text: '#1A1A1A', dim: '#4A4238',
        accent: '#8E1B1B', frame: '#1A1A1A', frameW: 1.8, cardBorder: 'rgba(26, 26, 26, 0.15)', cardRadius: 12}),
};

/* system colours: a light theme takes the darker light-mode set */
const LIGHT_SYSTEM = {'#30d158': '#1E7B34', '#ff9f0a': '#B25400', '#ff453a': '#C21D12', '#0a84ff': '#0058C2',
    '#64d2ff': '#00718F', '#bf5af2': '#8E2BB5', '#a5a4ff': '#4543C2'};

function rgb(c) {
    const m = c.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (m) return [1, 2, 3].map(i => parseInt(m[i], 16));
    const r = c.match(/rgba?\(([^)]+)\)/);
    return r ? r[1].split(',').slice(0, 3).map(Number) : [0, 0, 0];
}
function shade(c, f) {
    return `rgb(${rgb(c).map(v => Math.round(f > 1 ? v + (255 - v) * (f - 1) : v * f)).join(', ')})`;
}
function alpha(c, a) { return `rgba(${rgb(c).join(', ')}, ${a})`; }

/* Every rule of stylesheet.css that paints with the stock greys or white,
   re-emitted under .nexnotch-themed with the theme's colour swapped in, so
   new rules are themed without being listed here. */
export function themeCss(sheet, th) {
    const hi = th.light ? 0.9 : 1.3;
    const map = {
        '#1c1c1e': th.card, '#2c2c2e': th.tile, '#3a3a3c': shade(th.tile, hi), '#a1a1a6': th.dim,
        '#8e8e93': alpha(th.dim, 0.85), '#48484a': alpha(th.dim, 0.35), '#e5e5ea': alpha(th.text, 0.9),
        '#636366': alpha(th.dim, 0.6), '#232326': shade(th.card, th.light ? 0.95 : 1.2),
        '#26262a': shade(th.card, th.light ? 0.95 : 1.2), '#c7c7cc': th.dim,
        ...(th.light ? LIGHT_SYSTEM : {}),
    };
    const [tr, tg, tb] = rgb(th.text);
    const swap = v => {
        let out = v.replace(/#[0-9a-f]{6}\b/gi, h => map[h.toLowerCase()] ?? h)
            .replace(/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,/g, `rgba(${tr}, ${tg}, ${tb},`)
            .replace(/(^|[\s:])(white|#fff(?:fff)?)\b/gi, `$1${th.text}`);
        return out === v ? null : out;
    };
    const scope = sel => sel.split(',').map(s => s.trim()).filter(Boolean)
        .map(s => s === '.nexnotch' ? '.nexnotch.nexnotch-themed' : `.nexnotch-themed ${s}`).join(', ');

    const rules = [];
    const body = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, sel, decls] of body.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const out = [];
        let card = false;
        for (const [, prop, val] of decls.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)/g)) {
            if (!/color|^border|shadow/.test(prop)) continue;
            const v = swap(val.trim());
            if (v) out.push(`${prop}: ${v};`);
            if (prop === 'background-color' && /#1c1c1e/i.test(val)) card = true;
        }
        if (card) {
            out.push(`box-shadow: inset 0 0 0 1px ${th.cardBorder};`);
            const r = decls.match(/border-radius\s*:\s*([\d.]+)px\s*;/);
            if (r) out.push(`border-radius: ${Math.min(Number(r[1]), th.cardRadius)}px;`);
        }
        if (out.length) rules.push(`${scope(sel)} { ${out.join(' ')} }`);
    }
    rules.push(`.nexnotch-themed .nexnotch-page-dot:checked { background-color: ${th.accent}; }`);
    rules.push(`.nexnotch-themed .nexnotch-peek-time, .nexnotch-themed .nexnotch-peek-icon { color: ${th.accent}; }`);
    return rules.join('\n');
}

/* Loads the active theme's sheet into St, and again whenever the shell
   theme reloads (which drops extra stylesheets). */
export class ThemeSheet {
    constructor(extensionPath) {
        this._source = Gio.File.new_for_path(`${extensionPath}/stylesheet.css`);
        this._file = null;
        this._id = 'plain';
        this._ctx = St.ThemeContext.get_for_stage(global.stage);
        /* loading a sheet emits 'changed' too: only reload when the shell's new theme dropped ours */
        this._changedId = this._ctx.connect('changed', () => {
            if (this._busy || !this._file) return;
            if (this._ctx.get_theme().get_custom_stylesheets().some(f => f.equal(this._file))) return;
            this._file = null;
            this.apply(this._id, true);
        });
    }

    apply(id, force = false) {
        if (id === this._id && !force) return;
        this._busy = true;
        try { this._load(id); } finally { this._busy = false; }
    }

    _load(id) {
        this._unload();
        this._id = id;
        const th = THEMES[id];
        if (!th) return;
        try {
            const [, bytes] = this._source.load_contents(null);
            const css = themeCss(new TextDecoder().decode(bytes), th);
            const dir = `${GLib.get_user_cache_dir()}/nexnotch`;
            GLib.mkdir_with_parents(dir, 0o755);
            this._file = Gio.File.new_for_path(`${dir}/theme-${id}.css`);
            this._file.replace_contents(new TextEncoder().encode(css), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            this._ctx.get_theme().load_stylesheet(this._file);
        } catch (e) {
            console.warn(`nexnotch: theme ${id}: ${e.message}`);
            this._file = null;
        }
    }

    _unload() {
        if (!this._file) return;
        try { this._ctx.get_theme().unload_stylesheet(this._file); } catch (_) {}
        this._file = null;
    }

    destroy() {
        this._ctx.disconnect(this._changedId);
        this._unload();
    }
}
