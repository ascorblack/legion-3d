import { describe, it, expect } from 'vitest';
import { staticCamp } from './world-fixture';
import { SolidMap, collectSolids, makeSolidTop } from '../src/world/solid';
import { toX, toZ } from '../src/world/coords';
import { campOf } from '../src/world/camp';
import camp from './fixtures/camp-map.json';

const { L, k, spec, rec } = staticCamp();
const top = makeSolidTop(L, new SolidMap(collectSolids(L, spec, k.solids ?? [], k.inst)));
const C = campOf(L)!;

describe('3D camp «Перепутье» (layout = site campmap.js)', () => {
  it('is a camp layout: same building ids as the fair minus anvil/mine/magic, spawn from the site', () => {
    expect(L.id).toBe('camp');
    expect(L.buildings.map((b) => b.id).sort()).toEqual(['forge', 'gate', 'shop', 'storage', 'tent']);
    expect((L as any).spawn).toEqual(camp.spawn);
    expect(L.free(camp.spawn[0], camp.spawn[1])).toBe(true);
    expect(spec.hasLow).toBe(false);
  });
  it('every walkable cell of the site grid is walkable in 3D (go() points stay valid: no Infinity solid there)', () => {
    const G = camp.grid.G as string, Cc = camp.grid.C, bad: string[] = [];
    let n = 0;
    for (let r = 0; r < camp.grid.rows; r++) for (let c = 0; c < camp.grid.cols; c++) {
      if (G[r * camp.grid.cols + c] !== '1') continue;
      const x = c * Cc + Cc / 2, y = camp.AREA.y0 + r * Cc + Cc / 2;
      // the first grid row (y < 816) is the facade line: building attachments (signs, steps, hay) may stand there, as at the fair
      if (!L.free(x, y) || y < 816) continue;
      n++;
      if (top(x, y) === Infinity) bad.push(`${x},${y}`);
    }
    expect(n).toBeGreaterThan(2000);
    expect(bad, bad.slice(0, 12).join(' ')).toEqual([]);
  });
  it('tents, the fire, the water tub and the palisade are solid where the site blocks them', () => {
    for (const t of C.tents) expect(top(t.x, t.y - t.d / 2), `tent ${t.x}`).toBe(Infinity);
    expect(top(C.fire.x, C.fire.y)).toBe(Infinity);
    const well = C.props.find((p) => p.k === 'well')!;
    expect(top(well.x, well.y - 6)).toBe(Infinity);
    expect(top(1000, C.fence.y)).toBe(Infinity);
    for (const lg of C.fire.logs) { const t = top(lg[0], lg[1]); expect(t).toBeGreaterThan(0.2); expect(t).toBeLessThan(0.5); }   // log benches: hop on
  });
  it('builds a cozy camp: tents in canvas, flames + glow at the fire, torches, trees round it, no street lamps/garland masts', () => {
    const tags = new Set(rec.pieces.map((p: any) => p.mat));
    for (const m of ['canvas', 'wood', 'emit', 'paving', 'lowPaving']) expect(tags.has(m), m).toBe(true);
    const fx = toX(C.fire.x), fz = toZ(C.fire.y);
    let fireGlow = false;
    for (let i = 0; i + 6 < k.glows.length; i += 7) if (Math.hypot(k.glows[i] - fx, k.glows[i + 2] - fz) < 0.5 && k.glows[i + 3] > 2) fireGlow = true;
    expect(fireGlow).toBe(true);
    expect(k.lights.length / 3).toBeGreaterThanOrEqual(1 + C.props.filter((p) => p.k === 'torch').length);
    expect((k.inst.placed.get('tree') || []).length).toBeGreaterThan(40);
    expect(k.inst.placed.get('lamp')).toBeUndefined();
    expect(k.inst.placed.get('mast')).toBeUndefined();
  });
});
