import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import { createRegistry } from '../src/core/registry';
import type { ItemModelFactory } from '../src/contracts/ext';
import { registerItemModels, buildItemModel, itemStyle, styledGoods } from '../src/avatar/items';
import { chFoodKind, CH_FOOD_KINDS, CH_FOOD_BY_ID } from '../src/avatar/cherts-goods';
import { ITEM_FOODS } from '../src/avatar/supported';

const tris = (o: THREE.Object3D) => { const m = o.getObjectByName('item-model') as THREE.Mesh; return m.geometry.index!.count / 3; };
let off: (() => void) | null = null;
const reg = (style: string) => { const r = createRegistry<ItemModelFactory>('itemModels'); off = registerItemModels(r, () => style); return r; };
afterEach(() => { off?.(); off = null; });

describe('«Чертики» goods (styles/cherts/goods.js)', () => {
  it('maps every site food id to a dish of the hell kitchen, by name first', () => {
    for (const id of ITEM_FOODS) expect(CH_FOOD_KINDS, id).toContain(chFoodKind(id));
    expect(chFoodKind('apple')).toBe('ch_apple');
    expect(chFoodKind('pear')).toBe('ch_pepper');
    expect(chFoodKind('roast')).toBe('ch_skewer');
    expect(chFoodKind('kvass')).toBe('ch_soda');
    expect(chFoodKind('bread', 'Шашлык на вилах')).toBe('ch_skewer');
    expect(chFoodKind('zzz', 'Пряник с перцем')).toBe('ch_ginger');
    expect(chFoodKind('zzz', '', 'bowl')).toBe('ch_stew');
    expect(chFoodKind('zzz')).toBe('ch_bread');
    expect(new Set(Object.values(CH_FOOD_BY_ID)).size).toBe(12);   // the twelve dishes of goods.js
  });
  it('the style comes from look.style, else the registered source', () => {
    reg('cherts');
    expect(itemStyle()).toBe('cherts');
    expect(itemStyle({ style: 'cats' })).toBe('cats');
    expect(styledGoods('potion')).toBe(true);
    expect(styledGoods('scroll')).toBe(true);
    expect(styledGoods('weapon')).toBe(false);
    expect(styledGoods('potion', { style: 'cats' })).toBe(false);
  });
  it('on a cherts channel the same ids build other models (≤ 1.5k triangles, bottom at y = 0); cats stay as they were', () => {
    const items = [...ITEM_FOODS.map((id) => ({ slot: 'food', id })), { slot: 'potion', id: 'potion_small' }, { slot: 'potion', id: 'potion_hp' }, { slot: 'scroll', id: 'scroll_revive' }];
    const cats = reg('cats'), geoCats = items.map((it) => (buildItemModel(cats, it).getObjectByName('item-model') as THREE.Mesh).geometry);
    off!(); off = null;
    const ch = reg('cherts');
    const seen = new Set<THREE.BufferGeometry>();
    items.forEach((it, i) => {
      const o = buildItemModel(ch, it), m = o.getObjectByName('item-model') as THREE.Mesh;
      expect(m.geometry, it.id).not.toBe(geoCats[i]);
      expect(tris(o), it.id).toBeLessThanOrEqual(1500);
      expect(Math.abs(m.geometry.boundingBox!.min.y), it.id).toBeLessThan(1e-4);
      expect(o.getObjectByName('item-outline'), it.id).toBeTruthy();
      seen.add(m.geometry);
    });
    // 12 dishes (fish shares the ham) + small and big potion + the scroll
    expect(seen.size).toBe(15);
  });
});
