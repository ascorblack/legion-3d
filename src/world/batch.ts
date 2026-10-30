/**
 * Static geometry batcher: every piece of the city is added here with a world matrix, a colour and a material key,
 * then merged into one mesh per (material, x-chunk) — one per material when it is light (≤ SMALL_TRIS). UVs are box-projected in world space (texture tiles are
 * world-sized and continuous across pieces) unless the piece supplies its own ("keep").
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type MatKey = 'brick' | 'plaster' | 'wood' | 'roof' | 'stone' | 'metal' | 'glow' | 'glass' | 'paving' | 'lowPaving'
  | 'flat' | 'sign' | 'canvas' | 'water' | 'leaf' | 'back' | 'dark' | 'emit';
/** Every key the batch accepts: MatKey + city-only materials (rooms build Record<MatKey, …> and never use these). */
export type BatchKey = MatKey | 'rock';

interface Part { geo: THREE.BufferGeometry; chunk: number }
/** A material with at most this many triangles in total is merged into one mesh instead of one per x-chunk. */
export const SMALL_TRIS = 4000;

/**
 * World-scale correction of each material's texture (multiplies the UVs of every piece): the procedural tiles hold
 * 16 cobble rows (1024 px paving tile) / 8 brick courses, so this sets a cobble ≈ 11 cm, a brick ≈ 25 × 8 cm, planks ≈ 12 cm, roof rows ≈ 11 cm.
 */
const MAT_UV: Partial<Record<BatchKey, [number, number]>> = {
  paving: [1.35, 1.35], lowPaving: [1.35, 1.35], brick: [1.2, 1.85], roof: [1.25, 1.25], stone: [1.6, 1.6],
};
// 'rock' has no correction: builders pass the tile size (≈ 1.6 m) and flat-shaded faces project along their own normal
/** Materials whose pieces get a per-piece brightness/hue jitter (less repetitive facades). */
const JITTER = new Set<BatchKey>(['brick', 'plaster', 'wood', 'roof', 'stone']);
let _jit = 7;

const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Color();
const _nm = new THREE.Matrix3();

export class Batch {
  private parts = new Map<BatchKey, Part[]>();
  /** Dev/test hook: sees every piece in world space (z-fight detector, src/world/zfight.ts). */
  recorder: ((mat: BatchKey, g: THREE.BufferGeometry, tag: string, look: string) => void) | null = null;
  /** Optional hook: every piece's material + world bounds (static.ts turns low slabs — door steps, plinths — into steps). */
  onAdd: ((mat: BatchKey, box: THREE.Box3) => void) | null = null;
  /** Name of what is being added (for the recorder), e.g. the building id. */
  tag = '';
  /** Last x-chunk index (pieces beyond go into it); set from the city width. */
  maxChunk = 5;
  constructor(private chunkW = 15) {}

  /**
   * Add a geometry. `uv`: number = box-projected tile size (m); 'keep' = keep geometry UVs;
   * [su, sv] = keep geometry UVs scaled.
   */
  add(mat: BatchKey, src: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.ColorRepresentation | null, uv: number | 'keep' | [number, number] = 1): void {
    const ownCol = color === null ? (src.attributes.color as THREE.BufferAttribute | undefined) : undefined;
    const g0 = src.index ? src.toNonIndexed() : src.clone();
    if (!g0.attributes.normal) g0.computeVertexNormals();
    g0.applyMatrix4(m);
    const pos = g0.attributes.position as THREE.BufferAttribute;
    const nor = g0.attributes.normal as THREE.BufferAttribute;
    const n = pos.count;
    let uvA = g0.attributes.uv as THREE.BufferAttribute | undefined;
    if (typeof uv === 'number' || !uvA) {
      const t = typeof uv === 'number' ? 1 / uv : 1;
      const arr = new Float32Array(n * 2);
      // the projection axis is chosen per TRIANGLE (its face normal), never per vertex: on smooth-shaded round pieces
      // (towers, columns, poles) the vertex normals of one triangle can pick different axes, and the u of one vertex
      // would come from x and of the next from z — tens of tiles squeezed across one face (smeared bands; bug class
      // «texture smear», test/world-texmap.test.ts)
      for (let i = 0; i + 2 < n; i += 3) {
        _p.fromBufferAttribute(pos, i); _a.fromBufferAttribute(pos, i + 1).sub(_p); _b.fromBufferAttribute(pos, i + 2).sub(_p);
        _n.crossVectors(_a, _b);
        if (_n.lengthSq() < 1e-14) _n.fromBufferAttribute(nor, i);
        const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
        const axis = ay >= ax && ay >= az ? 1 : ax >= az ? 0 : 2, sx = _n.x > 0 ? -1 : 1, sz = _n.z > 0 ? 1 : -1;
        for (let j = i; j < i + 3; j++) {
          _p.fromBufferAttribute(pos, j);
          let u: number, v: number;
          if (axis === 1) { u = _p.x; v = _p.z; }
          else if (axis === 0) { u = _p.z * sx; v = _p.y; }
          else { u = _p.x * sz; v = _p.y; }
          arr[j * 2] = u * t; arr[j * 2 + 1] = v * t;
        }
      }
      uvA = new THREE.BufferAttribute(arr, 2);
    } else if (Array.isArray(uv)) {
      const a = uvA.array as Float32Array;
      for (let i = 0; i < n; i++) { a[i * 2] *= uv[0]; a[i * 2 + 1] *= uv[1]; }
    }
    const mu = MAT_UV[mat];
    if (mu && uv !== 'keep') {
      if (uvA === g0.attributes.uv) uvA = uvA.clone();
      const a = uvA.array as Float32Array;
      for (let i = 0; i < n; i++) { a[i * 2] *= mu[0]; a[i * 2 + 1] *= mu[1]; }
    }
    let col: Float32Array;
    if (ownCol) col = Float32Array.from((g0.attributes.color as THREE.BufferAttribute).array as Float32Array);
    else {
      _c.set(color ?? '#ffffff');
      if (JITTER.has(mat)) {   // deterministic per-piece tint jitter: ±7 % value, slight warm/cool shift
        _jit = (_jit * 16807) % 2147483647; const r1 = _jit / 2147483647;
        _jit = (_jit * 16807) % 2147483647; const r2 = _jit / 2147483647;
        const v = 0.93 + r1 * 0.14, w = (r2 - 0.5) * 0.06;
        _c.setRGB(_c.r * v * (1 + w), _c.g * v, _c.b * v * (1 - w));
      }
      col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    }
    // look signature: identical (material, colour, uv mapping) pieces shade identically → coplanar overlap is invisible
    if (this.recorder) {
      g0.setAttribute('uv', uvA);   // the final UVs too (texture-mapping test: test/world-texmap.test.ts)
      this.recorder(mat, g0, this.tag, ownCol ? 'own' + Math.random() : `${mat}|${col[0].toFixed(3)},${col[1].toFixed(3)},${col[2].toFixed(3)}|${Array.isArray(uv) ? uv.join('x') : uv}`);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', pos);
    g.setAttribute('normal', nor);
    g.setAttribute('uv', uvA);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g0.dispose();
    // chunk by centre x
    g.computeBoundingBox();
    if (this.onAdd) this.onAdd(mat, g.boundingBox!);
    const cx = (g.boundingBox!.min.x + g.boundingBox!.max.x) / 2;
    // pieces far outside the city (backdrop ring windows) join the edge chunks: no draw call per 14 m of the far ring
    const chunk = mat === 'back' || mat === 'water' || mat === 'sign' ? 0 : Math.max(-1, Math.min(this.maxChunk, Math.floor(cx / this.chunkW)));
    let arr = this.parts.get(mat);
    if (!arr) this.parts.set(mat, (arr = []));
    arr.push({ geo: g, chunk });
  }

  /** Merge and create meshes. `mats` maps every used key to a material. */
  build(mats: Record<string, THREE.Material>, opts: { castShadow?: (k: BatchKey) => boolean; receiveShadow?: (k: BatchKey) => boolean } = {}): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [key, parts] of this.parts) {
      const byChunk = new Map<number, THREE.BufferGeometry[]>();
      // a light material (few triangles in the whole city: roofs, glass, signs, paving quads, emissive bits) is ONE mesh:
      // drawing its off-screen pieces costs less than a draw call per x-chunk
      let tris = 0; for (const p of parts) tris += p.geo.getAttribute('position').count / 3;
      const one = tris <= SMALL_TRIS;
      for (const p of parts) { const c = one ? 0 : p.chunk; let a = byChunk.get(c); if (!a) byChunk.set(c, (a = [])); a.push(p.geo); }
      for (const [, geos] of byChunk) {
        const merged = mergeGeometries(geos, false);
        for (const g of geos) g.dispose();
        if (!merged) continue;
        merged.computeBoundingSphere(); merged.computeBoundingBox();
        const mesh = new THREE.Mesh(merged, mats[key]);
        mesh.name = 'city:' + key;
        mesh.matrixAutoUpdate = false; mesh.updateMatrix();
        mesh.castShadow = opts.castShadow ? opts.castShadow(key) : false;
        mesh.receiveShadow = opts.receiveShadow ? opts.receiveShadow(key) : false;
        out.push(mesh);
      }
    }
    this.parts.clear();
    return out;
  }
}

/* ------------------------------------------------------------------ shared primitive geometries + matrix helpers */

export const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1),
  cyl12: new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1),
  cyl16: new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1),
  cone4: new THREE.ConeGeometry(0.5 * Math.SQRT2, 1, 4, 1).rotateY(Math.PI / 4),
  cone12: new THREE.ConeGeometry(0.5, 1, 12, 1),
  cone16: new THREE.ConeGeometry(0.5, 1, 16, 1),
  sphere: new THREE.SphereGeometry(0.5, 12, 8),
  dome: new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  plane: new THREE.PlaneGeometry(1, 1),
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _t = new THREE.Vector3();

/** Matrix from position, scale and Euler rotation (shared temp — consume immediately). */
export function M(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): THREE.Matrix4 {
  _e.set(rx, ry, rz); _q.setFromEuler(_e);
  return _m.compose(_t.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/** Gable roof prism: ridge along X. Local: width 1 (x), depth 1 (z), height 1, base at y=0. UV of slopes along the slope. */
export function gablePrism(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const p = [
    // front slope (+z)
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0,
    // back slope (-z)
    0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0,
  ];
  const uv = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
/** The gable prism with reversed winding: the dark underside layer of a roof, facing down (seen from under the eaves). */
export function gableUnder(): THREE.BufferGeometry { return flipped(gablePrism()); }
/** Reversed-winding copy of a geometry (its inner side; non-indexed). */
export function flipped(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name === 'normal') continue;
    const at = g.attributes[name] as THREE.BufferAttribute, n = at.itemSize;
    for (let i = 0; i < at.count; i += 3) for (let c = 0; c < n; c++) {
      const v = at.getComponent(i + 1, c); at.setComponent(i + 1, c, at.getComponent(i + 2, c)); at.setComponent(i + 2, c, v);
    }
  }
  g.computeVertexNormals();
  return g;
}
/** Gable end triangles (wall material), same local frame as gablePrism. */
export function gableEnds(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const p = [-0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}
/** Shed (single slope) roof: high at back (-z), low at front. */
export function shedPrism(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const p = [-0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, -0.5, -0.5, 0, 0.5, 0.5, 1, -0.5, -0.5, 1, -0.5];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
  g.computeVertexNormals();
  return g;
}
/** Arch outline shape (door/gate opening) as an extruded slab: width 1, height 1 (incl. semicircle top), depth 1. */
export function archSlab(seg = 10): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0.5, 0.5);
  s.absarc(0, 0.5, 0.5, 0, Math.PI, false); s.lineTo(-0.5, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: seg });
  g.translate(0, 0, -0.5);
  return g;
}
/** Wall slab w×h (base at y=0, centred on x) with an arched opening ow×oh (rect + semicircle) at the bottom centre; depth 1 centred on z. */
export function archWallGeo(w: number, h: number, ow: number, oh: number, seg = 12): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(-ow / 2, 0); s.lineTo(-ow / 2, oh - ow / 2);
  s.absarc(0, oh - ow / 2, ow / 2, Math.PI, 0, true);
  s.lineTo(ow / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h); s.lineTo(-w / 2, h); s.lineTo(-w / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: seg });
  g.translate(0, 0, -0.5);
  return g;
}

export const GEO2 = { gable: gablePrism(), gableUnder: gableUnder(), gableEnds: gableEnds(), gableEndsIn: flipped(gableEnds()), shed: shedPrism(), arch: archSlab() };
