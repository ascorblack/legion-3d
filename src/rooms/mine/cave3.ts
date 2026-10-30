/**
 * «Шахта 3.0» (site 29.10, flag mine3): the big non-linear floor in 3D — the static parts the scene (scene.ts) bakes into
 * RoomKit batches, and the pure rule of which cell gets which rock.
 *
 * What the player sees mirrors the site's mine3.js: rock is one solid mass, the passages are the open cells (dug, or open
 * by type: lift / void / shaft); diggable stones of the front are boulders at the edge of a passage, deeper rock shows only
 * ore streaks; cells the site does not list (fog: t 'fog') are pitch-dark rock with nothing known about them — the 3D view
 * never reveals what the site hides. Vein sparks glow on the fog edge where the server says a vein continues (veins[k][3]).
 * The lift hall (hallBox) carries the lift cage, the supplier, the buyer and the board (scene.buildEntrance with the big
 * floor's FOOT); special halls (lake / grotto / adit), drill rigs and the lift shaft are drawn on their cells.
 *
 * Only cells next to a passage get a rock instance (the rest is hidden behind them under the ceiling): a 32 × 18 floor
 * with a few dozen dug cells needs ~100 instances in 5 InstancedMesh calls; the static batches add ~15 calls.
 */
import * as THREE from 'three';
import type { RoomKit } from '../common/kit';
import { OPEN3, type MineGeom } from './geo3';
import type { Floor } from './state';
import { rockGeo, crystalGeo, oreCol, type MinePal } from './art';
import { rockCeiling, rockFloor, strataOf, RELIEF, type FloorOpts } from './rockface';
import { timberPost, dressCave } from './props3';
import { layerPiece, lantern3d, stalactiteCluster, remains, slab, shelf, crack, railTrack, rubble, outcrop, chip, crateOrBarrel, toolPile, oreCrumbs, bar, mixc, type DressCol } from './dress3';

export type Slot3 = 'stone' | 'mass' | 'wall' | 'fog';
export const CEIL3 = 5.4;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
/** Lantern glow sprite colour: a saturated warm core (a whitish halo read as a puff of smoke at a distance). */
const GLOW = '#ff9a40';
const rnd = (i: number, k: number) => { const h = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return h - Math.floor(h); };
function mix(a: string, b: string, k: number): string { return '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString(); }

/** Cell i is a passage: dug, or open by its (visible) type. */
export function open3(F: Floor, dug: ArrayLike<number>, i: number): boolean {
  return !!dug[i] || (!!F.vis && !!F.vis[i] && OPEN3.has(F.cells[i].t));
}

/**
 * Rock of every cell of a big floor (null = passage or hidden deep inside the mass): 'fog' — not shown by the site (dark,
 * nothing known), 'wall' — a rock face that cannot be dug, 'stone' — a front stone (a boulder that can be dug now), 'mass' —
 * visible rock deeper in (solid, with ore streaks). Only cells touching a passage (8 neighbours) are listed.
 */
export function slots3(G: MineGeom, F: Floor, dug: ArrayLike<number>, front: ReadonlySet<number>): (Slot3 | null)[] {
  const w = G.w, h = G.h, out: (Slot3 | null)[] = new Array(G.N).fill(null);
  const op = new Uint8Array(G.N); for (let i = 0; i < G.N; i++) op[i] = open3(F, dug, i) ? 1 : 0;
  for (let i = 0; i < G.N; i++) {
    if (op[i]) continue;
    const gx = i % w, gy = Math.floor(i / w); let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) { const X = gx + dx, Y = gy + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && op[Y * w + X]) { near = true; break; } }
    if (!near) continue;
    const vis = !!F.vis && !!F.vis[i], t = F.cells[i] ? F.cells[i].t : 'fog';
    out[i] = !vis || t === 'fog' ? 'fog' : t === 'wall' ? 'wall' : front.has(i) ? 'stone' : 'mass';
  }
  return out;
}

/** Room-space centre of cell i (metres). */
const cm = (G: MineGeom, i: number) => { const p = G.cellXY(i); return { x: G.mx(p.cx), z: G.mz(p.cy) }; };

export interface Cave3Out {
  /** Lantern points (x, y, z …) for the real hall lights that follow the player. */
  lanterns: number[];
  /** The procedural floor (walking height = groundHeight(floor, x, z)). */
  floor: FloorOpts;
}

/**
 * The floor-wide static batch: ground, ceiling, the rock ring around the floor (PAD), stalactites, the lift hall's planks,
 * frame and lanterns. Rebuilt only for a new floor.
 */
export function buildCave3(kit: RoomKit, G: MineGeom, F: Floor, P: MinePal, addPool: (x: number, y: number, z: number, r: number, c: string, g: number) => number, cs = 0, reliefK?: (x: number, z: number) => number, clear?: (x: number, z: number) => boolean): Cave3Out {
  const lanterns: number[] = [];
  const x0 = G.mx(0), x1 = G.mx(G.W), z0 = G.mz(0), z1 = G.mz(G.H);
  const q1 = kit.quality >= 1;
  kit.box('lowPaving', P.floor, x0 - 2, x1 + 2, q1 ? -0.5 : -0.2, q1 ? -0.27 : 0, z0 - 2, z1 + 2);
  // q1+: seeded walkable ground relief (±17 cm swells and hollows inside the grid, flat in the lift hall; scree outside
  // the grid), wear towards the lift hall, grime at the rock
  const [hx0, hy0, hw0, hh0] = G.hall, hcx = G.mx(hx0 + hw0 / 2), hcz = G.mz(hy0 + hh0 / 2);
  const FO: FloorOpts = {
    x0: x0 - 2, x1: x1 + 2, z0: z0 - 2, z1: z1 + 2, cell: kit.quality >= 2 ? 0.7 : 1.0, seed: cs,
    floor: mix(P.floor, P.rock[1], 0.35), floorL: mix(P.floorL, P.rock[1], 0.35), dark: mix(P.floor, P.wall, 0.6),
    walk: (x, z) => x > x0 + 0.05 && x < x1 - 0.05 && z > z0 + 0.05 && z < z1 - 0.05,
    worn: (x, z) => Math.max(0, 1 - Math.hypot(x - hcx, z - hcz) / 9),
    wallDist: (x, z) => Math.max(0, Math.min(x - x0, x1 - x, z - z0, z1 - z)) + (x < x0 || x > x1 || z < z0 || z > z1 ? 0 : 3),
    relief: RELIEF, reliefK, clear,
  };
  if (q1) { const g = rockFloor(FO); kit.geo('lowPaving', g, _m.identity(), null, 1.0); g.dispose(); }
  kit.box('stone', P.wall, x0 - 3, x1 + 3, CEIL3, CEIL3 + 0.6, z0 - 3, z1 + 3);
  // a lumpy rock ceiling under the flat one (q1+): the cave reads as a cave from below, not as a lid
  if (kit.quality >= 1) { const g = rockCeiling({ x0: x0 - 1, x1: x1 + 1, z0: z0 - 1, z1: z1 + 1, y: CEIL3, amp: 0.7, cell: kit.quality >= 2 ? 1.1 : 1.6, seed: 5 + cs, strata: strataOf(P) }); kit.geo('stone', g, _m.identity(), null, 1.6); g.dispose(); }
  // rock ring around the floor (the site's PAD of solid rock): pillars on the outside cells next to the grid
  // (the ring is mostly seen from afar, through the fog: the 80-facet angular lump, not the 180-facet pillar)
  const lump = rockGeo('hard', 2), w = G.w, h = G.h, cw = G.CW * G.K;
  const gx0 = G.mx(G.cellXY(0).cx), gz0 = G.mz(G.cellXY(0).cy);
  for (let gy = -1; gy <= h; gy++) for (let gx = -1; gx <= w; gx++) {
    if (gx >= 0 && gy >= 0 && gx < w && gy < h) continue;
    const k = (gy + 2) * (w + 4) + gx + 2, x = gx0 + gx * cw, z = gz0 + gy * cw;
    _q.setFromAxisAngle(_up, rnd(k, 4) * 6.28);
    kit.geo('stone', lump.geo, _m.compose(_p.set(x, -0.05, z), _q, _s.set(1.5, CEIL3 + 0.5, 1.5)), mix(P.wall, P.wallL, rnd(k, 5) * 0.5), 1);
  }
  // stalactites over the whole floor (under the ceiling, never in a stone's way): clusters round rock bosses (q1+)
  if (kit.quality >= 1) {
    const nC = Math.min(kit.quality >= 2 ? 90 : 45, Math.round(w * h * (kit.quality >= 2 ? 0.12 : 0.06)));
    for (let k = 0; k < nC; k++) {
      const x = x0 + rnd(k + cs, 11) * (x1 - x0), z = z0 + rnd(k + cs, 12) * (z1 - z0);
      stalactiteCluster(kit, x, z, CEIL3 - 0.3, 0.4 + rnd(k + cs, 13) * 0.6, k + cs, mix(P.wall, P.wallL, 0.65), mix(P.wall, P.wallL, 0.2), kit.quality >= 2 ? 5 : 3);
    }
  } else {
    const cone = new THREE.ConeGeometry(1, 1, 5).rotateX(Math.PI);
    const nSt = Math.min(160, Math.round(w * h * 0.2));
    for (let k = 0; k < nSt; k++) {
      const x = x0 + rnd(k + cs, 11) * (x1 - x0), z = z0 + rnd(k + cs, 12) * (z1 - z0), hh = 0.35 + rnd(k + cs, 13) * 0.8, r = 0.1 + rnd(k + cs, 14) * 0.14;
      kit.geo('stone', cone, _m.compose(_p.set(x, CEIL3 - hh / 2, z), _q.identity(), _s.set(r, hh, r)), mix(P.wall, P.wallL, 0.5), 1);
    }
    cone.dispose();
  }
  // the lift hall: plank floor, a timber frame round it, four corner lanterns and a light
  const [hx, hy, hw, hh2] = G.hall, ax = G.mx(hx), bx = G.mx(hx + hw), az = G.mz(hy), bz = G.mz(hy + hh2);
  // plank deck: chamfered boards (q1+) with a shade of their own and dark gaps, two sleepers showing at the ends
  for (let z = az + 0.3, k = 0; z < bz - 0.2; z += 0.62, k++) {
    const c = ['#8a5a32', '#7a4e2a', '#946238', '#6e4626'][(k * 7 + cs) % 4];
    if (kit.quality >= 1) kit.bevel('wood', c, ax + 0.25, bx - 0.25, -0.02, 0.04 + ((k * 13 + cs) % 3) * 0.004, z, z + 0.56, 0.018);
    else kit.box('wood', c, ax + 0.25, bx - 0.25, 0, 0.04, z, z + 0.56);
  }
  if (kit.quality >= 1) for (const x of [ax + 0.35, bx - 0.35]) kit.box('wood', '#4a2e18', x - 0.09, x + 0.09, -0.06, 0.012, az + 0.25, bz - 0.25);
  for (const [px0, pz0] of [[ax + 0.2, az + 0.2], [bx - 0.2, az + 0.2], [ax + 0.2, bz - 0.2], [bx - 0.2, bz - 0.2]]) {
    timberPost(kit, px0, pz0, 4.3, kit.quality);
    const sx = px0 < (ax + bx) / 2 ? 1 : -1, sz = pz0 < (az + bz) / 2 ? 1 : -1, lx = px0 + sx * 0.42, lz = pz0 + sz * 0.42, ly = 2.6;
    // a lantern on a diagonal iron bracket off the corner post
    lantern3d(kit, lx, ly, lz, { q: kit.quality, glass: P.lamp, mount: 'bracket', wx: sx * 0.7071, wz: sz * 0.7071, arm: 0.42 });
    kit.glow(lx, ly, lz, 0.55, GLOW, 0.85);
    addPool(lx, ly - 1.45, lz, 3.6, P.lamp, 2.1);
    if (kit.quality >= 1) kit.splash(lx, 0.06, lz, 3.4, 3.4, P.lamp, 0.18, 0, -Math.PI / 2);
    lanterns.push(lx, ly + 0.2, lz);
  }
  kit.box('wood', '#7a4e2a', ax, bx, 4.3, 4.6, az + 0.06, az + 0.34);
  kit.box('wood', '#7a4e2a', ax, bx, 4.3, 4.6, bz - 0.34, bz - 0.06);
  for (const x of [ax + 0.06, bx - 0.34]) kit.box('wood', '#7a4e2a', x, x + 0.28, 4.3, 4.6, az, bz);
  kit.light((ax + bx) / 2, 3.4, (az + bz) / 2 + 0.6, P.lamp, 6, 11, 0);
  // seeded dressing: hanging rocks, roots, puddles; cobwebs in the hall frame's corners
  const webs: [number, number, number, number, number, number, number][] = [];
  for (const [wx, wz, dx] of [[ax + 0.35, az + 0.2, 1], [bx - 0.35, az + 0.2, -1], [ax + 0.35, bz - 0.2, 1], [bx - 0.35, bz - 0.2, -1]] as const) if (rnd(Math.round(wx * 10) + cs, 51) < 0.6) webs.push([wx, 4.28, wz, dx, 0, -1, 0.5]);
  dressCave(kit, { F: FO, seed: cs, ceil: CEIL3 - 0.1, q: kit.quality, rock: P.rock[0], rockD: P.rock[2], pud: P.pud, roots: !!P.moss || P.deco === 'moss', gravel: 0.4, webs });   // most of the grid is still rock: the dug cells get their own
  addPool((ax + bx) / 2, 3.4, (az + bz) / 2, 7, P.lamp, 0.9);
  return { lanterns, floor: FO };
}

/**
 * The part that changes while the floor is dug (rebuilt with the rock layout): lanterns on the tunnel walls, special halls
 * (lake water, grotto crystals, adit timber), drill rigs, the lift shaft, vein sparks on the fog edge.
 */
export function buildDig3(kit: RoomKit, G: MineGeom, F: Floor, dug: ArrayLike<number>, slot: readonly (Slot3 | null)[], P: MinePal,
  addPool: (x: number, y: number, z: number, r: number, c: string, g: number) => number, lanterns: number[], cs = 0, FO: FloorOpts | null = null): { sparks: number[] } {
  const w = G.w, half = G.CW * G.K / 2, q = kit.quality;
  const isRock = (j: number) => slot[j] != null;
  const isOpen = (j: number) => j >= 0 && j < G.N && open3(F, dug, j);
  const nb = (i: number): [number, number, number][] => { const gx = i % w; return [[0, -1, i - w], [1, 0, gx < w - 1 ? i + 1 : -1], [-1, 0, gx > 0 ? i - 1 : -1], [0, 1, i + w]]; };
  // tunnel lanterns: on every few dug cells, on the wall side (never in the lift hall: it has its own) — a timber post
  // against the rock with a real lantern on an iron bracket
  for (let i = 0; i < G.N; i++) {
    if (!dug[i] || G.inZone(i)) continue;
    const gx = i % w, gy = Math.floor(i / w); if ((gx * 7 + gy * 13) % 5 !== 0) continue;
    const d = nb(i).find(([, , j]) => j >= 0 && j < G.N && isRock(j)); if (!d) continue;
    const c = cm(G, i), px = c.x + d[0] * (half - 0.32), pz = c.z + d[1] * (half - 0.32), ly = 2.5;
    const g0 = FO ? FO.meshY ? FO.meshY(px, pz) : 0 : 0;
    if (q >= 1) kit.bevel('wood', '#6e4626', px - 0.08, px + 0.08, g0 - 0.15, 3.1, pz - 0.08, pz + 0.08, 0.025);
    else kit.box('wood', '#6e4626', px - 0.06, px + 0.06, -0.12, 3.0, pz - 0.06, pz + 0.06);
    const lx = px - d[0] * 0.5, lz = pz - d[1] * 0.5;
    lantern3d(kit, lx, ly, lz, { q, glass: P.lamp, mount: 'bracket', wx: -d[0], wz: -d[1], arm: 0.42 });
    kit.glow(lx, ly, lz, 0.55, GLOW, 0.85);
    addPool(lx, ly - 1.45, lz, 3.5, P.lamp, 2.1);
    lanterns.push(lx - d[0] * 0.3, ly + 0.2, lz - d[1] * 0.3);
  }
  // the dug tunnels' own ground and timber (q1+, on the procedural floor)
  if (q >= 1 && FO) {
    const C: DressCol = { rock: P.rock[0], rockD: P.rock[2], floorL: P.floorL, dark: FO.dark };
    // density: a big dug-out floor thins its dressing out so the batch stays within the scene's triangle budget
    // (≈ 1k triangles a cell at full density; full up to 36 dug cells, then ∝ 1/n)
    let nDug = 0; for (let i = 0; i < G.N; i++) if (dug[i] && !G.inZone(i)) nDug++;
    const dens = Math.min(1, 36 / Math.max(1, nDug)), keep = (sd: number, k: number) => rnd(sd, k) < dens;
    // cart track: a tree from the lift hall out along the dug cells (BFS), rails from cell centre to cell centre
    // (out to 12 cells from the hall: the far workings make do without)
    const prev = new Int32Array(G.N).fill(-2), depth = new Int32Array(G.N), Q: number[] = [];
    for (let i = 0; i < G.N; i++) if (dug[i] && G.inZone(i)) { prev[i] = -1; Q.push(i); }
    for (let k = 0; k < Q.length; k++) for (const [, , j] of nb(Q[k])) if (j >= 0 && j < G.N && dug[j] && prev[j] === -2) { prev[j] = Q[k]; depth[j] = depth[Q[k]] + 1; Q.push(j); }
    for (let i = 0; i < G.N; i++) {
      const p0 = prev[i]; if (p0 < 0 || G.inZone(i) || depth[i] > 12) continue;
      const a = cm(G, i), b = cm(G, p0), into = G.inZone(p0);
      railTrack(kit, FO, [into ? (a.x + b.x) / 2 : b.x, into ? (a.z + b.z) / 2 : b.z, a.x, a.z], { seed: cs + i, stop: !Q.some((j) => prev[j] === i) && (i * 7 + cs) % 3 === 0 });
    }
    for (let i = 0; i < G.N; i++) {
      if (!dug[i] || G.inZone(i)) continue;
      const c = cm(G, i), gx = i % w, gy = Math.floor(i / w), N4 = nb(i), op = N4.map(([, , j]) => isOpen(j)), nOpen = op.filter(Boolean).length;
      const cell = F.cells[i], ore = cell && (cell.t === 'ore' || cell.t === 'rare') && cell.r ? oreCol(cell.r)[0] : null;
      const sd = i * 13 + cs;
      if (rnd(sd, 5) < dens * dens) remains(kit, FO, c.x + (rnd(i, 6) - 0.5) * 0.12, c.z + (rnd(i, 7) - 0.5) * 0.12, sd, C, ore, q);
      // the rock's foot: scree chips along every side that is rock, now and then a fallen block in the corner
      N4.forEach(([dx, dz, j], k) => {
        if (op[k] || j < 0 || j >= G.N) return;
        const tx = -dz, tz = dx;
        for (let t = 0, nt = dens < 0.5 ? 1 : Math.round((q >= 2 ? 6 : 3) * dens); t < nt; t++) {
          const u = (rnd(sd + k, 30 + t) - 0.5) * 2.1, o = half - 0.18 - rnd(sd + k, 40 + t) * 0.3;
          chip(kit, FO, c.x + dx * o + tx * u, c.z + dz * o + tz * u, 0.07 + rnd(sd + k, 50 + t) * 0.15, mixc(C.rock, C.rockD, rnd(sd + k, 60 + t)), sd + k * 9 + t, 0.2);
        }
        if (!keep(sd + k, 69)) return;
        if (P.layer && rnd(sd + k, 68) < 0.12) {   // now and then the depth layer's own piece at the rock's foot
          const L = layerPiece(kit, FO, P.layer, c.x + dx * (half - 0.1), c.z + dz * (half - 0.1), -dx, -dz, sd + k, { ...C, glow: P.glow || P.mush, lamp: P.lamp });
          if (L) addPool(L[0], L[1], L[2], L[3], L[4], 1.2);
          return;
        }
        if (rnd(sd + k, 70) < 0.35) rubble(kit, FO, c.x + dx * (half - 0.15) + tx * (rnd(sd + k, 71) - 0.5) * 1.4, c.z + dz * (half - 0.15) + tz * (rnd(sd + k, 71) - 0.5) * 1.4, 0.4, q >= 2 ? 8 : 4, sd + k, C);
        else if (rnd(sd + k, 70) > 0.85) outcrop(kit, FO, c.x + dx * (half - 0.05) + tx * (rnd(sd + k, 72) - 0.5) * 1.2, c.z + dz * (half - 0.05) + tz * (rnd(sd + k, 72) - 0.5) * 1.2, 0.35 + rnd(sd + k, 73) * 0.2, 0.35 + rnd(sd + k, 74) * 0.25, sd + k, mix(P.wall, P.wallL, 0.5));
      });
      // flagstones and a crack on some cells (flat: walkable)
      if (rnd(sd, 80) < 0.45 * dens) for (let t = 0; t < 1 + Math.floor(rnd(sd, 81) * 3); t++) slab(kit, FO, c.x + (rnd(sd, 82 + t) - 0.5) * 1.5, c.z + (rnd(sd, 85 + t) - 0.5) * 1.5, 0.2 + rnd(sd, 88 + t) * 0.25, rnd(sd, 91 + t) * 6, mixc(P.floorL, P.rock[0], 0.25 + rnd(sd, 94 + t) * 0.35), sd + t);
      if (rnd(sd, 103) < 0.3 * dens) shelf(kit, FO, c.x + (rnd(sd, 104) - 0.5) * 1.3, c.z + (rnd(sd, 105) - 0.5) * 1.3, sd, mixc(P.rock[2], P.wall, 0.3), P.wall);
      if (rnd(sd, 97) < 0.3 * dens) crack(kit, FO, c.x + (rnd(sd, 98) - 0.5) * 1.2, c.z + (rnd(sd, 99) - 0.5) * 1.2, rnd(sd, 100) * 6.28, 0.8 + rnd(sd, 101) * 1.0, sd, C);
      // junctions: a crate / barrel tucked into a rock corner; dead ends: tools left by the face
      if (nOpen >= 3) {
        for (const [ex, ez] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const dj = (gy + ez) * w + gx + ex; if (gx + ex < 0 || gx + ex >= w || gy + ez < 0 || gy + ez >= G.h || !isRock(dj)) continue;
          crateOrBarrel(kit, FO, c.x + ex * (half - 0.45), c.z + ez * (half - 0.45), sd, 0.72); break;
        }
      } else if (nOpen === 1) {
        const k = op.findIndex(Boolean), [dx, dz] = N4[(k + 2) % 4];
        if (rnd(sd, 102) < 0.6) toolPile(kit, FO, c.x + dx * (half - 0.35), c.z + dz * (half - 0.35), -dx, -dz, sd, ore || oreCol('iron')[0]);
      }
      // timber sets across straight tunnels (every other cell): posts against the rock, a cap beam, lagging up to the roof
      const ns = op[0] && op[3] && !op[1] && !op[2], ew = op[1] && op[2] && !op[0] && !op[3];
      if ((ns || ew) && (gx + gy) % (dens < 0.5 ? 4 : 2) === 0) {
        const ax = ns ? 1 : 0, az = ns ? 0 : 1;   // across the tunnel
        const ph = 3.55;
        for (const sgn of [-1, 1]) {
          const px = c.x + ax * sgn * (half - 0.22), pz = c.z + az * sgn * (half - 0.22);
          timberPost(kit, px, pz, ph, q, '#6e4626', (FO.meshY ? FO.meshY(px, pz) : 0) - 0.08);
        }
        bar(kit, 'wood', '#7a4e2a', c.x - ax * half, ph + 0.12, c.z - az * half, c.x + ax * half, ph + 0.12, c.z + az * half, 0.26, 0.24);
        for (const t of [-0.6, 0, 0.6]) bar(kit, 'wood', '#5a3a1e', c.x + ax * t, ph + 0.24, c.z + az * t, c.x + ax * t, CEIL3 + 0.1, c.z + az * t, 0.14);
      }
    }
    // ore crumbs round the front stones that carry ore
    for (let i = 0; i < G.N; i++) {
      if (slot[i] !== 'stone') continue; const cell = F.cells[i]; if (!cell || !cell.r || (cell.t !== 'ore' && cell.t !== 'rare')) continue;
      const c = cm(G, i); oreCrumbs(kit, FO, c.x, c.z, 1.6, q >= 2 ? 9 : 4, i + cs, oreCol(cell.r)[0]);
    }
  }
  // special halls (site 29.10 рисунки): lake — water; grotto — crystal clusters; adit — old timber frames
  const hallKind = new Map<number, string>(); for (const hl of F.halls || []) hallKind.set(+hl[0], String(hl[1]));
  const cry = crystalGeo();
  for (let i = 0; i < G.N; i++) {
    const c = F.cells[i]; if (!F.vis || !F.vis[i] || c.hall == null || c.t === 'prize') continue;
    const k = hallKind.get(c.hall), p = cm(G, i);
    if (k === 'lake') { kit.box('water', '#2f6f9e', p.x - half, p.x + half, -0.12, 0.05, p.z - half, p.z + half); addPool(p.x, 0.6, p.z, 3.2, '#5fb4e8', 0.5); }
    else if (k === 'grotto') for (let q = 0; q < 3; q++) {
      const s = 0.35 + rnd(i, q + 30) * 0.4;
      _q.setFromAxisAngle(new THREE.Vector3(rnd(i, q + 31) - 0.5, 1, rnd(i, q + 32) - 0.5).normalize(), rnd(i, q + 33) * 0.5);
      kit.geo('emit', cry, _m.compose(_p.set(p.x + (rnd(i, q) - 0.5) * 1.6, -0.1, p.z + (rnd(i, q + 9) - 0.5) * 1.6), _q, _s.set(s, s * 1.8, s)), '#8fe3ff', 1);
      addPool(p.x, 1, p.z, 3.4, '#8fe3ff', 0.7);
    } else if (k === 'adit' && (i % w) % 2 === 0) {
      for (const sx of [-1, 1]) kit.box('wood', '#9a6a3a', p.x + sx * (half - 0.3) - 0.12, p.x + sx * (half - 0.3) + 0.12, -0.12, 3.4, p.z - 0.12, p.z + 0.12);
      kit.box('wood', '#9a6a3a', p.x - half + 0.15, p.x + half - 0.15, 3.3, 3.55, p.z - 0.14, p.z + 0.14);
    }
  }
  // drill rigs (site drillArt): site / build — stakes and scaffolding; lv 1 wooden derrick, 2 iron with a wheel, 3 big with a lamp; dry — grey
  for (const [i, d] of F.drills || []) {
    if (i < 0 || i >= G.N) continue;
    const p = cm(G, i), wood = d.st === 'dry' ? '#8d8a86' : d.lv <= 1 ? '#a87a4a' : '#7d8ba0';
    if (d.st === 'site' || (d.st === 'build' && !d.lv)) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.box('wood', '#c49a62', p.x + sx * 0.8 - 0.05, p.x + sx * 0.8 + 0.05, -0.12, 0.7, p.z + sz * 0.8 - 0.05, p.z + sz * 0.8 + 0.05);
      if (d.st === 'build') { for (const y of [1.2, 2.4]) kit.box('wood', '#c49a62', p.x - 0.8, p.x + 0.8, y, y + 0.08, p.z - 0.05, p.z + 0.05); }
      continue;
    }
    const lv = Math.max(1, d.lv), H = 2.4 + lv * 0.55;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.rbox('wood', wood, p.x + sx * 0.5, H / 2 - 0.06, p.z + sz * 0.5, 0.14, H + 0.12, 0.14, 0, sz * 0.12, -sx * 0.12);
    for (const y of [0.9, 1.8]) kit.box('wood', wood, p.x - 0.62, p.x + 0.62, y, y + 0.1, p.z - 0.62, p.z + 0.62);
    kit.box('metal', '#4a4a52', p.x - 0.06, p.x + 0.06, -0.12, H - 0.2, p.z - 0.06, p.z + 0.06);
    if (lv >= 2) kit.cyl('metal', '#a9b6c8', p.x + 0.75, 0.4, p.z, 0.4, 0.12, 12);
    if (lv >= 3) { kit.ball('emit', '#ffd27a', p.x, H + 0.2, p.z, 0.22); addPool(p.x, H, p.z, 4, '#ffd27a', 0.9); }
    if (d.r && d.st !== 'dry') kit.ball('flat', oreCol(d.r)[0], p.x - 0.9, 0.25, p.z + 0.6, 0.22, 0.8);
    kit.sign(d.st === 'dry' ? 'иссякла' : 'ур. ' + lv, p.x, H + 0.6, p.z + 0.1, 1.0, 0, { bg: '#3a2a5e', fg: d.st === 'dry' ? '#cfcac2' : '#ffe08a' });
  }
  // the lift shaft (site: «ШАХТА ЛИФТА» — the way to the next floor, far from the lift, under the fog)
  const sh = F.shaft ?? -1;
  if (sh >= 0 && sh < G.N && F.vis && F.vis[sh]) {
    const p = cm(G, sh);
    kit.box('dark', '#0a0810', p.x - 0.8, p.x + 0.8, -0.12, 0.012, p.z - 0.8, p.z + 0.8);   // the hole (over any hollow)
    for (const sx of [-1, 1]) kit.box('wood', '#6b4423', p.x + sx * 0.85 - 0.1, p.x + sx * 0.85 + 0.1, -0.12, 2.4, p.z - 0.1, p.z + 0.1);
    kit.box('wood', '#6b4423', p.x - 1.05, p.x + 1.05, 2.4, 2.6, p.z - 0.12, p.z + 0.12);
    kit.sign('ШАХТА ЛИФТА', p.x, 3.0, p.z + 0.14, 1.9, 0, { bg: '#3a2a5e', fg: '#ffd27a' });
    addPool(p.x, 2, p.z, 4, '#ff9a3c', 0.9);
  }
  const spark: number[] = [];
  // vein sparks: the server names the cells where a vein goes on behind the fog (veins[k][3]); those cells are always
  // behind visible rock, so the sparks sit on the rock face of the nearest passage that looks their way («копай сюда»)
  for (const v of F.veins || []) {
    const col = oreCol(String(v[1]))[0];
    for (const i of v[3] || []) {
      if (i < 0 || i >= G.N || (F.vis && F.vis[i])) continue;
      const gx = i % w, gy = Math.floor(i / w);
      let best = -1, bd = 1e9;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const X = gx + dx, Y = gy + dy; if (X < 0 || Y < 0 || X >= w || Y >= G.h) continue;
        const o = Y * w + X; if (!open3(F, dug, o)) continue;
        const d = Math.abs(dx) + Math.abs(dy); if (d < bd) { bd = d; best = o; }
      }
      if (best < 0) continue;
      const ox = best % w, oy = Math.floor(best / w), ddx = gx - ox, ddy = gy - oy;
      const sx = Math.abs(ddx) >= Math.abs(ddy) ? Math.sign(ddx) : 0, sz = sx ? 0 : Math.sign(ddy);
      const q = (oy + sz) * w + ox + sx; if (q < 0 || q >= G.N || !slot[q]) continue;
      const p = cm(G, best);
      const y = 1.2 + rnd(i, 3) * 1.1, x = p.x + sx * 0.9, z = p.z + sz * 0.9;
      kit.glow(x, y, z, 0.8, col, 2.6);
      kit.ball('emit', col, x, y, z, 0.11);
      spark.push(x, y, z);
    }
  }
  return { sparks: spark };
}
