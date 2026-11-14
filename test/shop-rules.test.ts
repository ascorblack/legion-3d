import { describe, it, expect } from 'vitest';
import { offerOf } from '../src/rooms/common/stock';

const star = { id: 'mat_star', name: 'Счастливая звезда', mat: 'star' } as any;
const hero = { money: 99999, ef: 1 } as any;

describe('site 14.11: enchant materials are not sold (cityshop.js buyAsk `if (it.mat)`, POST /api/buymat gone)', () => {
  it('a material → «не продаётся», no request (was /api/buymat, «закончились» when out)', () => {
    for (const it of [star, { ...star, out: true }]) {
      const o = offerOf(it, 'forge', { hero });
      expect(o.kind).toBe('nosale');
      expect(o.req).toBeNull();
      expect(o.can).toBe(false);
      expect(o.note).toBe('Звёзды и сферы находят в походе, у боссов, в Шахте, на рыбалке и за ежедневные задания.');
    }
  });
});

describe('site 03.11: shop rules re-checked (cityshop.js buyAsk / new «Купить?» popover popHtml)', () => {
  it('a foreign town locks a material before «не продаётся» (buyAsk checks lockedHere first)', () => {
    const o = offerOf(star, 'forge', { hero, foreignK: 1.5 });
    expect(o.kind).toBe('locked');
    expect(o.req).toBeNull();
  });
  it('own city: a material reads «не продаётся»', () => {
    expect(offerOf(star, 'forge', { hero, foreignK: 1 }).kind).toBe('nosale');
  });
  it('coins goods: «Не хватает» when the hero is short (popover «Не хватает: …»)', () => {
    const sword = { id: 'w1', name: 'Меч', slot: 'weapon', rarity: 'common', coins: 500 } as any;
    const o = offerOf(sword, 'forge', { hero: { money: 100, cs: 1 } as any });
    expect(o.kind).toBe('coins');
    expect(o.poor).toBe(true);
    expect(o.coins).toBe(500);
  });
});
