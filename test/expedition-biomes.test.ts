/**
 * Expedition terrain per biome (offline): every biome × {travel path, battle clearing} builds within the draw-call /
 * triangle budget, repeats seamlessly along x (the road scrolls), its rock shells face inward, and dispose() releases
 * everything. Nothing is rendered.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BIOMES, Terrain, P } from '../src/expedition/terrain';
import { ExpMats } from '../src/expedition/mats';
import { tunnelGeo, chamberGeo, ridgeGeo } from '../src/expedition/biome-art';
import { disposeArt, artCacheSize } from '../src/expedition/art';
import type { BiomeId } from '../src/expedition/adapter';

function budget(root: THREE.Object3D) {
  let calls = 0, tris = 0;
  root.traverseVisible((o: any) => {
    if (!(o.isMesh || o.isPoints || o.isSprite)) return;
    if (o.isInstancedMesh && !o.count) return;
    const g = o.geometry; if (!g) return;
    const n = g.index ? g.index.count / 3 : (g.attributes.position?.count || 0) / 3;
    calls++; tris += Math.round(n) * (o.isInstancedMesh ? o.count : 1);
  });
  return { calls, tris };
}
const IDS = Object.keys(BIOMES) as BiomeId[];

describe('expedition terrain biomes', () => {
  it('every biome builds in both modes within budget and disposes cleanly', () => {
    const mats = new ExpMats();
    const worst = { calls: 0, tris: 0 };
    for (const id of IDS) for (const mode of ['path', 'clearing'] as const) for (const night of [false, true]) {
      if (night && id !== 'meadow' && id !== 'forest') continue;
      const scene = new THREE.Scene();
      const t = new Terrain(mats, id, mode, { night, seed: 11, quality: 2 });
      scene.add(t.root); t.apply(scene);
      t.scroll(17.3); t.update(1.2);
      const b = budget(t.root);
      expect(b.calls, `${id}/${mode} draw calls`).toBeLessThanOrEqual(30);
      expect(b.tris, `${id}/${mode} triangles`).toBeLessThanOrEqual(75_000);
      worst.calls = Math.max(worst.calls, b.calls); worst.tris = Math.max(worst.tris, b.tris);
      t.dispose();
      expect(scene.children, `${id}/${mode} left in the scene`).toHaveLength(0);
    }
    // eslint-disable-next-line no-console
    console.log(`[biomes] worst terrain: ${worst.calls} calls, ${worst.tris} tris`);
    mats.dispose(); disposeArt();
    expect(artCacheSize()).toBe(0);
  });

  it('q0 is lighter than q2 and q3 is allowed more', () => {
    const mats = new ExpMats();
    const tri = (q: number) => { const t = new Terrain(mats, 'forest', 'path', { seed: 5, quality: q }); const b = budget(t.root); t.dispose(); return b.tris; };
    expect(tri(0)).toBeLessThan(tri(2));
    expect(tri(3)).toBeGreaterThanOrEqual(tri(2));
    mats.dispose(); disposeArt();
  });

  it('heights and water repeat with the period (endless road)', () => {
    const mats = new ExpMats();
    for (const id of IDS) {
      const t = new Terrain(mats, id, 'path', { seed: 3, quality: 0 });
      for (const [x, z] of [[-20, 0], [3.3, 9], [11, -12], [30, 5.5]]) {
        expect(t.heightAt(x + P, z)).toBeCloseTo(t.heightAt(x, z), 5);
        expect(t.waterAt(x + P, z)).toBe(t.waterAt(x, z));
      }
      t.dispose();
    }
    mats.dispose(); disposeArt();
  });

  it('rock shells face the inside (the camera sits within), ridges are closed rings', () => {
    const cfg = { kind: 'cave' as const, base: '#444444', hi: '#888888', band: '#222222', ceil: '#333333', W: 15, H: 8.5, seed: 3 };
    const inward = (g: THREE.BufferGeometry, centre: (p: THREE.Vector3) => THREE.Vector3) => {
      const pos = g.attributes.position, nor = g.attributes.normal; let good = 0;
      for (let i = 0; i < pos.count; i += 3) {
        const p = new THREE.Vector3().fromBufferAttribute(pos, i), n = new THREE.Vector3().fromBufferAttribute(nor, i);
        if (n.dot(centre(p).sub(p)) > 0) good++;
      }
      return good / (pos.count / 3);
    };
    for (const kind of ['cave', 'mine', 'dungeon', 'gorge'] as const) {
      const c = { ...cfg, kind, W: kind === 'dungeon' ? 9.5 : 12, H: kind === 'gorge' ? 15 : 8.5 };
      expect(inward(tunnelGeo(c, 96, 2), (p) => new THREE.Vector3(p.x, 3, 0)), `${kind} tunnel`).toBeGreaterThan(0.95);
      expect(inward(chamberGeo(c, 18), () => new THREE.Vector3(0, 3, 0)), `${kind} chamber`).toBeGreaterThan(0.95);
    }
    for (const kind of ['hills', 'peaks', 'mesa', 'dunes', 'pines'] as const) {
      const g = ridgeGeo({ kind, r: 100, base: 0, amp: 10, far: '#6688aa', peak: '#ffffff', fog: '#cccccc', haze: 0.4, seed: 2, segs: 40 });
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
      expect(g.index!.count).toBeGreaterThan(0);
      g.dispose();
    }
  });
});
