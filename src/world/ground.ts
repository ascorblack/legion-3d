/**
 * Analytic ground height of the city (no raycasts, no three.js) — shared by the world builder and tests.
 * Upper fair street (y < ledge) is at 0 m, the lower street is LOW_H lower; stairs are smooth ramps;
 * bridges over the canal have a gentle hump; the canal itself is the water surface (not walkable).
 */
import type { CityLayout } from '../contracts';
import { fairCatsOf } from '../net/faircats';
import { fairCatsGround } from './fcground';

export const LOW_H = -1.4;          // lower street height (m)
export const CANAL_WATER = -0.45;   // water surface relative to the lower street (m)
export const BRIDGE_HUMP = 0.18;    // bridge arch height (m)

export interface GroundSpec {
  hasLow: boolean;
  lowH: number;
  /** Stairs x-ranges (px). */
  stairs: [number, number][];
  /** Ramp of the stairs in depth px: starts at rampY0 (height 0) and ends at rampY1 (height lowH). */
  rampY0: number; rampY1: number;
  /** Depth (px) of the retaining wall face outside the stairs. */
  wallY: number;
  edge: [number, number];
  canal: [number, number] | null;
  bridges: [number, number][];
}

export function groundSpec(layout: Pick<CityLayout, 'low'>): GroundSpec {
  const L = layout.low;
  if (!L || !L.edge) {
    return { hasLow: false, lowH: 0, stairs: [], rampY0: 1e9, rampY1: 1e9, wallY: 1e9, edge: [1e9, 1e9], canal: null, bridges: [] };
  }
  const [e0, e1] = L.edge;
  return {
    hasLow: true, lowH: LOW_H,
    stairs: (L.stairs || []).map((s) => [s[0], s[1]] as [number, number]),
    rampY0: e0 - 20, rampY1: e1 + 12,
    wallY: (e0 + e1) / 2,
    edge: [e0, e1],
    canal: L.canal ? [L.canal[0], L.canal[1]] : null,
    bridges: (L.bridges || []).map((b) => [b[0], b[1]] as [number, number]),
  };
}

export function inRanges(v: number, r: [number, number][]): boolean {
  for (let i = 0; i < r.length; i++) if (v >= r[i][0] && v <= r[i][1]) return true;
  return false;
}

/** Height of the stair ramp at depth y (0 … lowH), clamped. */
export function rampAt(s: GroundSpec, y: number): number {
  const t = (y - s.rampY0) / (s.rampY1 - s.rampY0);
  return t <= 0 ? 0 : t >= 1 ? s.lowH : s.lowH * t;
}

export function makeGroundAt(s: GroundSpec): (x: number, y: number) => number {
  if (!s.hasLow) return () => 0;
  const { stairs, bridges, canal, lowH } = s;
  return (x: number, y: number): number => {
    if (y < s.rampY0) return 0;
    if (y <= s.rampY1) {
      if (inRanges(x, stairs)) return rampAt(s, y);
      return y < s.wallY ? 0 : lowH;
    }
    if (canal) {
      const b0 = canal[0] - 10, b1 = canal[1] + 10;
      if (y > b0 && y < b1) {
        if (inRanges(x, bridges)) return lowH + BRIDGE_HUMP * Math.sin(Math.PI * (y - b0) / (b1 - b0));
        if (y >= canal[0] && y <= canal[1]) return lowH + CANAL_WATER;
      }
    }
    return lowH;
  };
}

/** The ground of a layout: the new cats fair has its own (plateau, bank, stairs, pond — fcground.ts). */
export function layoutGroundAt(L: CityLayout): (x: number, y: number) => number {
  const fc = fairCatsOf(L);
  return fc ? fairCatsGround(fc) : makeGroundAt(groundSpec(L));
}
