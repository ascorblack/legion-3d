/**
 * Dev page for src/avatar: a lineup of varied characters on a plane (walking / idle), nameplates and periodic chat
 * bubbles, plus an inset with the first-person view-model.
 * URL params: ?style=cats|monkeys|legion  ?lod=0|1|2  ?walk=0|1  ?cam=front|side|close  ?vm=0
 * window.__dev exposes helpers for screenshots.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createAvatarKit, createLabels, appearanceFrom, RECOMMENDED_NEAR } from '../src/avatar';
import { VM_TUNE } from '../src/avatar/viewmodel';
import type { Avatar, ViewModel } from '../src/contracts/modules';
import meFixture from '../test/fixtures/me.json';
import { registerItemModels, SUPPORTED_ITEM_MODEL_KEYS, addRarityRing } from '../src/avatar/items';
import { createRegistry } from '../src/core/registry';
import type { ItemModelFactory } from '../src/contracts/ext';

const q = new URLSearchParams(location.search);
const style = q.get('style') || 'cats';

const W = (l: string, n: string, lv: number, lk: any, g: any, gh = 0) => ({ l, n, lv, lk, g, gh });
const CROWD = [
  W('bean_knight', 'Мурзик', 7, { shape: 'bean', eyes: 'big', mouth: 'open', blush: true, hat: 'none' }, { w: 'sword', wr: 'rare', s: 'round', sr: 'uncommon', a: 'lorica', ar: 'rare', am: 'heavy' }),
  W('box_king', 'Коробкин', 5, { shape: 'box', hat: 'crown', color: '#ffb27a', eyes: 'happy', mouth: 'grin' }, { w: 'hammer', wr: 'epic', a: 'plate', ar: 'epic' }),
  W('ball_mage', 'Пушистик', 9, { shape: 'ball', hat: 'wizard', acc: ['cape'], aura: 'halo', eyes: 'stars', mouth: 'tongue' }, { w: 'staff', wr: 'legendary', a: 'robe', ar: 'legendary', am: 'cloth' }),
  W('tall_scholar', 'Длинный', 4, { shape: 'tall', eyes: 'big', acc: ['glasses', 'scarf'], color: '#7fd6e6' }, { w: 'grimoire', wr: 'rare', a: 'robe', ar: 'rare' }),
  W('ghost_gent', 'Призрак', 6, { shape: 'ghost', hat: 'tophat', eyes: 'dots', mouth: 'open', color: '#e6e6ee', acc: ['monocle'] }, { w: 'censer', wr: 'uncommon' }),
  W('cone_miner', 'Шахтёр', 3, { shape: 'cone', eyes: 'cyclops', mouth: 'grin', hat: 'none' }, { w: 'pitchfork', a: 'leather', ar: 'uncommon', am: 'light', h: 'miner', hr: 'common' }),
  W('egg_bow', 'Батон', 2, { shape: 'egg', hat: 'bow', color: '#ff9fb2', blush: true }, { w: 'bow', wr: 'uncommon', a: 'lorica', ar: 'common', am: 'light' }),
  W('rogue_cat', 'Тень', 8, { shape: 'bean', color: '#4a4350', eyes: 'happy', acc: ['shades'], hat: 'none' }, { w: 'kris', wr: 'epic', a: 'leather', ar: 'epic', h: 'rhood', hr: 'epic' }),
  W('necro', 'Некрокот', 10, { shape: 'tall', color: '#9aa3ad', aura: 'shadow', hat: 'none' }, { w: 'skullstaff', wr: 'epic', a: 'shroud', ar: 'epic', h: 'nhood', hr: 'rare' }),
  W('paladin', 'Светлый', 12, { shape: 'box', color: '#f4f1ec', aura: 'gold', acc: ['pioneer'], hat: 'none' }, { w: 'holymace', wr: 'legendary', s: 'scutum', sr: 'legendary', a: 'plate', ar: 'legendary', h: 'phelm', hr: 'legendary' }),
  W('frosty', 'Снежок', 5, { shape: 'ball', color: '#8fb6ff', hat: 'party', aura: 'frost', acc: ['bowtie'] }, { w: 'mace', wr: 'rare', s: 'buckler', sr: 'rare' }),
  W('cowpoke', 'Ковбой', 4, { shape: 'egg', hat: 'cowboy', acc: ['mustache', 'tie'], color: '#ffe27a' }, { w: 'axe', wr: 'uncommon', s: 'barrel', sr: 'common' }),
  W('sparky', 'Искра', 6, { shape: 'cone', hat: 'antenna2', aura: 'sparks', color: '#9fe39a' }, { w: 'spear', wr: 'rare', a: 'lorica', ar: 'uncommon', am: 'heavy' }),
  // Halloween looks (26.10): vampire cape + bats, Frankenstein bolts + cobweb + pumpkin glow + candy bucket
  W('vamp', 'Вампирчик', 7, { shape: 'bean', color: '#c9b8d8', acc: ['vampcape', 'fangs'], aura: 'bats', eyes: 'big', hat: 'none', mouth: 'open' }, {}),
  W('franky', 'Франки', 5, { shape: 'box', color: '#9fe39a', acc: ['bolts', 'cobweb', 'candybag'], aura: 'jackglow', eyes: 'dots', hat: 'none' }, {}),
  W('shepherd', 'Пастух', 3, { shape: 'bean', hat: 'bunny', color: '#b9a2ff', eyes: 'dots' }, { w: 'crook', wr: 'common', a: 'robe', ar: 'common' }),
  W('legionary', 'Легионер', 11, { shape: 'tall', hat: 'legion', color: '#ffc94d' }, { w: 'gladius', wr: 'legendary', s: 'scutum', sr: 'rare', a: 'lorica', ar: 'legendary', am: 'heavy' }),
  W('dead_one', 'Упокоенный', 7, { shape: 'bean', hat: 'halo' }, { w: 'club', a: 'leather' }, 1),
  W('nobody', 'Безликий', 1, null, { w: 'dagger' }),
];
const LINES = ['Мяу! Кто со мной в шахту?', 'Продам рыбку, недорого 🐟', 'Привет всем!', 'Легион, вперёд!!!',
  'Кто-нибудь видел мою шапку? Она была где-то тут, у колодца, а теперь её нет совсем', 'ахаха', 'пойдём в кузню',
  'Сегодня стрим в 8, не пропустите', 'Ура, новый уровень!', 'а где ярмарка?'];

/* ---------------- renderer ---------------- */
const host = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#3a2f6e');
scene.fog = new THREE.Fog('#3a2f6e', 18, 40);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
const cam = q.get('cam') || 'front';
if (cam === 'close') camera.position.set(0, 1.1, 4.6); else if (cam === 'one') camera.position.set(0.9, 1.0, 2.1); else if (cam === 'back') camera.position.set(-1.2, 1.3, -2.6); else if (cam === 'side') camera.position.set(8, 3, 7); else camera.position.set(0, 3.2, 11.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, cam === 'close' || cam === 'one' || cam === 'back' ? 0.7 : 0.8, cam === 'close' || cam === 'one' || cam === 'back' ? 0 : 0.5);
controls.update();

scene.add(new THREE.HemisphereLight('#d8d0ff', '#4a3a5a', 1.6));
const sun = new THREE.DirectionalLight('#fff1dc', 2.2);
sun.position.set(-5, 9, 7); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
scene.add(sun);
const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 48).rotateX(-Math.PI / 2), new THREE.MeshToonMaterial({ color: '#6a5a8a' }));
ground.receiveShadow = true; scene.add(ground);
const grid = new THREE.GridHelper(40, 40, 0x8a7ab0, 0x7a6aa0); (grid.material as THREE.Material).opacity = 0.25; (grid.material as THREE.Material).transparent = true; grid.position.y = 0.002; scene.add(grid);

/* ---------------- avatars ---------------- */
const kit = createAvatarKit();
const labels = createLabels();
scene.add(labels.root);
interface Guy { av: Avatar; login: string; home: THREE.Vector3; walker: boolean; ang: number; anchor: THREE.Vector3; speed: number }
const guys: Guy[] = [];
const anchors = new Map<string, THREE.Vector3>();
const walkAll = q.get('walk');
const solo = q.get('solo');   // e.g. ?solo=0,1,2 — only these characters, in one row
// ?acc=1 — accessory grid: columns = body shapes, rows = accessory sets (?sets=glasses,shades;cape  ?eyes=big  ?gear=1)
const accMode = q.get('acc') === '1' || q.get('me') === '1' || !!q.get('items');
const SHAPES = (q.get('shapes') || 'bean,box,ball,tall,ghost,cone,egg').split(',');
const ACC_SETS = (q.get('sets') || 'glasses;shades;monocle;mustache,bowtie;tie,scarf;cape;pioneer').split(';').map((x) => x.split(',').filter(Boolean));
const EYES = (q.get('eyes') || 'big,dots,stars,happy,cyclops').split(',');
const COLORS = ['#e6e6ee', '#ffb27a', '#8fb6ff', '#9fe39a', '#ff9fb2', '#ffe27a', '#b9a2ff'];
type Entry = { raw: ReturnType<typeof W>; pos: THREE.Vector3 };
let ENTRIES: Entry[];
if (q.get('acc') === '1') {
  ENTRIES = [];
  ACC_SETS.forEach((set, r) => SHAPES.forEach((shape, c) => {
    const lk = { shape, acc: set, eyes: EYES[(c + r) % EYES.length], mouth: 'grin', color: COLORS[(c + r) % COLORS.length], hat: 'none', accColor: '#e8455c', capeColor: '#c0182b' };
    const g = q.get('gear') === '1' ? { w: 'sword', a: (['lorica', 'robe', 'leather', 'plate'] as const)[c % 4], ar: 'rare', am: 'heavy' } : {};
    ENTRIES.push({ raw: W(`acc_${shape}_${r}`, `${shape} ${set.join('+')}`, 1, lk, g), pos: new THREE.Vector3((c - (SHAPES.length - 1) / 2) * 0.95, 0, (r - (ACC_SETS.length - 1) / 2) * 1.6) });
  }));
  const rows = ACC_SETS.length;
  if (cam === 'back') camera.position.set(0, 1.4 + rows * 0.5, -(3.2 + rows * 1.6)); else camera.position.set(0, 1.4 + rows * 0.5, 3.2 + rows * 1.6);
  controls.target.set(0, 0.6, 0); controls.update();
} else if (q.get('faces')) {
  // ?faces=1 — ONE login in several eyes / mouths (a shared model): every figure must show its own face
  const F: [string, string][] = [['dots', 'open'], ['stars', 'tongue'], ['happy', 'grin'], ['cyclops', 'open'], ['big', 'grin'], ['jack', 'tongue']];
  ENTRIES = F.map(([eyes, mouth], i) => ({ raw: W('facetest', `${eyes} · ${mouth}`, 1, { shape: 'bean', color: '#ffb27a', eyes, mouth, blush: false }, {}), pos: new THREE.Vector3((i - (F.length - 1) / 2) * 1.35, 0, 0) }));
} else if (q.get('nicks')) {
  // ?nicks=a,b,c — looks "by nick" only (no wardrobe, no gear): side-by-side checks against the site's doodles
  const ns = q.get('nicks')!.split(','), per = +(q.get('per') || 6);
  ENTRIES = ns.map((n, i) => ({ raw: W(n, n, 1, null, {}), pos: new THREE.Vector3((i % per - (Math.min(per, ns.length) - 1) / 2) * 1.35, 0, Math.floor(i / per) * 2.4) }));
} else if (q.get('items')) {
  ENTRIES = [];
  buildItemsGrid(q.get('items')!);
} else if (q.get('me') === '1') {
  // the owner-like hero from the sanitized fixture (bean, glasses + cape, bow, scutum, light lorica, miner helmet)
  const h = (meFixture as any).hero;
  const gear = { ...h.gear }; for (const k of (q.get('strip') || '').split(',')) delete gear[k];   // ?strip=w,s,a,h
  const look = { ...(h.wardrobe?.cur || h.look) }; if (q.has('meacc')) look.acc = q.get('meacc')!.split(',').filter(Boolean);   // ?meacc=glasses
  ENTRIES = [{ raw: W(h.login, h.name, h.level, look, gear), pos: new THREE.Vector3() }];
} else {
  const L0 = solo ? solo.split(',').map((i) => CROWD[+i]).filter(Boolean) : CROWD;
  const n0 = L0.length, perRow0 = solo ? 99 : 9;
  ENTRIES = L0.map((raw, i) => {
    const row = Math.floor(i / perRow0), col = i % perRow0, cnt = Math.min(perRow0, n0 - row * perRow0);
    return { raw, pos: new THREE.Vector3((col - (cnt - 1) / 2) * (solo ? 1.25 : 1.35), 0, solo ? 0 : row * 2.4 - 1.2) };
  });
}
ENTRIES.forEach(({ raw, pos }, i) => {
  const app = appearanceFrom(raw.l, raw, style, null);
  const av = kit.create(app);
  const home = pos.clone();
  av.root.position.copy(home);
  av.root.rotation.y = Math.PI;   // face the camera (+Z)
  scene.add(av.root);
  av.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  const lod = q.get('lod'); if (lod) av.setLod(+lod as 0 | 1 | 2);
  const g: Guy = { av, login: app.login, home, walker: walkAll === '1' ? true : walkAll === '0' || accMode ? false : i % 3 === 1, ang: 0, anchor: new THREE.Vector3(), speed: 0 };
  guys.push(g);
  anchors.set(app.login, g.anchor);
  if (!accMode) labels.set(app.login, { name: app.name, level: app.level, me: i === 0 });
});
// a couple of bubbles right away (for screenshots)
if (!solo && !accMode && guys.length > 11) { labels.bubble(guys[1].login, LINES[0], 60000); labels.bubble(guys[4].login, LINES[4], 60000); labels.bubble(guys[11].login, LINES[3], 60000); }

// ?cp=x,y,z&ct=x,y,z — explicit camera position / target (screenshots)
if (q.get('cp')) { const [x, y, z] = q.get('cp')!.split(',').map(Number); camera.position.set(x, y, z); }
if (q.get('ct')) { const [x, y, z] = q.get('ct')!.split(',').map(Number); controls.target.set(x, y, z); }
controls.update();

/* ---------------- item models grid (?items=1 | ?items=weapon,hat  ?rar=epic  ?cols=12  ?ring=1) ---------------- */
function buildItemsGrid(filter: string) {
  const reg = createRegistry<ItemModelFactory>('itemModels');
  registerItemModels(reg);
  const pre = filter === '1' ? null : filter.split(',');
  const keys = SUPPORTED_ITEM_MODEL_KEYS.filter((k) => !pre || pre.some((p) => k.startsWith(p) || (p === '*' && k === '*')));
  const RAR = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  const cols = +(q.get('cols') || Math.min(12, Math.ceil(Math.sqrt(keys.length * 1.8)))), sp = 0.72, rows = Math.ceil(keys.length / cols);
  const standGeo = new THREE.CylinderGeometry(0.2, 0.23, 0.08, 20), standMat = new THREE.MeshToonMaterial({ color: '#8a6a9a' });
  const tris: string[] = [];
  keys.forEach((key, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const x = (c - (cols - 1) / 2) * sp, z = (r - (rows - 1) / 2) * sp * 1.25;
    const stand = new THREE.Mesh(standGeo, standMat); stand.position.set(x, 0.04, z); stand.receiveShadow = true; scene.add(stand);
    const [kind, id] = key.split(':');
    const slot = kind === 'slot' ? id : kind === 'hat' ? 'helmet' : kind === 'charm' ? 'trinket' : kind === 'food' ? 'food' : kind === '*' ? 'relic' : kind;
    const rarity = q.get('rar') || RAR[i % RAR.length];
    const obj = reg.get(key)!({}, { rarity, slot, id: kind === 'food' ? id : kind === 'slot' ? '' : id });
    if (q.get('ring') === '1') addRarityRing(obj, rarity);
    obj.position.set(x, 0.08, z);
    obj.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name === 'item-model') o.castShadow = true; });
    scene.add(obj);
    const m = obj.getObjectByName('item-model') as THREE.Mesh;
    const nt = m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3;
    tris.push(`${key}:${nt}`);
    // label
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 48;
    const g = cv.getContext('2d')!; g.fillStyle = 'rgba(20,16,42,.7)'; g.fillRect(0, 0, 256, 48); g.fillStyle = '#fff'; g.font = '24px sans-serif'; g.textAlign = 'center'; g.fillText(key, 128, 32);
    const sp_ = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false }));
    sp_.scale.set(0.5, 0.094, 1); sp_.position.set(x, 0.0, z + 0.3); scene.add(sp_);
  });
  camera.position.set(0, 1.2 + rows * 0.55, 1.2 + rows * 0.95); controls.target.set(0, 0.1, rows * 0.1); controls.update();
  (window as any).__items = { reg, keys, tris };
}

/* ---------------- view-model inset ---------------- */
const vmHost = document.getElementById('vm')!;
const showVm = q.get('vm') !== '0';
if (!showVm) vmHost.style.display = 'none';
// ?vmfull=1 — the view-model inset fills the window (close-up checks); ?vmi=<crowd index>|me
const vmFull = q.get('vmfull') === '1';
const VW = vmFull ? innerWidth : 360, VH = vmFull ? innerHeight : 220;
if (vmFull) Object.assign(vmHost.style, { left: '0', top: '0', right: '0', bottom: '0', width: '100%', height: '100%', border: '0', borderRadius: '0' });
const vmRenderer = new THREE.WebGLRenderer({ antialias: true });
vmRenderer.setSize(VW, VH); vmHost.appendChild(vmRenderer.domElement);
const vmScene = new THREE.Scene(); vmScene.background = new THREE.Color('#6d6a8a');
const vmCam = new THREE.PerspectiveCamera(70, VW / VH, RECOMMENDED_NEAR, 50);
vmCam.position.set(0, 1.15, 0);
vmScene.add(vmCam);
vmScene.add(new THREE.HemisphereLight('#d8d0ff', '#4a3a5a', 1.6));
const vmSun = new THREE.DirectionalLight('#fff1dc', 2); vmSun.position.set(-2, 5, 3); vmScene.add(vmSun);
// a wall right in front of the camera to prove the paws never clip
const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.2), new THREE.MeshToonMaterial({ color: '#9a7a5a' }));
wall.position.set(0, 1.2, -0.25); vmScene.add(wall);
const vmGround = new THREE.Mesh(new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2), new THREE.MeshToonMaterial({ color: '#5a4a7a' })); vmScene.add(vmGround);
let vmIdx = q.get('vmi') && q.get('vmi') !== 'me' ? +q.get('vmi')! : 9;
const meRaw = () => { const h = (meFixture as any).hero; return W(h.login, h.name, h.level, h.wardrobe?.cur || h.look, h.gear); };
// ?vmw=<weapon>|none &vms=<shield>|none &vma=<armour> override the gear of the chosen look; ?vmblock=1 holds RMB,
// ?vmwalk=0..1.6 speed, ?vmfov=<deg> camera fov
const vmApp = (a: ReturnType<typeof appearanceFrom>) => {
  const g = { ...a.gear } as any;
  const ov = (k: string, p: string) => { const v = q.get(p); if (v !== null) { if (v === 'none' || v === '') delete g[k]; else g[k] = v; } };
  ov('w', 'vmw'); ov('s', 'vms'); ov('a', 'vma');
  return { ...a, gear: g };
};
if (q.get('vmfov')) { vmCam.fov = +q.get('vmfov')!; vmCam.updateProjectionMatrix(); }
const vmLastApp: ReturnType<typeof appearanceFrom> = vmApp(q.get('vmi') === 'me' ? appearanceFrom(meRaw().l, meRaw(), style, null) : appearanceFrom(CROWD[vmIdx].l, CROWD[vmIdx], style, null));
let vm: ViewModel = kit.viewModel(vmLastApp);
vmCam.add(vm.root);
if (q.get('vmblock') === '1') (vm as any).block?.(true);
const vmWalk = q.get('vmwalk') !== null ? +q.get('vmwalk')! : null;
let vmPaused = false;

/* ---------------- input ---------------- */
let lookDx = 0;
addEventListener('mousemove', (e) => { lookDx += e.movementX || 0; });
addEventListener('mousedown', (e) => { if (e.button === 0 && (e.target as HTMLElement).closest('#vm')) vm.swing(); });
addEventListener('keydown', (e) => {
  if (e.code === 'KeyW') guys.forEach((g) => g.av.play('wave'));
  if (e.code === 'KeyC') guys.forEach((g) => g.av.play('cheer'));
  if (e.code === 'KeyE') guys.forEach((g) => g.av.play('equip'));
  if (e.code === 'KeyS') { guys.forEach((g) => g.av.play('swing')); vm.swing(); }
  if (e.code === 'KeyJ') { guys.forEach((g) => g.av.play('jump')); setTimeout(() => guys.forEach((g) => g.av.play('land')), 600); }
  if (e.code === 'KeyG') guys.forEach((g) => (g.walker = !g.walker));
  if (e.code === 'KeyL') { lodAll = ((lodAll + 1) % 3) as 0 | 1 | 2; guys.forEach((g) => g.av.setLod(lodAll)); }
  if (e.code === 'KeyV') {
    vmIdx = (vmIdx + 1) % CROWD.length; vm.root.removeFromParent(); vm.dispose();
    vm = kit.viewModel(appearanceFrom(CROWD[vmIdx].l, CROWD[vmIdx], style, null)); vmCam.add(vm.root);
  }
});
let lodAll: 0 | 1 | 2 = 0;
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

/* ---------------- loop ---------------- */
const hud = document.getElementById('hud')!;
let last = performance.now(), t = 0, fps = 0, nextBubble = 2;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now; t += dt;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  for (const g of guys) {
    let sp = 0;
    if (g.walker) {
      g.ang += dt * 0.55;
      const r = 0.55;
      g.av.root.position.set(g.home.x + Math.sin(g.ang) * r, 0, g.home.z + Math.cos(g.ang) * r - r);
      // moving direction d = (cos, -sin); face convention: forward = (−sin f, −cos f)
      g.av.root.rotation.y = Math.atan2(-Math.cos(g.ang), Math.sin(g.ang));
      sp = 1;
    }
    g.av.update(dt, t, sp);
    g.anchor.copy(g.av.root.position); g.anchor.y += g.av.headTop + 0.08;
  }
  if (!solo && !accMode && t > nextBubble) { nextBubble = t + 2.5; const g = guys[(Math.random() * guys.length) | 0]; labels.bubble(g.login, LINES[(Math.random() * LINES.length) | 0], 6000); }
  labels.update(anchors, camera, dt);
  controls.update();
  renderer.render(scene, camera);
  if (showVm && !vmPaused) {
    vm.update(dt, t, vmWalk ?? (vmFull ? 0 : Math.sin(t * 0.5) > 0 ? 1 : 0), { dx: lookDx, dy: 0 }); lookDx = 0;
    if (!vmFull) vmCam.rotation.y = Math.sin(t * 0.3) * 0.15;
    vmRenderer.render(vmScene, vmCam);
  }
  const info = renderer.info;
  hud.textContent = `avatars ${guys.length}  style ${style}  lod ${lodAll}\nfps ${fps.toFixed(0)}  calls ${info.render.calls}  tris ${info.render.triangles}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as any).__dev = {
  guys, labels, kit, vm: () => vm, scene, camera, renderer, vmRenderer, vmScene, vmCam, VM_TUNE,
  /** rebuild the view-model (after editing VM_TUNE.bow) */
  vmRebuild() { (vm as any).key = ''; vm.setAppearance(vmLastApp); (vm as any).raise = 1; },
  /** change the view-model gear: __dev.vmGear({ w: 'axe', s: 'round' }) (null deletes a key) */
  vmGear(g: Record<string, string | null>) {
    const ng = { ...vmLastApp.gear } as any;
    for (const k in g) { if (g[k] === null) delete ng[k]; else ng[k] = g[k]; }
    (vmLastApp as any).gear = ng; (vm as any).key = ''; vm.setAppearance(vmLastApp); (vm as any).raise = 1;
  },
  get paused() { return vmPaused; }, set paused(on: boolean) { vmPaused = on; },
};
