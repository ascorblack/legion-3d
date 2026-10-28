/**
 * «Чертики» (site style 'cherts'): the pure part — colours and the per-nick traits (site styles/cherts/characters.js T(k):
 * from the seed, never from r()). No three.js: safe for appearance.ts, tests and workers. 3D parts: cherts.ts.
 */
export const CH_INK = '#2a0d14';
export const CH_GOLD = '#ffc83d';
export const CH_FIRE = ['#ffe27a', '#ff9a2a', '#ff4a1a'] as const;
/** Skin colours "by nick" (mostly reds), in the site's order: palette(r) picks one with the first r(). */
export const CH_SKINS = ['#e83a3a', '#d42a3a', '#ff5a5a', '#c8102e', '#e83a3a', '#ff7a3d', '#ff8fb0', '#b33a8a', '#7a3ab3', '#3a3346', '#d94a1a', '#9a1a3a', '#5aae6a', '#ff5a5a'];
const HORN = ['#f3e6c8', '#f3e6c8', '#2a1a22', CH_GOLD, '#7a1a2a'];

/* ------------------------------------------------------------------ colours */
const hex6 = (c: string): number | null => {
  const m = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(c).trim()); if (!m) return null;
  const x = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  return parseInt(x, 16);
};
/** sRGB mix of two '#rrggbb' colours (t = share of the second), as the site does it; other inputs come back as they are. */
export function chMix(c: string, d: string, t: number): string {
  const a = hex6(c), b = hex6(d); if (a === null || b === null) return c;
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t).toString(16).padStart(2, '0');
  return '#' + ch(16) + ch(8) + ch(0);
}
export const chDark = (c: string, t: number) => chMix(c, '#1a0408', t);
export const chLight = (c: string, t: number) => chMix(c, '#fff4ec', t);

/* ------------------------------------------------------------------ traits "by nick" (site T(k): from the seed) */
export type HornKind = 'cone' | 'goat' | 'ram' | 'bull' | 'nub' | 'broken';
export type TailShape = 'scurve' | 'curl' | 'loop' | 'hook' | 'wave' | 'ground';
export type TailTip = 'arrow' | 'heart' | 'flame' | 'tuft';
export interface ChTraits {
  horn: HornKind; hornCol: string; tip: TailTip; tshape: TailShape;
  belly: boolean; freckles: boolean; goatee: boolean; fang: boolean; brows: boolean;
}
export function chTraits(seed: number): ChTraits {
  const s = seed >>> 0, h = Math.imul(s ^ 0x6a09e667, 2654435761) >>> 0;
  return {
    horn: (['cone', 'cone', 'goat', 'ram', 'bull', 'nub', 'broken'] as const)[h % 7],
    hornCol: HORN[(h >>> 3) % HORN.length],
    tip: (['arrow', 'arrow', 'heart', 'flame', 'tuft'] as const)[(h >>> 9) % 5],
    tshape: (['scurve', 'curl', 'loop', 'hook', 'wave', 'ground'] as const)[(h >>> 21) % 6],
    belly: (h >>> 12) % 2 === 0,
    freckles: (h >>> 13) % 4 === 0,
    goatee: (h >>> 15) % 4 === 0,
    fang: (h >>> 17) % 3 !== 0,
    brows: (h >>> 19) % 3 !== 0,
  };
}
/** Face bits packed into the face key's `iris` slot (the imps have no iris colours): 1 fangs, 2 brows, 4 freckles. */
export const chFaceBits = (t: ChTraits) => (t.fang ? 1 : 0) | (t.brows ? 2 : 0) | (t.freckles ? 4 : 0);

