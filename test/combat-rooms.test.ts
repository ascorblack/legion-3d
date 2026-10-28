/**
 * Fights inside rooms (src/combat/room.ts, src/features/combat.ts): the room's space for bodies and arrows, real shop
 * rooms with their shopkeeper / mannequins knocked over and put back exactly on their spot, and PURCHASE SAFETY — with a
 * good under the crosshair LMB only runs the normal interaction (the card asks first; nothing is bought, nothing
 * swings); with nothing under the crosshair LMB swings and opens nothing. Actions are fakes: nothing is ever sent.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as THREE from 'three';
import meJson from './fixtures/me.json';
import stockJson from './fixtures/stock.json';
import type { CityStock } from '../src/rooms/common/stock';
import type { Hero } from '../src/contracts';
import type { RoomScene } from '../src/contracts/ext';
import type { CombatAvatar } from '../src/combat/ragdoll';
import type { CombatRig } from '../src/avatar/avatar';
import { roomEnv, roomCombatOf, type RoomFighter } from '../src/combat/room';

const ST = stockJson as unknown as CityStock;
const heroOf = (patch: Record<string, unknown> = {}): Hero => ({ ...JSON.parse(JSON.stringify((meJson as any).hero)), ...patch });

/* ---------------------------------------------------------------- minimal fake DOM (canvas + elements + window) */
type L = (e: any) => void;
const winL = new Map<string, { fn: L; capture: boolean }[]>();
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
  (globalThis as any).document = { createElement: () => new FakeEl(), body: new FakeEl(), pointerLockElement: null, exitPointerLock() {}, activeElement: null };
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
  (globalThis as any).window = Object.assign(globalThis as any, {
    addEventListener(t: string, fn: L, capture?: boolean) { const a = winL.get(t) || []; a.push({ fn, capture: !!capture }); winL.set(t, a); },
    removeEventListener(t: string, fn: L) { const a = winL.get(t); if (a) winL.set(t, a.filter((x) => x.fn !== fn)); },
    dispatchEvent(e: any) { for (const x of winL.get(e.type) || []) x.fn(e); return true; },
  });
  (globalThis as any).requestAnimationFrame = () => 0;
});

/* ---------------------------------------------------------------- helpers */
async function shopRoom(id: 'forge' | 'shop' | 'tent', interact: any, posts: any[]) {
  const { createShopRoom } = await import('../src/rooms/shop');
  const hero = heroOf({ money: 100000 });
  const store: any = { hero, me: null, walkers: new Map(), chat: [], online: 1, quest: null, layout: null, on: () => () => {} };
  const actions: any = { get: async () => ST, post: async (path: string, body: any) => { posts.push({ path, body }); return { ok: true }; } };
  let player = { x: 0, z: 3 };
  const room = await createShopRoom({
    building: { id, title: id, hit: [0, 0, 0, 0], door: { x: 0, y: 0 } } as any, styleId: 'cats', quality: 2, store, actions,
    input: { setGameplay() {} }, interact, scene: null, itemModels: null, toast() {}, exit() {}, player: () => player, ench: { coins: { star: 300, sphere: 900 } },
  }, { stock: ST });
  return { room, setPlayer: (x: number, z: number) => { player = { x, z }; } };
}

/** A stand-in for the hero's avatar: the real bone layout without meshes. */
function fakeAvatar(): CombatAvatar {
  const root = new THREE.Group();
  const rest = [[0, 0, 0], [0, 0.07, 0], [-0.27, 0.62, 0], [0.27, 0.62, 0], [-0.12, 0.11, 0], [0.12, 0.11, 0], [0, 0.2, 0.25], [0, 0.43, 0.42], [0, 0.95, 0.2], [0, 0.5, 0.3], [0.355, 0.445, -0.03]]
    .map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const parent = [-1, 0, 1, 1, 0, 0, 1, 6, 1, 8, 3];
  const bones = rest.map(() => new THREE.Bone());
  bones.forEach((b, i) => { b.position.copy(rest[i]); if (parent[i] >= 0) { b.position.sub(rest[parent[i]]); bones[parent[i]].add(b); } });
  root.add(bones[0]);
  const rig: CombatRig = { bones, rest, handL: new THREE.Vector3(-0.085, -0.175, -0.03), handR: new THREE.Vector3(0.085, -0.175, -0.03), y0: 0.07, top: 1.2, w: 0.3, depth: 0.9, eyeY: 0.85, ex: 0.11, armY: 0.62, headTop: 1.3, hasTail: true, hasLegs: true };
  return { root, headTop: 1.3, combatRig: () => rig, setFlash() {}, setDizzy() {}, setDraw() {}, hitStop() {}, play() {}, update() {}, setLod() {}, setAlpha() {}, setFirstPerson() {}, setAppearance() {}, dispose() {} } as unknown as CombatAvatar;
}

function fighters(sc: RoomScene): RoomFighter[] { const out: RoomFighter[] = []; roomCombatOf(sc)!.fighters((f) => out.push(f)); return out; }

/* ---------------------------------------------------------------- the room's space */
describe('room space for bodies and projectiles', () => {
  const sc = {
    // 6×6 room, a dais at the back (z < -2, 0.3 m), a counter (top 1.0) across z ∈ [-1.6, -1.2], a wall shelf (Infinity)
    free: () => true,
    groundAt: (_x: number, z: number) => (z < -2 ? 0.3 : 0),
    solidTop: (x: number, z: number) => {
      if (x < -3 || x > 3 || z < -3 || z > 3) return Infinity;
      if (x > 2 && z > -1 && z < 1) return Infinity;
      if (z > -1.6 && z < -1.2) return 1.0;
      return -Infinity;
    },
  };
  const { body, shots } = roomEnv(sc, 3.2);
  it('uses the room floor and the tops of low solids, never the city', () => {
    expect(body.groundAt(0, 0)).toBe(0);
    expect(body.groundAt(0, -2.5)).toBeCloseTo(0.3);        // the dais behind the counter
    expect(body.groundAt(0, -1.4)).toBe(1.0);               // lying on the counter
    expect(body.groundAt(2.5, 0)).toBe(0);                  // a wall never becomes a floor
  });
  it('walls and solids above the point block bodies (with a small pad off walls); arrows stick in walls, shelves and the ceiling', () => {
    expect(body.blocked(0, 0, 0.3)).toBe(false);
    expect(body.blocked(3.2, 0, 0.3)).toBe(true);
    expect(body.blocked(2.85, 0, 0.3)).toBe(true);          // inside the pad of the outer wall
    expect(body.blocked(0, -1.4, 0.5)).toBe(true);          // the counter's side
    expect(body.blocked(0, -1.4, 1.2)).toBe(false);         // above the counter
    expect(shots.blocked(2.5, 0, 1.5)).toBe(true);          // the shelf
    expect(shots.blocked(1.9, 0, 1.5)).toBe(false);         // no pad for arrows: they fly right up to it
    expect(shots.blocked(0, 0, 3.5)).toBe(true);            // the ceiling
    expect(shots.blocked(0, 2.9, 1.5)).toBe(false);
  });
  it('a room without solidTop (the mine) blocks what is not walkable', () => {
    const m = roomEnv({ free: (x) => x < 1, groundAt: () => 0 });
    expect(m.body.blocked(0, 0, 0.2)).toBe(false);
    expect(m.body.blocked(1.5, 0, 0.2)).toBe(true);
    expect(m.shots.blocked(1.5, 0, 0.2)).toBe(true);
  });
});

/* ---------------------------------------------------------------- real rooms, a real combat system */
describe('room fighters', () => {
  async function knockAndWait(id: 'shop' | 'tent', pick: (f: RoomFighter[]) => RoomFighter) {
    const { CombatSystem } = await import('../src/combat');
    const { room, setPlayer } = await shopRoom(id, null, []);
    const list = fighters(room);
    const f = pick(list);
    expect(f.home).not.toBeNull();
    const home = { ...f.home! };
    const scene = new THREE.Scene(); scene.add(room.root);
    const me = fakeAvatar(); scene.add(me.root);
    const feet = new THREE.Vector3(home.x, 0, home.z + 1.3);
    me.root.position.copy(feet);   // facing −Z: the figure is right in front
    setPlayer(feet.x, feet.z);
    const rc = roomCombatOf(room)!;
    const env = roomEnv(rc.space ?? room, rc.ceiling);
    const sys = new CombatSystem({
      scene, camera: new THREE.PerspectiveCamera(),
      forEachTarget: (fn) => rc.fighters((q) => fn(q.id, q.av)),
      env: () => env.body, shotEnv: () => env.shots,
      me: { av: me, feet, fp: () => false, app: () => ({ login: 'me', name: 'me', styleId: 'cats', look: {}, gear: { w: 'sword' } } as never) },
      createAvatar: () => fakeAvatar(), viewHeight: () => 720, quality: () => 2,
    });
    // the feature's room frame: the room animates first, then figures go back to their spot, then combat
    rc.afterUpdate((dt, t) => {
      rc.fighters((q) => { if (q.home && sys.ragdolls.has(q.id)) { q.av.root.position.set(q.home.x, q.home.y, q.home.z); q.av.root.rotation.x = 0; q.av.root.rotation.z = 0; } });
      sys.update(dt, t);
    });
    const cam = new THREE.PerspectiveCamera();
    let t = 0;
    room.update(1 / 60, t, cam);
    const yaw0 = f.av.root.rotation.y;
    expect(sys.press()).toBe(true);
    let downSeen = false, maxOff = 0;
    for (let i = 0; i < 60 * 12; i++) {
      room.update(1 / 60, (t += 1 / 60), cam);
      if (sys.ragdolls.has(f.id)) downSeen = true;
      maxOff = Math.max(maxOff, Math.hypot(f.av.root.position.x - home.x, f.av.root.position.z - home.z));
      // bodies never leave the room
      const K = (room.root.userData.l3dRoom as any).kit, q = f.av.root.position;
      if (K.circle) expect(Math.hypot(q.x - K.circle.x, q.z - K.circle.z)).toBeLessThan(K.circle.r + 0.05);
      else { expect(q.x).toBeGreaterThan(K.bounds.x0 - 0.25); expect(q.x).toBeLessThan(K.bounds.x1 + 0.25); expect(q.z).toBeGreaterThan(K.bounds.z0 - 0.25); }   // the feet point of a lying body may be a little past the wall (random swing spread)
    }
    expect(downSeen).toBe(true);
    expect(maxOff).toBeGreaterThan(0.2);                   // it really flew
    expect(sys.ragdolls.size).toBe(0);                      // got up and came back
    const p = f.av.root.position;
    expect(p.x).toBeCloseTo(home.x, 3); expect(p.y).toBeCloseTo(home.y, 3); expect(p.z).toBeCloseTo(home.z, 3);
    expect(f.av.root.rotation.x).toBeCloseTo(0, 5); expect(f.av.root.rotation.z).toBeCloseTo(0, 5);
    const yaw = f.av.root.rotation.y;
    expect(Math.abs(Math.atan2(Math.sin(yaw - yaw0), Math.cos(yaw - yaw0)))).toBeLessThan(0.35);   // its own facing (mannequins sway ±0.3)
    sys.dispose(); room.dispose();
  }

  it('the shopkeeper of «Лавка» is a fighter on the dais; knocked over, she gets up back behind the counter', async () => {
    await knockAndWait('shop', (l) => { const n = l.find((f) => f.kind === 'npc')!; expect(n.home!.y).toBeCloseTo(0.3); expect(typeof n.say).toBe('function'); return n; });
  }, 30000);

  it('tent mannequins are fighters and pop back onto their stand', async () => {
    await knockAndWait('tent', (l) => {
      const ms = l.filter((f) => f.kind === 'mannequin');
      expect(ms.length).toBeGreaterThan(0);
      for (const m of ms) expect(m.home!.y).toBeCloseTo(0.12);
      return ms[0];
    });
  }, 30000);

  it('knocked outwards, against the tent wall, no mannequin ever leaves the tent (its own booth does not trap it)', async () => {
    const { CombatSystem } = await import('../src/combat');
    const { room } = await shopRoom('tent', null, []);
    const rc = roomCombatOf(room)!, env = roomEnv(rc.space!, rc.ceiling);
    const ms = fighters(room).filter((f) => f.kind === 'mannequin');
    const scene = new THREE.Scene(); scene.add(room.root);
    const me = fakeAvatar(); scene.add(me.root);
    const sys = new CombatSystem({
      scene, camera: new THREE.PerspectiveCamera(), forEachTarget: (fn) => rc.fighters((q) => fn(q.id, q.av)),
      env: () => env.body, shotEnv: () => env.shots,
      me: { av: me, feet: new THREE.Vector3(), fp: () => false, app: () => null },
      createAvatar: () => fakeAvatar(), viewHeight: () => 720, quality: () => 2,
    });
    rc.afterUpdate((dt, t) => {
      rc.fighters((q) => { if (q.home && sys.ragdolls.has(q.id)) q.av.root.position.set(q.home.x, q.home.y, q.home.z); });
      sys.update(dt, t);
    });
    const K = (room.root.userData.l3dRoom as any).kit;
    const cam = new THREE.PerspectiveCamera();
    let t = 0;
    room.update(1 / 60, t, cam);
    for (const m of ms.slice(0, 6)) {
      const h = m.home!, L = Math.hypot(h.x, h.z);
      sys.hit(m.id, m.av, (h.x / L) * 7, 4.5, (h.z / L) * 7, h.x, h.y + 0.8, h.z, 0.05);
    }
    for (let i = 0; i < 60 * 14; i++) {
      room.update(1 / 60, (t += 1 / 60), cam);
      for (const m of ms) { const q = m.av.root.position; expect(Math.hypot(q.x - K.circle.x, q.z - K.circle.z), m.id).toBeLessThan(K.circle.r + 0.3); }   // the feet point of a lying body may be a little past its centre
    }
    expect(sys.ragdolls.size).toBe(0);
    for (const m of ms) { const q = m.av.root.position; expect(q.distanceTo(new THREE.Vector3(m.home!.x, m.home!.y, m.home!.z))).toBeLessThan(1e-3); }
    sys.dispose(); room.dispose();
  }, 30000);

  it('zombie cats rise from the room floor and stay inside the room; leaving (reset) removes them and the arrows', async () => {
    const { CombatSystem } = await import('../src/combat');
    const { room, setPlayer } = await shopRoom('forge', null, []);
    const rc = roomCombatOf(room)!, env = roomEnv(rc.space!, rc.ceiling);
    const K = (room.root.userData.l3dRoom as any).kit;
    const scene = new THREE.Scene(); scene.add(room.root);
    const me = fakeAvatar(); scene.add(me.root);
    const feet = new THREE.Vector3(K.bounds.x0 + 1.2, 0, 1.0);   // near a side wall, looking into the room (+X)
    me.root.position.copy(feet); me.root.rotation.y = -Math.PI / 2; setPlayer(feet.x, feet.z);
    const sys = new CombatSystem({
      scene, camera: new THREE.PerspectiveCamera(), forEachTarget: (fn) => rc.fighters((q) => fn(q.id, q.av)),
      env: () => env.body, shotEnv: () => env.shots,
      me: { av: me, feet, fp: () => false, app: () => ({ login: 'me', name: 'me', styleId: 'cats', role: 'necromancer', look: {}, gear: { w: 'skullstaff' } } as never) },
      createAvatar: () => fakeAvatar(), viewHeight: () => 720, quality: () => 2,
    });
    rc.afterUpdate((dt, t) => sys.update(dt, t));
    const cam = new THREE.PerspectiveCamera();
    let t = 0;
    room.update(1 / 60, t, cam);
    expect(sys.press()).toBe(true);
    sys.shots.fire('arrow', feet.x, 1.4, feet.z, -25, 1, 0, '#fff');   // into the wall
    let most = 0;
    for (let i = 0; i < 60 * 8; i++) {
      room.update(1 / 60, (t += 1 / 60), cam);
      const zs = (sys.zombies as any).list as { x: number; y: number; z: number }[];
      most = Math.max(most, zs.length);
      if (i === 60) {   // 1 s later the arrow is stuck in the side wall
        const ar = ((sys.shots as any).shots as { on: boolean; stuck: number; p: THREE.Vector3 }[]).filter((q) => q.on);
        expect(ar.length).toBe(1); expect(ar[0].stuck).toBeGreaterThanOrEqual(0);
        expect(Math.abs(ar[0].p.x - K.bounds.x0)).toBeLessThan(0.3);
      }
      for (const q of zs) {
        expect(q.x).toBeGreaterThan(K.bounds.x0); expect(q.x).toBeLessThan(K.bounds.x1);
        expect(q.z).toBeGreaterThan(K.bounds.z0); expect(q.z).toBeLessThan(K.bounds.z1 + 0.01);
        expect(q.y).toBeCloseTo(K.groundAt(q.x, q.z), 1);
      }
    }
    expect(most).toBeGreaterThan(0);
    sys.shots.fire('arrow', feet.x, 1.4, feet.z, -25, 1, 0, '#fff');
    for (let i = 0; i < 30; i++) room.update(1 / 60, (t += 1 / 60), cam);
    expect(sys.shots.active).toBe(1);
    sys.reset();                                                  // leaving the room (rooms.onChange → reset) clears all
    expect(sys.zombies.count).toBe(0); expect(sys.shots.active).toBe(0); expect(sys.ragdolls.size).toBe(0);
    sys.dispose(); room.dispose();
  }, 30000);

  it('hybrid rooms do not fight (scene mode): the gate refuses there, shops and the mine allow', async () => {
    const { gate } = await import('../src/combat');
    const OK = { enabled: true, locked: true, gameplay: true, menu: false, modals: 0, photo: false, typing: false, stage: false, busy: false, room: null, aimed: false };
    expect(gate({ ...OK, room: 'shop3d' })).toBeNull();
    expect(gate({ ...OK, room: 'mine3d' })).toBeNull();
    expect(gate({ ...OK, room: 'hybrid' })).toBe('room');
    expect(gate({ ...OK, room: 'hybrid', stage: true })).toBe('scene');
    expect(gate({ ...OK, room: 'shop3d', aimed: true })).toBeNull();   // a swing at a good never opens the buy card
  });
});

/* ---------------------------------------------------------------- purchase safety: the real features */
describe('purchase safety in a shop (combat + controls features, real interaction system)', () => {
  it('a good under the crosshair: LMB only swings (no card, nothing bought), E opens the card that asks first; nothing under it: LMB swings, opens nothing', async () => {
    const { createInteractSystem } = await import('../src/core/interact');
    const { createRegistries } = await import('../src/core/registries');
    const combatF = (await import('../src/features/combat')).default;
    const controlsF = (await import('../src/features/controls')).default;
    const interact = createInteractSystem();
    const posts: any[] = [];
    const { room } = await shopRoom('forge', interact, posts);
    const base = room.root.userData.l3dRoom as any;
    const scene = new THREE.Scene(); scene.add(room.root);
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 100);
    const elL = new Map<string, L[]>();
    const el = { height: 720, style: {}, addEventListener(t: string, fn: L) { elL.set(t, [...(elL.get(t) || []), fn]); }, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) };
    const frameFns: ((dt: number, t: number) => void)[] = [];
    const meAv = Object.assign(fakeAvatar(), { play: vi.fn() });
    const vm = { swing: vi.fn(), block: vi.fn(), setDraw() {}, hitStop() {} };
    const feet = new THREE.Vector3(0, 0, 2);
    const ctx: any = {
      input: { locked: true, gameplay: true, modals: [], lock() {} }, interact,
      rooms: { stage: null, busy: false, kind: 'shop3d', scene: room, onChange: () => () => {} },
      engine: { renderer: { domElement: el }, quality: 2 },
      registries: createRegistries(), dev: {}, scene, camera, meAv, feet, vm, rig: { distance: 0 },
      store: { me: { app: { login: 'me', name: 'me', styleId: 'cats', look: {}, gear: { w: 'sword' } } } },
      kit: { create: () => fakeAvatar() }, anchors: new Map(), ui: { toast() {} },
      state: { inRoom: true, menu: null }, gameplay: () => true,
      onFrame: (fn: (dt: number, t: number) => void) => { frameFns.push(fn); return () => {}; },
      world: () => { throw new Error('the city is not used inside a room'); }, layout: () => { throw new Error('no city'); },
    };
    const offs = [combatF.setup(ctx), controlsF.setup(ctx)];
    const events: string[] = [];
    window.addEventListener('l3d:combat', ((e: CustomEvent) => events.push(e.detail.kind)) as any);
    const click = () => {
      const e = { type: 'mousedown', button: 0, target: el, clientX: 640, clientY: 360, preventDefault() {} };
      for (const x of winL.get('mousedown') || []) if (x.capture) x.fn(e);   // window capture phase (combat)
      for (const fn of elL.get('mousedown') || []) fn(e);                   // the canvas (controls)
      for (const x of winL.get('mouseup') || []) x.fn({ type: 'mouseup', button: 0 });
    };
    let t = 0;
    const frames = (n: number) => { for (let i = 0; i < n; i++) { t += 1 / 60; for (const f of frameFns) f(1 / 60, t); room.update(1 / 60, t, camera); } };

    // 1. aim at a coin good on the forge's stands from 1.4 m
    const good = base.goods.find((g: any) => g.inter.label.startsWith('Купить:'));
    expect(good).toBeTruthy();
    const c = good.hit.getCenter(new THREE.Vector3());
    feet.set(c.x * 0.7, 0, c.z + 1.4); camera.position.set(feet.x, 1.25, feet.z); camera.lookAt(c); camera.updateMatrixWorld(true);
    interact.update(camera, feet, 0);
    expect(interact.aimed).toBe(good.inter);
    click();
    frames(40);
    expect(vm.swing).toHaveBeenCalledTimes(1);                  // clicks never interact: a plain swing…
    expect(meAv.play).toHaveBeenCalledWith('swing');
    expect(base.card?.opened ?? false).toBe(false);              // …no buy card
    expect(posts).toEqual([]);
    interact.update(camera, feet, 0);
    expect(interact.use('key')).toBe(true);                     // E: the normal flow
    expect(base.card?.opened).toBe(true);                       // the card of exactly this good…
    expect(base.card.boundTo.id).toBe(good.it.id);
    expect(posts).toEqual([]);                                  // …asks first; nothing was bought
    base.card.close?.();
    if (base.card.opened) base.card.dispose();

    // 2. nothing under the crosshair (looking up at the ceiling): LMB swings, no card, nothing sent
    base.card = null;
    camera.position.set(0, 1.25, 1.5); camera.lookAt(0, 6, 1.4); camera.updateMatrixWorld(true);
    feet.set(0, 0, 1.5);
    interact.update(camera, feet, 0);
    expect(interact.aimed).toBeNull();
    click();
    frames(40);
    expect(events).toContain('swing');
    expect(vm.swing).toHaveBeenCalledTimes(2);
    expect(meAv.play).toHaveBeenCalledWith('swing');
    expect(base.card?.opened ?? false).toBe(false);
    expect(posts).toEqual([]);

    for (const off of offs) (off as () => void)?.();
    room.dispose();
  }, 30000);
});
