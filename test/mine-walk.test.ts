import { describe, it, expect } from 'vitest';
import { walkPlan, AutoWalk, LeaveGuard, ConfirmTwice, type WalkCtl } from '../src/rooms/mine/walk';
import { dugArr } from '../src/rooms/mine/state';
import { frontOfObj, spawnPt, standable, cellXY, centerOf, digSpot, mx, mz, REACH, N_CELLS, cellOfPt, inR, FOOT, type Pt } from '../src/rooms/mine/geo';
import enter from './fixtures/mine-enter.json';

const dug = dugArr((enter as any).st);
const buyer = frontOfObj('buyer', 'player1');

/** Straight segment a → b stays on walkable ground (sampled). */
const segOk = (a: Pt, b: Pt) => { for (let k = 0; k <= 20; k++) { const x = a.x + (b.x - a.x) * k / 20, y = a.y + (b.y - a.y) * k / 20; if (!standable(dug, x, y, 0)) return false; } return true; };

describe('walk to the buyer (site goNpc → walkTo)', () => {
  it('from a dig spot deep in the hall: cells down to the entrance, then around the objects, ends at the counter', () => {
    const i = (enter as any).st.front.find((k: number) => digSpot(dug, k) != null)!;
    const from = centerOf(digSpot(dug, i)!);
    const plan = walkPlan(dug, from, buyer)!;
    expect(plan).not.toBeNull();
    const end = plan.at(-1)!;
    // the site's front point is a pocket for a point hero: we stop at the nearest spot a body can reach (≤ 2.5 cells — the
    // window stays open, site NPC_FAR) and stand on freely
    expect(Math.hypot(end.x - buyer.x, end.y - buyer.y)).toBeLessThan(320);
    expect(standable(dug, end.x, end.y, 14)).toBe(true);
    let a = from;
    for (const p of plan) { expect(segOk(a, p)).toBe(true); a = p; }
    // never through the buyer's stall
    const stall = FOOT.find((f) => f.k === 'buyer')!.r;
    for (const p of plan) expect(inR(stall, p.x, p.y)).toBe(false);
  });
  it('from the entrance area: only the route around the objects', () => {
    const from = { x: 300, y: 2380 };
    expect(cellOfPt(from.x, from.y)).toBeGreaterThanOrEqual(N_CELLS);
    const plan = walkPlan(dug, from, buyer)!;
    expect(Math.hypot(plan.at(-1)!.x - buyer.x, plan.at(-1)!.y - buyer.y)).toBeLessThan(320);
    let a = from; for (const p of plan) { expect(segOk(a, p)).toBe(true); a = p; }
  });
  it('from every spawn spot by the cart (narrow passages) there is a way', () => {
    for (let k = 0; k < 40; k++) {
      const from = spawnPt('miner' + k), plan = walkPlan(dug, from, buyer);
      expect(plan, 'spawn ' + k).not.toBeNull();
      expect(Math.hypot(plan!.at(-1)!.x - buyer.x, plan!.at(-1)!.y - buyer.y)).toBeLessThan(320);
    }
  });
  it('the driver feeds one waypoint at a time, finishes, and stops when the player takes over', () => {
    const plan = walkPlan(dug, { x: 300, y: 2380 }, buyer)!;
    const walk = new AutoWalk();
    type P3 = { x: number; z: number };
    let pos: P3 = { x: mx(300), z: mz(2380) }, target: P3 | null = null as P3 | null;
    const ctl: WalkCtl = { walkTo: (x, z) => { target = { x, z }; }, get walking() { return !!target; } };
    walk.startPx(plan);
    let st = '', n = 0, sent = 0;
    for (let f = 0; f < 200 && st !== 'done'; f++) {
      const before: P3 | null = target; st = walk.frame(ctl, pos.x, pos.z, 1 / 30);
      if (target !== before && target) sent++;
      if (target) { const t: P3 = target; pos = { x: t.x, z: t.z }; target = null; n++; }   // the controller arrives at once
    }
    expect(st).toBe('done'); expect(sent).toBe(plan.length); expect(walk.active).toBe(false);
    // the player pressed WASD: the controller dropped its path far from the waypoint → cancelled
    walk.startPx(plan); pos = { x: mx(300), z: mz(2380) };
    expect(walk.frame(ctl, pos.x, pos.z, 1 / 30)).toBe('walking');
    target = null;
    expect(walk.frame(ctl, pos.x + 0.01, pos.z, 1 / 30)).toBe('cancelled');
    expect(walk.active).toBe(false);
    void n;
  });
});

describe('leaving the own stone', () => {
  it('stops only after the hero stood at the stone (a queue-given stone far away is not stopped)', () => {
    const g = new LeaveGuard();
    expect(g.check(5, false, 900)).toBe(false);          // given by the queue / dug from the city: hero elsewhere
    expect(g.check(5, false, 900)).toBe(false);
    expect(g.check(5, false, REACH - 10)).toBe(false);   // came to it
    expect(g.check(5, false, REACH + 20)).toBe(false);   // a small step: still fine (site + 30 px)
    expect(g.check(5, false, REACH + 40)).toBe(true);    // walked away
    expect(g.check(9, false, REACH + 400)).toBe(false);  // the next stone from the queue: re-armed only at it
    expect(g.check(9, true, 0)).toBe(false);
    expect(g.check(-1, false, 0)).toBe(false);
  });
});

describe('«Скупщик» while digging', () => {
  it('first press warns, a second within 5 s goes; not digging → at once', () => {
    const c = new ConfirmTwice(5000);
    expect(c.press(false, 0)).toBe(true);
    expect(c.press(true, 1000)).toBe(false);
    expect(c.press(true, 4000)).toBe(true);
    expect(c.press(true, 5000)).toBe(false);
    expect(c.press(true, 11000)).toBe(false);   // too late: armed again
    expect(c.press(true, 12000)).toBe(true);
    void cellXY;
  });
});
