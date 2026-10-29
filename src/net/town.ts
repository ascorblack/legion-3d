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

/* ------------------------------------------------------------------ names of the camp and the town picker model */
/** The start camp is called by the channel's style: the cat style «Кошачий привал», the cherts style «Чёртов привал»
 *  (site campart.js THEMES.cherts; the cherts bundle is only loaded on cherts channels), every other one «Перепутье». */
export const CAMP_DEFAULT = 'Перепутье';
export const CAMP_SUB = 'лагерь новобранцев Легиона';
const CAMP_BY_STYLE: Record<string, string> = { cats: 'Кошачий привал', cherts: 'Чёртов привал' };
export interface CampName { name: string; sub: string }
/**
 * city.js campName(): the style's own `names.places.camp` ({ name, sub }, doodle.js addNames) wins; without it the table
 * above, then «Перепутье». `siteNames` = `MDDoodle.names` (id → names), optional.
 */
export function campName(style: string | null | undefined, siteNames?: unknown): CampName {
  const id = String(style || '');
  let c: any = null;
  try { c = id ? (siteNames as any)?.[id]?.places?.camp : null; } catch { /* hostile getter */ }
  const own = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : '');
  return { name: own(c?.name) || CAMP_BY_STYLE[id] || CAMP_DEFAULT, sub: own(c?.sub) || CAMP_SUB };
}
/** campName() for the running page (MDDoodle.active + MDDoodle.names). */
export function pageCampName(win: any): CampName {
  try { return campName(win?.MDDoodle?.active, win?.MDDoodle?.names); } catch { return campName('', null); }
}

/** city.js BIO_ICO / BIO_RU / sizeRu / WHY_RU (the town picker's rows). */
export const BIO_ICO: Record<string, string> = { meadow: '🌾', forest: '🌳', taiga: '🌲', ice: '❄️', mount: '⛰️', swamp: '🪷', ash: '🌋', desert: '🏜️', coast: '🌊', blight: '☠️', ruin: '🏚️' };
export const BIO_RU: Record<string, string> = { meadow: 'луга', forest: 'лес', taiga: 'тайга', ice: 'льды', mount: 'горы', swamp: 'болота', ash: 'пепел', desert: 'пустыня', coast: 'побережье', blight: 'порча', ruin: 'руины' };
export const WHY_RU: Record<string, string> = { owned: 'округ канала', party: 'отряд в округе', tester: 'тестерам' };
export const sizeRu = (t: { kind?: unknown; danger?: unknown }): string => (t.kind === 'capital' ? 'столица' : +(t.danger as number) >= 2 ? 'посёлок' : 'деревня');

export interface TownRow {
  id: string;
  kind: 'fair' | 'camp' | 'district';
  name: string;
  icon: string;
  /** Second line: size, biome, price factor, why it is open. */
  sub: string;
  current: boolean;
  /** Greyed out: can't go there now; `reason` says why. */
  disabled: boolean;
  reason?: string;
  danger?: number;
  biome?: string;
}
export interface TownsView {
  rows: TownRow[];
  /** Footnote under the list (the site's own wording). */
  note: string;
  /** The towns list couldn't be read (null response / not ok). */
  error?: string;
}
export interface TownsInput {
  /** Answer of GET /api/city/towns (`{ ok, list, gone?, quest?, fair? }`) or null. */
  resp: any;
  hero: HeroTownFlags | null;
  /** Current town id (detectTown). */
  current: string;
  /** Channel style id (MDDoodle.active) and MDDoodle.names for the camp's name. */
  style: string;
  names?: unknown;
}
const safeStr = (v: unknown, max = 60) => String(v ?? '').replace(/[<>]/g, '').slice(0, max);
const idOk = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,32}$/.test(v);

/**
 * The town picker's rows, the way city.js townPick() builds them — Ярмарка, the camp, the district towns the server
 * lists — but as data. Closed places the site would hide are kept greyed out with the reason (squad in an expedition,
 * the channel's home district drawn).
 */
export function townsView(inp: TownsInput): TownsView {
  const T = inp.resp, h = inp.hero || null;
  if (!T || !T.ok) return { rows: [], note: '', error: 'Список городов не загрузился — попробуй ещё раз.' };
  const list: any[] = Array.isArray(T.list) ? T.list : [];
  const rows: TownRow[] = [];
  const quest = !!T.quest, gone = !!T.gone || fairGone(h);
  const fairOk = !gone && (!quest || !!T.fair);
  const fair: TownRow = { id: FAIR, kind: 'fair', name: 'Ярмарка', icon: '🎪', sub: quest ? 'отряд здесь' : 'всегда открыта', current: inp.current === FAIR, disabled: !fairOk };
  if (!fairOk) { fair.sub = 'закрыта'; fair.reason = gone ? 'Ярмарка позади: канал выбрал свой округ' : 'В походе: только город, где стоит отряд'; }
  rows.push(fair);
  if (campOpen(h) || inp.current === CAMP) {
    const c = campName(inp.style, inp.names);
    const row: TownRow = { id: CAMP, kind: 'camp', name: c.name, icon: '⛺', sub: c.sub, current: inp.current === CAMP, disabled: false };
    if (quest) { row.disabled = true; row.reason = 'В походе: только город, где стоит отряд'; }
    else if (gone) { row.disabled = true; row.reason = 'Лагерь позади: канал выбрал свой округ'; }
    rows.push(row);
  }
  for (const t of list) {
    if (!t || !idOk(t.id)) continue;
    const danger = Math.max(0, Math.min(5, +t.danger || 0)), biome = safeStr(t.biome, 16);
    const parts = [`${'★'.repeat(danger)}${danger ? ' ' : ''}${sizeRu(t)}`, BIO_RU[biome] || ''];
    if (!(t.own || (t.home && +t.k <= 1))) parts.push(`цены ×${String(+t.k || 2).replace('.', ',')}`);
    if (t.home) parts.push('край отряда');
    if (WHY_RU[String(t.why)]) parts.push(WHY_RU[String(t.why)]);
    const sub = parts.filter(Boolean).join(' · ');
    rows.push({ id: t.id, kind: 'district', name: safeStr(t.town || t.id), icon: BIO_ICO[biome] || '🏘', sub, current: t.id === inp.current, disabled: false, danger, biome });
  }
  const hasTowns = !!(h && (h.tw || h.cp)) || rows.some((r) => r.kind !== 'fair');
  const note = list.length ? 'Город округа открывается, когда канал захватит округ; на стриме — пока отряд стоит в округе (участникам отряда).'
    : hasTowns ? 'Других городов пока нет. Город округа открывается, когда канал захватит округ.'
      : 'Города округов откроются, когда канал захватит округ; на стриме — пока отряд стоит в округе (участникам отряда).';
  return { rows, note };
}

/* ------------------------------------------------------------------ hand-made villages ★1 (site 28.10, towngen.js buildHand) */
/**
 * Since 28.10 some district towns («деревни ★1», towngen.js HAND) are drawn by hand: the page loads
 * `/site/villages/<id>.js` (window.LGVillages[id], LGTownGen.prep) and LGTownGen.generate() builds the same layout L as the
 * generator from it (TL.hand = id). The differences that matter in 3D:
 *   - buildings not only in the back row: a lot with `B > 800` stands lower down the street (base y = B, depth scale `s`,
 *     its obstacle `{ b, bld }` cannot be walked through, behind it you can walk — the 2D art hides you);
 *     gate, forge (+ its anvil awning «Заточка») and mine stay in the back row;
 *   - streets are arbitrary polylines `{ k, w, pts }`, plazas ellipses, water any rects / ellipses, bridges where the artist put them;
 *   - cottages (`houses`, not enterable) are obstacles too; props carry their kind, scale and footprint.
 * villageScene() copies what the 3D builder needs as plain, validated data (any missing / malformed field → empty list).
 */
export interface VillageRoad { k: string; w: number; pts: [number, number][] }
export interface VillagePlaza { k: string; x: number; y: number; rx: number; ry: number; rect: boolean; green: boolean; mark: string | null }
export type VillageWater = { k: string; e: [number, number, number, number] } | { k: string; b: [number, number, number, number] };
export interface VillageBridge { x0: number; x1: number; y0: number; y1: number }
/** A building lot: `B` (base y, > 800) and `s` (depth scale) only for a building lower down the street. */
export interface VillageLot { k: string; x0: number; x1: number; B?: number; s?: number }
export interface VillageHouse { x0: number; x1: number; base: number; s: number }
export interface VillageProp { k: string; x: number; y: number; s: number; tall: number; foot: [number, number] | null; water: boolean }
export interface VillageScene {
  id: string; biome: string;
  roads: VillageRoad[]; plazas: VillagePlaza[]; water: VillageWater[]; bridges: VillageBridge[];
  lots: VillageLot[]; houses: VillageHouse[]; props: VillageProp[];
}
const num = (v: unknown): number | null => { const n = +(v as number); return typeof v !== 'boolean' && v !== null && v !== '' && Number.isFinite(n) ? n : null; };
const quad = (a: unknown): [number, number, number, number] | null => {
  if (!Array.isArray(a) || a.length < 4) return null;
  const q = a.slice(0, 4).map(num); return q.every((v) => v !== null) ? q as [number, number, number, number] : null;
};
const list = (a: unknown): any[] => (Array.isArray(a) ? a.filter((x) => x && typeof x === 'object') : []);
const kindOf = (v: unknown, d: string) => (typeof v === 'string' && /^[\w-]{1,24}$/.test(v) ? v : d);

/** The hand-village scene of a towngen layout (TL.hand set), or null for a generated town / no layout. */
export function villageScene(TL: any): VillageScene | null {
  if (!TL || typeof TL !== 'object' || !TL.hand) return null;
  const roads: VillageRoad[] = [];
  for (const r of list(TL.roads)) {
    const pts = (Array.isArray(r.pts) ? r.pts : []).map((p: unknown) => (Array.isArray(p) ? [num(p[0]), num(p[1])] : [null, null]))
      .filter((p: (number | null)[]) => p[0] !== null && p[1] !== null) as [number, number][];
    if (pts.length >= 2) roads.push({ k: kindOf(r.k, 'lane'), w: Math.max(8, Math.min(120, num(r.w) ?? 36)), pts });
  }
  const plazas: VillagePlaza[] = [];
  for (const p of list(TL.plazas)) {
    const x = num(p.x), y = num(p.y), rx = num(p.rx), ry = num(p.ry);
    if (x === null || y === null || !rx || !ry || rx < 0 || ry < 0) continue;
    plazas.push({ k: kindOf(p.k, 'plaza'), x, y, rx, ry, rect: p.shape === 'rect', green: !!p.green, mark: typeof p.mark === 'string' ? kindOf(p.mark, '') || null : null });
  }
  const water: VillageWater[] = [];
  for (const w of list(TL.water)) {
    const e = quad(w.e), b = quad(w.b);
    if (e && e[2] > 0 && e[3] > 0) water.push({ k: kindOf(w.k, 'pond'), e });
    else if (b && b[2] > b[0] && b[3] > b[1]) water.push({ k: kindOf(w.k, 'water'), b });
  }
  const bridges: VillageBridge[] = [];
  for (const b of list(TL.bridges)) {
    const q = quad(b.b) || [num(b.x0), num(b.y0), num(b.x1), num(b.y1)];
    if (q.every((v) => v !== null) && q[2]! > q[0]! && q[3]! > q[1]!) bridges.push({ x0: q[0]!, y0: q[1]!, x1: q[2]!, y1: q[3]! });
  }
  const lots: VillageLot[] = [];
  for (const l of list(TL.lots)) {
    const x0 = num(l.x0), x1 = num(l.x1), B = num(l.B), s = num(l.s);
    if (x0 === null || x1 === null || x1 <= x0 || typeof l.k !== 'string') continue;
    lots.push({ k: kindOf(l.k, 'lot'), x0, x1, ...(B !== null && B > 800 ? { B, s: s && s > 0.5 && s < 3 ? s : 1 } : {}) });
  }
  const houses: VillageHouse[] = [];
  for (const c of list(TL.cottages)) {
    const x0 = num(c.x0), x1 = num(c.x1), base = num(c.base), s = num(c.s);
    if (x0 !== null && x1 !== null && base !== null && x1 > x0) houses.push({ x0, x1, base, s: s && s > 0.5 && s < 3 ? s : 1 });
  }
  const props: VillageProp[] = [];
  for (const p of list(TL.props)) {
    const x = num(p.x), y = num(p.y); if (x === null || y === null) continue;
    const s = num(p.s) || 1, e = quad(p.ob?.e);
    props.push({ k: kindOf(p.k, 'thing'), x, y, s, tall: num(p.tall) ?? 0, foot: e ? [e[2], e[3]] : null, water: !!p.ob?.water });
  }
  return { id: String(TL.hand).slice(0, 32), biome: kindOf(TL.biome, 'meadow'), roads, plazas, water, bridges, lots, houses, props };
}
