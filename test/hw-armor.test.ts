/**
 * Halloween armour looks (site 31.10 feat/hw-armor-pick: game-data.js ARMOR_LOOKS + doodle.js HW_ARMOR): worn and shown
 * as the nearest base kind, never the generic fallback.
 */
import { describe, it, expect } from 'vitest';
import { appearanceFrom, armorBaseKind, HW_ARMOR_BASE, CATALOG } from '../src/avatar/appearance';
import { itemModelFactories } from '../src/avatar/items';

describe('Halloween armour', () => {
  it('maps every hw armour to a drawable base kind', () => {
    for (const [id, base] of Object.entries(HW_ARMOR_BASE)) {
      expect((CATALOG.armors as readonly string[]).includes(id)).toBe(true);
      expect(['lorica', 'robe', 'leather', 'shroud', 'plate']).toContain(base);
      expect(armorBaseKind(id)).toBe(base);
    }
    expect(armorBaseKind('robe')).toBe('robe');
  });
  it('a hero in hw armour wears the base kind; the item model is registered', () => {
    const app = appearanceFrom('demo', { l: 'demo', g: { a: 'hwgrave', ar: 'epic', am: 'cloth' } }, 'cats');
    expect(app.gear.a).toBe('shroud'); expect(app.gear.ar).toBe('epic');
    const m = itemModelFactories();
    for (const id of Object.keys(HW_ARMOR_BASE)) expect(m.has('armor:' + id)).toBe(true);
  });
});
