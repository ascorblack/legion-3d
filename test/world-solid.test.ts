import { describe, it, expect } from 'vitest';
import { staticCity } from './world-fixture';
import { SolidMap, collectSolids, makeSolidTop } from '../src/world/solid';
import { BUILDING_MODELS } from '../src/world/buildings';
import { SUPPORTED_BUILDINGS } from '../src/world/supported';
import { fromX, fromZ } from '../src/world/coords';

const { L, k, spec } = staticCity();
const top = makeSolidTop(L, new SolidMap(collectSolids(L, spec, k.solids ?? [], k.inst)));
const at = (X: number, Z: number) => top(fromX(X), fromZ(Z));

describe('world solidTop', () => {
  it('benches, crates, barrels have finite jumpable tops at the props', () => {
    for (const kind of ['bench', 'crate', 'barrel']) {
      const p = k.inst.placed.get(kind)![0];
      const t = at(p.x, p.z);
      expect(t, kind).toBeGreaterThan(p.y + 0.3);
      expect(t, kind).toBeLessThan(p.y + 1.2);   // (a stacked crate on top counts)
    }
  });
  it('lamps, trees, buildings, water and outside are walls (Infinity)', () => {
    const lamp = k.inst.placed.get('lamp')![0];
    expect(at(lamp.x, lamp.z)).toBe(Infinity);
    const tree = k.inst.placed.get('tree')![0];
    expect(at(tree.x, tree.z)).toBe(Infinity);
    expect(top(1100, 790)).toBe(Infinity);            // trainer facade / outside the area
    expect(at(10.5, -2)).toBe(Infinity);              // inside the trainer building
    expect(top(600, 1540)).toBe(Infinity);            // canal water
    expect(top(13, 1000)).toBe(Infinity);             // left of the area
    expect(top(1300, 1200)).toBe(Infinity);           // the mine rock
  });
  it('the ledge gap outside the stairs: railing is hoppable (≤ 0.8 m), the wall face drops away (-Infinity)', () => {
    const fence = k.inst.placed.get('fence')!.find((p) => p.x > 15)!;
    const t = at(fence.x, fence.z);
    expect(t).toBeGreaterThan(0.5); expect(t).toBeLessThanOrEqual(0.8);
    // (right of the mine cliff) open below the wall — or the raised bed along the wall foot (src/world/ledge.ts): a low
    // finite top under the ledge, never a wall
    for (let y = 1100; y <= 1136; y += 4) { const v = top(1800, y); expect(v === -Infinity || (v > -1.4 && v < -0.9), 'y=' + y).toBe(true); }
    expect(top(1600, 1050)).toBe(-Infinity);          // open street
  });
  it('fountain rim is standable, its basin is not', () => {
    const f = k.inst.placed.get('fountain')![0], s = f.scale;
    expect(at(f.x + 1.17 * s, f.z)).toBeCloseTo(f.y + 0.64 * s, 3);
    expect(at(f.x, f.z)).toBe(Infinity);
  });
  it('a query does not allocate and is fast', () => {
    const t0 = performance.now(); let acc = 0;
    for (let i = 0; i < 200000; i++) { const v = top(40 + (i * 37) % 5400, 800 + (i * 13) % 1100); if (v > -1e9 && v < 1e9) acc += v; }
    expect(performance.now() - t0).toBeLessThan(400);
    expect(Number.isFinite(acc)).toBe(true);
  });
});

describe('world building models', () => {
  it('supported.ts lists exactly the ids of BUILDING_MODELS', () => {
    expect([...SUPPORTED_BUILDINGS].sort()).toEqual(Object.keys(BUILDING_MODELS).sort());
  });
  it('src/data/supported.json (drift report) lists the same street models', async () => {
    const sup = (await import('../src/data/supported.json')).default as { buildings: { models: string[] } };
    expect([...sup.buildings.models].sort()).toEqual([...SUPPORTED_BUILDINGS].sort());
  });
});

describe('world door interactables', () => {
  it('one Box3 per building over its door opening; label and use() → onDoor(id)', async () => {
    const { doorInteractables } = await import('../src/world/worldExt');
    const { groundAt } = staticCity();
    const opened: string[] = [];
    const list = doorInteractables(L, groundAt, () => (id) => opened.push(id));
    expect(list.length).toBe(L.buildings.length);
    for (const [i, b] of L.buildings.entries()) {
      const it = list[i], box = it.hit as import('three').Box3;
      expect(it.label).toMatch(b.soon ? /скоро/ : /^Войти: /);
      const x = b.door.x * 0.01;
      expect(box.min.x).toBeLessThan(x); expect(box.max.x).toBeGreaterThan(x);
      expect(box.max.y - box.min.y).toBeGreaterThan(1.8);
      expect(box.max.z).toBeLessThanOrEqual((b.door.y - 800) * 0.02 + 0.05);   // in front of the facade, not past the door point
      it.use('key');
    }
    expect(opened).toEqual(L.buildings.map((b) => b.id));
  });
});
