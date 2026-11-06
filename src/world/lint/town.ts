/**
 * Geometry lint — a whole town as a lint source: the static city rebuilt from its CityLayout into a fresh Ctx with a
 * LintCollector on the batch (no renderer, no DOM: a fake sign atlas), the instanced props expanded, the door marks and
 * the door interactables (with the hover outline region the doors feature would use). Used by test/geom-lint.test.ts
 * and at runtime by src/features/geomlint.ts (`?lint=1`, Settings → Отладка → «Проверка геометрии»).
 */
import type * as THREE from 'three';
import type { CityLayout } from '../../contracts';
import { Batch } from '../batch';
import { groundSpec, layoutGroundAt } from '../ground';
import { paletteOf } from '../palette';
import { rng, type SignAtlas } from '../textures';
import { Instancer } from '../instancer';
import { toZ, fromX, fromZ } from '../coords';
import type { Ctx } from '../kit';
import { buildStatic } from '../static';
import { registerProtoProps, LAMP_HEAD_Y } from '../protoProps';
import { VK } from '../village';
import { BUILDERS } from '../props/kinds';
import { doorInteractables, outlineRegion } from '../worldExt';
import { LintCollector } from './collect';
import type { LintSource } from './types';

export function lintTownSource(where: string, L: CityLayout, quality = 2): LintSource & { k: Ctx; L: CityLayout } {
  const spec = groundSpec(L), groundAt = layoutGroundAt(L), P = paletteOf(L.styleId);
  const signs = { add: () => ({ uv: [0, 0, 1, 1] as [number, number, number, number], aspect: 4 }), texture: null } as unknown as SignAtlas;
  const k: Ctx = {
    b: new Batch(14), pal: P, signs, inst: new Instancer(), glows: [], lights: [], bulbs: [], wires: [], rnd: rng(1234), quality,
    lowH: spec.lowH, wallZ: spec.hasLow ? toZ(spec.wallY) : 0, colliders: [], pools: [], solids: [], marks: [],
  };
  const col = new LintCollector(() => k.b.tagSeq, () => k.b.role);
  k.b.recorder = col.add;
  buildStatic(k, L, spec, groundAt, LAMP_HEAD_Y);
  // the kinds buildCity registers at build time (placeholders, the prop kit's hero kinds, the village aliases)
  registerProtoProps(k.inst, k.pal);
  for (const [of, as] of Object.entries(VK)) k.inst.alias(as, of);
  for (const kind of k.inst.placed.keys()) {
    if (k.inst.has(kind) || !(kind in BUILDERS)) continue;
    const parts = (BUILDERS as Record<string, (o: object) => { geo: THREE.BufferGeometry; mat: string }[]>)[kind]({});
    k.inst.registerKind(kind, parts.filter((p) => p.mat !== 'outline').map((p) => ({ geo: p.geo, mat: p.mat })));
  }
  col.addInstances(k.inst);
  const G = (x: number, z: number) => groundAt(fromX(x), fromZ(z));
  const doors = doorInteractables(L, groundAt, () => undefined, k.marks).map((d) => ({ id: d.id, hit: d.hit as THREE.Box3, outlineBox: outlineRegion(d) ?? undefined }));
  return { where, pieces: col.pieces, groundAt: G, marks: k.marks, doors, k, L };
}
