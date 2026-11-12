// Registry wiring of the asset models (src/world/fcart/registry.ts → src/world/faircats.ts): a registered model is built
// on the site's own rects (FcPlace), doors / signs keep working through BUILDING_XF, a failing or missing model falls
// back to the generic code; and the whole-fair q2 budget in view (≤ 120 calls / 130k tris), as the Town Kit test does.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as THREE from 'three';
import { fairCatsFixtureLayout } from '../dev/fixtures';
import { staticCity } from './world-fixture';
import { registerFcModel, fcModel, type FcModel, type FcPlace } from '../src/world/fcart/registry';
import { fcModelFor } from '../src/world/faircats';
import { entranceZ, BUILDING_XF } from '../src/world/buildings';
import { doorInteractables } from '../src/world/worldExt';
import { usedFcModels } from '../src/world/fcart/live';
import { toZ } from '../src/world/coords';
import { M } from '../src/world/batch';
import { fairCatsGround } from '../src/world/fcground';
import { fairCatsOf } from '../src/net/faircats';
import { stubDom } from './dom-stub';

const keep = new Map<string, FcModel | undefined>();
const swap = (m: FcModel) => { if (!keep.has(m.ref)) keep.set(m.ref, fcModel(m.ref)); registerFcModel(m); };
afterEach(() => { for (const [ref, m] of keep) if (m) registerFcModel(m); else registerFcModel({ ref, fp: '', build: () => { throw new Error('unregistered'); } }); keep.clear(); });

describe('new cats fair — q2 budget in view (whole world, buildCity)', () => {
  beforeAll(() => stubDom());
  it('≤ 120 draw calls and ≤ 130k triangles at the fair views', async () => {
    const { buildCity } = await import('../src/world');
    const { toX } = await import('../src/world/coords');
    const L = fairCatsFixtureLayout({ jail: true, magic: true }), g = fairCatsGround(fairCatsOf(L)!);
    const w = await buildCity(L, { quality: 2 } as never);
    const inView = (cam: THREE.PerspectiveCamera) => {
      const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      let calls = 0, tris = 0;
      w.root.updateMatrixWorld(true);
      w.root.traverse((o) => {
        const mm = o as THREE.InstancedMesh;
        if (!(mm.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine)) return;
        let v = o.visible; o.traverseAncestors((a) => { if (!a.visible) v = false; });
        if (!v || (mm.isInstancedMesh && mm.count === 0)) return;
        const gg = mm.geometry as THREE.BufferGeometry;
        if (o.frustumCulled && gg) { if (!gg.boundingSphere) gg.computeBoundingSphere(); const s = gg.boundingSphere!.clone().applyMatrix4(o.matrixWorld); if (!fr.intersectsSphere(s)) return; }
        calls++;
        if (mm.isMesh) tris += ((gg.index ? gg.index.count : gg.getAttribute('position').count) / 3) * (mm.isInstancedMesh ? mm.count : 1);
      });
      return { calls, tris };
    };
    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 400);
    const views: [string, number, number, number, number][] = [
      ['spawn', L.spawn[0], L.spawn[1], 2880, 1500], ['plaza', 2880, 2100, 2880, 1300], ['plateau', 3000, 900, 3800, 700],
      ['pond', 900, 2300, 2000, 2000], ['wall', 2880, 2700, 1200, 2950], ['forest-west', 600, 1500, -400, 1500], ['mine', 4600, 1000, 4925, 800],
      // site 12.11: «Здание гильдий» where the blue house h3 stood
      ['guild', 3470, 2700, 3565, 2400],
    ];
    const out: string[] = [];
    for (const [name, x, y, tx, ty] of views) {
      cam.position.set(toX(x), g(x, y) + 1.6, toZ(y)); cam.lookAt(toX(tx), g(tx, ty) + 1.2, toZ(ty)); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      w.update(0.016, 1, cam);
      const r = inView(cam);
      out.push(`${name}: ${r.calls} calls ${Math.round(r.tris)} tris`);
      expect(r.calls, name).toBeLessThanOrEqual(120);
      expect(r.tris, name).toBeLessThan(130000);
    }
    console.log('faircats q2 ' + out.join('; '));
    w.dispose();
  }, 120000);
});

describe('asset model registry wiring (faircats.ts)', () => {
  it('a registered building model gets the site rects; doors use the model front on foot[3]', () => {
    const got: FcPlace[] = [];
    swap({ ref: 'hall', fp: 'f00', build: (k, p) => { got.push(p); k.b.add('plaster', new THREE.BoxGeometry(1, 1, 1), M(28.8, 2, toZ(1400), 6, 4, 4), '#ffffff', 1); } });
    const L = fairCatsFixtureLayout({ jail: true, magic: true });
    const { rec, groundAt } = staticCity(true, L);
    expect(got.length).toBe(1);
    const p = got[0], sc = fairCatsOf(L)!, fb = sc.buildings.find((b) => b.id === 'hall')!;
    expect(p.vis).toEqual(fb.vis); expect(p.foot).toEqual(fb.foot); expect(p.door).toEqual({ x: fb.door.x, y: fb.door.y });
    expect(p.base).toBe(groundAt(fb.door.x, fb.door.y));
    expect(p.data?.id).toBe('hall');
    // the generic hall was not built: one piece under the tag
    expect(rec.pieces.filter((q) => q.tag === 'hall').length).toBe(1);
    const hall = L.buildings.find((b) => b.id === 'hall')!;
    expect(BUILDING_XF.get(hall)).toBeTruthy();
    expect(Math.abs(entranceZ(hall) - toZ(fb.foot[3]))).toBeLessThan(0.05);   // civic.ts civicDoorXf or the default (−3 cm)
    const door = doorInteractables(L, groundAt, () => undefined).find((d) => d.id === 'door:hall')!;
    expect((door.hit as THREE.Box3).max.z).toBeCloseTo(entranceZ(hall) + 0.3, 6);
    expect(usedFcModels().get('hall')).toBe('f00');
  });
  it('a model that throws falls back to the generic building; houses / items follow the same rule', () => {
    swap({ ref: 'hall', fp: 'x', build: () => { throw new Error('boom'); } });
    const houses: FcPlace[] = [], lamps: FcPlace[] = [];
    swap({ ref: 'house:teal', fp: 'h', build: (_k, p) => { houses.push(p); } });
    swap({ ref: 'i:lamp', fp: 'l', build: (_k, p) => { lamps.push(p); } });
    const L = fairCatsFixtureLayout({ jail: true, magic: true });
    const { rec } = staticCity(true, L);
    expect(rec.pieces.filter((q) => q.tag === 'hall').length).toBeGreaterThan(5);   // the generic hall
    expect(houses.length).toBe(1); expect(houses[0].data?.roof).toBe('teal');
    const sc = fairCatsOf(L)!;
    expect(lamps.length).toBe(sc.items.filter((i) => i.k === 'lamp').length);
    expect(lamps[0].door).toEqual({ x: sc.items.find((i) => i.k === 'lamp')!.x, y: sc.items.find((i) => i.k === 'lamp')!.y });
  });
  it('Town Kit: buildings ask only tk:<id>; shared houses / items fall back to the fair model', () => {
    swap({ ref: 'magic', fp: 'm', build: () => {} });
    swap({ ref: 'i:well', fp: 'w', build: () => {} });
    expect(fcModelFor('magic', true)).toBeUndefined();
    expect(fcModelFor('magic', false)?.fp).toBe('m');
    expect(fcModelFor('i:well', true)?.fp).toBe('w');
  });
});

