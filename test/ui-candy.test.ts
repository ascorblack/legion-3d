/**
 * Site 31.10 (feat/candy-tile, app.js candyCell / inventory.js data.pins): the Halloween candies as a «не вещь» tile after
 * the items of the bag — not selectable (no data-act / data-uid), no place taken, «9999+» above 9999, the hint as its title.
 */
import { describe, it, expect } from 'vitest';
import { candyCellHtml, candyText, CANDY_MAX } from '../src/ui/card';
import type { Hero } from '../src/contracts';

const hero = (hw: unknown) => ({ items: [], hw } as unknown as Hero);

describe('candy tile in the bag', () => {
  it('only while the event counter is there; the number and the site\'s hint', () => {
    expect(candyCellHtml(null)).toBe('');
    expect(candyCellHtml(hero(undefined))).toBe('');
    expect(candyCellHtml(hero(null))).toBe('');
    const h = candyCellHtml(hero({ c: 42 }));
    expect(h).toContain('class="cell cnd"');
    expect(h).toContain('<i class="n">42</i>');
    expect(h).toContain(`title="${candyText(42)}"`);
    expect(candyText(42)).toBe('Конфеты: 42. Тратить — в «Ступе сладостей» в Городе; в конце ивента остаток превратится в монеты.');
    expect(candyCellHtml(hero({ c: 0 }))).toContain('<i class="n">0</i>');
    expect(candyCellHtml(hero({ c: -3.5 }))).toContain('<i class="n">0</i>');
  });
  it('is not an item: nothing selects, equips or drags it', () => {
    const h = candyCellHtml(hero({ c: 5 }));
    expect(h).not.toMatch(/data-act|data-uid|data-idx|<button/);
    expect(h).toContain('role="img"');
  });
  it('«9999+» above 9999, the full number in the hint', () => {
    const h = candyCellHtml(hero({ c: CANDY_MAX + 1 }));
    expect(h).toContain('<i class="n">9999+</i>');
    expect(h).toContain('Конфеты: 10000.');
    expect(candyCellHtml(hero({ c: CANDY_MAX }))).toContain('<i class="n">9999</i>');
  });
});
