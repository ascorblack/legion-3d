/**
 * PropKit — instanced 3D props of the night-fair city (see README.md in this folder).
 * Geometry per (kind, options) is built once and cached; materials are shared module-wide.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { propMaterial, disposeMaterials, outlineOf, PB, sph, type PropMat, type PropPart } from './build';
import { BUILDERS, PROP_KINDS, LAMP_HEAD, PC, AWNINGS, bridgeParts, stairsParts, type PropKind, type KindOpts } from './kinds';
import { getTexture, disposeTextures } from '../tex';
import { BRIDGE_HUMP } from '../ground';

export { PROP_KINDS, PC as PROP_COLORS, AWNINGS, type PropKind, type KindOpts, type PropMat, type PropPart };
export { triCount, GLOW_GAIN } from './build';

export interface PropTransform { x: number; y: number; z: number; rotY?: number; scale?: number }

export interface InstancedOpts extends KindOpts {
  /** Add the inverted-hull ink outline (default true). */
  outline?: boolean;
  /** Cast shadows (default: true for big props). Receive is always on except glow/outline. */
  castShadow?: boolean;
}

export interface GarlandOpts {
  /** Sag as a fraction of span length (default 0.12). */
  sag?: number;
  /** Distance between bulbs (m, default 0.32). */
  spacing?: number;
  /** Bulb colours cycled along each garland. */
  colors?: string[];
  /** Bulb radius (m, default 0.045). */
  bulb?: number;
  /** Also add additive glow points around bulbs (default true). */
  glow?: boolean;
}

const cache = new Map<string, PropPart[]>();
const outlineCache = new Map<string, THREE.BufferGeometry | null>();
const owned = new Set<THREE.BufferGeometry>();
const ownedMats = new Set<THREE.Material>();

const BIG = new Set<PropKind>(['lamp', 'fountain', 'well', 'statue', 'stall', 'cart', 'tree', 'banner', 'noticeBoard', 'bridge', 'signpost']);

function keyOf(kind: PropKind, o: KindOpts): string {
  return kind + '|' + (o.variant ?? 0) + '|' + (o.colors ? o.colors.join(',') : '');
}

function partsOf(kind: PropKind, o: KindOpts = {}): PropPart[] {
  const k = keyOf(kind, o);
  let p = cache.get(k);
  if (!p) {
    p = BUILDERS[kind](o);
    for (const x of p) owned.add(x.geo);
    cache.set(k, p);
  }
  return p;
}

function outlineFor(kind: PropKind, o: KindOpts): THREE.BufferGeometry | null {
  const k = keyOf(kind, o);
  if (!outlineCache.has(k)) {
    const w = kind === 'fountain' || kind === 'bridge' || kind === 'well' ? 0.018 : kind === 'tree' ? 0.022 : 0.011;
    const g = outlineOf(partsOf(kind, o), w);
    if (g) owned.add(g);
    outlineCache.set(k, g);
  }
  return outlineCache.get(k)!;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

function fill(mesh: THREE.InstancedMesh, list: PropTransform[]): void {
  for (let i = 0; i < list.length; i++) {
    const t = list[i], s = t.scale ?? 1;
    _q.setFromAxisAngle(_up, t.rotY ?? 0);
    mesh.setMatrixAt(i, _m.compose(_p.set(t.x, t.y, t.z), _q, _s.set(s, s, s)));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
}

function meshesFor(name: string, parts: PropPart[], outline: THREE.BufferGeometry | null, list: PropTransform[], cast: boolean): THREE.Group {
  const g = new THREE.Group();
  g.name = 'props:' + name;
  for (const part of parts) {
    const mesh = new THREE.InstancedMesh(part.geo, propMaterial(part.mat), list.length);
    mesh.name = 'prop:' + name + ':' + part.mat;
    const fx = part.mat === 'glow' || part.mat === 'waterFx';
    mesh.castShadow = cast && !fx;
    mesh.receiveShadow = !fx;
    if (part.mat === 'waterFx') mesh.renderOrder = 2;
    fill(mesh, list);
    g.add(mesh);
  }
  if (outline) {
    const mesh = new THREE.InstancedMesh(outline, propMaterial('outline'), list.length);
    mesh.name = 'prop:' + name + ':outline';
    fill(mesh, list);
    g.add(mesh);
  }
  return g;
}

/** Glow points material cache (by colour+size not needed: colour is per point). */
let glowMat: THREE.PointsMaterial | null = null;
function glowPointsMaterial(size: number): THREE.PointsMaterial {
  if (!glowMat) {
    glowMat = new THREE.PointsMaterial({
      map: getTexture('glow').map, size, sizeAttenuation: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, vertexColors: true, fog: true,
    });
    glowMat.name = 'prop:glowPoints';
    ownedMats.add(glowMat);
  }
  if (glowMat.size === size) return glowMat;
  const m = glowMat.clone(); m.size = size; ownedMats.add(m);
  return m;
}

const spriteMats = new Map<string, THREE.SpriteMaterial>();

/** Catenary-ish sag curve between a and b (parabola in the vertical plane). */
function sagPoint(a: THREE.Vector3, b: THREE.Vector3, t: number, sag: number, out: THREE.Vector3): THREE.Vector3 {
  out.lerpVectors(a, b, t);
  out.y -= 4 * sag * t * (1 - t);
  return out;
}

export const PropKit = {
  /** Lantern centre relative to the lamp origin (scale 1). */
  lampHeadOffset: LAMP_HEAD.clone(),

  /**
   * One InstancedMesh per material part (+ one for the outline), in a Group named 'props:<kind>'.
   * Instances share cached geometry; call again with another list for another batch.
   */
  instanced(kind: PropKind, transforms: PropTransform[], opts: InstancedOpts = {}): THREE.Group {
    const o: KindOpts = { variant: opts.variant, colors: opts.colors };
    const parts = partsOf(kind, o);
    const outline = opts.outline === false ? null : outlineFor(kind, o);
    return meshesFor(kind, parts, outline, transforms, opts.castShadow ?? BIG.has(kind));
  },

  /**
   * Unique "hero" props (fountain, well, statue… — 1–2 of each in a town) baked into ONE plain Mesh per material for
   * all kinds together (+ one outline mesh): the same shared materials and look as instanced(), but ≈ 8 draw calls for
   * every hero in town instead of 4–7 per kind. The returned group owns its (merged) geometries.
   */
  merged(items: { kind: PropKind; list: PropTransform[]; opts?: KindOpts }[], o: { outline?: boolean } = {}): THREE.Group {
    const byMat = new Map<PropMat, THREE.BufferGeometry[]>();
    const outl: THREE.BufferGeometry[] = [];
    const put = (src: THREE.BufferGeometry, m: THREE.Matrix4, into: THREE.BufferGeometry[]) => {
      const g = src.index ? src.toNonIndexed() : src.clone();
      for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal' && n !== 'uv' && n !== 'color') g.deleteAttribute(n);
      g.applyMatrix4(m);
      into.push(g);
    };
    let cast = false;
    for (const it of items) {
      const ko: KindOpts = it.opts ?? {};
      const parts = partsOf(it.kind, ko), ol = o.outline === false ? null : outlineFor(it.kind, ko);
      if (it.list.length && BIG.has(it.kind)) cast = true;
      for (const t of it.list) {
        const s = t.scale ?? 1;
        _q.setFromAxisAngle(_up, t.rotY ?? 0);
        _m.compose(_p.set(t.x, t.y, t.z), _q, _s.set(s, s, s));
        for (const part of parts) { let a = byMat.get(part.mat); if (!a) byMat.set(part.mat, (a = [])); put(part.geo, _m, a); }
        if (ol) put(ol, _m, outl);
      }
    }
    const grp = new THREE.Group(); grp.name = 'props:hero';
    const mk = (gs: THREE.BufferGeometry[], name: string, mat: THREE.Material) => {
      // the same attribute set for every piece (an outline hull has no uv / colour)
      const need = ['uv', 'color'].filter((n) => gs.every((g) => g.attributes[n]));
      for (const g of gs) for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal' && !need.includes(n)) g.deleteAttribute(n);
      const geo = mergeGeometries(gs, false)!;
      gs.forEach((g) => g.dispose());
      geo.computeBoundingSphere(); geo.computeBoundingBox();
      const mesh = new THREE.Mesh(geo, mat); mesh.name = name;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      return mesh;
    };
    for (const [mat, gs] of byMat) {
      if (!gs.length) continue;
      const mesh = mk(gs, 'prop:hero:' + mat, propMaterial(mat));
      const fx = mat === 'glow' || mat === 'waterFx';
      mesh.castShadow = cast && !fx; mesh.receiveShadow = !fx;
      if (mat === 'waterFx') mesh.renderOrder = 2;
      grp.add(mesh);
    }
    if (outl.length) grp.add(mk(outl, 'prop:hero:outline', propMaterial('outline')));
    return grp;
  },

  /** Raw cached parts (shared — do not dispose; clone if you modify). */
  parts(kind: PropKind, opts: KindOpts = {}): PropPart[] { return partsOf(kind, opts); },

  /** Shared material of a part key. */
  material(key: PropMat): THREE.Material { return propMaterial(key); },

  /** Axis-aligned size at scale 1 and rotY 0: w (X), d (Z), h (Y). */
  footprint(kind: PropKind, opts: KindOpts = {}): { w: number; d: number; h: number } {
    const bb = new THREE.Box3();
    for (const p of partsOf(kind, opts)) { if (!p.geo.boundingBox) p.geo.computeBoundingBox(); bb.union(p.geo.boundingBox!); }
    const s = bb.getSize(new THREE.Vector3());
    return { w: s.x, d: s.z, h: s.y };
  },

  /** A parametric bridge (span along Z, width along X), as a Group of plain Meshes (one per material + outline). */
  bridge(length = 4, width = 2, hump = BRIDGE_HUMP, opts: { outline?: boolean } = {}): THREE.Group {
    const k = `bridge:${length.toFixed(2)}:${width.toFixed(2)}:${hump.toFixed(2)}`;
    let parts = cache.get(k);
    if (!parts) { parts = bridgeParts(length, width, hump); parts.forEach((p) => owned.add(p.geo)); cache.set(k, parts); }
    let ol = outlineCache.get(k);
    if (ol === undefined && opts.outline !== false) { ol = outlineOf(parts, 0.022); if (ol) owned.add(ol); outlineCache.set(k, ol); }
    return meshesFor('bridge', parts, opts.outline === false ? null : ol ?? null, [{ x: 0, y: 0, z: 0 }], true);
  },

  /** Parametric stairs going down along +Z from y=0 to y=-height. */
  stairs(width = 1.6, height = 0.8, depth = 1.6, opts: { outline?: boolean } = {}): THREE.Group {
    const k = `stairs:${width.toFixed(2)}:${height.toFixed(2)}:${depth.toFixed(2)}`;
    let parts = cache.get(k);
    if (!parts) { parts = stairsParts(width, height, depth); parts.forEach((p) => owned.add(p.geo)); cache.set(k, parts); }
    let ol = outlineCache.get(k);
    if (ol === undefined && opts.outline !== false) { ol = outlineOf(parts, 0.014); if (ol) owned.add(ol); outlineCache.set(k, ol); }
    return meshesFor('stairs', parts, opts.outline === false ? null : ol ?? null, [{ x: 0, y: 0, z: 0 }], false);
  },

  /**
   * String-light garlands. `spans` = list of polylines (each ≥ 2 points, world metres); every segment sags.
   * Returns a Group: cable (one merged Mesh), bulbs (one InstancedMesh with per-instance colours), glow Points.
   * The result owns its geometries: dispose with PropKit.disposeObject(group) when rebuilt.
   */
  garland(spans: THREE.Vector3[][], opts: GarlandOpts = {}): THREE.Group {
    const sag = opts.sag ?? 0.12, spacing = opts.spacing ?? 0.32, R = opts.bulb ?? 0.045;
    const colors = opts.colors ?? [PC.yellow, PC.pink, PC.teal, PC.blue, PC.lilac, PC.orange, '#8fe07a'];
    const cables: THREE.BufferGeometry[] = [];
    const bulbs: THREE.Vector3[] = [];
    const tmp = new THREE.Vector3();
    for (const span of spans) {
      for (let i = 0; i + 1 < span.length; i++) {
        const a = span[i], b = span[i + 1], len = a.distanceTo(b), s = len * sag;
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 12; k++) pts.push(sagPoint(a, b, k / 12, s, new THREE.Vector3()));
        cables.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.012, 3, false));
        const n = Math.max(1, Math.floor(len / spacing));
        for (let k = 0; k < n; k++) bulbs.push(sagPoint(a, b, (k + 0.5) / n, s, tmp).clone().add(new THREE.Vector3(0, -R * 1.1, 0)));
      }
    }
    const g = new THREE.Group(); g.name = 'props:garland';
    if (cables.length) {
      const cg = mergeGeometries(cables.map((c) => { c.deleteAttribute('uv'); return c; }), false)!;
      cables.forEach((c) => c.dispose());
      const cable = new THREE.Mesh(cg, cableMat());
      cable.name = 'prop:garland:cable';
      g.add(cable);
    }
    if (bulbs.length) {
      const bulbGeo = bulbGeometry(R);
      const im = new THREE.InstancedMesh(bulbGeo, propMaterial('glow'), bulbs.length);
      im.name = 'prop:garland:bulbs';
      for (let i = 0; i < bulbs.length; i++) {
        im.setMatrixAt(i, _m.makeTranslation(bulbs[i].x, bulbs[i].y, bulbs[i].z));
        im.setColorAt(i, _c.set(colors[i % colors.length]));
      }
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      g.add(im);
      if (opts.glow !== false) g.add(PropKit.glows(bulbs, { colors, size: R * 9, intensity: 0.55 }));
    }
    return g;
  },

  /**
   * Additive glow points (one draw call) — put them at lamp heads / windows. Colours cycle through `colors`
   * (or one `color`). `size` = world size (m) at sizeAttenuation; intensity scales the colour.
   */
  glows(points: THREE.Vector3[], o: { color?: string; colors?: string[]; size?: number; intensity?: number } = {}): THREE.Points {
    const n = points.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const cs = o.colors ?? [o.color ?? '#ffcf6a'], k = o.intensity ?? 0.9;
    for (let i = 0; i < n; i++) {
      pos[i * 3] = points[i].x; pos[i * 3 + 1] = points[i].y; pos[i * 3 + 2] = points[i].z;
      _c.set(cs[i % cs.length]);
      col[i * 3] = _c.r * k; col[i * 3 + 1] = _c.g * k; col[i * 3 + 2] = _c.b * k;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    const p = new THREE.Points(geo, glowPointsMaterial(o.size ?? 1.6));
    p.name = 'prop:glows'; p.renderOrder = 3; p.frustumCulled = n > 0;
    return p;
  },

  /** Dispose geometries of an object returned by garland()/glows() (shared kit geometry is left alone). */
  disposeObject(obj: THREE.Object3D): void {
    obj.traverse((o) => {
      const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (g && !owned.has(g) && !sharedBulbs.has(g)) g.dispose();
    });
  },
};

/** A single additive glow sprite (for one-off lights). Material cached by colour. */
export function lanternGlowSprite(color = '#ffcf6a', size = 1.4, opacity = 0.85): THREE.Sprite {
  const k = color + '|' + opacity;
  let m = spriteMats.get(k);
  if (!m) {
    m = new THREE.SpriteMaterial({ map: getTexture('glow').map, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
    spriteMats.set(k, m);
  }
  const s = new THREE.Sprite(m);
  s.scale.setScalar(size); s.renderOrder = 3; s.name = 'prop:glowSprite';
  return s;
}

/* ------------------------------------------------------------------ shared small things */

let _cableMat: THREE.MeshStandardMaterial | null = null;
function cableMat(): THREE.MeshStandardMaterial {
  if (!_cableMat) { _cableMat = new THREE.MeshStandardMaterial({ color: '#2a2440', roughness: 0.8 }); _cableMat.name = 'prop:cable'; ownedMats.add(_cableMat); }
  return _cableMat;
}

const sharedBulbs = new Map<THREE.BufferGeometry, number>();
const bulbByR = new Map<number, THREE.BufferGeometry>();
function bulbGeometry(R: number): THREE.BufferGeometry {
  let g = bulbByR.get(R);
  if (!g) {
    const b = new PB();
    b.add('glow', sph(R, 8, 6), '#ffffff', { s: [1, 1.25, 1] });
    g = b.build()[0].geo;
    bulbByR.set(R, g); sharedBulbs.set(g, R);
  }
  return g;
}

/** Dispose every cached prop geometry, material and texture. */
export function disposePropKit(): void {
  for (const g of owned) g.dispose();
  for (const g of bulbByR.values()) g.dispose();
  for (const m of ownedMats) m.dispose();
  for (const m of spriteMats.values()) m.dispose();
  owned.clear(); cache.clear(); outlineCache.clear(); bulbByR.clear(); sharedBulbs.clear(); ownedMats.clear(); spriteMats.clear();
  glowMat = null; _cableMat = null;
  disposeMaterials();
  disposeTextures();
}

/** All kinds with their cached tri counts (for tests / stats). */
export function propStats(): { kind: PropKind; tris: number; parts: number }[] {
  return PROP_KINDS.map((kind) => {
    const parts = partsOf(kind);
    let tris = 0;
    for (const p of parts) tris += (p.geo.index ? p.geo.index.count : p.geo.attributes.position.count) / 3;
    return { kind, tris, parts: parts.length };
  });
}
