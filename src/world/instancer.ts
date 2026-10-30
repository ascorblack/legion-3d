/**
 * Instanced props: each kind is a set of parts (geometry with baked vertex colours + material key);
 * all instances of a kind share one InstancedMesh per part. Used for repeated props (lamps, benches, crates, barrels…).
 * Placeholder prop geometry lives in protoProps.ts; the `props` module can replace kinds via registerKind().
 */
import * as THREE from 'three';

export interface PartDef { geo: THREE.BufferGeometry; mat: string; castShadow?: boolean }

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _col = new THREE.Color();

export class Instancer {
  private kinds = new Map<string, PartDef[]>();
  private inst = new Map<string, THREE.Matrix4[]>();

  registerKind(kind: string, parts: PartDef[]): void { this.kinds.set(kind, parts); }
  /** Another name for a registered kind (same parts; e.g. village props whose solids come from the site's footprints). */
  alias(kind: string, of: string): void { const p = this.kinds.get(of); if (p) this.kinds.set(kind, p); }
  has(kind: string): boolean { return this.kinds.has(kind); }

  /** Placements (any kind name; resolved at build time by the kit or the placeholder kinds). */
  readonly placed = new Map<string, { x: number; y: number; z: number; rotY: number; scale: number; sy: number }[]>();

  add(kind: string, X: number, Y: number, Z: number, rotY = 0, scale = 1, sy = scale): void {
    let a = this.placed.get(kind); if (!a) this.placed.set(kind, (a = []));
    a.push({ x: X, y: Y, z: Z, rotY, scale, sy });
  }

  count(kind: string): number { return this.placed.get(kind)?.length ?? 0; }

  /** Build placeholder InstancedMeshes for the given kinds (those registered here). */
  build(mats: Record<string, THREE.Material>, only: (kind: string) => boolean = () => true): THREE.InstancedMesh[] {
    this.inst.clear();
    for (const [kind, list] of this.placed) {
      if (!this.kinds.has(kind) || !only(kind)) continue;
      this.inst.set(kind, list.map((p) => { _q.setFromAxisAngle(_up, p.rotY); return new THREE.Matrix4().compose(_p.set(p.x, p.y, p.z), _q, _s.set(p.scale, p.sy, p.scale)); }));
    }
    const out: THREE.InstancedMesh[] = [];
    for (const [kind, list] of this.inst) {
      const parts = this.kinds.get(kind)!;
      for (const part of parts) {
        const mesh = new THREE.InstancedMesh(part.geo, mats[part.mat] || mats.flat, list.length);
        for (let i = 0; i < list.length; i++) mesh.setMatrixAt(i, list[i]);
        mesh.instanceMatrix.needsUpdate = true;
        if (part.mat === 'leaf') {   // every tree / bush its own shade: value ±10 %, a warm / cool shift
          for (let i = 0; i < list.length; i++) {
            const e = list[i].elements, h = Math.sin(e[12] * 12.9898 + e[14] * 78.233) * 43758.5453, r1 = h - Math.floor(h), r2 = (h * 7.13) - Math.floor(h * 7.13);
            const v = 0.88 + r1 * 0.22, w = (r2 - 0.5) * 0.16;
            mesh.setColorAt(i, _col.setRGB(v * (1 + w), v * (1 + w * 0.3), v * (1 - w)));
          }
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
        mesh.computeBoundingSphere();
        mesh.name = 'prop:' + kind + ':' + part.mat;
        mesh.castShadow = !!part.castShadow;
        mesh.receiveShadow = false;
        out.push(mesh);
      }
    }
    return out;
  }

  /** Geometries are owned by the kinds; call once when the world is disposed. */
  dispose(): void {
    for (const parts of new Set(this.kinds.values())) for (const p of parts) p.geo.dispose();
    this.kinds.clear(); this.inst.clear(); this.placed.clear();
  }
}

/** Bake a colour into a (cloned, non-indexed) geometry and apply a transform. Helper to compose prop parts. */
export function part(src: THREE.BufferGeometry, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src.clone();
  _q.setFromEuler(new THREE.Euler(rx, ry, rz));
  g.applyMatrix4(_m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)));
  const c = new THREE.Color(color);
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', boxUv(g, 1));
  return g;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _f = new THREE.Vector3();
/**
 * Box-projected UVs in the part's own (prop-local, metre) space, the axis chosen per triangle: the same texel density as
 * the city's world-projected pieces (one texture tile per `tile` metres). The primitives' own 0..1-per-face UVs would
 * squeeze a whole tile onto a 2 cm strap (bug class «texture density», test/world-texmap.test.ts).
 */
export function boxUv(g: THREE.BufferGeometry, tile: number): THREE.BufferAttribute {
  const pos = g.attributes.position as THREE.BufferAttribute, n = pos.count, uv = new Float32Array(n * 2), t = 1 / tile;
  for (let i = 0; i + 2 < n; i += 3) {
    _a.fromBufferAttribute(pos, i); _b.fromBufferAttribute(pos, i + 1).sub(_a); _c.fromBufferAttribute(pos, i + 2).sub(_a);
    _f.crossVectors(_b, _c);
    const ax = Math.abs(_f.x), ay = Math.abs(_f.y), az = Math.abs(_f.z);
    const axis = ay >= ax && ay >= az ? 1 : ax >= az ? 0 : 2;
    for (let j = i; j < i + 3; j++) {
      const x = pos.getX(j), y = pos.getY(j), z = pos.getZ(j);
      uv[j * 2] = (axis === 0 ? z : x) * t; uv[j * 2 + 1] = (axis === 1 ? z : y) * t;
    }
  }
  return new THREE.BufferAttribute(uv, 2);
}
