/**
 * Halloween wall lanterns hang on a VISIBLE wall (bug class «decorations floating»): planned against the walk solids,
 * they used to hang 0.3–1.7 m in front of the facade with the bracket ending in thin air (porches, stalls, the camp's
 * moved-back houses). After snapLanterns every bracket starts at visible city geometry right behind it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { stubDom } from './dom-stub';

beforeAll(() => stubDom());

describe('halloween wall lanterns touch the facade', () => {
  for (const town of ['fair', 'camp', 'village']) {
    it(town, async () => {
      const D = await import('../dev/fixtures');
      const { buildCity } = await import('../src/world');
      const { fromX, fromZ } = await import('../src/world/coords');
      const { planHalloween } = await import('../src/events/halloween/placement');
      const { placeCity, snapLanterns } = await import('../src/events/halloween/index');
      const L = town === 'camp' ? D.campFixtureLayout() : town === 'village' ? D.villageFixtureLayout() : D.fixtureLayout();
      const w = await buildCity(L, { quality: 2 } as never);
      w.root.updateMatrixWorld(true);
      const plan = planHalloween(placeCity({ layout: L, world: w, groundAt: (X: number, Z: number) => w.groundAt(fromX(X), fromZ(Z)) } as never));
      snapLanterns(plan.lanterns, w.root);
      expect(plan.lanterns.length).toBeGreaterThan(3);
      const statics = w.root.getObjectByName('world:static')!.children;
      const rc = new THREE.Raycaster();
      for (const l of plan.lanterns) {
        rc.set(new THREE.Vector3(l.x, l.y + 0.5, l.wallZ + 0.05), new THREE.Vector3(0, 0, -1)); rc.far = 0.12;
        expect(rc.intersectObjects(statics, false).length, `lantern at ${l.x.toFixed(2)}: no wall behind its bracket`).toBeGreaterThan(0);
        expect(l.z - l.wallZ).toBeLessThan(0.5);
      }
      w.dispose();
    }, 60000);
  }
});
