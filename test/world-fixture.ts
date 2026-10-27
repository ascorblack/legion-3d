/** Test helper: the static city built in node (no DOM): fake sign atlas, every Batch piece recorded. */
import { fixtureLayout, campFixtureLayout } from '../dev/fixtures';
import type { CityLayout } from '../src/contracts';
import { Batch } from '../src/world/batch';
import { groundSpec, makeGroundAt } from '../src/world/ground';
import { paletteOf } from '../src/world/palette';
import { rng } from '../src/world/textures';
import { Instancer } from '../src/world/instancer';
import { toZ, fromX, fromZ } from '../src/world/coords';
import type { Ctx } from '../src/world/kit';
import type { SignAtlas } from '../src/world/textures';
import { buildStatic } from '../src/world/static';
import { ZRecorder } from '../src/world/zfight';

export function staticCity(debug = false, layout?: CityLayout) {
  const L = layout ?? fixtureLayout();
  const spec = groundSpec(L), groundAt = makeGroundAt(spec), P = paletteOf(L.styleId);
  const signs = { add: () => ({ uv: [0, 0, 1, 1] as [number, number, number, number], aspect: 4 }), texture: null } as unknown as SignAtlas;
  const rec = new ZRecorder(); rec.keepBoxes = debug;
  const k: Ctx = {
    b: new Batch(14), pal: P, signs, inst: new Instancer(), glows: [], lights: [], bulbs: [], wires: [], rnd: rng(1234), quality: 2,
    lowH: spec.lowH, wallZ: spec.hasLow ? toZ(spec.wallY) : 0, colliders: [], pools: [], solids: [],
  };
  k.b.recorder = rec.add;
  buildStatic(k, L, spec, groundAt, 2.75);
  const ground = (x: number, z: number) => groundAt(fromX(x), fromZ(z));
  return { L, k, rec, ground, spec, groundAt };
}


/** The start camp «Перепутье» built the same way (test/fixtures/camp-map.json). */
export const staticCamp = (debug = false) => staticCity(debug, campFixtureLayout());
