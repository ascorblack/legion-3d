/**
 * Shared uniforms of the day / night cycle (src/world/daynight.ts). One object each, referenced by every outdoor
 * material that has a night-only part, so the cycle drives them all with three numbers (no per-object updates):
 *   lit   — lamps, lit windows, light pools, ground spill, garland bulbs: 1 at night … 0 by day
 *   stars — field stars and constellations: 1 at night … 0 by day
 *   night — how much of the night look is on (1 deep night … 0 full day)
 * Defaults are the night (= the look before the cycle existed), so anything outside a cycled world is unchanged.
 */
export const DN_U = {
  lit: { value: 1 },
  stars: { value: 1 },
  night: { value: 1 },
};
