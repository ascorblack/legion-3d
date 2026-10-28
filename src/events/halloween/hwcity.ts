/**
 * «Ночь Тыквенной Луны» (site 28.10, city.js hwNow / cityhw.js): the channel's Halloween night in the City.
 * The site sends `hero.hwc = { look, portal, at }` in /api/me and the SSE `me` event:
 *  - `look`   — the City is in its Halloween dress: decorated by the buildings and painted «dead» (desaturated, cold,
 *               lights off except pumpkins and candy) — city.js `S.gl.setDead(!!c.look)`;
 *  - `portal` — the portal at the gate is open (from the transformation to the end of the night) and every walker
 *               of the City is drawn as a ghost (walker gh = 1, «понарошку» — only the look);
 *  - `at`     — ms timestamp of the transformation (the site plays its transformation scene within 20 s of it).
 * Only the Fair city («Ярмарка») transforms: the camp «Перепутье» and district towns stay as they are (streamer, 28.10).
 *
 * Pure functions here (no three.js): parsing, the mode, where the portal stands (cityhw.js at(sc): bottom at the
 * gate's ground, centred in the passage) and where the extra decorations go (cauldron, candles, the witch's path).
 */
import type { CityLayout } from '../../contracts';
import { toX, toZ, fromX, fromZ } from '../../world/coords';
import { Grid, clearOfDoors, mulberry32, type PlaceCity, type Plan } from './placement';

export interface HwCity { look: boolean; portal: boolean; at: number }

/** hero.hwc → flags, or null when the night is off / the payload is not what we expect. */
export function parseHwc(raw: unknown): HwCity | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const look = !!o.look, portal = !!o.portal;
  if (!look && !portal) return null;
  const at = typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : 0;
  return { look, portal, at };
}

/** What the 3D city shows. */
export interface HwMode {
  /** Halloween decoration forced on (+ cauldron, candles, witch, more bats and cobwebs). */
  look: boolean;
  /** «Dead» grading: desaturated, cold tint, lamps / windows / garland bulbs off (the pumpkins keep their light). */
  dead: boolean;
  /** The portal at the gate. */
  portal: boolean;
  /** Every cat (and the own hero) drawn as a ghost. */
  ghosts: boolean;
}
export const HW_OFF: HwMode = Object.freeze({ look: false, dead: false, portal: false, ghosts: false });

/**
 * The mode for a town. `enabled` = our «Ночь Тыквенной Луны» setting. Mirrors city.js hwApply(): the camp and the
 * district towns never transform (only the Fair, layout id 'fair'); look → decoration + dead city, portal → portal +
 * ghosts (site: `hwGhSet(!!c.portal)`).
 */
export function hwcMode(hwc: HwCity | null, layoutId: string | undefined, enabled = true): HwMode {
  if (!enabled || !hwc || layoutId !== 'fair') return HW_OFF;
  return { look: hwc.look, dead: hwc.look, portal: hwc.portal, ghosts: hwc.portal };
}
export const sameMode = (a: HwMode, b: HwMode) => a.look === b.look && a.dead === b.dead && a.portal === b.portal && a.ghosts === b.ghosts;
export const modeKey = (m: HwMode) => (m.look ? 'l' : '') + (m.dead ? 'd' : '') + (m.portal ? 'p' : '') + (m.ghosts ? 'g' : '');

/* ------------------------------------------------------------------ the portal */

/** Where the portal stands, metres: the opening (w × h, round top), centred at x, bottom at y, in the plane z. */
export interface PortalSpot {
  x: number; y: number; z: number;
  /** opening width and height (the arch: a w/2 half-circle on top of a rectangle) */
  w: number; h: number;
  /** frame depth (m) and the frame's outer half-width / height */
  depth: number; outerW: number; outerH: number;
  /** 2D city point of the gate's door (px) — for tests / debug */
  door: [number, number];
}

/** The gate's arch opening (src/world/buildings.ts gate(): ow = min(1.8, bw·0.48), oh = 2.7). */
export function gateOpening(L: CityLayout): { cx: number; ow: number; oh: number } | null {
  const g = L.buildings.find((b) => b.id === 'gate');
  if (!g) return null;
  const x0 = toX(g.hit[0]), x1 = toX(g.hit[1]), bw = (x1 - 0.35) - (x0 + 0.35);
  return { cx: toX(g.door.x), ow: Math.min(1.8, bw * 0.48), oh: 2.7 };
}

/**
 * The portal at the gate (cityhw.js at(sc): bottom at the gate's ground, centred in the passage). `facadeZ` = the
 * gate's front face (m) found by the caller (a ray at the wall above the arch); the frame stands flush against it.
 * The frame is pushed back until none of its footprint is walkable — a cell where a cat can stand: layout.free and
 * not inside a building's solid (`solidTop` = Infinity, src/world solidTop) — so the portal never blocks the street.
 */
export function portalSpot(L: CityLayout, groundAt: (X: number, Z: number) => number, facadeZ = -0.15, solidTop?: (x: number, y: number) => number): PortalSpot | null {
  const g = L.buildings.find((b) => b.id === 'gate'), op = gateOpening(L);
  if (!g || !op) return null;
  const w = op.ow + 0.12, h = op.oh + 0.1, depth = 0.14;
  const outerW = w / 2 + 0.26, outerH = h + 0.3;
  let zFront = facadeZ + depth;
  for (let k = 0; k < 40 && portalBlocks(L, op.cx, zFront, outerW, depth, solidTop); k++) zFront -= 0.02;
  const z = zFront - depth / 2;
  return { x: op.cx, y: groundAt(op.cx, Math.max(z, 0)), z, w, h, depth, outerW, outerH, door: [g.door.x, g.door.y] };
}

/** Walkable samples (every 2 cm) under a frame of half-width hw and the given depth whose front face is at zFront. */
export function portalBlocks(L: CityLayout, x: number, zFront: number, hw: number, depth = 0.14, solidTop?: (x: number, y: number) => number): number {
  let n = 0;
  for (let X = x - hw; X <= x + hw + 1e-6; X += 0.02) for (let Z = zFront - depth; Z <= zFront + 1e-6; Z += 0.02) {
    const px = fromX(X), py = fromZ(Z);
    if (L.free(px, py) && !(solidTop && solidTop(px, py) === Infinity)) n++;
  }
  return n;
}

/* ------------------------------------------------------------------ extra decorations (cityhw.js items) */

export interface HwExtras {
  cauldron: { x: number; y: number; z: number; r: number } | null;
  /** candle trios: base point and three heights */
  candles: { x: number; y: number; z: number; h: number }[];
  /** the witch flies a circle over the gate */
  witch: { cx: number; cy: number; cz: number; r: number };
  /** facade corners for extra cobwebs (x, z of the wall line) */
  webs: { x: number; z: number; side: 1 | -1 }[];
}

/**
 * Cauldron by the gate (on flat open ground hugging a wall, off the walk lanes when possible, ≥ 0.6 m from doors),
 * candle trios beside the door / stair pumpkin clusters (never on a pumpkin), the witch's circle in the sky over the
 * gate, and facade corners for cobwebs. Deterministic.
 */
export function planHwExtras(c: PlaceCity, plan: Plan, gate: { x: number; z: number } | null, facades: [number, number][], seed = 2026): HwExtras {
  const rnd = mulberry32(seed), g = new Grid(c);
  const gx = gate ? gate.x : (c.area.x0 + c.area.x1) / 2;
  const items = plan.clusters.flatMap((cl) => cl.items);
  const freeOfPumpkins = (x: number, z: number, r: number) => items.every((it) => Math.hypot(it.x - x, it.z - z) > it.r + r + 0.06);

  /* cauldron: radius 0.42 */
  let cauldron: HwExtras['cauldron'] = null, best = -1e9;
  const R = 0.42;
  for (let dx = -7; dx <= 7; dx += 0.125) {
    if (Math.abs(dx) < 1.9) continue;
    for (let Z = 0.3; Z <= 3.2; Z += 0.125) {
      const X = gx + dx;
      if (!g.flat(X, Z, R + 0.04) || g.distAt(X, Z) < R + 0.03 || !clearOfDoors(c, X, Z, R) || !freeOfPumpkins(X, Z, R)) continue;
      const k = g.at(X, Z);
      const s = -Math.abs(dx) * 0.35 - g.distAt(X, Z) * 1.5 + (k >= 0 && !g.walk[k] ? 2 : 0) + rnd() * 0.05;
      if (s > best) { best = s; cauldron = { x: X, y: c.groundAt(X, Z), z: Z, r: R }; }
    }
  }

  /* candles beside the door / stair clusters */
  const candles: HwExtras['candles'] = [];
  const taken: [number, number][] = cauldron ? [[cauldron.x, cauldron.z]] : [];
  for (const cl of plan.clusters) {
    if (candles.length >= 36) break;
    if (cl.tag !== 'door' && cl.tag !== 'stair') continue;
    const a0 = rnd() * Math.PI * 2;
    for (let k = 0; k < 8; k++) {
      const a = a0 + k * Math.PI / 4, d = 0.62 + rnd() * 0.12, X = cl.x + Math.cos(a) * d, Z = cl.z + Math.sin(a) * d;
      if (!g.flat(X, Z, 0.14) || g.distAt(X, Z) < 0.1 || !clearOfDoors(c, X, Z, 0.12) || !freeOfPumpkins(X, Z, 0.14)) continue;
      if (taken.some(([tx, tz]) => Math.hypot(tx - X, tz - Z) < 0.9)) continue;
      taken.push([X, Z]);
      const y = c.groundAt(X, Z);
      for (let n = 0; n < 3; n++) {
        const b = a + n * 2.1;
        candles.push({ x: X + Math.cos(b) * 0.07, y, z: Z + Math.sin(b) * 0.07, h: [0.2, 0.28, 0.14][n] + rnd() * 0.04 });
      }
      break;
    }
  }

  const webs: HwExtras['webs'] = [];
  for (const [x0, x1] of facades) { webs.push({ x: x0 + 0.35, z: 0, side: 1 }, { x: x1 - 0.35, z: 0, side: -1 }); }

  return { cauldron, candles, witch: { cx: gx + 2, cy: 6.2, cz: 3.6, r: 6 }, webs };
}
