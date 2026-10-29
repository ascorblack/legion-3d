import { describe, it, expect } from 'vitest';
import type * as THREE from 'three';
import { staticVillage, staticCity } from './world-fixture';
import { SolidMap, collectSolids, makeSolidTop } from '../src/world/solid';
import { toX, toZ } from '../src/world/coords';
import { villageOf, depthOf, propKind, depthK, bandOf, VK } from '../src/world/village';
import { entranceZ, BUILDING_XF } from '../src/world/buildings';
import { doorInteractables } from '../src/world/worldExt';
import { villageScene } from '../src/net/town';
import { villageFixtureLayout } from '../dev/fixtures';
import vmap from './fixtures/village-map.json';

const { L, k, spec, rec: R0, groundAt } = staticVillage(true);
// recorded pieces with their world AABB
const rec = { pieces: R0.pieces.map((p, i) => { const b = R0.boxes[i]; return { ...p, box: { min: { x: b[0], y: b[2], z: b[4] }, max: { x: b[1], y: b[3], z: b[5] } } }; }) };
const top = makeSolidTop(L, new SolidMap(collectSolids(L, spec, k.solids ?? [], k.inst)));
const V = villageOf(L)!;
const G = (vmap as any).grid;

describe('hand-made village ★1 — layout data (src/net/town.ts villageScene)', () => {
  it('copies streets, plazas, water, bridges, lots with depth, cottages and props from the towngen layout', () => {
    expect(V.id).toBe('d99');
    expect(V.roads.length).toBe(4);
    expect(V.roads[0]).toMatchObject({ k: 'main', w: 44 });
    expect(V.plazas[0]).toMatchObject({ k: 'central', mark: 'well' });
    expect(V.water.map((w) => ('e' in w ? 'e' : 'b'))).toEqual(['e', 'b', 'b']);
    expect(V.bridges).toEqual([{ x0: 700, x1: 780, y0: 1046, y1: 1164 }]);
    expect(V.lots.filter((l) => l.B).map((l) => l.k).sort()).toEqual(['hall', 'shop', 'storage', 'tent']);
    expect(V.houses.length).toBe(3);
    expect(V.props.find((p) => p.k === 'well')!.foot).toEqual([62, 22]);
  });
  it('is null for a generated town and survives missing / hostile fields', () => {
    expect(villageScene({ roads: [] })).toBeNull();
    expect(villageScene(null)).toBeNull();
    const v = villageScene({ hand: 'x1', roads: [{ pts: [[1, 2]] }, { k: 'main', pts: [[0, 900], ['a', 2], [100, 905]] }], water: [{ e: [1, 2, -3, 4] }, { b: [0, 0, 10, 10] }], lots: [{ k: 'hall', x0: 10, x1: 5 }, { k: 'shop', x0: 0, x1: 100, B: 1000, s: 99 }], props: [{ k: '<b>', x: 1, y: 2 }] })!;
    expect(v.roads).toEqual([{ k: 'main', w: 36, pts: [[0, 900], [100, 905]] }]);
    expect(v.water).toEqual([{ k: 'water', b: [0, 0, 10, 10] }]);
    expect(v.lots).toEqual([{ k: 'shop', x0: 0, x1: 100, B: 1000, s: 1 }]);
    expect(v.props[0].k).toBe('thing');
    expect(v.plazas).toEqual([]); expect(v.bridges).toEqual([]); expect(v.houses).toEqual([]);
  });
  it('depth: from the lot (B, s), else from the hit box; back row / anvil / mine stay in the back row', () => {
    const by = (id: string) => L.buildings.find((b) => b.id === id)!;
    expect(depthOf(L, by('hall'))).toEqual({ B: 1232, s: 1.42, cx: 1850 });
    expect(depthOf(L, by('tent'))).toMatchObject({ B: 980, s: 1.29 });
    for (const id of ['gate', 'forge', 'anvil', 'mine', 'board', 'magic', 'trainer']) expect(depthOf(L, by(id)), id).toBeNull();
    const noLots = { ...L, village: { ...V, lots: [] } } as any;
    expect(depthOf(noLots, by('shop'))).toEqual({ B: 1240, s: depthK(1240), cx: (by('shop').hit[0] + by('shop').hit[1]) / 2 });
    expect(depthOf(noLots, by('tent'))).toMatchObject({ B: 980 });
    expect(depthOf(staticCity().L, staticCity().L.buildings[0])).toBeNull();   // the fair: never
  });
  it('maps prop kinds (with a sane fallback for the artist\'s own kinds)', () => {
    const pk = (k: string, tall = 0, foot: [number, number] | null = [20, 8]) => propKind({ k, tall, foot });
    expect(pk('oak2', 300)).toBe('tree'); expect(pk('rowanT', 230)).toBe('tree'); expect(pk('lamp2')).toBe('lamp'); expect(pk('amberlamp')).toBe('lamp');
    expect(pk('glowshroom')).toBe('shroom'); expect(pk('stump')).toBe('stump'); expect(pk('haystack')).toBe('hay'); expect(pk('flowerbed')).toBe('bed');
    expect(pk('flowers', 0, null)).toBe('flowers'); expect(pk('hives', 80)).toBe('barrel'); expect(pk('wcamp', 100)).toBe('crate');
    expect(pk('rootarch', 120)).toBe('fence'); expect(pk('racks', 120)).toBe('fence'); expect(pk('obelisk', 280)).toBe('statue');
    expect(pk('mystery', 260)).toBe('tree'); expect(pk('mystery', 40)).toBe('crate'); expect(pk('mystery', 0, null)).toBe('skip');
  });
});

describe('hand-made village ★1 — 3D (src/world/village.ts)', () => {
  it('every walkable cell of the site grid is walkable in 3D (no Infinity solid there)', () => {
    const bad: string[] = []; let n = 0;
    for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
      if (G.G[r * G.cols + c] !== '1') continue;
      const x = c * G.C + G.C / 2, y = L.area.y0 + r * G.C + G.C / 2;
      if (!L.free(x, y) || y < 816) continue;   // the facade line row: attachments may stand there (as at the fair / camp)
      n++;
      if (top(x, y) === Infinity) bad.push(`${x},${y}`);
    }
    expect(n).toBeGreaterThan(8000);
    expect(bad, bad.slice(0, 16).join(' ')).toEqual([]);
  });
  it('lower-street buildings stand on their own base line: solid across their obstacle, walkable behind and in front', () => {
    for (const id of ['hall', 'shop', 'storage', 'tent']) {
      const b = L.buildings.find((q) => q.id === id)!, d = depthOf(L, b)!, cx = d.cx;
      expect(top(cx, d.B - 20), `${id} body`).toBe(Infinity);
      const band = bandOf(L, b.hit[0], b.hit[1], d.B)!;
      expect(top(cx, band.back - 8), `${id} behind`).not.toBe(Infinity);
      expect(top(b.door.x, b.door.y), `${id} door`).not.toBe(Infinity);
      // the model really is down there (not in the back row): its pieces reach the base line, scaled up by s
      const pcs = rec.pieces.filter((p: any) => p.tag === id);
      expect(pcs.length, id).toBeGreaterThan(10);
      const zs = pcs.map((p: any) => p.box.max.z), xs0 = Math.min(...pcs.map((p: any) => p.box.min.x)), xs1 = Math.max(...pcs.map((p: any) => p.box.max.x));
      expect(Math.max(...zs), id).toBeGreaterThan(toZ(band.back));
      expect(Math.max(...zs), id).toBeLessThan(toZ(band.front) + 0.05);
      expect(Math.min(...pcs.map((p: any) => p.box.min.z)), id).toBeGreaterThan(toZ(band.back) - 0.01);
      expect(xs1 - xs0, id).toBeGreaterThan(toX(b.hit[1] - b.hit[0]) * 0.9);
      expect(BUILDING_XF.get(b)?.s).toBe(d.s);
    }
  });
  it('doors: the hit box of a lower-street building is at its own facade, in reach of its door point', () => {
    const its = doorInteractables(L, groundAt, () => undefined);
    for (const id of ['hall', 'shop', 'storage', 'tent']) {
      const b = L.buildings.find((q) => q.id === id)!, it = its.find((i) => i.id === 'door:' + id)! as unknown as { hit: THREE.Box3; reach: number };
      const zE = entranceZ(b), dz = toZ(b.door.y);
      expect(zE, id).toBeGreaterThan(toZ(depthOf(L, b)!.B) - 1.8);
      expect(zE, id).toBeLessThan(dz);
      expect(it.hit.min.x).toBeLessThan(toX(b.door.x)); expect(it.hit.max.x).toBeGreaterThan(toX(b.door.x));
      expect(dz - it.hit.max.z, id).toBeLessThan(it.reach!);
      expect(it.hit.max.y - it.hit.min.y, id).toBeGreaterThan(2.3);   // drawn bigger: the opening too
    }
    // back-row doors unchanged
    const forge = L.buildings.find((q) => q.id === 'forge')!;
    expect(entranceZ(forge)).toBeLessThan(0.5);
  });
  it('water is solid, the bridge over the brook and the plaza are walkable, cottages are solid', () => {
    expect(top(3100, 1400)).toBe(Infinity);           // pond
    expect(top(600, 1100)).toBe(Infinity);            // brook
    expect(top(740, 1100)).not.toBe(Infinity);        // bridge deck
    expect(top(2120, 1380)).not.toBe(Infinity);       // plaza
    expect(top(2210, 1396)).toBe(Infinity);           // the well in its middle
    for (const c of V.houses) expect(top((c.x0 + c.x1) / 2, c.base - 20)).toBe(Infinity);
  });
  it('draws the streets, plazas, water, bridge, cottages and props', () => {
    const tags = new Set(rec.pieces.map((p: any) => p.mat));
    for (const m of ['paving', 'lowPaving', 'stone', 'water', 'wood']) expect(tags.has(m), m).toBe(true);
    expect(rec.pieces.filter((p: any) => p.tag === 'cottages').length).toBeGreaterThan(30);
    expect(k.inst.count(VK.tree)).toBeGreaterThan(40);   // props + the belt behind the back row
    expect(k.inst.count('well')).toBe(1);
    expect(k.inst.count(VK.lamp)).toBe(2);
    expect(k.inst.count('tree') + k.inst.count('lamp')).toBe(0);   // no kind solids (PROP_SOLID) in a village: the site's footprints
    // the road strips follow the polylines: a soil piece under the trail's middle point
    const mid = V.roads[1].pts[2], X = toX(mid[0]), Z = toZ(mid[1]);
    expect(rec.pieces.some((p: any) => p.mat === 'lowPaving' && p.box.min.x <= X && p.box.max.x >= X && p.box.min.z <= Z && p.box.max.z >= Z)).toBe(true);
  });
  it('falls back gracefully: a village without lots / roads / water still builds and keeps the grid walkable', () => {
    const L2 = villageFixtureLayout() as any;
    L2.village = { ...L2.village, lots: [], roads: [], water: [], plazas: [], bridges: [], props: [] };
    const r = staticCity(false, L2);
    const t2 = makeSolidTop(r.L, new SolidMap(collectSolids(r.L, r.spec, r.k.solids ?? [], r.k.inst)));
    const hall = r.L.buildings.find((b) => b.id === 'hall')!;
    expect(t2(1850, 1200)).toBe(Infinity);
    expect(t2(hall.door.x, hall.door.y)).not.toBe(Infinity);
  });
});
