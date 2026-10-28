import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createInteractSystem } from '../src/core/interact';
import { createRoomManager, type RoomHost } from '../src/core/rooms';
import { createRegistries } from '../src/core/registries';
import { doorBox } from '../src/features/doors';
import { outlineOwner, outlineSources } from '../src/engine/outline';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Building } from '../src/contracts';
import type { RoomScene } from '../src/contracts/ext';

/** Camera at eye height above (x, z) looking along yaw (0 = -Z), pitch 0. */
function cam(x: number, z: number, yaw: number, y = 1.15) {
  const c = new THREE.PerspectiveCamera(75, 1, 0.05, 100);
  c.position.set(x, y, z); c.rotation.set(0, yaw, 0, 'YXZ'); c.updateMatrixWorld(true);
  return c;
}
const feet = (x: number, z: number) => ({ x, y: 0, z });
const door = (id: string, x: number) => new THREE.Box3(new THREE.Vector3(x - 0.6, 0, -1.4), new THREE.Vector3(x + 0.6, 2.6, 0));

describe('InteractSystem', () => {
  it('aims through the crosshair at a Box3 within reach; only E uses it — a mouse click never interacts', () => {
    const s = createInteractSystem();
    const use = vi.fn();
    s.add({ id: 'forge', label: 'Войти: Кузня', hit: door('forge', 0), use });
    // 2 m in front, looking at it
    s.update(cam(0, 2, 0), feet(0, 2));
    expect(s.aimed?.id).toBe('forge');
    expect(s.target?.id).toBe('forge');
    expect(s.use('click')).toBe(false);   // LMB on an aimed door: nothing
    expect(use).not.toHaveBeenCalled();
    expect(s.use('key')).toBe(true);
    expect(use).toHaveBeenLastCalledWith('key');
    // same spot, looking away: not aimed; still near → E works, a click does nothing
    s.update(cam(0, 2, Math.PI), feet(0, 2));
    expect(s.aimed).toBeNull();
    expect(s.near?.id).toBe('forge');
    expect(s.use('click')).toBe(false);
    expect(s.use('key')).toBe(true);
    expect(use).toHaveBeenCalledTimes(2);
  });

  it('a click on an aimed door, shop good or mine stone never uses it; E does', () => {
    const s = createInteractSystem();
    const calls: string[] = [];
    const box = (x: number) => new THREE.Box3(new THREE.Vector3(x - 0.3, 0.8, -1.2), new THREE.Vector3(x + 0.3, 1.5, -0.8));
    for (const [id, x] of [['door:mine', 0], ['good:claw', 3], ['stone:7', 6]] as const) s.add({ id, label: id, hit: box(x), use: (how) => calls.push(`${id}:${how}`) });
    for (const x of [0, 3, 6]) {
      s.update(cam(x, 0, 0), feet(x, 0));
      expect(s.aimed).not.toBeNull();
      expect(s.use('click')).toBe(false);
    }
    expect(calls).toEqual([]);
    for (const x of [0, 3, 6]) { s.update(cam(x, 0, 0), feet(x, 0)); s.use('key'); }
    expect(calls).toEqual(['door:mine:key', 'good:claw:key', 'stone:7:key']);
  });

  it('ignores volumes beyond reach (aim 3 m from the eye + TP extra, proximity 2.2 m from the feet)', () => {
    const s = createInteractSystem();
    s.add({ id: 'd', label: 'd', hit: door('d', 0), use() {} });
    s.update(cam(0, 4, 0), feet(0, 4));       // 4 m away
    expect(s.target).toBeNull();
    s.update(cam(0, 4, 0), feet(0, 4), 1.5);   // TP: camera 1.5 m behind the eye → aim reach 4.5
    expect(s.aimed?.id).toBe('d');
    expect(s.near).toBeNull();
  });

  it('picks the nearest aimed volume, honours enabled() and proximity:false', () => {
    const s = createInteractSystem();
    const far = new THREE.Box3(new THREE.Vector3(-0.5, 0, -2.6), new THREE.Vector3(0.5, 2, -2.4));
    const near = new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.6), new THREE.Vector3(0.5, 2, -0.4));
    let on = true;
    s.add({ id: 'far', label: 'far', hit: far, use() {} });
    s.add({ id: 'near', label: 'near', hit: near, use() {}, enabled: () => on, proximity: false });
    s.update(cam(0, 0, 0), feet(0, 0));
    expect(s.aimed?.id).toBe('near');
    on = false;
    s.update(cam(0, 0, 0), feet(0, 0));
    expect(s.aimed?.id).toBe('far');
    // looking away: 'near' has proximity:false (and is disabled), 'far' is 2.4 m from the feet → nothing
    on = true;
    s.update(cam(0, 0, Math.PI), feet(0, 0));
    expect(s.near).toBeNull();
  });

  it('uses the exact mesh for Object3D hits (AABB hit but mesh missed → not aimed) and skips hidden parents', () => {
    const s = createInteractSystem();
    // a thin rotated plank: its AABB covers the ray, the mesh itself does not
    const g = new THREE.BoxGeometry(2, 0.1, 0.1);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    m.position.set(0, 2.2, -1.5); m.rotation.z = Math.PI / 4;
    const parent = new THREE.Group(); parent.add(m); parent.updateMatrixWorld(true);
    s.add({ id: 'plank', label: 'p', hit: m, use() {}, proximity: false });
    s.update(cam(0, 0, 0), feet(0, 0));        // ray at y=1.15 passes below the plank's middle
    expect(s.aimed).toBeNull();
    const c = cam(0, 0, 0, 2.2);                // eye level with the plank centre → hits
    s.update(c, feet(0, 0));
    expect(s.aimed?.id).toBe('plank');
    parent.visible = false;
    s.update(c, feet(0, 0));
    expect(s.aimed).toBeNull();
  });

  it('remove() and setEnabled(false) clear targets; focus() reuses one object', () => {
    const s = createInteractSystem();
    const off = s.add({ id: 'a', label: 'Войти: A', hit: door('a', 0), use() {} });
    s.update(cam(0, 1, 0), feet(0, 1));
    const f1 = s.focus(), f2 = s.focus();
    expect(f1).toBe(f2);
    expect(f1?.label).toBe('Войти: A');
    expect(f1?.aimed).toBe(true);
    s.setEnabled(false);
    expect(s.target).toBeNull();
    s.update(cam(0, 1, 0), feet(0, 1));
    expect(s.target).toBeNull();
    s.setEnabled(true);
    off();
    s.update(cam(0, 1, 0), feet(0, 1));
    expect(s.target).toBeNull();
    expect(s.size).toBe(0);
  });

  it('outlines exactly one target: own highlight() hook, the visible meshes of a hit, or a fitted proxy for a Box3 — no frames, no shells', () => {
    const scene = new THREE.Scene();
    const s = createInteractSystem({ scene });
    const calls: boolean[] = [];
    // three objects in a row along -Z, aimed one after another by moving the camera sideways
    s.add({ id: 'hook', label: 'h', hit: new THREE.Box3(new THREE.Vector3(-0.3, 0, -1.3), new THREE.Vector3(0.3, 2, -1)), proximity: false, use() {}, highlight: (on: boolean) => calls.push(on) } as any);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2, 0.3), new THREE.MeshBasicMaterial());
    mesh.position.set(2, 1, -1.15); scene.add(mesh); mesh.updateMatrixWorld(true);
    s.add({ id: 'mesh', label: 'm', hit: mesh, proximity: false, use() {} });
    // a "door" baked into a big static mesh: its leaf (inside the Box3) + a wall (much larger, never taken)
    const leaf = new THREE.BoxGeometry(0.5, 1.6, 0.06).translate(4, 0.9, -1.15);
    const wall = new THREE.BoxGeometry(6, 4, 0.2).translate(4, 2, -1.4);
    const merged = new THREE.Mesh(mergeGeometries([leaf.toNonIndexed(), wall.toNonIndexed()]), new THREE.MeshBasicMaterial());
    scene.add(merged); merged.updateMatrixWorld(true);
    s.add({ id: 'box', label: 'b', hit: new THREE.Box3(new THREE.Vector3(3.7, 0, -1.3), new THREE.Vector3(4.3, 2, -1)), proximity: false, use() {} });
    const noJunk = () => { let n = 0; scene.traverse((o) => { if (/highlight/.test(o.name)) n++; }); return n === 0 && mesh.children.length === 0; };
    s.update(cam(0, 1, 0), feet(0, 1));
    expect(s.target?.id).toBe('hook');
    expect(calls).toEqual([true]);
    expect(outlineSources().length).toBe(0);           // the hook draws its own
    s.update(cam(2, 1, 0), feet(2, 1));
    expect(s.target?.id).toBe('mesh');
    expect(calls).toEqual([true, false]);
    expect(outlineSources()).toEqual([mesh]);
    s.update(cam(4, 1, 0), feet(4, 1));
    expect(s.target?.id).toBe('box');
    expect(outlineSources().length).toBe(1);
    const proxy = outlineSources()[0];
    proxy.geometry.computeBoundingBox();
    const pb = proxy.geometry.boundingBox!;
    expect(pb.min.x).toBeCloseTo(3.75); expect(pb.max.x).toBeCloseTo(4.25);   // the leaf only, not the wall
    expect(pb.max.y).toBeCloseTo(1.7);
    expect(noJunk()).toBe(true);
    s.update(cam(4, 1, Math.PI), feet(4, 1));          // look away (proximity:false) → nothing lit
    expect(s.target).toBeNull();
    expect(outlineSources().length).toBe(0);
    expect(outlineOwner()).toBeNull();
  });

  it('doorBox covers the facade around the door and reaches towards the walkable door point', () => {
    const b: Building = { id: 'forge', title: 'Кузня', hit: [2100, 2460, 230, 800], door: { x: 2382, y: 880 } };
    const bx = doorBox(b, 0);
    expect(bx.min.x).toBeCloseTo(23.82 - 0.9);
    expect(bx.max.x).toBeCloseTo(23.82 + 0.78);   // clamped to the building edge (24.6)
    expect(bx.max.y).toBeCloseTo(2.6);
    expect(bx.min.z).toBeLessThan(-1);
    expect(bx.max.z).toBeCloseTo(1.2);            // door point z 1.6 − 0.4
  });
});

/* ------------------------------------------------------------------ room manager */
function roomSetup(opts: { kind?: string; factory?: 'ok' | 'throws' | 'none' } = {}) {
  const regs = createRegistries();
  const log: string[] = [];
  const b: Building = { id: 'trainer', title: 'Тренер', hit: [0, 100, 0, 800], door: { x: 50, y: 820 } };
  const soon: Building = { id: 'hall', title: 'Ратуша', hit: [200, 300, 0, 800], door: { x: 250, y: 820 }, soon: true };
  const interact = createInteractSystem();
  const scene: RoomScene = {
    root: new THREE.Group(), free: () => true, groundAt: () => 0, spawn: { x: 0, z: -1, face: 0 },
    update: () => log.push('update'), dispose: () => log.push('dispose'),
  };
  if (opts.factory !== 'none') regs.rooms.register(opts.kind ?? 'hybrid', {
    async create(ctx) {
      log.push('create:' + ctx.building.id);
      ctx.interact.add({ id: 'exit', label: 'x', hit: new THREE.Box3(), use: () => ctx.exit() });
      if (opts.factory === 'throws') throw new Error('broken');
      return scene;
    },
  });
  const host: RoomHost = {
    ctx: { interact } as any,
    registries: regs,
    building: (id) => (id === b.id ? b : id === soon.id ? soon : undefined),
    setSpace: (sc, back) => log.push(sc ? 'space:room' : `space:city@${back?.x},${back?.y},${back?.face?.toFixed(2)}`),
    openSite: (id) => log.push('site:' + id),
    showPanel: (id) => log.push('panel:' + id),
    hidePanel: () => log.push('panel:off'),
    veil: (t) => log.push('veil:' + (t ?? '-')),
    toast: (t) => log.push('toast:' + t),
  };
  return { mgr: createRoomManager(host), log, interact };
}

describe('RoomManager', () => {
  it('hybrid: builds the scene, swaps the space, opens the site panel; exit restores the street at the door', async () => {
    const { mgr, log, interact } = roomSetup();
    await mgr.enter('trainer');
    expect(mgr.current).toBe('trainer');
    expect(mgr.kind).toBe('hybrid');
    expect(mgr.panel).toBe(true);
    expect(interact.size).toBe(1);
    expect(log).toEqual(['veil:Тренер', 'create:trainer', 'space:room', 'veil:-', 'panel:trainer']);
    mgr.update(0.016, 1, new THREE.PerspectiveCamera());
    mgr.exit();
    expect(mgr.current).toBeNull();
    expect(interact.size).toBe(0);                 // room interactables removed
    expect(log.slice(-4)).toEqual(['update', 'panel:off', 'space:city@50,820,3.14', 'dispose']);
  });

  it("the site's «Выйти» (panel closed by the site) leaves the room", async () => {
    const { mgr, log } = roomSetup();
    await mgr.enter('trainer');
    mgr.panelClosedBySite();
    expect(mgr.current).toBeNull();
    expect(log.filter((x) => x === 'panel:off')).toHaveLength(1);   // drops the transparent mode once
  });

  it('falls back to the site screen: kind not registered, factory throws, kind "site"', async () => {
    const err = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let r = roomSetup({ factory: 'none' });
    await r.mgr.enter('trainer');
    expect(r.log).toEqual(['site:trainer']);
    r = roomSetup({ factory: 'throws' });
    await r.mgr.enter('trainer');
    expect(r.mgr.current).toBeNull();
    expect(r.interact.size).toBe(0);
    expect(r.log.at(-1)).toBe('site:trainer');
    r = roomSetup();
    await r.mgr.enter('mineboard');                 // registered as 'site'
    expect(r.log).toEqual(['site:mineboard']);
    err.mockRestore();
  });

  it('a building under construction only shows a toast', async () => {
    const { mgr, log } = roomSetup();
    await mgr.enter('hall');
    expect(log).toEqual(['toast:Здание ещё строится — скоро откроется']);
  });

  it('exit during loading cancels the pending room', async () => {
    const { mgr, log, interact } = roomSetup();
    const p = mgr.enter('trainer');
    expect(mgr.busy).toBe(true);
    mgr.exit();
    await p;
    expect(mgr.current).toBeNull();
    expect(log).toContain('dispose');
    expect(log).not.toContain('space:room');
    expect(interact.size).toBe(0);
  });
});
