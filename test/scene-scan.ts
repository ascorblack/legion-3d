/**
 * Test helper — scene scanner: walks a built THREE scene graph in node and measures defects
 *  - stray geometry: NaN, degenerate and huge triangles, vertices outside the expected bounds
 *  - floating / sunk instances (props) against a ground function and the static surfaces below
 *  - cross-object coplanar overlaps (z-fighting) between different meshes / instances
 *  - box-projected texture stretch (steep faces) and texel-density outliers per material
 */
import * as THREE from 'three';
import { ZRecorder } from '../src/world/zfight';

export interface Tri { mesh: string; inst: number; a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3 }
export interface ScanOpts { bounds?: THREE.Box3; hugeEdge?: number; ground?: (x: number, z: number) => number; skip?: (o: THREE.Object3D) => boolean }

const _m = new THREE.Matrix4();
const _w = new THREE.Matrix4();

/** Every visible mesh's world matrices (one per instance). */
export function meshes(root: THREE.Object3D, skip?: (o: THREE.Object3D) => boolean): { o: THREE.Mesh; mats: THREE.Matrix4[] }[] {
  root.updateMatrixWorld(true);
  const out: { o: THREE.Mesh; mats: THREE.Matrix4[] }[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (let q: THREE.Object3D | null = o; q; q = q.parent) if (!q.visible) return;
    if (skip?.(o)) return;
    const mats: THREE.Matrix4[] = [];
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh) for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, _m); mats.push(_w.multiplyMatrices(o.matrixWorld, _m).clone()); }
    else mats.push(o.matrixWorld.clone());
    out.push({ o: m, mats });
  });
  return out;
}

export function nameOf(o: THREE.Object3D): string {
  const parts: string[] = [];
  for (let q: THREE.Object3D | null = o; q && parts.length < 3; q = q.parent) if (q.name) parts.push(q.name);
  return parts.join('<') || o.type;
}

function forTris(g: THREE.BufferGeometry, m: THREE.Matrix4, fn: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, i: number) => void): void {
  const pos = g.attributes.position as THREE.BufferAttribute; if (!pos) return;
  const idx = g.index;
  const n = idx ? idx.count / 3 : pos.count / 3;
  const s = g.drawRange.start / 3 | 0, e = Math.min(n, g.drawRange.count === Infinity ? n : (g.drawRange.start + g.drawRange.count) / 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = s; t < e; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0).applyMatrix4(m); b.fromBufferAttribute(pos, i1).applyMatrix4(m); c.fromBufferAttribute(pos, i2).applyMatrix4(m);
    fn(a, b, c, t);
  }
}

export interface StrayReport { nan: string[]; degenerate: Record<string, number>; huge: string[]; outside: string[]; tris: number; calls: number; byMesh: Record<string, number> }

export function stray(root: THREE.Object3D, o: ScanOpts = {}): StrayReport {
  const r: StrayReport = { nan: [], degenerate: {}, huge: [], outside: [], tris: 0, calls: 0, byMesh: {} };
  const huge = o.hugeEdge ?? 80;
  for (const { o: m, mats } of meshes(root, o.skip)) {
    const g = m.geometry as THREE.BufferGeometry, nm = nameOf(m);
    r.calls++;
    const pos = g.attributes.position as THREE.BufferAttribute;
    if (!pos) continue;
    let bad = false;
    for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) { bad = true; break; }
    if (bad) r.nan.push(nm);
    let out = 0, nh = 0, nd = 0;
    mats.forEach((mw, ii) => {
      forTris(g, mw, (a, b, c) => {
        r.tris++; r.byMesh[nm] = (r.byMesh[nm] || 0) + 1;
        const ab = a.distanceTo(b), bc = b.distanceTo(c), ca = c.distanceTo(a);
        const area = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() / 2;
        if (area < 1e-9) nd++;
        if (Math.max(ab, bc, ca) > huge) { nh++; if (nh <= 2) r.huge.push(`${nm}#${ii} edge ${Math.max(ab, bc, ca).toFixed(1)}m at ${fmt(a)}`); }
        if (o.bounds && (!o.bounds.containsPoint(a) || !o.bounds.containsPoint(b) || !o.bounds.containsPoint(c))) { out++; if (out <= 2) r.outside.push(`${nm}#${ii} at ${fmt(a)}`); }
      });
    });
    if (nd) r.degenerate[nm] = (r.degenerate[nm] || 0) + nd;
  }
  return r;
}

export const fmt = (v: THREE.Vector3 | number[]) => (Array.isArray(v) ? v : [v.x, v.y, v.z]).map((x) => (+x).toFixed(2)).join(',');

/** Lowest point of each instance (all parts of an instanced group / a single instanced mesh). */
export interface InstBase { kind: string; i: number; x: number; z: number; minY: number; y0: number; obj?: THREE.Object3D }
export function instanceBases(root: THREE.Object3D, ground: (x: number, z: number) => number): InstBase[] {
  root.updateMatrixWorld(true);
  const groups = new Map<string, { kind: string; meshes: THREE.InstancedMesh[] }>();
  root.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (!im.isInstancedMesh || !im.visible) return;
    if (/outline|blob|glow|garland|bulb/i.test(o.name) || /outline/i.test(o.parent?.name || '')) return;
    const pk = /^prop:([^:]+):/.exec(o.name);
    const key = o.parent && /^props:/.test(o.parent.name) ? o.parent.uuid : pk ? 'k:' + pk[1] + ':' + im.count : im.uuid;
    const kind = o.parent && /^props:/.test(o.parent.name) ? o.parent.name : pk ? 'prop:' + pk[1] : o.name;
    let gr = groups.get(key); if (!gr) groups.set(key, (gr = { kind, meshes: [] }));
    gr.meshes.push(im);
  });
  const out: InstBase[] = [];
  const v = new THREE.Vector3();
  for (const { kind, meshes: ms } of groups.values()) {
    const n = ms[0].count;
    for (let i = 0; i < n; i++) {
      let minY = Infinity, x = 0, z = 0;
      for (const im of ms) {
        im.getMatrixAt(i, _m); _w.multiplyMatrices(im.matrixWorld, _m);
        const pos = im.geometry.attributes.position as THREE.BufferAttribute;
        for (let k = 0; k < pos.count; k++) { v.fromBufferAttribute(pos, k).applyMatrix4(_w); if (v.y < minY) minY = v.y; }
        x = _w.elements[12]; z = _w.elements[14];
      }
      out.push({ kind, i, x, z, minY, y0: ground(x, z), obj: ms[0] });
    }
  }
  return out;
}

/** Cross-mesh coplanar overlaps (instances count as separate pieces). */
export function zfight(root: THREE.Object3D, ground?: (x: number, z: number) => number, skip?: (o: THREE.Object3D) => boolean, perInstance = true, sameLookInstances = false) {
  const rec = new ZRecorder();
  for (const { o: m, mats } of meshes(root, skip)) {
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material & { color?: THREE.Color; polygonOffset?: boolean; transparent?: boolean; depthWrite?: boolean };
    if (/outline/i.test(m.name) || (mat && mat.side === THREE.BackSide)) continue;   // inverted hulls: back faces only, by design
    if (mat && (mat as any).depthTest === false) continue;   // overlays (bars, badges): drawn on top by renderOrder
    if (!mat || mat.polygonOffset || (mat.transparent && mat.depthWrite === false) || mat.colorWrite === false) continue;   // decals / additive: by design
    const key = mat.side === THREE.DoubleSide ? 'flat' : 'wood';
    const nm = nameOf(m);
    mats.forEach((mw, i) => {
      if (!perInstance && i > 0) return;
      const g = (m.geometry as THREE.BufferGeometry).clone();
      g.applyMatrix4(mw);
      rec.add(key as never, g, nm + (mats.length > 1 ? '#' + i : ''), mat.uuid + (mats.length > 1 && !sameLookInstances ? '#' + i : ''));
      g.dispose();
    });
  }
  return rec.find(0.004, 2e-4, ground);
}

/**
 * Texture mapping quality per mesh: (1) box-projection stretch — max 1/|n·axis| over triangles of a box-projected
 * material (UV == world-projected); (2) texel density = sqrt(uv area / world area) per triangle, median per mesh,
 * anisotropy (ratio of the UV Jacobian's singular values).
 */
export function texStats(root: THREE.Object3D, skip?: (o: THREE.Object3D) => boolean) {
  const out: { mesh: string; tris: number; dens: number; p10: number; p90: number; aniso95: number; stretchy: number }[] = [];
  for (const { o: m, mats } of meshes(root, skip)) {
    const g = m.geometry as THREE.BufferGeometry, uv = g.attributes.uv as THREE.BufferAttribute;
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    if (!uv || !mat || !(mat as any).map) continue;
    const dens: number[] = [], an: number[] = []; let stretchy = 0;
    const pos = g.attributes.position as THREE.BufferAttribute, idx = g.index;
    const n = idx ? idx.count / 3 : pos.count / 3;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
    const mw = mats[0];
    for (let t = 0; t < n; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      A.fromBufferAttribute(pos, i0).applyMatrix4(mw); B.fromBufferAttribute(pos, i1).applyMatrix4(mw); C.fromBufferAttribute(pos, i2).applyMatrix4(mw);
      const e1 = B.clone().sub(A), e2 = C.clone().sub(A);
      const wa = e1.clone().cross(e2).length() / 2; if (wa < 1e-6) continue;
      const u1 = uv.getX(i1) - uv.getX(i0), v1 = uv.getY(i1) - uv.getY(i0), u2 = uv.getX(i2) - uv.getX(i0), v2 = uv.getY(i2) - uv.getY(i0);
      const ua = Math.abs(u1 * v2 - u2 * v1) / 2;
      if (ua < 1e-12) { stretchy++; continue; }   // collapsed UVs: a smear
      dens.push(Math.sqrt(ua / wa));
      // Jacobian of world(2D in-plane) → uv
      const ex = e1.clone().normalize(), nrm = e1.clone().cross(e2).normalize(), ey = nrm.clone().cross(ex);
      const x1 = e1.dot(ex), y1 = e1.dot(ey), x2 = e2.dot(ex), y2 = e2.dot(ey);
      const det = x1 * y2 - x2 * y1; if (Math.abs(det) < 1e-12) continue;
      // J = [u1 u2; v1 v2] * inv([x1 x2; y1 y2])
      const ia = y2 / det, ib = -x2 / det, ic = -y1 / det, id = x1 / det;
      const j00 = u1 * ia + u2 * ic, j01 = u1 * ib + u2 * id, j10 = v1 * ia + v2 * ic, j11 = v1 * ib + v2 * id;
      const s1 = Math.hypot(j00 + j11, j01 - j10) / 2 + Math.hypot(j00 - j11, j01 + j10) / 2, s2 = Math.abs(Math.hypot(j00 + j11, j01 - j10) / 2 - Math.hypot(j00 - j11, j01 + j10) / 2);
      const r = s2 > 1e-9 ? s1 / s2 : 99;
      an.push(r); if (r > 2.2) stretchy++;
    }
    if (!dens.length) continue;
    dens.sort((p, q) => p - q); an.sort((p, q) => p - q);
    out.push({ mesh: nameOf(m), tris: n, dens: dens[dens.length >> 1], p10: dens[Math.floor(dens.length * 0.1)], p90: dens[Math.floor(dens.length * 0.9)], aniso95: an[Math.floor(an.length * 0.95)] ?? 1, stretchy });
  }
  return out;
}

/** Support check: is there any surface (other than the instance itself) within `tol` below each floating base? */
export function supported(root: THREE.Object3D, bases: InstBase[], tol = 0.06, skip?: (o: THREE.Object3D) => boolean): InstBase[] {
  const targets: THREE.Object3D[] = [];
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && o.visible && !/outline|blob|sky|glow|colliders/i.test(o.name) && !skip?.(o)) { targets.push(o); if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).computeBoundingSphere(); } });
  const ray = new THREE.Raycaster(); ray.far = 4;
  const bad: InstBase[] = [];
  for (const b of bases) {
    // from 35 cm above the base down: the first surface that is not the instance itself
    ray.set(new THREE.Vector3(b.x, b.minY + 0.35, b.z), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObjects(targets, false);
    const hit = hits.find((h) => !(h.object === b.obj && (h as any).instanceId === b.i) && !(h.object.parent && b.obj && h.object.parent === b.obj.parent && /^props:/.test(h.object.parent.name) && (h as any).instanceId === b.i));
    const top = hit ? b.minY + 0.35 - hit.distance : -Infinity;
    const sup = Math.max(top, b.y0);
    if (b.minY - sup > tol) bad.push({ ...b, y0: sup });
  }
  return bad;
}

/**
 * Shading sanity per mesh: triangles whose vertex normals point against the face (lighting flipped: dark lit side,
 * lit dark side) and closed sub-meshes with negative signed volume (inside-out). Instanced meshes: the geometry once.
 */
export function normalsReport(root: THREE.Object3D, skip?: (o: THREE.Object3D) => boolean) {
  const out: { mesh: string; flipped: number; tris: number }[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh; if (!m.isMesh || skip?.(o)) return;
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material;
    if (!mat || mat.side === THREE.BackSide || (mat as any).flatShading) return;
    if ((mat as any).isMeshBasicMaterial || (mat as any).isShaderMaterial || (mat as any).isSpriteMaterial) return;   // unlit: normals unused
    const g = m.geometry as THREE.BufferGeometry, pos = g.attributes.position as THREE.BufferAttribute, nor = g.attributes.normal as THREE.BufferAttribute;
    if (!pos || !nor) return;
    const idx = g.index, n = idx ? idx.count / 3 : pos.count / 3;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), f = new THREE.Vector3(), vn = new THREE.Vector3();
    let bad = 0;
    for (let t = 0; t < n; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
      f.subVectors(b, a).cross(c.clone().sub(a)); if (f.lengthSq() < 1e-12) continue; f.normalize();
      vn.fromBufferAttribute(nor, i0).add(c.fromBufferAttribute(nor, i1)).add(b.fromBufferAttribute(nor, i2));
      if (vn.lengthSq() < 1e-9) continue;
      if (vn.normalize().dot(f) < -0.2) bad++;
    }
    if (bad) out.push({ mesh: nameOf(m), flipped: bad, tris: n });
  });
  return out;
}
