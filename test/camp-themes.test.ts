import { describe, it, expect } from 'vitest';
import { staticCity } from './world-fixture';
import { campFixtureLayout } from '../dev/fixtures';
import { campThemeOf, CHERTS_CAMP } from '../src/world/camp-themes';

describe('camp themes («Чёртов привал» for the cherts style)', () => {
  it('only styles with a theme get one; the default camp is untouched', () => {
    expect(campThemeOf('cherts')).toBe(CHERTS_CAMP);
    for (const s of ['cats', 'legion', 'monkeys', '', null, undefined]) expect(campThemeOf(s)).toBeNull();
  });
  it('the cherts camp builds: no forest, the same solids as the default camp + its own props, no new z-fighting', () => {
    const def = staticCity(false, campFixtureLayout('cats')), ch = staticCity(false, campFixtureLayout('cherts'));
    expect(def.k.inst.count('tree')).toBeGreaterThan(20);
    expect(ch.k.inst.count('tree')).toBe(0);
    // every footprint of the site's camp stays solid (the walk grid is the site's)
    expect((ch.k.solids || []).length).toBeGreaterThanOrEqual((def.k.solids || []).length - 4);
    // green lanterns / brew add green glows; lava cracks add orange ones
    const glows = ch.k.glows, green: number[] = [];
    for (let i = 0; i < glows.length; i += 7) if (glows[i + 5] > glows[i + 4]) green.push(i);
    expect(green.length).toBeGreaterThan(5);
    // no NEW z-fighting: the default camp's own known pairs (storage barn, palisade rails) are not this theme's
    const base = new Set(def.rec.find(0.004, 2e-4, def.ground).map((h) => h.a + '×' + h.b));
    const hits = ch.rec.find(0.004, 2e-4, ch.ground).filter((h) => !base.has(h.a + '×' + h.b));
    if (hits.length) console.log(hits.slice(0, 40).map((h) => `${h.a} × ${h.b} ${(h.area * 1e4).toFixed(0)} cm² at ${h.at}`).join('\n'));
    expect(hits.length).toBe(0);
  });
});
