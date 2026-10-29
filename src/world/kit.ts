/** Building kit: small helpers that put architectural pieces into the static Batch. All metres, world space. */
import * as THREE from 'three';
import { Batch, GEO, GEO2, M, type BatchKey } from './batch';
import type { Pal } from './palette';
import type { SignAtlas } from './textures';
import type { Instancer } from './instancer';

export interface Ctx {
  b: Batch;
  pal: Pal;
  signs: SignAtlas;
  inst: Instancer;
  /** Additive glow points: x, y, z, size, r, g, b. */
  glows: number[];
  /** Candidate positions for the few dynamic point lights (x, y, z). */
  lights: number[];
  /** Bulbs for garlands: x, y, z, r, g, b. */
  bulbs: number[];
  /** Garland wires (line segments: x0 y0 z0 x1 y1 z1). */
  wires: number[];
  rnd: () => number;
  quality: number;
  /** Lower street height (m) and the Z of the retaining wall face. */
  lowH: number;
  wallZ: number;
  /** Coarse camera collider boxes: x0 x1 y0 y1 z0 z1. */
  colliders: number[];
  /** Extra light-pool candidates (lightPools.ts): x, y, z, radius, r, g, b, gain. Optional (rooms reuse this Ctx). */
  pools?: number[];
  /** Solid tops for jumping (solid.ts): x0 x1 z0 z1 top (m; Infinity = wall). Props add theirs from footprints. Optional. */
  solids?: number[];
}

export const C = (c: THREE.ColorRepresentation) => new THREE.Color(c);
export function shade(c: string, k: number): string {
  const col = new THREE.Color(c);
  if (k > 0) col.lerp(new THREE.Color('#ffffff'), k); else col.multiplyScalar(1 + k);
  return '#' + col.getHexString();
}

/** Axis-aligned box from bounds. */
export function box(k: Ctx, mat: BatchKey, color: THREE.ColorRepresentation, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, uv: number | 'keep' = 1): void {
  k.b.add(mat, GEO.box, M((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)), color, uv);
}
/** Rotated box (centre, size, yaw). */
export function rbox(k: Ctx, mat: BatchKey, color: THREE.ColorRepresentation, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0, uv: number | 'keep' = 1): void {
  k.b.add(mat, GEO.box, M(cx, cy, cz, sx, sy, sz, rx, ry, rz), color, uv);
}
export function cyl(k: Ctx, mat: BatchKey, color: THREE.ColorRepresentation, x: number, y0: number, z: number, r: number, h: number, seg: 8 | 12 | 16 = 12, uv: number | 'keep' = 1): void {
  const g = seg === 8 ? GEO.cyl8 : seg === 16 ? GEO.cyl16 : GEO.cyl12;
  k.b.add(mat, g, M(x, y0 + h / 2, z, r * 2, h, r * 2), color, uv);
}
export function cone(k: Ctx, mat: BatchKey, color: THREE.ColorRepresentation, x: number, y0: number, z: number, r: number, h: number, four = false, uv: number | 'keep' = 1): void {
  k.b.add(mat, four ? GEO.cone4 : GEO.cone16, M(x, y0 + h / 2, z, r * 2, h, r * 2), color, uv);
}
export function ball(k: Ctx, mat: BatchKey, color: THREE.ColorRepresentation, x: number, y: number, z: number, r: number, sy = 1): void {
  k.b.add(mat, GEO.sphere, M(x, y, z, r * 2, r * 2 * sy, r * 2), color, 1);
}

/**
 * Gable walls of a ridge-along-X roof, local frame (centre of the wall line, base y=0): two pentagons at x = ±L/2, base
 * z ∈ [−D/2, D/2], a vertical band of `band` m then the triangle of `tri` m — their slanted edges run parallel to the
 * roof slope just under it, so no slot opens between the wall and the soffit (a plain triangle left a band ≈ h·over/(d/2)
 * open at the eaves: the roof void and the far gable's back were visible through it). `inner` = facing inward.
 */
function gableWalls(L: number, D: number, band: number, tri: number, inner: boolean): THREE.BufferGeometry {
  const p: number[] = [];
  for (const s of [-1, 1]) {
    const x = s * L / 2;
    const v = [[x, 0, -D / 2], [x, 0, D / 2], [x, band, D / 2], [x, band + tri, 0], [x, band, -D / 2]];
    const tris = band > 0.002 ? [[0, 1, 2], [0, 2, 4], [4, 2, 3]] : [[0, 1, 3]];
    for (const [a, b, c] of tris) {
      // outward (+x for s = 1): counter-clockwise seen from outside
      const o = (s > 0) !== inner ? [a, c, b] : [a, b, c];
      for (const q of o) p.push(v[q][0], q === 3 && band <= 0.002 ? tri : v[q][1], v[q][2]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

/** Gable roof with ridge along X over [x0,x1]×[z0,z1], eaves at yBase, ridge at yBase+h. Includes fascia trims and gable walls. */
export function gableRoof(k: Ctx, roofCol: string, wallMat: BatchKey, wallCol: string, x0: number, x1: number, z0: number, z1: number, yBase: number, h: number, over = 0.25, open = false): void {
  const w = x1 - x0 + over * 2, d = z1 - z0 + over * 2, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const slope = Math.hypot(d / 2, h);
  k.b.add('roof', GEO2.gable, M(cx, yBase, cz, w, h, d), roofCol, [w / 0.9, slope / 0.9]);
  // thickness: a slightly lower dark underside, facing down (visible from under the eaves; was see-through from below)
  k.b.add('wood', GEO2.gableUnder, M(cx, yBase - 0.06, cz, w, h, d), shade(k.pal.woodD, 0.1), 0.5);
  // gable walls (inside the roof outline, at the wall line)
  const band = Math.max(0, h * over / (d / 2) - 0.045), tri = h * (1 - over / (d / 2));
  let gw = gableWalls(x1 - x0, z1 - z0, band, tri, false);
  k.b.add(wallMat, gw, M(cx, yBase, cz), wallCol, 1.2); gw.dispose();
  // open structure (no walls under the roof: notice boards): the gable walls seen from inside, 1.5 cm in
  if (open) { gw = gableWalls(x1 - x0 - 0.03, z1 - z0, band, tri, true); k.b.add(wallMat, gw, M(cx, yBase, cz), wallCol, 1.2); gw.dispose(); }
  // walls up to the soffit along both eaves (6 mm inside the wall line): no slot into the roof void under the eaves
  else if (band > 0.01) for (const z of [z0 + 0.006, z1 - 0.006]) box(k, wallMat, wallCol, x0 + 0.004, x1 - 0.004, yBase, yBase + band, z < cz ? z : z - 0.04, z < cz ? z + 0.04 : z, 1.2);
  // fascia boards along the slopes on both gable ends + ridge cap
  const ang = Math.atan2(h, d / 2);
  for (const ex of [x0 - over, x1 + over]) {
    for (const s of [1, -1]) {   // the two boards of a gable cross at the apex: 1 cm apart so their faces never share a plane
      rbox(k, 'wood', shade(roofCol, -0.45), ex + (ex > cx ? 1 : -1) * (s > 0 ? 0.01 : 0), yBase + h / 2, cz + s * d / 4, 0.1, 0.12, slope + 0.05, 0, s * ang, 0, 1);
    }
  }
  rbox(k, 'roof', shade(roofCol, -0.25), cx, yBase + h + 0.02, cz, w + 0.04, 0.16, 0.22, 0, 0, 0, 1);
  // eave boards close the slot between the slope and its underside along both eaves (no see-through edge)
  for (const s of [-1, 1]) box(k, 'wood', shade(roofCol, -0.45), cx - w / 2 + 0.006, cx + w / 2 - 0.006, yBase - 0.073, yBase + 0.017, cz + s * d / 2 - 0.023, cz + s * d / 2 + 0.023, 1);
  if (k.pal.horns) for (const s of [-1, 1]) ridgeHorn(k, cx + s * (w / 2 - 0.05), yBase + h + 0.1, cz, s, 0, Math.max(0.6, Math.min(1.2, w / 3)));
}
/**
 * Quarter theme «horns» (site cityart.js K.horns: «рожки на коньке», cherts / ugabugi): a curved bone horn at a ridge end —
 * two stacked tapered pieces bending outward (dx, dz = outward direction), with a dark ring at the root.
 */
export function ridgeHorn(k: Ctx, x: number, y: number, z: number, dx: number, dz: number, s = 1): void {
  const c = k.pal.hornC || '#e8d8b8', r = 0.11 * s, l1 = 0.36 * s, l2 = 0.32 * s;
  const t1 = 0.55, t2 = 1.15;   // tilt from vertical of the lower / upper piece (rad)
  const rz = -dx * t1, rx = dz * t1;
  const x1 = x + dx * Math.sin(t1) * l1 / 2, z1 = z + dz * Math.sin(t1) * l1 / 2, y1 = y + Math.cos(t1) * l1 / 2;
  k.b.add('stone', GEO.cyl8, M(x1, y1, z1, r * 2, l1, r * 2, rx, 0, rz), c, 0.5);
  k.b.add('metal', GEO.cyl8, M(x, y + 0.02 * s, z, r * 2.5, 0.06 * s, r * 2.5, rx, 0, rz), '#2a0d14', 0.5);
  const xe = x + dx * Math.sin(t1) * l1, ze = z + dz * Math.sin(t1) * l1, ye = y + Math.cos(t1) * l1;
  k.b.add('stone', GEO.cone12, M(xe + dx * Math.sin(t2) * l2 / 2, ye + Math.cos(t2) * l2 / 2, ze + dz * Math.sin(t2) * l2 / 2, r * 2, l2, r * 2, dz * t2, 0, -dx * t2), c, 0.5);
}
/** Gable roof with ridge along Z (gable facing the street): over [x0,x1]×[z0,z1]. */
export function gableRoofZ(k: Ctx, roofCol: string, wallMat: BatchKey, wallCol: string, x0: number, x1: number, z0: number, z1: number, yBase: number, h: number, over = 0.25): void {
  const w = x1 - x0 + over * 2, d = z1 - z0 + over * 2, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const slope = Math.hypot(w / 2, h);
  k.b.add('roof', GEO2.gable, M(cx, yBase, cz, d, h, w, 0, Math.PI / 2, 0), roofCol, [d / 0.9, slope / 0.9]);
  k.b.add('wood', GEO2.gableUnder, M(cx, yBase - 0.06, cz, d, h, w, 0, Math.PI / 2, 0), shade(k.pal.woodD, 0.1), 0.5);
  const gw = gableWalls(z1 - z0, x1 - x0, Math.max(0, h * over / (w / 2) - 0.045), h * (1 - over / (w / 2)), false);
  k.b.add(wallMat, gw, M(cx, yBase, cz, 1, 1, 1, 0, Math.PI / 2, 0), wallCol, 1.2); gw.dispose();
  const band = Math.max(0, h * over / (w / 2) - 0.045);
  if (band > 0.01) for (const x of [x0 + 0.006, x1 - 0.006]) box(k, wallMat, wallCol, x < cx ? x : x - 0.04, x < cx ? x + 0.04 : x, yBase, yBase + band, z0 + 0.004, z1 - 0.004, 1.2);
  const ang = Math.atan2(h, w / 2);
  for (const ez of [z1 + over]) {
    for (const s of [1, -1]) rbox(k, 'wood', shade(roofCol, -0.45), cx + s * w / 4, yBase + h / 2, ez + (s > 0 ? 0.01 : 0), slope + 0.05, 0.12, 0.1, 0, 0, -s * ang, 1);
  }
  rbox(k, 'roof', shade(roofCol, -0.25), cx, yBase + h + 0.02, cz, 0.22, 0.16, d + 0.04, 0, 0, 0, 1);
  for (const s of [-1, 1]) box(k, 'wood', shade(roofCol, -0.45), cx + s * w / 2 - 0.023, cx + s * w / 2 + 0.023, yBase - 0.073, yBase + 0.017, cz - d / 2 + 0.006, cz + d / 2 - 0.006, 1);
  if (k.pal.horns) for (const s of [-1, 1]) ridgeHorn(k, cx, yBase + h + 0.1, cz + s * (d / 2 - 0.05), 0, s, Math.max(0.6, Math.min(1.2, d / 3)));
}
/** Pyramid (4-sided) roof over a square-ish footprint. */
export function pyramidRoof(k: Ctx, roofCol: string, cx: number, cz: number, w: number, d: number, yBase: number, h: number): void {
  k.b.add('roof', GEO.cone4, M(cx, yBase + h / 2, cz, w, h, d), roofCol, 0.9);
}

/**
 * Depth layers of everything attached to a +Z facade at `zf` (front faces, metres in front of the wall) — keep them
 * ≥ 6 mm apart so no two surfaces share a plane (z-fighting; checked by test/world-zfight.test.ts):
 *   rect window reveal .010 · glass .020 · timber posts .030 · beams .038 · arch window slab / arch door rim .046 ·
 *   arch glass / arch door leaf .054 · rect window bar .056 · cross bar .064 · door leaf .062 · door bands / window frame .072 ·
 *   arch bar / door posts .080 · arch cross bar / door lintel .088 · sign plate .100 · sign face .108 · sill .140
 */
export const FACADE_LAYERS = true;

/** Window on a +Z facing wall at `zf`: frame, glass (lit or dark), cross bars, sill, optional shutters / arch. */
export function windowZ(k: Ctx, x: number, y: number, zf: number, w: number, h: number, lit: boolean, opts: { shutters?: string; arch?: boolean; frame?: string } = {}): void {
  const fr = opts.frame || k.pal.woodD, P = k.pal;
  const glassCol = lit ? P.glass : '#3a4a7a', gm: BatchKey = lit ? 'emit' : 'glass';
  const t = 0.07;
  if (opts.arch) {
    // arch slab: rect part h/2 + elliptic top h/2 (local 0..1 → y..y+h)
    k.b.add('wood', GEO2.arch, M(x, y - t, zf + 0.006, w + t * 2, h + t * 2, 0.08), fr, 1);
    k.b.add(gm, GEO2.arch, M(x, y, zf + 0.049, w, h, 0.01), glassCol, 1);
    box(k, 'wood', fr, x - 0.025, x + 0.025, y, y + h * 0.95, zf + 0.044, zf + 0.08);
    box(k, 'wood', fr, x - w / 2 + 0.01, x + w / 2 - 0.01, y + h * 0.45, y + h * 0.45 + 0.05, zf + 0.044, zf + 0.088);
  } else {
    box(k, 'flat', '#1b1426', x - w / 2, x + w / 2, y, y + h, zf - 0.05, zf + 0.01);
    box(k, gm, glassCol, x - w / 2 + 0.03, x + w / 2 - 0.03, y + 0.03, y + h - 0.03, zf, zf + 0.02);
    box(k, 'wood', fr, x - w / 2 - t, x - w / 2, y - t, y + h + t, zf - 0.02, zf + 0.072);
    box(k, 'wood', fr, x + w / 2, x + w / 2 + t, y - t, y + h + t, zf - 0.02, zf + 0.072);
    box(k, 'wood', fr, x - w / 2, x + w / 2, y + h, y + h + t, zf - 0.02, zf + 0.072);
    box(k, 'wood', fr, x - 0.025, x + 0.025, y, y + h, zf, zf + 0.056);
    box(k, 'wood', fr, x - w / 2, x + w / 2, y + h * 0.55, y + h * 0.55 + 0.05, zf, zf + 0.064);
  }
  box(k, 'wood', P.woodL, x - w / 2 - 0.1, x + w / 2 + 0.1, y - 0.1, y, zf - 0.02, zf + 0.14);   // sill
  if (opts.shutters) {
    box(k, 'wood', opts.shutters, x - w / 2 - t - w * 0.45, x - w / 2 - t, y, y + h * (opts.arch ? 0.6 : 1), zf + 0.0, zf + 0.05);
    box(k, 'wood', opts.shutters, x + w / 2 + t, x + w / 2 + t + w * 0.45, y, y + h * (opts.arch ? 0.6 : 1), zf + 0.0, zf + 0.05);
  }
  if (lit) k.glows.push(x, y + h / 2, zf + 0.25, Math.max(w, h) * 1.3, 1, 0.75, 0.4);
}

/** Door on a +Z facing wall: frame, plank leaf (dark wood), optional arch top, step, handle; or an open glowing doorway. */
export function doorZ(k: Ctx, x: number, y: number, zf: number, w: number, h: number, opts: { arch?: boolean; open?: boolean; color?: string; frame?: string; glow?: string } = {}): void {
  const P = k.pal, fr = opts.frame || P.line;
  const leaf = opts.color || P.woodD;
  const rectH = opts.arch ? h - w / 2 : h;
  // depth layers: see FACADE_LAYERS (arch rim .046, arch leaf .054, leaf .062, bands .072, posts .08, lintel .088)
  if (opts.open) {
    box(k, 'emit', opts.glow || '#c8642a', x - w / 2, x + w / 2, y, y + rectH, zf - 0.01, zf + 0.058);
    if (opts.arch) k.b.add('emit', GEO2.arch, M(x, y + rectH - w / 2, zf + 0.044, w, w, 0.02), opts.glow || '#c8642a', 1);
    k.glows.push(x, y + h * 0.5, zf + 0.3, w * 2.4, 1, 0.6, 0.3);
  } else {
    box(k, 'wood', leaf, x - w / 2, x + w / 2, y, y + rectH, zf - 0.03, zf + 0.062, 0.5);
    if (opts.arch) k.b.add('wood', GEO2.arch, M(x, y + rectH - w / 2, zf + 0.024, w, w, 0.06), leaf, 0.5);
    // iron bands + handle
    for (const yy of [0.25, 0.7]) box(k, 'metal', P.metal, x - w / 2 + 0.005, x + w / 2 - 0.005, y + rectH * yy, y + rectH * yy + 0.06, zf + 0.05, zf + 0.072);
    ball(k, 'metal', '#d8b04a', x + w * 0.3, y + rectH * 0.5, zf + 0.09, 0.05);
  }
  // frame
  const t = 0.1;
  box(k, 'wood', fr, x - w / 2 - t, x - w / 2, y, y + rectH, zf - 0.04, zf + 0.08);
  box(k, 'wood', fr, x + w / 2, x + w / 2 + t, y, y + rectH, zf - 0.04, zf + 0.08);
  if (opts.arch) {
    // dark arch rim behind the leaf (slightly narrower than the posts so its sides never share their planes)
    k.b.add('wood', GEO2.arch, M(x, y + rectH - w / 2 - 0.0, zf + 0.031, w + t * 2 - 0.012, w / 2 + t + w / 2, 0.03), fr, 1);
  } else box(k, 'wood', fr, x - w / 2 - t - 0.006, x + w / 2 + t + 0.006, y + rectH, y + rectH + t, zf - 0.034, zf + 0.088);
  // step
  box(k, 'stone', shade(P.stone, 0.15), x - w / 2 - 0.15, x + w / 2 + 0.15, y - 0.02, y + 0.1, zf - 0.05, zf + 0.35, 0.6);
}

/** Signboard on a +Z facing wall (atlas text). Returns height used. */
export function signZ(k: Ctx, text: string, x: number, y: number, zf: number, w: number, opts: { bg?: string; fg?: string; sub?: string; hang?: boolean } = {}): number {
  const s = k.signs.add(text, opts);
  const h = w / s.aspect;
  const g = new THREE.PlaneGeometry(1, 1);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const [u0, v0, u1, v1] = s.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
  // back plate 0.004…0.1 in front of the wall (clears window frames +0.07, door posts +0.08, timber +0.06); face at +0.108
  k.b.add('sign', g, M(x, y + h / 2, zf + 0.108, w, h, 1), '#ffffff', 'keep');
  box(k, 'wood', k.pal.line, x - w / 2 - 0.03, x + w / 2 + 0.03, y - 0.03, y + h + 0.03, zf + 0.004, zf + 0.1);
  if (opts.hang) {
    box(k, 'metal', k.pal.metal, x - w / 2 + 0.1, x - w / 2 + 0.13, y + h + 0.03, y + h + 0.3, zf + 0.03, zf + 0.06);
    box(k, 'metal', k.pal.metal, x + w / 2 - 0.13, x + w / 2 - 0.1, y + h + 0.03, y + h + 0.3, zf + 0.03, zf + 0.06);
  }
  g.dispose();
  return h;
}

/** Timber framing on a +Z wall: vertical posts + horizontal beams + diagonal braces (dark wood). */
export function timberZ(k: Ctx, x0: number, x1: number, y0: number, y1: number, zf: number, bays: number, col?: string): void {
  const c = col || k.pal.timber, t = 0.12;
  for (let i = 0; i <= bays; i++) {
    const x = x0 + (x1 - x0) * i / bays;
    box(k, 'wood', c, x - t / 2, x + t / 2, y0, y1, zf - 0.01, zf + 0.03);
  }
  // beams 8 mm proud of the posts (their faces cross at every joint)
  box(k, 'wood', c, x0 - 0.004, x1 + 0.004, y0, y0 + t, zf - 0.012, zf + 0.038);
  box(k, 'wood', c, x0 - 0.004, x1 + 0.004, y1 - t, y1, zf - 0.012, zf + 0.038);
}

/** Wall lamp: bracket + lantern (emissive) + glow. */
export function wallLamp(k: Ctx, x: number, y: number, zf: number): void {
  box(k, 'metal', k.pal.metal, x - 0.03, x + 0.03, y - 0.03, y + 0.03, zf, zf + 0.3);
  box(k, 'metal', k.pal.metal, x - 0.1, x + 0.1, y - 0.2, y - 0.18, zf + 0.2, zf + 0.4);
  box(k, 'emit', '#ffcf6a', x - 0.08, x + 0.08, y - 0.38, y - 0.2, zf + 0.22, zf + 0.38);
  cone(k, 'metal', k.pal.metal, x, y - 0.18, zf + 0.3, 0.15, 0.14, true);
  k.glows.push(x, y - 0.29, zf + 0.3, 1.6, 1, 0.78, 0.4);
  k.lights.push(x, y - 0.3, zf + 0.5);
}

/** Flag on a pole. */
export function flag(k: Ctx, x: number, y: number, z: number, h: number, col: string): void {
  cyl(k, 'metal', k.pal.metal, x, y, z, 0.03, h, 8);
  ball(k, 'metal', '#ffcf4a', x, y + h + 0.04, z, 0.06);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.7, -0.15, 0.05, 0, -0.4, 0], 3));
  g.computeVertexNormals();
  k.b.add('flat', g, M(x + 0.03, y + h - 0.02, z, 1, 1, 1), col, 1);
  g.setIndex([0, 2, 1]); // back face
  k.b.add('flat', g, M(x + 0.03, y + h - 0.02, z, 1, 1, 1), col, 1);
  g.dispose();
}

/** Striped geometry helper: colours each face of a radial geometry by angular segment (for tents/awnings). */
export function stripeColors(g: THREE.BufferGeometry, a: string, b: string, segs: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g.clone();
  const pos = ng.attributes.position as THREE.BufferAttribute;
  const ca = C(a), cb = C(b);
  const col = new Float32Array(pos.count * 3);
  for (let f = 0; f < pos.count; f += 3) {
    let sx = 0, sz = 0;
    for (let j = 0; j < 3; j++) { sx += pos.getX(f + j); sz += pos.getZ(f + j); }
    const ang = Math.atan2(sz, sx) + Math.PI;
    const idx = Math.floor(ang / (Math.PI * 2) * segs);
    const c = idx % 2 ? cb : ca;
    for (let j = 0; j < 3; j++) { col[(f + j) * 3] = c.r; col[(f + j) * 3 + 1] = c.g; col[(f + j) * 3 + 2] = c.b; }
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ng;
}

/** Striped awning (sloped, with scalloped valance) in front of a +Z wall from x0..x1, top at y, projecting d. */
export function awning(k: Ctx, x0: number, x1: number, y: number, zf: number, d: number, a: string, b: string): void {
  const n = Math.max(3, Math.round((x1 - x0) / 0.35));
  const w = (x1 - x0) / n, drop = d * 0.45, slope = Math.hypot(d, drop), ang = Math.atan2(drop, d);
  for (let i = 0; i < n; i++) {
    const cx = x0 + w * (i + 0.5), col = i % 2 ? b : a;
    rbox(k, 'canvas', col, cx, y - drop / 2, zf + d / 2, w, 0.04, slope, 0, ang, 0);
    // valance: half-cylinder scallop
    k.b.add('canvas', GEO.cyl12, M(cx, y - drop - 0.08, zf + d, w * 0.97, 0.16, 0.06, Math.PI / 2, 0, 0), col, 1);
    box(k, 'canvas', col, cx - w / 2, cx + w / 2, y - drop - 0.08, y - drop, zf + d - 0.03, zf + d + 0.03);
  }
}

export { M, GEO, GEO2 };
