/**
 * Geometry lint — collecting the built world as world-space pieces (no DOM, no renderer):
 *   const col = new LintCollector(() => k.b.tagSeq);  k.b.recorder = col.add;  …build…  col.addInstances(k.inst);
 *   lintWorld({ where: 'fair', pieces: col.pieces, groundAt, marks: k.marks }, opts)
 * Batch pieces keep their object identity from the batch tag (every `k.b.tag = …` assignment starts a new object);
 * instanced props are one object per placement, split into their connected parts (a lamp = foot, post, plate, cap, glass).
 */
import * as THREE from 'three';
import type { Instancer } from '../instancer';
import type { LintPiece } from './types';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export function aabb(pos: ArrayLike<number>): Float64Array {
  const b = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (let i = 0; i + 2 < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (z < b[2]) b[2] = z;
    if (x > b[3]) b[3] = x; if (y > b[4]) b[4] = y; if (z > b[5]) b[5] = z;
  }
  return b;
}

const COMP = new WeakMap<THREE.BufferGeometry, Float32Array[]>();
/** Connected parts of a (merged) geometry: triangles sharing a vertex position (welded at 0.1 mm) are one part. */
export function components(g: THREE.BufferGeometry): Float32Array[] {
  const hit = COMP.get(g); if (hit) return hit;
  const src = g.index ? g.toNonIndexed() : g;
  const a = (src.attributes.position as THREE.BufferAttribute).array as ArrayLike<number>;
  const nT = Math.floor(a.length / 9);
  const par = new Int32Array(nT); for (let i = 0; i < nT; i++) par[i] = i;
  const find = (x: number): number => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const seen = new Map<string, number>();
  for (let t = 0; t < nT; t++) for (let v = 0; v < 3; v++) {
    const o = t * 9 + v * 3, key = Math.round(a[o] * 1e4) + ',' + Math.round(a[o + 1] * 1e4) + ',' + Math.round(a[o + 2] * 1e4);
    const s = seen.get(key);
    if (s === undefined) seen.set(key, t); else { const r1 = find(s), r2 = find(t); if (r1 !== r2) par[r1] = r2; }
  }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < nT; t++) { const r = find(t); let l = groups.get(r); if (!l) groups.set(r, (l = [])); l.push(t); }
  const out: Float32Array[] = [];
  for (const l of groups.values()) {
    const f = new Float32Array(l.length * 9);
    l.forEach((t, j) => { for (let q = 0; q < 9; q++) f[j * 9 + q] = a[t * 9 + q]; });
    out.push(f);
  }
  if (src !== g) src.dispose();
  COMP.set(g, out);
  return out;
}

export class LintCollector {
  readonly pieces: LintPiece[] = [];
  private objs = new Map<string, number>();
  constructor(private seq: () => number = () => 0, private role: () => string = () => '') {}

  /** A stable object id for a key (pieces with one key are parts of one object). */
  objId(key: string): number { let o = this.objs.get(key); if (o === undefined) this.objs.set(key, (o = this.objs.size)); return o; }

  /** Batch.recorder / RoomKit.recorder: one piece per Batch.add (already world space, non-indexed). */
  add = (mat: string, g: THREE.BufferGeometry, tag: string, look: string, role?: string): void => {
    const src = g.index ? g.toNonIndexed() : g;
    const pos = Float32Array.from((src.attributes.position as THREE.BufferAttribute).array as ArrayLike<number>);
    const uvA = src.attributes.uv as THREE.BufferAttribute | undefined;
    const uvMode = look.split('|')[2] ?? '';
    this.pieces.push({
      i: this.pieces.length, obj: this.objId(tag + '#' + this.seq()), tag, mat, kind: '', src: 'batch', pos,
      uv: uvA ? Float32Array.from(uvA.array as ArrayLike<number>) : null, keep: uvMode === 'keep' || uvMode.includes('x'), look, role: role ?? this.role(), b: aabb(pos),
    });
    if (src !== g) src.dispose();
  };

  /** Every placement of every registered instanced kind (one object per placement, its connected parts as pieces). */
  addInstances(inst: Instancer, only: (kind: string) => boolean = () => true): void {
    for (const [kind, list] of inst.placed) {
      const parts = inst.partsOf(kind);
      if (!parts || !only(kind)) continue;
      const local = parts.flatMap((p) => components(p.geo).map((c) => ({ mat: p.mat, c })));
      list.forEach((pl, i) => {
        _q.setFromAxisAngle(_up, pl.rotY);
        _m.compose(_p.set(pl.x, pl.y, pl.z), _q, _s.set(pl.scale, pl.sy, pl.scale));
        const obj = this.objId('inst:' + kind + '#' + i);
        for (const { mat, c } of local) this.pushXf(c, _m, obj, 'inst:' + kind + '#' + i, mat, kind, 'inst');
      });
    }
  }

  /** Meshes of a scene graph (rooms, the mine, an expedition stage): each mesh one object, each instance its own. */
  addScene(root: THREE.Object3D, skip: (o: THREE.Object3D) => boolean = () => false): void {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || skip(o)) return;
      for (let q: THREE.Object3D | null = o; q; q = q.parent) if (!q.visible) return;
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      if (mat && (mat as THREE.Material).visible === false) return;
      const name = o.name || o.type, comps = components(m.geometry);
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh) {
        const w = new THREE.Matrix4();
        for (let i = 0; i < im.count; i++) {
          im.getMatrixAt(i, w); w.premultiply(o.matrixWorld);
          if (Math.abs(w.determinant()) < 1e-12) continue;   // hidden (zero-scale) instance
          const obj = this.objId(name + '#' + o.id + ':' + i);
          for (const c of comps) this.pushXf(c, w, obj, name + '#' + i, (mat as THREE.Material)?.name || name, name, 'mesh');
        }
      } else {
        const obj = this.objId(name + '#' + o.id);
        for (const c of comps) this.pushXf(c, o.matrixWorld, obj, name, (mat as THREE.Material)?.name || name, name, 'mesh');
      }
    });
  }

  private pushXf(c: Float32Array, m: THREE.Matrix4, obj: number, tag: string, mat: string, kind: string, src: 'inst' | 'mesh'): void {
    const pos = new Float32Array(c.length);
    for (let i = 0; i < c.length; i += 3) { _v.set(c[i], c[i + 1], c[i + 2]).applyMatrix4(m); pos[i] = _v.x; pos[i + 1] = _v.y; pos[i + 2] = _v.z; }
    this.pieces.push({ i: this.pieces.length, obj, tag, mat, kind, src, pos, uv: null, keep: true, look: tag + mat, role: '', b: aabb(pos) });
  }
}
