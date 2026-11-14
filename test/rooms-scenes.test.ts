/**
 * Every shop3d / hybrid room builds offline within budget, keeps the purchase safety (aim-only goods, disjoint hit
 * volumes, exactly one highlighted good, the card bound to its item), and leaves the TP camera a full arm at the
 * spawn (cutaway entrance wall + vestibule). Fake site and actions — nothing is ever sent.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { outlineOwner, outlineSources } from '../src/engine/outline';
import meJson from './fixtures/me.json';
import stockJson from './fixtures/stock.json';
import { overlaps } from '../src/rooms/common/hits';

beforeAll(() => {
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'getImageData' || k === 'createImageData') return (_x: number, _y?: number, w = 4, h = 4) => ({ data: new Uint8ClampedArray((w || 4) * (h || 4) * 4), width: w, height: h });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
      if (k === 'measureText') return () => ({ width: 10 });
      return () => {};
    },
    set: () => true,
  });
  class FakeEl {
    style: Record<string, string> = {}; dataset: Record<string, string> = {}; width = 0; height = 0; innerHTML = ''; textContent = ''; className = '';
    classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    getContext() { return ctx; }
    attachShadow() { return new FakeEl(); }
    appendChild(c: unknown) { return c; }
    remove() {} focus() {} setAttribute() {} addEventListener() {} removeEventListener() {}
    querySelector() { return new FakeEl(); }
    querySelectorAll() { return []; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; }
  }
  (globalThis as any).document = { createElement: () => new FakeEl(), body: new FakeEl(), pointerLockElement: null, exitPointerLock() {} };
  (globalThis as any).window = Object.assign(globalThis as any, { addEventListener() {}, removeEventListener() {} });
});

const SHOPS = ['forge', 'magic', 'shop', 'tent'];
const HYBRIDS = ['trainer', 'board', 'hall', 'auction', 'storage', 'gate', 'anvil', 'plain'];

async function build(id: string, posts: { path: string; body: any }[] = []) {
  const { createShopRoom } = await import('../src/rooms/shop');
  const { createHybridRoom } = await import('../src/rooms/hybrid');
  const inters: any[] = [];
  let target: any = null;
  const hero = { ...JSON.parse(JSON.stringify((meJson as any).hero)), money: 100000 };
  const store: any = { hero, me: null, walkers: new Map(), chat: [], online: 1, quest: null, layout: null, on: () => () => {} };
  const actions: any = { get: async () => stockJson, post: async (path: string, body: any) => { posts.push({ path, body }); return { ok: true }; } };
  const env: any = {
    building: { id, title: id, hit: [0, 0, 0, 0], door: { x: 0, y: 0 } }, styleId: 'cats', quality: 2, store, actions,
    input: { setGameplay() {} }, interact: { add: (i: any) => { inters.push(i); return () => {}; }, get target() { return target; } },
    scene: null, itemModels: null, toast() {}, exit() {}, showSitePanel() {}, hideSitePanel() {}, player: () => ({ x: 0, z: 3 }),
  };
  const room = SHOPS.includes(id) ? await createShopRoom(env, { stock: stockJson as any }) : await createHybridRoom(env);
  return { room, inters, setTarget: (t: any) => { target = t; } };
}

function budget(root: THREE.Object3D) {
  let tris = 0, meshes = 0;
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !(m.material as THREE.Material).visible) return;
    meshes++;
    const g = m.geometry, n = g.index ? g.index.count : g.attributes.position.count;
    tris += Math.min(n, g.drawRange.count) / 3;
  });
  return { tris, meshes };
}

/** Free TP arm (m) from the spawn: pivot 1.6 m over the feet, looking along the spawn facing, camera behind + right shoulder. */
function tpArm(room: any): number {
  const s = room.spawn, yaw = s.face;
  const piv = new THREE.Vector3(s.x, room.groundAt(s.x, s.z) + 1.6, s.z);
  const dir = new THREE.Vector3(Math.sin(yaw) * 3.2 + Math.cos(yaw) * 0.72, 0.18, Math.cos(yaw) * 3.2 - Math.sin(yaw) * 0.72);
  const L = dir.length(); dir.normalize();
  const ray = new THREE.Raycaster(piv, dir, 0, L + 0.22);
  for (const c of room.colliders || []) c.updateMatrixWorld(true);
  const hits = ray.intersectObjects(room.colliders || [], true);
  return hits.length ? hits[0].distance - 0.22 : L;
}

describe('every room', () => {
  for (const id of [...SHOPS, ...HYBRIDS]) {
    it(`${id}: builds within budget; TP camera keeps its arm at the spawn`, async () => {
      const { room } = await build(id);
      const b = budget(room.root);
      expect(b.meshes).toBeLessThanOrEqual(80);
      expect(b.tris).toBeLessThanOrEqual(70000);
      expect(room.free(room.spawn.x, room.spawn.z)).toBe(true);
      expect(tpArm(room)).toBeGreaterThan(2.6);
      // the exit is aimable from inside (looking at the door) but not from the TP camera behind the entrance wall
      const exit = (await build(id)).inters.find((i: any) => i.id === 'room:exit');
      expect(exit).toBeTruthy();
      const ex = exit.hit as THREE.Object3D; ex.updateMatrixWorld(true);
      const ec = new THREE.Box3().setFromObject(ex).getCenter(new THREE.Vector3());
      const s = room.spawn;
      const inside = new THREE.Raycaster(new THREE.Vector3(ec.x, ec.y, s.z - 0.5), new THREE.Vector3(0, 0, 1));
      expect(inside.intersectObject(ex, true).length).toBeGreaterThan(0);
      const behind = new THREE.Raycaster(new THREE.Vector3(ec.x, ec.y, ec.z + 2.5), new THREE.Vector3(0, 0, -1));
      expect(behind.intersectObject(ex, true).length).toBe(0);
      let lights = 0; room.root.traverse((o: any) => { if (o.isPointLight) lights++; });
      expect(lights).toBeLessThanOrEqual(9);   // quality 2 cap (7) + the anvil's blow flash
      room.dispose();
    });
  }
});

describe('purchase safety in every shop', () => {
  for (const id of SHOPS) {
    it(`${id}: aim-only goods, disjoint hits, one highlight that follows the target, card bound to its good`, async () => {
      const posts: { path: string; body: any }[] = [];
      const { room, inters, setTarget } = await build(id, posts);
      const goods = inters.filter((i) => i.id.startsWith('room:good:'));
      const booths = inters.filter((i) => i.id.startsWith('room:booth:'));
      for (const b of booths) expect(b.proximity).toBe(false);
      expect(goods.length + booths.length).toBeGreaterThan(0);
      for (const g of goods) { expect(g.proximity).toBe(false); expect(g.label).toMatch(/^(Купить|Осмотреть): .+ — /); }
      const boxes = goods.map((g) => new THREE.Box3().setFromObject(g.hit));
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j]), `${goods[i].id} × ${goods[j].id}`).toBe(false);
      const base = room.root.userData.l3dRoom;
      const cam = new THREE.PerspectiveCamera();
      // exactly one highlight, on the aimed good (its own vertex range)
      for (const g of goods.slice(0, 4)) {   // (the tent with the magic shop open has looks only: no goods)
        setTarget(g); room.update(0.016, 1, cam);
        expect(base.hot && base.hot.inter).toBe(g);
        // the outline: exactly one carrier, over exactly this good's vertex range (never the whole goods mesh)
        const hi = room.root.getObjectByName('room:highlight') as THREE.Mesh;
        if (base.hot.range.count > 0) {
          expect(outlineSources()).toEqual([hi]);
          expect(outlineOwner()).toBe(base);
          expect(hi.geometry.drawRange.start).toBe(base.hot.range.start);
          expect(hi.geometry.drawRange.count).toBe(base.hot.range.count);
        }
        expect(room.root.getObjectByName('room:highlight:shell')).toBeUndefined();
      }
      setTarget(null); room.update(0.016, 1.1, cam);
      expect(base.hot).toBe(null);
      expect(outlineSources().length).toBe(0);
      if (booths.length) { setTarget(booths[0]); room.update(0.016, 1.2, cam); expect(base.hot).toBe(null); setTarget(null); }
      // the card stays bound to the good it was opened for while the aim moves on
      const buyable = goods.filter((g) => g.label.startsWith('Купить'));
      if (buyable.length >= 2) {
        const [A, B] = buyable;
        setTarget(A); room.update(0.016, 2, cam); A.use('key');
        setTarget(B); room.update(0.016, 2.1, cam);
        const card = base.card;
        expect(card.boundTo).toBe(base.goods.find((g: any) => g.inter === A).it);
        expect(base.hot.inter).toBe(A);
        await card.send();
        expect(posts.length).toBe(1);
        const itA = card.boundTo || base.goods.find((g: any) => g.inter === A).it;
        expect(JSON.stringify(posts[0].body)).toContain(itA.mat || itA.id);
      }
      room.dispose();
    });
  }
});
