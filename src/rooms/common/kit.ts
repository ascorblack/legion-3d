/**
 * Room building kit: static geometry goes into one world Batch (merged per material → ~10 draw calls for the whole
 * interior), prop-kit parts are baked into the same batch, collision is a list of axis-aligned solids, lights are a
 * handful of real PointLights (interiors are small) plus additive glow points.
 *
 * Room space (metres): X right, Y up, Z towards the entrance. The entrance wall is at z = +D/2, the player spawns
 * just inside it and looks to −Z (Walker.face = 0).
 */
import * as THREE from 'three';
import { Batch, GEO, M, type MatKey } from '../../world/batch';
import { SignAtlas, glowTexture } from '../../world/textures';
import { glowPoints } from '../../world/sky';
import { getTexture } from '../../world/tex';
import { surfaceDetail, surfaceUniforms, type SurfaceOpts, type SurfaceUniforms } from '../../world/tex/surface';
import { PropKit, type PropKind } from '../../world/props';
import type { Pal } from '../../world/palette';
import { shade, type Ctx as WorldKitCtx } from '../../world/kit';
import { plankFloor, ceilingDetail, bevel as bevelBox } from './detail';
import type { Shaft } from './atmos';

export interface Solid { x0: number; x1: number; z0: number; z1: number; top: number }

/** The rooms' / the mine's own surface-shader uniforms: the floor is at y = 0, no lower street (one set for all rooms). */
let roomSd: SurfaceUniforms | null = null;
export function roomSurfaceUniforms(): SurfaceUniforms { return (roomSd ||= surfaceUniforms({ lowH: 0, dirt: '#4a3a2e', moss: '#56643a' })); }
/** Surface detail (world/tex/surface.ts: macro variation, per-tile tone, anti-tiling, grime from the floor) on a room
 *  material — q1+ only (q0 keeps the plain material); `t` = the texture set the material was made from. */
export function roomSurface(m: THREE.Material, t: { ids?: boolean; organic?: boolean } | null, o: SurfaceOpts, quality: number): void {
  if (quality < 1) return;
  surfaceDetail(m, { ...o, ids: t && t.ids ? o.ids : 0, antiTile: !!(t && t.organic) && o.antiTile !== false, uniforms: roomSurfaceUniforms() });
}

/** Materials of a room (own instances; textures are the shared tex cache — never dispose them). q1+: surface detail. */
export function makeRoomMats(pal: Pal, signs: SignAtlas, quality = 2): Record<MatKey, THREE.Material> & { rock: THREE.Material } {
  const std = (kind: Parameters<typeof getTexture>[0], o: { rough?: number; ns?: number; colors?: string[]; neutral?: boolean; seed?: number; side?: THREE.Side; size?: number; sd?: SurfaceOpts } = {}) => {
    const t = getTexture(kind, { neutral: o.neutral ?? true, colors: o.colors, seed: o.seed, size: o.size });
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true, map: t.map, normalMap: t.normalMap ?? null, roughnessMap: t.roughnessMap ?? null,
      roughness: o.rough ?? 0.9, metalness: 0, side: o.side ?? THREE.FrontSide,
    });
    if (t.normalMap) m.normalScale.setScalar(o.ns ?? 0.8);
    if (o.sd) roomSurface(m, t, o.sd, quality);
    return m;
  };
  // indoors: grime rising from the floor, little moss, per-tile tone where the texture carries element ids
  const wall: SurfaceOpts = { macro: 0.14, hue: 0.08, ids: 0.14, dirt: 0.45, dirtH: 1.0, moss: 0.06 };
  const emit = new THREE.MeshBasicMaterial({ vertexColors: true });
  emit.color.setScalar(1.6);
  const signMat = new THREE.MeshStandardMaterial({ map: signs.texture, emissiveMap: signs.texture, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.5, roughness: 0.7, alphaTest: 0.5 });
  const plain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const mats: Record<MatKey, THREE.Material> & { rock: THREE.Material } = {
    rock: std('canvas', { colors: ['#ffffff', '#f2f2f2'], rough: 0.95, ns: 0.4, sd: { macro: 0.1, hue: 0.08, dirt: 0.4, dirtH: 0.6 } }),   // ONE_SIDED: canvas seen from inside only
    brick: std('brick', { rough: 0.95, sd: wall }),
    plaster: std('plaster', { rough: 0.95, ns: 0.5, sd: { ...wall, dirt: 0.5, dirtH: 1.1 } }),
    wood: std('wood', { rough: 0.8, ns: 0.6, sd: { macro: 0.1, hue: 0.06, ids: 0.14, dirt: 0.4, dirtH: 0.7 } }),
    roof: std('slate', { rough: 0.9, ns: 1.0, sd: { macro: 0.14, hue: 0.08, ids: 0.16 } }),
    stone: std('stone', { rough: 0.95, sd: { ...wall, moss: 0.1 } }),
    metal: Object.assign(std('metal', { rough: 0.55, ns: 0.4, sd: { macro: 0.06, hue: 0.04, dirt: 0.2, dirtH: 0.5, roughVar: 0.3 } }), { metalness: 0.4 }),
    canvas: std('canvas', { colors: ['#ffffff', '#f2f2f2'], rough: 0.95, ns: 0.4, side: THREE.DoubleSide, sd: { macro: 0.1, hue: 0.08, dirt: 0.4, dirtH: 0.6 } }),
    paving: std('cobble', { neutral: false, colors: [pal.ground, pal.groundL, pal.mortar, pal.groundL], rough: 1, ns: 0.7, size: 512, sd: { macro: 0.16, hue: 0.1, ids: 0.14, roughVar: 0.15 } }),
    lowPaving: std('stone', { rough: 0.95, seed: 9, sd: { macro: 0.16, hue: 0.1, ids: 0.14, roughVar: 0.15 } }),
    leaf: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
    flat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }),
    dark: new THREE.MeshBasicMaterial({ color: '#100d17' }),
    glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.35, depthWrite: false }),
    // 'back' = painted details / decals (prop paint: the dummy's target on its burlap chest): pulled forward in depth
    // like the city's decals, so a painted layer never flickers against the surface it is painted on
    back: Object.assign(plain, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    emit, glow: emit, sign: signMat,
    water: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 0.2 }),
  };
  for (const [k, m] of Object.entries(mats)) m.name = 'room:' + k;
  return mats;
}

/** Material key for a closed solid: double-sided canvas → its one-sided twin (same texture). */
const DISC32 = new THREE.CylinderGeometry(0.5, 0.5, 1, 32, 1);
const solidKey = (m: MatKey): MatKey | typeof ONE_SIDED => (m === 'canvas' ? ONE_SIDED : m);

/** The room batch reuses the city's 'rock' key for one-sided (FrontSide) canvas: tent walls seen from inside only. */
export const ONE_SIDED = 'rock' as const;

/** Flip a non-indexed geometry inside out (normals and winding) — e.g. a cylinder wall seen from inside only. */
export function inward(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(ng.attributes)) {
    const a = ng.attributes[k] as THREE.BufferAttribute, n = a.itemSize, arr = a.array as Float32Array;
    for (let f = 0; f + 2 < a.count; f += 3) for (let c = 0; c < n; c++) { const i1 = (f + 1) * n + c, i2 = (f + 2) * n + c; const t = arr[i1]; arr[i1] = arr[i2]; arr[i2] = t; }
  }
  const nor = ng.attributes.normal as THREE.BufferAttribute | undefined;
  if (nor) for (let i = 0; i < nor.count; i++) nor.setXYZ(i, -nor.getX(i), -nor.getY(i), -nor.getZ(i));
  return ng;
}

/** Prop-kit material part → room batch material. */
const PROP_MAT: Record<string, MatKey | null> = { paint: 'back', wood: 'wood', stone: 'stone', metal: 'metal', cloth: 'canvas', roof: 'roof', glow: 'emit', water: 'water', waterFx: null, outline: null };

const _v = new THREE.Vector3();

export interface RoomShellOpts {
  /** Interior width (X), depth (Z), wall height. */
  w: number; d: number; h: number;
  wall?: MatKey; wallCol?: string; wainscot?: string;
  floor?: MatKey; floorCol?: string;
  ceiling?: 'beams' | 'flat' | 'none';
  ceilCol?: string;
  /** Door gap on the entrance wall (x centre, width, height). */
  door?: { x: number; w: number; h: number };
  /** One-sided entrance wall + vestibule for the TP camera (default true). */
  cutaway?: boolean;
}

/** The entrance door's leaves (RoomKit.exitDoor): set(t) swings them out (0 closed, 1 open ≈ 95°). */
export class RoomDoor {
  readonly leaves: { pivot: THREE.Group; sign: -1 | 1 }[] = [];
  private t = 0;
  get open(): number { return this.t; }
  set(t: number): void {
    this.t = t < 0 ? 0 : t > 1 ? 1 : t;
    // outward (into the street, +Z): the leaf on the left (hinge at −x, sign −1) turns by −angle around Y
    const a = this.t * 1.65;
    for (const l of this.leaves) l.pivot.rotation.y = l.sign < 0 ? -a : a;
  }
}

/** Metres of room behind the cutaway entrance wall (TP arm 3.2 m + margin). */
export const VESTIBULE = 3.2;

export class RoomKit {
  readonly root = new THREE.Group();
  // one chunk: a room is small (the city's 15 m chunks — and a split at x = 0 — only doubled the draw calls)
  readonly b = new Batch(Infinity);
  readonly signs: SignAtlas;
  readonly mats: Record<MatKey, THREE.Material> & { rock: THREE.Material };
  readonly solids: Solid[] = [];
  /** Glow points: x y z size r g b. */
  readonly glows: number[] = [];
  /** Camera collider boxes: x0 x1 y0 y1 z0 z1. */
  readonly camBoxes: number[] = [];
  readonly lights: THREE.PointLight[] = [];
  /** Things to dispose with the room (own geometries / materials / textures). */
  readonly owned: { dispose(): void }[] = [];
  /** Walkable rectangle (inner floor). */
  bounds = { x0: -3, x1: 3, z0: -3, z1: 3 };
  /** Extra walkable rectangles (doorway nook etc.). */
  readonly extra: { x0: number; x1: number; z0: number; z1: number }[] = [];
  /** Player radius used by free(). */
  pad = 0.28;
  /** Round room (tent): walkable disc instead of the bounds rectangle. */
  circle: { x: number; z: number; r: number } | null = null;
  /** World AABBs (x0 y0 z0 x1 y1 z1) of every piece baked so far (q1+). */
  readonly occRaw: number[] = [];
  /** occRaw index where the room's own things start (after the shell). */
  occFrom = 0;
  /** z of the shell's ceiling beams. */
  beams: number[] = [];
  /** Extra AO occluders that are not collision solids (props baked with solid:false): x0 x1 z0 z1 top. */
  readonly aoExtra: number[] = [];
  /** Raised floor areas: [x0,x1,z0,z1,y]. */
  readonly floors: [number, number, number, number, number][] = [];
  /** World-kit compatible context (for kit.ts helpers: windowZ, doorZ, signZ, awning…). */
  readonly wk: WorldKitCtx;
  private glowTex: THREE.Texture | null = null;

  /** Test hook: every new kit's batch reports its pieces here (z-fight detector, test/rooms-zfight.test.ts). */
  static recorder: Batch['recorder'] = null;

  constructor(readonly pal: Pal, readonly quality = 2, name = 'room') {
    this.root.name = name;
    this.b.recorder = RoomKit.recorder;
    // world AABB of every piece (the automatic set dressing, dress.ts, places things only where nothing is)
    if (quality >= 1) this.b.onAdd = (_m, bx) => { this.occRaw.push(bx.min.x, bx.min.y, bx.min.z, bx.max.x, bx.max.y, bx.max.z); };
    this.signs = new SignAtlas(pal);
    this.mats = makeRoomMats(pal, this.signs, quality);
    this.owned.push(this.signs.texture);
    for (const m of new Set(Object.values(this.mats))) this.owned.push(m);
    this.wk = { b: this.b, pal, signs: this.signs, inst: null as any, glows: this.glows, lights: [], bulbs: [], wires: [], rnd: Math.random, quality, lowH: 0, wallZ: 0, colliders: this.camBoxes };
  }

  /* ------------------------------------------------------------ primitives */
  // Closed solids (box, rbox, cyl, ball) never need back faces: 'canvas' (double-sided, for open sheets) is drawn with
  // its one-sided twin, so a rug / cloth / runner lying on a surface has no visible bottom face fighting that surface.
  box(mat: MatKey, col: THREE.ColorRepresentation, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, uv: number | 'keep' = 1): void {
    this.b.add(solidKey(mat), GEO.box, M((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)), col, uv);
  }
  rbox(mat: MatKey, col: THREE.ColorRepresentation, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0): void {
    this.b.add(solidKey(mat), GEO.box, M(cx, cy, cz, sx, sy, sz, rx, ry, rz), col, 1);
  }
  cyl(mat: MatKey, col: THREE.ColorRepresentation, x: number, y0: number, z: number, r: number, h: number, seg: 8 | 12 | 16 = 12): void {
    const g = seg === 8 ? GEO.cyl8 : seg === 16 ? GEO.cyl16 : GEO.cyl12;
    this.b.add(solidKey(mat), g, M(x, y0 + h / 2, z, r * 2, h, r * 2), col, 1);
  }
  ball(mat: MatKey, col: THREE.ColorRepresentation, x: number, y: number, z: number, r: number, sy = 1): void {
    this.b.add(solidKey(mat), GEO.sphere, M(x, y, z, r * 2, r * 2 * sy, r * 2), col, 1);
  }
  cone(mat: MatKey, col: THREE.ColorRepresentation, x: number, y0: number, z: number, r: number, h: number, four = false): void {
    this.b.add(mat, four ? GEO.cone4 : GEO.cone16, M(x, y0 + h / 2, z, r * 2, h, r * 2), col, 1);
  }
  geo(mat: MatKey | typeof ONE_SIDED, g: THREE.BufferGeometry, m: THREE.Matrix4, col: THREE.ColorRepresentation | null, uv: number | 'keep' = 1): void {
    this.b.add(mat, g, m, col, uv);
  }
  /* ------------------------------------------------------------ floor decals (rugs, runners, mats) */
  /** Floor decals placed so far: x0 x1 z0 z1 top. */
  private decals: number[] = [];
  /**
   * Base height for a floor decal over [x0,x1]×[z0,z1]: 0 on bare floor, else on top of every decal it overlaps — so
   * rugs, runners and mats stack (border → field → pattern → mat) and no two of them ever share a plane (z-fighting).
   */
  decalBase(x0: number, x1: number, z0: number, z1: number): number {
    const D = this.decals, e = 1e-4;
    let y = 0;
    for (let i = 0; i < D.length; i += 5) if (x0 < D[i + 1] - e && x1 > D[i] + e && z0 < D[i + 3] - e && z1 > D[i + 2] + e && D[i + 4] > y) y = D[i + 4];
    return y;
  }
  /** Rectangular floor decal `h` thick (≥ 6 mm keeps stacked tops apart), stacked by decalBase. */
  floorBox(mat: MatKey, col: THREE.ColorRepresentation, x0: number, x1: number, z0: number, z1: number, h = 0.008): void {
    const y = this.decalBase(x0, x1, z0, z1);
    this.box(mat, col, x0, x1, y, y + h, z0, z1);
    this.decals.push(x0, x1, z0, z1, y + h);
  }
  /** Rotated square-ish floor decal (diamonds), stacked by its bounding rectangle. */
  floorRBox(mat: MatKey, col: THREE.ColorRepresentation, cx: number, cz: number, sx: number, sz: number, ry: number, h = 0.008): void {
    const c = Math.abs(Math.cos(ry)), sn = Math.abs(Math.sin(ry)), hx = (sx * c + sz * sn) / 2, hz = (sx * sn + sz * c) / 2;
    const y = this.decalBase(cx - hx, cx + hx, cz - hz, cz + hz);
    this.rbox(mat, col, cx, y + h / 2, cz, sx, h, sz, ry);
    this.decals.push(cx - hx, cx + hx, cz - hz, cz + hz, y + h);
  }
  /** Round floor decal (rug disc, training ring), stacked by its bounding square. */
  floorDisc(mat: MatKey, col: THREE.ColorRepresentation, x: number, z: number, r: number, h = 0.008): void {
    const y = this.decalBase(x - r, x + r, z - r, z + r);
    this.b.add(solidKey(mat), DISC32, M(x, y + h / 2, z, r * 2, h, r * 2), col, 1);
    this.decals.push(x - r, x + r, z - r, z + r, y + h);
  }
  glow(x: number, y: number, z: number, size: number, color: string, k = 1): void {
    const c = new THREE.Color(color);
    this.glows.push(x, y, z, size, c.r * k, c.g * k, c.b * k);
  }
  /** Max real point lights per quality (interiors are small; the rest keep only their glow + splash). */
  get lightCap(): number { return this.quality <= 0 ? 3 : this.quality === 1 ? 4 : this.quality === 2 ? 7 : 8; }
  /**
   * A point light + its glow. Lights are requests: finish() keeps the `lightCap` ones with the highest priority (ties →
   * creation order), so a hearth (prio 3) never loses its light to a decorative lantern (prio 1) at low quality.
   * Returns the light object (safe to animate even when it was not kept).
   */
  light(x: number, y: number, z: number, color = '#ffb35c', intensity = 6, dist = 9, glowSize = 0, prio = 1): THREE.PointLight {
    const l = new THREE.PointLight(color, intensity, dist, 1.6);
    l.position.set(x, y, z); l.name = 'room:light';
    this.lightReq.push({ l, prio, i: this.lightReq.length });
    if (glowSize > 0) this.glow(x, y, z, glowSize, color, 0.8);
    return l;
  }
  private readonly lightReq: { l: THREE.PointLight; prio: number; i: number }[] = [];
  /**
   * Light-pool candidates (world/lightPools.ts: x, y, z, radius, r, g, b, gain) for every requested light — call after
   * finish(): the lights it dropped (low quality) still warm their surroundings through the pools, the kept ones a little.
   */
  poolCandidates(): number[] {
    const out: number[] = [];
    for (const { l } of this.lightReq) {
      const kept = this.lights.includes(l), c = l.color;
      out.push(l.position.x, l.position.y, l.position.z, Math.max(2.5, l.distance * 0.7), c.r, c.g, c.b, kept ? 0.22 : 0.55);
    }
    return out;
  }
  /**
   * Fake light: an additive gradient quad on a surface (a lamp's pool of light on a wall, a shelf or the floor).
   * Centre (x,y,z), size w×h, facing yaw ry (0 = faces +Z) and pitch rx (−π/2 = lies on the floor facing up).
   * All splashes are one draw call; they work at every quality (no light cap).
   */
  splash(x: number, y: number, z: number, w: number, h: number, color: string, k = 1, ry = 0, rx = 0): void {
    const c = new THREE.Color(color);
    this.splashes.push(x, y, z, w, h, ry, rx, c.r * k, c.g * k, c.b * k);
  }
  readonly splashes: number[] = [];
  /** Collision solid (top = height you could stand on; Infinity = wall). Also a camera collider when tall. */
  solid(x0: number, x1: number, z0: number, z1: number, top: number, cam = top > 1.6): void {
    this.solids.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), top });
    if (cam) this.camBoxes.push(Math.min(x0, x1), Math.max(x0, x1), 0, Number.isFinite(top) ? top : 6, Math.min(z0, z1), Math.max(z0, z1));
  }
  /** Bake a prop-kit kind into the static batch (no outline, no extra draw calls). */
  prop(kind: PropKind, x: number, y: number, z: number, rotY = 0, scale = 1, opts: { variant?: number; colors?: string[]; solid?: boolean | number } = {}): { w: number; d: number; h: number } {
    const parts = PropKit.parts(kind, { variant: opts.variant, colors: opts.colors });
    const m = new THREE.Matrix4().compose(_v.set(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(scale, scale, scale));
    this.b.tag = 'prop:' + kind;   // names the pieces for the z-fight test (a prop model's own layers are world/props')
    for (const p of parts) {
      const mk = PROP_MAT[p.mat];
      if (!mk) continue;
      this.b.add(mk, p.geo, m, null, 'keep');
    }
    this.b.tag = '';
    const fp = PropKit.footprint(kind, { variant: opts.variant, colors: opts.colors });
    const c = Math.abs(Math.cos(rotY)), s = Math.abs(Math.sin(rotY));
    const w = (fp.w * c + fp.d * s) * scale, d = (fp.w * s + fp.d * c) * scale, h = fp.h * scale;
    if (opts.solid !== false) this.solid(x - w / 2, x + w / 2, z - d / 2, z + d / 2, typeof opts.solid === 'number' ? opts.solid : h > 1.3 ? Infinity : y + h);
    else if (y < 0.05) this.aoExtra.push(x - w * 0.4, x + w * 0.4, z - d * 0.4, z + d * 0.4, h);
    return { w, d, h };
  }
  /** Every sign placed (text, centre, facing yaw rotY: 0 = +Z) — facing audits (test/rooms-facing.test.ts). */
  readonly signSpots: { text: string; x: number; y: number; z: number; ry: number }[] = [];
  /** Sign from the atlas, facing direction rotY (0 = facing +Z). Returns its height. */
  sign(text: string, x: number, y: number, z: number, w: number, rotY = 0, opts: { bg?: string; fg?: string; sub?: string; plate?: boolean; rim?: string } = {}): number {
    this.signSpots.push({ text, x, y, z, ry: rotY });
    const s = this.signs.add(text, opts);
    const h = w / s.aspect;
    const g = new THREE.PlaneGeometry(1, 1);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const [u0, v0, u1, v1] = s.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
    const sn = Math.sin(rotY), cs = Math.cos(rotY);
    this.b.add('sign', g, M(x + sn * 0.035, y, z + cs * 0.035, w, h, 1, 0, rotY, 0), '#ffffff', 'keep');
    // the backing plate: dark wood, or a polished metal rim in `rim` (gold-rimmed signs)
    if (opts.plate !== false) this.b.add(opts.rim ? 'metal' : 'wood', GEO.box, M(x, y, z, w + (opts.rim ? 0.1 : 0.06), h + (opts.rim ? 0.1 : 0.06), 0.05, 0, rotY, 0), opts.rim || this.pal.line, 1);
    g.dispose();
    return h;
  }

  /* ------------------------------------------------------------ room shell */
  /**
   * Floor, four walls (door gap in the front wall), skirting, ceiling. Sets bounds + camera colliders.
   *
   * Cutaway front wall (default): the entrance wall is drawn one-sided (visible from inside only) and the room goes on
   * for VESTIBULE metres behind it (floor, side walls, ceiling). The TP camera may back out through the entrance wall
   * into that vestibule and look into the room through the wall — so third person keeps its full arm right after you
   * walk in (back to the door), instead of collapsing into first person. Seen from inside nothing changes.
   */
  shell(o: RoomShellOpts): void {
    const { w, d, h } = o, x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2, t = 0.25;
    const P = this.pal;
    const wall = o.wall || 'plaster', wc = o.wallCol || P.plaster;
    const V = o.cutaway === false ? 0 : VESTIBULE;
    this.bounds = { x0, x1, z0, z1 };
    this.shellH = h;
    // floor (+ vestibule): q1+ wooden floors are laid board by board (shade per board, gaps, a worn path from the door)
    if ((o.floor || 'wood') === 'wood' && this.quality >= 1) plankFloor(this, x0 - t, x1 + t, z0 - t, z1 + t + V, o.floorCol || P.wood, (o.door || { x: 0 }).x);
    else this.box(o.floor || 'wood', o.floorCol || P.wood, x0 - t, x1 + t, -0.1, 0, z0 - t, z1 + t + V);
    // walls: back, left, right (side walls run on through the vestibule)
    this.box(wall, wc, x0 - t, x1 + t, 0, h, z0 - t, z0);
    this.box(wall, wc, x0 - t, x0, 0, h, z0, z1 + V);
    this.box(wall, wc, x1, x1 + t, 0, h, z0, z1 + V);
    // front wall with a door gap
    const dg = o.door || { x: 0, w: 1.4, h: 2.3 };
    this.doorGap = dg;
    const front = (mat: MatKey, col: string, xa: number, xb: number, ya: number, yb: number, z: number) => {
      if (xb - xa < 1e-3 || yb - ya < 1e-3) return;
      if (V) this.b.add(mat, GEO.plane, M((xa + xb) / 2, (ya + yb) / 2, z, xb - xa, yb - ya, 1, 0, Math.PI, 0), col, 1);
      else this.box(mat, col, xa, xb, ya, yb, z, z + t);
    };
    front(wall, wc, x0, dg.x - dg.w / 2, 0, h, z1);
    front(wall, wc, dg.x + dg.w / 2, x1, 0, h, z1);
    front(wall, wc, dg.x - dg.w / 2, dg.x + dg.w / 2, dg.h, h, z1);
    // wainscot / skirting
    const sk = o.wainscot || P.woodD, sh = o.wainscot ? 0.9 : 0.16;
    this.box('wood', sk, x0, x1, 0, sh, z0, z0 + 0.04);
    this.box('wood', sk, x0, x0 + 0.04, 0, sh, z0 + 0.04, z1);   // side runs start past the back one (no shared corner faces)
    this.box('wood', sk, x1 - 0.04, x1, 0, sh, z0 + 0.04, z1);
    front('wood', sk, x0, dg.x - dg.w / 2, 0, sh, z1 - 0.04);
    front('wood', sk, dg.x + dg.w / 2, x1, 0, sh, z1 - 0.04);
    if (o.wainscot) {
      for (const [a, b2, c0, c1] of [[x0, x1, z0, z0 + 0.06], [x0, x0 + 0.06, z0 + 0.06, z1], [x1 - 0.06, x1, z0 + 0.06, z1]] as const) this.box('wood', P.woodL, a, b2, sh, sh + 0.06, c0, c1);
      front('wood', P.woodL, x0, dg.x - dg.w / 2, sh, sh + 0.06, z1 - 0.06);
      front('wood', P.woodL, dg.x + dg.w / 2, x1, sh, sh + 0.06, z1 - 0.06);
    }
    // ceiling (+ vestibule)
    const cc = o.ceilCol || P.woodD;
    if (o.ceiling !== 'none') {
      this.box('wood', cc, x0 - t, x1 + t, h, h + 0.12, z0 - t, z1 + t + V);
      if (o.ceiling !== 'flat') {
        const n = Math.max(2, Math.round(d / 1.6)), zs: number[] = [];
        for (let i = 0; i <= n; i++) zs.push(z0 + 0.2 + (d - 0.4) * i / n);
        this.beams = zs;
        // q1+: chamfered beams, joists, knee braces and a cornice; q0: the plain beams
        if (this.quality >= 1) ceilingDetail(this, x0, x1, z0, z1 + V, h, zs, P.timber, cc, { cornice: sk });
        else for (const z of zs) this.box('wood', P.timber, x0, x1, h - 0.22, h, z - 0.1, z + 0.1);
      } else if (this.quality >= 1) ceilingDetail(this, x0, x1, z0, z1 + V, h, [], P.timber, cc, { joists: false, braces: false, cornice: sk });
    }
    // the vestibule is seen only by the TP camera backing out through the entrance wall: dress it like the room
    // (skirting, a warm wall lamp with its pool of light on each side, a barrel and a plant) so it never reads as a void
    if (V) {
      this.box('wood', sk, x0, x0 + 0.04, 0, sh, z1, z1 + V); this.box('wood', sk, x1 - 0.04, x1, 0, sh, z1, z1 + V);
      if (o.wainscot) { this.box('wood', P.woodL, x0, x0 + 0.06, sh, sh + 0.06, z1, z1 + V); this.box('wood', P.woodL, x1 - 0.06, x1, sh, sh + 0.06, z1, z1 + V); }
      const lz = z1 + V * 0.55;
      for (const [x, s2] of [[x0, 1], [x1, -1]] as const) {
        this.box('metal', P.metal, x, x + s2 * 0.22, 2.0, 2.04, lz - 0.02, lz + 0.02);
        this.box('emit', '#ffcf6a', x + s2 * 0.16, x + s2 * 0.28, 1.84, 1.98, lz - 0.06, lz + 0.06);
        this.glow(x + s2 * 0.22, 1.9, lz, 0.9, '#ffcf6a', 0.8);
        this.splash(x + s2 * 0.02, 1.6, lz, 2.4, 2.2, '#ffcf6a', 0.4, s2 * Math.PI / 2);
        this.splash(x + s2 * 0.9, 0.02, lz, 1.8, 2.6, '#ffcf6a', 0.25, 0, -Math.PI / 2);
      }
      this.prop('barrel', x0 + 0.5, 0, z1 + V - 0.7, 0.4, 0.85, { solid: false });
      this.prop('planter', x1 - 0.55, 0, z1 + V - 0.8, 0, 0.9, { solid: false });
      this.light(0, 2.2, z1 + V * 0.5, '#ffcf8a', 3, 6, 0, 0);
    }
    // camera colliders: back, sides, the far end of the vestibule (or the front wall), ceiling
    const zf = z1 + V;
    this.camBoxes.push(x0 - 1, x1 + 1, -1, h + 1, z0 - 1, z0, x0 - 1, x0, -1, h + 1, z0, zf, x1, x1 + 1, -1, h + 1, z0, zf, x0 - 1, x1 + 1, -1, h + 1, zf, zf + 1, x0 - 1, x1 + 1, h, h + 1, z0 - 1, zf + 1);
    this.vestibule = V;
    this.occFrom = this.occRaw.length;
  }
  /** Door gap of the shell's entrance wall (exitDoor() defaults to it). */
  doorGap = { x: 0, w: 1.4, h: 2.3 };
  /** Depth of the vestibule behind the cutaway entrance wall (0 = solid front wall). */
  vestibule = 0;
  /** Timber posts along a wall (decor). */
  posts(xs: number[], z: number, h: number, col = this.pal.timber, s = 0.16): void {
    for (const x of xs) this.box('wood', col, x - s / 2, x + s / 2, 0, h, z - s / 2, z + s / 2);
  }
  /** Light shafts from the windows (moonlight slanting into the room): RoomBase.finish turns them into atmos volumes. */
  readonly shafts: Shaft[] = [];
  /** Chamfered box (counters, shelves, beams); a plain box at q0. */
  bevel(mat: MatKey, col: THREE.ColorRepresentation, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c = 0.02): void { bevelBox(this, mat, col, x0, x1, y0, y1, z0, z1, c); }
  /** Night window on the back wall (z0) or side walls: a lit/dark pane with a frame. side: 'back' | 'left' | 'right'. */
  window(side: 'back' | 'left' | 'right', u: number, y: number, w: number, h: number, sky = '#2a2f6e'): void {
    const B = this.bounds, P = this.pal, f = 0.08;
    // the moonbeam through it: down into the room, slightly sideways; its pool on the floor (splash)
    {
      const d = side === 'back' ? new THREE.Vector3(0.28, -0.62, 1) : new THREE.Vector3(side === 'left' ? 1 : -1, -0.62, 0.3);
      d.normalize();
      const cx = side === 'back' ? u : side === 'left' ? B.x0 : B.x1, cz = side === 'back' ? B.z0 : u;
      const ax = side === 'back' ? 1 : 0, az = side === 'back' ? 0 : 1;
      this.shafts.push({ cx, cy: y + h / 2, cz, w: w * 0.92, h: h * 0.92, ax, az, dx: d.x, dy: d.y, dz: d.z, color: '#9fb6ff', k: 1 });
    }
    if (side === 'back') {
      const z = B.z0;
      this.box('emit', sky, u - w / 2, u + w / 2, y, y + h, z - 0.02, z + 0.01);
      this.box('wood', P.woodD, u - w / 2 - f, u + w / 2 + f, y - f, y, z, z + 0.12);
      this.box('wood', P.woodD, u - w / 2 - f, u + w / 2 + f, y + h, y + h + f, z, z + 0.08);
      this.box('wood', P.woodD, u - w / 2 - f, u - w / 2, y, y + h, z, z + 0.08);
      this.box('wood', P.woodD, u + w / 2, u + w / 2 + f, y, y + h, z, z + 0.08);
      this.box('wood', P.woodD, u - 0.025, u + 0.025, y, y + h, z, z + 0.05);
      this.box('wood', P.woodD, u - w / 2, u + w / 2, y + h * 0.5, y + h * 0.5 + 0.05, z, z + 0.04);
      this.ball('emit', '#fff3c4', u + w * 0.25, y + h * 0.75, z - 0.01, 0.06);
    } else {
      const x = side === 'left' ? B.x0 : B.x1, s = side === 'left' ? 1 : -1;
      this.box('emit', sky, x - 0.01 * s, x + 0.02 * s, y, y + h, u - w / 2, u + w / 2);
      this.box('wood', P.woodD, x, x + 0.12 * s, y - f, y, u - w / 2 - f, u + w / 2 + f);
      this.box('wood', P.woodD, x, x + 0.08 * s, y + h, y + h + f, u - w / 2 - f, u + w / 2 + f);
      this.box('wood', P.woodD, x, x + 0.08 * s, y, y + h, u - w / 2 - f, u - w / 2);
      this.box('wood', P.woodD, x, x + 0.08 * s, y, y + h, u + w / 2, u + w / 2 + f);
      this.box('wood', P.woodD, x, x + 0.05 * s, y, y + h, u - 0.025, u + 0.025);
      this.box('wood', P.woodD, x, x + 0.04 * s, y + h * 0.5, y + h * 0.5 + 0.05, u - w / 2, u + w / 2);
    }
    if (this.quality >= 1) this.windowView(side, u, y, w, h, sky);
  }
  /**
   * q1+: what is seen through a window (a lighter band of sky over the horizon, the dark roofs of the town, stars) and
   * the dressing round it (curtains on a rod, tie-backs). Layers lie a few mm proud of the pane, never coplanar.
   */
  private windowView(side: 'back' | 'left' | 'right', u: number, y: number, w: number, h: number, sky: string): void {
    const B = this.bounds, f = 0.08;
    // wall frame: (along, out of the wall) → world box
    const bx = (mat: MatKey, col: THREE.ColorRepresentation, ua: number, ub: number, y0: number, y1: number, oa: number, ob: number) => {
      if (side === 'back') this.box(mat, col, ua, ub, y0, y1, B.z0 + oa, B.z0 + ob);
      else if (side === 'left') this.box(mat, col, B.x0 + oa, B.x0 + ob, y0, y1, ua, ub);
      else this.box(mat, col, B.x1 - ob, B.x1 - oa, y0, y1, ua, ub);
    };
    const o0 = side === 'back' ? 0.01 : 0.02;   // the pane's front
    const glowCol = '#' + new THREE.Color(sky).lerp(new THREE.Color('#c8a8ff'), 0.45).getHexString();
    bx('emit', glowCol, u - w / 2, u + w / 2, y, y + h * 0.32, o0 + 0.005, o0 + 0.008);
    // roofs: a few dark blocks with a lit window dot
    const roofs = [[-0.5, -0.22, 0.26], [-0.24, 0.06, 0.18], [0.08, 0.3, 0.3], [0.32, 0.5, 0.14]];
    for (const [a, b, t] of roofs) bx('dark', '#141020', u + a * w, u + b * w, y, y + h * t, o0 + 0.014, o0 + 0.018);
    bx('emit', '#ffcf6a', u + 0.15 * w, u + 0.19 * w, y + h * 0.16, y + h * 0.2, o0 + 0.023, o0 + 0.026);
    for (let i = 0; i < 5; i++) {
      const su = u + (((i * 0.37 + 0.13) % 1) - 0.5) * w * 0.85, sy = y + h * (0.62 + ((i * 0.53) % 0.33));
      bx('emit', '#fff3c4', su - 0.012, su + 0.012, sy - 0.012, sy + 0.012, o0 + 0.005, o0 + 0.008);
    }
    // curtains: a rod over the frame, two gathered panels with tie-backs
    const cur = ['#8a2a3a', '#2e5a4a', '#4a3a7a', '#7a4a2a'][Math.abs(Math.round(u * 3)) % 4];
    const rt = y + h + f + 0.1;
    bx('metal', '#c9a04a', u - w / 2 - 0.42, u + w / 2 + 0.42, rt - 0.02, rt + 0.02, 0.15, 0.18);
    for (const sg of [-1, 1]) {
      const c0 = u + sg * (w / 2 + f + 0.03), c1 = u + sg * (w / 2 + f + 0.33);
      bx('canvas', cur, Math.min(c0, c1), Math.max(c0, c1), y - 0.18, rt - 0.03, 0.1, 0.14);
      // folds: darker strips proud of the panel
      for (let k = 0; k < 2; k++) { const fu = c0 + (c1 - c0) * (0.3 + k * 0.4); bx('canvas', shade(cur, -0.25), fu - 0.025, fu + 0.025, y - 0.16, rt - 0.05, 0.14, 0.15); }
      const tu = (c0 + c1) / 2;
      bx('canvas', '#e8c86a', tu - 0.16, tu + 0.16, y + h * 0.35, y + h * 0.35 + 0.04, 0.156, 0.162);
    }
  }
  /** Rug on the floor: border + field, stacked floor decals. */
  rug(x0: number, x1: number, z0: number, z1: number, col: string, border?: string): void {
    if (border) this.floorBox('canvas', border, x0, x1, z0, z1);
    const b = border ? 0.12 : 0;
    this.floorBox('canvas', col, x0 + b, x1 - b, z0 + b, z1 - b);
  }
  /** Hanging lantern from the ceiling: chain, cage, emissive glass, light. */
  lantern(x: number, y: number, z: number, ceil: number, color = '#ffcf6a', light = true): void {
    const P = this.pal;
    this.box('metal', P.metal, x - 0.012, x + 0.012, y + 0.2, ceil, z - 0.012, z + 0.012);
    this.cone('metal', P.metal, x, y + 0.12, z, 0.16, 0.12, true);
    this.box('emit', color, x - 0.09, x + 0.09, y - 0.12, y + 0.12, z - 0.09, z + 0.09);
    this.box('metal', P.metal, x - 0.12, x + 0.12, y - 0.16, y - 0.12, z - 0.12, z + 0.12);
    if (light) this.light(x, y - 0.1, z, '#ffb35c', 5, 8, 0.95); else this.glow(x, y, z, 0.9, color, 0.8);
  }
  /** The entrance door built by exitDoor() (leaves to swing), or null. */
  door: RoomDoor | null = null;
  /** Height of the shell's walls (0 = no shell): room for a transom over the door. */
  shellH = 0;
  /**
   * The entrance: a CLOSED door in the front wall (z = bounds.z1, or `o.z`). Everything faces the room and is
   * one-sided — architrave, two wooden leaves with raised panels, lit glass lights and iron hinges, a ring handle, a
   * lit transom over the door, a doormat — so from inside it reads as a proper door, and the TP camera that backs out
   * through the cutaway entrance wall into the vestibule looks straight through it. The leaves are their own meshes
   * hinged at the jambs (door.set(t): 0 closed … 1 swung out into the street) for the enter / leave animation; behind
   * them a warm street backdrop (seen only while the door is open). style 'curtain' (tent): two velvet flaps.
   * Returns the hit centre.
   */
  exitDoor(x: number, w = 1.4, h = 2.3, o: { style?: 'wood' | 'curtain'; z?: number } = {}): THREE.Vector3 {
    const z = o.z ?? this.bounds.z1, P = this.pal, curtain = o.style === 'curtain';
    const RY = Math.PI;   // planes facing the room (−Z)
    const face = (mat: MatKey | typeof ONE_SIDED, col: string, xa: number, xb: number, ya: number, yb: number, zz: number, b: Batch = this.b) => {
      if (xb - xa < 1e-3 || yb - ya < 1e-3) return;
      b.add(mat, GEO.plane, M((xa + xb) / 2, (ya + yb) / 2, zz, xb - xa, yb - ya, 1, 0, RY, 0), col, mat === 'emit' ? 'keep' : 1);
    };
    // the street behind the door (one-sided, faces the room; only seen while the door swings open): night sky, a lit
    // house across the street with warm windows, the lamp-lit cobbles and a street lamp
    const sx0 = x - w / 2 - 0.8, sx1 = x + w / 2 + 0.8;
    face('emit', '#2a2a6e', sx0, sx1, h * 0.8, h + 0.6, z + 0.64);
    face('emit', '#6e4c40', sx0, sx1, h * 0.28, h * 0.8, z + 0.63);
    face('emit', '#4a3038', sx0, sx1, h * 0.78, h * 0.86, z + 0.62);
    for (const u of [-0.32, 0.32]) face('emit', '#ffcf6a', x + u * w - 0.16, x + u * w + 0.16, h * 0.42, h * 0.62, z + 0.62);
    face('emit', '#9a7258', sx0, sx1, 0.002, h * 0.28, z + 0.62);
    face('emit', '#c8946a', x - w * 0.45, x + w * 0.45, 0.002, h * 0.16, z + 0.61);
    face('emit', '#2a2030', x + w * 0.24 - 0.03, x + w * 0.24 + 0.03, 0.002, h * 0.74, z + 0.6);
    face('emit', '#ffe2a0', x + w * 0.24 - 0.08, x + w * 0.24 + 0.08, h * 0.74, h * 0.84, z + 0.6);
    this.glow(x + w * 0.24, h * 0.79, z + 0.5, 1.1, '#ffcf6a', 0.9);
    // architrave (4 cm proud of the leaves) + head with a little cornice; transom over it when the wall is tall enough
    const fw = 0.14, zA = z - 0.08, wood = P.woodD;
    if (!curtain) {
      face('wood', wood, x - w / 2 - fw, x - w / 2, 0, h + fw, zA);
      face('wood', wood, x + w / 2, x + w / 2 + fw, 0, h + fw, zA);
      face('wood', wood, x - w / 2, x + w / 2, h, h + fw, zA);
      face('wood', P.woodL, x - w / 2 - fw - 0.05, x + w / 2 + fw + 0.05, h + fw, h + fw + 0.05, zA - 0.02);
      if (this.shellH >= h + 0.75) {
        const ty0 = h + fw + 0.12, ty1 = Math.min(this.shellH - 0.3, ty0 + 0.36), tw = w * 0.8;
        face('emit', '#ffc98a', x - tw / 2, x + tw / 2, ty0, ty1, z - 0.02);
        for (const u of [-0.25, 0, 0.25]) face('metal', '#3a3040', x + u * tw - 0.012, x + u * tw + 0.012, ty0, ty1, z - 0.035);
        face('wood', wood, x - tw / 2 - 0.07, x - tw / 2, ty0 - 0.07, ty1 + 0.07, z - 0.045); face('wood', wood, x + tw / 2, x + tw / 2 + 0.07, ty0 - 0.07, ty1 + 0.07, z - 0.045);
        face('wood', wood, x - tw / 2, x + tw / 2, ty0 - 0.07, ty0, z - 0.045); face('wood', wood, x - tw / 2, x + tw / 2, ty1, ty1 + 0.07, z - 0.045);
        this.glow(x, ty0 + 0.15, z - 0.1, 0.7, '#ffcf8a', 0.5);
      }
    } else {
      // tent: a gold rod with a valance over the flaps
      face('wood', '#ffcf4a', x - w / 2 - 0.1, x + w / 2 + 0.1, h, h + 0.06, z - 0.05);
      face(ONE_SIDED, '#a3122a', x - w / 2 - 0.1, x + w / 2 + 0.1, h - 0.22, h, z - 0.06);
    }
    // the two leaves (own meshes, hinged at the jambs)
    const door = new RoomDoor();
    const lw = w / 2;
    for (const sd of [-1, 1] as const) {
      const b = new Batch(1000);
      // local frame: hinge at x = 0, the leaf spans 0 … −sd·lw (towards the middle), plane z = 0, facing −Z
      const X = (u: number) => -sd * u;   // u: distance from the hinge
      const f = (mat: MatKey | typeof ONE_SIDED, col: string, u0: number, u1: number, y0: number, y1: number, dz: number) => face(mat, col, Math.min(X(u0), X(u1)), Math.max(X(u0), X(u1)), y0, y1, dz, b);
      if (curtain) {
        f(ONE_SIDED, sd < 0 ? '#a3122a' : '#8e0f24', 0, lw + 0.02, 0, h - 0.2, 0);
        for (let k = 1; k < 4; k++) f(ONE_SIDED, '#6e0c1e', lw * k / 4 - 0.015, lw * k / 4 + 0.015, 0, h - 0.2, -0.012);
        f(ONE_SIDED, '#ffcf4a', lw - 0.07, lw - 0.02, 0, h - 0.2, -0.014);
        f('metal', '#ffcf4a', lw * 0.55 - 0.03, lw * 0.55 + 0.03, 1.0, 1.4, -0.02);   // tie-back tassel
      } else {
        const leaf = '#7a4626', panel = '#93592f';
        f('wood', leaf, 0, lw, 0, h, 0);
        f('wood', panel, 0.1, lw - 0.1, 0.16, 1.02, -0.015);                    // lower raised panel
        f('wood', leaf, 0.16, lw - 0.16, 0.24, 0.94, -0.025);                   // its fielded centre
        f('emit', '#ffc98a', 0.14, lw - 0.14, 1.3, h - 0.2, -0.012);            // lit glass light (street lamps behind)
        f('wood', panel, 0.1, lw - 0.1, 1.24, 1.3, -0.02); f('wood', panel, 0.1, lw - 0.1, h - 0.2, h - 0.14, -0.02);
        f('wood', panel, 0.1, 0.14, 1.24, h - 0.14, -0.02); f('wood', panel, lw - 0.14, lw - 0.1, 1.24, h - 0.14, -0.02);
        f('wood', panel, lw / 2 - 0.018, lw / 2 + 0.018, 1.3, h - 0.2, -0.022); // glazing bar
        f('wood', panel, 0.14, lw - 0.14, (1.3 + h - 0.2) / 2 - 0.018, (1.3 + h - 0.2) / 2 + 0.018, -0.022);
        for (const y of [0.32, h - 0.42]) { f('metal', '#2e2a36', 0, 0.42, y, y + 0.07, -0.03); f('metal', '#2e2a36', 0.36, 0.46, y - 0.02, y + 0.09, -0.032); }   // iron hinge straps
        f('metal', '#2e2a36', lw - 0.13, lw - 0.06, 0.98, 1.16, -0.03);         // handle plate
        f('metal', '#c9a24a', lw - 0.115, lw - 0.075, 0.9, 1.0, -0.036);        // brass ring
      }
      const g = new THREE.Group(); g.name = 'room:door:leaf';
      for (const m of b.build(this.mats as unknown as Record<string, THREE.Material>, { receiveShadow: () => true })) { m.name = 'room:door:' + (sd < 0 ? 'l' : 'r'); g.add(m); this.owned.push(m.geometry); }
      g.position.set(x + sd * lw, 0, z - 0.02);
      this.root.add(g);
      door.leaves.push({ pivot: g, sign: sd });
    }
    this.door = door;
    // doormat (stacked floor decals: it lies on top of a rug or runner that reaches the door)
    this.floorBox('canvas', '#8a3a4a', x - 0.55, x + 0.55, z - 0.85, z - 0.15);
    this.floorBox('canvas', '#b4533c', x - 0.45, x + 0.45, z - 0.75, z - 0.25);
    // the doorway nook is not walkable any more (closed door); the TP camera still passes the one-sided wall
    return new THREE.Vector3(x, h / 2, z - 0.05);
  }

  /* ------------------------------------------------------------ queries */
  groundAt(x: number, z: number): number {
    for (const f of this.floors) if (x >= f[0] && x <= f[1] && z >= f[2] && z <= f[3]) return f[4];
    return 0;
  }
  solidTop(x: number, z: number): number {
    const B = this.bounds;
    let inExtra = false;
    for (const e of this.extra) if (x >= e.x0 && x <= e.x1 && z >= e.z0 && z <= e.z1) { inExtra = true; break; }
    const C = this.circle;
    if (!inExtra && (C ? (x - C.x) * (x - C.x) + (z - C.z) * (z - C.z) > C.r * C.r : x < B.x0 || x > B.x1 || z < B.z0 || z > B.z1)) return Infinity;
    let top = -Infinity;
    for (const s of this.solids) if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1 && s.top > top) top = s.top;
    return top;
  }
  free(x: number, z: number): boolean {
    const p = this.pad;
    let ok = false;
    const B = this.bounds;
    const C = this.circle;
    if (C ? (x - C.x) * (x - C.x) + (z - C.z) * (z - C.z) <= (C.r - p) * (C.r - p) : x >= B.x0 + p && x <= B.x1 - p && z >= B.z0 + p && z <= B.z1 - p) ok = true;
    else for (const e of this.extra) if (x >= e.x0 + p * 0.5 && x <= e.x1 - p * 0.5 && z >= e.z0 && z <= e.z1) { ok = true; break; }
    if (!ok) return false;
    for (const s of this.solids) if (x > s.x0 - p && x < s.x1 + p && z > s.z0 - p && z < s.z1 + p) return false;
    return true;
  }

  /* ------------------------------------------------------------ finish */
  /** Merge the batch, add glows and the camera collider mesh. */
  finish(): { colliders: THREE.Object3D[] } {
    // real lights: the highest priorities up to the quality cap
    const req = this.lightReq.slice().sort((a, b) => b.prio - a.prio || a.i - b.i);
    req.forEach((r, i) => { if (i < this.lightCap) { this.lights.push(r.l); this.root.add(r.l); } else r.l.dispose(); });
    if (this.splashes.length) this.root.add(this.buildSplashes());
    for (const m of this.b.build(this.mats as unknown as Record<string, THREE.Material>, { receiveShadow: () => true })) {
      m.name = 'room:' + m.name.replace(/^city:/, '');
      this.root.add(m); this.owned.push(m.geometry);
    }
    if (this.glows.length) {
      if (!this.glowTex) { this.glowTex = glowTexture(); this.owned.push(this.glowTex); }
      // interiors are small: halos are sized for the street (600 px·m) and would cover half the screen right next to the
      // camera — smaller, a little dimmer at q2+ (the post chain's bloom adds its own), faded out within ~2 m of the eye
      const g = glowPoints(this.glows, 7, this.glowTex, { flicker: 0.08, intensity: this.quality >= 2 ? 0.66 : 0.8 });
      const gm = g.material as THREE.ShaderMaterial;
      gm.uniforms.uScale.value = 430;
      gm.vertexShader = gm.vertexShader.replace('float fade = clamp(1.4 - d / 70.0, 0.0, 1.0);', 'float fade = clamp(1.4 - d / 70.0, 0.0, 1.0) * smoothstep(0.5, 2.2, d);');
      g.name = 'room:glows'; this.root.add(g); this.owned.push(g.geometry, g.material as THREE.Material);
    }
    // camera colliders: one invisible merged box mesh (material.visible = false → never drawn, still raycastable)
    const cols: THREE.Object3D[] = [];
    if (this.camBoxes.length) {
      const n = this.camBoxes.length / 6, pos: number[] = [], idx: number[] = [];
      const bx = new THREE.BoxGeometry(1, 1, 1), bp = bx.attributes.position, bi = bx.index!;
      for (let i = 0; i < n; i++) {
        const [x0, x1, y0, y1, z0, z1] = this.camBoxes.slice(i * 6, i * 6 + 6);
        const o = pos.length / 3;
        for (let v = 0; v < bp.count; v++) pos.push((x0 + x1) / 2 + bp.getX(v) * (x1 - x0), (y0 + y1) / 2 + bp.getY(v) * (y1 - y0), (z0 + z1) / 2 + bp.getZ(v) * (z1 - z0));
        for (let j = 0; j < bi.count; j++) idx.push(o + bi.getX(j));
      }
      bx.dispose();
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeBoundingSphere(); g.computeBoundingBox();
      const mat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g, mat); mesh.name = 'room:colliders'; mesh.userData.cameraCollider = true;
      this.root.add(mesh); cols.push(mesh); this.owned.push(g, mat);
    }
    return { colliders: cols };
  }
  private buildSplashes(): THREE.Mesh {
    const S = this.splashes, n = S.length / 10;
    const pos = new Float32Array(n * 12), uv = new Float32Array(n * 8), col = new Float32Array(n * 12), idx: number[] = [];
    const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3();
    const C: [number, number][] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    for (let i = 0; i < n; i++) {
      const o = i * 10;
      e.set(S[o + 6], S[o + 5], 0, 'YXZ'); q.setFromEuler(e);
      for (let j = 0; j < 4; j++) {
        v.set(C[j][0] * S[o + 3], C[j][1] * S[o + 4], 0).applyQuaternion(q);
        pos.set([S[o] + v.x, S[o + 1] + v.y, S[o + 2] + v.z], (i * 4 + j) * 3);
        uv.set([C[j][0] + 0.5, C[j][1] + 0.5], (i * 4 + j) * 2);
        col.set([S[o + 7], S[o + 8], S[o + 9]], (i * 4 + j) * 3);
      }
      const b = i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx); g.computeBoundingSphere();
    if (!this.glowTex) { this.glowTex = glowTexture(); this.owned.push(this.glowTex); }
    const m = new THREE.MeshBasicMaterial({ map: this.glowTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: true });
    const mesh = new THREE.Mesh(g, m); mesh.name = 'room:splashes'; mesh.renderOrder = 2;
    this.owned.push(g, m);
    return mesh;
  }
  dispose(): void {
    for (const r of this.lightReq) r.l.dispose();
    for (const o of this.owned) { try { o.dispose(); } catch { /* already gone */ } }
    this.owned.length = 0;
  }
}

/** Invisible hit box (raycastable, never drawn) for an Interactable. */
const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false });
const HIT_GEO = new THREE.BoxGeometry(1, 1, 1);
export function hitBox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, name = 'room:hit'): THREE.Mesh {
  const m = new THREE.Mesh(HIT_GEO, HIT_MAT);
  m.position.set(cx, cy, cz); m.scale.set(sx, sy, sz); m.name = name;
  m.updateMatrix(); m.updateMatrixWorld();
  return m;
}

/**
 * One-sided hit plane (raycastable from the front only — the interaction system's exact raycast honours FrontSide).
 * Faces yaw `ry` (0 = +Z, π = −Z). Used for the exit door: aimable from inside the room, but never from the TP
 * camera standing in the vestibule behind the cutaway wall (looking into the room through the door).
 */
const HIT_PLANE = new THREE.PlaneGeometry(1, 1);
export function hitPlane(cx: number, cy: number, cz: number, w: number, h: number, ry: number, name = 'room:hit'): THREE.Mesh {
  const m = new THREE.Mesh(HIT_PLANE, HIT_MAT);
  m.position.set(cx, cy, cz); m.scale.set(w, h, 1); m.rotation.y = ry; m.name = name;
  // no generic highlight frame: seen from the TP camera behind the entrance wall it would frame the whole view
  m.userData.highlight = false;
  m.updateMatrix(); m.updateMatrixWorld();
  return m;
}
