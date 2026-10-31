/**
 * The game's content registries with their built-in defaults. Modules add entries from src/features/* (one line in
 * src/features/index.ts per module). Ids mirror the site (see `npm run drift`).
 */
import type { BuildingDef, ItemModelFactory, KeyBinding, MenuTabDef, Registry, RoomDef } from '../contracts/ext';
import { createRegistry } from './registry';

export interface Registries {
  buildings: Registry<BuildingDef>;
  rooms: Registry<RoomDef>;
  itemModels: Registry<ItemModelFactory>;
  menus: Registry<MenuTabDef>;
  keys: Registry<KeyBinding>;
}

/**
 * Site building id → how it opens. Interiors with goods on shelves walk in 3D ('shop3d'); service buildings show a 3D
 * scene with the site's own panel docked over it ('hybrid'); the mine is its own 3D location; unknown → the site's
 * 2D screen (registry fallback). `scene` (room variant) defaults to the building id in the room modules; set it only to
 * reuse another variant (e.g. a new building that looks like the forge: { room: 'shop3d', scene: 'forge' }).
 */
export const DEFAULT_BUILDINGS: Record<string, BuildingDef> = {
  forge: { model: 'forge', room: 'shop3d' },
  magic: { model: 'magic', room: 'shop3d' },
  shop: { model: 'shop', room: 'shop3d' },
  tent: { model: 'tent', room: 'shop3d' },
  trainer: { model: 'trainer', room: 'hybrid' },
  board: { model: 'board', room: 'hybrid' },
  hall: { model: 'hall', room: 'hybrid' },
  auction: { model: 'auction', room: 'hybrid' },
  storage: { model: 'storage', room: 'hybrid' },
  gate: { model: 'gate', room: 'hybrid' },
  anvil: { model: 'anvil', room: 'hybrid' },
  mine: { model: 'mine', room: 'mine3d' },
  mineboard: { model: 'mineboard', room: 'site' },
  // 30.10: «Тюрьма и клетка» — cannot be entered; E shows the site's Jail window (who sits, until when)
  jail: { model: 'jail', room: 'site' },
};
export const BUILDING_FALLBACK: BuildingDef = { room: 'site' };

export function createRegistries(): Registries {
  const buildings = createRegistry<BuildingDef>('buildings', BUILDING_FALLBACK);
  for (const [id, d] of Object.entries(DEFAULT_BUILDINGS)) buildings.register(id, d);
  return {
    buildings,
    rooms: createRegistry<RoomDef>('rooms'),
    itemModels: createRegistry<ItemModelFactory>('itemModels'),
    menus: createRegistry<MenuTabDef>('menus'),
    keys: createRegistry<KeyBinding>('keys'),
  };
}
