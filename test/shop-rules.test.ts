import { describe, it, expect } from 'vitest';
import { offerOf } from '../src/rooms/common/stock';

const star = { id: 'mat_star', name: 'Счастливая звезда', mat: 'star' } as any;
const hero = { money: 99999, ef: 1 } as any;

describe('site 02.11: enchant materials can run out (cityshop.js buyAsk)', () => {
  it('ench.out → «закончились», no request', () => {
    const o = offerOf(star, 'forge', { hero, ench: { out: true } });
    expect(o.req).toBeNull();
    expect(o.can).toBe(false);
    expect(o.note).toMatch(/закончились/);
  });
  it('item.out → «закончились»', () => {
    expect(offerOf({ ...star, out: true }, 'forge', { hero }).req).toBeNull();
  });
  it('in stock → buy request as before', () => {
    const o = offerOf(star, 'forge', { hero, ench: { coins: { star: 300 } } });
    expect(o.req?.path).toBe('/api/buymat');
  });
});

describe('site 03.11: shop rules re-checked (cityshop.js buyAsk / new «Купить?» popover popHtml)', () => {
  it('a foreign town locks a material before «закончились» (buyAsk checks lockedHere first)', () => {
    const o = offerOf(star, 'forge', { hero, ench: { out: true }, foreignK: 1.5 });
    expect(o.kind).toBe('locked');
    expect(o.req).toBeNull();
  });
  it('own city: an out-of-stock material still reads «закончились»', () => {
    expect(offerOf(star, 'forge', { hero, ench: { out: true }, foreignK: 1 }).note).toMatch(/закончились/);
  });
  it('coins goods: «Не хватает» when the hero is short (popover «Не хватает: …»)', () => {
    const sword = { id: 'w1', name: 'Меч', slot: 'weapon', rarity: 'common', coins: 500 } as any;
    const o = offerOf(sword, 'forge', { hero: { money: 100, cs: 1 } as any });
    expect(o.kind).toBe('coins');
    expect(o.poor).toBe(true);
    expect(o.coins).toBe(500);
  });
});
