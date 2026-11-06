/**
 * fcart-houses: the asset-faithful house and decor models (src/world/fcart/houses.ts) built standalone into a Ctx:
 * bounds (inside the site footprint), draw calls (distinct materials / instanced parts), triangles, kinds registered,
 * fingerprints pinned to src/data/fcart-fp.json.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Batch } from '../src/world/batch';
import { paletteOf } from '../src/world/palette';
import { rng } from '../src/world/textures';
import { Instancer } from '../src/world/instancer';
import { toX, toZ } from '../src/world/coords';
import type { Ctx } from '../src/world/kit';
import type { SignAtlas } from '../src/world/textures';
import fx from './fixtures/faircats-map.json';
import fp from '../src/data/fcart-fp.json';
import { fcModel } from '../src/world/fcart/registry';
import { registerFcItemKinds, placeFcItem, hipRoofGeo, floraOf, signPattern, FC_ITEM_KINDS } from '../src/world/fcart/houses';

function ctx(): { k: Ctx; pieces: { mat: string; tris: number; box: THREE.Box3 }[] } {
  const signs = { add: () => ({ uv: [0, 0, 1, 1] as [number, number, number, number], aspect: 4 }), texture: null } as unknown as SignAtlas;
  const k: Ctx = { b: new Batch(14), pal: paletteOf('cats'), signs, inst: new Instancer(), glows: [], lights: [], bulbs: [], wires: [], rnd: rng(1234), quality: 2, lowH: 0, wallZ: 0, colliders: [], pools: [], solids: [] };
  const pieces: { mat: string; tris: number; box: THREE.Box3 }[] = [];
  k.b.recorder = (mat, g) => { g.computeBoundingBox(); pieces.push({ mat, tris: g.attributes.position.count / 3, box: g.boundingBox!.clone() }); };
  return { k, pieces };
}

const HOUSES: any[] = (fx as any).HOUSES;
const refOf = (h: any) => 'house:' + (h.k === 'tavern' ? 'tavern' : h.roof);

describe('fcart houses', () => {
  for (const h of HOUSES) {
    const ref = refOf(h);
    it(`${ref} (${h.id}): model, fingerprint, bounds, budget`, () => {
      const m = fcModel(ref)!;
      expect(m, ref).toBeTruthy();
      expect(m.fp).toBe((fp as any)[ref].fp);
      const { k, pieces } = ctx();
      m.build(k, { vis: h.vis, foot: h.foot, door: h.door, base: 0, data: { id: h.id, roof: h.roof, k: h.k } });
      const box = new THREE.Box3(); for (const p of pieces) box.union(p.box);
      const x0 = toX(h.foot[0]), x1 = toX(h.foot[2]), zf = toZ(h.foot[3]), zb = toZ(h.foot[1]);
      // the body stays on its foot (the tavern's hanging board and the steps may stand out a little)
      expect(box.min.x).toBeGreaterThan(x0 - 0.5); expect(box.max.x).toBeLessThan(x1 + 1.1);
      expect(box.max.z).toBeLessThan(zf + 0.8); expect(box.min.z).toBeGreaterThan(zb - 1.2);
      expect(box.min.y).toBeGreaterThan(-0.1); expect(box.max.y).toBeGreaterThan(2.8); expect(box.max.y).toBeLessThan(6.5);
      const calls = new Set(pieces.map((p) => p.mat)).size, tris = pieces.reduce((s, p) => s + p.tris, 0);
      expect(calls).toBeLessThanOrEqual(8);
      expect(tris).toBeLessThan(4500);
      // eslint-disable-next-line no-console
      console.log(`${ref}\tcalls ${calls}\ttris ${tris}\tbox ${(box.max.x - box.min.x).toFixed(2)}x${(box.max.y).toFixed(2)}x${(box.max.z - box.min.z).toFixed(2)}`);
    });
  }
  it('all houses together stay within 8 materials', () => {
    const { k, pieces } = ctx();
    for (const h of HOUSES) fcModel(refOf(h))!.build(k, { vis: h.vis, foot: h.foot, door: h.door, base: 0, data: { id: h.id, roof: h.roof, k: h.k } });
    expect(new Set(pieces.map((p) => p.mat)).size).toBeLessThanOrEqual(8);
  });
  it('hipped roof: planar faces, 3 m rise fits', () => {
    const g = hipRoofGeo(2, 1.5, 1, 1.1); g.computeBoundingBox();
    expect(g.boundingBox!.max.y).toBeCloseTo(1.1); expect(g.attributes.position.count / 3).toBe(6);
  });
});

describe('fcart items', () => {
  const items: any[] = (fx as any).ITEMS;
  it('fingerprints pinned, one model per kind', () => {
    for (const kind of FC_ITEM_KINDS) { expect(fcModel('i:' + kind)?.fp, kind).toBe((fp as any)['i:' + kind].fp); }
  });
  it('every site item of these kinds is placed by an instanced registered kind (no per-object geometry)', () => {
    const { k, pieces } = ctx(); registerFcItemKinds(k);
    const lh: number[] = [];
    let n = 0;
    for (const it of items) { if (!(FC_ITEM_KINDS as readonly string[]).includes(it.k)) continue; expect(placeFcItem(k, it, 0.1, 2.75, lh), it.k).toBe(true); n++; }
    expect(n).toBeGreaterThan(60);
    expect(pieces.length).toBe(0);   // nothing in the static batch
    for (const [kind, list] of k.inst.placed) { expect(k.inst.has(kind), kind).toBe(true); expect(list.length).toBeGreaterThan(0); }
    expect(lh.length).toBe(3 * items.filter((i) => i.k === 'lamp').length);
  });
  it('per-kind budget: ≤ 2 parts, tris, bounds', () => {
    const { k } = ctx(); registerFcItemKinds(k);
    const rows: string[] = [];
    const kinds = new Set<string>();
    for (const it of items) { if ((FC_ITEM_KINDS as readonly string[]).includes(it.k)) placeFcItem(k, it, 0, 2.75, []); }
    for (const kind of k.inst.placed.keys()) kinds.add(kind);
    const parts = (k.inst as any).kinds as Map<string, { geo: THREE.BufferGeometry; mat: string }[]>;
    for (const kind of kinds) {
      const ps = parts.get(kind)!; let tris = 0; const box = new THREE.Box3();
      for (const p of ps) { tris += p.geo.attributes.position.count / 3; p.geo.computeBoundingBox(); box.union(p.geo.boundingBox!); }
      expect(ps.length, kind).toBeLessThanOrEqual(2);
      expect(tris, kind).toBeLessThan(1600);
      expect(box.max.y, kind).toBeLessThan(4);
      for (const p of ps) expect(p.geo.attributes.color, kind).toBeTruthy();
      rows.push(`${kind}\tcalls ${ps.length}\ttris ${tris}\tbox ${(box.max.x - box.min.x).toFixed(2)}x${box.max.y.toFixed(2)}x${(box.max.z - box.min.z).toFixed(2)}`);
    }
    // eslint-disable-next-line no-console
    console.log(rows.join('\n'));
  });
  it('helpers', () => {
    expect(signPattern([['A', 'S'], ['B', 'NE'], ['C', 'W']])).toBe('RRL');
    expect(floraOf({ x: 2700, y: 1660 })).toBeGreaterThanOrEqual(0);
  });
});

describe('fcart houses: materials', () => {
  it('lists materials per house', () => {
    for (const h of HOUSES) {
      const { k, pieces } = ctx();
      fcModel(refOf(h))!.build(k, { vis: h.vis, foot: h.foot, door: h.door, base: 0, data: { id: h.id, roof: h.roof, k: h.k } });
      const by: Record<string, number> = {}; for (const p of pieces) by[p.mat] = (by[p.mat] ?? 0) + p.tris;
      // eslint-disable-next-line no-console
      console.log(refOf(h), JSON.stringify(by));
    }
  });
});
