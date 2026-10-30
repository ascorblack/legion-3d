/**
 * Visual round 2 (characters): structure of the new character dressing.
 *  - contact shadows: ONE instanced draw per scene for the whole crowd; a character that is not updated drops out; the
 *    batch leaves the scene with its last user;
 *  - nameplates: every plate in ONE instanced draw (atlas), drawn far to near, cleaned up on dispose;
 *  - the cel material carries the rim / fill / fur shading (shared program, the first-person paws get their own uniforms).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { stubDom } from './dom-stub';

beforeAll(() => stubDom());

describe('character contact shadows', () => {
  it('one instanced draw for the crowd, stale stamps dropped, removed with the last avatar', async () => {
    const { createAvatar, appearanceFrom } = await import('../src/avatar');
    const { shadowBatches } = await import('../src/avatar/shadows');
    const scene = new THREE.Scene();
    const avs = [0, 1, 2, 3, 4].map((i) => { const a = createAvatar(appearanceFrom('cat' + i, { n: 'Кот' + i }, 'cats')); a.root.position.set(i, 0, -3); scene.add(a.root); return a; });
    scene.updateMatrixWorld(true);
    for (const a of avs) a.update(0.016, 1, 0);
    const batch = scene.getObjectByName('avatar:shadows') as THREE.InstancedMesh;
    expect(batch).toBeTruthy();
    expect(scene.children.filter((o) => o.name === 'avatar:shadows').length).toBe(1);
    batch.onBeforeRender(null as never, scene, null as never, batch.geometry, batch.material as THREE.Material, null as never);
    expect(batch.count).toBe(5);
    const m = new THREE.Matrix4(), p = new THREE.Vector3(); batch.getMatrixAt(2, m); p.setFromMatrixPosition(m);
    expect(p.x).toBeCloseTo(2, 5); expect(p.y).toBeGreaterThan(0.006); expect(p.y).toBeLessThan(0.03);
    // a hidden avatar stamps nothing
    avs[0].root.visible = false;
    const t0 = performance.now(); while (performance.now() - t0 < 170) { /* let the stamps go stale */ }
    for (const a of avs) a.update(0.016, 1.1, 0);
    batch.onBeforeRender(null as never, scene, null as never, batch.geometry, batch.material as THREE.Material, null as never);
    expect(batch.count).toBe(4);
    for (const a of avs) a.dispose();
    expect(scene.getObjectByName('avatar:shadows')).toBeUndefined();
    expect(shadowBatches().length).toBe(0);
  });
});

describe('nameplates', () => {
  it('every shown plate in one instanced draw, far to near; dispose clears it', async () => {
    const { createLabels } = await import('../src/avatar');
    const L = createLabels();
    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 400); cam.position.set(0, 1.6, 4); cam.lookAt(0, 1, 0); cam.updateMatrixWorld();
    const anchors = new Map<string, THREE.Vector3>();
    for (let i = 0; i < 6; i++) { L.set('cat' + i, { name: 'Котик' + i, level: i + 1 }); anchors.set('cat' + i, new THREE.Vector3(i * 1.4 - 3.5, 1.4, -i * 1.5)); }
    for (let k = 0; k < 30; k++) L.update(anchors, cam, 1 / 30);
    const plates = L.root.getObjectByName('labels:plates') as THREE.InstancedMesh;
    expect(plates.isInstancedMesh).toBe(true);
    expect(plates.count).toBe(6);
    let sprites = 0; L.root.traverse((o) => { if ((o as THREE.Sprite).isSprite && o.visible) sprites++; });
    expect(sprites, 'no per-plate sprites any more').toBe(0);
    // far to near: the distance from the camera never grows along the instance order
    const m = new THREE.Matrix4(), p = new THREE.Vector3(); let last = Infinity;
    for (let i = 0; i < plates.count; i++) { plates.getMatrixAt(i, m); p.setFromMatrixPosition(m); const d = p.distanceTo(cam.position); expect(d).toBeLessThanOrEqual(last + 1e-6); last = d; }
    // every plate has its own atlas cell and a positive size
    const uv = plates.geometry.getAttribute('aUv'), sz = plates.geometry.getAttribute('aSz'), cells = new Set<string>();
    for (let i = 0; i < plates.count; i++) { cells.add(`${uv.getX(i).toFixed(4)}|${uv.getY(i).toFixed(4)}`); expect(sz.getX(i)).toBeGreaterThan(0.05); expect(sz.getY(i)).toBeGreaterThan(0.05); }
    expect(cells.size).toBe(6);
    // a removed login frees its cell; dispose detaches everything
    L.remove('cat0'); anchors.delete('cat0');
    for (let k = 0; k < 30; k++) L.update(anchors, cam, 1 / 30);
    expect(plates.count).toBe(5);
    L.dispose();
    expect(L.root.parent).toBeNull();
  });
});

describe('character cel shading', () => {
  it('rim / fill / fur in one shared program; the first-person paws use their own (stronger) uniforms', async () => {
    const { toonMat, TOON_SHADE, TOON_SHADE_VM } = await import('../src/avatar/materials');
    const a = toonMat('n'), b = toonMat('n', 4), v = toonMat('vm');
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    expect(a.customProgramCacheKey()).toBe(v.customProgramCacheKey());
    const sh = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.toon.vertexShader, fragmentShader: THREE.ShaderLib.toon.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms;
    a.onBeforeCompile(sh, null as never);
    expect(sh.fragmentShader).toContain('uRim');
    expect(sh.fragmentShader).toContain('vFurP');
    expect(sh.vertexShader).toContain('vFurP = position');
    expect(sh.uniforms.uRim).toBe(TOON_SHADE.uRim);
    const sv = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.toon.vertexShader, fragmentShader: THREE.ShaderLib.toon.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms;
    v.onBeforeCompile(sv, null as never);
    expect(sv.uniforms.uRim).toBe(TOON_SHADE_VM.uRim);
    expect(TOON_SHADE_VM.uRim.value).toBeGreaterThan(TOON_SHADE.uRim.value);
  });
});

describe('contact shadow keeps the canvas opaque', () => {
  it('blends alpha as dst (never punches a hole in the transparent canvas)', async () => {
    const THREE = await import('three');
    const { ContactShadow, shadowBatches } = await import('../src/avatar/shadows');
    const scene = new THREE.Scene(); const root = new THREE.Object3D(); scene.add(root);
    const cs = new ContactShadow(); cs.stamp(root, 0.5, 0.8);
    const m = shadowBatches()[0].material as THREE.Material;
    expect(m.blending).toBe(THREE.CustomBlending);
    expect(m.blendSrcAlpha).toBe(THREE.ZeroFactor);
    expect(m.blendDstAlpha).toBe(THREE.OneFactor);
    cs.release();
  });
});
