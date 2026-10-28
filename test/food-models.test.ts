import { describe, it, expect } from 'vitest';
import { foodKind } from '../src/avatar/items';

// The site keeps legacy ids but shows cat-themed names: the model must follow the NAME the player sees.
const SITE: [string, string, string][] = [
  ['apple', 'Килька', 'fish'], ['pretzel', 'Хрустящий корм', 'kibble'], ['bread', 'Миска сметаны', 'cream'],
  ['cheese', 'Сыр с дырками', 'cheese'], ['pie', 'Рыбный пирог', 'pie'], ['ham', 'Копчёная колбаска', 'sausage'],
  ['roast', 'Целый лосось', 'salmon'], ['pear', 'Корюшка', 'smelt'], ['kvass', 'Блюдце молока', 'saucer'], ['honey_cake', 'Пучок кошачьей мяты', 'herb'], ['sage_tea', 'Тёплое молоко с мёдом', 'milk'],
  ['spicy_stew', 'Бойцовая уха', 'bowl'],
];
describe('food models follow the shown name', () => {
  for (const [id, name, kind] of SITE) it(`${id} «${name}» → ${kind}`, () => expect(foodKind(id, name)).toBe(kind));
  it('falls back to the id', () => { expect(foodKind('apple', '')).toBe('apple'); expect(foodKind('zzz', '')).toBe('bread'); });
});
