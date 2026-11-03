/** Site update 03.11: the Ратуша opens (soonOf), the bag keeps free positions (hero.sg.sx + sg.lay.b → layCells). */
import { describe, it, expect } from 'vitest';
import { soonOf } from '../src/net/site';
import { bagCells, bagLay, cellKey, layCells } from '../src/ui/data';

describe('soonOf (city.js soonB; openPanel never checks soon)', () => {
  it('the hall opens but keeps its scaffold', () => {
    expect(soonOf({ id: 'hall', soon: true }, false, false, false)).toEqual({ soon: false, scaffold: true });
    expect(soonOf({ id: 'hall' }, false, false, false)).toEqual({ soon: false });
  });
  it('auction / storage / mine open with the hero flags, others stay soon', () => {
    expect(soonOf({ id: 'auction', soon: true }, false, false, false).soon).toBe(true);
    expect(soonOf({ id: 'auction', soon: true }, true, false, false).soon).toBe(false);
    expect(soonOf({ id: 'storage', soon: true }, false, true, false).soon).toBe(false);
    expect(soonOf({ id: 'mine', soon: true }, false, false, true).soon).toBe(false);
    expect(soonOf({ id: 'gate', soon: true }, true, true, true).soon).toBe(true);
  });
});

const it_ = (uid: string, id: string, x: Record<string, unknown> = {}) => ({ uid, id, name: id, rarity: 'common', slot: 'material', stats: {}, ...x }) as any;

describe('free bag layout (inventory.js cellKey / place, POST /api/stLay)', () => {
  const hero: any = {
    items: [
      it_('w1', 'sword', { wearable: true, slot: 'weapon' }),
      it_('w2', 'helm', { wearable: true, slot: 'helmet', on: true }),
      ...Array.from({ length: 22 }, (_, i) => it_('h' + i, 'herb')),
      it_('o1', 'ore_iron', { qty: 100, q: 300 }), it_('o2', 'ore_iron', { qty: 100, q: 200 }),
      it_('c1', 'candy', { event: true }), it_('c2', 'candy', { event: true }),
    ],
    sg: { sx: 1, bs: 20, cap: 8, lay: { b: [null, 'u:w2', 'i:herb*1', 'q:ore_iron', 'u:w1'] } },
  };
  it('keys like the site', () => {
    const cs = bagCells(hero, 20);
    expect(cs.map(cellKey)).toEqual(['u:w1', 'i:herb', 'i:herb*1', 'q:ore_iron', 'e:candy']);
    expect(cs.map((c) => c.n)).toEqual([1, 20, 2, 2, 2]);
  });
  it('saved positions first, the rest fill the gaps (also unknown keys) in order, padded to the cap', () => {
    const cs = bagCells(hero, 20), at = layCells(cs, bagLay(hero), hero.sg.cap);
    expect(at.length).toBe(8);
    expect(at.map((c) => (c ? cellKey(c) : '-'))).toEqual(['i:herb', 'e:candy', 'i:herb*1', 'q:ore_iron', 'u:w1', '-', '-', '-']);
  });
  it('classic bag (no sx) → no layout; no stack split without a stack size', () => {
    expect(bagLay({ ...hero, sg: { cap: 8 } })).toBe(null);
    expect(bagLay({ ...hero, sg: { sx: 1 } })).toEqual([]);
    expect(bagCells(hero).length).toBe(4);
  });
});
