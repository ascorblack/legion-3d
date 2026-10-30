/** Visual uplift round 2 (expedition): the new foreground dressing, the glowing platform and the nameplate declutter. */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Terrain } from '../src/expedition/terrain';
import { ExpMats } from '../src/expedition/mats';
import { platformGeo, propGeo, disposeArt, type PropKind } from '../src/expedition/art';

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

describe('expedition visuals round 2', () => {
  it('desert and gorge carry foreground dressing in front of the action, in both modes', () => {
    const mats = new ExpMats();
    for (const id of ['desert', 'gorge'] as const) for (const mode of ['path', 'clearing'] as const) {
      const t = new Terrain(mats, id, mode, { seed: 11, quality: 2 });
      let near = 0;
      t.root.traverse((o: any) => {
        if (!o.isInstancedMesh) return;
        const m = new THREE.Matrix4(), p = new THREE.Vector3();
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); p.setFromMatrixPosition(m); if (p.z > 3.2 && p.z < 14) near++; }
      });
      expect(near, `${id}/${mode} foreground instances`).toBeGreaterThan(40);
      t.dispose();
    }
    disposeArt();
  });
  it('the new props are valid, textured by vertex colour and light', () => {
    for (const k of ['sandrock', 'scree', 'shrub', 'ribs', 'arch', 'slab'] as PropKind[]) for (const pal of [0, 1]) {
      const g = propGeo(k, pal);
      expect(tris(g), k).toBeGreaterThan(20); expect(tris(g), k).toBeLessThan(1600);
      expect(g.attributes.color && g.attributes.aTint).toBeTruthy();
      g.computeBoundingBox(); expect(g.boundingBox!.min.y, k + ' stands on the ground').toBeGreaterThan(-0.6);
    }
    disposeArt();
  });
  it('the boss-arena platform glows (vertex colour > 1 = emissive) and stays cheap', () => {
    const g = platformGeo();
    const c = g.attributes.color.array as Float32Array;
    let glow = 0; for (let i = 0; i < c.length; i += 3) if (Math.max(c[i], c[i + 1], c[i + 2]) > 1) glow++;
    expect(glow).toBeGreaterThan(100);
    expect(tris(g)).toBeLessThan(2500);
    disposeArt();
  });
});
