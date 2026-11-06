/**
 * The fair's shop models (src/world/fcart/shops.ts) built standalone into a Ctx on the site's own rects
 * (test/fixtures/faircats-map.json): they register under their refs with the fingerprints of src/data/fcart-fp.json,
 * stay inside their plot (x within vis, front on foot[3]), use only their declared batch materials (≤ 6 draw calls),
 * keep a triangle budget, add no solids and drop detail at q0.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import FX from './fixtures/faircats-map.json';
import FP from '../src/data/fcart-fp.json';
import { Batch } from '../src/world/batch';
import { paletteOf } from '../src/world/palette';
import { rng, type SignAtlas } from '../src/world/textures';
import { Instancer } from '../src/world/instancer';
import { toX, toZ } from '../src/world/coords';
import type { Ctx } from '../src/world/kit';
import { fcModel, type FcPlace } from '../src/world/fcart/registry';
import { SHOP_MATS, fcShopXf } from '../src/world/fcart/shops';
import { BUILDING_XF, entranceZ } from '../src/world/buildings';
import type { Building } from '../src/contracts';
import { ZRecorder } from '../src/world/zfight';

const REFS = ['tent', 'trainer', 'shop', 'auction', 'forge', 'anvil', 'board'];
const TRI_MAX: Record<string, number> = { tent: 6000, trainer: 6000, shop: 12000, auction: 9000, forge: 8000, anvil: 6000, board: 3000 };

function build(ref: string, quality = 2, base = 0) {
  const b = (FX as any).BUILDINGS.find((q: any) => q.id === ref);
  const signs = { add: () => ({ uv: [0, 0, 1, 1] as [number, number, number, number], aspect: 4 }), texture: null } as unknown as SignAtlas;
  const k: Ctx = { b: new Batch(14), pal: paletteOf('cats'), signs, inst: new Instancer(), glows: [], lights: [], bulbs: [], wires: [], rnd: rng(7), quality, lowH: 0, wallZ: 0, colliders: [], pools: [], solids: [] };
  const mats = new Map<string, number>(), bb = new THREE.Box3();
  k.b.recorder = (mat, g) => { g.computeBoundingBox(); bb.union(g.boundingBox!); mats.set(mat, (mats.get(mat) ?? 0) + g.attributes.position.count / 3); };
  const p: FcPlace = { vis: b.vis, foot: b.foot, door: b.door, base, data: { id: ref, sign: b.sign } };
  fcModel(ref)!.build(k, p);
  const tris = [...mats.values()].reduce((a, c) => a + c, 0);
  return { k, b, p, mats, bb, tris };
}

describe('fcart shops', () => {
  for (const ref of REFS) it(`${ref}: registered, inside its plot, its materials only, budget`, () => {
    const m = fcModel(ref);
    expect(m, ref).toBeTruthy();
    expect(m!.fp).toBe((FP as any)[ref].fp);
    const { k, b, mats, bb, tris } = build(ref);
    const used = [...mats.keys()];
    expect(used.every((u) => SHOP_MATS[ref].includes(u as never)), `${ref} uses ${used}`).toBe(true);
    expect(used.length).toBeLessThanOrEqual(6);
    expect(tris).toBeLessThan(TRI_MAX[ref]);
    // x within the drawn box (+ eaves / flaps 0.7 m), front on foot[3] (rug, ramp, easel ≤ 0.9 m out), back ≥ foot[1] − 0.5
    expect(bb.min.x).toBeGreaterThan(toX(b.vis[0]) - 0.7);
    expect(bb.max.x).toBeLessThan(toX(b.vis[2]) + 0.7);
    expect(bb.max.z).toBeLessThan(toZ(b.foot[3]) + 0.9);
    expect(bb.max.z).toBeGreaterThan(toZ(b.foot[3]) - 0.3);
    expect(bb.min.z).toBeGreaterThan(toZ(b.foot[1]) - 0.5);
    expect(bb.min.y).toBeGreaterThan(-0.1);
    expect(bb.max.y).toBeGreaterThan(1.8);
    expect(bb.max.y).toBeLessThan(6.5);
    expect(k.solids!.length, 'no solids (the site obstacles are the walk truth)').toBe(0);
    expect(k.colliders.length).toBe(6);
    console.log(`[fcart-shops] ${ref}: calls ${used.length} (${used.join(',')}) tris ${Math.round(tris)} h ${bb.max.y.toFixed(2)} m`);
  });

  it('no coplanar overlapping surfaces inside a model (z-fighting)', () => {
    const all: string[] = [];
    for (const ref of REFS) {
      const b = (FX as any).BUILDINGS.find((q: any) => q.id === ref);
      const signs = { add: () => ({ uv: [0, 0, 1, 1] as [number, number, number, number], aspect: 4 }), texture: null } as unknown as SignAtlas;
      const k: Ctx = { b: new Batch(14), pal: paletteOf('cats'), signs, inst: new Instancer(), glows: [], lights: [], bulbs: [], wires: [], rnd: rng(7), quality: 2, lowH: 0, wallZ: 0, colliders: [], pools: [], solids: [] };
      const rec = new ZRecorder(); rec.keepBoxes = true; k.b.recorder = rec.add; k.b.tag = ref;
      fcModel(ref)!.build(k, { vis: b.vis, foot: b.foot, door: b.door, base: 0, data: { id: ref, sign: b.sign } });
      for (const h of rec.find(0.004, 2e-4, () => 0)) all.push(`${h.a} × ${h.b} at ${h.at} n ${h.normal} area ${h.area.toFixed(4)} | ${rec.boxes[h.ia]} | ${rec.boxes[h.ib]}`);
    }
    if (all.length) console.log(all.join('\n'));
    expect(all.length).toBe(0);
  });

  it('q0 drops detail, base lifts the model', () => {
    for (const ref of REFS) {
      const a = build(ref, 2), c = build(ref, 0), d = build(ref, 2, 3);
      expect(c.tris, ref).toBeLessThanOrEqual(a.tris);
      expect(d.bb.min.y - a.bb.min.y).toBeCloseTo(3, 3);
    }
  });

  it('fcShopXf: the door hit box stands on the front (foot[3])', () => {
    const { b, p } = build('shop');
    const bld = { id: 'shop', title: 'Торговые ряды', hit: [b.vis[0], b.vis[2], b.vis[1], b.vis[3]], door: b.door } as unknown as Building;
    fcShopXf(bld, p);
    expect(BUILDING_XF.get(bld)).toBeTruthy();
    expect(entranceZ(bld)).toBeCloseTo(toZ(b.foot[3]) - 0.03, 5);
  });
});
