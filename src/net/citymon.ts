/**
 * «Монстры у стен» (site 12.11 afternoon, citymon.js `window.LGCityMon` + `window.LGCityMonArt`) — pure helpers, no three.js.
 *
 * What the site does (citymon.js, a soft module of the City tab):
 *  - every 1.5 s `tick()`: W = LGCity.wall() (the gate door x / y, `own` = the hero's own town, `glade` = fc-art.js GLADE
 *    with its 13 spots on the cats fair, null elsewhere), only while the hero has `cm` (/api/me hero.cm {n, of, nx}) and
 *    W.own; the view comes from GET /api/citymon (cached 60 s, reloaded when hero.cm.n changes or a pack is due back):
 *    { packs: [{ pid, tier 0|1|2, slot, idx, n, lvl, pack: [{ mon, name, kind, hp, atk, def, lvl, hint }], power, reward }],
 *      elites: [{ eid, epid, tier, slot, idx, n, lvl, name, hint, reward }], soon / eSoon: [{ line, tier, at, slot, idx, n }],
 *      daily { n, max, left, next }, biome, hero { level, busy, hp, max }, myPower, lobby?, respawnMin, now };
 *  - draw(): placeAll() puts every pack on a spot of its tier (sorted by distance from the glade's centre; the pack's own
 *    `idx` when the tier has as many spots as packs, else its random `slot`), elites on the 'e' spots, packs coming back
 *    (`soon`) leave paw-print trails with «Вернутся через m:ss»; each monster is a `<button class="cmw" data-cm="pack"
 *    data-pid>` in the City camera layer `.cm-wall` at FORM offsets, plus a tag «☠ N ур.»; idle groups wander a little.
 *  - a click on a monster → attackDlg(pid): a `.cm-dlg` (role dialog, aria-modal) «Напасть на монстров у стен?» →
 *    «Напасть» = POST /api/citymon/act { op: 'attack', pid } → fightDlg: arena-field.js LGArenaField.play() inside the
 *    same dialog. An elite → eliteDlg: «Собрать группу» (op ecreate / ejoin / estart / eleave / edisband, a guild group).
 *    The view is the hero's OWN (nobody else sees your packs; an elite lobby is seen by the guild in its window).
 *  - the glade is NOT walkable (fc-map.js make() is unchanged: the walk grid ends at the town polygon and the gate passage).
 *
 * In 3D (src/features/citymon.ts, models src/world/citymon-art.ts): the same placement (this file is the port of spotsBy /
 * placeAll / FORM / walkBox), 3D monsters on the spots; E / click on one presses the site's own `.cmw` button (its layer's
 * click handler opens the site's dialog) — nothing is sent by us; the dialog is a site dialog (overlay 'dialog').
 */
export type P2 = [number, number];
export interface CmMon { mon: string; name?: string; lvl?: number }
export interface CmPack { pid: string; tier: number; slot?: number; idx?: number; n?: number; lvl?: number; pack: CmMon[]; power?: number }
export interface CmElite { eid: string; epid?: string; tier?: number; slot?: number; idx?: number; n?: number; lvl?: number; name?: string }
export interface CmSoon { tier?: number; slot?: number; idx?: number; n?: number; at: number; line?: string; el?: number }
export interface CmView {
  packs?: CmPack[]; pack?: CmMon[]; pid?: string; power?: number; elites?: CmElite[]; soon?: CmSoon[]; eSoon?: CmSoon[];
  daily?: { n: number; max: number; left: number; next?: number }; hero?: { level?: number; busy?: string | null }; biome?: string; now?: number;
}
export interface CmSpot { x: number; y: number; t: number | 'e'; gate?: boolean | number; rx?: number; ry?: number }
/** LGCity.wall(): the gate door (x, y), the town, whether it is the hero's own town and the glade (cats fair only). */
export interface CmWall { x: number; y: number; town?: string; own?: boolean; glade?: { cx?: number; y0?: number; spots?: CmSpot[] } | null }

/** citymon.js FORM: the members' offsets (px) round the spot, by pack size. */
export const FORM: Record<number, P2[]> = { 1: [[0, 0]], 2: [[-52, -6], [52, 8]], 3: [[-80, -10], [0, 14], [80, -8]], 4: [[-74, -20], [24, -24], [-30, 20], [70, 16]] };
export const formOf = (n: number): P2[] => FORM[Math.min(4, Math.max(1, n))] || FORM[4];
export const TIER_RU = ['слабая', 'обычная', 'сильная'];

/** citymon.js spotsBy: the spots by tier, each list sorted by the distance from the glade's centre (else the gate door). */
export function spotsBy(W: CmWall): { SP: CmSpot[]; by: Record<string, [CmSpot, number][]> } {
  const SP = (W.glade && W.glade.spots) || [], g = W.glade || {}, gx = g.cx != null ? g.cx : W.x, gy = g.y0 != null ? g.y0 : W.y, by: Record<string, [CmSpot, number][]> = {};
  SP.forEach((p, k) => { (by[String(p.t)] = by[String(p.t)] || []).push([p, k]); });
  for (const t of Object.keys(by)) by[t].sort((a, b) => Math.hypot(a[0].x - gx, a[0].y - gy) - Math.hypot(b[0].x - gx, b[0].y - gy));
  return { SP, by };
}
export interface CmPlaced { p: { x: number; y: number; gate?: boolean | number; rx?: number; ry?: number }; k: number }
export interface CmPlan { packs: (CmPlaced & { D: CmPack })[]; elites: (CmPlaced & { E: CmElite })[]; soon: (CmPlaced & { D: CmSoon })[]; free: CmPlaced[] }
/** citymon.js placeAll (without the `__cmAllSpots` debug switch). */
export function placeAll(W: CmWall, packs: readonly CmPack[], elites: readonly CmElite[], soon: readonly CmSoon[] = [], eSoon: readonly CmSoon[] = []): CmPlan {
  const { SP, by } = spotsBy(W), used = new Set<number>(), out: CmPlan = { packs: [], elites: [], soon: [], free: [] };
  const pick = (t: number | 'e', D: { n?: number; idx?: number; slot?: number }): CmPlaced | null => {
    const L = by[String(t)] || []; if (!L.length) return null;
    const s0 = (D.n || 1) >= L.length && D.idx != null ? D.idx : D.slot || 0;
    for (let j = 0; j < L.length; j++) { const [p, k] = L[(s0 + j) % L.length]; if (!used.has(k)) { used.add(k); return { p, k }; } }
    return null;
  };
  packs.forEach((D, i) => { const q = pick(D.tier, D) || pick(1, D) || { p: { x: W.x + 40 + (i - (packs.length - 1) / 2) * 340, y: W.y + 170 }, k: -1 }; out.packs.push({ D, ...q }); });
  elites.forEach((E, i) => { const q = pick('e', { slot: i, ...E }) || { p: { x: W.x - 300 - i * 190, y: W.y + 196 }, k: -1 }; out.elites.push({ E, ...q }); });
  soon.forEach((D) => { const q = pick(D.tier ?? 1, D); if (q) out.soon.push({ D, ...q }); });
  eSoon.forEach((D, i) => { const q = pick('e', { slot: i, ...D }); if (q) out.soon.push({ D: { ...D, el: 1 }, ...q }); });
  SP.forEach((p, k) => { if (!used.has(k)) out.free.push({ p, k }); });
  return out;
}
/** citymon.js walkBox: how far a group wanders round its spot ([± dx, y0 … y1] px). */
export function walkBox(p: { gate?: boolean | number; rx?: number }, half: number, elite: boolean): [number, number, number] {
  const rx = p.rx || (p.gate ? 150 : 170), dx = Math.max(24, Math.min(elite ? 60 : 70, rx - half - (elite ? 130 : 90)));
  return p.gate ? [dx, -8, 8] : [dx, -22, 20];
}
/** citymon.js draw(): the view's packs (an old single-pack view becomes one pack of tier 1). */
export function viewPacks(V: CmView): CmPack[] {
  return V.packs || (V.pack ? [{ pid: V.pid || '', tier: 1, slot: 0, lvl: V.hero?.level, pack: V.pack, power: V.power }] : []);
}
/** One monster group to draw (a pack, an elite, or a beaten pack whose spot is waiting: `soon`). */
export interface CmGroup {
  kind: 'pack' | 'elite' | 'soon';
  /** pid (pack), epid || eid (elite), 'soon:<spot>' */
  key: string;
  spot: number; x: number; y: number;
  tier: number; lvl?: number; elite: boolean;
  /** members: art id and their base point (px) */
  mons: { id: string; x: number; y: number }[];
  /** wander box (walkBox) */
  box: [number, number, number];
  /** soon: when it comes back (server ms) */
  at?: number;
}
/** The whole picture of citymon.js draw() as plain groups (the 3D builds the monsters from it). */
export function cityMonGroups(W: CmWall, V: CmView): CmGroup[] {
  const packs = viewPacks(V), el = V.elites || [];
  const soon = V.daily && V.daily.left > 0 ? V.soon || [] : [], eSoon = V.eSoon || [];
  const PL = placeAll(W, packs, el, soon, eSoon), out: CmGroup[] = [];
  for (const { D, p, k } of PL.packs) {
    const F = formOf(D.pack.length), half = Math.max(...F.map((f) => Math.abs(f[0]))) + 56;
    out.push({ kind: 'pack', key: D.pid, spot: k, x: p.x, y: p.y, tier: D.tier, lvl: D.lvl, elite: false,
      mons: D.pack.slice(0, 4).map((m, i) => ({ id: m.mon, x: p.x + F[i][0], y: p.y + F[i][1] })), box: walkBox(p, half, false) });
  }
  for (const { E, p, k } of PL.elites) {
    out.push({ kind: 'elite', key: E.epid || E.eid, spot: k, x: p.x, y: p.y, tier: E.tier == null ? 1 : E.tier, lvl: E.lvl, elite: true,
      mons: [{ id: E.eid, x: p.x, y: p.y }], box: walkBox(p, 90, true) });
  }
  for (const { D, p, k } of PL.soon) out.push({ kind: 'soon', key: 'soon:' + k, spot: k, x: p.x, y: p.y, tier: D.tier ?? 1, elite: !!D.el, mons: [], box: [0, 0, 0], at: D.at });
  return out;
}
/** Stable key of a picture (citymon.js draw key, without the timers). */
export function cityMonKey(W: CmWall, V: CmView): string {
  const packs = viewPacks(V), el = V.elites || [];
  return `${W.town}|${W.glade ? 'g' : ''}|${packs.map((P) => P.pid + ':' + P.lvl + ':' + P.pack.map((m) => m.mon).join(',')).join(';')}|${el.map((e) => e.epid || e.eid).join(',')}|${[...(V.soon || []), ...(V.eSoon || [])].map((x) => (x.line || '') + '@' + x.at).join(',')}`;
}

/* ------------------------------------------------------------------ the live page (read only) */
const Wn = (typeof window !== 'undefined' ? window : globalThis) as any;
/** citymon.js tick() condition: LGCityMon loaded, LGCity.wall() answers (no building panel), the hero's own town, hero.cm. */
export function cityMonWall(w: any = Wn): CmWall | null {
  try {
    if (!w.LGCityMon || !w.LGCity || typeof w.LGCity.wall !== 'function') return null;
    const W = w.LGCity.wall();
    if (!W || !W.own) return null;
    const h = W.X && typeof W.X.hero === 'function' ? W.X.hero() : null;
    if (!h || !h.cm) return null;
    return { x: +W.x, y: +W.y, town: String(W.town || ''), own: true, glade: W.glade || null };
  } catch { return null; }
}
/** LGCityMon.view(): the view the site's own client loaded (we never ask the server). */
export function cityMonView(w: any = Wn): CmView | null {
  try { const v = w.LGCityMon && typeof w.LGCityMon.view === 'function' ? w.LGCityMon.view() : null; return v && typeof v === 'object' ? v : null; } catch { return null; }
}
/** CSS.escape for an attribute value (node tests have no CSS global). */
const cssEsc = (s: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));
/**
 * Act on a group like the site's player does: press the site's own monster button in its `.cm-wall` layer (the layer's
 * click handler opens attackDlg / eliteDlg); when the layer is not drawn yet, the same functions of LGCityMon. A beaten
 * pack has nothing to press. Returns what was done (tests).
 */
export function cityMonAct(g: Pick<CmGroup, 'kind' | 'key'>, w: any = Wn, doc: Pick<Document, 'querySelector'> | null = typeof document !== 'undefined' ? document : null): 'button' | 'api' | null {
  if (g.kind === 'soon') return null;
  const sel = g.kind === 'pack' ? `.cm-wall .cmw[data-cm="pack"][data-pid="${cssEsc(g.key)}"]` : `.cm-wall .cmw[data-cm="elite"][data-eid="${cssEsc(g.key)}"]`;
  try {
    const b = doc ? doc.querySelector(sel) as HTMLElement | null : null;
    if (b && typeof b.click === 'function') { b.click(); return 'button'; }
  } catch { /* fall through */ }
  try {
    const M = w.LGCityMon;
    if (g.kind === 'pack' && M && typeof M.attackDlg === 'function') { void M.attackDlg(g.key); return 'api'; }
    if (g.kind === 'elite' && M && typeof M.eliteDlg === 'function') { void M.eliteDlg(g.key); return 'api'; }
  } catch { /* none */ }
  return null;
}
/** The prompt like the site's button / tag titles. */
export function cityMonLabel(g: CmGroup, now = Date.now()): string {
  if (g.kind === 'elite') return `Элитный${g.lvl ? `, ${g.lvl} ур.` : ''} — собрать группу?`;
  if (g.kind === 'soon') {
    const s = Math.max(0, Math.ceil(((g.at ?? now) - now) / 1000));
    return `${g.elite ? 'Элитный вернётся' : 'Вернутся'} через ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  return `Стая: ${TIER_RU[g.tier] || ''}${g.lvl ? `, ${g.lvl} ур.` : ''} — напасть?`;
}
