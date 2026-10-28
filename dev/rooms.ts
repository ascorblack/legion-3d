/**
 * Room viewer: builds every shop3d / hybrid room standalone with fixture stock (test/fixtures/stock.json) and a fake
 * site (fixture hero, fake actions that never touch the network). Walk with WASD + mouse drag (or pointer lock on
 * click), E / LMB uses the aimed good (buy card), Esc closes it.
 *
 * ?room=forge|magic|shop|tent|trainer|board|hall|auction|storage|gate|anvil|plain   (default forge)
 * ?cam=x,y,z&look=x,y,z    fixed camera (screenshots)       ?q=0..3 quality       ?stats=1 overlay
 * ?cs=0 (no coin purchases → «на стриме»)  ?ms=0 (no magic shop)  ?money=N  ?ghost=1  ?fail=1 (actions fail)
 * ?aim=<goodIndex>  aim at a good and open its card (?card=1) — for screenshots of the buy flow
 * ?tp=1  third person: your hero + a shoulder camera that collides with the room's camera colliders (like the game rig)
 * ?models=1  shop goods from the game's item-model registry (src/avatar/items.ts, per-style goods) instead of the rooms' local models
 * ?yaw=a&pitch=p  initial view direction   ?at=x,z  start position   ?forge=up|broken|down|fail  run a fake enchant (anvil)
 * window.__rooms = { scene, room, renderer, stats(), open(i), goods() }
 */
import * as THREE from 'three';
import type { Store, Actions, Hero, ApiResult, Building } from '../src/contracts';
import type { Interactable, InteractSystem, RoomScene } from '../src/contracts/ext';
import { createShopRoom, SHOP_SCENES } from '../src/rooms/shop';
import { createHybridRoom, HYBRID_SCENES } from '../src/rooms/hybrid';
import type { RoomEnv } from '../src/rooms/common/base';
import { setStockCache, type CityStock } from '../src/rooms/common/stock';
import { setTexAnisotropy } from '../src/world/tex';
import { RECOMMENDED_NEAR, createAvatarKit, appearanceFrom } from '../src/avatar';
import me from '../test/fixtures/me.json';
import stockJson from '../test/fixtures/stock.json';
import map from '../test/fixtures/fair-map.json';
import { outlineFrame } from '../src/engine/outline';
import { createRegistries } from '../src/core/registries';
import { registerItemModels } from '../src/avatar/items';

const q = new URLSearchParams(location.search);
const roomId = q.get('room') || 'forge';
const quality = +(q.get('q') ?? 2);
const host = document.getElementById('app') as HTMLElement;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.0;
host.appendChild(renderer.domElement);
setTexAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, RECOMMENDED_NEAR, 200);
scene.add(camera);

/* ---------------------------------------------------------------- fake site */
const hero = JSON.parse(JSON.stringify((me as any).hero)) as Hero;
if (q.get('cs') === '0') delete (hero as any).cs;
if (q.get('ms') === '0') delete (hero as any).ms;
if (q.get('money')) hero.money = +q.get('money')!;
if (q.get('ghost') === '1') hero.ghost = true;
const subs = new Map<string, Set<() => void>>();
const store: Store = {
  get hero() { return hero; }, me: null, walkers: new Map(), chat: [], online: 1, quest: null, layout: null,
  on(ev, fn) { let s = subs.get(ev); if (!s) subs.set(ev, (s = new Set())); s.add(fn); return () => s!.delete(fn); },
};
const emit = (ev: string) => subs.get(ev)?.forEach((f) => f());
const log: { path: string; body: unknown }[] = [];
const actions: Actions = {
  equip: async () => ({ ok: true }), unequip: async () => ({ ok: true }), use: async () => ({ ok: true }), wear: async () => ({ ok: true }), say: async () => ({ ok: true }),
  async get<T>(path: string): Promise<T> {
    if (path === '/api/city/stock') return stockJson as unknown as T;
    if (path === '/api/me') return { ok: true, ench: { coins: { star: 300, sphere: 900 } } } as unknown as T;
    return { ok: false } as unknown as T;
  },
  async post<T>(path: string, body: any): Promise<T> {
    log.push({ path, body }); console.log('[fake post]', path, JSON.stringify(body));
    await new Promise((r) => setTimeout(r, 350));
    if (q.get('fail') === '1') return { ok: false, error: 'Сумка полна' } as unknown as T;
    if (path === '/api/cityBuy' || path === '/api/buymat') {
      const price = +(body.price || 300);
      hero.money = Math.max(0, hero.money - price);
      hero.items = [...hero.items, { uid: 'n' + Date.now(), id: body.item || body.mat, name: String(body.item || body.mat), slot: 'material', rarity: 'common', stats: {} } as any];
      setTimeout(() => emit('hero'), 10);
    }
    if (path === '/api/wear') { (hero.wardrobe!.cur as any)[body.field] = body.value; setTimeout(() => emit('hero'), 10); }
    return { ok: true, hero } as unknown as T;
  },
  openBuilding() {}, openSitePanel() {},
};
setStockCache(stockJson as unknown as CityStock);

/* ---------------------------------------------------------------- interaction: crosshair raycast + nearest */
const inters = new Set<Interactable>();
const ray = new THREE.Raycaster();
const _c = new THREE.Vector2(0, 0);
const _box = new THREE.Box3(), _pt = new THREE.Vector3();
const _xh: THREE.Intersection[] = [];
let target: Interactable | null = null;
const interact: InteractSystem = {
  add(i) { inters.add(i); return () => { inters.delete(i); }; },
  get target() { return target; },
};
let armNow = 0;
function pickTarget() {
  ray.setFromCamera(_c, camera);
  let best: Interactable | null = null, bd = Infinity;
  for (const i of inters) {
    const reach = (i.reach ?? 3) + armNow;
    let d = Infinity;
    if ((i.hit as THREE.Box3).isBox3) { const p = ray.ray.intersectBox(i.hit as THREE.Box3, _pt); if (p) d = p.distanceTo(ray.ray.origin); }
    else {   // like the game's interaction system: AABB first, then an exact raycast (one-sided planes count from the front only)
      _box.setFromObject(i.hit as THREE.Object3D); const p = ray.ray.intersectBox(_box, _pt);
      if (p) { _xh.length = 0; ray.intersectObject(i.hit as THREE.Object3D, true, _xh); if (_xh.length) d = _xh[0].distance; }
    }
    if (d < reach && d < bd) { bd = d; best = i; }
  }
  target = best;
}

/* ---------------------------------------------------------------- HUD */
const prompt = document.getElementById('prompt') as HTMLElement;
const toastEl = document.getElementById('toast') as HTMLElement;
const hud = document.getElementById('hud') as HTMLElement;
let toastT = 0;
function toast(t: string, bad?: boolean) { toastEl.textContent = t; toastEl.className = 'on' + (bad ? ' bad' : ''); clearTimeout(toastT); toastT = window.setTimeout(() => (toastEl.className = ''), 3500); }
let gameplay = true;
const input = { setGameplay(on: boolean) { gameplay = on; }, lock() { /* dev: no pointer lock */ }, get gameplay() { return gameplay; } };

void (async () => {
/* ---------------------------------------------------------------- build the room */
const B = ((map as any).BUILDINGS as Building[]).find((b) => b.id === roomId) || { id: roomId, title: roomId, hit: [0, 0, 0, 0], door: { x: 0, y: 0 } } as Building;
const player = { x: 0, z: 0, y: 0 };
const REG = q.get('models') === '1' ? createRegistries() : null;
if (REG) registerItemModels(REG.itemModels, () => q.get('style') || 'cats');
const env: RoomEnv = {
  building: B, styleId: q.get('style') || 'cats', quality, store, actions, input, interact, scene, itemModels: REG ? REG.itemModels : null,
  toast, exit: () => toast('→ выход на улицу'), showSitePanel: (o) => { document.body.dataset.panel = o?.side || 'left'; }, hideSitePanel: () => { delete document.body.dataset.panel; },
  player: () => player,
};
// the anvil hooks the site's window.LGCity.forgeStart/forgeFx/forgeCancel: a stand-in (the real site has its own)
const W0 = window as any;
if (roomId === 'anvil' && !W0.LGCity) W0.LGCity = { forgeStart() { console.log('[site] forgeStart'); }, forgeFx() { console.log('[site] forgeFx'); }, forgeCancel() { console.log('[site] forgeCancel'); } };
/** Fake enchant run exactly as the site's app.js does it: forgeStart(item, target) now, forgeFx(result) when the game answers. */
function fakeForge(out: string, tg = 5, answerMs = 2400) {
  const it = (hero.items || []).find((x: any) => x.slot === 'weapon') || (hero.items || [])[0];
  W0.LGCity.forgeStart(it, tg);
  const fx = () => W0.LGCity.forgeFx({ op: 'enchant', out, to: out === 'up' ? tg : out === 'down' ? tg - 2 : tg - 1, from: tg - 1, target: tg, item: it && it.name, uid: it && it.uid });
  if (out !== 'none') { if (answerMs <= 0) fx(); else setTimeout(fx, answerMs); }
}
const isShop = !!SHOP_SCENES[roomId] && !HYBRID_SCENES[roomId];
const t0 = performance.now();
const room: RoomScene = await (isShop ? createShopRoom(env) : createHybridRoom(env));
const buildMs = performance.now() - t0;
scene.add(room.root);
player.x = room.spawn.x; player.z = room.spawn.z;
let yaw = room.spawn.face, pitch = -0.08;
if (q.get('yaw')) yaw = +q.get('yaw')!;
if (q.get('pitch')) pitch = +q.get('pitch')!;
if (q.get('at')) { const [ax, az] = q.get('at')!.split(',').map(Number); player.x = ax; player.z = az; }
const tp = q.get('tp') === '1';
const meAv = tp ? createAvatarKit().create(appearanceFrom('me', { name: hero.name, look: (hero as any).wardrobe?.cur || (hero as any).look || {}, gear: (hero as any).gear || {} }, 'cats')) : null;
if (meAv) { scene.add(meAv.root); meAv.setLod(0); }
const camRay = new THREE.Raycaster(), _piv = new THREE.Vector3(), _dir = new THREE.Vector3(), _hits: THREE.Intersection[] = [];
/** Game-like TP rig: pivot 1.42+0.18 m, arm 3.2 m, right shoulder 0.72 m, spring-arm collision against room.colliders. */
function tpCamera() {
  const gy = room.groundAt(player.x, player.z);
  _piv.set(player.x, gy + 1.6, player.z);
  const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  _dir.set(-fx * 3.2 + rx * 0.72, -fy * 3.2, -fz * 3.2 + rz * 0.72);
  const L = _dir.length(); _dir.normalize();
  camRay.set(_piv, _dir); camRay.far = L + 0.22; _hits.length = 0;
  camRay.intersectObjects(room.colliders || [], false, _hits);
  const arm = _hits.length ? Math.max(0, _hits[0].distance - 0.22) : L;
  camera.position.copy(_piv).addScaledVector(_dir, arm);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  armNow = arm;
  if (meAv) { meAv.root.position.set(player.x, gy, player.z); meAv.root.rotation.y = yaw; meAv.root.visible = arm > 0.9; }
}
const fixed = q.get('cam');
if (fixed) {
  const [x, y, z] = fixed.split(',').map(Number); camera.position.set(x, y, z);
  const [lx, ly, lz] = (q.get('look') || '0,1,0').split(',').map(Number); camera.lookAt(lx, ly, lz);
  player.x = x; player.z = z;
}

/* ---------------------------------------------------------------- walk */
const keys = new Set<string>();
addEventListener('keydown', (e) => {
  if (!gameplay) return;
  keys.add(e.code);
  if (e.code === 'KeyE' && target) target.use('key');
  if (e.code === 'KeyF' && target && target.alt) target.alt.use();
});
addEventListener('keyup', (e) => keys.delete(e.code));
let drag = false, lx = 0, ly = 0;
renderer.domElement.addEventListener('pointerdown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; });
renderer.domElement.addEventListener('contextmenu', (e) => { e.preventDefault(); if (target && target.alt && gameplay) target.alt.use(); });
addEventListener('pointerup', (e) => { if (e.button !== 0) { drag = false; return; } if (drag && Math.hypot(e.clientX - lx, e.clientY - ly) < 4 && target && gameplay) target.use('click'); drag = false; });
addEventListener('pointermove', (e) => { if (!drag || !gameplay || fixed) return; yaw -= (e.clientX - lx) * 0.004; pitch = Math.max(-1.2, Math.min(1.2, pitch - (e.clientY - ly) * 0.004)); lx = e.clientX; ly = e.clientY; });
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

const clock = new THREE.Clock();
let frames = 0, fpsT = 0, fps = 0, frameNo = 0, simT = 0;
/** ?step=s: fixed time step per frame (deterministic animation screenshots on a slow software renderer). */
const STEP = +(q.get('step') || 0);
let paused = false;
function frame() {
  if (paused) { renderer.render(scene, camera); requestAnimationFrame(frame); return; }
  const rdt = Math.min(0.1, clock.getDelta());
  const dt = STEP || rdt; simT += dt; const t = STEP ? simT : clock.elapsedTime;
  frameNo++;
  if (!fixed && gameplay) {
    const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    if (keys.has('ArrowLeft')) yaw += dt * 1.8; if (keys.has('ArrowRight')) yaw -= dt * 1.8;
    const sp = 2.6 * dt, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const nx = player.x + (fx * f + rx * s) * sp, nz = player.z + (fz * f + rz * s) * sp;
    if (room.free(nx, player.z)) player.x = nx;
    if (room.free(player.x, nz)) player.z = nz;
  }
  if (!fixed && tp) tpCamera();
  else if (!fixed) {
    player.y = room.groundAt(player.x, player.z);
    camera.position.set(player.x, player.y + 1.15, player.z);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }
  if (meAv) meAv.update(dt, t, 0);
  pickTarget();
  room.update(dt, t, camera);
  prompt.textContent = target ? `[E] ${target.label}${target.alt ? `   ·   [F]/[ПКМ] ${target.alt.label}` : ''}` : '';
  prompt.style.opacity = target && gameplay ? '1' : '0';
  outlineFrame(renderer, scene, camera, t, false);   // target outline (hull: this page has no post chain)
  renderer.render(scene, camera);
  frames++; fpsT += rdt; if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }
  if (q.get('stats') === '1') hud.textContent = `${roomId}  build ${buildMs.toFixed(0)} ms  fps ${fps.toFixed(0)}\ncalls ${renderer.info.render.calls}  tris ${renderer.info.render.triangles}\nlights ${countLights()}  goods ${goods().length}  pos ${player.x.toFixed(2)},${player.z.toFixed(2)}  arm ${armNow.toFixed(2)}`;
  requestAnimationFrame(frame);
}
function countLights() { let n = 0; room.root.traverse((o) => { if ((o as THREE.Light).isLight) n++; }); return n; }
function goods(): Interactable[] { return [...inters].filter((i) => i.id.startsWith('room:good:') || i.id.startsWith('room:booth:')); }
requestAnimationFrame(frame);

const aim = q.get('aim');
if (aim != null) {
  const g = goods()[+aim];
  if (g) {
    const o = g.hit as THREE.Object3D; const c = (g.hit as THREE.Box3).isBox3 ? (g.hit as THREE.Box3).getCenter(new THREE.Vector3()) : o.getWorldPosition(new THREE.Vector3());
    if (!fixed) { const n = new THREE.Vector3(-c.x, 0, 1 - c.z).normalize(); for (let d = 1.4; d < 4; d += 0.2) { const px = c.x + n.x * d, pz = c.z + n.z * d; if (room.free(px, pz)) { player.x = px; player.z = pz; break; } } }
    if (!fixed) { const dx = c.x - player.x, dz = c.z - player.z; yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(c.y - 1.15 - room.groundAt(player.x, player.z), Math.hypot(dx, dz)); }
    if (q.get('card') === '1') setTimeout(() => { if (q.get('inspect') === '1' && g.alt) g.alt.use(); else g.use('click'); if (q.get('ask') === '1') setTimeout(() => (document.querySelector('.l3d-roomcard')!.shadowRoot!.querySelector('[data-buy]') as HTMLButtonElement | null)?.click(), 200); }, 300);
  }
}

if (q.get('forge')) setTimeout(() => fakeForge(q.get('forge')!, +(q.get('tg') || 5), +(q.get('answer') || 2400)), +(q.get('forgeAt') || 1500));
(window as any).__rooms = {
  scene, room, renderer, log, hero, emit, fakeForge, cancelForge: () => W0.LGCity && W0.LGCity.forgeCancel(),
  anvil: () => { const f = room.root.userData.l3dAnvil; return f ? { state: f.state, struck: f.struck, left: f.left, shown: f.shown } : null; },
  arm: () => armNow,
  frames: () => frameNo,
  pause: (on: boolean) => { paused = on; },
  /** Resolves after n more frames. */
  waitFrames: (n: number) => new Promise<void>((r) => { const f0 = frameNo; const c = () => (frameNo - f0 >= n ? r() : requestAnimationFrame(c)); c(); }),
  stats: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, buildMs, lights: countLights(), goods: goods().length, fps }),
  goods: () => goods().map((g) => g.label),
  open: (i: number) => goods()[i]?.use('click'),
  walk: (x: number, z: number, face?: number) => { player.x = x; player.z = z; if (face != null) yaw = face; },
  look: (y: number, p: number) => { yaw = y; pitch = p; },
};
})();
