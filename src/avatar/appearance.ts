/**
 * Site data (walker / hero) → fully resolved Appearance.
 * Pure TS, no three.js: safe for tests and workers.
 */
import type { Appearance, Gear, Look, StyleId } from '../contracts';
import { CH_SKINS, chTraits, chFaceBits } from './cherts-traits';

/* ------------------------------------------------------------------ site PRNG (same as MDDoodle) */
export const jhash = (s: string): number => {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.codePointAt(0)!; h = Math.imul(h, 16777619); }
  return h >>> 0;
};
export const jrng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const jpick = <T>(r: () => number, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];

/* ------------------------------------------------------------------ catalog (ids shared by all styles) */
export const CATALOG = {
  shapes: ['bean', 'box', 'ball', 'tall', 'ghost', 'cone', 'egg'],
  eyes: ['dots', 'big', 'happy', 'cyclops', 'stars'],
  mouths: ['open', 'grin', 'tongue'],
  hats: ['none', 'tuft', 'cap', 'bow', 'horns', 'crown', 'tophat', 'party', 'wizard', 'antenna', 'antenna2', 'cat', 'bunny', 'halo',
    'sprout', 'bandana', 'legion', 'laurel', 'beret', 'headphones', 'cowboy', 'chef', 'pumpkin', 'witch', 'batears', 'skull', 'reaper', 'scarehat'],
  acc: ['bowtie', 'tie', 'scarf', 'glasses', 'shades', 'monocle', 'mustache', 'cape', 'pioneer'],
  auras: ['gold', 'sparks', 'halo', 'shadow', 'frost'],
  colors: ['#ff9fb2', '#ffb27a', '#ffe27a', '#9fe39a', '#7fd6e6', '#8fb6ff', '#b9a2ff', '#e6e6ee', '#ffc94d', '#5a5470'],
  weapons: ['sword', 'gladius', 'dagger', 'axe', 'club', 'mace', 'hammer', 'spear', 'pitchfork', 'bow', 'staff', 'crook', 'censer', 'kris', 'skullstaff', 'grimoire', 'holymace'],
  shields: ['scutum', 'round', 'buckler', 'barrel'],
  armors: ['lorica', 'robe', 'leather', 'shroud', 'plate'],
  rarities: ['common', 'uncommon', 'rare', 'epic', 'legendary'],
} as const;

export const RARITY_COLOR: Record<string, string> = {
  common: '#c9ccd6', uncommon: '#4cc95a', rare: '#4aa3ff', epic: '#b06bff', legendary: '#ffb83d',
};

/* ------------------------------------------------------------------ colours */
const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
function hsl2hex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + hex2(f(0) * 255) + hex2(f(8) * 255) + hex2(f(4) * 255);
}
/** Any CSS-ish colour the site uses ('#rgb', '#rrggbb', 'hsl(h s% l%)', 'hsl(h,s%,l%)', 'rgb(...)') → '#rrggbb' or null. */
export function normColor(c: unknown): string | null {
  if (typeof c !== 'string') return null;
  const s = c.trim().toLowerCase();
  let m = /^#?([0-9a-f]{6})$/.exec(s); if (m) return '#' + m[1];
  m = /^#?([0-9a-f]{3})$/.exec(s); if (m) return '#' + m[1].replace(/./g, '$&$&');
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(s); if (m) return hsl2hex(+m[1] % 360, +m[2], +m[3]);
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s); if (m) return '#' + hex2(+m[1]) + hex2(+m[2]) + hex2(+m[3]);
  return null;
}

/* ------------------------------------------------------------------ "by nick" defaults (port of MDDoodle nickPicks) */
const FUR = ['#f2a65a', '#e8914a', '#f3d9b1', '#9aa3ad', '#7d8a99', '#f4f1ec', '#4a4350', '#a8754f', '#ffc6a0', '#c9ccd3', '#b6a6c9', '#e7b98a'];
const BASE_HATS = ['none', 'tuft', 'cap', 'bow', 'horns', 'crown', 'tophat', 'party', 'wizard', 'antenna', 'antenna2', 'cat', 'bunny', 'halo', 'sprout', 'bandana'];
interface StyleRules { palette(r: () => number): { fill: string; c2: string }; bodyDraws: Record<string, number>; eyePool: string[]; mouthPool?: string[]; blush: number; hatNone: number; capeColor?: string }
const LEGION_RULES: StyleRules = {
  palette(r) {
    const hue = Math.floor(r() * 360);
    const fill = `hsl(${hue} ${60 + Math.floor(r() * 25)}% ${64 + Math.floor(r() * 12)}%)`;
    const c2 = `hsl(${(hue + 140 + Math.floor(r() * 80)) % 360} 75% 58%)`;
    return { fill, c2 };
  },
  bodyDraws: { bean: 1, box: 2, ball: 1, tall: 1, ghost: 1, cone: 1, egg: 1 },
  eyePool: ['dots', 'dots', 'big', 'happy', 'sleepy', 'cyclops', 'stars', 'wide'], blush: 0.6, hatNone: 0.18,
};
const CAT_RULES: StyleRules = {
  palette(r) { const fill = FUR[Math.floor(r() * FUR.length)]; const c2 = `hsl(${Math.floor(r() * 360)} ${70 + Math.floor(r() * 15)}% 58%)`; return { fill, c2 }; },
  bodyDraws: { bean: 2, box: 3, ball: 2, tall: 2, ghost: 2, cone: 2, egg: 2 },
  eyePool: ['dots', 'big', 'big', 'slit', 'happy', 'sleepy', 'cyclops', 'stars'], blush: 0.55, hatNone: 0.2,
};
/** «Чертики» (styles/cherts/characters.js): skin colour from its list, the box form takes two draws (width, top). */
const CHERTS_RULES: StyleRules = {
  palette(r) { const fill = CH_SKINS[Math.floor(r() * CH_SKINS.length)]; const c2 = `hsl(${Math.floor(r() * 360)} 75% 55%)`; return { fill, c2 }; },
  bodyDraws: { bean: 1, box: 2, ball: 1, tall: 1, ghost: 1, cone: 1, egg: 1 },
  eyePool: ['dots', 'dots', 'big', 'happy', 'slit', 'slit', 'sly', 'sly', 'cyclops', 'stars'],
  mouthPool: ['open', 'grin', 'grin', 'tongue'], blush: 0.35, hatNone: 0.4, capeColor: '#2a1a22',
};
const rulesFor = (styleId: StyleId): StyleRules => (styleId === 'cats' ? CAT_RULES : styleId === 'cherts' ? CHERTS_RULES : LEGION_RULES);

export interface NickDefaults {
  shape: string; color: string; color2: string; eyes: string; mouth: string; blush: boolean; hat: string;
  aura: string | null; acc: string[] | null; accColor: string; capeColor: string;
  /** Extra per-nick variation used by the 3D model: body width 0..1, iris colour index, fur pattern. */
  w01: number; iris: number; pat: number;
}

/** Deterministic look "by nick" (approximation of MDDoodle.defaultsFor for legion/cats; other styles use legion rules). */
export function nickDefaults(login: string, styleId: StyleId = 'legion'): NickDefaults {
  const seed = jhash(String(login || '').trim().replace(/^@/, '').toLowerCase());
  const st = rulesFor(styleId), r = jrng(seed);
  const { fill, c2 } = st.palette(r);
  const shape = jpick(r, CATALOG.shapes);
  const w01 = r();                                   // first draw inside the body function = width
  for (let i = 1; i < (st.bodyDraws[shape] || 1); i++) r();
  const eyes = jpick(r, st.eyePool);
  const mouth = jpick(r, st.mouthPool || CATALOG.mouths);
  const blush = r() < st.blush;
  const hat = r() < st.hatNone ? 'none' : jpick(r, BASE_HATS);
  return {
    shape, color: normColor(fill) || '#f2a65a', color2: normColor(c2) || '#4aa3ff', eyes, mouth, blush, hat,
    aura: null, acc: null, accColor: normColor(c2) || '#4aa3ff', capeColor: st.capeColor || '#c0182b',
    // cherts: no iris colours; the face key's iris slot carries the per-nick face bits (fangs, brows, freckles)
    w01, iris: styleId === 'cherts' ? chFaceBits(chTraits(seed)) : (seed >>> 3) % 5, pat: (seed >>> 7) % 5,
  };
}

/* ------------------------------------------------------------------ appearanceFrom */
export type DefaultsFn = (login: string) => Partial<Record<keyof NickDefaults, unknown>> | null | undefined;

const RARS = new Set<string>(CATALOG.rarities);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function cleanGear(g: any): Gear {
  const out: Gear = {};
  if (!g || typeof g !== 'object') return out;
  const rar = (v: unknown) => (typeof v === 'string' && RARS.has(v) ? (v as Gear['wr']) : 'common');
  if (str(g.w)) { out.w = str(g.w); out.wr = rar(g.wr); }
  if (str(g.s)) { out.s = str(g.s); out.sr = rar(g.sr); }
  if (str(g.a)) { out.a = str(g.a); out.ar = rar(g.ar); }
  if (g.am === 'heavy' || g.am === 'light' || g.am === 'cloth') out.am = g.am;
  if (str(g.h)) { out.h = str(g.h); out.hr = rar(g.hr); }
  if (str(g.t)) { out.t = str(g.t); out.tr = rar(g.tr); }
  return out;
}

/**
 * Turn site data into a fully resolved Appearance.
 * @param login  lower-case id (falls back to raw.l / raw.login)
 * @param raw    walker `{l,n,lv,lk,g,gh,aw}` or hero `{login,name,level,wardrobe.cur|look,gear,ghost,role}` (or a mix)
 * @param styleId channel art style ('cats', 'monkeys', 'legion', …)
 * @param defaults optional `(login) => MDDoodle.defaultsFor` values flattened ({shape,color,…}); missing → built-in port
 */
export function appearanceFrom(login: string, raw: any, styleId: StyleId = 'legion', defaults?: DefaultsFn | null): Appearance {
  raw = raw && typeof raw === 'object' ? raw : {};
  const id = String(login || raw.l || raw.login || '').trim().replace(/^@/, '').toLowerCase();
  const lk: Look = (raw.lk && typeof raw.lk === 'object' ? raw.lk : null)
    || (raw.wardrobe && raw.wardrobe.cur && typeof raw.wardrobe.cur === 'object' ? raw.wardrobe.cur : null)
    || (raw.look && typeof raw.look === 'object' ? raw.look : null) || {};
  const nd = nickDefaults(id, styleId);
  let site: Record<string, unknown> | null = null;
  if (defaults) { try { site = (defaults(id) as Record<string, unknown>) || null; } catch { site = null; } }
  const def = <K extends keyof NickDefaults>(k: K): unknown => (site && site[k] != null ? site[k] : nd[k]);

  const shape = str(lk.shape) || str(def('shape')) || 'bean';
  const color = normColor(lk.color) || normColor(def('color')) || nd.color;
  const color2 = normColor(lk.color2) || normColor(def('color2')) || nd.color2;
  const accRaw = Array.isArray(lk.acc) ? lk.acc : Array.isArray(def('acc')) ? (def('acc') as string[]) : [];
  const look: Look = {
    shape, color, color2,
    eyes: str(lk.eyes) || str(def('eyes')) || 'dots',
    mouth: str(lk.mouth) || str(def('mouth')) || 'open',
    blush: typeof lk.blush === 'boolean' ? lk.blush : !!def('blush'),
    hat: str(lk.hat) || str(def('hat')) || 'none',
    acc: accRaw.filter((a) => typeof a === 'string' && a && a !== 'none'),
    accColor: normColor(lk.accColor) || normColor(def('accColor')) || color2,
    capeColor: normColor(lk.capeColor) || normColor(def('capeColor')) || '#c0182b',
  };
  const aura = str(lk.aura) || str(def('aura'));
  if (aura && aura !== 'none') look.aura = aura;

  const gear = cleanGear(raw.g || raw.gear);
  const ghost = !!(raw.gh ?? raw.ghost);
  const levelRaw = raw.lv ?? raw.level;
  const app: Appearance = {
    login: id,
    name: String(str(raw.n) || str(raw.name) || id),
    styleId: styleId || 'legion',
    look, gear, ghost,
  };
  if (Number.isFinite(+levelRaw) && +levelRaw > 0) app.level = +levelRaw;
  if (str(raw.role)) app.role = str(raw.role);
  const aw = Array.isArray(raw.aw) ? raw.aw : null;
  if (aw && aw.length) app.badges = aw.slice(0, 3).filter((a: any) => a && typeof a === 'object')
    .map((a: any) => ({ icon: String(a.i || '✦'), name: String(a.n || a.t || a.id || '') }));
  return app;
}

/** Per-nick extras not stored in Appearance (body width, iris colour, fur pattern). */
export function nickExtras(login: string, styleId: StyleId) { const d = nickDefaults(login, styleId); return { w01: d.w01, iris: d.iris, pat: d.pat }; }
