/**
 * Cave surfaces with real form (visual uplift round 2): continuous rock faces and a lumpy ceiling instead of flat boxes
 * and rows of upright «pillar» lumps. A face is a grid displaced by fractal value noise (deep recesses, bulging ribs,
 * a talus that leans out at the foot), flat-shaded, with vertex colours that carry the depth palette's strata (tilted
 * bands of the layer's rock tones, wavy with the noise), darker recesses (cheap baked occlusion) and a cooler, darker
 * top fading into the ceiling. World-space geometry with its own colours → RoomKit.geo(…, col = null): no draw calls.
 * Quality: q0 coarse (≈1.1 m cells), q1 ≈0.75 m, q2+ ≈0.5 m.
 */
import * as THREE from 'three';

function h3(x: number, y: number, z: number): number { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }
/** 3D value noise, 0..1. */
export function vnoise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => h3(xi + dx, yi + dy, zi + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
/** Fractal noise (3 octaves, ridged in the last), −0.5..0.5-ish. */
export function fbm3(x: number, y: number, z: number): number {
  let v = 0, a = 0.55, f = 1;
  for (let o = 0; o < 3; o++) { const n = vnoise3(x * f + o * 17.3, y * f + o * 5.1, z * f + o * 9.7); v += a * (o === 2 ? 1 - Math.abs(n * 2 - 1) - 0.5 : n - 0.5); a *= 0.5; f *= 2.1; }
  return v;
}

export interface Strata { cols: string[]; top: string; dark: string }
const _a = new THREE.Color(), _b = new THREE.Color();

/**
 * Strata colour of a point, with recess darkening k (0..1) and the height fade to `top`. The bands are broken up so no
 * wall repeats: their dip and thickness drift along the wall (low-frequency noise), vertical faults shift them by a band
 * or two, they fade into mottled rock in patches, and mineral stains (rust, pale calcite streaks running down) sit on top.
 */
function strataCol(S: Strata, x: number, y: number, z: number, recess: number, h: number, out: THREE.Color): THREE.Color {
  const wob = fbm3(x * 0.25, y * 0.4, z * 0.25) * 1.6;
  const reg = vnoise3(x * 0.07 + 3.1, 0.5, z * 0.07);          // slow drift along the wall: dip and band thickness
  const freq = 1.0 + reg * 1.5, dip = (reg - 0.5) * 0.7;
  // faults: where a coarse noise steps, the bands jump by one or two (vertical breaks every few metres)
  const fz = Math.floor(vnoise3(x * 0.22 + 7.7, 1.3, z * 0.22) * 4.2);
  const b = (y * freq + x * (0.18 + dip) - z * (0.11 - dip * 0.6) + wob) * 0.9 + fz * 1.37;
  const i = Math.floor(b), t = b - i, n = S.cols.length;
  const c0 = S.cols[((i % n) + n) % n], c1 = S.cols[(((i + 1) % n) + n) % n];
  out.set(c0).lerp(_a.set(c1), Math.max(0, (t - 0.7) / 0.3) * 0.85);   // crisp band edges
  // patches where the bedding is massive: the bands melt into one mottled tone
  const mass = Math.max(0, Math.min(1, (vnoise3(x * 0.12 + 1.9, y * 0.1, z * 0.12) - 0.55) * 4));
  if (mass > 0) out.lerp(_a.set(S.cols[(Math.abs(fz) + 2) % n]), mass * 0.75);
  // grain: speckle per point (reads as rock texture between the texture's own detail)
  out.multiplyScalar(0.86 + h3(x * 3.1, y * 3.7, z * 2.9) * 0.24);
  // mineral stains: rusty blooms and pale calcite streaks that run down from a source (stretched vertically)
  const st = vnoise3(x * 0.6 + 11, y * 0.12, z * 0.6);
  if (st > 0.72) out.lerp(_a.set('#8a5634'), Math.min(0.45, (st - 0.72) * 2.4));
  else if (st < 0.16) out.lerp(_a.set('#c9c2b0'), Math.min(0.32, (0.16 - st) * 2.6));
  // recesses darker, protrusions lighter; the top darkens / cools into the ceiling
  out.multiplyScalar(1.08 - recess * 0.7);
  const up = Math.max(0, Math.min(1, (y - h * 0.55) / (h * 0.45)));
  out.lerp(_b.set(S.top), up * 0.4);
  return out;
}

/**
 * A rock face along the base line (ax, az) → (bx, bz), h high, facing the room along the unit normal (nx, nz).
 * `amp` = relief depth (m); the foot leans out by `talus` (m). Returns non-indexed, flat-shaded geometry with colours.
 */
export function rockFace(o: { ax: number; az: number; bx: number; bz: number; h: number; nx: number; nz: number; amp: number; talus?: number; cell: number; seed: number; strata: Strata; y0?: number }): THREE.BufferGeometry {
  const L = Math.hypot(o.bx - o.ax, o.bz - o.az), nu = Math.max(2, Math.ceil(L / o.cell)), nv = Math.max(2, Math.ceil(o.h / (o.cell * 0.9)));
  const tx = (o.bx - o.ax) / L, tz = (o.bz - o.az) / L, y0 = o.y0 ?? -0.1, talus = o.talus ?? 0.5;
  const P = new Float32Array((nu + 1) * (nv + 1) * 3), R = new Float32Array((nu + 1) * (nv + 1));
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = (i / nu) * L, y = y0 + (j / nv) * (o.h - y0);
    let bx = o.ax + tx * u, bz = o.az + tz * u;
    // jitter along the face (breaks the grid), bigger relief low down, the foot leaning out, an overhang near the top
    const jit = (h3(i, j, o.seed) - 0.5) * o.cell * 0.5;
    bx += tx * jit; bz += tz * jit;
    const f = fbm3(bx * 0.42 + o.seed, y * 0.55, bz * 0.42), f2 = fbm3(bx * 1.3, y * 1.4 + o.seed, bz * 1.3);
    const yn = (y - y0) / (o.h - y0);
    const foot = talus * Math.pow(Math.max(0, 1 - yn / 0.28), 2);
    const top = 0.35 * Math.pow(Math.max(0, (yn - 0.75) / 0.25), 2);
    // the relief changes character along the wall: smooth slabs, craggy stretches, and stepped ledges (bedding planes
    // that stick out as flat shelves) — no two metres of wall alike
    const zone = vnoise3(bx * 0.11 + o.seed * 0.3, 2.2, bz * 0.11);
    const ampK = 0.55 + zone * 1.1;
    let rel = f * 2.2 + f2 * 0.7 * (0.4 + zone);
    const led = vnoise3(bx * 0.09 + 5.5, o.seed * 0.17, bz * 0.09);
    if (led > 0.55) { const q = Math.round(rel * 3 + y * 0.8) / 3 - y * 0.8 / 3; rel += (q - rel) * Math.min(1, (led - 0.55) * 5); }
    const d = rel * o.amp * ampK + foot + top;   // + = into the room
    const k = (j * (nu + 1) + i) * 3;
    P[k] = bx + o.nx * d; P[k + 1] = y + (h3(i + 7, j, o.seed) - 0.5) * o.cell * 0.25 * (j > 0 && j < nv ? 1 : 0); P[k + 2] = bz + o.nz * d;
    R[j * (nu + 1) + i] = Math.max(0, Math.min(1, 0.5 - rel * 1.6 + Math.max(0, 1 - yn / 0.12) * 0.25));   // + a dark wall foot
  }
  const g = orient(gridGeo(P, R, nu, nv, o.strata, o.h, false), o.nx, 0, o.nz);
  // baked grazing key light (along the face, from above): the relief reads whatever the scene's lights do
  return bakeKey(g, new THREE.Vector3(o.nx * 0.35 + tx * 0.75, 0.6, o.nz * 0.35 + tz * 0.75).normalize(), 0.62, 0.75);
}

/** Multiply the vertex colours per face by (base + k·max(0, n·L)) — flat-shaded geometry, one normal per triangle. */
export function bakeKey(g: THREE.BufferGeometry, L: THREE.Vector3, base: number, k: number): THREE.BufferGeometry {
  const n = g.attributes.normal as THREE.BufferAttribute, c = g.attributes.color as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i += 3) {
    const nx = n.getX(i) + n.getX(i + 1) + n.getX(i + 2), ny = n.getY(i) + n.getY(i + 1) + n.getY(i + 2), nz = n.getZ(i) + n.getZ(i + 1) + n.getZ(i + 2);
    const len = Math.hypot(nx, ny, nz) || 1, d = Math.max(0, (nx * L.x + ny * L.y + nz * L.z) / len);
    const f = base + k * d;
    for (let j = 0; j < 3; j++) c.setXYZ(i + j, c.getX(i + j) * f, c.getY(i + j) * f, c.getZ(i + j) * f);
  }
  return g;
}

/** Lumpy cave ceiling over [x0,x1]×[z0,z1] at height y (hanging down by up to `amp`), facing down. */
export function rockCeiling(o: { x0: number; x1: number; z0: number; z1: number; y: number; amp: number; cell: number; seed: number; strata: Strata }): THREE.BufferGeometry {
  const nu = Math.max(2, Math.ceil((o.x1 - o.x0) / o.cell)), nv = Math.max(2, Math.ceil((o.z1 - o.z0) / o.cell));
  const P = new Float32Array((nu + 1) * (nv + 1) * 3), R = new Float32Array((nu + 1) * (nv + 1));
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const x = o.x0 + (i / nu) * (o.x1 - o.x0) + (h3(i, j, o.seed) - 0.5) * o.cell * 0.3, z = o.z0 + (j / nv) * (o.z1 - o.z0) + (h3(j, i, o.seed) - 0.5) * o.cell * 0.3;
    const f = fbm3(x * 0.3 + o.seed, 3.3, z * 0.3), f2 = fbm3(x * 1.1, 7.7 + o.seed, z * 1.1);
    // + rock ribs (ridged noise stretched across the cave) and hanging masses where a coarse noise peaks
    const rib = 1 - Math.abs(vnoise3(x * 0.55 + o.seed * 0.1, 1.1, z * 0.16) * 2 - 1), mass = Math.max(0, vnoise3(x * 0.16, 4.4 + o.seed * 0.07, z * 0.16) - 0.6) * 3.2;
    const d = Math.max(-0.2, (f * 2.0 + f2 * 0.6 + Math.pow(rib, 4) * 0.5 + mass * mass)) * o.amp;
    const k = (j * (nu + 1) + i) * 3;
    P[k] = x; P[k + 1] = o.y - Math.max(0, d) - 0.05; P[k + 2] = z;
    R[j * (nu + 1) + i] = Math.max(0, Math.min(1, 0.55 - d / o.amp));
  }
  return orient(gridGeo(P, R, nu, nv, o.strata, o.y, true), 0, -1, 0);
}

function gridGeo(P: Float32Array, R: Float32Array, nu: number, nv: number, S: Strata, h: number, down: boolean): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], c = new THREE.Color();
  const v = (i: number, j: number) => j * (nu + 1) + i;
  const push = (a: number, b: number, d: number) => {
    const cx = (P[a * 3] + P[b * 3] + P[d * 3]) / 3, cy = (P[a * 3 + 1] + P[b * 3 + 1] + P[d * 3 + 1]) / 3, cz = (P[a * 3 + 2] + P[b * 3 + 2] + P[d * 3 + 2]) / 3;
    const r = (R[a] + R[b] + R[d]) / 3;
    if (down) { c.set(S.top).lerp(_a.set(S.cols[Math.floor(vnoise3(cx * 0.2, 2.2, cz * 0.2) * 2.99) % S.cols.length]), 0.32).multiplyScalar((0.86 + h3(cx * 2, cy, cz * 2) * 0.28) * (1.18 - r * 0.85)); }
    else strataCol(S, cx, cy, cz, r, h, c);
    for (const q of [a, b, d]) { pos.push(P[q * 3], P[q * 3 + 1], P[q * 3 + 2]); col.push(c.r, c.g, c.b); }
  };
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = v(i, j), b = v(i + 1, j), d = v(i, j + 1), e = v(i + 1, j + 1);
    // alternate the diagonal (no visible grid direction)
    if ((i + j) % 2) { push(a, b, e); push(a, e, d); } else { push(a, b, d); push(b, e, d); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Make the face visible from the side its normal says (flip the winding when the computed normals point away). */
export function orient(g: THREE.BufferGeometry, nx: number, ny: number, nz: number): THREE.BufferGeometry {
  const n = g.attributes.normal as THREE.BufferAttribute;
  let s = 0; for (let i = 0; i < n.count; i++) s += n.getX(i) * nx + n.getY(i) * ny + n.getZ(i) * nz;
  if (s >= 0) return g;
  const p = g.attributes.position as THREE.BufferAttribute, c = g.attributes.color as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 3) for (const a of [p, c]) {
    const x = a.getX(i + 1), y = a.getY(i + 1), z = a.getZ(i + 1);
    a.setXYZ(i + 1, a.getX(i + 2), a.getY(i + 2), a.getZ(i + 2)); a.setXYZ(i + 2, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

/** Strata of a mine palette: the layer's rock tones (dimmed: they are walls in the shadow) + its wall colours. */
export function strataOf(P: { rock: [string, string, string]; hard: [string, string, string]; wall: string; wallL: string }): Strata {
  const dim = (c: string, k: number) => '#' + new THREE.Color(c).multiplyScalar(k).getHexString();
  const warm = (c: string, k: number) => '#' + new THREE.Color(c).lerp(new THREE.Color('#7a5a40'), 0.22).multiplyScalar(k).getHexString();
  return { cols: [warm(P.rock[1], 0.72), warm(P.wall, 1), warm(P.rock[0], 0.8), warm(P.wallL, 1), warm(P.hard[0], 0.78), warm(P.wall, 1.25), warm(P.rock[2], 0.95), warm(P.wallL, 1)], top: dim(P.wall, 0.85), dark: dim(P.wall, 0.5) };
}

/** String hash (FNV-1a) → 0..1. The mine's look is a pure function of (channel, floor seed, floor n). */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000003) / 1000003;
}
/** The streamer's channel from the site's LG_BASE ("…/c/<channel>"), lower-case; '' when not on a channel page. */
export function channelOfBase(base: string): string {
  const m = /\/c\/([^/?#]+)/.exec(base || '');
  return m ? decodeURIComponent(m[1]).toLowerCase() : '';
}

/** Amplitude (m) of the walkable ground relief of the mine floors (q1+): swells and hollows the player walks over. */
export const RELIEF = 0.2;

export interface FloorOpts {
  x0: number; x1: number; z0: number; z1: number; cell: number; seed: number;
  floor: string; floorL: string; dark: string;
  /** Can the player stand here (then the relief stays within ±2.5 cm of y = 0: the feet never float or sink). */
  walk: (x: number, z: number) => boolean;
  /** 0..1: how worn the ground is here (paths are lighter and smoother). */
  worn: (x: number, z: number) => number;
  /** Distance to the nearest wall foot (m): scree heaps up there where nobody walks. */
  wallDist: (x: number, z: number) => number;
  /** Rut lines (cart tracks): [x0, z0, x1, z1] segments; ground darkens and dips 3 cm along them. */
  ruts?: number[];
  /** Track beds: [x0, z0, x1, z1] segments; the walking relief is levelled within ~0.6 m and the ground there is greyer
   *  ballast. */
  beds?: number[];
  /** Amplitude (m) of the smooth walkable relief the player walks on (groundHeight); 0 = flat ground. */
  relief?: number;
  /** 0..1 multiplier of that relief (0 = flattened: round the objects, the spawn, plank floors). */
  reliefK?: (x: number, z: number) => number;
  /** Keep loose stones off here (the hall objects' spots, rails, plank floors); default: nowhere. */
  clear?: (x: number, z: number) => boolean;
  /** Set by rockFloor: the height of the BUILT floor mesh at (x, z) (bilinear over its grid) — dressing sits on this. */
  meshY?: (x: number, z: number) => number;
}

/**
 * The smooth walkable relief (what the player stands on): swells and hollows of a few metres, ±relief (C1-smooth:
 * smoothstep-interpolated value noise through tanh — no kinks to stumble on), flattened where reliefK says. The floor
 * marks that lie on it (halos, the dig ring) follow it through the scene's ground texture.
 */
export function groundHeight(o: FloorOpts, x: number, z: number): number {
  if (!o.relief) return 0;
  let k = o.reliefK ? o.reliefK(x, z) : 1; if (k <= 0) return 0;
  if (o.beds) for (let b = 0; b < o.beds.length; b += 4) { const d = segD(x, z, o.beds[b], o.beds[b + 1], o.beds[b + 2], o.beds[b + 3]); if (d < 1.4) { const t = Math.max(0, (d - 0.45) / 0.95); k *= 0.45 + 0.55 * t * t * (3 - 2 * t); } }
  const n = vnoise3(x * 0.23 + o.seed * 0.37, 9.1, z * 0.23) * 0.45 + vnoise3(x * 0.56, 2.3 + o.seed * 0.11, z * 0.56) * 0.43 + vnoise3(x * 1.1 + 3.3, 6.7, z * 1.1 + o.seed * 0.05) * 0.12;
  return o.relief * k * Math.tanh((n - 0.5) * 5);
}

/** Distance from (x,z) to the segment. */
function segD(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

/** Height of the procedural floor at (x, z) (the walkable part stays within ±2.5 cm of 0). */
export function floorHeight(o: FloorOpts, x: number, z: number): number {
  const n = fbm3(x * 0.55 + o.seed, 1.7, z * 0.55), n2 = fbm3(x * 2.3, 4.1 + o.seed, z * 2.3);
  let rut = 0;
  if (o.ruts) for (let k = 0; k < o.ruts.length; k += 4) { const d = segD(x, z, o.ruts[k], o.ruts[k + 1], o.ruts[k + 2], o.ruts[k + 3]); rut = Math.max(rut, 1 - Math.min(1, d / 0.09)); }
  const g = groundHeight(o, x, z);
  if (o.walk(x, z)) return g + Math.max(-0.02, Math.min(0.01, n * 0.04 + n2 * 0.02 * (1 - o.worn(x, z)))) - rut * 0.03;
  // off the walkway: rubble ground, and scree heaped up against the wall feet in lumpy mounds
  const wd = o.wallDist(x, z), scree = Math.max(0, 1 - wd / 1.6), mound = 0.6 + vnoise3(x * 0.55 + o.seed, 5.5, z * 0.55) * 0.9;
  return g + Math.max(0, n * 0.14 + 0.03) + scree * scree * (0.3 + n2 * 0.4) * mound;
}

/** The cave floor: a grid displaced by floorHeight, vertex colours with wear, ruts, grime towards the walls, speckle. */
export function rockFloor(o: FloorOpts): THREE.BufferGeometry {
  const nu = Math.max(2, Math.ceil((o.x1 - o.x0) / o.cell)), nv = Math.max(2, Math.ceil((o.z1 - o.z0) / o.cell));
  const P = new Float32Array((nu + 1) * (nv + 1) * 3);
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const edge = i === 0 || j === 0 || i === nu || j === nv;
    const x = o.x0 + (i / nu) * (o.x1 - o.x0) + (edge ? 0 : (h3(i, j, o.seed) - 0.5) * o.cell * 0.3);
    const z = o.z0 + (j / nv) * (o.z1 - o.z0) + (edge ? 0 : (h3(j, i, o.seed + 1) - 0.5) * o.cell * 0.3);
    const k = (j * (nu + 1) + i) * 3; P[k] = x; P[k + 1] = floorHeight(o, x, z); P[k + 2] = z;
  }
  // smooth ground: an indexed grid with per-vertex colours and normals (no faceting on the floor you walk on)
  const col = new Float32Array((nu + 1) * (nv + 1) * 3), c = new THREE.Color(), cf = new THREE.Color(o.floor), cl = new THREE.Color(o.floorL), cd = new THREE.Color(o.dark);
  const cg = new THREE.Color(o.floor).lerp(_b.set(o.dark), 0.25).offsetHSL(0, -0.04, 0);   // gravel patches: greyer, darker
  const Y = (i: number, j: number) => P[(Math.max(0, Math.min(nv, j)) * (nu + 1) + Math.max(0, Math.min(nu, i))) * 3 + 1];
  for (let q = 0; q < (nu + 1) * (nv + 1); q++) {
    const x = P[q * 3], y = P[q * 3 + 1], z = P[q * 3 + 2], gi = q % (nu + 1), gj = Math.floor(q / (nu + 1));
    const w = o.worn(x, z), patch = vnoise3(x * 0.35 + o.seed, 0.5, z * 0.35);
    c.copy(cf).lerp(cl, Math.max(0, Math.min(1, patch * 1.1 - 0.15 + w * 0.5)));
    // big two-tone patches (packed dirt ↔ loose gravel) — the floor never reads as one flat colour
    const gp = vnoise3(x * 0.16 + 4.4, o.seed * 0.21, z * 0.16);
    if (gp > 0.5) c.lerp(cg, Math.min(0.7, (gp - 0.5) * 3) * (1 - w * 0.6));
    let rut = 0, bed = 0;
    if (o.ruts) for (let k = 0; k < o.ruts.length; k += 4) rut = Math.max(rut, 1 - Math.min(1, segD(x, z, o.ruts[k], o.ruts[k + 1], o.ruts[k + 2], o.ruts[k + 3]) / 0.12));
    if (o.beds) for (let k = 0; k < o.beds.length; k += 4) bed = Math.max(bed, 1 - Math.min(1, Math.max(0, segD(x, z, o.beds[k], o.beds[k + 1], o.beds[k + 2], o.beds[k + 3]) - 0.45) / 0.3));
    c.lerp(cd, rut * 0.55 + Math.max(0, 1 - o.wallDist(x, z) / 2.2) * 0.35);
    if (bed > 0) c.lerp(cg, bed * 0.6).multiplyScalar(1 - bed * 0.12);
    const g = groundHeight(o, x, z), dy = y - g;
    if (dy > 0.06) c.lerp(_a.set(o.floorL), Math.min(0.45, dy));   // scree catches the light
    // hairline cracks: thin dark lines where a ridged noise peaks
    const cr = 1 - Math.abs(vnoise3(x * 0.9 + o.seed, 6.6, z * 0.9) * 2 - 1);
    if (cr > 0.93) c.lerp(cd, (cr - 0.93) / 0.07 * 0.5);
    // damp hollows: the low parts of the walking relief are darker and a touch cooler (water gathers there)
    if (g < -0.05 && o.relief) c.lerp(cd, Math.min(0.45, (-g - 0.05) / o.relief * 0.8));
    // baked light: a low key from one side over the slope (exaggerated ×6) + cavity occlusion (the grid's Laplacian:
    // hollows and the foot of every mound darker, crests brighter) + a finer shading-only bump field — the relief
    // reads from eye height, whatever the lamps do
    const sx = (Y(gi + 1, gj) - Y(gi - 1, gj)) / (2 * o.cell), sz = (Y(gi, gj + 1) - Y(gi, gj - 1)) / (2 * o.cell);
    const sl = sx * 0.85 + sz * 0.35;
    const lap = (Y(gi + 1, gj) + Y(gi - 1, gj) + Y(gi, gj + 1) + Y(gi, gj - 1)) / 4 - y;
    const bump = (vnoise3(x * 2.2 + o.seed, 3.3, z * 2.2) - vnoise3(x * 2.2 + 0.45 + o.seed, 3.3, z * 2.2 + 0.18)) * 0.9;
    // + height tint: crests drier and lighter, hollows darker (value contrast that follows the relief)
    const ht = o.relief ? g / o.relief : 0;
    c.multiplyScalar(Math.max(0.38, Math.min(1.6, (1 + sl * 7 + bump - Math.max(-0.3, Math.min(0.55, lap * 18))) * (1 + ht * 0.22))));
    c.multiplyScalar(0.9 + h3(x * 4.1, 0.3, z * 3.7) * 0.2);
    col[q * 3] = c.r; col[q * 3 + 1] = c.g; col[q * 3 + 2] = c.b;
  }
  // what the dressing stands on: bilinear over the (slightly jittered) grid — within a few mm of the triangles
  o.meshY = (x, z) => {
    const u = Math.max(0, Math.min(nu - 1e-6, (x - o.x0) / (o.x1 - o.x0) * nu)), w = Math.max(0, Math.min(nv - 1e-6, (z - o.z0) / (o.z1 - o.z0) * nv));
    const i = Math.floor(u), j = Math.floor(w), fu = u - i, fw = w - j;
    if (x < o.x0 || x > o.x1 || z < o.z0 || z > o.z1) return floorHeight(o, x, z);
    return (Y(i, j) * (1 - fu) + Y(i + 1, j) * fu) * (1 - fw) + (Y(i, j + 1) * (1 - fu) + Y(i + 1, j + 1) * fu) * fw;
  };
  // faceted ground (the low-poly look of the rock): every triangle its own normal (its slope ×2.2: the lantern pools and
  // the lights model the swells as if they were steeper, while the ground you walk on stays within ±relief) and its own
  // shade (the mean of its corners ± a facet jitter) — the relief reads from eye height as lit and shaded facets
  const v = (i: number, j: number) => j * (nu + 1) + i;
  const nT = nu * nv * 2, pos = new Float32Array(nT * 9), nor = new Float32Array(nT * 9), cc = new Float32Array(nT * 9);
  let t = 0;
  const face = (a: number, b: number, d: number) => {
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[b * 3] - ax, by = P[b * 3 + 1] - ay, bz = P[b * 3 + 2] - az, dx = P[d * 3] - ax, dy = P[d * 3 + 1] - ay, dz = P[d * 3 + 2] - az;
    let nx = by * dz - bz * dy, ny = bz * dx - bx * dz, nz = bx * dy - by * dx;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; [b, d] = [d, b]; }
    nx *= 1.9; nz *= 1.9; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const k = 0.96 + h3(ax * 3.1 + bx, az * 2.7, dz * 5.3 + ay) * 0.08;
    const r = (col[a * 3] + col[b * 3] + col[d * 3]) / 3 * k, gg = (col[a * 3 + 1] + col[b * 3 + 1] + col[d * 3 + 1]) / 3 * k, bb = (col[a * 3 + 2] + col[b * 3 + 2] + col[d * 3 + 2]) / 3 * k;
    for (const q of [a, b, d]) {
      pos[t] = P[q * 3]; pos[t + 1] = P[q * 3 + 1]; pos[t + 2] = P[q * 3 + 2];
      nor[t] = nx; nor[t + 1] = ny; nor[t + 2] = nz;
      // a little of the corner's own colour keeps the patches soft across facets
      cc[t] = r * 0.5 + col[q * 3] * 0.5; cc[t + 1] = gg * 0.5 + col[q * 3 + 1] * 0.5; cc[t + 2] = bb * 0.5 + col[q * 3 + 2] * 0.5;
      t += 3;
    }
  };
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = v(i, j), b = v(i + 1, j), d = v(i, j + 1), e = v(i + 1, j + 1);
    if ((i + j) % 2) { face(a, d, e); face(a, e, b); } else { face(a, d, b); face(b, d, e); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  return g;
}


/** A cobweb in a corner: radial threads from the corner point along two directions + three sagging rings (thin boxes). */
export function cobweb(add: (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rx: number, ry: number, rz: number) => void, x: number, y: number, z: number, ax: THREE.Vector3, ay: THREE.Vector3, r: number): void {
  const pt = (a: number, d: number) => new THREE.Vector3(x, y, z).addScaledVector(ax, Math.cos(a) * d).addScaledVector(ay, Math.sin(a) * d);
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), e = new THREE.Euler();
  const seg = (p: THREE.Vector3, p2: THREE.Vector3) => {
    const m = p.clone().add(p2).multiplyScalar(0.5), d = p2.clone().sub(p), L = d.length();
    q.setFromUnitVectors(up, d.normalize()); e.setFromQuaternion(q);
    add(m.x, m.y, m.z, 0.006, L, 0.006, e.x, e.y, e.z);
  };
  for (let k = 0; k <= 4; k++) seg(pt(0, 0), pt(k / 4 * Math.PI / 2, r));
  for (const f of [0.35, 0.6, 0.85]) for (let k = 0; k < 4; k++) seg(pt(k / 4 * Math.PI / 2, r * f), pt((k + 1) / 4 * Math.PI / 2, r * f * 0.97));
}
/** Seeded hash 0..1 of (i, k, seed) — the cave dressing's only randomness. */
export function h01(i: number, k: number, seed: number): number { return h3(i * 1.37 + seed * 0.11, k * 2.17, seed * 0.73 + i * 0.05); }
