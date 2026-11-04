import { describe, it, expect } from 'vitest';
import type { CityLayout } from '../src/contracts';
import { createPlayerController } from '../src/engine/player';

const layout: CityLayout = {
  id: 't', styleId: 'cats', W: 9000, H: 4000, QW: 0, area: { x0: 0, x1: 9000, y0: 0, y1: 4000 },
  obstacles: [], buildings: [], free: () => true, nearest: (x, y) => [x, y],
} as any;
const go = { move: { x: 1, y: 0 }, run: false, jump: false } as any;
const walk = (mps?: number) => {
  const p = createPlayerController(layout, () => 0, {});
  p.teleport(2000, 2000);
  if (mps) p.setWalk(mps);
  for (let i = 0; i < 120; i++) p.update(1 / 60, go, 0);
  return Math.hypot(p.x - 2000, p.y - 2000);
};

describe('walk speed follows the site (04.11: SPEED ×1.5)', () => {
  it('setWalk changes the ground speed', () => {
    expect(walk(2.3 * 1.5) / walk()).toBeGreaterThan(1.35);
  });
  it('ignores bad values', () => {
    const base = walk();
    expect(walk(NaN)).toBeCloseTo(base, 3);
    expect(walk(100)).toBeCloseTo(base, 3);
  });
});
