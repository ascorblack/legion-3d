/**
 * Room geometry has no coplanar overlapping surfaces (z-fighting) — the city's detector (src/world/zfight.ts) run on
 * every shop3d / hybrid room: rugs, mats and floor patches never share a plane with the floor, the closed entrance
 * door's layers are offset, etc.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import meJson from './fixtures/me.json';
import stockJson from './fixtures/stock.json';
import { ZRecorder } from '../src/world/zfight';
import { RoomKit } from '../src/rooms/common/kit';

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

async function build(id: string, posts: { path: string; body: any }[] = [], styleId = 'cats') {
  const { createShopRoom } = await import('../src/rooms/shop');
  const { createHybridRoom } = await import('../src/rooms/hybrid');
  const inters: any[] = [];
  let target: any = null;
  const hero = { ...JSON.parse(JSON.stringify((meJson as any).hero)), money: 100000 };
  const store: any = { hero, me: null, walkers: new Map(), chat: [], online: 1, quest: null, layout: null, on: () => () => {} };
  const actions: any = { get: async () => stockJson, post: async (path: string, body: any) => { posts.push({ path, body }); return { ok: true }; } };
  const env: any = {
    building: { id, title: id, hit: [0, 0, 0, 0], door: { x: 0, y: 0 } }, styleId, quality: 2, store, actions,
    input: { setGameplay() {} }, interact: { add: (i: any) => { inters.push(i); return () => {}; }, get target() { return target; } },
    scene: null, itemModels: null, toast() {}, exit() {}, showSitePanel() {}, hideSitePanel() {}, player: () => ({ x: 0, z: 3 }), ench: { coins: { star: 300, sphere: 900 } },
  };
  const room = SHOPS.includes(id) ? await createShopRoom(env, { stock: stockJson as any }) : await createHybridRoom(env);
  return { room, inters, setTarget: (t: any) => { target = t; } };
}



describe('rooms: z-fighting', () => {
  // + the cherts interiors («Пекельная кузня», «Гардероб демона-франта», «Пекельные ряды»: src/rooms/shop/style.ts)
  for (const [id, st] of [...[...SHOPS, ...HYBRIDS].map((i) => [i, 'cats']), ['forge', 'cherts'], ['shop', 'cherts'], ['tent', 'cherts']] as [string, string][]) {
    it(`${id}${st === 'cats' ? '' : ' (' + st + ')'}: no coplanar overlaps`, async () => {
      const rec = new ZRecorder();
      // label each piece with its call site (file:line of the builder) so a hit names the code to fix
      RoomKit.recorder = (mat, g, _tag, look) => {
        const st = (new Error().stack || '').split('\n').map((l) => /(\w+)\.ts:(\d+)/.exec(l)).filter((m) => m && !/^(batch|kit|zfight|test)$/.test(m[1])).slice(0, 3).map((m) => m![1] + ':' + m![2]).join('<');
        // rooms draw 'back' with a plain material (no polygon offset, unlike the city's decals): check it too
        rec.add((mat === 'back' ? 'plain' : mat) as typeof mat, g, _tag && _tag.startsWith('prop:') ? _tag : st, look);
      };
      try {
        const { room } = await build(id, [], st);
        // goods (merged models on the shelves) and price tags (double-sided quads) are not in the static batch: add them
        room.root.updateMatrixWorld(true);
        room.root.traverse((o: any) => {
          if (!o.isMesh) return;
          if (o.name === 'room:goods:lit' || o.name === 'room:goods:unlit') { const g = o.geometry.clone().applyMatrix4(o.matrixWorld); rec.add('wood', g, o.name, o.name); }
          if (o.name === 'room:tags') {
            const g = o.geometry, idx = g.index!.array, pos = g.attributes.position;
            for (let q = 0; q < idx.length / 6; q++) {
              const qg = new THREE.BufferGeometry(); const arr: number[] = [];
              for (let k = 0; k < 6; k++) { const v = idx[q * 6 + k]; arr.push(pos.getX(v), pos.getY(v), pos.getZ(v)); }
              qg.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
              rec.add('flat', qg, 'tag' + q, 'tag' + q);
            }
          }
        });
        if (process.env.ZF_DEBUG) console.log(id, 'pieces', rec.pieces.filter((p) => p.tag.startsWith('tag') || p.tag.startsWith('room:goods')).length);
        // layers inside ONE prop model (world/props: chest straps, barrel hoops) are the props module's — listed, not failed
        const all = rec.find(0.004, 2e-4);
        const own = all.filter((h) => h.a.includes('@prop:') && h.a.split('@')[1] === h.b.split('@')[1]);
        if (own.length) console.log(id + ' prop-internal: ' + [...new Set(own.map((h) => h.a.split('@')[1]))].join(', '));
        if (process.env.ZF_DEBUG) for (const h of own) console.log('own', h.a, h.b, (h.area * 1e4).toFixed(0), 'cm2 n=' + h.normal, 'at', h.at.join(','));
        const hits = all.filter((h) => !own.includes(h));
        if (hits.length) console.log(id + ' ' + hits.length + '\n' + hits.slice(0, 80).map((h) => `${h.a} × ${h.b} ${(h.area * 1e4).toFixed(0)} cm² n=${h.normal} at ${h.at.map((v) => v.toFixed(2))}`).join('\n'));
        expect(hits.length).toBe(0);
        room.dispose();
      } finally { RoomKit.recorder = null; }
    });
  }
});
