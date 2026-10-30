/**
 * Visual round 2 (city world): structure of the new dressing.
 *  - ground foliage: spots on the ground (never in the canal, never floating), near set capped by quality, off at q0;
 *  - hero props merged (one plain mesh per material per street stretch: draw-call budget);
 *  - light spill quads never over the canal / lava;
 *  - former invisible walls dressed: hedges at the village / fair side edges, the shop's footboard; bridge rail solids
 *    follow the hump (no rail above your feet mid-span).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { stubDom } from './dom-stub';
import { staticCity, staticVillage } from './world-fixture';
import { scatterFoliage, plantRects } from '../src/world/scatter';
import { SPOT } from '../src/world/foliage';
import { SolidMap, collectSolids } from '../src/world/solid';
import { toX, toZ, fromX, fromZ } from '../src/world/coords';

beforeAll(() => stubDom());

const drawables = (root: THREE.Object3D) => {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    const m = o as THREE.InstancedMesh;
    if (!(m.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine)) return;
    let v = true; o.traverseAncestors((a) => { if (!a.visible) v = false; });
    if (v && o.visible && (!m.isInstancedMesh || m.count > 0)) out.push(o);
  });
  return out;
};

describe('city world dressing (visual round 2)', () => {
  for (const town of ['fair', 'village'] as const) {
    it(`${town}: foliage grows on the ground, out of the water and the walls`, () => {
      const { L, k, spec, groundAt } = town === 'fair' ? staticCity() : staticVillage();
      const map = new SolidMap(collectSolids(L, spec, k.solids ?? [], k.inst));
      const a = scatterFoliage(k, L, spec, groundAt, (X, Z) => map.top(X, Z));
      const n = a.length / SPOT;
      expect(n).toBeGreaterThan(town === 'fair' ? 800 : 1500);
      const bad: string[] = [];
      for (let i = 0; i < n; i++) {
        const x = a[i * SPOT], y = a[i * SPOT + 1], z = a[i * SPOT + 2], g = groundAt(fromX(x), fromZ(z));
        if (!Number.isFinite(x + y + z)) bad.push(`NaN at ${i}`);
        if (Math.abs(y - g) > 0.03 && !(spec.hasLow && Math.abs(z - toZ(spec.wallY)) < 1)) bad.push(`tuft ${x.toFixed(2)},${z.toFixed(2)} at y ${y.toFixed(2)} over ground ${g.toFixed(2)}`);
        if (spec.canal && z > toZ(spec.canal[0]) && z < toZ(spec.canal[1]) && !spec.bridges.some(([b0, b1]) => x > toX(b0) && x < toX(b1))) bad.push(`tuft in the canal at ${x.toFixed(2)},${z.toFixed(2)}`);
        if (map.top(x, z) === Infinity && town === 'village') bad.push(`tuft inside a solid at ${x.toFixed(2)},${z.toFixed(2)}`);
      }
      expect(bad.slice(0, 10)).toEqual([]);
      if (town === 'fair') {
        const p = plantRects(k.plant ?? []);
        expect(p.length / SPOT).toBeGreaterThan(100);   // the ledge troughs / lower bed are planted
        expect((k.blobs ?? []).length / 5).toBeGreaterThan(10);   // and grounded with contact shadows
      }
    });
  }

  it('fair at q2: foliage near set capped, off at q0; hero props merged; spill off the canal; draw-call budget', async () => {
    const { fixtureLayout } = await import('../dev/fixtures');
    const { buildCity } = await import('../src/world');
    const { groundSpec } = await import('../src/world/ground');
    const L = fixtureLayout();
    const w = await buildCity(L, { quality: 2 } as never);
    const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400);
    cam.position.set(24.6, 2.2, 8); cam.lookAt(24.6, 1, 0); cam.updateMatrixWorld();
    w.update(0.016, 1, cam);
    const fol = w.root.getObjectByName('world:foliage')!;
    const grass = fol.getObjectByName('fx:grass') as THREE.InstancedMesh, flowers = fol.getObjectByName('fx:flowers') as THREE.InstancedMesh;
    expect(grass.count).toBeGreaterThan(100);
    expect(grass.count).toBeLessThanOrEqual(2200);
    expect(flowers.count).toBeLessThanOrEqual(660);
    for (let i = 0; i < grass.count; i++) {
      const e = grass.instanceMatrix.array as Float32Array;
      expect(Math.hypot(e[i * 16 + 12] - 24.6, e[i * 16 + 14] - 8)).toBeLessThan(21);
    }
    // hero props: one group per street stretch, ≤ 9 plain meshes each (materials + outline)
    const heroes = w.root.children.flatMap((c) => c.children).filter((o) => o.name === 'props:hero');
    expect(heroes.length).toBeGreaterThan(0);
    for (const h of heroes) { expect(h.children.length).toBeLessThanOrEqual(9); for (const m of h.children) expect((m as THREE.InstancedMesh).isInstancedMesh).toBeFalsy(); }
    // spill pools never over the canal
    const spec = groundSpec(L), spill = w.root.getObjectByName('world:spill') as THREE.InstancedMesh, m = new THREE.Matrix4(), p = new THREE.Vector3(), sc = new THREE.Vector3(), q = new THREE.Quaternion();
    expect(spill.count).toBeGreaterThan(10);
    for (let i = 0; i < spill.count; i++) {
      spill.getMatrixAt(i, m); m.decompose(p, q, sc);
      const c0 = toZ(spec.canal![0]), c1 = toZ(spec.canal![1]);
      expect(p.z - sc.z > c1 || p.z + sc.z < c0 || p.z + sc.z < c0 + 0.6 || p.z - sc.z > c1 - 0.6, `spill ${i} at z ${p.z.toFixed(2)} r ${sc.z.toFixed(2)}`).toBe(true);
    }
    // the whole static world + props + fx (no characters, no events): every draw at q2 (no culling) stays in budget
    const calls = drawables(w.root).length;
    expect(calls).toBeLessThanOrEqual(110);
    w.setQuality(0);
    expect(fol.visible).toBe(false);
    w.dispose();
  });

  it('former invisible walls are dressed: village side hedges, the shop footboard, bridge rails follow the hump', () => {
    const v = staticVillage();
    const W = toX(v.L.W);
    const hedge = v.k.inst.placed.get('v:bush') ?? [];
    expect(hedge.filter((b) => b.x < 1).length).toBeGreaterThan(8);
    expect(hedge.filter((b) => b.x > W - 1.5).length).toBeGreaterThan(8);
    const f = staticCity();
    const map = new SolidMap(collectSolids(f.L, f.spec, f.k.solids ?? [], f.k.inst));
    const [b0, b1] = f.spec.bridges[0], x = toX(b0) + 0.1 + 0.08;
    const c0 = toZ(f.spec.canal![0]), c1 = toZ(f.spec.canal![1]);
    const mid = map.top(x, (c0 + c1) / 2), end = map.top(x, c0 - 0.25);
    expect(mid - end).toBeGreaterThan(0.1);   // higher mid-span, as the rail is
    void b1;
  });
});

describe('city world + Halloween at q2 (events on): draw and triangle budget at the views of record', () => {
  /** What the renderer would draw for this camera: visible meshes / points / lines in the frustum (frustumCulled ones
   *  tested by their bounding sphere), instanced meshes with count > 0; tris = indexed or position count / 3 × count. */
  const inView = (roots: THREE.Object3D[], cam: THREE.PerspectiveCamera) => {
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    let calls = 0, tris = 0;
    const per: Record<string, number> = {};
    for (const r of roots) { r.updateMatrixWorld(true); for (const o of drawables(r)) {
      const m = o as THREE.InstancedMesh, g = m.geometry as THREE.BufferGeometry;
      if (o.frustumCulled && g) { if (!g.boundingSphere) g.computeBoundingSphere(); const s = g.boundingSphere!.clone().applyMatrix4(o.matrixWorld); if (!fr.intersectsSphere(s)) continue; }
      calls++;
      if (m.isMesh) { const n = ((g.index ? g.index.count : g.getAttribute('position').count) / 3) * (m.isInstancedMesh ? m.count : 1) * (g.drawRange.count < Infinity ? Math.min(1, g.drawRange.count / (g.index ? g.index.count : g.getAttribute('position').count)) : 1); tris += n; per[o.name] = (per[o.name] ?? 0) + n; }
    } }
    return { calls, tris, per };
  };
  it('fair-lower / fair-spawn / fair-fp-shop: the event adds ≤ 8 draws and ≤ 13k tris in view; world + event ≤ 110 draws, ≤ 120k tris', async () => {
    const { fixtureLayout } = await import('../dev/fixtures');
    const { buildCity } = await import('../src/world');
    const halloween = (await import('../src/events/halloween')).default;
    const L = fixtureLayout();
    const w = await buildCity(L, { quality: 2 } as never);
    const scene = new THREE.Scene(); scene.add(w.root); scene.fog = new THREE.Fog('#8a6a9a', 34, 260); scene.background = new THREE.Color('#0f0d2a');
    const group = new THREE.Group(); scene.add(group);
    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 400);
    const frames = new Set<(dt: number, t: number) => void>();
    const ctx = { group, scene, world: w, layout: L, groundAt: (X: number, Z: number) => w.groundAt(fromX(X), fromZ(Z)), onFrame: (fn: never) => { frames.add(fn); return () => frames.delete(fn); },
      quality: () => 2, onQuality: () => () => {}, renderer: { domElement: { height: 540 } }, camera: cam, toast: () => {} };
    // light materials are one mesh each (a draw per x-chunk only for the heavy ones)
    const { SMALL_TRIS } = await import('../src/world/batch');
    const byKey = new Map<string, { n: number; tris: number }>();
    w.root.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh || !o.name.startsWith('city:')) return; const g = m.geometry; const e = byKey.get(o.name) ?? { n: 0, tris: 0 }; e.n++; e.tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3; byKey.set(o.name, e); });
    for (const [k, e] of byKey) if (e.tris <= SMALL_TRIS) expect(e.n, k).toBe(1);
    expect([...byKey.values()].filter((e) => e.tris <= SMALL_TRIS).length).toBeGreaterThan(4);
    const dispose = halloween.setup(ctx as never);
    // views of record (vgeo views.sh): TP camera ≈ 3.2 m behind and 1.4 m over the feet, looking along the yaw
    const VIEWS: [string, number, number, number, number, number][] = [['fair-lower', 1400, 1480, 0.2, -0.02, 3.2], ['fair-spawn', 2460, 1010, 0, -0.12, 3.2], ['fair-fp-shop', 4500, 1000, 0.5, 0.05, 0]];
    const out: string[] = [];
    for (const [n, px, py, yaw, pitch, back] of VIEWS) {
      const X = toX(px), Z = toZ(py), gy = w.groundAt(px, py);
      cam.rotation.set(pitch, yaw, 0, 'YXZ');
      cam.position.set(X + Math.sin(yaw) * back, gy + (back ? 1.6 : 1.15), Z + Math.cos(yaw) * back);
      cam.updateMatrixWorld();
      w.update(0.016, 1, cam);
      let t = 0; for (let i = 0; i < 30; i++) { t += 1 / 60; for (const f of frames) f(1 / 60, t); }
      const ev = inView([group], cam), all = inView([w.root, group], cam);
      out.push(`${n}: event ${ev.calls} draws ${Math.round(ev.tris)} tris; world+event ${all.calls} draws ${Math.round(all.tris)} tris; ${JSON.stringify(ev.per)}`);
      if (process.env.VG_LOG) console.log(out[out.length - 1]);
      expect(ev.calls, n).toBeLessThanOrEqual(8);
      expect(ev.tris, n).toBeLessThan(13000);
      expect(all.calls, n).toBeLessThanOrEqual(110);
      expect(all.tris, n).toBeLessThan(120000);
    }
    console.log(out.join('\n'));
    dispose(); w.dispose();
  });
});
