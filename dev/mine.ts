/**
 * Mine dev page: the 3D mine room against an OFFLINE fake game (src/rooms/mine/fake.ts) started from a captured,
 * sanitized mine state (test/fixtures/mine-enter.json, ?f=fresh → mine-fresh.json: a new floor, ?f=v3 → mine3-enter.json:
 * a big «Шахта 3.0» floor with fog, the lift hall and the mini-map).
 * Digging, selling, the supplier and the helmet work against the fake only.
 *   ?cam=tp|fp  ?at=X,Z (room metres)  ?yaw=rad  ?pitch=rad  ?dark=1 (floor without helmet)  ?card=buy|lamp|quests
 *   ?q=0..3 quality  ?bots=0
 * window.__mine = { engine, rig, player, room, client, fake, interact, step(n), look(yaw, pitch), tp(x, z), use() }.
 */
import * as THREE from 'three';
import type { CameraMode, Hero } from '../src/contracts';
import type { RoomContext } from '../src/contracts/ext';
import { createEngine, createInput, createCameraRig, createPlayerController } from '../src/engine';
import { createInteractSystem } from '../src/core/interact';
import { createStore } from '../src/store/store';
import { createAvatarKit, appearanceFrom, RECOMMENDED_NEAR } from '../src/avatar';
import { EYE } from '../src/world/coords';
import { createMineRoom } from '../src/rooms/mine';
import { MineClient } from '../src/rooms/mine/net';

import { FakeMine, makeBus, type FakeHero } from '../src/rooms/mine/fake';
import meFx from '../test/fixtures/me.json';
import enterFx from '../test/fixtures/mine-enter.json';
import freshFx from '../test/fixtures/mine-fresh.json';
import mine3Fx from '../test/fixtures/mine3-enter.json';

const Q = new URLSearchParams(location.search);
const host = document.getElementById('app') as HTMLElement;
const engine = createEngine({ host, quality: Q.has('q') ? (+Q.get('q')! as 0) : 'auto' });
const { scene, camera, renderer } = engine;
camera.near = RECOMMENDED_NEAR; camera.updateProjectionMatrix();
scene.add(camera);
const input = createInput(renderer.domElement);
const rig = createCameraRig(camera);
rig.setDragElement(renderer.domElement);

/* ---------------- fake site: hero, store, bus, game ---------------- */
const hero = structuredClone((meFx as any).hero) as Hero & FakeHero;
const LOGIN = String(hero.login);
hero.items = (hero.items || []).filter((it: any) => Q.get('dark') !== '1' || it.id !== 'miner_helmet');
hero.items.push({ uid: 'ore_iron', id: 'ore_iron', name: 'Железная руда', slot: 'material', mat: 'ore', qty: true, q: 340, res: 'iron' },
  { uid: 'ore_coal', id: 'ore_coal', name: 'Уголь', slot: 'material', mat: 'ore', qty: true, q: 215, res: 'coal' });
const enter = structuredClone((Q.get('f') === 'fresh' ? freshFx : Q.get('f') === 'v3' ? mine3Fx : enterFx) as any);
if (Q.get('dark') === '1') { enter.st.darkFrom = 1; enter.me.lamp = 0; }
const bus = makeBus();
const fake = new FakeMine({ login: LOGIN, enter, hero, bus, digSec: +(Q.get('dig') || 8), bots: Q.get('bots') !== '0' });
const store = createStore();
store.setHero(hero);
const app = appearanceFrom(LOGIN, { ...hero, n: hero.name, lv: hero.level, lk: (hero as any).wardrobe?.cur || hero.look, g: hero.gear }, 'cats');
store.setMe({ login: LOGIN, app, x: 0, y: 0, face: 0, speed: 0, alpha: 1, me: true } as any);
bus.on('sse:me', (d) => { if (d && d.hero) store.setHero(d.hero); });
const client = new MineClient({ api: (p, b) => fake.api(p, b), login: LOGIN, c: 'home', bus, hero: () => hero as any, equip: (uid) => fake.api('/api/equip', { uid }) });

/* ---------------- player + own avatar ---------------- */
const kit = createAvatarKit();
const meAv = kit.create(app);
scene.add(meAv.root);
const player = createPlayerController({ free: () => true, groundAt: () => 0 } as any, () => 0);
const interact = createInteractSystem();
const frameFns: ((dt: number, t: number) => void)[] = [];
const promptEl = document.getElementById('prompt') as HTMLElement;
const feet = new THREE.Vector3();
let toastT = 0;
const ctx = {
  engine, scene, camera, rig, input, store, site: null as any,
  actions: { get: (p: string) => fake.api(p), post: (p: string, b: unknown) => fake.api(p, b), equip: (uid: string) => fake.api('/api/equip', { uid }) } as any,
  layout: () => ({ id: 'fair' }) as any, quality: () => engine.quality, interact, rooms: null as any, registries: null as any,
  ui: { toast: (t: string) => { console.log('[toast]', t); clearTimeout(toastT); }, open: () => {}, prompt: () => {} },
  onFrame: (fn: (dt: number, t: number) => void) => { frameFns.push(fn); return () => { const k = frameFns.indexOf(fn); if (k >= 0) frameFns.splice(k, 1); }; },
  player: { get x() { return feet.x; }, get y() { return feet.y; }, get z() { return feet.z; }, get app() { return app; } },
  drift: () => {}, building: { id: 'mine', title: 'Шахта', hit: [0, 0, 0, 0], door: { x: 0, y: 0 } },
  exit: () => { console.log('[exit] → город'); (window as any).__exited = true; },
  showSitePanel: () => {}, hideSitePanel: () => {},
  meAv, vm: null, controller: () => player,
} as unknown as RoomContext;

let room: Awaited<ReturnType<typeof createMineRoom>> | null = null;
let mode: CameraMode = (Q.get('cam') as CameraMode) || 'tp';
(async () => {
  room = await createMineRoom(ctx, { client, hudHost: document.body });
  scene.add(room.root);
  player.setSpace({ free: (x, z) => room!.free(x, z), groundAt: (x, z) => room!.groundAt(x, z) }, 'm', { x: room.spawn.x, y: room.spawn.z, face: room.spawn.face });
  const at = Q.get('at'); if (at) { const [x, z] = at.split(',').map(Number); player.teleport(x, z); }
  rig.setColliders(room.colliders || []);
  rig.setGround(null);
  rig.yaw = Q.has('yaw') ? +Q.get('yaw')! : room.spawn.face; rig.pitch = Q.has('pitch') ? +Q.get('pitch')! : -0.15;
  rig.setMode(mode, { instant: true });
  const card = Q.get('card'); if (card) setTimeout(() => (document.querySelector(`[data-a="${card === 'buy' ? 'buyer' : card}"]`) as HTMLElement | null)?.click() ?? (window as any).__mine.card(card), 300);
})();

input.onKey((code) => {
  if (code === 'KeyV') { mode = mode === 'fp' ? 'tp' : 'fp'; rig.setMode(mode); return true; }
  if (code === 'KeyE') { interact.use('key'); return true; }
  return false;
});
renderer.domElement.addEventListener('mousedown', (e) => { if (e.button !== 0) return; if (!input.locked) input.lock(); else interact.use('click'); });

const dbg = document.getElementById('dbg') as HTMLElement;
let dbgT = 0;
const SENS = 0.0022;
const tick = (dt: number, t: number): void => {
  if (!room) return;
  const l = input.consumeLook();
  rig.yaw -= l.dx * SENS; rig.pitch -= l.dy * SENS; rig.zoom(input.consumeWheel());
  player.update(dt, input.gameplay ? input : ({ move: { x: 0, y: 0 }, run: false } as any), rig.yaw);
  player.feet(feet);
  meAv.root.position.copy(feet);
  meAv.root.rotation.y = mode === 'fp' ? rig.yaw : player.face;
  meAv.setFirstPerson(mode === 'fp' && rig.distance < 0.6);
  meAv.update(dt, t, player.speed / 230);
  rig.face = meAv.root.rotation.y;
  rig.follow(feet, EYE);
  if (freeCam) { camera.position.set(freeCam[0], freeCam[1], freeCam[2]); camera.lookAt(freeCam[3], freeCam[4], freeCam[5]); } else rig.update(dt);
  interact.update(camera, feet, mode === 'fp' ? 0 : rig.distance);
  const f = interact.focus();
  promptEl.hidden = !f; if (f) promptEl.textContent = `[E] ${f.label}`;
  for (const fn of frameFns) fn(dt, t);
  room.update(dt, t, camera);
  dbgT += dt;
  if (dbgT > 0.3) { dbgT = 0; const s = engine.stats(); dbg.textContent = `${s.fps.toFixed(0)} fps · calls ${s.calls} · tris ${s.tris}\npos ${feet.x.toFixed(2)}, ${feet.z.toFixed(2)} m · yaw ${rig.yaw.toFixed(2)}\nWASD · мышь · E копать/говорить · V вид · Esc закрыть окно`; }
};
engine.onFrame(tick);
let stepT = 0;
let freeCam: number[] | null = null;
(window as any).__mine = {
  engine, rig, player, client, fake, interact, get room() { return room; }, meAv,
  ready: () => !!room,
  cam(...a: number[]) { freeCam = a.length ? a : null; },
  look(yaw: number, pitch: number) { rig.yaw = yaw; rig.pitch = pitch; },
  tp(x: number, z: number) { player.teleport(x, z); },
  mode(m: CameraMode) { mode = m; rig.setMode(m, { instant: true }); },
  use() { return interact.use('key'); },
  target() { const t = interact.target; return t ? t.id + ' ' + t.label : null; },
  card(k: string) { const h = document.querySelector(`[data-a="${k}"]`) as HTMLElement | null; h?.click(); },
  /** Stand back from the k-th diggable stone (2 m behind its dig spot) and look at it — the «front» view. */
  goNear(k = 0, back = 2) {
    const M = client.model, G = M.G, mx = G.mx, mz = G.mz, fr = (M.st?.front || []).filter((i) => G.digSpot(M.dug, i) != null);
    const i = fr[Math.min(k, fr.length - 1)]; if (i == null) return null;
    const sp = G.centerOf(G.digSpot(M.dug, i)!), c = G.cellXY(i), sx = mx(c.cx), sz = mz(c.cy);
    let x = mx(sp.x), z = mz(sp.y); const dx = x - sx, dz = z - sz, L = Math.hypot(dx, dz) || 1;
    if (room!.free(x + dx / L * back, z + dz / L * back)) { x += dx / L * back; z += dz / L * back; }
    player.teleport(x, z);
    const yaw = Math.atan2(-(sx - x), -(sz - z)); rig.yaw = yaw; rig.pitch = -0.2; (player as any).setFace?.(yaw);
    return { i, x, z };
  },
  /** Walk-free test: stand at the dig spot of the k-th diggable stone, face it and start digging. */
  digNear(k = 0, fp = false) {
    const M = client.model, G = M.G, mx = G.mx, mz = G.mz, fr = (M.st?.front || []).filter((i) => G.digSpot(M.dug, i) != null);
    const i = fr[Math.min(k, fr.length - 1)]; if (i == null) return null;
    const sp = G.centerOf(G.digSpot(M.dug, i)!), c = G.cellXY(i), x = mx(sp.x), z = mz(sp.y);
    player.teleport(x, z);
    const yaw = Math.atan2(-(mx(c.cx) - x), -(mz(c.cy) - z));
    rig.yaw = yaw; rig.pitch = fp ? -0.35 : -0.3;
    (player as any).setFace?.(yaw);
    // the follow camera needs a moment to arrive: try until the hero digs, then (TP) swing the camera to the side
    let n = 0;
    const tryUse = () => {
      if (client.model.myI < 0 && n++ < 12) { interact.use('key'); setTimeout(tryUse, 400); return; }
      if (!fp) { rig.yaw = yaw + 1.25; rig.pitch = -0.2; }
    };
    setTimeout(tryUse, 400);
    return { i, x, z, yaw };
  },
  step(n: number, dt = 1 / 60) { engine.pause(true); for (let i = 0; i < n; i++) { stepT += dt; tick(dt, stepT); } renderer.render(scene, camera); return feet.toArray().map((v) => +v.toFixed(2)); },
};
