import { describe, it, expect } from 'vitest';
import { mapFeatures, fitView, zoomAt, clampView, placeLabels, faceToDeg } from '../src/ui/mapdata';
import { promptView } from '../src/ui/prompt';
import { fixtureLayout } from '../dev/fixtures';

const L = fixtureLayout();

describe('map features (metres, true aspect)', () => {
  const F = mapFeatures(L);
  it('bounds cover the 55 m × 22 m fair city plus the facade band', () => {
    expect(F.bounds.x1 - F.bounds.x0).toBeGreaterThan(54);
    expect(F.bounds.x1 - F.bounds.x0).toBeLessThan(60);
    expect(F.bounds.z0).toBeLessThan(-4);
    expect(F.bounds.z1).toBeGreaterThan(21.9);
  });
  it('one pin per building, at the door x; upper-street pins inside the facade band, lower ones on the terrace', () => {
    expect(F.pins.length).toBe(L.buildings.length);
    const forge = F.pins.find((p) => p.id === 'forge')!;
    expect(forge.x).toBeCloseTo(23.82, 2);
    expect(forge.lower).toBe(false);
    expect(forge.z).toBeLessThan(0);
    const mine = F.pins.find((p) => p.id === 'mine')!;
    expect(mine.lower).toBe(true);
    expect(mine.z).toBeGreaterThan(6);
    expect(F.pins.find((p) => p.id === 'auction')!.soon).toBe(true);
    expect(F.pins.find((p) => p.id === 'hall')!.soon).toBe(false);   // site 03.11: the Ратуша opens (src/net/site.ts soonOf)
  });
  it('finds the canal, bridges, stairs and the ledge', () => {
    expect(F.water.length).toBeGreaterThanOrEqual(4);
    for (const w of F.water) { expect(w.z0).toBeCloseTo(14, 1); expect(w.z1).toBeCloseTo(15.88, 1); }
    expect(F.bridges.length).toBe(4);
    expect(F.stairs.length).toBe(4);
    expect(F.ledge.length).toBeGreaterThanOrEqual(4);
    expect(F.blocks.find((b) => b.id === 'storage')!.z1).toBeCloseTo(10.8, 1);
  });
});

describe('map view math', () => {
  const b = { x0: 0, z0: -5, x1: 55, z1: 23 };
  it('fitView keeps the metre aspect and centres the city', () => {
    const v = fitView(b, 1100, 600, 0);
    expect(v.k).toBeCloseTo(Math.min(1100 / 55, 600 / 28), 5);
    const cx = ((b.x0 + b.x1) / 2) * v.k + v.tx, cy = ((b.z0 + b.z1) / 2) * v.k + v.ty;
    expect(cx).toBeCloseTo(550, 5); expect(cy).toBeCloseTo(300, 5);
  });
  it('zoomAt keeps the point under the cursor fixed and clamps k', () => {
    const v = fitView(b, 1100, 600, 0);
    const mx = (300 - v.tx) / v.k, mz = (200 - v.ty) / v.k;
    zoomAt(v, 2, 300, 200, 1, 100);
    expect(mx * v.k + v.tx).toBeCloseTo(300, 6); expect(mz * v.k + v.ty).toBeCloseTo(200, 6);
    zoomAt(v, 1000, 0, 0, 1, 100); expect(v.k).toBe(100);
  });
  it('clampView never loses the city off-screen', () => {
    const v = { k: 20, tx: -5000, ty: 3000 };
    clampView(v, b, 1100, 600, 120);
    expect(b.x1 * v.k + v.tx).toBeGreaterThanOrEqual(119.9);
    expect(b.z0 * v.k + v.ty).toBeLessThanOrEqual(600 - 119.9);
  });
  it('facing arrow: face 0 points up, +π/2 (towards −X) points left', () => {
    expect(faceToDeg(0) === 0).toBe(true);
    expect(faceToDeg(Math.PI / 2)).toBeCloseTo(-90, 6);
  });
});

describe('label placement', () => {
  it('a lone pin gets its preferred side', () => {
    const o = placeLabels([{ sx: 100, sy: 100, w: 60, h: 18, prio: 1, pref: ['t', 'b', 'r', 'l'] }], 15, 400, 300);
    expect(o[0].side).toBe('t');
  });
  it('labels of close pins never overlap; the crowded rest is hidden (null)', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ sx: 40 + i * 30, sy: 100, w: 90, h: 18, prio: i % 3 }));
    const o = placeLabels(items, 12, 600, 300);
    const boxes = o.map((p, i) => (p.side ? [p.x, p.y, p.x + items[i].w, p.y + items[i].h] : null)).filter(Boolean) as number[][];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], c = boxes[j];
      expect(a[0] < c[2] && a[2] > c[0] && a[1] < c[3] && a[3] > c[1]).toBe(false);
    }
    expect(o.some((p) => p.side === null)).toBe(true);
    expect(o.filter((p) => p.side).length).toBeGreaterThanOrEqual(4);
  });
  it('labels stay inside the viewport', () => {
    const o = placeLabels([{ sx: 590, sy: 10, w: 80, h: 18, prio: 1 }], 12, 600, 300);
    expect(o[0].side).toBe('b');
    expect(o[0].x).toBeGreaterThanOrEqual(0);
  });
});

describe('crosshair prompt (ui.prompt)', () => {
  it('turns [X] into keycaps and mouse buttons into a mouse glyph', () => {
    const v = promptView('[E] Войти: Кузня');
    expect(v.muted).toBe(false);
    expect(v.html).toBe('<i class="kc">E</i><span>Войти: Кузня</span>');
    const m = promptView('[ЛКМ] Купить: Коготок · [ПКМ] Осмотреть');
    expect(m.html).toContain('kc mb l');
    expect(m.html).toContain('kc mb r');
    expect(m.html).toContain('psep');
  });
  it('escapes text and supports the muted «!» prefix', () => {
    const v = promptView('!<b>Кузня</b> — скоро');
    expect(v.muted).toBe(true);
    expect(v.html).not.toContain('<b>');
  });
});
