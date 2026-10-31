/**
 * Site building ids that have their own 3D street model (src/world/buildings.ts BUILDING_MODELS). Plain data with no
 * imports so scripts (drift report) can read it. Kept equal to Object.keys(BUILDING_MODELS) by test/world-models.test.ts.
 * Every other id still appears in the city: as a generic house (upper street) or a plank barn (lower street) with
 * the site's title on its sign.
 */
export const SUPPORTED_BUILDINGS: readonly string[] = [
  'hall', 'auction', 'trainer', 'board', 'anvil', 'forge', 'gate', 'tent', 'shop', 'magic', 'mine', 'mineboard', 'storage', 'jail',
];
