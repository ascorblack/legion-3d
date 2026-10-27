/**
 * Which «город» the site's City tab shows right now, and the layouts of the non-fair ones (no DOM, no three.js —
 * test/town.test.ts). The site keeps its current town private (city.js `TOWN`; `LGCity.where()` / `towns()` are not
 * on the runtime object since 26.10: they ended up inside a `//` comment). What IS observable:
 *   1. `LGCity.where?.()`              — if the site ever exposes it again (authoritative);
 *   2. the City DOM: `#tab-city .cy`   — `data-town` on camp / district towns (city.js buildCamp/buildTown), absent on
 *                                        the fair; no `.cy` while a town is being prepared («Город строится…»);
 *   3. the town picker: `.cy-tp [data-town][aria-current="true"]` (only after it was opened);
 *   4. sessionStorage `lgCityTown`     — city.js townSet(): the last chosen non-fair town;
 *   5. the hero (`/api/me`, SSE `me`) — hm.id (district-draw: the channel's home district opens directly),
 *                                        hm.camp / cp (start camp «Перепутье»).
 */
export const CAMP = 'camp';
export const FAIR = 'fair';

export interface HeroTownFlags { cp?: unknown; tw?: unknown; hm?: { id?: unknown; camp?: unknown } | null }
export interface TownSignals {
  where?: string | null;
  /** `#tab-city .cy` present: its data-town ('' = none = fair); undefined: no built City DOM. */
  dom?: string | null;
  picker?: string | null;
  session?: string | null;
  hero?: HeroTownFlags | null;
}
export type TownSource = 'where' | 'dom' | 'picker' | 'session' | 'hero' | 'default';

/** city.js fairGone(): the channel drew its home district — fair and camp are closed for it. */
export const fairGone = (h?: HeroTownFlags | null): boolean => {
  const hm = h?.hm; return !!(hm && hm.id && !hm.camp && hm.id !== FAIR && hm.id !== CAMP);
};
/** city.js cpOn(): the camp is open for this hero. */
export const campOpen = (h?: HeroTownFlags | null): boolean => !!(h && (h.cp || (h.hm && h.hm.camp))) && !fairGone(h);

const clean = (v: unknown): string | null => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : null);

/** The current town id from whatever the page shows, strongest signal first. */
export function detectTown(s: TownSignals): { id: string; via: TownSource } {
  const w = clean(s.where); if (w) return { id: w, via: 'where' };
  if (s.dom !== undefined && s.dom !== null) return { id: clean(s.dom) || FAIR, via: 'dom' };
  const p = clean(s.picker); if (p) return { id: p, via: 'picker' };
  const h = s.hero || null;
  // city.js open(): a home district (hm.id, not camp) replaces fair/camp; hm.camp opens the camp unless a town was chosen
  if (fairGone(h)) return { id: String(h!.hm!.id), via: 'hero' };
  const ss = clean(s.session);
  if (ss && ss !== FAIR && (ss === CAMP ? campOpen(h) : !h || !!h.tw)) return { id: ss, via: 'session' };
  if (h?.hm?.camp && campOpen(h)) return { id: CAMP, via: 'hero' };
  return { id: FAIR, via: 'default' };
}

/** Read the signals from a page (browser only). */
export function readTownSignals(win: any, doc: Document, hero: HeroTownFlags | null): TownSignals {
  let where: string | null = null;
  try { const f = win.LGCity?.where; if (typeof f === 'function') where = f()?.id ?? null; } catch { /* none */ }
  const cy = doc.querySelector<HTMLElement>('#tab-city .cy');
  const dom = cy ? (cy.dataset.town || '') : undefined;
  const picker = doc.querySelector<HTMLElement>('#tab-city .cy-tp [data-town][aria-current="true"]')?.dataset.town ?? null;
  let session: string | null = null;
  try { session = win.sessionStorage?.getItem('lgCityTown') ?? null; } catch { /* blocked */ }
  return { where, dom, picker, session, hero };
}

/** city.js townMeta(): finished constructions become levels, the rest stay in `building`. */
export function townMeta(t: any, now = Date.now()): any {
  const b = (t && t.building) || {}, lv: Record<string, number | undefined> = { ...((t && t.levels) || {}) }, left: Record<string, unknown> = {};
  for (const [k, v] of Object.entries<any>(b)) {
    if (v && +v.until > now) left[k] = v;
    else if (v) lv[k] = Math.max(+(lv[k] || 0), +v.to || 0) || undefined;
  }
  return { ...t, levels: lv, building: left };
}

/** Camp scene data the 3D builder needs beyond CityLayout (campmap.js layout()). */
export interface CampScene {
  fire: { x: number; y: number; rx: number; ry: number; logs: number[][] };
  tents: { x: number; y: number; w: number; d: number; k: string; flip?: boolean }[];
  props: { k: string; x: number; y: number; e?: [number, number] }[];
  lines: [number, number][];
  trail: [number, number][][];
  fence: { y: number; x0: number; x1: number };
  spawn: [number, number];
}
/** Pick the camp scene fields out of LGCampMap.get() (plain copies). */
export function campScene(TL: any): CampScene | null {
  if (!TL || !TL.fire || !Array.isArray(TL.tents)) return null;
  return {
    fire: { x: +TL.fire.x, y: +TL.fire.y, rx: +TL.fire.rx, ry: +TL.fire.ry, logs: (TL.fire.logs || []).map((l: number[]) => [...l]) },
    tents: TL.tents.map((t: any) => ({ x: +t.x, y: +t.y, w: +t.w, d: +t.d, k: String(t.k || 'mid'), flip: !!t.flip })),
    props: (TL.props || []).map((p: any) => ({ k: String(p.k), x: +p.x, y: +p.y, ...(p.e ? { e: [+p.e[0], +p.e[1]] as [number, number] } : {}) })),
    lines: (TL.lines || []).map((l: number[]) => [+l[0], +l[1]] as [number, number]),
    trail: (TL.trail || []).map((s: number[][]) => s.map((p) => [+p[0], +p[1]] as [number, number])),
    fence: TL.FENCE ? { y: +TL.FENCE.y, x0: +TL.FENCE.x0, x1: +TL.FENCE.x1 } : { y: TL.H - 90, x0: 26, x1: TL.W - 26 },
    spawn: Array.isArray(TL.spawn) ? [+TL.spawn[0], +TL.spawn[1]] : [TL.W / 2, (TL.AREA.y0 + TL.AREA.y1) / 2],
  };
}
