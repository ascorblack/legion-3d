/**
 * Static batching for the test dimension: a section full of separate item models (each = model + outline + rarity ring
 * meshes) becomes one mesh per material (the item models share toon / outline / glow materials), so ~100 items cost
 * ~12 draw calls instead of ~300. Geometries are cloned and baked into the section's space; the originals (cached,
 * shared with the game) are never touched. Sprites, points, skinned and instanced meshes are kept as they are.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4();

/** Merge the plain meshes under `root` by material; returns the new group (root's transform = identity space). */
export function bakeStatic(root: THREE.Object3D, opts: { castShadow?: boolean; name?: string } = {}): { group: THREE.Group; geos: THREE.BufferGeometry[]; calls: number; before: number } {
  root.updateMatrixWorld(true);
  _inv.copy(root.matrixWorld).invert();
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; order: number }>();
  const keep: THREE.Object3D[] = [];
  let before = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if ((o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints) { keep.push(o); before++; return; }
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) { if (mesh.isMesh) { keep.push(o); before++; } return; }
    if (Array.isArray(mesh.material) || !mesh.visible) return;
    before++;
    const src = mesh.geometry;
    const names = Object.keys(src.attributes).filter((n) => n === 'position' || n === 'normal' || n === 'color' || n === 'uv').sort();
    if (!names.includes('position')) return;
    const key = mesh.material.uuid + '|' + names.join(',') + '|' + (src.index ? 'i' : 'n') + '|' + mesh.renderOrder;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat: mesh.material, geos: [], order: mesh.renderOrder }));
    const g = new THREE.BufferGeometry();
    for (const n of names) g.setAttribute(n, src.getAttribute(n).clone());
    if (src.index) g.setIndex(src.index.clone());
    _m.multiplyMatrices(_inv, mesh.matrixWorld);
    g.applyMatrix4(_m);
    b.geos.push(g);
  });
  const group = new THREE.Group(); group.name = opts.name || 'debug:baked';
  const geos: THREE.BufferGeometry[] = [];
  for (const b of buckets.values()) {
    const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
    if (b.geos.length > 1) for (const g of b.geos) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere(); merged.computeBoundingBox();
    const m = new THREE.Mesh(merged, b.mat);
    m.renderOrder = b.order;
    m.castShadow = opts.castShadow ?? true; m.receiveShadow = true;
    group.add(m); geos.push(merged);
  }
  // sprites / skinned meshes: re-parent with their world transform
  for (const o of keep) {
    o.updateMatrixWorld(true);
    _m.multiplyMatrices(_inv, o.matrixWorld);
    o.removeFromParent();
    _m.decompose(o.position, o.quaternion, o.scale);
    group.add(o);
  }
  return { group, geos, calls: group.children.length, before };
}
