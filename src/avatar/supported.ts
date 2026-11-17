/**
 * What src/avatar can draw, as plain data (no three.js) — for the drift report (`npm run drift`) and tests.
 * Keep in sync with items.ts (test/avatar-items.test.ts checks that every key here is registered and vice versa).
 */
import { CATALOG } from './appearance';

/** Hat/helmet ids hats.ts builds ('none' excluded). Same list as HAT_IDS in hats.ts (kept here three-free). */
export const ITEM_HATS = ['tuft', 'cap', 'bow', 'horns', 'crown', 'tophat', 'party', 'wizard', 'antenna', 'antenna2', 'cat', 'bunny', 'halo',
  'sprout', 'bandana', 'legion', 'laurel', 'beret', 'headphones', 'cowboy', 'chef', 'pumpkin', 'witch', 'batears', 'skull', 'reaper', 'scarehat',
  'miner', 'rhood', 'rmask', 'nhood', 'ncrown', 'phelm', 'pwing'] as const;
/** Class charms (doodle.js CLASS_CHARM) and aura amulets (inventory.js AURA, + 'plain'). */
export const ITEM_CHARMS = ['lockpick', 'vial', 'cateye', 'bone', 'souljar', 'phylactery', 'ladanka', 'sun', 'dawn',
  'gold', 'sparks', 'halo', 'shadow', 'frost', 'plain'] as const;
/** Item slots with a generic per-slot model. */
export const ITEM_SLOTS = ['weapon', 'shield', 'armor', 'helmet', 'trinket', 'food', 'potion', 'scroll', 'material', 'relic'] as const;
/** Site food ids (inventory.js FOOD_ID) with their own key 'food:<id>' (shop shelves look them up first). */
export const ITEM_FOODS = ['apple', 'pear', 'bread', 'pretzel', 'cheese', 'pie', 'ham', 'roast', 'kvass', 'honey_cake', 'sage_tea', 'spicy_stew', 'fish'] as const;

/** Every registry key registerItemModels() adds, in a stable order. */
export const SUPPORTED_ITEM_MODEL_KEYS: readonly string[] = [
  ...CATALOG.weapons.map((k) => 'weapon:' + k),
  ...CATALOG.shields.map((k) => 'shield:' + k),
  ...CATALOG.offhands.map((k) => 'shield:' + k),   // site 17.11: off-hand blades are `look.shield` ids too
  ...CATALOG.armors.map((k) => 'armor:' + k),
  ...ITEM_HATS.map((k) => 'hat:' + k),
  ...ITEM_CHARMS.map((k) => 'charm:' + k),
  ...ITEM_SLOTS.map((k) => 'slot:' + k),
  ...ITEM_FOODS.map((k) => 'food:' + k),
  '*',
];

/** The same, grouped (drop-in for src/data/supported.json → "itemModels"). */
export const SUPPORTED_ITEM_MODELS = {
  weapons: [...CATALOG.weapons], shields: [...CATALOG.shields], offhands: [...CATALOG.offhands], armors: [...CATALOG.armors],
  hats: [...ITEM_HATS], charms: [...ITEM_CHARMS], slots: [...ITEM_SLOTS], foods: [...ITEM_FOODS],
};
