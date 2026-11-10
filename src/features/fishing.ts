/**
 * «Рыбалка» (site 10.11, fish2.js — the «озерцо Рябиненя» mini-game, /api/me hero `cr.fish.f2.on`).
 *
 * The site reaches it from its City: city.js fishWater(x, y) — a click on the water (the cats fair: the pond
 * LGFairCats.POND off the pier; the old fair: the canal LOW.canal between the bridges, 20 px clear of each) walks the hero
 * to the bank and calls window.LGOpenFish2() (app.js openFish2: LGCity.sleep(), LGFish2.open({..., close: LGCity.wake})).
 * Never in the camp, a district / Town Kit town or the jail; only while window.LGFish2On() says it is open for the hero.
 * The mine's «Ремёсла» button and the hero's crafts open the same screen.
 *
 * In 3D: E at the same water (one interactable per piece: the pond, or each canal stretch between bridges) opens the site's
 * own fishing screen (`.f2`, full screen, z 9000). src/net/site.ts reports it as the overlay 'fish': the 3D hides and pauses
 * and comes back when the site closes it and wakes its City. Nothing is sent by us — the site's own screen does the rest.
 * A 3D version of the mini-game: plan in .local/drift1110/FINDINGS.md.
 */
import * as THREE from 'three';
import type { CityLayout, LowerStreet } from '../contracts';
import type { Interactable } from '../contracts/ext';
import { toX, toZ } from '../world/coords';
import { FAIRC } from '../net/faircats';
import { coreFeature } from './types';

type P2 = [number, number];
/** A piece of fishing water in px: box [x0, y0, x1, y1] (+ the pond polygon). */
export interface FishWater { id: string; x0: number; y0: number; x1: number; y1: number; poly?: P2[] }

/** city.js fishSeg: the canal stretches between the bridges (20 px clear of each), y = canal ± 10 px. */
export function canalWaters(low: Pick<LowerStreet, 'canal' | 'bridges'> | null | undefined, W: number): FishWater[] {
  if (!low || !Array.isArray(low.canal)) return [];
  const [c0, c1] = low.canal;
  const br = [...(low.bridges || [])].filter((b) => Array.isArray(b)).sort((a, b) => a[0] - b[0]);
  const out: FishWater[] = [];
  let x = 0;
  for (const [a, b] of br) {
    if (a - 20 > x + 1) out.push({ id: 'fish:canal:' + out.length, x0: x, y0: c0 - 10, x1: a - 20, y1: c1 + 10 });
    x = Math.max(x, b + 20);
  }
  if (W > x + 1) out.push({ id: 'fish:canal:' + out.length, x0: x, y0: c0 - 10, x1: W, y1: c1 + 10 });
  return out;
}
/** city.js fishPond: the cats fair's pond (its bounding box; the pier is the way in). */
export function pondWater(pond: readonly P2[] | null | undefined): FishWater[] {
  if (!pond || pond.length < 3) return [];
  const xs = pond.map((p) => p[0]), ys = pond.map((p) => p[1]);
  return [{ id: 'fish:pond', x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), poly: pond.map((p) => [p[0], p[1]] as P2) }];
}
/** Where the site lets the hero fish on this layout (city.js fishWater): the cats fair's pond, the old fair's canal, else nothing. */
export function fishWaters(L: CityLayout | null | undefined): FishWater[] {
  if (!L) return [];
  const fc = (L as unknown as { faircats?: { pond?: P2[] } }).faircats;
  if (L.id === FAIRC) return pondWater(fc?.pond);
  if (L.id === 'fair' && L.low) return canalWaters(L.low, L.W);
  return [];
}

const W = (typeof window !== 'undefined' ? window : globalThis) as any;
/** app.js window.LGFish2On(): fishing is open for the hero (hero.cr.fish.f2.on). */
export const fishOn = (w: any = W): boolean => { try { return typeof w.LGFish2On === 'function' && !!w.LGFish2On() && typeof w.LGOpenFish2 === 'function'; } catch { return false; } };
/** Prompt: the casts left today like the site's screen (hero.cr.fish.f2 {casts, max}). */
export function fishLabel(hero: any): string {
  const f = hero?.cr?.fish?.f2;
  const c = f && Number.isFinite(+f.casts) ? +f.casts : null, m = f && Number.isFinite(+f.max) ? +f.max : null;
  return c != null && m != null && m > 0 ? `Рыбачить · забросов ${c} из ${m}` : 'Рыбачить';
}

export default coreFeature({
  id: 'fishing',
  order: 46,
  setup(ctx) {
    let offs: (() => void)[] = [];
    const build = () => {
      for (const o of offs) o(); offs = [];
      const L = ctx.layout(), world = ctx.world();
      for (const w of fishWaters(L)) {
        const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2;
        const g = world.groundAt(cx, cy);
        const hit = new THREE.Box3(new THREE.Vector3(toX(w.x0), g - 0.4, toZ(w.y0)), new THREE.Vector3(toX(w.x1), g + 0.5, toZ(w.y1)));
        const it: Interactable = {
          id: w.id,
          get label() { return fishLabel(ctx.store.hero); },
          icon: '🎣',
          hit, reach: 2.6,
          enabled: () => fishOn() && !ctx.state.inRoom && !ctx.state.jailed && !ctx.state.classic && !W.LGFish2?.on,
          use: () => { try { void W.LGOpenFish2(); } catch (e) { console.warn('[legion-3d] fishing', e); } },
        };
        offs.push(ctx.interact.add(it));
      }
    };
    const offW = ctx.onWorld(build);
    build();
    ctx.dev.fishing = { waters: () => fishWaters(ctx.layout()), on: () => fishOn() };
    return () => { offW(); for (const o of offs) o(); offs = []; delete ctx.dev.fishing; };
  },
});
