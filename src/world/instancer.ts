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
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}
