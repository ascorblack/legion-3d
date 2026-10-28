/**
 * 3D item models for shop goods + baking many of them into a couple of merged meshes.
 *
 * Model source, in order: the game's item-model registry (`ctx.registries.itemModels`, filled by src/avatar
 * `registerItemModels`) for an exact key → the local models below (built from the avatar's own weapon/shield/hat parts,
 * plus armour on a mannequin torso, charms, food, potions, enchant materials) → registry 'slot:<slot>' → registry '*'.
 *
 * Keys follow the registry convention: 'weapon:<kind>', 'shield:<kind>', 'hat:<id>', 'armor:<kind>', 'charm:<aura>',
 * 'slot:<slot>', '*'.
 */
import * as THREE from 'three';
import { Parts, T, cyl, cone, sphere, box, torus, star, bodyDims, slab } from '../../avatar/geom';
import { addWeapon, addShield } from '../../avatar/gear';
import { addHat } from '../../avatar/hats';
import { toonMat, outlineMat } from '../../avatar/materials';
import { styledGoods } from '../../avatar/items';
import type { ItemModelFactory, Registry } from '../../contracts/ext';
import type { StockItem } from './stock';

export const RARITY_HEX: Record<string, string> = { common: '#c9ccd6', uncommon: '#4cc95a', rare: '#4aa3ff', epic: '#b06bff', legendary: '#ffb83d' };

/** Registry key of an item (same convention as src/avatar itemModelKey). */
export function itemKey(it: Pick<StockItem, 'slot' | 'look' | 'gear'>): string {
  const L = (it.look || {}) as Record<string, unknown>;
  if (L.weapon) return 'weapon:' + L.weapon;
  if (L.shield) return 'shield:' + L.shield;
  if (L.hat) return 'hat:' + L.hat;
  if (L.armor) return 'armor:' + L.armor;
  if (it.slot === 'armor') return 'armor:' + (it.gear === 'cloth' ? 'robe' : it.gear === 'light' ? 'leather' : 'lorica');
  if (L.aura || L.charm || it.slot === 'trinket') return 'charm:' + String(L.aura || L.charm || 'plain');
  return 'slot:' + it.slot;
}

/* ------------------------------------------------------------------ local models */

const WOOD = '#8a5a2b', DWOOD = '#5a3a1c', INK = '#2b1d18', GOLD = '#e8b923';
const AURA_COL: Record<string, string> = { shadow: '#6a4a9a', sparks: '#ffd84a', frost: '#7fd6ff', halo: '#ffe9a0', gold: '#ffcf4a', plain: '#ff8fa3' };

function weaponModel(kind: string, rar: string): THREE.BufferGeometry {
  const p = new Parts();
  addWeapon(p, kind, rar, T(0, 0, 0));
  return p.build();
}
function shieldModel(kind: string, rar: string): THREE.BufferGeometry {
  const p = new Parts();
  addShield(p, kind, rar, T(0, 0, 0, 0, Math.PI, 0));   // face towards +Z (the shopper)
  return p.build();
}
/** Hat on a little wooden head form. */
function hatModel(id: string, rar: string): THREE.BufferGeometry {
  const p = new Parts();
  const d = bodyDims('ball', 0.5);
  const c1 = '#8a6aa8', c2 = '#ff8fa3';
  addHat(p, id, { d, c1, c2, rar, style: 'cats' });
  // head form: dome matching the body top + neck + base
  const r = d.w * 0.92;
  p.add(sphere(r, 16, 10), '#e8cfa8', T(0, d.top - r * 0.95, 0, 0, 0, 0, [1, 0.9, d.depth]));
  p.add(cyl(0.035, 0.05, d.top - r * 1.6, 8), DWOOD, T(0, (d.top - r * 1.6) / 2 + 0.02, 0));
  p.add(cyl(0.12, 0.14, 0.04, 14), WOOD, T(0, 0.02, 0));
  return p.build();
}
/** Armour on a mannequin torso on a pole. */
function armorModel(kind: string, rar: string): THREE.BufferGeometry {
  const p = new Parts();
  const acc = rar !== 'common' ? RARITY_HEX[rar] : null;
  // stand
  p.add(cyl(0.16, 0.19, 0.05, 16), WOOD, T(0, 0.025, 0));
  p.add(cyl(0.025, 0.025, 0.42, 8), DWOOD, T(0, 0.25, 0));
  const y = 0.62;
  switch (kind) {
    case 'robe': {
      p.add(cyl(0.13, 0.27, 0.62, 16), '#5a4aa8', T(0, y - 0.05, 0, 0, 0, 0, [1, 1, 0.8]));
      p.add(cyl(0.272, 0.272, 0.05, 16), acc || '#ffcf4a', T(0, y - 0.33, 0, 0, 0, 0, [1, 1, 0.8]));
      p.add(sphere(0.15, 14, 8), '#5a4aa8', T(0, y + 0.27, 0, 0, 0, 0, [1.25, 0.6, 0.95]));
      p.add(torus(0.1, 0.03, 6, 16), acc || '#ffcf4a', T(0, y + 0.3, 0, Math.PI / 2, 0, 0, [1, 1, 0.8]));
      for (let i = 0; i < 4; i++) p.add(star(0.03, 0.01), '#ffe39a', T(-0.08 + i * 0.06, y - 0.1 + (i % 2) * 0.12, 0.2));
      break;
    }
    case 'shroud': {
      p.add(cone(0.28, 0.85, 14), '#2a2440', T(0, y + 0.02, 0, 0, 0, 0, [1, 1, 0.8]));
      p.add(sphere(0.13, 12, 8), '#3a3060', T(0, y + 0.4, -0.02, 0, 0, 0, [1, 1.15, 1]));
      p.add(sphere(0.1, 10, 6), '#120e1c', T(0, y + 0.38, 0.05, 0, 0, 0, [0.9, 0.9, 0.5]));
      p.add(box(0.05, 0.05, 0.02), acc || '#7fe0b0', T(0, y + 0.18, 0.2));
      break;
    }
    case 'plate': {
      p.add(cyl(0.2, 0.16, 0.42, 16), '#cfd6de', T(0, y, 0, 0, 0, 0, [1, 1, 0.75]));
      for (const s of [-1, 1]) p.add(sphere(0.1, 12, 8), '#e4e9ef', T(s * 0.2, y + 0.18, 0, 0, 0, 0, [1, 0.7, 1]));
      p.add(box(0.04, 0.3, 0.02), acc || GOLD, T(0, y + 0.02, 0.15));
      p.add(box(0.2, 0.04, 0.02), acc || GOLD, T(0, y + 0.08, 0.152));
      p.add(cyl(0.17, 0.2, 0.08, 16), '#9aa3ad', T(0, y - 0.24, 0, 0, 0, 0, [1, 1, 0.75]));
      break;
    }
    case 'leather': {
      p.add(cyl(0.19, 0.17, 0.44, 16), '#8a5a3a', T(0, y, 0, 0, 0, 0, [1, 1, 0.75]));
      p.add(cyl(0.175, 0.175, 0.05, 16), INK, T(0, y - 0.12, 0, 0, 0, 0, [1, 1, 0.78]));
      p.add(box(0.05, 0.05, 0.02), GOLD, T(0, y - 0.12, 0.14));
      for (const s of [-1, 1]) p.add(sphere(0.085, 10, 6), '#6e4a2f', T(s * 0.19, y + 0.17, 0, 0, 0, 0, [1, 0.7, 1]));
      for (let i = 0; i < 3; i++) p.add(box(0.012, 0.012, 0.01), '#e8d0a0', T(0.04, y + 0.12 - i * 0.07, 0.15));
      break;
    }
    case 'lorica': default: {
      // knitted sweater (cats) / segmented lorica: banded torso
      const body = acc ? '#a85060' : '#c0503c', band = '#f2d4a8';
      p.add(cyl(0.2, 0.18, 0.44, 16), body, T(0, y, 0, 0, 0, 0, [1, 1, 0.75]));
      for (let i = 0; i < 4; i++) p.add(cyl(0.205 - i * 0.004, 0.2 - i * 0.004, 0.03, 16), band, T(0, y - 0.15 + i * 0.1, 0, 0, 0, 0, [1, 1, 0.76]));
      for (const s of [-1, 1]) p.add(sphere(0.09, 10, 6), body, T(s * 0.2, y + 0.17, 0, 0, 0, 0, [1, 0.75, 1]));
      p.add(torus(0.08, 0.025, 6, 14), band, T(0, y + 0.22, 0, Math.PI / 2, 0, 0, [1, 1, 0.8]));
      if (acc) p.add(sphere(0.03, 8, 6), acc, T(0, y + 0.05, 0.155));
      break;
    }
  }
  return p.build();
}
function charmModel(aura: string, rar: string): THREE.BufferGeometry {
  const p = new Parts();
  const c = AURA_COL[aura] || RARITY_HEX[rar] || '#ff8fa3';
  p.add(cyl(0.06, 0.07, 0.03, 12), DWOOD, T(0, 0.015, 0));
  p.add(cyl(0.008, 0.008, 0.2, 6), '#cfa65a', T(0, 0.13, 0));
  p.add(torus(0.07, 0.006, 4, 20, Math.PI * 1.3), '#e8d0a0', T(0, 0.2, 0, 0, 0, Math.PI * 1.15));
  p.add(new THREE.OctahedronGeometry(0.045, 0), c, T(0, 0.12, 0.012, 0, 0, 0, [0.8, 1.2, 0.6]));
  p.add(sphere(0.012, 6, 4), GOLD, T(0, 0.175, 0.012));
  return p.build();
}
function potionModel(heal: number, id: string): THREE.BufferGeometry {
  const p = new Parts();
  const big = heal >= 20 || /hp|big|large/.test(id);
  const liq = /milk|молоч/i.test(id) ? '#fff4f0' : big ? '#ff6b81' : '#ff9fb2';
  const pts: [number, number][] = big ? [[0, 0], [0.07, 0], [0.085, 0.03], [0.085, 0.1], [0.06, 0.15], [0.025, 0.17], [0.025, 0.22], [0, 0.22]]
    : [[0, 0], [0.05, 0], [0.06, 0.02], [0.06, 0.08], [0.04, 0.11], [0.02, 0.12], [0.02, 0.16], [0, 0.16]];
  p.add(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 14), '#cfe7ff');
  const lk = big ? 0.082 : 0.057;
  p.add(cyl(lk, lk * 0.95, big ? 0.09 : 0.065, 14), liq, T(0, big ? 0.05 : 0.038, 0));
  p.add(cyl(0.022, 0.026, 0.04, 8), '#b08a5a', T(0, big ? 0.235 : 0.175, 0));
  p.add(box(big ? 0.09 : 0.06, 0.05, 0.005), '#f7ead0', T(0, big ? 0.08 : 0.06, big ? 0.083 : 0.058));
  p.add(sphere(0.012, 6, 4), '#ff8fa3', T(0, big ? 0.08 : 0.06, big ? 0.088 : 0.062));
  return p.build();
}
/** Food by its (style-specific) name, falling back to the id. */
function foodModel(name: string, id: string): THREE.BufferGeometry {
  const p = new Parts();
  const s = (name + ' ' + id).toLowerCase();
  const plate = () => p.add(cyl(0.13, 0.11, 0.02, 16), '#f2ead8', T(0, 0.01, 0));
  const fish = (x: number, y: number, z: number, k: number, c: string, ry = 0) => {
    p.add(sphere(0.1 * k, 12, 8), c, T(x, y, z, 0, ry, 0, [1, 0.45, 0.32]));
    p.add(cone(0.05 * k, 0.07 * k, 4), c, T(x - Math.cos(ry) * 0.12 * k, y, z + Math.sin(ry) * 0.12 * k, 0, ry, Math.PI / 2, [1, 1, 0.3]));
    p.add(sphere(0.012 * k, 6, 4), INK, T(x + Math.cos(ry) * 0.07 * k, y + 0.012 * k, z - Math.sin(ry) * 0.07 * k + 0.025 * k));
  };
  if (/килька|рыб|лосос|salmon|fish/.test(s) && !/пирог|pie/.test(s)) {
    if (/лосос|roast/.test(s)) { plate(); fish(0, 0.06, 0, 1.25, '#ff9a6a'); p.add(box(0.02, 0.005, 0.03), '#fff', T(0.02, 0.1, 0.03)); }
    else { fish(-0.04, 0.03, 0, 0.6, '#8fb6c8', 0.2); fish(0.04, 0.03, 0.03, 0.6, '#9fc6d8', -0.3); fish(0, 0.06, -0.02, 0.6, '#8fb6c8', 0.1); }
  } else if (/сыр|cheese/.test(s)) {
    p.add(slab([[0, 0], [0.2, 0], [0, 0.12]], 0.12), '#ffd84a', T(-0.07, 0, 0, -Math.PI / 2, 0, 0));
    for (const [x, z] of [[-0.03, 0.02], [0.03, -0.02], [-0.04, -0.03]]) p.add(sphere(0.015, 6, 4), '#e8b923', T(x, 0.06, z));
  } else if (/колбас|ham|sausage/.test(s)) {
    p.add(cyl(0.035, 0.035, 0.26, 10), '#b0443a', T(0, 0.04, 0, 0, 0, Math.PI / 2 - 0.2));
    for (const sx of [-1, 1]) p.add(sphere(0.035, 8, 6), '#b0443a', T(sx * 0.125, 0.04 + sx * 0.026, 0));
    p.add(cyl(0.04, 0.04, 0.005, 10), '#e8a090', T(0.13, 0.067, 0, 0, 0, Math.PI / 2 - 0.2));
  } else if (/пирог|pie/.test(s)) {
    p.add(cyl(0.12, 0.1, 0.06, 16), '#d9a066', T(0, 0.03, 0)); p.add(sphere(0.115, 16, 6), '#e8b070', T(0, 0.055, 0, 0, 0, 0, [1, 0.35, 1]));
    fish(0, 0.1, 0, 0.45, '#c08040');
  } else if (/мят|трав|herb|honey|мёд/.test(s)) {
    for (let i = 0; i < 6; i++) { const a = i * 1.05; p.add(cone(0.035, 0.16, 6), '#6ac46a', T(Math.cos(a) * 0.025, 0.11, Math.sin(a) * 0.025, Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3)); }
    p.add(cyl(0.02, 0.02, 0.09, 6), '#4a8a3a', T(0, 0.04, 0)); p.add(torus(0.025, 0.008, 4, 10), '#ff8fa3', T(0, 0.05, 0, Math.PI / 2));
  } else if (/молок|tea|чай|milk/.test(s)) {
    p.add(cyl(0.06, 0.055, 0.12, 14), '#f2ead8', T(0, 0.06, 0)); p.add(cyl(0.055, 0.055, 0.01, 14), '#fff8ee', T(0, 0.115, 0));
    p.add(torus(0.035, 0.012, 6, 12), '#f2ead8', T(0.065, 0.06, 0, 0, 0, 0)); p.add(sphere(0.02, 6, 4), '#ffcf4a', T(0, 0.125, 0.02, 0, 0, 0, [1, 0.3, 1]));
  } else if (/уха|суп|stew|рагу/.test(s)) {
    p.add(sphere(0.1, 14, 8), '#3a3448', T(0, 0.08, 0, 0, 0, 0, [1, 0.75, 1])); p.add(cyl(0.085, 0.085, 0.01, 14), '#e8a050', T(0, 0.13, 0));
    p.add(torus(0.09, 0.012, 4, 16), '#2a2440', T(0, 0.13, 0, Math.PI / 2)); fish(0, 0.14, 0, 0.3, '#ff9a6a');
  } else if (/сметан|bowl|миск|корм|pretzel|крендел/.test(s)) {
    p.add(cyl(0.1, 0.07, 0.06, 16), /корм|pretzel/.test(s) ? '#ff8fa3' : '#7fb0e8', T(0, 0.03, 0));
    if (/корм|pretzel/.test(s)) for (let i = 0; i < 9; i++) p.add(sphere(0.022, 6, 4), i % 2 ? '#a0603a' : '#c07a44', T(Math.cos(i * 2.4) * 0.05 * (i % 3) / 2, 0.065, Math.sin(i * 2.4) * 0.05 * (i % 3) / 2));
    else p.add(sphere(0.085, 14, 6), '#fff8ee', T(0, 0.06, 0, 0, 0, 0, [1, 0.3, 1]));
  } else if (/хлеб|bread/.test(s)) {
    p.add(capsuleLike(), '#d9a066', T(0, 0.05, 0));
  } else if (/яблок|apple/.test(s)) {
    p.add(sphere(0.06, 12, 8), '#e0504a', T(0, 0.06, 0)); p.add(cyl(0.005, 0.005, 0.03, 4), DWOOD, T(0, 0.125, 0)); p.add(cone(0.02, 0.03, 4), '#5a9a4a', T(0.02, 0.12, 0, 0, 0, -1));
  } else {
    plate(); p.add(sphere(0.07, 10, 6), '#e8b070', T(0, 0.05, 0, 0, 0, 0, [1.2, 0.6, 1]));
  }
  return p.build();
}
function capsuleLike(): THREE.BufferGeometry { const g = new THREE.CapsuleGeometry(0.05, 0.14, 4, 10); g.rotateZ(Math.PI / 2); return g; }
function matModel(mat: string): THREE.BufferGeometry {
  const p = new Parts();
  p.add(box(0.2, 0.05, 0.2), '#a3122a', T(0, 0.025, 0)); p.add(sphere(0.02, 6, 4), GOLD, T(0.1, 0.05, 0.1));
  if (mat === 'star') { p.add(star(0.1, 0.04), '#ffd84a', T(0, 0.16, 0)); p.add(sphere(0.03, 8, 6), '#fff3c4', T(0, 0.16, 0.025)); }
  else { p.add(sphere(0.085, 16, 12), '#7fd6ff', T(0, 0.14, 0)); p.add(sphere(0.03, 8, 6), '#ffffff', T(-0.03, 0.17, 0.06)); p.add(torus(0.088, 0.008, 4, 20), GOLD, T(0, 0.14, 0, Math.PI / 2)); }
  return p.build();
}
function genericModel(slot: string, rar: string): THREE.BufferGeometry {
  const p = new Parts();
  p.add(box(0.18, 0.12, 0.14), '#a8754f', T(0, 0.06, 0)); p.add(box(0.19, 0.03, 0.15), RARITY_HEX[rar] || '#c9ccd6', T(0, 0.08, 0));
  if (slot === 'scroll') { p.list = []; p.skins = []; p.add(cyl(0.03, 0.03, 0.22, 10), '#f2e6c8', T(0, 0.03, 0, 0, 0, Math.PI / 2)); p.add(torus(0.032, 0.006, 4, 10), '#a3122a', T(0, 0.03, 0, 0, Math.PI / 2, 0)); }
  return p.build();
}

/** Local model geometry (vertex colours) for a stock item. Pivot: bottom centre (y = 0); weapons grip-down. */
export function localItemGeometry(it: StockItem): THREE.BufferGeometry {
  const L = (it.look || {}) as Record<string, string>, r = it.rarity || 'common';
  if (L.weapon) return weaponModel(L.weapon, r);
  if (L.shield) return shieldModel(L.shield, r);
  if (L.hat) return hatModel(L.hat, r);
  switch (it.slot) {
    case 'armor': return armorModel(L.armor || (it.gear === 'cloth' ? 'robe' : it.gear === 'light' ? 'leather' : 'lorica'), r);
    case 'trinket': return charmModel(String(L.aura || L.charm || 'plain'), r);
    case 'potion': return potionModel(+((it.effect as any)?.heal || 0), it.id);
    case 'food': return foodModel(it.name || '', it.id);
    case 'material': return matModel(String(it.mat || (/sphere/.test(it.id) ? 'sphere' : 'star')));
    case 'weapon': return weaponModel('sword', r);
    case 'shield': return shieldModel('round', r);
    case 'helmet': return hatModel('cap', r);
    default: return genericModel(it.slot, r);
  }
}

/** The local models as a registry factory (for the item-model registry fallback / dev pages). */
export const localItemFactory: ItemModelFactory = (look, o) => {
  const it: StockItem = { id: o.id || '', name: o.id || '', slot: o.slot, rarity: o.rarity, look: look as Record<string, unknown> };
  return ownMesh(localItemGeometry(it));
};

/* ------------------------------------------------------------------ resolve + bake */

/** Mesh whose geometry we own (bakeModels disposes it after merging; registry geometries may be shared — never). */
function ownMesh(g: THREE.BufferGeometry): THREE.Mesh { const m = new THREE.Mesh(g, toonMat('n')); m.userData.l3dOwnGeo = true; return m; }

export interface ModelSource { itemModels?: Registry<ItemModelFactory> | null }

/** Build a model Object3D for a good (registry first for gear keys, local otherwise). */
export function itemObject(it: StockItem, src: ModelSource): THREE.Object3D {
  const reg = src.itemModels, key = itemKey(it), opts = { rarity: it.rarity || 'common', slot: it.slot, id: it.id };
  const look = (it.look || {}) as Record<string, unknown>;
  const tryReg = (k: string): THREE.Object3D | null => {
    const f = reg && reg.get(k);
    if (!f) return null;
    try { return f(look, opts); } catch (e) { console.warn('[l3d rooms] item model', k, e); return null; }
  };
  const consumable = !key.startsWith('weapon:') && !key.startsWith('shield:') && !key.startsWith('hat:') && !key.startsWith('armor:') && !key.startsWith('charm:');
  // food: the registry model is keyed by the legacy site id, so pass the shown name along — the factory picks the model by it
  if (it.slot === 'food') { const f = reg && reg.get('food:' + it.id); if (f) try { return f({ ...look, name: it.name }, opts); } catch (e) { console.warn('[l3d rooms] item model', it.id, e); } }
  // a style with its own consumables (styles/cherts/goods.js: «зелье жара», charred parchment): the registry draws them
  if ((it.slot === 'potion' || it.slot === 'scroll') && styledGoods(it.slot, look)) {
    const f = reg && reg.get('slot:' + it.slot);
    if (f) try { return f({ ...look, name: it.name, effect: it.effect }, opts); } catch (e) { console.warn('[l3d rooms] item model', it.id, e); }
  }
  const exact = consumable ? (it.slot === 'food' ? null : tryReg(it.slot + ':' + it.id)) : tryReg(key);
  if (exact) return exact;
  try { return ownMesh(localItemGeometry(it)); } catch (e) { console.warn('[l3d rooms] local model', it.id, e); }
  return tryReg('slot:' + it.slot) || tryReg('*') || ownMesh(genericModel(it.slot, it.rarity));
}

export interface Placed {
  /** Model to place (object space: pivot at bottom centre). */
  obj: THREE.Object3D;
  /** Target transform: position of the pivot, yaw, and the box the model must fit in (largest side). */
  x: number; y: number; z: number; ry?: number; rx?: number; rz?: number;
  fit: number;
  /** Fit to height instead of the largest side. */
  fitH?: boolean;
  /** Centre the model on its bounding box horizontally (default true). */
  centre?: boolean;
}

const _bb = new THREE.Box3(), _sz = new THREE.Vector3(), _ct = new THREE.Vector3(), _c = new THREE.Color();

/**
 * Merge placed models into: one toon mesh (all lit vertex-colour parts) + its outline, one unlit mesh (basic
 * materials), plus untouched meshes for textured/transparent parts. Returns the group and each placement's world box.
 */
export function bakeModels(list: Placed[], o: { outline?: boolean } = {}): { group: THREE.Group; boxes: THREE.Box3[]; ranges: { start: number; count: number }[]; lit: THREE.BufferGeometry | null; owned: { dispose(): void }[] } {
  const lit: THREE.BufferGeometry[] = [], unlit: THREE.BufferGeometry[] = [];
  const extra: THREE.Object3D[] = [];
  const boxes: THREE.Box3[] = [];
  const ranges: { start: number; count: number }[] = [];
  let litN = 0;
  const owned: { dispose(): void }[] = [];
  const m = new THREE.Matrix4(), place = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (const P of list) {
    const start = litN;
    P.obj.updateMatrixWorld(true);
    _bb.setFromObject(P.obj, true);
    if (_bb.isEmpty()) { boxes.push(new THREE.Box3(new THREE.Vector3(P.x - 0.1, P.y, P.z - 0.1), new THREE.Vector3(P.x + 0.1, P.y + 0.2, P.z + 0.1))); ranges.push({ start, count: 0 }); continue; }
    _bb.getSize(_sz); _bb.getCenter(_ct);
    const s = P.fit / Math.max(1e-3, P.fitH ? _sz.y : Math.max(_sz.x, _sz.y, _sz.z));
    e.set(P.rx || 0, P.ry || 0, P.rz || 0); q.setFromEuler(e);
    // pivot: bottom centre of the model's box
    const pre = new THREE.Matrix4().makeTranslation(P.centre === false ? 0 : -_ct.x, -_bb.min.y, P.centre === false ? 0 : -_ct.z);
    place.compose(new THREE.Vector3(P.x, P.y, P.z), q, new THREE.Vector3(s, s, s)).multiply(pre);
    const wb = new THREE.Box3();
    P.obj.traverse((ob) => {
      const mesh = ob as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const mat = mesh.material as THREE.Material | THREE.Material[];
      m.multiplyMatrices(place, mesh.matrixWorld);
      if (Array.isArray(mat) || (mat as any).map || mat.transparent) {
        const c = mesh.clone(); c.matrixAutoUpdate = false; c.matrix.copy(m); extra.push(c);
        wb.union(new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position as THREE.BufferAttribute).applyMatrix4(m));
        return;
      }
      if (mat.side === THREE.BackSide) return;   // their outline hull: we add one outline for the whole bake
      const g0 = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      for (const k of Object.keys(g0.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g0.deleteAttribute(k);
      if (!g0.attributes.normal) g0.computeVertexNormals();
      const n = g0.attributes.position.count;
      const base = (mat as any).color as THREE.Color | undefined;
      const vc = (mat as any).vertexColors && g0.attributes.color;
      const col = new Float32Array(n * 3);
      const src = vc ? (g0.attributes.color as THREE.BufferAttribute) : null;
      for (let i = 0; i < n; i++) {
        if (src) _c.setRGB(src.getX(i), src.getY(i), src.getZ(i)); else _c.setRGB(1, 1, 1);
        if (base) _c.multiply(base);
        col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
      }
      g0.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g0.applyMatrix4(m);
      g0.computeBoundingBox(); wb.union(g0.boundingBox!);
      if ((mat as THREE.MeshBasicMaterial).isMeshBasicMaterial) unlit.push(g0); else { lit.push(g0); litN += n; }
    });
    ranges.push({ start, count: litN - start });
    boxes.push(wb.isEmpty() ? new THREE.Box3(new THREE.Vector3(P.x - 0.1, P.y, P.z - 0.1), new THREE.Vector3(P.x + 0.1, P.y + 0.2, P.z + 0.1)) : wb);
  }
  const group = new THREE.Group(); group.name = 'room:goods';
  const merge = (gs: THREE.BufferGeometry[]): THREE.BufferGeometry | null => {
    if (!gs.length) return null;
    let nv = 0; for (const g of gs) nv += g.attributes.position.count;
    const Pp = new Float32Array(nv * 3), N = new Float32Array(nv * 3), C = new Float32Array(nv * 3);
    let o2 = 0;
    for (const g of gs) {
      Pp.set(g.attributes.position.array as Float32Array, o2 * 3); N.set(g.attributes.normal.array as Float32Array, o2 * 3); C.set(g.attributes.color.array as Float32Array, o2 * 3);
      o2 += g.attributes.position.count; g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(Pp, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); out.setAttribute('color', new THREE.BufferAttribute(C, 3));
    out.computeBoundingSphere(); out.computeBoundingBox();
    owned.push(out);
    return out;
  };
  const gl = merge(lit);
  if (gl) {
    const mesh = new THREE.Mesh(gl, toonMat('n')); mesh.name = 'room:goods:lit'; group.add(mesh);
    if (o.outline !== false) { const ol = new THREE.Mesh(gl, outlineMat('n', 8, 0.006)); ol.name = 'room:goods:outline'; group.add(ol); }
  }
  const gu = merge(unlit);
  if (gu) { const mat = new THREE.MeshBasicMaterial({ vertexColors: true }); owned.push(mat); const mesh = new THREE.Mesh(gu, mat); mesh.name = 'room:goods:unlit'; group.add(mesh); }
  for (const x of extra) group.add(x);
  // source objects: free their geometries (local models own theirs; registry objects are fresh per call)
  for (const P of list) P.obj.traverse((ob) => { if (ob.userData.l3dOwnGeo) (ob as THREE.Mesh).geometry.dispose(); });
  return { group, boxes, ranges, lit: gl, owned };
}
