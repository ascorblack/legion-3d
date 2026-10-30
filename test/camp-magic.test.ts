import { describe, it, expect } from 'vitest';
import { staticCity } from './world-fixture';
import { campFixtureLayout, CAMP_MAGIC } from '../dev/fixtures';
import { SolidMap, collectSolids, makeSolidTop } from '../src/world/solid';


// site campmap.js 30.10 (fix/camp-magic-shop): a magic shop between the Storage and the Forge (`magic: true`), only for a hero with the shop open
describe('3D camp «Перепутье» with the magic shop', () => {
  const plain = campFixtureLayout('cats', false), magic = campFixtureLayout('cats', true);
  it('the layout has the magic building only with the flag; the door is on the walkable trail', () => {
    expect(plain.buildings.map((b) => b.id)).not.toContain('magic');
    expect(magic.buildings.map((b) => b.id).sort()).toEqual(['forge', 'gate', 'magic', 'shop', 'storage', 'tent']);
    expect(magic.free(CAMP_MAGIC.door.x, CAMP_MAGIC.door.y)).toBe(true);
  });
  it('is built in 3D: more solid geometry, a solid wall where the building stands, the door gap stays open', () => {
    const a = staticCity(false, plain), b = staticCity(false, magic);
    expect((b.k.solids ?? []).length).toBeGreaterThan((a.k.solids ?? []).length);
    const top = makeSolidTop(magic, new SolidMap(collectSolids(magic, b.spec, b.k.solids ?? [], b.k.inst)));
    const [x0, x1] = CAMP_MAGIC.hit as unknown as number[];
    expect(top((x0 + x1) / 2, 800 - 4)).toBe(Infinity);
  });
});
