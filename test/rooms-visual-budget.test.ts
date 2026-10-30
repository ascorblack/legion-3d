/**
 * Visual budgets of the interiors and the mine (visual uplift round 2): every room (cats + cherts) at q2 stays within
 * 80 draw calls and its triangle budget; at q0 it never costs more than at q2 (detail scales down with quality); the mine
 * (classic + «Шахта 3.0») stays within its call budget. Draw calls = visible meshes / points / sprites × materials.
 * Prints a table (calls / tris per scene) for the visual-audit report.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import meJson from './fixtures/me.json';
import stockJson from './fixtures/stock.json';
import fx3 from './fixtures/mine3-enter.json';
import classic from './fixtures/mine-enter.json';

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

async function build(id: string, styleId: string, quality: number) {
  const { createShopRoom } = await import('../src/rooms/shop');
  const { createHybridRoom } = await import('../src/rooms/hybrid');
  const hero = { ...JSON.parse(JSON.stringify((meJson as any).hero)), money: 100000 };
  const store: any = { hero, me: null, walkers: new Map(), chat: [], online: 1, quest: null, layout: null, on: () => () => {} };
  const env: any = {
    building: { id, title: id, hit: [0, 0, 0, 0], door: { x: 0, y: 0 } }, styleId, quality, store, actions: { get: async () => stockJson, post: async () => ({ ok: true }) },
    input: { setGameplay() {} }, interact: { add: () => () => {}, target: null }, scene: null, itemModels: null, toast() {}, exit() {}, showSitePanel() {}, hideSitePanel() {},
    player: () => ({ x: 0, z: 3 }), ench: { coins: { star: 300, sphere: 900 } },
  };
  return SHOPS.includes(id) ? createShopRoom(env, { stock: stockJson as any }) : createHybridRoom(env);
}

/** Draw calls and triangles of everything visible under root (instanced meshes count their instances' triangles). */
export function cost(root: THREE.Object3D, skipAvatars = false): { calls: number; tris: number } {
  let calls = 0, tris = 0;
  root.traverseVisible((o) => {
    if (skipAvatars) { let p: THREE.Object3D | null = o; while (p) { if (/avatar/i.test(p.name) || (p as any).isSkinnedMesh) return; p = p.parent; } }
    const m = o as THREE.Mesh;
    if (!(m.isMesh || (o as any).isPoints || (o as any).isSprite)) return;
    const mat = m.material as THREE.Material | THREE.Material[];
    if (!Array.isArray(mat) && !mat.visible) return;
    if ((m as any).isInstancedMesh && (m as any).count === 0) return;
    calls += Array.isArray(mat) ? mat.length : 1;
    if (m.isMesh && m.geometry) {
      const g = m.geometry, n = g.index ? g.index.count : g.attributes.position.count;
      tris += Math.min(n, g.drawRange.count) / 3 * ((m as any).isInstancedMesh ? (m as any).count : 1);
    }
  });
  return { calls, tris: Math.round(tris) };
}

const table: string[] = [];

describe('interiors: visual budget', () => {
  for (const st of ['cats', 'cherts']) for (const id of [...SHOPS, ...HYBRIDS]) {
    if (st === 'cherts' && !['forge', 'shop', 'tent'].includes(id)) continue;
    it(`${id} (${st}): ≤ 80 calls at q2, q0 never costs more than q2`, async () => {
      const r2 = await build(id, st, 2), c2 = cost(r2.root);
      const r0 = await build(id, st, 0), c0 = cost(r0.root);
      r2.dispose(); r0.dispose();
      table.push(`${(id + ' ' + st).padEnd(16)} q2 ${String(c2.calls).padStart(3)} calls ${String(c2.tris).padStart(6)} tris | q0 ${String(c0.calls).padStart(3)} calls ${String(c0.tris).padStart(6)} tris`);
      expect(c2.calls).toBeLessThanOrEqual(80);
      expect(c2.tris).toBeLessThanOrEqual(110000);
      expect(c0.calls).toBeLessThanOrEqual(c2.calls);
      expect(c0.tris).toBeLessThanOrEqual(c2.tris);
    });
  }
});

describe('mine: visual budget', () => {
  for (const kind of ['classic', 'v3'] as const) for (const q of [2, 0]) {
    it(`${kind} q${q}: within the mine's call budget`, async () => {
      const { MineScene } = await import('../src/rooms/mine/scene');
      const { MineModel } = await import('../src/rooms/mine/state');
      const M = new MineModel('player999');
      if (kind === 'v3') M.take(JSON.parse(JSON.stringify((fx3 as any).st)), (fx3 as any).me, null, 1); else M.take((classic as any).st, (classic as any).me, null, 1);
      const S = new MineScene({ quality: q, login: 'player999', geom: kind === 'v3' ? M.G : undefined } as any);
      S.setView(M, []);
      const c = cost(S.root, true);
      table.push(`mine ${kind.padEnd(11)} q${q} ${String(c.calls).padStart(3)} calls ${String(c.tris).padStart(6)} tris`);
      S.dispose();
      expect(c.calls).toBeLessThanOrEqual(kind === 'v3' ? 90 : 80);
    });
  }
  it('prints the table', () => { console.log('\n' + table.join('\n')); });
});
