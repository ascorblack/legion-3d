/**
 * Pure geometry for the Карта tab and the HUD minimap: city features in metres (x right, z = depth, down on the map),
 * building pins, view (pan/zoom) math and collision-avoiding label placement. No DOM — test/ui-map.test.ts.
 * City px → metres: x × 0.01, (y − 800) × 0.02 (src/world/coords.ts) → the fair city is 55 m × 22 m.
 */
import { fairCatsOf } from '../net/faircats';
import type { CityLayout, Building } from '../contracts';
import { toX, toZ } from '../world/coords';

export interface Rect { x0: number; z0: number; x1: number; z1: number }
export interface MapPin { id: string; title: string; icon: string; sub?: string; soon: boolean; lower: boolean; x: number; z: number; door: { x: number; y: number } }
export interface MapFeatures {
  bounds: Rect;
  /** Building blocks (footprints) — upper street: behind the facade line (z < 0); lower street: on the terrace. */
  blocks: (Rect & { id: string; soon: boolean })[];
  water: Rect[];
  ponds: { x: number; z: number; rx: number; rz: number }[];
  /** The ledge between the upper and the lower street (walls), stairs across it, bridges over the canal. */
  ledge: Rect[];
  stairs: Rect[];
  bridges: Rect[];
  /** Small solid things: benches, flower beds, lamps, decor, statue (ellipses / small boxes). */
  props: { x: number; z: number; rx: number; rz: number; kind: 'lamp' | 'bed' | 'bench' | 'decor' | 'statue' }[];
  pins: MapPin[];
  /** District lettering (street names) drawn faintly across the bands. */
  areas: { name: string; x: number; z: number }[];
}

/** Depth (m) of a building block behind the back street on the map. */
export const BLOCK_DEPTH = 4.2;

export function mapFeatures(L: CityLayout): MapFeatures {
  const A = L.area, low = L.low && L.low.edge ? L.low : undefined;
  // the new cats fair: free-standing buildings all over the map — each block is its foot (src/net/faircats.ts)
  const fc = fairCatsOf(L);
  const edgeY0 = low ? low.edge[0] : Infinity, edgeY1 = low ? low.edge[1] : Infinity;
  const lowTop = low ? low.top : Infinity;
  const isLower = (b: Building) => !!fc || b.door.y > lowTop;
  let xMin = toX(A.x0), xMax = toX(A.x1);
  for (const b of L.buildings) { xMin = Math.min(xMin, toX(b.hit[0])); xMax = Math.max(xMax, toX(b.hit[1])); }
  const bounds: Rect = { x0: xMin - 1, z0: fc ? toZ(A.y0) : -BLOCK_DEPTH - 1.2, x1: xMax + 1, z1: toZ(A.y1) + 0.8 };

  const blocks: MapFeatures['blocks'] = [];
  for (const b of L.buildings) {
    const x0 = toX(b.hit[0]), x1 = toX(b.hit[1]);
    const ft = fc?.buildings.find((x) => x.id === b.id)?.foot;
    if (ft) { blocks.push({ id: b.id, soon: !!b.soon, x0: toX(ft[0]), x1: toX(ft[2]), z0: toZ(ft[1]), z1: toZ(ft[3]) }); continue; }
    if (isLower(b)) {
      const z0 = toZ(Math.max(edgeY1 === Infinity ? b.hit[2] : edgeY1, b.hit[2])), z1 = toZ(b.hit[3]);
      blocks.push({ id: b.id, soon: !!b.soon, x0, x1, z0: Math.min(z0, z1 - 0.6), z1 });
    } else {
      // stalls reach into the street (shop door at y≈960): the block ends a little in front of the door
      const z1 = Math.max(0, toZ(b.door.y) - 0.9);
      blocks.push({ id: b.id, soon: !!b.soon, x0, x1, z0: -BLOCK_DEPTH, z1 });
    }
  }

  const water: Rect[] = [], ponds: MapFeatures['ponds'] = [], ledge: Rect[] = [], props: MapFeatures['props'] = [];
  const insideBlock = (x: number, z: number) => blocks.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  for (const o of L.obstacles) {
    if ('b' in o) {
      const [x0, y0, x1, y1] = o.b;
      const r = { x0: toX(x0), z0: toZ(y0), x1: toX(x1), z1: toZ(y1) };
      if (o.water) water.push(r);
      else if (y0 >= edgeY0 - 2 && y1 <= edgeY1 + 2) ledge.push(r);
      else if ((x1 - x0) * (y1 - y0) < 12000) props.push({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, rx: (r.x1 - r.x0) / 2, rz: (r.z1 - r.z0) / 2, kind: 'bench' });
    } else if ('e' in o) {
      const [cx, cy, rx, ry] = o.e;
      const p = { x: toX(cx), z: toZ(cy), rx: rx * 0.01, rz: ry * 0.02 };
      if (o.water) ponds.push(p);
      else if (insideBlock(p.x, p.z)) continue;
      else props.push({ ...p, kind: rx <= 14 ? 'lamp' : rx >= 100 ? 'statue' : rx >= 90 ? 'bed' : 'decor' });
    }
  }
  const stairs: Rect[] = [], bridges: Rect[] = [];
  if (low) {
    for (const [a, b] of low.stairs) stairs.push({ x0: toX(a), x1: toX(b), z0: toZ(edgeY0), z1: toZ(edgeY1) });
    for (const [a, b] of low.bridges) bridges.push({ x0: toX(a), x1: toX(b), z0: toZ(low.canal[0]) - 0.15, z1: toZ(low.canal[1]) + 0.15 });
  }

  const pins: MapPin[] = L.buildings.map((b) => {
    const lower = isLower(b);
    return {
      id: b.id, title: b.title, icon: b.icon || '🏠', sub: b.sub, soon: !!b.soon, lower,
      x: toX(b.door.x),
      // upper street: inside the facade block, a little behind the door; lower street: just above the door
      z: lower ? toZ(b.door.y) - 1.3 : Math.min(toZ(b.door.y) - 1.4, -1.1),
      door: { x: b.door.x, y: b.door.y },
    };
  });
  const areas: MapFeatures['areas'] = [];
  const cx = (toX(A.x0) + toX(A.x1)) / 2;
  if (low) {
    areas.push({ name: L.id === 'fair' ? 'Ярмарочная улица' : 'Главная улица', x: cx, z: toZ((A.y0 + edgeY0) / 2) + 0.4 });
    areas.push({ name: 'Нижняя улица', x: cx, z: (toZ(edgeY1) + toZ(low.canal[0])) / 2 + 1.2 });
    areas.push({ name: 'Канал', x: cx * 0.62, z: (toZ(low.canal[0]) + toZ(low.canal[1])) / 2 });
    areas.push({ name: 'Набережная', x: cx, z: (toZ(low.canal[1]) + toZ(A.y1)) / 2 + 1 });
  } else areas.push({ name: 'Главная улица', x: cx, z: toZ((A.y0 + A.y1) / 2) });
  return { bounds, blocks, water, ponds, ledge, stairs, bridges, props, pins, areas };
}

/* ------------------------------------------------------------------ view */

/** screen = metres × k + t (CSS px inside the map viewport). */
export interface View { k: number; tx: number; ty: number }

export function fitView(b: Rect, w: number, h: number, pad = 16): View {
  const k = Math.max(0.01, Math.min((w - pad * 2) / (b.x1 - b.x0), (h - pad * 2) / (b.z1 - b.z0)));
  return { k, tx: (w - (b.x1 - b.x0) * k) / 2 - b.x0 * k, ty: (h - (b.z1 - b.z0) * k) / 2 - b.z0 * k };
}
/** Zoom by `f` around the screen point (sx, sy), keeping k within [kMin, kMax]. Mutates and returns v. */
export function zoomAt(v: View, f: number, sx: number, sy: number, kMin: number, kMax: number): View {
  const k = Math.max(kMin, Math.min(kMax, v.k * f));
  const mx = (sx - v.tx) / v.k, mz = (sy - v.ty) / v.k;
  v.k = k; v.tx = sx - mx * k; v.ty = sy - mz * k;
  return v;
}
/** Keep at least `keep` px of the map inside the viewport (cannot lose the city off-screen). Mutates v. */
export function clampView(v: View, b: Rect, w: number, h: number, keep = 120): View {
  const L = b.x0 * v.k + v.tx, R = b.x1 * v.k + v.tx, T = b.z0 * v.k + v.ty, B = b.z1 * v.k + v.ty;
  const kx = Math.min(keep, (R - L) / 2), ky = Math.min(keep, (B - T) / 2);
  if (R < kx) v.tx += kx - R; if (L > w - kx) v.tx -= L - (w - kx);
  if (B < ky) v.ty += ky - B; if (T > h - ky) v.ty -= T - (h - ky);
  return v;
}

/* ------------------------------------------------------------------ labels */

export interface LabelIn { sx: number; sy: number; w: number; h: number; prio: number; /** Preferred side order (default b, t, r, l). */ pref?: readonly LabelSide[] }
/** Candidate placements around a pin of radius r: below, above, right, left. */
export type LabelSide = 'b' | 't' | 'r' | 'l';
export const LABEL_SIDES: readonly LabelSide[] = ['b', 't', 'r', 'l'];
export interface LabelOut { side: LabelSide | null; x: number; y: number }

function boxAt(l: LabelIn, side: LabelSide, r: number, gap: number): [number, number, number, number] {
  switch (side) {
    case 'b': return [l.sx - l.w / 2, l.sy + r + gap, l.sx + l.w / 2, l.sy + r + gap + l.h];
    case 't': return [l.sx - l.w / 2, l.sy - r - gap - l.h, l.sx + l.w / 2, l.sy - r - gap];
    case 'r': return [l.sx + r + gap, l.sy - l.h / 2, l.sx + r + gap + l.w, l.sy + l.h / 2];
    case 'l': return [l.sx - r - gap - l.w, l.sy - l.h / 2, l.sx - r - gap, l.sy + l.h / 2];
  }
}
const hit = (a: number[], b: number[]) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/**
 * Greedy label placement: higher prio first; each label takes the first side that overlaps neither an already placed
 * label nor any pin (pins are r-radius squares) and stays inside [0,w]×[0,h]. Labels with no free side get side=null
 * (the view shows them on hover). Allocation-light, O(n²) — n is a few dozen.
 */
export function placeLabels(items: LabelIn[], r: number, w: number, h: number, gap = 3): LabelOut[] {
  const out: LabelOut[] = items.map(() => ({ side: null, x: 0, y: 0 }));
  const pins = items.map((l) => [l.sx - r, l.sy - r, l.sx + r, l.sy + r]);
  const placed: number[][] = [];
  const order = items.map((_, i) => i).sort((a, b) => items[b].prio - items[a].prio || items[a].sx - items[b].sx);
  for (const i of order) {
    const l = items[i];
    if (l.sx < -r || l.sy < -r || l.sx > w + r || l.sy > h + r) continue;   // off-screen pin
    for (const s of l.pref || LABEL_SIDES) {
      const bx = boxAt(l, s, r, gap);
      // near the viewport edge, slide the label along its side (it still touches the pin)
      if (s === 'b' || s === 't') { const d = bx[0] < 2 ? 2 - bx[0] : bx[2] > w - 2 ? w - 2 - bx[2] : 0; if (Math.abs(d) < l.w / 2) { bx[0] += d; bx[2] += d; } }
      else { const d = bx[1] < 2 ? 2 - bx[1] : bx[3] > h - 2 ? h - 2 - bx[3] : 0; if (Math.abs(d) < l.h) { bx[1] += d; bx[3] += d; } }
      if (bx[0] < 2 || bx[1] < 2 || bx[2] > w - 2 || bx[3] > h - 2) continue;
      let ok = true;
      for (const p of placed) if (hit(bx, p)) { ok = false; break; }
      if (ok) for (let j = 0; j < pins.length; j++) if (j !== i && hit(bx, pins[j])) { ok = false; break; }
      if (!ok) continue;
      placed.push(bx); out[i] = { side: s, x: bx[0], y: bx[1] };
      break;
    }
  }
  return out;
}

/** Facing arrow on a north-up map: Walker.face (0 = towards −Z = up) → CSS rotation in degrees (clockwise). */
export const faceToDeg = (face: number) => -face * 180 / Math.PI;
