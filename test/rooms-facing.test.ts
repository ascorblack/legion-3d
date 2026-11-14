/**
 * Facing audit: in every shop3d / hybrid room, every figure (NPC, shopkeeper, mannequin) looks into the walkable
 * area — its forward vector points towards the spawn AND towards the centroid of the walkable floor — and every sign
 * and price tag faces the walkable area too. Conventions: figures use Walker.face (0 looks to −Z, forward =
 * (−sin f, −cos f)); signs and tags are planes facing yaw ry (0 = +Z, normal = (sin ry, cos ry)).
 * Also checks the scene-mode stage of hybrid rooms: the hero stands on free floor in front of the focus, facing it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import meJson from './fixtures/me.json';
import stockJson from './fixtures/stock.json';

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


/** Centroid of the walkable floor (grid sampling of free()) and the room bounds. */
function walkCentroid(room: any): { x: number; z: number } {
  const K = room.root.userData.l3dRoom.kit, B = K.bounds;
  let sx = 0, sz = 0, n = 0;
  for (let x = B.x0; x <= B.x1; x += 0.25) for (let z = B.z0; z <= B.z1; z += 0.25) if (room.free(x, z)) { sx += x; sz += z; n++; }
  return n ? { x: sx / n, z: sz / n } : { x: 0, z: 0 };
}
const dotTo = (x: number, z: number, fx: number, fz: number, tx: number, tz: number) => {
  const dx = tx - x, dz = tz - z, L = Math.hypot(dx, dz) || 1;
  return (fx * dx + fz * dz) / L;
};

describe('rooms: facing audit', () => {
  for (const id of [...SHOPS, ...HYBRIDS]) {
    it(`${id}: figures, signs and tags face the walkable area`, async () => {
      const { room } = await build(id);
      const R = room.root.userData.l3dRoom;
      const c = walkCentroid(room), sp = room.spawn;
      const bad: string[] = [];
      expect(R.figures.length).toBeGreaterThan(0);
      for (const f of R.figures) {
        const fx = -Math.sin(f.face), fz = -Math.cos(f.face);
        const a = dotTo(f.x, f.z, fx, fz, sp.x, sp.z), b = dotTo(f.x, f.z, fx, fz, c.x, c.z);
        if (!(a > 0) || !(b > 0)) bad.push(`figure ${f.name} @${f.x.toFixed(1)},${f.z.toFixed(1)} face ${f.face.toFixed(2)}: spawn ${a.toFixed(2)} centre ${b.toFixed(2)}`);
      }
      for (const s of R.kit.signSpots) {
        const b = dotTo(s.x, s.z, Math.sin(s.ry), Math.cos(s.ry), c.x, c.z);
        if (!(b > 0)) bad.push(`sign «${s.text}» @${s.x.toFixed(1)},${s.z.toFixed(1)} ry ${s.ry.toFixed(2)}: centre ${b.toFixed(2)}`);
      }
      for (const q of (R.tags ? (R.tags as any).quads : []) as { x: number; z: number; ry: number }[]) {
        const b = dotTo(q.x, q.z, Math.sin(q.ry), Math.cos(q.ry), c.x, c.z);
        if (!(b > 0)) bad.push(`tag @${q.x.toFixed(1)},${q.z.toFixed(1)} ry ${q.ry.toFixed(2)}: centre ${b.toFixed(2)}`);
      }
      if (bad.length) throw new Error(id + ': ' + bad.join(' | '));
      room.dispose();
    });
  }
  for (const id of HYBRIDS) {
    it(`${id}: scene-mode stage — the hero stands on free floor in front of the focus, facing it`, async () => {
      const { room } = await build(id);
      const st = (room as any).stage;
      expect(st).toBeTruthy();
      expect(room.free(st.stand.x, st.stand.z)).toBe(true);
      expect(room.spawn.x).toBe(st.stand.x); expect(room.spawn.z).toBe(st.stand.z);
      const fx = -Math.sin(st.stand.face), fz = -Math.cos(st.stand.face);
      expect(dotTo(st.stand.x, st.stand.z, fx, fz, st.focus.x, st.focus.z)).toBeGreaterThan(0.99);
      const d = Math.hypot(st.focus.x - st.stand.x, st.focus.z - st.stand.z);
      expect(d).toBeGreaterThan(1.0); expect(d).toBeLessThan(4.5);
      // picking: a ray from the stand's eye at the focus finds an interactable (the desk / NPC)
      const eye = new THREE.Vector3(st.stand.x, 1.5, st.stand.z), dir = new THREE.Vector3(st.focus.x, st.focus.y, st.focus.z).sub(eye).normalize();
      room.root.updateMatrixWorld(true);
      expect(st.pick(new THREE.Ray(eye, dir))).toBeTruthy();
      room.dispose();
    });
  }
});
