/**
 * Collisions match what you see (bug class «walk through props»): every prop kind that gets a walk solid
 * (src/world/solid.ts PROP_SOLID) keeps its visible parts at body height (0.15–1.25 m above its base) inside that
 * footprint + the player's probe radius (0.08 m) + 4 cm. Checked on the geometry the city actually draws: the prop
 * kit's hero kinds (fountain, well, statue, dummy, signpost, chest) and the instanced proto kinds (lamp, bench, crate,
 * barrel, bed, tree, bush, fence, mast).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PROP_SOLID } from '../src/world/solid';
import { Instancer } from '../src/world/instancer';
import { registerProtoProps } from '../src/world/protoProps';
import { paletteOf } from '../src/world/palette';

const SLACK = 0.08 + 0.04;
const HERO = ['fountain', 'well', 'statue', 'dummy', 'signpost', 'chest'];

/** Worst excess (m) of the visible body-band vertices over the footprint. */
function excess(geos: THREE.BufferGeometry[], d: (typeof PROP_SOLID)[string]): { over: number; at: string } {
  let over = 0, at = '';
  for (const g of geos) {
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (y < 0.15 || y > 1.25) continue;
      let e = d.r !== undefined ? Math.hypot(x, z) - d.r : Math.max(Math.abs(x) - d.hx!, Math.abs(z) - d.hz!);
      if (d.bar) e = Math.min(e, Math.max(Math.abs(x) - d.bar.hx, Math.abs(z) - d.bar.hz));
      if (e > over) { over = e; at = `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`; }
    }
  }
  return { over, at };
}

describe('walk solids cover the visible props', () => {
  it('prop kit hero kinds', async () => {
    const { BUILDERS } = await import('../src/world/props/kinds');
    const bad: string[] = [];
    for (const kind of HERO) {
      const parts = (BUILDERS as Record<string, (o: object) => { geo: THREE.BufferGeometry; mat: string }[]>)[kind]({});
      const geos = parts.filter((p) => p.mat !== 'outline' && p.mat !== 'glow').map((p) => p.geo);
      const e = excess(geos, PROP_SOLID[kind]);
      if (e.over > SLACK) bad.push(`${kind}: visible part ${e.over.toFixed(2)} m outside its solid at ${e.at}`);
    }
    expect(bad).toEqual([]);
  });
  it('instanced proto kinds', () => {
    const inst = new Instancer();
    registerProtoProps(inst, paletteOf('cats'));
    const bad: string[] = [];
    for (const kind of ['lamp', 'bench', 'crate', 'barrel', 'bed', 'tree', 'bush', 'fence', 'mast']) {
      const parts = (inst as unknown as { kinds: Map<string, { geo: THREE.BufferGeometry; mat: string }[]> }).kinds.get(kind)!;
      const e = excess(parts.map((p) => p.geo), PROP_SOLID[kind]);
      if (e.over > SLACK) bad.push(`${kind}: visible part ${e.over.toFixed(2)} m outside its solid at ${e.at}`);
    }
    expect(bad).toEqual([]);
  });

  it('the walk grid\'s dead band along the ledge is dressed (no invisible wall): planters above, a raised bed below', async () => {
    const { staticCity } = await import('./world-fixture');
    const { SolidMap, collectSolids, makeSolidTop } = await import('../src/world/solid');
    const { L, k, spec } = staticCity();
    const top = makeSolidTop(L, new SolidMap(collectSolids(L, spec, k.solids ?? [], k.inst)));
    const nearPost = (x: number) => [...(k.inst.placed.get('mast') ?? []), ...(k.inst.placed.get('lamp') ?? [])].some((p) => Math.abs(p.x - x / 100) < 0.75 && p.z < 6);
    const inStairs = (x: number) => spec.stairs.some(([a, b]) => x > a - 70 && x < b + 70);
    const lowB = L.buildings.filter((b) => b.hit[3] > 1000);
    let n = 0, covered = 0;
    for (let x = L.area.x0 + 60; x < L.area.x1 - 60; x += 25) {
      if (inStairs(x) || nearPost(x)) continue;
      const yUp = spec.edge[0] + 2;   // upper street: first blocked row of the band
      if (!L.free(x, yUp)) { n++; if (Number.isFinite(top(x, yUp))) covered++; }
      const yLo = Math.round((spec.wallY + spec.edge[1]) / 2);   // lower street, wall foot
      if (!L.free(x, yLo) && !lowB.some((b) => x > b.hit[0] - 60 && x < b.hit[1] + 60)) { n++; if (Number.isFinite(top(x, yLo))) covered++; }
    }
    expect(n).toBeGreaterThan(150);
    expect(covered / n).toBeGreaterThan(0.85);
  });
  it('steps you stand on are solid: building door steps / plinths and the canal coping carry your feet', async () => {
    const { staticCity } = await import('./world-fixture');
    const { SolidMap, collectSolids, makeSolidTop } = await import('../src/world/solid');
    const { L, k, spec } = staticCity();
    const top = makeSolidTop(L, new SolidMap(collectSolids(L, spec, k.solids ?? [], k.inst)));
    // the notice board's plinth (10 cm) and the hall's door step (12 cm)
    const board = L.buildings.find((b) => b.id === 'board')!;
    let plinth = -Infinity;
    for (let y = 800; y < board.door.y + 20; y += 2) { const t = top((board.hit[0] + board.hit[1]) / 2, y); if (Number.isFinite(t) && t < 0.2) plinth = Math.max(plinth, t); }
    expect(plinth).toBeCloseTo(0.1, 2);
    const hall = L.buildings.find((b) => b.id === 'hall')!;
    expect(top(hall.door.x, 812)).toBeGreaterThan(0.08);
    // canal coping: a 16 cm kerb
    const c0 = spec.canal![0];
    expect(top(2000, c0 - 6)).toBeCloseTo(spec.lowH + 0.16, 2);
  });
});
