/**
 * «Ночь Тыквенной Луны» NPCs (site 28.10, hwnpc.js `window.LGHwNpc` + cityhw.js `npcSpots`): «Ступа сладостей» (candy
 * exchange — a witch in a mortar by a candy barrel) and «Призрачный Фонарщик» (battle-pass keeper — a ghost with a
 * pole under a wrought arch of 20 lanterns; lit = passed pass levels, `hero.hw.p`).
 * The site shows them only on the Fair of the City in its Halloween look (city.js hwNpc: `hero.hwc.look`, not a district
 * town, not the camp), standing on the middle street by the canal right of the Mine. Clicking one opens the site's own
 * window (city.js openPanel('hwshop' | 'hwpass') → hwOpen → LGHwNpc.open).
 *
 * Pure here (no three.js): where they stand — from the site's own functions when loaded (LGCityHW.npcSpots +
 * LGHwNpc.geo: building hit / door, obstacle ellipses), else the same numbers as a fallback table (offline demo,
 * tests, or before the site lazy-loaded hwnpc.js) — and the pass level.
 */
import { toX, toZ, SX, SZ } from '../../world/coords';

export type NpcId = 'hwshop' | 'hwpass';
/** One NPC in city px (site coordinates). */
export interface NpcPlace {
  id: NpcId;
  title: string;
  icon: string;
  /** middle of the bottom (ground line), px */
  x: number; y: number;
  /** art scale (hwnpc.js S_BASE) */
  s: number;
  /** clickable art box [x0, x1, y0, y1] px (2D screen box: y0 is the TOP of the art, not depth) */
  hit: [number, number, number, number];
  /** where a walker goes to use it */
  door: { x: number; y: number };
  /** base ellipses [cx, cy, rx, ry] px — the walk-grid obstacles (citymap.js make({ hwObst })) */
  obst: [number, number, number, number][];
  /** 'site' = from LGHwNpc.geo, 'table' = fallback numbers */
  src: 'site' | 'table';
}

/* ---- fallback: the same numbers as hwnpc.js 28.10 (SHAPE, S_BASE, GROUND, META) and cityhw.js NPC_FAIR ---- */
const GROUND = 500, S_BASE = 0.62;
const SPOTS: { id: NpcId; x: number; y: number }[] = [{ id: 'hwshop', x: 2805, y: 1420 }, { id: 'hwpass', x: 3125, y: 1414 }];
const SHAPE: Record<NpcId, { cx: number; hit: number[]; door: number[]; obst: number[][] }> = {
  hwshop: { cx: 250, hit: [40, 490, 96, 506], door: [250, 548], obst: [[250, 486, 128, 24], [72, 498, 18, 9], [434, 496, 46, 12]] },
  hwpass: { cx: 260, hit: [36, 484, 58, 506], door: [292, 548], obst: [[60, 492, 22, 12], [460, 492, 22, 12], [196, 494, 42, 12]] },
};
export const NPC_META: Record<NpcId, { title: string; icon: string }> = {
  hwshop: { title: 'Ступа сладостей', icon: '🍬' },
  hwpass: { title: 'Призрачный Фонарщик', icon: '🏮' },
};
const f1 = (v: number) => Math.round(v * 10) / 10;

/** hwnpc.js geo() maths for one spot (fallback). */
export function tablePlace(sp: { id: NpcId; x: number; y: number; s?: number }): NpcPlace {
  const H = SHAPE[sp.id], s = sp.s || S_BASE;
  const tx = (cx: number) => f1(sp.x + (cx - H.cx) * s), ty = (cy: number) => f1(sp.y + (cy - GROUND) * s);
  return {
    id: sp.id, ...NPC_META[sp.id], x: sp.x, y: sp.y, s,
    hit: [tx(H.hit[0]), tx(H.hit[1]), ty(H.hit[2]), ty(H.hit[3])],
    door: { x: tx(H.door[0]), y: ty(H.door[1]) },
    obst: H.obst.map(([ox, oy, rx, ry]) => [f1(sp.x + (ox - H.cx) * s), f1(sp.y + (oy - GROUND) * s), f1(rx * s), f1(ry * s)] as [number, number, number, number]),
    src: 'table',
  };
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isId = (v: unknown): v is NpcId => v === 'hwshop' || v === 'hwpass';

/** One LGHwNpc.geo() result → NpcPlace, or null when it is not what we expect. */
export function placeFromGeo(sp: { id: unknown; x: unknown; y: unknown; s?: unknown }, g: any): NpcPlace | null {
  if (!isId(sp.id) || !num(sp.x) || !num(sp.y) || !g || !g.building || !Array.isArray(g.obst)) return null;
  const b = g.building, hit = b.hit, door = b.door;
  if (!Array.isArray(hit) || hit.length !== 4 || !hit.every(num) || !door || !num(door.x) || !num(door.y)) return null;
  const obst = (g.obst as any[]).map((o) => o && o.e).filter((e) => Array.isArray(e) && e.length === 4 && e.every(num)) as [number, number, number, number][];
  if (!obst.length) return null;
  return {
    id: sp.id, title: typeof b.title === 'string' && b.title ? b.title : NPC_META[sp.id].title, icon: typeof b.icon === 'string' ? b.icon : NPC_META[sp.id].icon,
    x: sp.x, y: sp.y, s: num(sp.s) ? sp.s : S_BASE, hit: [hit[0], hit[1], hit[2], hit[3]], door: { x: door.x, y: door.y }, obst, src: 'site',
  };
}

/**
 * Where the NPCs stand on the Fair. `W` = window (or a stub): LGCityHW.npcSpots({ fair: true }) decides whether / where
 * (the site's own hook; [] = none), LGHwNpc.geo gives the shapes; missing pieces fall back to the table.
 */
export function npcPlaces(W: any): NpcPlace[] {
  let spots: any[] = SPOTS;
  try { const H = W && W.LGCityHW; if (H && typeof H.npcSpots === 'function') { const r = H.npcSpots({ fair: true }); if (Array.isArray(r)) spots = r; } } catch { /* table */ }
  const N = W && W.LGHwNpc;
  const out: NpcPlace[] = [];
  for (const sp of spots) {
    if (!sp || !isId(sp.id) || !num(sp.x) || !num(sp.y)) continue;
    let p: NpcPlace | null = null;
    if (N && typeof N.geo === 'function') { try { p = placeFromGeo(sp, N.geo(sp, { lv: 0 })); } catch { p = null; } }
    out.push(p ?? tablePlace(sp));
  }
  return out;
}

/** Battle-pass level of the hero (`hero.hw.p`, 0…20) — how many lanterns burn (city.js hnLv). */
export function passLevel(hero: unknown): number {
  const hw = hero && typeof hero === 'object' ? (hero as any).hw : null;
  const p = hw && typeof hw === 'object' ? +hw.p : 0;
  return Number.isFinite(p) ? Math.max(0, Math.min(20, Math.floor(p))) : 0;
}

/** Inside one of the obstacle ellipses (px) — the walk-grid rule of citymap.js for `{ e }` obstacles. */
export function npcBlocks(places: readonly NpcPlace[], x: number, y: number, pad = 0): boolean {
  for (const p of places) for (const [cx, cy, rx, ry] of p.obst) {
    const dx = (x - cx) / (rx + pad), dy = (y - cy) / (ry + pad);
    if (dx * dx + dy * dy <= 1) return true;
  }
  return false;
}

/** The site's make() options for the NPCs (citymap.js: hwObst → obstacles, hwB → buildings / hot spots). */
export function makeOpts(places: readonly NpcPlace[]): { hwObst: { e: number[]; hwnpc: NpcId }[]; hwB: any[] } {
  return {
    hwObst: places.flatMap((p) => p.obst.map((e) => ({ e: [...e], hwnpc: p.id }))),
    hwB: places.map((p) => ({ id: p.id, title: p.title, icon: p.icon, hw: true, hit: [...p.hit], door: { ...p.door } })),
  };
}

/** Metres: the NPC's ground centre (x, z), its obstacle ellipses and its hit box extents (for the 3D model / prompts). */
export interface NpcWorld {
  id: NpcId; title: string; icon: string;
  x: number; z: number;
  /** ellipses in metres: [cx, cz, rx, rz] */
  base: [number, number, number, number][];
  /** x range of the art (m) */
  x0: number; x1: number;
  /** art height (m): the art box top above the ground line */
  h: number;
  door: { x: number; z: number };
}
export function npcWorld(p: NpcPlace): NpcWorld {
  return {
    id: p.id, title: p.title, icon: p.icon, x: toX(p.x), z: toZ(p.y),
    base: p.obst.map(([cx, cy, rx, ry]) => [toX(cx), toZ(cy), rx * SX, ry * SZ] as [number, number, number, number]),
    x0: toX(p.hit[0]), x1: toX(p.hit[1]), h: Math.max(1.5, (p.hit[3] - p.hit[2]) * SX),
    door: { x: toX(p.door.x), z: toZ(p.door.y) },
  };
}
