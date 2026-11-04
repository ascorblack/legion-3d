/**
 * Analytic ground of the new cats fair (src/net/faircats.ts scene; no three.js — shared by the world builder, the player
 * and tests). The site's 2.5D map has two walk levels: the town (level 1, 0 m) and the plateau above the rim polyline
 * (level 2, FC_H). The rim's cliff face (FACE px under the rim in the 2D art, a walk-grid obstacle band) is a rock bank
 * from the rim edge (FC_H) down to rim + FACE (0 m); stairs / the cart ramp (level 3) are smooth ramps from the rim
 * (FC_H) to their foot y1 (0 m). The pier stands a plank above the pond's bank. The mountain (not walkable) is FC_MH
 * above the plateau.
 */
import type { FairCatsScene } from '../net/faircats';
import { inPoly, rimY } from '../net/faircats';

export const FC_H = 2.4;      // plateau above the town (m)
export const FC_MH = 3.4;     // mountain top above the plateau (m)
export const FC_PIER = 0.1;   // pier deck above the town ground (m)
export const FC_POND = -0.32; // pond water surface (m)

/** x of the plateau's west cliff (fc-map.js PLATEAU starts at x 2150). */
export const plateauX0 = (sc: FairCatsScene): number => (sc.plateau.length ? Math.min(...sc.plateau.map((p) => p[0])) : sc.rim[0][0]);

export function fairCatsGround(sc: FairCatsScene): (x: number, y: number) => number {
  const X0 = plateauX0(sc), F = sc.face, stairs = sc.stairs, pier = sc.pier, R = sc.rail;
  return (x: number, y: number): number => {
    for (let i = 0; i < stairs.length; i++) {
      const s = stairs[i];
      if (x >= s.x0 + R && x <= s.x1 - R && y >= s.y0 && y <= s.y1) {   // between the rails (fc-map.js inStair)
        const r = rimY(sc.rim, (s.x0 + s.x1) / 2);
        // down with the bank (rim → rim + FACE): below it the stairs' side bands are town ground again (level 1)
        return y <= r ? FC_H : FC_H * Math.max(0, 1 - (y - r) / Math.min(s.y1 - r, F));
      }
    }
    if (x >= X0) {
      const r = rimY(sc.rim, x);
      if (y < r) return FC_H;
      if (y < r + F) return FC_H * (1 - (y - r) / F);
      return 0;
    }
    if ((x >= pier.x0 && x <= pier.x1 && y >= pier.y0 && y <= pier.y1) || (x >= pier.end[0] && x <= pier.end[2] && y >= pier.end[1] && y <= pier.end[3])) return FC_PIER;
    if (inPoly(sc.pond, x, y)) return FC_POND;
    return 0;
  };
}
