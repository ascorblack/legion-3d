/**
 * «Тестовое измерение»: a separate showcase world for testers (debug mode only), a RoomScene swapped in with
 * ctx.setSpace like a hybrid room — the site's hero stays where it was (src/debug/space.ts).
 *
 * A long cobbled avenue under its own sky (time of day: night / dawn / day / dusk, smooth), with sections on both
 * sides, each built lazily the first time the player comes near and hidden when far (so only ~2 sections draw):
 *   north: every item model of the catalog on tiered stands (aim + E/F = the item card), every look on mannequin cats
 *          (body shapes, hats, accessories, auras, class sets, the ghost);
 *   south: portals (the 3D shops, hybrid interiors, the mine, the camp «Перепутье», a district town, the Fair — all
 *          offline/demo, nothing is sent), seasonal event totems, every expedition foe (hw_* and the Pumpkin Golem
 *          included), the NPCs (shopkeepers, Halloween NPCs).
 * Static parts of a section are batched per material (src/debug/bake.ts): items ≈ 12 draw calls for ~100 models.
 * Everything is disposed on exit. Pure scene: the debug controller (src/debug/index.ts) supplies the callbacks.
 */
import * as THREE from 'three';
import type { Interactable, RoomScene, ItemModelFactory } from '../contracts/ext';
import type { Avatar, AvatarKit } from '../contracts/modules';
import type { Unsub } from '../contracts';
import { appearanceFrom, CATALOG } from '../avatar';
import { SUPPORTED_ITEM_MODEL_KEYS, addRarityRing } from '../avatar/items';
import { FOE_ARTS, foeArtOf } from '../expedition/adapter';
import { foeGeo, bossGeo, BOSS_PAL, FOE_FLY } from '../expedition/art';
import { Npc, type NpcDef } from '../rooms/common/npc';
import { Parts, keepColours } from '../events/halloween/hwgeo';
import { stupaGeometry, passGeometry } from '../events/halloween/npcgeo';
import { npcWorld, tablePlace } from '../events/halloween/hwnpc';
import { PropKit } from '../world/props';
import { getTexture } from '../world/tex';
import { stars } from '../world/sky';
import { dotTexture } from '../world/textures';
import { bakeStatic } from './bake';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface CardInfo { title: string; icon?: string; rows: [string, string][] }
export interface PortalDef { id: string; title: string; icon: string; sub?: string; color: string; off?: string; go(): void }
export interface TotemDef { id: string; title: string; icon: string; color: string; on(): boolean; toggle(): void }

export interface DimensionHost {
  kit: AvatarKit;
  itemModels: { get(key: string): ItemModelFactory | undefined };
  interact: { add(i: Interactable): Unsub };
  quality(): number;
  player(): { x: number; z: number };
  card(c: CardInfo): void;
  portals(): PortalDef[];
  totems(): TotemDef[];
  heroName(): string;
}

/* ------------------------------------------------------------------ layout */
export const AVE = { z0: -1.8, z1: 6.4 };
export const SPAWN = { x: -4.5, z: 2.4, face: -Math.PI / 2 };   // looking down the avenue (+X)
const HUB = { fx: -9, fz: 2.4, r: 1.9 };

const FAM_RU: Record<string, string> = { weapon: 'Оружие', shield: 'Щит', armor: 'Доспех', hat: 'Шапка', charm: 'Амулет', slot: 'Предмет', food: 'Еда', '*': 'Подарок' };
const RAR = CATALOG.rarities;
const RAR_RU: Record<string, string> = { common: 'обычный', uncommon: 'необычный', rare: 'редкий', epic: 'эпический', legendary: 'легендарный' };
const HW_KEYS = ['hw_pumpkin', 'hw_pumpkinlet', 'hw_jack', 'hw_ghost', 'hw_bat', 'hw_crow', 'hw_witch', 'hw_zombie', 'hw_skeleton', 'hw_spider', 'hw_cat', 'hw_scarecrow'];
const FOE_RU: Record<string, string> = {pumpkinlet: 'Тыквёнок', cat: 'Чёрный кот', zombie: 'Мертвец', scarecrow: 'Пугало', witch: 'Ведьма', crow: 'Ворон', jack: 'Джек-Фонарщик', toad: 'Жаба', bones: 'Костяк',  wolf: 'Волк', skeleton: 'Скелет', bandit: 'Разбойник', boar: 'Кабан', drowner: 'Утопец', spider: 'Паук', bat: 'Летучая мышь', ghost: 'Призрак', slime: 'Слизень', pumpkin: 'Тыквоголов', golem: 'Тыквенный голем',
  wolfLead: 'Вожак волков', skeletonLead: 'Скелет-легионер (вожак)', banditLead: 'Атаман', toadLead: 'Жабий сёгун', ghostLead: 'Призрак со свечой (вожак)',
  batLead: 'Вампир', spiderLead: 'Чёрная вдова', zombieLead: 'Староста мертвецов', bonesLead: 'Костяной страж', witchLead: 'Старшая ведьма',
  catLead: 'Кот-ведьмак', scarecrowLead: 'Пугало-жнец',
  rat: 'Крыса', beast: 'Зверь лабиринта', lavaslime: 'Лавовый слизень', splasher: 'Брызгун', crab: 'Рак-отшельник', mushroom: 'Грибник',
  shroom: 'Лиловый гриб', mummy: 'Мумия', imp: 'Бесёнок', icelet: 'Ледышка', potion: 'Живое зелье', book: 'Книга-кусака', blade: 'Призрачный меч',
  sandworm: 'Песчаный червь', tentacle: 'Живой щупалец', automaton: 'Автоматон', stonegolem: 'Каменный голем', shade: 'Тень', voidling: 'Пустотник',
  minerghost: 'Дух шахтёра', knight: 'Рыцарь', monk: 'Монах', tinnik: 'Тинник', frostdead: 'Ледяной мертвец', sailor: 'Утопший матрос',
  prisoner: 'Узник', widow: 'Паучиха подземелья', skullguard: 'Черепной страж', squire: 'Оруженосец', smuggler: 'Контрабандист' };

/** Section names for the panel's «Перейти» buttons (x = where the player stands, facing the exhibit). */
export interface SectionInfo { id: string; title: string; icon: string; x: number; side: 'n' | 's' }

/* ------------------------------------------------------------------ time of day */
interface Pal { top: string; mid: string; low: string; sun: string; sunI: number; sky: string; gnd: string; hemiI: number; stars: number; lamps: number }
const KEYS: [number, Pal][] = [
  [0, { top: '#07061c', mid: '#15123c', low: '#2e2660', sun: '#a8a4ff', sunI: 0.45, sky: '#6a64c0', gnd: '#2a2040', hemiI: 0.95, stars: 1, lamps: 1 }],
  [6, { top: '#26296a', mid: '#a0688e', low: '#ffb487', sun: '#ffb27a', sunI: 0.9, sky: '#a8a0e0', gnd: '#4a3a40', hemiI: 1.0, stars: 0.25, lamps: 0.6 }],
  [12, { top: '#3f7fd4', mid: '#8cbdf0', low: '#e6f0ff', sun: '#fff1da', sunI: 2.3, sky: '#d4e6ff', gnd: '#8a7a68', hemiI: 1.45, stars: 0, lamps: 0 }],
  [18.5, { top: '#1b1640', mid: '#9a5a86', low: '#f3a26e', sun: '#ff9f62', sunI: 1.0, sky: '#c8a0d8', gnd: '#5a4050', hemiI: 1.35, stars: 0.35, lamps: 0.8 }],
  [21, { top: '#0b0a24', mid: '#1d1a4a', low: '#3a2f6e', sun: '#b8b4ff', sunI: 0.4, sky: '#6a64c0', gnd: '#2a2040', hemiI: 0.8, stars: 1, lamps: 1 }],
  [24, { top: '#07061c', mid: '#15123c', low: '#2e2660', sun: '#a8a4ff', sunI: 0.35, sky: '#5a54b0', gnd: '#231a36', hemiI: 0.75, stars: 1, lamps: 1 }],
];
const _ca = new THREE.Color(), _cb = new THREE.Color();
function lerpCol(out: THREE.Color, a: string, b: string, k: number): THREE.Color { return out.copy(_ca.set(a)).lerp(_cb.set(b), k); }

const SKY_VERT = `varying vec3 vW; void main(){ vW = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position.z = gl_Position.w * 0.99999; }`;
const SKY_FRAG = `uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uLow; varying vec3 vW;
  void main(){ float h = vW.y; vec3 c = h > 0.18 ? mix(uMid, uTop, smoothstep(0.18, 0.75, h)) : mix(uLow, uMid, smoothstep(-0.05, 0.18, h)); gl_FragColor = vec4(c, 1.); }`;

/* ------------------------------------------------------------------ helpers */
/** 1 модель, 2 модели, 5 моделей. */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 10, b = n % 100;
  return `${n} ${a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many}`;
}
const PORTAL_VERT = `attribute vec3 color; varying vec2 vUv; varying vec3 vC; void main(){ vUv = uv; vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const PORTAL_FRAG = `uniform float uT; varying vec2 vUv; varying vec3 vC;
  void main(){
    vec2 p = (vUv - vec2(0.5, 0.0)) * vec2(1.64, 2.6);
    float d = p.y < 1.74 ? abs(p.x) - 0.82 : length(p - vec2(0.0, 1.74)) - 0.82;
    if (d > 0.0) discard;
    vec2 c = p - vec2(0.0, 1.15);
    float r = length(c), a = atan(c.y, c.x);
    float sw = 0.5 + 0.5 * sin(a * 3.0 + r * 7.0 - uT * 2.2);
    float rim = smoothstep(-0.16, 0.0, d);
    vec3 deep = vC * vec3(0.18, 0.12, 0.3);
    vec3 col = mix(deep, vC * 1.25, sw * (1.0 - min(1.0, r * 0.5))) + vC * rim * 1.1 + vec3(1.0) * pow(max(0.0, 1.0 - r * 1.6), 3.0) * 0.45;
    gl_FragColor = vec4(col, 0.92);
  }`;
function signTexture(title: string, sub: string, icon = ''): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 768; c.height = 192;
  const g = c.getContext('2d');
  if (g) {
    const r = 34;
    g.beginPath(); g.moveTo(r, 6); g.arcTo(762, 6, 762, 186, r); g.arcTo(762, 186, 6, 186, r); g.arcTo(6, 186, 6, 6, r); g.arcTo(6, 6, 762, 6, r); g.closePath();
    const gr = g.createLinearGradient(0, 0, 0, 192); gr.addColorStop(0, '#3a2a4a'); gr.addColorStop(1, '#241a30');
    g.fillStyle = gr; g.fill(); g.lineWidth = 8; g.strokeStyle = '#ffcf6a'; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = "800 64px 'Comfortaa','Nunito','Segoe UI',sans-serif"; g.fillStyle = '#ffe9b8';
    g.fillText((icon ? icon + ' ' : '') + title, 384, sub ? 74 : 96, 720);
    if (sub) { g.font = "700 34px 'Nunito','Segoe UI',sans-serif"; g.fillStyle = '#d8c4e8'; g.fillText(sub, 384, 142, 720); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

interface Section {
  id: string; title: string; icon: string; side: 'n' | 's'; x0: number; x1: number;
  group: THREE.Group | null;
  build(): THREE.Group;
  update?(dt: number, t: number, px: number, pz: number): void;
}

export class TestDimension implements RoomScene {
  readonly root = new THREE.Group();
  readonly spawn = { ...SPAWN };
  readonly colliders: THREE.Object3D[] = [];
  private sections: Section[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private texs: THREE.Texture[] = [];
  private offs: Unsub[] = [];
  private avatars: Avatar[] = [];
  private npcs: Npc[] = [];
  private sky: THREE.Mesh; private skyMat: THREE.ShaderMaterial;
  private starPts: THREE.Points;
  private sun = new THREE.DirectionalLight('#ffffff', 1);
  private hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1);
  private lampLight: THREE.PointLight[] = [];
  private lampGlow: THREE.MeshBasicMaterial;
  /** Hours 0..24 (12 = noon). Animated towards `todTarget` (smooth switch). */
  tod = 18.5; todTarget = 18.5;
  fogColor = new THREE.Color();
  private x1 = 60;
  active = true;
  /** Counters for the debug panel and tests. */
  readonly stats = { built: 0, sections: 0, items: 0, looks: 0, foes: 0, npcs: 0, portals: 0, bakedFrom: 0, bakedTo: 0 };

  constructor(private host: DimensionHost) {
    this.root.name = 'debug:dimension';
    /* ---- sky + lights ---- */
    this.skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uLow: { value: new THREE.Color() } } });
    this.mats.push(this.skyMat);
    const sg = new THREE.SphereGeometry(300, 24, 12); this.geos.push(sg);
    this.sky = new THREE.Mesh(sg, this.skyMat); this.sky.name = 'debug:sky'; this.sky.frustumCulled = false; this.sky.renderOrder = -10;
    const dot = dotTexture(); this.texs.push(dot);
    this.starPts = stars(700, dot); this.starPts.name = 'debug:stars';
    this.geos.push(this.starPts.geometry); this.mats.push(this.starPts.material as THREE.Material);
    this.root.add(this.sky, this.starPts, this.hemi, this.sun, this.sun.target);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -22, right: 22, top: 16, bottom: -16, near: 1, far: 90 });
    this.sun.shadow.bias = -0.0006;

    /* ---- sections (laid out first: the avenue length depends on them) ---- */
    this.layout();
    /* ---- floor, avenue dressing ---- */
    const L = this.x1 + 40, cx = (this.x1 - 16) / 2;
    const rep = (t: THREE.Texture | undefined, rx: number, ry: number): THREE.Texture | null => {
      if (!t) return null; const c = this.own(t.clone()); c.needsUpdate = true; c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(rx, ry); return c;
    };
    // meadow all around, a cobbled plaza band under the exhibits, a warm paved avenue in the middle
    const grass = getTexture('grass');
    const gm = this.own(new THREE.MeshStandardMaterial({ map: rep(grass.map, L / 4, 120 / 4), color: '#7f9a72', roughness: 1 }));
    const gg = this.own(new THREE.PlaneGeometry(L + 120, 160).rotateX(-Math.PI / 2));
    const meadow = new THREE.Mesh(gg, gm); meadow.position.set(cx, -0.01, 2); meadow.receiveShadow = true; meadow.name = 'debug:meadow';
    const stone = getTexture('stone'), cob = getTexture('cobble');
    const fm = this.own(new THREE.MeshStandardMaterial({ map: rep(cob.map, L / 1.1, 22 / 1.1), normalMap: rep(cob.normalMap, L / 1.1, 22 / 1.1), color: '#9c94b0', roughness: 0.9 }));
    const fg = this.own(new THREE.PlaneGeometry(L, 22).rotateX(-Math.PI / 2));
    const floor = new THREE.Mesh(fg, fm); floor.position.set(cx, 0, (AVE.z0 + AVE.z1) / 2); floor.receiveShadow = true; floor.name = 'debug:floor';
    const am = this.own(new THREE.MeshStandardMaterial({ map: rep(stone.map, L / 2.0, (AVE.z1 - AVE.z0) / 2.0), normalMap: rep(stone.normalMap, L / 2.0, (AVE.z1 - AVE.z0) / 2.0), color: '#f4e6d2', roughness: 0.85 }));
    const ag = this.own(new THREE.PlaneGeometry(L - 8, AVE.z1 - AVE.z0).rotateX(-Math.PI / 2));
    const ave = new THREE.Mesh(ag, am); ave.position.set(cx + 2, 0.005, (AVE.z0 + AVE.z1) / 2); ave.receiveShadow = true; ave.name = 'debug:avenue';
    this.root.add(meadow, floor, ave);
    // kerbs
    const sm = this.own(new THREE.MeshStandardMaterial({ color: '#b39a86', roughness: 0.85 }));
    const kg = this.own(new THREE.BoxGeometry(L - 8, 0.08, 0.22));
    for (const z of [AVE.z0 - 0.15, AVE.z1 + 0.15]) { const k = new THREE.Mesh(kg, sm); k.position.set(cx + 2, 0.04, z); k.receiveShadow = true; this.root.add(k); }
    // lamps in the gaps between the sections (never in front of an exhibit)
    const lamps: { x: number; y: number; z: number }[] = [];
    for (const side of ['n', 's'] as const) {
      const list = this.sections.filter((q) => q.side === side).sort((a, b) => a.x0 - b.x0);
      for (let i = 0; i < list.length; i++) {
        const gap = i + 1 < list.length ? (list[i].x1 + list[i + 1].x0) / 2 : list[i].x1 + 0.8;
        const lz = side === 'n' ? AVE.z0 - 5.2 : AVE.z1 + 0.45;
        lamps.push({ x: gap, y: 0, z: lz });
        if (i === 0) lamps.push({ x: list[0].x0 - 0.8, y: 0, z: lz });
      }
    }
    try { this.root.add(PropKit.instanced('lamp', lamps)); } catch { /* */ }
    try { this.root.add(PropKit.instanced('fountain', [{ x: HUB.fx, y: 0, z: HUB.fz }])); } catch { /* */ }
    const trees: { x: number; y: number; z: number; scale: number; rotY: number }[] = [];
    const bushes: { x: number; y: number; z: number; scale: number }[] = [];
    for (let x = -22; x <= this.x1 + 10; x += 6.4) {
      const j = Math.abs(Math.sin(x * 12.9898) * 43758.5453) % 1;
      trees.push({ x, y: 0, z: -10.5 - j * 3, scale: 1 + j * 0.5, rotY: x }); trees.push({ x: x + 2, y: 0, z: 15 + j * 3, scale: 1.1 + j * 0.4, rotY: -x });
      if (j > 0.35) bushes.push({ x: x + 1, y: 0, z: -8.4 - j, scale: 0.9 + j * 0.4 }); if (j < 0.65) bushes.push({ x: x + 3, y: 0, z: 13 + j, scale: 0.9 + j * 0.3 });
    }
    try { this.root.add(PropKit.instanced('tree', trees.filter((_, i) => i % 3 !== 2), { variant: 1 })); this.root.add(PropKit.instanced('tree', trees.filter((_, i) => i % 3 === 2), { variant: 2 })); } catch { /* */ }
    try { this.root.add(PropKit.instanced('bush', bushes)); } catch { /* */ }
    try { this.root.add(PropKit.instanced('bench', [{ x: HUB.fx - 3.2, y: 0, z: HUB.fz, rotY: Math.PI / 2 }, { x: HUB.fx + 3.2, y: 0, z: HUB.fz, rotY: -Math.PI / 2 }])); } catch { /* */ }
    // lamp heads glow at night: one point light per few lamps near the hub (cheap), emissive balls on all
    this.lampGlow = new THREE.MeshBasicMaterial({ color: '#ffcf6a', transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mats.push(this.lampGlow);
    const glowG = new THREE.SphereGeometry(0.32, 10, 8); this.geos.push(glowG);
    const glow = new THREE.InstancedMesh(glowG, this.lampGlow, lamps.length); glow.name = 'debug:lampglow';
    const _m = new THREE.Matrix4();
    const head = PropKit.lampHeadOffset;
    lamps.forEach((l, i) => glow.setMatrixAt(i, _m.makeTranslation(l.x + head.x, head.y, l.z + head.z)));
    this.root.add(glow);
    for (let i = 0; i < 2; i++) { const p = new THREE.PointLight('#ffc27a', 0, 10, 1.6); p.position.set(HUB.fx + (i ? 3 : -3), 2.8, HUB.fz + (i ? 3.8 : -3.8)); this.lampLight.push(p); this.root.add(p); }
    // the hub's big sign
    this.sign('Тестовое измерение', 'режим отладки · ничего не уходит на сайт', '🐞', -15.4, 2.6, 2.2, Math.PI / 2, 4.2);
    this.applyTod(true);
  }

  /* -------------------------------------------------------------- layout of the sections */
  private layout(): void {
    const keys = SUPPORTED_ITEM_MODEL_KEYS;
    const fam = (p: string) => keys.filter((k) => k.startsWith(p));
    const itemGroups: [string, string, string[], number][] = [
      ['items-weapon', 'Оружие', fam('weapon:'), 0.55], ['items-armor', 'Щиты и доспехи', [...fam('shield:'), ...fam('armor:')], 0.6],
      ['items-hat', 'Шапки и шлемы', fam('hat:'), 0.34], ['items-charm', 'Амулеты', fam('charm:'), 0.3],
      ['items-food', 'Еда', fam('food:'), 0.3], ['items-slot', 'Зелья, свитки и прочее', [...fam('slot:'), ...keys.filter((k) => k === '*')], 0.34],
    ];
    let xn = -0.5;
    for (const [id, title, list, size] of itemGroups) {
      const pitch = size > 0.5 ? 0.82 : 0.62, cols = Math.ceil(list.length / 3), w = cols * pitch + 0.5;
      const x0 = xn; xn += w + 1.4;
      this.sections.push({ id, title, icon: '🗡', side: 'n', x0, x1: x0 + w, group: null, build: () => this.buildItems(title, list, size, pitch, x0, w) });
    }
    xn += 1.5;
    const looks = this.lookLists();
    for (const [id, title, list] of looks) {
      const pitch = 1.05, cols = Math.ceil(list.length / 2), w = cols * pitch + 0.6;
      const x0 = xn; xn += w + 1.6;
      this.sections.push({ id, title, icon: '🐱', side: 'n', x0, x1: x0 + w, group: null, build: () => this.buildLooks(title, list, pitch, x0, w), update: (dt, t) => this.tickAvatars(id, dt, t) });
    }
    let xs = -15;
    const portals = { id: 'portals', title: 'Порталы', icon: '🌀', side: 's' as const, x0: xs, x1: xs, group: null as THREE.Group | null, build: () => this.buildPortals(-15) };
    const np = Math.max(1, this.host.portals().length); portals.x1 = xs + np * 2.9; xs = portals.x1 + 1.6;
    this.sections.push(portals);
    const nt = Math.max(1, this.host.totems().length);
    const tx0 = xs; xs += nt * 1.7 + 1.6;
    this.sections.push({ id: 'events', title: 'События', icon: '🎉', side: 's', x0: tx0, x1: tx0 + nt * 1.7, group: null, build: () => this.buildTotems(tx0) });
    const foeList = this.foeList();
    const fx0 = xs, fw = Math.ceil(foeList.length / 2) * 2.0 + 1.0; xs += fw + 1.6;
    this.sections.push({ id: 'foes', title: 'Враги походов', icon: '👹', side: 's', x0: fx0, x1: fx0 + fw, group: null, build: () => this.buildFoes(foeList, fx0, fw) });
    const nx0 = xs, nw = NPCS.length * 1.6 + 8.5; xs += nw + 1.6;
    this.sections.push({ id: 'npcs', title: 'Жители', icon: '🧑‍🍳', side: 's', x0: nx0, x1: nx0 + nw, group: null, build: () => this.buildNpcs(nx0), update: (dt, t, px, pz) => { for (const n of this.npcs) n.update(dt, t, px, pz); } });
    this.x1 = Math.max(xn, xs) + 2;
    this.stats.sections = this.sections.length;
  }

  /** Sections for the panel (teleport buttons). */
  sectionList(): SectionInfo[] {
    return this.sections.map((s) => ({ id: s.id, title: s.title, icon: s.icon, side: s.side, x: Math.min(this.x1 - 1, Math.max(-14, (s.x0 + s.x1) / 2)) }));
  }
  /** Where to stand to look at section `id` (room metres + facing). */
  standAt(id: string): { x: number; z: number; face: number } | null {
    const s = this.sections.find((q) => q.id === id); if (!s) return null;
    const x = (s.x0 + s.x1) / 2;
    return s.side === 'n' ? { x, z: AVE.z0 + 1.7, face: 0 } : { x, z: AVE.z1 - 1.7, face: Math.PI };
  }

  /* -------------------------------------------------------------- RoomScene */
  free(x: number, z: number): boolean {
    if (x < -15 || x > this.x1 || z < AVE.z0 || z > AVE.z1) return false;
    const dx = x - HUB.fx, dz = z - HUB.fz;
    return dx * dx + dz * dz > HUB.r * HUB.r;
  }
  groundAt(): number { return 0; }
  solidTop(): number { return -Infinity; }

  update(dt: number, t: number, camera: THREE.Camera): void {
    const p = this.host.player();
    // lazy sections: build at most one per frame when within 20 m, show within 30 m
    let built = false;
    for (const s of this.sections) {
      const d = p.x < s.x0 ? s.x0 - p.x : p.x > s.x1 ? p.x - s.x1 : 0;
      if (!s.group && !built && d < 18) {
        try { s.group = s.build(); this.root.add(s.group); this.stats.built++; } catch (e) { console.error('[l3d] debug section', s.id, e); s.group = new THREE.Group(); }
        built = true;
      }
      if (s.group) {
        s.group.visible = d < 24;
        if (s.group.visible && s.update) s.update(dt, t, p.x, p.z);
      }
    }
    // time of day: smooth towards the target (≈ 2 s for a 6 h jump)
    if (this.tod !== this.todTarget) {
      let d = this.todTarget - this.tod; if (d > 12) d -= 24; if (d < -12) d += 24;
      const step = Math.sign(d) * Math.min(Math.abs(d), dt * 3.2);
      this.tod = (this.tod + step + 24) % 24;
      if (Math.abs(d) < 1e-3) this.tod = this.todTarget;
      this.applyTod(false);
    }
    // sky and shadow follow the camera / player
    this.sky.position.copy(camera.position); this.starPts.position.copy(camera.position);
    (this.starPts.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    if (this.portalMat && !this.reduced) this.portalMat.uniforms.uT.value = t;
    this.sun.target.position.set(p.x, 0, 2);
    const el = Math.max(0.12, Math.sin(((this.tod - 6) / 12) * Math.PI));
    this.sun.position.set(p.x - 18 * Math.cos(((this.tod - 6) / 12) * Math.PI), 6 + 34 * el, 2 + 22);
    this.sun.castShadow = this.host.quality() >= 2;
  }

  /** Jump to an hour (instant = no smooth transition). */
  setTime(h: number, instant = false): void { this.todTarget = ((h % 24) + 24) % 24; if (instant) { this.tod = this.todTarget; this.applyTod(false); } }
  private applyTod(force: boolean): void {
    const h = this.tod;
    let i = 0; while (i < KEYS.length - 2 && h >= KEYS[i + 1][0]) i++;
    const [h0, a] = KEYS[i], [h1, b] = KEYS[i + 1], k = h1 > h0 ? Math.min(1, Math.max(0, (h - h0) / (h1 - h0))) : 0;
    const u = this.skyMat.uniforms;
    lerpCol(u.uTop.value, a.top, b.top, k); lerpCol(u.uMid.value, a.mid, b.mid, k); lerpCol(u.uLow.value, a.low, b.low, k);
    lerpCol(this.sun.color, a.sun, b.sun, k); this.sun.intensity = a.sunI + (b.sunI - a.sunI) * k;
    lerpCol(this.hemi.color, a.sky, b.sky, k); lerpCol(this.hemi.groundColor, a.gnd, b.gnd, k); this.hemi.intensity = a.hemiI + (b.hemiI - a.hemiI) * k;
    const st = a.stars + (b.stars - a.stars) * k;
    this.starPts.visible = st > 0.02;
    const lamps = a.lamps + (b.lamps - a.lamps) * k;
    this.lampGlow.opacity = 0.75 * lamps;
    for (const l of this.lampLight) l.intensity = 9 * lamps;
    this.fogColor.copy(u.uLow.value).lerp(u.uMid.value, 0.35);
    void force;
  }
  /** Fog / background the controller applies to ctx.scene while the dimension is shown. */
  get fogNear(): number { return 28; }
  get fogFar(): number { return 120; }

  dispose(): void {
    for (const o of this.offs) { try { o(); } catch { /* */ } } this.offs = [];
    for (const a of this.avatars) { try { a.dispose(); } catch { /* */ } } this.avatars = [];
    for (const n of this.npcs) { try { n.dispose(); } catch { /* */ } } this.npcs = [];
    this.root.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
    for (const g of this.geos) g.dispose(); this.geos = [];
    for (const m of this.mats) m.dispose(); this.mats = [];
    for (const t of this.texs) t.dispose(); this.texs = [];
    this.root.removeFromParent();
    this.sections.length = 0;
  }

  /* -------------------------------------------------------------- building blocks */
  private own<T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(x: T): T {
    if ((x as THREE.BufferGeometry).isBufferGeometry) this.geos.push(x as THREE.BufferGeometry);
    else if ((x as THREE.Texture).isTexture) this.texs.push(x as THREE.Texture);
    else this.mats.push(x as THREE.Material);
    return x;
  }
  private sign(title: string, sub: string, icon: string, x: number, y: number, z: number, ry: number, w = 2.6, parent: THREE.Object3D = this.root): THREE.Mesh {
    const tex = this.own(signTexture(title, sub, icon));
    const m = new THREE.Mesh(this.own(new THREE.PlaneGeometry(w, w / 4)), this.own(new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false })));
    m.position.set(x, y, z); m.rotation.y = ry; m.name = 'debug:sign';
    parent.add(m);
    return m;
  }
  /** Every interactable this dimension registered (debug / tests). */
  readonly hitList: Interactable[] = [];
  private add(i: Interactable): void {
    const en = i.enabled;
    this.hitList.push(i);
    this.offs.push(this.host.interact.add({ ...i, enabled: () => this.active && (!en || en()) }));
  }
  private wood(): THREE.MeshStandardMaterial {
    const w = getTexture('wood');
    const map = this.own(w.map.clone()); map.needsUpdate = true; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(3, 0.5);
    return this.own(new THREE.MeshStandardMaterial({ map, color: '#a0644a', roughness: 0.75 }));
  }

  /* ---- items ---- */
  private buildItems(title: string, list: string[], size: number, pitch: number, x0: number, w: number): THREE.Group {
    const raw = new THREE.Group();
    const standMat = this.wood();
    const cloth = this.own(new THREE.MeshStandardMaterial({ color: '#5a1f3e', roughness: 0.95 }));
    const trim = this.own(new THREE.MeshStandardMaterial({ color: '#e8b923', roughness: 0.35, metalness: 0.6 }));
    const plinth = this.own(new THREE.CylinderGeometry(0.15, 0.17, 0.06, 18));
    const plinthM = this.own(new THREE.MeshStandardMaterial({ color: '#2d2240', roughness: 0.6 }));
    const TD = 0.62, zf = AVE.z0 - 0.55;
    const rows: string[][] = [[], [], []];
    list.forEach((k, i) => rows[i % 3].push(k));
    const hits: { key: string; rarity: string; box: THREE.Box3; meshes: number; tris: number }[] = [];
    rows.forEach((row, r) => {
      const h = 0.42 + r * 0.34, z = zf - r * TD;
      const box = (bw: number, bh: number, bd: number, x: number, y: number, zz: number, m: THREE.Material) => { const o = new THREE.Mesh(this.own(new THREE.BoxGeometry(bw, bh, bd)), m); o.position.set(x, y, zz); raw.add(o); };
      box(w, h, TD, x0 + w / 2, h / 2, z, standMat);
      box(w + 0.02, 0.012, TD + 0.02, x0 + w / 2, h + 0.006, z, cloth);
      box(w + 0.04, 0.035, 0.035, x0 + w / 2, h - 0.01, z + TD / 2 + 0.01, trim);
      row.forEach((key, i) => {
        const x = x0 + 0.25 + pitch / 2 + i * pitch;
        const p = new THREE.Mesh(plinth, plinthM); p.position.set(x, h + 0.03, z + 0.02); raw.add(p);
        const rarity = RAR[1 + ((i + r * 2) % (RAR.length - 1))];
        const m = this.itemModel(key, rarity);
        const bb = new THREE.Box3().setFromObject(m), sz = bb.getSize(new THREE.Vector3());
        const k = size / Math.max(1e-3, sz.x, sz.y, sz.z); m.scale.setScalar(k);
        m.position.set(x, h + 0.06, z + 0.02);
        raw.add(m); m.updateMatrixWorld(true);
        let meshes = 0, tris = 0;
        m.traverse((o) => { const g = (o as THREE.Mesh).geometry; if ((o as THREE.Mesh).isMesh && g) { meshes++; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
        const wb = new THREE.Box3().setFromObject(m).expandByScalar(0.05);
        hits.push({ key, rarity, box: wb, meshes, tris: Math.round(tris) });
      });
    });
    const back = new THREE.Mesh(this.own(new THREE.BoxGeometry(w, 2.2, 0.08)), standMat); back.position.set(x0 + w / 2, 1.1, zf - 3 * TD - 0.1); raw.add(back);
    const baked = bakeStatic(raw, { name: 'debug:items:' + title });
    this.geos.push(...baked.geos);
    this.stats.bakedFrom += baked.before; this.stats.bakedTo += baked.calls; this.stats.items += hits.length;
    this.sign(title, `${plural(list.length, 'модель', 'модели', 'моделей')} · прицел + E — карточка`, '', x0 + w / 2, 2.55, zf - 3 * TD - 0.05, 0, Math.min(3.2, w), baked.group);
    for (const h of hits) {
      const [fam, id] = h.key.split(':');
      const info: CardInfo = { title: `${FAM_RU[fam] || fam}: ${id ?? 'подарок'}`, icon: fam === 'weapon' ? '🗡' : fam === 'hat' ? '🎩' : fam === 'food' ? '🍖' : '📦',
        rows: [['Ключ модели', h.key], ['Редкость (витрина)', RAR_RU[h.rarity] || h.rarity], ['Мешей в модели', String(h.meshes)], ['Треугольников', String(h.tris)], ['Размер', `${h.box.getSize(new THREE.Vector3()).toArray().map((v) => v.toFixed(2)).join(' × ')} м`]] };
      this.add({ id: 'debug:item:' + h.key, label: info.title, icon: info.icon, hit: h.box, reach: 4, proximity: false, use: () => this.host.card(info), alt: { label: 'Карточка', use: () => this.host.card(info) } });
    }
    return baked.group;
  }
  private itemModel(key: string, rarity: string): THREE.Object3D {
    const f = this.host.itemModels.get(key) || this.host.itemModels.get('*');
    const [fam, id] = key.split(':');
    if (f) {
      try {
        const slot = fam === 'hat' ? 'helmet' : fam === 'charm' ? 'trinket' : fam === 'slot' ? id : fam;
        const o = f(fam === 'slot' || fam === 'food' || fam === '*' ? {} : { [fam]: id }, { rarity, slot, id: fam === 'food' ? id : undefined });
        addRarityRing(o, rarity);
        return o;
      } catch (e) { console.warn('[l3d] debug item model', key, e); }
    }
    const g = new THREE.Group(); g.add(new THREE.Mesh(this.own(new THREE.BoxGeometry(0.2, 0.2, 0.2)), this.own(new THREE.MeshStandardMaterial({ color: '#e8455c' })))); return g;
  }

  /* ---- looks on mannequins ---- */
  private lookLists(): [string, string, { what: string; lk: Record<string, unknown>; g?: Record<string, unknown>; gh?: number; st?: string }[]][] {
    const shapes = CATALOG.shapes.map((s) => ({ what: 'Форма: ' + s, lk: { shape: s, eyes: 'big', mouth: 'open' } }));
    shapes.push({ what: 'Призрак (gh)', lk: { shape: 'bean' }, gh: 1 } as never);
    const hats = CATALOG.hats.filter((h) => h !== 'none').map((h, i) => ({ what: 'Шапка: ' + h, lk: { hat: h, shape: CATALOG.shapes[i % CATALOG.shapes.length], color: CATALOG.colors[i % CATALOG.colors.length] } }));
    const acc = CATALOG.acc.map((a, i) => ({ what: 'Аксессуар: ' + a, lk: { acc: [a], color: CATALOG.colors[(i + 3) % CATALOG.colors.length] } }));
    const auras = CATALOG.auras.map((a, i) => ({ what: 'Аура: ' + a, lk: { aura: a, shape: CATALOG.shapes[(i + 2) % CATALOG.shapes.length] } }));
    const eyes = [...CATALOG.eyes.map((e) => ({ what: 'Глаза: ' + e, lk: { eyes: e } })), ...CATALOG.mouths.map((m) => ({ what: 'Рот: ' + m, lk: { mouth: m, eyes: 'happy' } }))];
    const sets = SETS.map(([what, lk, g]) => ({ what, lk, g }));
    // «Чертики» (site style cherts): every form + ghost, cape, the imp-drawn hats, gear; horns/tails vary by login
    const ch = [...CATALOG.shapes.map((s) => ({ what: 'Чертик: ' + s, lk: { shape: s }, st: 'cherts' })),
      { what: 'Чертик: призрак', lk: { shape: 'bean' }, gh: 1, st: 'cherts' }, { what: 'Чертик: плащ', lk: { shape: 'tall', acc: ['cape'] }, st: 'cherts' },
      ...['tophat', 'wizard', 'antenna', 'bandana', 'horns', 'tuft'].map((h, i) => ({ what: 'Чертик: ' + h, lk: { hat: h, shape: CATALOG.shapes[i % 7] }, st: 'cherts' })),
      { what: 'Чертик: снаряжение', lk: { shape: 'box' }, g: { w: 'pitchfork', s: 'buckler', a: 'lorica', am: 'heavy' }, st: 'cherts' }];
    return [['looks-shape', 'Формы тела', shapes], ['looks-hat', 'Шапки', hats], ['looks-acc', 'Аксессуары', acc], ['looks-aura', 'Ауры', auras], ['looks-face', 'Глаза и рот', eyes], ['looks-set', 'Классы и снаряжение', sets], ['looks-cherts', 'Чертики', ch]];
  }
  private avatarSets = new Map<string, { av: Avatar; acc: number; x: number; z: number; lod: number }[]>();
  private buildLooks(title: string, list: { what: string; lk: Record<string, unknown>; g?: Record<string, unknown>; gh?: number; st?: string }[], pitch: number, x0: number, w: number): THREE.Group {
    const g = new THREE.Group(); g.name = 'debug:looks:' + title;
    const stand = this.wood();
    const zf = AVE.z0 - 0.75;
    const st1 = new THREE.Mesh(this.own(new THREE.BoxGeometry(w, 0.18, 1.0)), stand); st1.position.set(x0 + w / 2, 0.09, zf); st1.receiveShadow = true;
    const st2 = new THREE.Mesh(this.own(new THREE.BoxGeometry(w, 0.55, 0.9)), stand); st2.position.set(x0 + w / 2, 0.275, zf - 1.3); st2.receiveShadow = true;
    g.add(st1, st2);
    const per = Math.ceil(list.length / 2);
    const id = this.sections.find((s) => s.title === title)?.id || title;
    const arr: { av: Avatar; acc: number; x: number; z: number; lod: number }[] = [];
    list.forEach((it, i) => {
      const back = i >= per, j = back ? i - per : i;
      const login = 'demo_look_' + id + '_' + i;
      const app = appearanceFrom(login, { l: login, n: it.what, lv: 5, lk: it.lk, g: it.g || {}, gh: it.gh || 0 }, it.st || 'cats');
      const av = this.host.kit.create(app);
      const x = x0 + 0.3 + pitch / 2 + j * pitch + (back ? pitch / 2 : 0), y = back ? 0.55 : 0.18, z = back ? zf - 1.3 : zf;
      av.root.position.set(x, y, z); av.root.rotation.y = Math.PI;
      av.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      av.update(0.016, i * 0.37, 0);
      g.add(av.root); this.avatars.push(av); arr.push({ av, acc: i * 0.03, x, z, lod: 0 });
      const box = new THREE.Box3(new THREE.Vector3(x - 0.35, y, z - 0.35), new THREE.Vector3(x + 0.35, y + (av.headTop || 1.3) + 0.25, z + 0.35));
      const info: CardInfo = { title: it.what, icon: '🐱', rows: [['Облик (lk)', JSON.stringify(it.lk)], ...(it.g ? [['Снаряжение (g)', JSON.stringify(it.g)] as [string, string]] : []), ...(it.gh ? [['Призрак', 'gh = 1'] as [string, string]] : [])] };
      this.add({ id: 'debug:look:' + login, label: it.what, icon: '🐱', hit: box, reach: 3.6, proximity: false, use: () => this.host.card(info), alt: { label: 'Карточка', use: () => this.host.card(info) } });
    });
    this.avatarSets.set(id, arr);
    this.stats.looks += list.length;
    this.sign(title, `${plural(list.length, 'облик', 'облика', 'обликов')} · прицел + E — подробности`, '', x0 + w / 2, 2.35, zf - 1.9, 0, Math.min(3.2, w), g);
    return g;
  }
  private tickAvatars(id: string, dt: number, t: number): void {
    const arr = this.avatarSets.get(id); if (!arr) return;
    const p = this.host.player();
    for (const a of arr) {
      const d = Math.abs(a.x - p.x) + Math.abs(a.z - p.z) * 0.5;
      const lod = d < 7 ? 0 : d < 14 ? 1 : 2;
      if (lod !== a.lod) { a.lod = lod; a.av.setLod(lod as 0 | 1 | 2); }
      if (lod < 2) a.av.update(dt, t + a.acc, 0);
    }
  }

  /* ---- foes ---- */
  private foeList(): { key: string; title: string; art: string; boss?: number; lead?: boolean }[] {
    const out: { key: string; title: string; art: string; boss?: number; lead?: boolean }[] = FOE_ARTS.map((a) => ({ key: a, title: FOE_RU[a] || a, art: a }));
    BOSS_PAL.forEach((_, i) => out.push({ key: 'boss:' + i, title: ['Болотный босс', 'Огненный босс', 'Ледяной босс', 'Теневой босс'][i] || 'Босс', art: 'boss', boss: i }));
    for (const k of HW_KEYS) { const lead = k === 'hw_pumpkin'; out.push({ key: k, title: k + ' → ' + foeArtOf(k, '', false), art: foeArtOf(k, '', false) }); if (lead) out.push({ key: k + ' (вожак)', title: 'hw_pumpkin вожак → golem', art: 'golem', lead: true }); }
    return out;
  }
  private buildFoes(list: { key: string; title: string; art: string; boss?: number }[], x0: number, w: number): THREE.Group {
    const raw = new THREE.Group();
    const mat = this.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
    const pl = this.own(new THREE.CylinderGeometry(0.55, 0.6, 0.12, 20)), plM = this.own(new THREE.MeshStandardMaterial({ color: '#3a2c48', roughness: 0.7 }));
    const zf = AVE.z1 + 1.2, per = Math.ceil(list.length / 2);
    list.forEach((f, i) => {
      const back = i >= per, j = back ? i - per : i;
      const x = x0 + 1.0 + j * 2.0 + (back ? 1.0 : 0), z = back ? zf + 2.1 : zf;
      const fly = f.boss != null ? 0 : (FOE_FLY[f.art as keyof typeof FOE_FLY] || 0);
      if (fly < 0.5) { const p = new THREE.Mesh(pl, plM); p.position.set(x, 0.06, z); raw.add(p); }
      let geo: THREE.BufferGeometry;
      try { geo = (f.boss != null ? bossGeo(f.boss) : foeGeo(f.art as never)).clone(); } catch { geo = new THREE.BoxGeometry(0.5, 0.5, 0.5); }
      this.own(geo);
      const m = new THREE.Mesh(geo, mat);
      const s = f.boss != null ? 0.75 : 1;
      m.scale.setScalar(s); m.position.set(x, 0.12 - fly * 0.55, z);   // the art faces −Z: towards the avenue
      raw.add(m);
      const top = f.boss != null ? 1.9 * s : 1.8;
      const info: CardInfo = { title: f.title, icon: '👹', rows: [['Тип (сайт)', f.key], ['Модель', f.art + (f.boss != null ? ' · палитра ' + f.boss : '')], ['Треугольников', String(Math.round((geo.index ? geo.index.count : geo.attributes.position.count) / 3))]] };
      this.add({ id: 'debug:foe:' + f.key, label: 'Враг: ' + f.title, icon: '👹', hit: new THREE.Box3(new THREE.Vector3(x - 0.6, 0, z - 0.6), new THREE.Vector3(x + 0.6, top, z + 0.6)), reach: 4, proximity: false, use: () => this.host.card(info), alt: { label: 'Карточка', use: () => this.host.card(info) } });
    });
    const baked = bakeStatic(raw, { name: 'debug:foes' });
    this.geos.push(...baked.geos);
    this.stats.bakedFrom += baked.before; this.stats.bakedTo += baked.calls; this.stats.foes += list.length;
    this.sign('Враги походов', `${plural(list.length, 'модель', 'модели', 'моделей')} · звери, боссы, Изнанка (hw_*)`, '👹', x0 + w / 2, 2.9, zf + 2.8, Math.PI, Math.min(3.6, w), baked.group);
    return baked.group;
  }

  /* ---- NPCs ---- */
  private buildNpcs(x0: number): THREE.Group {
    const g = new THREE.Group(); g.name = 'debug:npcs';
    const zf = AVE.z1 + 1.2;
    NPCS.forEach((d, i) => {
      const x = x0 + 0.8 + i * 1.6;
      const npc = new Npc({ ...d, x, z: zf, face: Math.PI }, 'cats', () => this.host.heroName());
      g.add(npc.root); this.npcs.push(npc);
      const info: CardInfo = { title: d.name, icon: '🧑‍🍳', rows: [['Где живёт', d.where], ['Облик', JSON.stringify(d.look || {})]] };
      this.add({ id: 'debug:npc:' + d.seed, label: 'Житель: ' + d.name + ' (' + d.where + ')', icon: '💬', hit: new THREE.Box3(new THREE.Vector3(x - 0.4, 0, zf - 0.4), new THREE.Vector3(x + 0.4, 1.6, zf + 0.4)), reach: 3.6,
        use: () => npc.say(d.hello?.[0] || 'Мяу!', performance.now() / 1000), alt: { label: 'Карточка', use: () => this.host.card(info) } });
    });
    // the Halloween NPCs: the site's art as our models (src/events/halloween/npcgeo.ts), placed here facing the avenue
    const parts = new Parts();
    const hx0 = x0 + NPCS.length * 1.6 + 1.2;
    const spots: [string, number][] = [['hwshop', hx0 + 1.6], ['hwpass', hx0 + 5.4]];
    for (const [id, X] of spots) {
      try {
        const w = npcWorld(tablePlace({ id: id as never, x: 0, y: 1000 }));
        const p = new Parts();
        (id === 'hwshop' ? stupaGeometry : passGeometry)(p, w, 0);
        const geo = p.build();
        geo.translate(-w.x, 0, -w.z); geo.rotateY(Math.PI); geo.translate(X, 0, zf + 1.0);
        parts.add(geo, '#ffffff', undefined, 0, keepColours);
        const info: CardInfo = { title: w.title, icon: w.icon, rows: [['Событие', 'Ночь Тыквенной Луны (hwnpc.js)'], ['id', id], ['Модель', 'src/events/halloween/npcgeo.ts']] };
        this.add({ id: 'debug:hwnpc:' + id, label: 'Хэллоуин: ' + w.title, icon: w.icon, hit: new THREE.Box3(new THREE.Vector3(X - 1.4, 0, zf), new THREE.Vector3(X + 1.4, 2.6, zf + 2)), reach: 4, use: () => this.host.card(info), alt: { label: 'Карточка', use: () => this.host.card(info) } });
      } catch (e) { console.warn('[l3d] debug hw npc', id, e); }
    }
    if (!parts.empty) {
      const geo = this.own(parts.build());
      const m = new THREE.Mesh(geo, this.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 })));
      m.castShadow = true; m.name = 'debug:hwnpcs'; g.add(m);
    }
    this.stats.npcs = NPCS.length + 2;
    this.sign('Жители города', 'продавцы, мастера и гости Хэллоуина', '🧑‍🍳', x0 + (NPCS.length * 1.6) / 2 + 2, 2.7, zf + 1.6, Math.PI, 3.6, g);
    return g;
  }

  /* ---- portals ---- */
  private buildPortals(x0: number): THREE.Group {
    const g = new THREE.Group(); g.name = 'debug:portals';
    const list = this.host.portals();
    const arch = new Parts();
    const glows: THREE.BufferGeometry[] = [];
    const zf = AVE.z1 + 1.0;
    const _c = new THREE.Color();
    list.forEach((p, i) => {
      const x = x0 + 1.45 + i * 2.9;
      arch.add(new THREE.TorusGeometry(0.95, 0.14, 8, 24, Math.PI), '#d9b46a', new THREE.Matrix4().makeTranslation(x, 1.9, zf));
      for (const s2 of [-1, 1]) arch.add(new THREE.BoxGeometry(0.3, 1.95, 0.34), '#8a6a8a', new THREE.Matrix4().makeTranslation(x + s2 * 0.95, 0.97, zf));
      arch.add(new THREE.BoxGeometry(2.4, 0.16, 0.7), '#5a4a66', new THREE.Matrix4().makeTranslation(x, 0.08, zf));
      const gq = new THREE.PlaneGeometry(1.64, 2.6); gq.translate(0, 1.3, 0); gq.rotateY(Math.PI); gq.translate(x, 0.16, zf + 0.02);
      _c.set(p.off ? '#4a4658' : p.color);
      const n = gq.attributes.position.count, col = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) { col[k * 3] = _c.r; col[k * 3 + 1] = _c.g; col[k * 3 + 2] = _c.b; }
      gq.setAttribute('color', new THREE.BufferAttribute(col, 3));
      glows.push(gq);
      this.sign(p.title, p.off || p.sub || 'E — войти', p.icon, x, 3.25, zf - 0.05, Math.PI, 2.6, g);
      const hit = new THREE.Box3(new THREE.Vector3(x - 1.0, 0, zf - 0.6), new THREE.Vector3(x + 1.0, 2.8, zf + 0.4));
      this.add({ id: 'debug:portal:' + p.id, label: (p.off ? '' : 'Портал: ') + p.title + (p.off ? ' — ' + p.off : ''), icon: p.icon, hit, reach: 3.4, use: () => { if (!p.off) p.go(); } });
    });
    if (!arch.empty) {
      const am = new THREE.Mesh(this.own(arch.build()), this.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 })));
      am.castShadow = true; am.receiveShadow = true; g.add(am);
      const merged = this.own(mergeGeometries(glows, false) || new THREE.BufferGeometry());
      for (const q of glows) q.dispose();
      this.portalMat = this.own(new THREE.ShaderMaterial({ vertexShader: PORTAL_VERT, fragmentShader: PORTAL_FRAG, uniforms: { uT: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      const gm = new THREE.Mesh(merged, this.portalMat); gm.name = 'debug:portal-glow'; g.add(gm);
    }
    this.stats.portals = list.length;
    return g;
  }

  /* ---- event totems ---- */
  private totemGlow: { mesh: THREE.Mesh; t: TotemDef }[] = [];
  private portalMat: THREE.ShaderMaterial | null = null;
  private reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private buildTotems(x0: number): THREE.Group {
    const g = new THREE.Group(); g.name = 'debug:events';
    const list = this.host.totems();
    const zf = AVE.z1 + 0.9;
    const post = this.own(new THREE.CylinderGeometry(0.12, 0.16, 1.3, 10)), postM = this.own(new THREE.MeshStandardMaterial({ color: '#4a3a58', roughness: 0.6 }));
    const orb = this.own(new THREE.SphereGeometry(0.26, 16, 12));
    list.forEach((t, i) => {
      const x = x0 + 0.85 + i * 1.7;
      const p = new THREE.Mesh(post, postM); p.position.set(x, 0.65, zf); p.castShadow = true; g.add(p);
      const m = new THREE.Mesh(orb, this.own(new THREE.MeshStandardMaterial({ color: t.color, emissive: t.color, emissiveIntensity: 0.2, roughness: 0.3 })));
      m.position.set(x, 1.5, zf); g.add(m);
      this.totemGlow.push({ mesh: m, t });
      this.sign(t.title, '', t.icon, x, 2.15, zf, Math.PI, 1.6, g);
      this.add({ id: 'debug:totem:' + t.id, label: `${t.title}: ${t.on() ? 'вкл' : 'выкл'}`, icon: t.icon, hit: new THREE.Box3(new THREE.Vector3(x - 0.45, 0, zf - 0.45), new THREE.Vector3(x + 0.45, 1.9, zf + 0.45)), reach: 3.2,
        use: () => { t.toggle(); this.syncTotems(); } });
    });
    this.sign('События', 'праздники — в городе, после выхода · E — переключить', '🎉', x0 + (list.length * 1.7) / 2, 3.1, zf + 0.8, Math.PI, 3.4, g);
    this.syncTotems();
    return g;
  }
  syncTotems(): void {
    for (const { mesh, t } of this.totemGlow) (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = t.on() ? 2.2 : 0.15;
  }
}

/** Class sets (from the showcase line-up): [what, look, gear]. */
const SETS: [string, Record<string, unknown>, Record<string, unknown>][] = [
  ['Легионер', { shape: 'tall', hat: 'legion', color: '#ffc94d' }, { w: 'gladius', wr: 'legendary', s: 'scutum', sr: 'rare', a: 'lorica', ar: 'legendary', am: 'heavy' }],
  ['Паладин', { shape: 'box', color: '#f4f1ec', aura: 'gold' }, { w: 'holymace', wr: 'legendary', s: 'scutum', sr: 'legendary', a: 'plate', ar: 'legendary', h: 'phelm', hr: 'legendary' }],
  ['Маг', { shape: 'ball', hat: 'wizard', acc: ['cape'], aura: 'halo' }, { w: 'staff', wr: 'legendary', a: 'robe', ar: 'legendary', am: 'cloth' }],
  ['Жрец', { shape: 'egg', color: '#ff9fb2' }, { w: 'censer', wr: 'rare', a: 'robe', ar: 'rare', am: 'cloth' }],
  ['Лучник', { shape: 'egg', hat: 'bow', color: '#9fe39a' }, { w: 'bow', wr: 'epic', a: 'leather', ar: 'uncommon', am: 'light' }],
  ['Разбойник', { shape: 'bean', color: '#4a4350', acc: ['shades'] }, { w: 'kris', wr: 'epic', a: 'leather', ar: 'epic', h: 'rhood', hr: 'epic' }],
  ['Некромант', { shape: 'tall', color: '#9aa3ad', aura: 'shadow' }, { w: 'skullstaff', wr: 'epic', a: 'shroud', ar: 'epic', h: 'nhood', hr: 'rare' }],
  ['Новобранец', { shape: 'cone', eyes: 'cyclops', mouth: 'grin' }, { w: 'pitchfork', a: 'leather', ar: 'uncommon', am: 'light', h: 'miner', hr: 'common' }],
];

/** Shopkeepers and masters (their looks as in src/rooms/*). */
const NPCS: (Omit<NpcDef, 'x' | 'z' | 'face'> & { where: string })[] = [
  { seed: 'кузнец', name: 'Кузнец', where: 'Кузня', look: { shape: 'box', color: '#c9884a', hat: 'cap', acc: ['mustache'] }, gear: { w: 'hammer' }, hello: ['Заходи, {n}! Металл горячий.'] },
  { seed: 'звездочёт', name: 'Звездочёт', where: 'Лавка звездочёта', look: { hat: 'wizard', acc: ['glasses'], shape: 'ball', color: '#b9a2ff' }, hello: ['Звёзды говорят о тебе, {n}.'] },
  { seed: 'Лавочница', name: 'Лавочница', where: 'Торговые ряды', look: { hat: 'chef', shape: 'bean', color: '#ffb27a', acc: ['scarf'] }, hello: ['Свежие пирожки, {n}!'] },
  { seed: 'франт', name: 'Франт', where: 'Шатёр', look: { hat: 'tophat', shape: 'tall', color: '#ff9fb2', acc: ['bowtie', 'monocle'] }, hello: ['О, какой стиль, {n}!'] },
  { seed: 'Тренер', name: 'Тренер', where: 'Арена', look: { hat: 'bandana', shape: 'box', color: '#ff9a6a' }, gear: { w: 'gladius', s: 'round' }, hello: ['Раз-два, {n}, разминка!'] },
  { seed: 'Глашатай', name: 'Глашатай', where: 'Доска', look: { hat: 'beret', shape: 'egg', color: '#9fe39a', acc: ['scarf'] }, hello: ['Слушайте все, {n} пришёл!'] },
  { seed: 'Мастер-строитель', name: 'Мастер-строитель', where: 'Мастерская', look: { hat: 'cap', shape: 'box', color: '#c9884a', acc: ['glasses'] }, hello: ['Стройка кипит!'] },
  { seed: 'Аукционист', name: 'Аукционист', where: 'Аукцион', look: { hat: 'tophat', shape: 'tall', color: '#e6e6ee', acc: ['monocle', 'bowtie'] }, hello: ['Лот номер один!'] },
  { seed: 'Кладовщик', name: 'Кладовщик', where: 'Склад', look: { hat: 'cap', shape: 'ball', color: '#a8754f' }, hello: ['Всё на месте, {n}.'] },
  { seed: 'Страж ворот', name: 'Страж ворот', where: 'Ворота', look: { hat: 'legion', shape: 'box', color: '#5a5470' }, gear: { w: 'spear', s: 'scutum' }, hello: ['Стой! А, это ты, {n}.'] },
];
