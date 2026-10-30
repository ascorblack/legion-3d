/**
 * Hand-made villages ★1 (site 28.10, towngen.js buildHand + packages/world/villages/<id>.js): real 3D from the same
 * layout the site walks on (src/net/town.ts villageScene → `layout.village`).
 *   - ground of the biome (grass / snow / sand / ash…, 'paving' = ground, 'lowPaving' = road soil — index.ts makeMaterials),
 *     the hand-drawn streets (polylines of any width), plazas (paved or green), water (ellipses and rects; lava in the
 *     cherts quarter: the water material follows the palette), bridges where the artist put them;
 *   - buildings lower down the street (lot.B > 800): the normal street model of that building, built as if in the back
 *     row, then carried to its base line with the site's depth scale `s` (wider and taller, as the 2D art draws it) and
 *     its depth fitted between the walkable rows behind and in front of it (the site lets you walk right behind such a
 *     building — the 2D art hides you; in 3D the house is as deep as its obstacle band). The facade layer keeps its
 *     real depth, only the body behind is compressed. Door hit boxes follow (buildings.ts BUILDING_XF);
 *   - cottages (`houses`, not enterable) the same way, turned to face the walkable side;
 *   - props by kind (trees, bushes, lamps, barrels, crates, wells, stumps, haystacks, glowing mushrooms…), each solid on the
 *     site's own footprint, so every walkable cell of the site's grid stays walkable in 3D (test/world-village.test.ts).
 * Any missing field degrades to "nothing there": no lots → the depth comes from the building's hit box; no roads → plain
 * ground; an unknown prop kind with a footprint → a crate / a tree by its height.
 */
import * as THREE from 'three';
import type { Building, CityLayout } from '../contracts';
import type { VillageScene, VillageProp } from '../net/town';
import { toX, toZ, SZ } from './coords';
import { GEO, M } from './batch';
import { type Ctx, box, rbox, cyl, ball, shade } from './kit';
import { BUILDING_XF, house } from './buildings';
import type { Placed } from './place';

export type VillageLayout = CityLayout & { village?: VillageScene; spawn?: [number, number] };
export const villageOf = (L: CityLayout): VillageScene | null => (L as VillageLayout).village ?? null;

/** Ground and road colours of a biome (towngen.js NATURE / townart.js BIO, simplified): [grass ×3], [soil ×3]. */
const BIOME_GROUND: Record<string, [string[], string[]]> = {
  meadow: [['#3f6a3c', '#355c34', '#4c7a46'], ['#7a5a3a', '#634830', '#8e6a46']],
  forest: [['#2f5a36', '#284e2e', '#3c6a40'], ['#6a4e34', '#55402a', '#7a5c3e']],
  taiga: [['#2e4e3a', '#264232', '#3a5e46'], ['#5e4a3a', '#4a3a2e', '#6e5844']],
  swamp: [['#3a5034', '#2e422a', '#4a6040'], ['#4e4430', '#3e3626', '#5e543a']],
  ice: [['#c8d8e8', '#b4c8dc', '#dce8f4'], ['#8a9aac', '#76869a', '#9eaec0']],
  mount: [['#4a5a44', '#3e4c3a', '#5a6a52'], ['#7a6e62', '#665c52', '#8a7e70']],
  ash: [['#3a3438', '#2e292c', '#4a4246'], ['#5a4a46', '#4a3c38', '#6a5852']],
  desert: [['#c8a86a', '#b8985a', '#d8b87a'], ['#a8885a', '#94784c', '#b8986a']],
  coast: [['#5a7a4a', '#4c6a40', '#6a8a56'], ['#c8b088', '#b49c76', '#d8c098']],
  blight: [['#4a3e52', '#3e3446', '#5a4c62'], ['#5e4a4e', '#4c3c40', '#6e5a5e']],
  ruin: [['#4a5440', '#3e4636', '#5a644e'], ['#6e6a5e', '#5c584e', '#7e7a6e']],
};
export const villageGround = (biome: string) => BIOME_GROUND[biome] || BIOME_GROUND.meadow;

/** towngen.js depthK: a building lower down the street is drawn this much bigger. */
export const depthK = (B: number): number => (B <= 820 ? 1 : +(1 + 0.42 * Math.min(1, (B - 800) / 262)).toFixed(2));

export interface DepthInfo { B: number; s: number; cx: number }
/** A building standing lower down the street (its lot's base B > 800), or null for the back row. */
export function depthOf(L: CityLayout, b: Building): DepthInfo | null {
  const v = villageOf(L); if (!v || b.id === 'anvil' || b.mine) return null;
  const lot = v.lots.find((l) => l.k === b.id);
  if (lot) return lot.B ? { B: lot.B, s: lot.s || depthK(lot.B), cx: (lot.x0 + lot.x1) / 2 } : null;
  // no lot data: the hit box says it (back-row buildings end at y 800, the anvil awning at 880)
  if (b.hit[3] <= 900) return null;
  const B = b.hit[3] - 6; return { B, s: depthK(B), cx: (b.hit[0] + b.hit[1]) / 2 };
}

/** The walkable rows just behind and just in front of an obstacle band at base y (px), over x0..x1; null = no band. */
export function bandOf(L: CityLayout, x0: number, x1: number, B: number, h = 52): { back: number; front: number } | null {
  let back = -Infinity, front = Infinity, n = 0;
  for (let x = x0 + 12; x <= x1 - 12; x += 12) {
    let y = B - 8;
    if (L.free(x, y)) continue;
    n++;
    while (y > B - 600 && !L.free(x, y)) y -= 4;
    back = Math.max(back, y);
    y = B - 8;
    while (y < B + 300 && !L.free(x, y)) y += 4;
    front = Math.min(front, y);
  }
  if (!n || !isFinite(back) || !isFinite(front)) return null;
  // never deeper than the obstacle the site drew (+ the grid's own margin) — keeps a house a house
  return { back: Math.max(back, B - Math.max(h, 40) - 40), front };
}

/* ------------------------------------------------------------------ building at depth */
interface Call { mat: Parameters<Ctx['b']['add']>[0]; geo: THREE.BufferGeometry; m: THREE.Matrix4; col: THREE.ColorRepresentation | null; uv: number | 'keep' | [number, number] }
const _b3 = new THREE.Box3(), _v = new THREE.Vector3(), IDENT = new THREE.Matrix4();

/**
 * Run a builder (which builds a model as if in the back row: facade line ≈ z 0, body towards −Z) and carry what it made
 * to the band [zb, zf] (m): x and y scaled by sx / sy about x = cx, depth piecewise — the facade layer (zFace − 0.4 …
 * front) keeps its depth (mm-thin facade layers stay apart), the body behind is compressed into what is left.
 * `flip`: the model faces −Z (turned half round about cx). Everything the builder pushed (colliders, solids, glows,
 * lights, pools, wires, bulbs, instanced props) is carried too; solids are clamped into the band and to x0..x1 (m).
 * Returns the depth map (source z → world z) for door hit boxes.
 */
export function buildAtDepth(k: Ctx, o: { cx: number; sx: number; sy: number; zb: number; zf: number; zFace: number; flip?: boolean; clampX?: [number, number] }, build: () => void): (z: number) => number {
  const calls: Call[] = [];
  const add0 = k.b.add;
  const n0 = { col: k.colliders.length, sol: (k.solids ||= []).length, glo: k.glows.length, li: k.lights.length, bu: k.bulbs.length, wi: k.wires.length, po: (k.pools ||= []).length };
  const inst0 = new Map<string, number>(); for (const [kind, a] of k.inst.placed) inst0.set(kind, a.length);
  k.b.add = (mat, g, m, col, uv = 1) => { calls.push({ mat, geo: g.clone(), m: m.clone(), col, uv }); };
  try { build(); } finally { k.b.add = add0; }
  // source depth range of the model
  let zMin = Infinity, zMax = -Infinity;
  for (const c of calls) {
    if (!c.geo.boundingBox) c.geo.computeBoundingBox();
    _b3.copy(c.geo.boundingBox!).applyMatrix4(c.m);
    zMin = Math.min(zMin, _b3.min.z); zMax = Math.max(zMax, _b3.max.z);
  }
  if (!isFinite(zMin)) { zMin = o.zFace - 1; zMax = o.zFace; }
  // piecewise-linear depth map that keeps every thin layer at its real depth: thin pieces (< 0.3 m deep: window glass,
  // frames, sign plates, door leaves, boards — the mm-apart facade layers) are merged into clusters (gaps < 2 cm) that keep
  // slope 1; only the gaps between the clusters (the body of the house, the space under an awning) are compressed into the
  // band. If even the clusters do not fit: one straight compression.
  const Lb = Math.max(0.2, o.zf - o.zb);
  const iv: [number, number][] = [];
  for (const c of calls) {
    _b3.copy(c.geo.boundingBox!).applyMatrix4(c.m);
    const a = _b3.min.z, b = _b3.max.z;
    if (b - a < 0.3) iv.push([Math.max(zMin, a - 0.004), Math.min(zMax, b + 0.004)]);
    else iv.push([Math.max(zMin, a - 0.004), a + 0.004], [b - 0.004, Math.min(zMax, b + 0.004)]);   // a deep piece: its two end faces
  }
  iv.sort((p, q) => p[0] - q[0]);
  const cl: [number, number][] = [];
  for (const [a, b] of iv) { const last = cl[cl.length - 1]; if (last && a <= last[1] + 0.03) last[1] = Math.max(last[1], b); else cl.push([a, b]); }
  let C = 0; for (const [a, b] of cl) C += b - a;
  const gaps = (zMax - zMin) - C;
  const src: number[] = [], dst: number[] = [];
  if (cl.length && gaps > 1e-6) {
    // clusters at slope kc (1 when they fit in 85 % of the band), the gaps share the rest
    const kc = Math.min(1, Lb * 0.85 / C), g = Math.min(1, (Lb - C * kc) / gaps);
    let z = zMin, w = o.zb; src.push(z); dst.push(w);
    for (const [a, b] of cl) { if (a > z) { w += (a - z) * g; z = a; src.push(z); dst.push(w); } w += (b - a) * kc; z = b; src.push(z); dst.push(w); }
    if (zMax > z) { src.push(zMax); dst.push(w + (zMax - z) * g); }
    const shift = o.zf - dst[dst.length - 1]; for (let i = 0; i < dst.length; i++) dst[i] += shift;   // front edge on zf (g < 1: exact)
  } else { src.push(zMin, zMax); dst.push(o.zb, o.zf); }
  const lin = (z: number): number => {
    let lo = 0, hi = src.length - 2;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (src[m] <= z) lo = m; else hi = m - 1; }
    const i = lo;
    const a = src[i], b = src[i + 1]; return b - a > 1e-9 ? dst[i] + (z - a) * (dst[i + 1] - dst[i]) / (b - a) : dst[i];
  };
  // a turned model (facing −Z): its depth mirrored inside the band (with x mirrored too that is a half turn, not a reflection)
  const f = (z: number): number => { const zw = lin(z); return o.flip ? o.zf + o.zb - zw : zw; };
  const X = (x: number) => (o.flip ? o.cx - (x - o.cx) * o.sx : o.cx + (x - o.cx) * o.sx);
  // replay the pieces: every vertex through the same map (x/y scale, z → f(z)), normals by its Jacobian diag(sx, sy, f'(z))
  const slope = (z: number): number => {
    let lo = 0, hi = src.length - 2;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (src[m] <= z) lo = m; else hi = m - 1; }
    const d = src[lo + 1] - src[lo]; return d > 1e-9 ? Math.max(1e-3, (dst[lo + 1] - dst[lo]) / d) : 1;
  };
  const sxs = o.flip ? -o.sx : o.sx, szs = o.flip ? -1 : 1;
  for (const c of calls) {
    const g = c.geo.index ? c.geo.toNonIndexed() : c.geo;
    if (g !== c.geo) c.geo.dispose();
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(c.m);
    const pos = g.attributes.position as THREE.BufferAttribute, nor = g.attributes.normal as THREE.BufferAttribute;
    let za = Infinity, zb = -Infinity, wa = Infinity, wb = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i), kz = slope(z) * szs, w = f(z);
      za = Math.min(za, z); zb = Math.max(zb, z); wa = Math.min(wa, w); wb = Math.max(wb, w);
      pos.setXYZ(i, X(pos.getX(i)), pos.getY(i) * o.sy, w);
      _v.set(nor.getX(i) / sxs, nor.getY(i) / o.sy, nor.getZ(i) / kz).normalize();
      nor.setXYZ(i, _v.x, _v.y, _v.z);
    }
    // a piece with its own UV layout (roof slopes: rows along the slope) squeezed in depth would stretch its texture
    // (test/world-texmap.test.ts): box-project it in its new shape instead
    const k2 = zb - za > 0.05 ? (wb - wa) / (zb - za) : 1;
    const uv = (c.uv === 'keep' || Array.isArray(c.uv)) && (k2 < 0.8 || k2 > 1.25) ? 1 : c.uv;
    add0.call(k.b, c.mat, g, IDENT, c.col, uv);
    g.dispose();
  }
  // what the builder pushed into the context
  const pt = (a: number[], i: number) => { a[i] = X(a[i]); a[i + 1] *= o.sy; a[i + 2] = f(a[i + 2]); };
  const zClamp = (z: number) => Math.min(o.zf, Math.max(o.zb, z));
  const xs = (a: number[], i: number) => { const p = X(a[i]), q = X(a[i + 1]); a[i] = Math.min(p, q); a[i + 1] = Math.max(p, q); };
  const zs = (a: number[], i: number, clamp: boolean) => { const p = f(a[i]), q = f(a[i + 1]); a[i] = Math.min(p, q); a[i + 1] = Math.max(p, q); if (clamp) { a[i] = zClamp(a[i]); a[i + 1] = zClamp(a[i + 1]); } };
  for (let i = n0.col; i + 5 < k.colliders.length; i += 6) { xs(k.colliders, i); k.colliders[i + 2] *= o.sy; k.colliders[i + 3] *= o.sy; zs(k.colliders, i + 4, true); }
  const S = k.solids!;
  for (let i = n0.sol; i + 4 < S.length; i += 5) {
    xs(S, i); zs(S, i + 2, true);
    if (o.clampX) { S[i] = Math.max(S[i], o.clampX[0]); S[i + 1] = Math.min(S[i + 1], o.clampX[1]); if (S[i + 1] < S[i]) S[i + 1] = S[i]; }
    if (isFinite(S[i + 4])) S[i + 4] *= o.sy;
  }
  for (let i = n0.glo; i + 6 < k.glows.length; i += 7) { pt(k.glows, i); k.glows[i + 3] *= o.sy; }
  for (let i = n0.li; i + 2 < k.lights.length; i += 3) pt(k.lights, i);
  for (let i = n0.bu; i + 5 < k.bulbs.length; i += 6) pt(k.bulbs, i);
  for (let i = n0.wi; i + 5 < k.wires.length; i += 6) { pt(k.wires, i); pt(k.wires, i + 3); }
  const P = k.pools!;
  for (let i = n0.po; i + 7 < P.length; i += 8) { pt(P, i); P[i + 3] *= o.sy; }
  for (const [kind, a] of k.inst.placed) {
    const i0 = inst0.get(kind) ?? 0;
    for (let i = i0; i < a.length; i++) {
      const p = a[i]; p.x = X(p.x); p.y *= o.sy; p.z = f(p.z); p.scale *= o.sy; p.sy *= o.sy; if (o.flip) p.rotY += Math.PI;
    }
    // the depth map squeezes the gaps: two props of a kind set apart in depth (the storage barn's barrels) can land in
    // one spot — keep the first (two identical meshes inside each other z-fight: test/world-village.test.ts)
    for (let i = a.length - 1; i > i0; i--) {
      const p = a[i];
      for (let j = i0; j < i; j++) { const q = a[j]; if (Math.abs(p.y - q.y) < 0.05 && Math.hypot(p.x - q.x, p.z - q.z) < 0.3 * (p.scale + q.scale)) { a.splice(i, 1); break; } }
    }
  }
  return f;
}

/**
 * A site building lower down the street: its virtual back-row twin (hit and door scaled back by 1/s about the lot
 * centre, base at y 800) is built by `build` and carried to the band of its obstacle. Returns false when there is no
 * obstacle band (then the caller builds it as usual).
 */
export function buildDeepBuilding(k: Ctx, L: CityLayout, b: Building, d: DepthInfo, build: (virt: Building) => void): boolean {
  const band = bandOf(L, b.hit[0], b.hit[1], d.B, 58 * d.s);
  if (!band) return false;
  const s = d.s, cx = d.cx, hgt = Math.max(150, d.B - b.hit[2]) / s;
  const virt: Building = { ...b, hit: [cx + (b.hit[0] - cx) / s, cx + (b.hit[1] - cx) / s, 800 - hgt, 800], door: { x: cx + (b.door.x - cx) / s, y: 822 } };
  const zb = toZ(band.back + 4) + 0.03, zf = toZ(band.front - 4) - 0.03;
  const f = buildAtDepth(k, { cx: toX(cx), sx: s, sy: s, zb, zf, zFace: -0.15, clampX: [toX(b.hit[0]), toX(b.hit[1])] }, () => build(virt));
  BUILDING_XF.set(b, { virt, z: f, s });
  // the whole obstacle band is the building (as the site's grid has it), whatever the model leaves open in front
  (k.solids ||= []).push(toX(b.hit[0]), toX(b.hit[1]), zb, zf, Infinity);
  return true;
}

/* ------------------------------------------------------------------ ground: roads, plazas, water, bridges */
function strip(k: Ctx, mat: 'lowPaving' | 'stone', pts: [number, number][], wpx: number, y: number, th: number): void {
  const w = wpx * SZ * 2 * 0.62;   // the site's road half-width w (px, on the depth axis) → a strip of about that width
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const X0 = toX(x0), Z0 = toZ(y0), X1 = toX(x1), Z1 = toZ(y1), len = Math.hypot(X1 - X0, Z1 - Z0);
    if (len < 1e-3) continue;
    rbox(k, mat, '#ffffff', (X0 + X1) / 2, y - th / 2, (Z0 + Z1) / 2, len, th, w, -Math.atan2(Z1 - Z0, X1 - X0), 0, 0, 1.6);
  }
  for (const [x, yy] of pts) cyl(k, mat, '#ffffff', toX(x), y - th - 0.0005, toZ(yy), w / 2, th, 16, 1.6);
}

export function buildVillageGround(k: Ctx, L: CityLayout, v: VillageScene): void {
  const P = k.pal, W = toX(L.W), zEnd = toZ(L.area.y1) + 0.8;
  // ground ('paving' = the biome's grass in a village)
  k.b.add('paving', GEO.plane, M(W / 2, 0, (-14 + zEnd) / 2, W + 3, zEnd + 14, 1, -Math.PI / 2, 0, 0), '#ffffff', 2.4);
  // streets: the main street a touch wider and lighter, lanes / trails as soil
  for (const r of v.roads) strip(k, 'lowPaving', r.pts, r.w, r.k === 'main' ? 0.014 : 0.012, 0.012);
  // plazas: paved disc (stone) or a green with a soil rim
  for (const p of v.plazas) {
    const X = toX(p.x), Z = toZ(p.y), rx = toX(p.rx), rz = p.ry * SZ;
    if (p.green) k.b.add('lowPaving', GEO.cyl16, M(X, 0.009, Z, rx * 2 + 0.5, 0.018, rz * 2 + 0.4), '#ffffff', 1.6);
    else if (p.rect) box(k, 'stone', shade(P.stone, 0.05), X - rx, X + rx, 0, 0.02, Z - rz, Z + rz, 0.8);
    else k.b.add('stone', GEO.cyl16, M(X, 0.01, Z, rx * 2, 0.02, rz * 2), shade(P.stone, 0.05), 0.8);
  }
  // water (ellipses, rects): a bank ring + the surface; lava in the cherts quarter (palette water)
  for (const w of v.water) {
    if ('e' in w) {
      const [x, y, rx, ry] = w.e, X = toX(x), Z = toZ(y), RX = toX(rx), RZ = ry * SZ;
      k.b.add('stone', GEO.cyl16, M(X, 0.02, Z, RX * 2 + 0.36, 0.04, RZ * 2 + 0.3), shade(P.stone, -0.25), 0.8);
      k.b.add('water', GEO.cyl16, M(X, 0.036, Z, RX * 2, 0.02, RZ * 2), '#ffffff', 3);
      waterSolid(k, x, y, rx, ry, v);
    } else {
      const [x0, y0, x1, y1] = w.b;
      const ya = Math.max(y0, L.area.y0 - 40), yb = Math.min(y1, L.area.y1 + 40);
      box(k, 'stone', shade(P.stone, -0.25), toX(x0) - 0.14, toX(x1) + 0.14, 0, 0.04, toZ(ya) - 0.12, toZ(yb) + 0.12, 0.8);
      k.b.add('water', GEO.plane, M(toX((x0 + x1) / 2), 0.05, toZ((ya + yb) / 2), toX(x1 - x0), (yb - ya) * SZ, 1, -Math.PI / 2, 0, 0), '#ffffff', 3);
      solidRect(k, toX(x0), toX(x1), toZ(ya), toZ(yb), v);
    }
  }
  for (const br of v.bridges) bridge(k, br);
}
/** Water is not walkable (Infinity), except where a bridge crosses it. */
function solidRect(k: Ctx, x0: number, x1: number, z0: number, z1: number, v: VillageScene): void {
  const cuts = v.bridges.map((b) => [toX(b.x0), toX(b.x1), toZ(b.y0), toZ(b.y1)]).filter((c) => c[1] > x0 && c[0] < x1 && c[3] > z0 && c[2] < z1).sort((a, b) => a[0] - b[0]);
  let x = x0;
  for (const c of cuts) { if (c[0] > x) (k.solids ||= []).push(x, c[0], z0, z1, Infinity); x = Math.max(x, c[1]); }
  if (x < x1) (k.solids ||= []).push(x, x1, z0, z1, Infinity);
}
/** An elliptic pond as horizontal strips (0.1 m) of Infinity — inside the ellipse only (its edge cells stay as the site has them). */
function waterSolid(k: Ctx, x: number, y: number, rx: number, ry: number, v: VillageScene): void {
  const X = toX(x), Z = toZ(y), RX = toX(rx) * 0.9, RZ = ry * SZ * 0.9;
  for (let z = -RZ; z < RZ; z += 0.1) {
    const zm = Math.min(Math.abs(z), Math.abs(z + 0.1)), hw = RX * Math.sqrt(Math.max(0, 1 - (zm / RZ) ** 2));
    if (hw > 0.02) solidRect(k, X - hw, X + hw, Z + z, Z + Math.min(z + 0.1, RZ), v);
  }
}
/** A plank bridge over x0..x1 × y0..y1: deck along the longer axis, rails on the sides (over the water). */
function bridge(k: Ctx, br: { x0: number; x1: number; y0: number; y1: number }): void {
  const P = k.pal, X0 = toX(br.x0), X1 = toX(br.x1), Z0 = toZ(br.y0), Z1 = toZ(br.y1);
  const alongZ = Z1 - Z0 >= X1 - X0;
  const len = alongZ ? Z1 - Z0 : X1 - X0, n = Math.max(4, Math.round(len / 0.3));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, y = 0.08 + 0.1 * Math.sin(Math.PI * t);
    if (alongZ) box(k, 'wood', i % 2 ? P.woodL : shade(P.woodL, -0.08), X0, X1, y - 0.05, y, Z0 + len * i / n + 0.01, Z0 + len * (i + 1) / n - 0.01, 0.6);
    else box(k, 'wood', i % 2 ? P.woodL : shade(P.woodL, -0.08), X0 + len * i / n + 0.01, X0 + len * (i + 1) / n - 0.01, y - 0.05, y, Z0, Z1, 0.6);
  }
  const rail = (a: number) => {
    for (let i = 0; i <= 4; i++) {
      const t = i / 4, y = 0.08 + 0.1 * Math.sin(Math.PI * t);
      if (alongZ) box(k, 'wood', P.woodD, a - 0.05, a + 0.05, y, y + 0.7, Z0 + (Z1 - Z0) * t - 0.05, Z0 + (Z1 - Z0) * t + 0.05, 0.6);
      else box(k, 'wood', P.woodD, X0 + (X1 - X0) * t - 0.05, X0 + (X1 - X0) * t + 0.05, y, y + 0.7, a - 0.05, a + 0.05, 0.6);
    }
    if (alongZ) box(k, 'wood', P.wood, a - 0.04, a + 0.04, 0.78, 0.86, Z0, Z1, 0.6);
    else box(k, 'wood', P.wood, X0, X1, 0.78, 0.86, a - 0.04, a + 0.04, 0.6);
  };
  // rails 6 cm outside the deck (the deck's own cells stay free; the rails stand over the water)
  if (alongZ) { rail(X0 - 0.06); rail(X1 + 0.06); } else { rail(Z0 - 0.06); rail(Z1 + 0.06); }
}

/* ------------------------------------------------------------------ cottages */
/** Cottages (`houses`): plain houses on their obstacle band, facing the walkable side (towards the site's viewer if both are). */
export function buildCottages(k: Ctx, L: CityLayout, v: VillageScene): void {
  const P = k.pal;
  v.houses.forEach((c, i) => {
    const band = bandOf(L, c.x0 + 6, c.x1 - 6, c.base, 52); if (!band) return;
    const cx = (c.x0 + c.x1) / 2, front = L.free(cx, band.front + 8), back = L.free(cx, band.back);
    const flip = !front && back;
    const s = c.s !== 1 ? c.s : depthK(c.base), X0 = toX(c.x0 + 6), X1 = toX(c.x1 - 6);
    const r = ((i * 7919) % 100) / 100;
    buildAtDepth(k, { cx: toX(cx), sx: 1, sy: Math.min(1.25, s), zb: toZ(band.back + 4) + 0.03, zf: toZ(band.front - 4) - 0.03, zFace: -0.1, flip, clampX: [X0, X1] }, () => {
      house(k, X0 + 0.05, X1 - 0.05, -0.1, 3.4, 2.3 + r * 0.6, {
        wall: r < 0.4 ? 'wood' : r < 0.75 ? 'plaster' : 'stone', timber: r >= 0.4 && r < 0.75, roofCol: r < 0.5 ? P.roof : P.roof2,
        chimney: r > 0.3, lit: 0.6, shutters: r < 0.5 ? P.sign : undefined, roof: 'x',
      });
      k.colliders.push(X0, X1, 0, 4.5, -3.6, -0.1);
    });
    (k.solids ||= []).push(X0, X1, toZ(band.back + 4) + 0.03, toZ(band.front - 4) - 0.03, Infinity);
  });
}

/* ------------------------------------------------------------------ props */
const TREEISH = /oak|tree|pine|birch|rowan|willow|palm|spruce|fir|maple|apple|elm|ash|cypress|sprout|cactus/i;
const BUSHY = /bush|shrub|reed|fern|hedge|grass/i;
const LAMPS = /lamp|lantern|torch/i;
/** What a village prop becomes in 3D (exported for tests). */
export function propKind(p: Pick<VillageProp, 'k' | 'tall' | 'foot'>): string {
  const k = p.k;
  if (/^well/i.test(k)) return 'well';
  if (/fountain/i.test(k)) return 'fountain';
  if (LAMPS.test(k)) return 'lamp';
  if (/shroom|mushroom|glow/i.test(k)) return 'shroom';
  if (/^flowers?$/i.test(k)) return 'flowers';
  if (/flowerbed|bed$|garden|patch/i.test(k)) return 'bed';
  if (/stump|log/i.test(k)) return 'stump';
  if (/rock|stone|boulder|drift|pebble/i.test(k) && !/statue/i.test(k)) return 'rock';
  if (/hay|straw/i.test(k)) return 'hay';
  if (/barrel|keg|hive|pot|jar|acorn/i.test(k)) return 'barrel';
  if (/crate|box|chest|camp|cart|wagon|sack/i.test(k)) return 'crate';
  if (/sign/i.test(k)) return 'signpost';
  if (/arch|fence|rail|rack|gate/i.test(k)) return 'fence';
  if (/statue|totem|obelisk|idol|monument/i.test(k)) return 'statue';
  if (BUSHY.test(k)) return 'bush';
  if (TREEISH.test(k) || p.tall >= 200) return 'tree';
  return p.foot ? 'crate' : 'skip';
}

/** Village aliases of the repeated prop kinds (instancer.ts alias: the same parts, no PROP_SOLID entry — solid.ts). */
export const VK = { tree: 'v:tree', bush: 'v:bush', lamp: 'v:lamp', barrel: 'v:barrel', crate: 'v:crate', bed: 'v:bed', fence: 'v:fence' } as const;

/** Solid of a prop on the site's footprint (px half-axes) — the inscribed box (−10 %), never bigger than the site's ellipse. */
function footSolid(k: Ctx, p: VillageProp, top: number): void {
  if (!p.foot) return;
  const X = toX(p.x), Z = toZ(p.y), hx = toX(p.foot[0]) * 0.64, hz = p.foot[1] * SZ * 0.64;
  (k.solids ||= []).push(X - hx, X + hx, Z - hz, Z + hz, top);
}

export function placeVillageProps(k: Ctx, L: CityLayout, v: VillageScene, lampHead: number): Placed {
  const P = k.pal, lampHeads: number[] = [];
  const BULB = ['#ff8fa3', '#ffd34d', '#b79be0', '#7fb0e8', '#9fe39a'];
  for (const p of v.props) {
    const X = toX(p.x), Z = toZ(p.y), s = p.s || 1, kind = propKind(p);
    const fr = p.foot ? toX(p.foot[0]) : 0.3;
    switch (kind) {
      // repeated kinds go in as village aliases (same look, no kind solid): the solid is the site's own footprint
      case 'tree': {
        const sc = Math.max(0.8, Math.min(2.2, (p.tall || 260) / 230)) * s * 1.05;
        if (!p.foot) break;   // a tree you can walk through on the site: not in 3D either
        k.inst.add(VK.tree, X, 0, Z, (p.x * 0.37) % 6.28, sc); footSolid(k, p, Infinity);
        break;
      }
      case 'bush': if (p.foot) { k.inst.add(VK.bush, X, 0, Z, (p.x * 0.11) % 6.28, Math.max(0.6, fr / 0.42) * 0.9); footSolid(k, p, 0.5); } break;
      case 'lamp': {
        k.inst.add(VK.lamp, X, 0, Z, 0, 1); lampHeads.push(X, lampHead, Z); footSolid(k, p, Infinity);
        break;
      }
      case 'barrel': if (p.foot) { const sc = Math.max(0.7, Math.min(1.3, fr / 0.28 * 0.9)); k.inst.add(VK.barrel, X, 0, Z, (p.x * 0.3) % 6.28, sc); footSolid(k, p, 0.75 * sc); } break;
      case 'crate': if (p.foot) { const sc = Math.max(0.7, Math.min(1.3, fr / 0.3 * 0.9)); k.inst.add(VK.crate, X, 0, Z, (p.x * 0.21) % 0.8 - 0.4, sc); footSolid(k, p, 0.54 * sc); } break;
      case 'bed': if (p.foot) { k.inst.add(VK.bed, X, 0, Z, 0, Math.max(0.6, Math.min(1.4, fr / 1.0))); footSolid(k, p, 0.42); } break;
      // hero kinds (the prop kit draws them by name): only where the site has a footprint, sized to it
      // (their kind solid is a disc: radius ≤ 1.4 × the footprint's depth half-axis — the site's grid blocks that much round it)
      case 'well': if (p.foot) k.inst.add('well', X, 0, Z, 0, Math.min(1.5, Math.min(fr, p.foot[1] * SZ * 1.4) / 0.67)); break;
      case 'fountain': if (p.foot) k.inst.add('fountain', X, 0, Z, 0, Math.min(fr, p.foot[1] * SZ * 1.4) / 1.27); break;
      case 'statue': if (p.foot) k.inst.add('statue', X, 0, Z, 0, Math.min(1.6, Math.min(fr, p.foot[1] * SZ * 1.4) / 0.9)); break;
      case 'fence': if (p.foot) { k.inst.add(VK.fence, X, 0, Z, 0, Math.max(0.3, fr / 1.02), 1); footSolid(k, p, Infinity); } break;
      case 'signpost': if (p.foot) k.inst.add('signpost', X, 0, Z, -0.4, 1); break;
      case 'stump': {
        cyl(k, 'wood', P.woodD, X, 0, Z, fr * 0.7, 0.35 * s, 12, 0.5);
        cyl(k, 'wood', P.woodL, X, 0.35 * s, Z, fr * 0.62, 0.012, 12, 0.5);
        footSolid(k, p, 0.36 * s);
        break;
      }
      case 'rock': {
        k.b.add('rock', GEO.sphere, M(X, 0.05, Z, fr * 1.6, 0.5 * s, p.foot ? p.foot[1] * SZ * 1.6 : 0.4, 0, p.x % 3, 0), P.rock, 1.6);
        footSolid(k, p, 0.3 * s);
        break;
      }
      case 'hay': {
        k.b.add('canvas', GEO.dome, M(X, 0, Z, fr * 1.7, 0.9 * s, (p.foot ? p.foot[1] * SZ : 0.3) * 1.7), '#e8c45a', 1);
        footSolid(k, p, 0.85 * s);
        break;
      }
      case 'shroom': {
        const h = 0.3 * s * Math.max(1, (p.tall || 40) / 40);
        cyl(k, 'plaster', '#efe6d0', X, 0, Z, 0.05, h, 8, 0.5);
        k.b.add('emit', GEO.dome, M(X, h, Z, fr * 1.4, 0.16 * s, fr * 1.4), '#7ae8ff', 1);
        k.glows.push(X, h + 0.05, Z, 0.8, 0.5, 0.9, 1);
        footSolid(k, p, Infinity);
        break;
      }
      case 'flowers': {
        for (let i = 0; i < 6; i++) {
          const a = i * 1.7 + p.x * 0.01, r = 0.12 + (i % 3) * 0.08;
          ball(k, 'leaf', BULB[(i + Math.round(p.x)) % BULB.length], X + Math.cos(a) * r, 0.08, Z + Math.sin(a) * r * 0.6, 0.06);
        }
        break;
      }
      default: break;
    }
  }
  // wires the building builders collected (tent pennants, shop beams) → garland spans
  const garlands: THREE.Vector3[][] = [];
  for (let j = 0; j + 5 < k.wires.length; j += 6) garlands.push([new THREE.Vector3(k.wires[j], k.wires[j + 1], k.wires[j + 2]), new THREE.Vector3(k.wires[j + 3], k.wires[j + 4], k.wires[j + 5])]);
  return { garlands, lampHeads };
}

/** Behind the back row: a belt of trees and far conifers (instead of the city's second row of houses); the hills ring
 *  stays the style's backdrop (terrain.ts buildBackdrop's far part is skipped in a village). */
export function villageBackdrop(k: Ctx, L: CityLayout): void {
  const W = toX(L.W), zEnd = toZ(L.area.y1) + 0.8;
  let s = 91;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let X = -4; X < W + 4; X += 1.8 + rnd() * 1.6) k.inst.add(VK.tree, X, 0, -7 - rnd() * 6, rnd() * 6, 1.2 + rnd() * 0.8);
  for (let X = -4; X < W + 4; X += 2.4 + rnd() * 2) k.inst.add(VK.tree, X, 0, zEnd + 3 + rnd() * 5, rnd() * 6, 1.0 + rnd() * 0.7);
}
