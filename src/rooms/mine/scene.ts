/**
 * The 3D mine: a cave built from the floor grid (st.fl) — stones as faceted rock lumps with ore nuggets / glowing gem
 * crystals, wall rocks, timber frames, lanterns, glowing mushrooms by nature, the entrance area (lift «В ГОРОД», cart
 * on rails, board «ПОРУЧЕНИЯ», stall «СКУПКА», the lamp post of the supplier), the way down at the top.
 * Other miners: avatars (src/avatar) with miner helmets and pickaxes; diggers swing at their stones.
 *
 * Draw-call budget: static parts = one RoomKit batch (~10 calls, rebuilt only on a new floor); stones = 5 InstancedMesh
 * (hidden instances get scale 0 when dug), ore = 2 (+1 glow Points), mushrooms = 2, front halos = 1, badges ≤ ~20
 * sprites, bars = 2 InstancedMesh, avatars ≤ 40.
 * «Шахта 3.0» (big floor, geo3.ts / cave3.ts): the same stones for the front, rock mass / fog pillars in the same 5
 * InstancedMesh, a second static batch for the dug part (lanterns, halls, drills, shaft); badges ≤ 16 nearest, bars
 * within 14 m, ≤ 12 other miners within 24 m (q2).
 * Light: a low cool hemisphere + warm light POOLS (world/lightPools shader patch on every cave material, boosted for the
 * cave — poolBoost; we feed it the 16 candidates nearest to the view: lanterns (a pool centred under each, in the depth
 * layer's lamp colour), portal, lift, stalls, and every ore stone in its ore colour — no real lights) + 1–4 short real
 * lights that hop to the lanterns nearest to the player (quality-capped) + the helmet lamp (strong only on a dark
 * floor); the ambient share of the albedo is dimmed (dark between the pools) and the room host's fog is pulled in to a
 * depth fog in the layer's dark (FOG_NEAR … FOG_FAR).
 * Ground (q1+): faceted procedural floor with a walkable relief of ±RELIEF (rockface.ts; groundAt), dressed by
 * dress3.ts — flagstones, bedrock shelves, cracks, puddles that mirror the lanterns, a cart track, pits with planks,
 * scree, boulders, tools, crates — and a contact-shadow AO field over the whole floor (rebaked with the dug part).
 * Readability: diggable stones are lit up and get a gold floor halo + level badge, the others are dimmed; rock has
 * strata / crack vertex colours and the rock texture; in third person, rock right in front of the camera dissolves
 * (ordered dither, nearFade). Other miners are spread off the player / each other and fade near the camera.
 * Room space: see geo.ts (X = (x − 512)·K, Z = (y − 1956)·K, K = 2.4 m / cell; a big floor: geo3.ts, from the lift
 * hall's centre). Every px ⇄ metre mapping goes through this.G (the model's geometry). The root must stay at the origin.
 */
import * as THREE from 'three';
import { RoomKit, roomSurface } from '../common/kit';
import { paletteOf, type Pal } from '../../world/palette';
import { getTexture, type TexKind } from '../../world/tex';
import { PoolLights, POOL_N } from '../../world/lightPools';
import { glowTexture } from '../../world/textures';
import { glowPoints } from '../../world/sky';
import { createAvatarKit, createLabels, appearanceFrom, type LabelsEx } from '../../avatar';
import type { Avatar } from '../../contracts/modules';
import { GW, GH, N_CELLS, K, CW, SIDE, W, YB, Y0, H, FOOT, ZONE, mx, mz, px, py, cellXY, standable, digSpot, centerOf, hashL, type Rect } from './geo';
import { MineModel, stoneProgress, type Cell } from './state';
import { GEO1, type MineGeom } from './geo3';
import { buildCave3, buildDig3, slots3, CEIL3, type Slot3 } from './cave3';
import { hideOutline, showOutline } from '../../engine/outline';
import { rockFace, rockCeiling, rockFloor, strataOf, hashStr, channelOfBase, groundHeight, RELIEF, type FloorOpts } from './rockface';
import { timberPost, liftRig, crateStack, ropeCoil, dressCave, puddle, DAMP } from './props3';
import { chipGeo, sack, layerPiece, lantern3d, rubble, outcrop, stalagmite, toolPile, crateOrBarrel, stalactiteCluster, remains, slab, shelf, crack, railTrack, pitPlanks, fy, type DressCol } from './dress3';
import { buildAtmos, type Atmos } from '../common/atmos';
import { AoField } from '../common/ao';
import { minePal, rockGeo, crystalGeo, nuggetGeo, mushroomGeos, pickaxeGeo, badgeTexture, badgePriceTexture, badgeQueueTexture, drawEstimateSign, SIGN_W, SIGN_H, oreCol, ROCK, CRYSTAL, type MinePal, type RockGeo } from './art';
import { estimateStone, valueCoins, signText } from './econ';
import { mineSwitch, PREF_ECON, PREF_LAYERS } from './prefs';

const CELL = CW * K;               // 2.4 m
const HALL_X = (GW * CW / 2) * K;  // 8.4 m: half width of the hall
const OUT_X = (W / 2) * K;         // 9.6 m: outer wall
const CEIL = 5.4;
const Z_TOP = mz(Y0);              // −28.8: far end of the hall
const Z_BACK = mz(H);              // 9.75: end of the site's world (bottom of the entrance area)
/** The visual back wall stands further back: room for the third-person camera behind a player at the spawn. */
const Z_WALL = Z_BACK + 3.4;
const STONE_H = 1.3;
/** Cave ambient (cool sky-ish fill) and the warm key: low, so the lantern pools carry the light and the dark between
 *  them reads as depth. */
/** Lantern glow sprite colour: a saturated warm core (a whitish halo read as a puff of smoke at a distance). */
const GLOW = '#ff9a40';
/** Grid step (m) of the cached walking relief (groundAt). */
const GSTEP = 0.25;
const HEMI = 1.1, FILL = 0.32, HALL_I = 5;
/** A lantern's light pool: centred this far under the lantern, this radius, this gain — a distinct disc of warm light on
 *  the ground under it (and the wall it hangs on), dark between the lanterns. */
export const LP_DROP = 1.45, LP_R = 3.5, LP_GAIN = 2.1;
/** The ground's albedo is lifted towards the layer's light rock (the dim ambient keeps the unlit ground dark; the pools
 *  then read as light on it). */
export const FLOOR_LIFT = 0.35;
/** Depth fog range (m) while the cave is lit: the far end of a hall fades into the layer's dark. */
const FOG_NEAR = 7, FOG_FAR = 38;
/** Light-pool candidates (lanterns, portal, ore glow): x, y, z, radius, r, g, b, gain. */
const POOL_MAX = 160;
/** «Шахта 3.0»: at most this many level badges (sprites = draw calls) — on the front stones nearest to the player. */
const BADGE_MAX = 16;
/** «Шахта 3.0»: progress bars only for stones being dug this close to the player (m). */
const BAR_NEAR = 14;
/** Progress bars drawn at most (instanced). */
const BAR_MAX = 32;
/** «Шахта 3.0»: other miners farther than this (m) are not drawn. */
const ACTOR_NEAR = 24;
/** «Шахта 3.0»: pickaxes in the paws of others only this close (m). */
const PICK_NEAR = 14;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0), _v = new THREE.Vector3(), _f = new THREE.Vector3();
const WARM = new THREE.Color(1, 0.86, 0.55);

/**
 * Third-person sightline: rock right in front of the camera dissolves (ordered dither, by view distance) so a stone
 * or a wall lump between the camera and the hero never fills the screen. radius 0 (first person) = off.
 */
const NEAR_FADE = { value: 0 };
function nearFade(m: THREE.Material): void {
  if (m.userData.l3dNearFade) return; m.userData.l3dNearFade = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.uniforms.uNearFade = NEAR_FADE;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vNfD;\nvarying float vNfY;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvNfD = -mvPosition.z; vNfY = mvPosition.y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vNfD;\nvarying float vNfY;\nuniform float uNearFade;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (uNearFade > 0.0 && vNfD < uNearFade && vNfY < 0.4) {   // never the ceiling above the camera
  vec2 q = mod(floor(gl_FragCoord.xy), 4.0);
  float b = (mod(q.x + q.y * 2.0, 4.0) * 4.0 + mod(q.y + q.x * 3.0, 4.0)) / 16.0;
  if (b > smoothstep(uNearFade * 0.45, uNearFade, vNfD)) discard;
}`);
  };
  const pk = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => (pk ? pk() : '') + '|nf';
  m.needsUpdate = true;
}

/**
 * Lantern light in a cave is the light: the pool patch caps a pool at ~1.25× the albedo (right for a lit street), the
 * cave's pools are brighter by `k` (the material's emissive = the pools + the rim).
 */
function poolBoost(m: THREE.Material, k: number): void {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => { prev?.call(m, sh, r); sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', `totalEmissiveRadiance *= ${k.toFixed(2)};\n#include <lights_fragment_begin>`); };
  const pk = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => (pk ? pk() : '') + '|pb' + k;
}
/** Triplanar colour map (world space, `k` tiles per metre) for a pool-patched material (uses its vL3dW / vL3dNw). */
function triplanar(m: THREE.MeshStandardMaterial, k: number): void {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#ifdef USE_MAP
{
  vec3 tw = vL3dW * ${k.toFixed(3)};
  vec3 bw = pow(abs(normalize(vL3dNw)), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
  diffuseColor *= texture2D(map, tw.zy) * bw.x + texture2D(map, tw.xz + 0.37) * bw.y + texture2D(map, tw.xy + 0.71) * bw.z;
}
#endif`);
  };
  const pk = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => (pk ? pk() : '') + '|tri';
}
const rnd = (i: number, k: number) => { const h = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return h - Math.floor(h); };
/** Flat ground (q0, the hall objects' spots): what the dressing stands on where there is no procedural floor. */
const FLAT: FloorOpts = { x0: -1, x1: 1, z0: -1, z1: 1, cell: 1, seed: 0, floor: '#777777', floorL: '#888888', dark: '#333333', walk: () => true, worn: () => 1, wallDist: () => 9, meshY: () => 0 };
const hp = (r: number) => (r > 0.5 ? mix('#ffd23f', '#5fd35f', (r - 0.5) * 2) : mix('#ff4d3d', '#ffd23f', Math.max(0, r) * 2));
function mix(a: string, b: string, k: number): string { return '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString(); }
const rectM = (r: Rect) => ({ x0: mx(r[0]), x1: mx(r[2]), z0: mz(r[1]), z1: mz(r[3]), cx: mx((r[0] + r[2]) / 2), cz: mz((r[1] + r[3]) / 2) });
export const footM = (k: string) => rectM(FOOT.find((f) => f.k === k)!.r);

/** Instanced stone kinds: index → geometry. */
const KINDS: { kind: 'round' | 'slab' | 'hard' | 'pillar'; v: number }[] = [
  { kind: 'round', v: 0 }, { kind: 'round', v: 1 }, { kind: 'slab', v: 0 }, { kind: 'hard', v: 0 }, { kind: 'pillar', v: 0 },
];
/** mass: «Шахта 3.0» rock behind the front (a pillar to the ceiling: not a stone to dig, no badge, no glow). */
interface StoneSlot { kind: number; inst: number; m: THREE.Matrix4; h: number; ore: number[]; mush: number[]; mass?: boolean }

function readEconOn(): boolean { return mineSwitch(PREF_ECON); }
export interface MineSceneOpts { quality?: number; style?: string; login: string; /** The streamer's channel (the cave's look is seeded by it + the floor); default: from the page's LG_BASE. */ channel?: string; /** Floor geometry known at creation (sizes the instanced meshes). */ geom?: MineGeom }

interface Actor { key2: string; av: Avatar; pick: THREE.Group; bone: THREE.Object3D | null; key: string; x: number; z: number; face: number; dig: number; swingT: number; tempo: number; seen: number; anchor: THREE.Vector3; moving: number; ox: number; oz: number; tox: number; toz: number }

export class MineScene {
  /** Geometry of the floor on show: the classic 7 × 12 one or a big «Шахта 3.0» floor (taken from the model, M.G). */
  private G: MineGeom = GEO1;
  /** Instance capacity of the per-cell meshes (cells of the largest floor seen). */
  private cap = N_CELLS;
  readonly root = new THREE.Group();
  private kit: RoomKit | null = null;
  private pal!: MinePal;
  private stones: THREE.InstancedMesh[] = [];
  private stoneMat: THREE.MeshStandardMaterial;
  private slots: (StoneSlot | null)[] = [];
  private nugget: THREE.InstancedMesh; private crystal: THREE.InstancedMesh;
  private mStem: THREE.InstancedMesh; private mCap: THREE.InstancedMesh;
  private oreInfo: { cell: number; inst: number; mesh: 0 | 1; m: THREE.Matrix4 }[] = [];
  private badges: THREE.Sprite[] = [];
  private signCanvas: HTMLCanvasElement | null = null;
  private signTexture: THREE.CanvasTexture | null = null;
  private sign: THREE.Sprite | null = null;
  /** Sign state: which stone / snapshot it shows, when it was last estimated, the drawn text (redraw only on change). */
  private signQ = ''; private signI = -1; private signSnap = -1; private signMy = -2; private signAt = 0;
  private signDrawnI = -1; private signMain = ''; private signShare = ''; private signHour: string | null = ''; private signOk = false;
  /** Economy sign + price glyphs on/off (localStorage 'l3d.mine.econ' = '0' → off). */
  private econOn = true;
  private onSettings = (): void => { this.econOn = readEconOn(); };
  /** Progress bars of the stones being dug: two InstancedMesh (plate + fill), billboarded per frame — 2 draw calls for all. */
  private barBg!: THREE.InstancedMesh; private barFill!: THREE.InstancedMesh;
  private hl: THREE.Mesh; private hlI = -1;
  private ring: THREE.Mesh;
  private fronts: THREE.InstancedMesh;
  private hallLights: THREE.PointLight[] = [];
  private camCol: THREE.Mesh;
  private dynamic = new THREE.Group();
  private upGlow: THREE.PointLight;
  private upLamp: THREE.Mesh;
  readonly heroLight: THREE.PointLight;
  private hemi: THREE.HemisphereLight;
  private fill: THREE.DirectionalLight;
  private avKit = createAvatarKit();
  readonly labels: LabelsEx = createLabels();
  private actors = new Map<string, Actor>();
  private anchors = new Map<string, THREE.Vector3>();
  private pickMats: THREE.Material[];
  private parts: THREE.Points; private partVel: Float32Array; private partLife: Float32Array; private partN = 0; private partMax!: Float32Array;
  /** Time for the ore glitter / gem shimmer. */
  private glintT = { value: 0 };
  /** Channel of the stream (null = read LG_BASE) and the cave seed of the current floor (0..996): hash(channel, floor seed, n). */
  private channel: string | null = null;
  caveSeed = 0;
  /** The procedural floor of the current floor (null: flat, q0). groundAt() reads it. */
  private floorO: FloorOpts | null = null;
  /** Height the player / miners / NPCs stand on at (x, z) (room metres): the floor's walkable relief (hollows ≤ 0). */
  groundAt(x: number, z: number): number {
    const F = this.floorO; if (!F) return 0;
    // the relief is fixed per floor: sampled once on a 0.25 m grid, read back bilinearly (the player controller, the
    // camera, every miner and NPC ask several times a frame — the analytic noise is ~20× dearer)
    if (this.gH.F !== F) this.gridGround(F);
    const g = this.gH, u = (x - F.x0) / GSTEP, w = (z - F.z0) / GSTEP;
    if (u < 0 || w < 0 || u >= g.nu || w >= g.nv) return groundHeight(F, x, z);
    const i = Math.floor(u), j = Math.floor(w), fu = u - i, fw = w - j, n = g.nu + 1, H = g.h, o = j * n + i;
    return (H[o] * (1 - fu) + H[o + 1] * fu) * (1 - fw) + (H[o + n] * (1 - fu) + H[o + n + 1] * fu) * fw;
  }
  private gH: { F: FloorOpts | null; nu: number; nv: number; h: Float32Array } = { F: null, nu: 0, nv: 0, h: new Float32Array(0) };
  private gridGround(F: FloorOpts): void {
    const nu = Math.ceil((F.x1 - F.x0) / GSTEP), nv = Math.ceil((F.z1 - F.z0) / GSTEP), h = new Float32Array((nu + 1) * (nv + 1));
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) h[j * (nu + 1) + i] = groundHeight(F, F.x0 + i * GSTEP, F.z0 + j * GSTEP);
    this.gH = { F, nu, nv, h };
  }
  private fogScene: THREE.Scene | null = null;
  /** The linear fog of the scene the cave is in (null: none / not attached). */
  private fogOf(): THREE.Fog | null {
    if (!this.fogScene || this.root.parent == null) { let o: THREE.Object3D | null = this.root; while (o && !(o as THREE.Scene).isScene) o = o.parent; this.fogScene = (o as THREE.Scene) || null; }
    const f = this.fogScene ? this.fogScene.fog as THREE.Fog | null : null;
    return f && f.isFog ? f : null;
  }
  /** Base height for a lump of footprint radius r on the relief: its lowest ground (no gap on the downhill side). */
  private sitY(x: number, z: number, r: number): number {
    if (!this.floorO) return 0;
    let lo = this.groundAt(x, z);
    for (let a = 0; a < 6; a++) lo = Math.min(lo, this.groundAt(x + Math.cos(a * 1.047) * r * 0.9, z + Math.sin(a * 1.047) * r * 0.9));
    return lo;
  }
  /** Floor mark lying on the relief at (x, z): position + the ground's tilt (halos, the dig ring). */
  private onGround(x: number, z: number, lift: number, out: THREE.Matrix4, s = 1): THREE.Matrix4 {
    const e = 0.9, sx = (this.groundAt(x + e, z) - this.groundAt(x - e, z)) / (2 * e), sz = (this.groundAt(x, z + e) - this.groundAt(x, z - e)) / (2 * e);
    _v.set(-sx, 1, -sz).normalize(); _q.setFromUnitVectors(_up, _v);
    return out.compose(_p.set(x, this.groundAt(x, z) + lift, z), _q, _s.set(s, s, s));
  }
  /** Dust motes in the lit parts of the cave (q1+). */
  private motes: Atmos | null = null;
  private floorKey = '';
  private dugKey = '';
  /** Dark floor (no helmet): almost no light, others hidden (site S.dark). */
  dark = false;
  readonly colliders: THREE.Object3D[] = [];
  private quality: number; private style: string; private login: string;
  /** NPCs (buyer, supplier) as avatars. */
  private npcs: Avatar[] = [];
  /** Hit volumes of entrance objects (Box3, world = room space). */
  readonly objBoxes: Record<string, THREE.Box3> = {};
  /**
   * Cheap lighting: warm light pools of the lanterns + coloured glow of ore, injected into the cave materials
   * (world/lightPools shader patch; we drive its uniforms ourselves: the POOL_N candidates nearest to the view).
   */
  private pool = new PoolLights([], 1e6, 0);
  private poolC = new Float32Array(POOL_MAX * 8); private poolN = 0; private poolT = 0;
  private poolBest = new Int32Array(POOL_N); private poolBestD = new Float32Array(POOL_N);
  /** Pool candidate index of an ore stone (−1 none) — switched off when the stone is dug. */
  private orePool = new Int32Array(N_CELLS).fill(-1); private orePoolG = new Float32Array(N_CELLS);
  /** Ore glow sprites (one per ore stone; size 0 when dug). */
  private oreGlow: THREE.Points | null = null; private oreGlowCell: number[] = []; private oreGlowSize: number[] = [];
  private glowTex = glowTexture();
  private ringTex: THREE.Texture;
  /** Lantern positions (x, y, z): the real hall lights move to the ones nearest to the player. */
  private lanterns: number[] = []; private lightT = 0;
  private lightBest = new Int32Array(8); private lightBestD = new Float32Array(8);
  /** Base colour of every stone (front stones are lit up, the others dimmed). */
  private baseCol = new Float32Array(N_CELLS * 3);

  constructor(o: MineSceneOpts) {
    this.quality = o.quality ?? 2; this.style = o.style || 'cats'; this.channel = o.channel ?? null; this.login = String(o.login || '').toLowerCase();
    if (o.geom) this.G = o.geom;
    this.cap = Math.max(N_CELLS, this.G.N);
    this.orePool = new Int32Array(this.cap).fill(-1); this.orePoolG = new Float32Array(this.cap); this.baseCol = new Float32Array(this.cap * 3);
    this.root.name = 'mine';
    this.econOn = readEconOn();
    if (typeof window !== 'undefined') window.addEventListener('l3d:settings', this.onSettings);
    this.stoneMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0 });
    for (const k of KINDS) {
      const g: RockGeo = rockGeo(k.kind, k.v);
      const im = new THREE.InstancedMesh(g.geo, this.stoneMat, this.cap);
      im.name = 'mine:stones:' + k.kind + k.v; im.count = 0; im.castShadow = true; im.receiveShadow = true;
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
      im.frustumCulled = false;
      this.stones.push(im); this.dynamic.add(im);
    }
    const nugMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.35, metalness: 0.35 });
    // ore glints in its own colour (instance colour as emissive) — readable by type even in the dark corners
    // + glitter: per-facet sparkles that wink as the view moves and with time (flat facets: one hash per facet normal)
    nugMat.onBeforeCompile = (sh) => {
      sh.uniforms.uGlintT = this.glintT;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGlintT;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
#ifdef USE_INSTANCING_COLOR
totalEmissiveRadiance += vColor.rgb * 0.42;
{
  vec3 fn = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
  float hsh = fract(sin(dot(floor(fn * 9.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  float tw = pow(max(0.0, sin(uGlintT * (1.5 + hsh * 3.0) + hsh * 40.0 + dot(fn, normalize(vViewPosition)) * 6.0)), 24.0);
  totalEmissiveRadiance += mix(vColor.rgb, vec3(1.0), 0.6) * tw * step(0.55, hsh) * 2.2;
}
#endif`);
    };
    nugMat.customProgramCacheKey = () => 'mine:nugget';
    nearFade(nugMat);
    // gem crystals: lit facets (so they read as prisms, not flat patches) + a strong glow in their own colour
    const cryMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.18, metalness: 0.1 });
    // refraction-ish: a bright fresnel rim, an inner «caustic» band pattern that slides with the view (reflected view vector),
    // a cool core, a white glint on the facing facet
    cryMat.onBeforeCompile = (sh) => {
      sh.uniforms.uGlintT = this.glintT;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGlintT;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
#ifdef USE_INSTANCING_COLOR
{
  vec3 V = normalize(vViewPosition), N = normalize(normal);
  float fr = pow(1.0 - abs(dot(N, V)), 2.2);
  vec3 R = reflect(-V, N);
  float bands = 0.5 + 0.5 * sin(R.y * 9.0 + R.x * 5.0 + uGlintT * 0.6);
  vec3 core = mix(vColor.rgb * 0.45, vColor.rgb * 1.25, bands);
  totalEmissiveRadiance += core * (0.5 + 0.3 * clamp(N.y, 0.0, 1.0)) + mix(vColor.rgb, vec3(1.0), 0.5) * fr * 1.1;
  totalEmissiveRadiance += vec3(1.0) * pow(max(0.0, dot(N, V)), 40.0) * 0.8;
}
#endif`);
    };
    cryMat.customProgramCacheKey = () => 'mine:crystal';
    nearFade(cryMat);
    this.nugget = new THREE.InstancedMesh(nuggetGeo(), nugMat, this.cap * 12); this.nugget.name = 'mine:ore';
    this.crystal = new THREE.InstancedMesh(crystalGeo(), cryMat, this.cap * 12); this.crystal.name = 'mine:gems';
    for (const im of [this.nugget, this.crystal]) { im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(im.count * 3), 3); im.count = 0; im.frustumCulled = false; this.dynamic.add(im); }
    const mg = mushroomGeos();
    this.mStem = new THREE.InstancedMesh(mg.stem, new THREE.MeshStandardMaterial({ color: '#efe6d0', roughness: 0.8 }), 400); this.mStem.name = 'mine:mushStem';
    this.mCap = new THREE.InstancedMesh(mg.cap, new THREE.MeshBasicMaterial({}), 400); this.mCap.name = 'mine:mushCap';
    for (const im of [this.mStem, this.mCap]) { im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(400 * 3), 3); im.count = 0; im.frustumCulled = false; this.dynamic.add(im); }
    // aimed stone: an invisible carrier of the stone's geometry + matrix for the silhouette outline (engine/outline.ts)
    this.hl = new THREE.Mesh(rockGeo('round', 0).geo, new THREE.MeshBasicMaterial({ visible: false }));
    this.hl.name = 'mine:hl'; this.hl.matrixAutoUpdate = false; this.hl.frustumCulled = false; this.hl.raycast = () => { /* never hit */ };
    this.dynamic.add(this.hl);
    // own-stone dig spot: ring on the floor
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.9, depthWrite: false }));
    this.ring.visible = false; this.ring.name = 'mine:ring'; this.dynamic.add(this.ring);
    // progress bars: plate + fill, drawn over the rock (no depth test) like the site's bars
    this.barBg = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.08, 0.2), new THREE.MeshBasicMaterial({ color: '#15122e', depthTest: false, transparent: true }), BAR_MAX);
    this.barFill = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 0.13).translate(0, 0, 0.001), new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true }), BAR_MAX);
    this.barFill.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BAR_MAX * 3), 3);
    this.barBg.name = 'mine:barBg'; this.barFill.name = 'mine:barFill'; this.barBg.renderOrder = 6; this.barFill.renderOrder = 7;
    for (const im of [this.barBg, this.barFill]) { im.count = 0; im.frustumCulled = false; this.dynamic.add(im); }
    // «жёлтый круг»: a glowing ring on the floor around every stone that can be dug now
    // a glowing gold halo on the floor (crisp ring + soft outer glow, additive) — reads from far away and in the dark
    this.ringTex = haloTexture();
    this.fronts = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.4, 3.4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd23f', map: this.ringTex, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), this.cap);
    this.fronts.count = 0; this.fronts.name = 'mine:fronts'; this.fronts.frustumCulled = false; this.fronts.renderOrder = 2; this.dynamic.add(this.fronts);
    // a few warm lights along the hall (quality-capped); the entrance has its own (RoomKit lights)
    // (they follow the player: every 0.3 s they move to the lanterns nearest to the feet — see placeLights)
    const nl = this.quality <= 0 ? 1 : this.quality === 1 ? 2 : 4;
    for (let k = 0; k < nl; k++) { const l = new THREE.PointLight('#ffb862', HALL_I, 7.5, 2); l.position.set(0, -50, 0); l.userData.k = -1; this.hallLights.push(l); this.root.add(l); }
    // camera collider: one invisible mesh, its geometry rebuilt when stones change
    this.camCol = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
    this.camCol.name = 'mine:colliders'; this.camCol.userData.cameraCollider = true; this.dynamic.add(this.camCol);
    this.colliders.push(this.camCol);
    // up-cage glow (on when the floor is cleared)
    this.upGlow = new THREE.PointLight('#ffcf6a', 0, 10, 1.6); this.dynamic.add(this.upGlow);
    this.upLamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshBasicMaterial({ color: '#5a4a3a' })); this.dynamic.add(this.upLamp);
    // lights: soft cave ambient + a warm key from the entrance + the helmet lamp that follows the player
    // cool ambient + warm lantern pools: value and temperature contrast instead of one flat brown
    this.hemi = new THREE.HemisphereLight('#94a6ff', '#4e3c32', HEMI); this.root.add(this.hemi);
    this.fill = new THREE.DirectionalLight('#ffd8a8', FILL); this.fill.position.set(-6, 14, 18); this.fill.target.position.set(0, 0, -10); this.root.add(this.fill, this.fill.target);
    this.heroLight = new THREE.PointLight('#ffe2b0', 9, 11, 1.4); this.heroLight.name = 'mine:helmet'; this.root.add(this.heroLight);
    // pickaxe materials (shared by all actors)
    this.pickMats = [new THREE.MeshStandardMaterial({ color: '#b07a44', roughness: 0.8 }), new THREE.MeshStandardMaterial({ color: '#d8dee8', roughness: 0.35, metalness: 0.3, flatShading: true })];
    // rock detail: the shared rock texture on every stone (same draw calls), lit by the pools
    const rt = getTexture('rock', { neutral: true, seed: 11 });
    this.stoneMat.map = rt.map; this.stoneMat.normalMap = rt.normalMap ?? null; if (rt.normalMap) this.stoneMat.normalScale.setScalar(0.7);
    nearFade(this.stoneMat);
    this.pool.patch(this.stoneMat, { vary: 0.14, ao: 0.4, gain: 1.15, rim: 0.05, dim: 0.8 });
    // the rock texture world-projected on three axes (a lump scaled to a 6 m wall pillar would stretch its own UVs into
    // streaks); q1+, the pool patch's world position / normal carry it
    if (this.quality >= 1) triplanar(this.stoneMat, 0.42);
    poolBoost(this.stoneMat, 1.6);
    this.pool.patch(nugMat, { vary: 0, ao: 0, gain: 0.5, rim: 0.15 });
    this.pool.uniforms.uL3dRim.value.set('#ffb87a');
    // debris particles
    // debris: rock chips (small, bouncing, in the rock / ore colours) + dust puffs (big, soft, slow, rising and fading)
    const NP = 240, pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NP * 3), 3));
    pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(NP * 3), 3));
    pg.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(NP), 1));
    pg.setAttribute('aFade', new THREE.BufferAttribute(new Float32Array(NP), 1));
    pg.setDrawRange(0, 0);
    this.parts = new THREE.Points(pg, new THREE.ShaderMaterial({
      vertexShader: `attribute vec3 color; attribute float aSize; attribute float aFade; varying vec3 vC; varying float vA; varying float vDust;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vC = color; vA = aFade; vDust = step(0.2, aSize);
          gl_PointSize = aSize * projectionMatrix[1][1] * 300.0 / max(-mv.z, 0.2); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA; varying float vDust;
        void main() { vec2 c = gl_PointCoord - 0.5; float r = dot(c, c) * 4.0; if (r > 1.0) discard;
          float a = vDust > 0.5 ? (1.0 - r) * (1.0 - r) * 0.3 * vA : step(r, 0.8) * vA;
          if (a < 0.02) discard; gl_FragColor = vec4(vC * (vDust > 0.5 ? 1.0 : 0.85 + 0.3 * (1.0 - r)), a); }`,
      transparent: true, depthWrite: false,
    }));
    this.parts.frustumCulled = false; this.parts.name = 'mine:debris';
    this.partVel = new Float32Array(NP * 3); this.partLife = new Float32Array(NP); this.partMax = new Float32Array(NP);
    this.dynamic.add(this.parts);
    this.root.add(this.dynamic, this.labels.root);
  }

  /* ================================================================ floor (static) */

  /** The materials every cave batch uses (rock faces, soil), pool-lit; `name` = the batch's name. */
  private makeKit(name: string): RoomKit {
    const P = this.pal, base = paletteOf(this.style);
    const pal: Pal = { ...base, ground: P.floor, groundL: P.floorL, ground2: P.floor, mortar: P.wall, stone: P.wallL, timber: '#7a4e2a', wood: '#a8754f', woodD: '#5a3a1e', woodL: '#d9a066', line: '#15122e', metal: '#3a3448' };
    const kit = new RoomKit(pal, this.quality, name);
    // cave materials: rough rock for walls / lumps / ceiling, soil for the hall floor (instead of ashlar blocks)
    const cave = (k: TexKind, seed: number, ns: number) => {
      // soil: a low-contrast grey palette (the neutral one has bright square flecks that read as noise on a big floor)
      const t = getTexture(k, k === 'soil' ? { colors: ['#d6d2ce', '#c9c4bf', '#cfcac5'], seed } : { neutral: true, seed });
      const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: t.map, normalMap: t.normalMap ?? null, roughnessMap: t.roughnessMap ?? null, roughness: 0.95, flatShading: k === 'rock' });
      if (t.normalMap) m.normalScale.setScalar(ns);
      // surface detail (q1+): macro variation and anti-tiling; rock gets damp / moss in the hollows by nature, the
      // ground wet glossy patches (the cave sweats) and rougher-smoother variation
      roomSurface(m, t, k === 'rock' ? { macro: 0.2, hue: 0.12, ids: 0.1, dirt: 0.35, dirtH: 0.9, moss: this.pal.moss ? 0.35 : 0.08 } : { macro: 0.24, hue: 0.12, wet: 0.35, roughVar: 0.3, moss: this.pal.moss ? 0.15 : 0 }, this.quality);
      m.name = 'mine:' + k; kit.owned.push(m); return m;
    };
    (kit.mats as Record<string, THREE.Material>).stone = cave('rock', 3, 1.25);
    (kit.mats as Record<string, THREE.Material>).lowPaving = cave('soil', 5, 0.75);
    // puddles: dark still water that mirrors the lantern pools (a reflected-ray test against the pool candidates)
    const water = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.06, metalness: 0.0 });
    this.mirrorPools(water); water.name = 'mine:water'; kit.owned.push(water);
    (kit.mats as Record<string, THREE.Material>).water = water;
    return kit;
  }
  /** Water that mirrors the light-pool candidates: a sharp reflection + a soft sheen of every lantern near the reflected ray. */
  private mirrorPools(m: THREE.MeshStandardMaterial): void {
    const U = this.pool.uniforms;
    const sky = { value: new THREE.Color(this.pal.wallL).lerp(new THREE.Color(this.pal.lamp), 0.2).multiplyScalar(0.6) };
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uL3dP = U.uL3dP; sh.uniforms.uL3dC = U.uL3dC; sh.uniforms.uL3dN = U.uL3dN; sh.uniforms.uMwSky = sky;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vMwW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvMwW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vMwW;
uniform vec4 uL3dP[${POOL_N}];
uniform vec3 uL3dC[${POOL_N}];
uniform int uL3dN;
uniform vec3 uMwSky;`).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 V = normalize(cameraPosition - vMwW);
  // a faint ripple on the mirror (fixed: still cave water)
  vec3 Nw = normalize(vec3(sin(vMwW.x * 7.0 + vMwW.z * 3.0) * 0.012, 1.0, sin(vMwW.z * 6.0 - vMwW.x * 2.0) * 0.012));
  vec3 R = reflect(-V, Nw);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${POOL_N}; i++) {
    if (i >= uL3dN) break;
    vec3 d = uL3dP[i].xyz - vMwW; float dl = length(d);
    float c = max(dot(R, d / dl), 0.0);
    acc += uL3dC[i] * (pow(c, 900.0) * 5.0 + pow(c, 30.0) * 0.18) / (1.0 + dl * 0.12);
  }
  float fr = 0.3 + 0.7 * pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
  // the dim cave mirrored (the rock over the water, brighter towards grazing views) + the lanterns
  totalEmissiveRadiance += uMwSky * fr * (0.6 + 0.4 * sin(R.x * 3.0 + R.z * 2.0)) + acc * fr * 1.6;
  diffuseColor.rgb *= 0.6;
}`);
    };
    m.customProgramCacheKey = () => 'mine:water';
  }
  /** The static batch's AO field (the whole floor): rebaked when the dug part's dressing changes (big floor). */
  private floorAo: AoField | null = null;
  private aoBake(ao: AoField, kit: RoomKit, extra: RoomKit | null): void {
    ao.clearSolids();
    for (const K of extra ? [kit, extra] : [kit]) {
      for (const q of K.solids) ao.solid(q.x0, q.x1, q.z0, q.z1, q.top);
      for (let i = 0; i < K.aoExtra.length; i += 5) ao.solid(K.aoExtra[i], K.aoExtra[i + 1], K.aoExtra[i + 2], K.aoExtra[i + 3], K.aoExtra[i + 4]);
    }
    ao.bake();
  }
  /** Pool-light patches on a finished batch, then into the scene. */
  private finishKit(kit: RoomKit): void {
    // the cave surfaces take the lantern pools (walls, floors, timber, props)
    for (const k of ['stone', 'lowPaving', 'paving', 'wood', 'metal', 'canvas', 'plaster', 'roof', 'brick'] as const) {
      // dim: the ambient share of the albedo — the dark between the pools is darker, the lit parts keep their colour
      const m = (kit.mats as Record<string, THREE.Material>)[k]; if (m && k === 'stone') nearFade(m);
      if (m) { this.pool.patch(m, { vary: k === 'stone' ? 0.16 : 0.08, ao: k === 'stone' ? 0.45 : 0.25, gain: 1.15, rim: 0.06, dim: k === 'lowPaving' ? 0.55 : k === 'stone' ? 0.85 : 0.85 }); poolBoost(m, k === 'lowPaving' ? 2.6 : k === 'stone' ? 2.0 : 1.5); }
    }
    kit.finish();
    // contact shadows on the ground round everything standing on it (the cave's own baked AO field, q1+): the hall
    // objects' solids and the dressing's footprints (boulders, scree mounds, crates, tools); the static batch's field
    // spans the whole floor and also takes the dug part's dressing (rebaked with it, floorAoBake)
    if (this.quality >= 1 && (kit.solids.length || kit.aoExtra.length)) {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const q of kit.solids) { x0 = Math.min(x0, q.x0); x1 = Math.max(x1, q.x1); z0 = Math.min(z0, q.z0); z1 = Math.max(z1, q.z1); }
      for (let i = 0; i < kit.aoExtra.length; i += 5) { x0 = Math.min(x0, kit.aoExtra[i]); x1 = Math.max(x1, kit.aoExtra[i + 1]); z0 = Math.min(z0, kit.aoExtra[i + 2]); z1 = Math.max(z1, kit.aoExtra[i + 3]); }
      const F = kit === this.kit ? this.floorO : null;
      if (F) { x0 = Math.min(x0, F.x0); x1 = Math.max(x1, F.x1); z0 = Math.min(z0, F.z0); z1 = Math.max(z1, F.z1); }
      const ao = new AoField(x0 - 1, z0 - 1, x1 + 1, z1 + 1, Math.max(0.1, (Math.max(x1 - x0, z1 - z0) + 2) / 500));
      ao.grimeK = 0;
      for (const k of ['lowPaving', 'wood', 'metal'] as const) { const m = (kit.mats as Record<string, THREE.Material>)[k]; if (m) ao.patch(m, { contact: 0.85, wall: 0, ceil: 0 }); }
      kit.owned.push(ao);
      if (kit === this.kit) this.floorAo = ao;
      this.aoBake(ao, kit, kit === this.kit ? this.kit3 : null);
    }
    this.root.add(kit.root);
  }
  private dropKit(kit: RoomKit | null): void { if (!kit) return; this.root.remove(kit.root); kit.dispose(); for (const l of kit.lights) l.removeFromParent(); }
  /** Per-cell instanced meshes and arrays for a floor of N cells (a bigger floor than any before re-allocates them). */
  private growTo(N: number): void {
    if (N <= this.cap) return;
    this.cap = N;
    this.orePool = new Int32Array(N).fill(-1); this.orePoolG = new Float32Array(N); this.baseCol = new Float32Array(N * 3);
    const re = (im: THREE.InstancedMesh, n: number): THREE.InstancedMesh => {
      const nm = new THREE.InstancedMesh(im.geometry, im.material, n);
      nm.name = im.name; nm.count = 0; nm.castShadow = im.castShadow; nm.receiveShadow = im.receiveShadow; nm.frustumCulled = false; nm.renderOrder = im.renderOrder;
      if (im.instanceColor) nm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      im.removeFromParent(); im.dispose(); this.dynamic.add(nm); return nm;
    };
    this.stones = this.stones.map((im) => re(im, N));
    this.nugget = re(this.nugget, N * 12); this.crystal = re(this.crystal, N * 12); this.fronts = re(this.fronts, N);
  }

  /** (Re)build everything for the model's floor; cheap no-op when the floor did not change. */
  setFloor(M: MineModel): boolean {
    const st = M.st, F = M.F; if (!st || !F) return false;
    if (M.G !== this.G) { this.G = M.G; this.growTo(this.G.N); }
    const G = this.G;
    const depth = mineSwitch(PREF_LAYERS), key = `${G.v3 ? `v3:${G.w}x${G.h}:${G.hallBox.join(',')}` : 'v1'}.${st.seed}.${st.n}.${depth ? 1 : 0}`;   // the «Пласты глубины» switch rebuilds on the next view
    if (key === this.floorKey) return false;
    this.floorKey = key; this.dugKey = ''; this.slotKey = '';
    this.pal = minePal(F.biome, F.n, depth);
    const chan = this.channel ?? channelOfBase(typeof window !== 'undefined' ? String((window as unknown as { LG_BASE?: string }).LG_BASE || '') : '');
    this.caveSeed = Math.floor(hashStr(`${chan}|${st.seed}|${st.n}`) * 997);
    this.poolN = 0; this.lanterns = []; this.orePool.fill(-1); this.poolT = 0; this.lightT = 0;
    this.dropKit(this.kit); this.kit = null; this.dropKit(this.kit3); this.kit3 = null; this.floorO = null; this.floorAo = null;
    for (const a of this.npcs) { a.root.removeFromParent(); a.dispose(); }
    this.npcs = [];
    const kit = this.makeKit('mine:static');
    this.kit = kit;
    if (G.v3) {
      const out = buildCave3(kit, G, F, this.pal, (x, y, z, r, c, g) => this.addPool(x, y, z, r, c, g), this.caveSeed, this.flatAround(), this.clearSpots());
      if (this.quality >= 1) this.floorO = out.floor;
      this.lanterns.push(...out.lanterns);
      this.buildEntrance(kit);
    } else {
      this.buildCave(kit, M);
      this.buildEntrance(kit);
      this.buildTop(kit, M);
    }
    this.finishKit(kit);
    this.buildMotes();
    this.buildNpcs();
    this.slots = []; this.hlI = -2;   // stones rebuilt: re-bind the aimed stone's outline
    for (const im of this.stones) im.count = 0;
    if (G.v3) {
      // the rock layout of a big floor follows the digging and the fog: built by setView (buildSlots3)
      this.poolStatic = this.poolN; this.lanternsStatic = this.lanterns.length;
      return true;
    }
    // stone slots (geometry choice per cell is stable for a floor)
    for (let i = 0; i < G.N; i++) {
      const c = F.cells[i];
      if (!c || c.t === 'void' || c.t === 'entry') { this.slots.push(null); continue; }
      const kind = c.t === 'wall' ? 4 : c.t === 'hard' ? 3 : Math.floor(rnd(i, st.seed % 97) * 3);
      const im = this.stones[kind], inst = im.count++;
      const p = G.cellXY(i), sc = 1 + Math.max(0, (c.lv || F.n) - F.n) * 0.1;
      const h = c.t === 'wall' ? CEIL + 0.4 : STONE_H * sc * (c.t === 'hard' ? 1.08 : 1) * (0.92 + rnd(i, 3) * 0.16);
      const wxz = c.t === 'wall' ? 1.45 : 0.98 + rnd(i, 4) * 0.1;
      _q.setFromAxisAngle(_up, rnd(i, 5) * Math.PI * 2);
      const m = new THREE.Matrix4().compose(_p.set(G.mx(p.cx) + (rnd(i, 6) - 0.5) * 0.12, this.sitY(G.mx(p.cx), G.mz(p.cy), wxz) - 0.08, G.mz(p.cy) + (rnd(i, 7) - 0.5) * 0.12), _q, _s.set(wxz, h, wxz));
      im.setMatrixAt(inst, m);
      const col = this.rockColor(c, i);
      im.setColorAt(inst, col); col.toArray(this.baseCol, i * 3);
      this.slots.push({ kind, inst, m, h, ore: [], mush: [] });
    }
    for (const im of this.stones) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    this.buildOre(M);
    this.buildMushrooms(M);
    this.buildOreGlow(M);
    return true;
  }

  /* ---------------------------------------------------------------- «Шахта 3.0»: rock layout of a big floor */
  /** Second batch of a big floor (tunnel lanterns, special halls, drills, the lift shaft, vein sparks). */
  private kit3: RoomKit | null = null;
  private slotKey = '';
  /** Vein sparks on the rock faces (x, y, z …) — dev / tests. */
  sparks3: number[] = [];
  private poolStatic = 0; private lanternsStatic = 0;
  /** Rock mode of every cell of a big floor (cave3.slots3). */
  private mode3: (Slot3 | null)[] = [];
  /**
   * Rock of a big floor from the view: front stones are boulders (the classic stones, with ore / badges / halo), the rock
   * behind them a solid mass to the ceiling (ore streaks on visible rock, pitch-dark where the site shows fog).
   * Rebuilt when the dug cells, the front, the visible cells or the drills change (a few times a minute at most).
   */
  private buildSlots3(M: MineModel): void {
    const st = M.st!, F = M.F!, G = this.G;
    const front = new Set(st.front || []);
    const mode = slots3(G, F, M.dug, front); this.mode3 = mode;
    this.poolN = this.poolStatic; this.lanterns.length = this.lanternsStatic; this.orePool.fill(-1); this.poolT = 0; this.lightT = 0;
    this.slots = []; this.hlI = -2;
    for (const im of this.stones) im.count = 0;
    const P = this.pal, fogA = new THREE.Color(P.wall).multiplyScalar(0.28), fogB = new THREE.Color(P.wall).multiplyScalar(0.4);
    for (let i = 0; i < G.N; i++) {
      const md = mode[i], c = F.cells[i];
      if (!md) { this.slots.push(null); continue; }
      const p = G.cellXY(i);
      let kind: number, h: number, wxz: number;
      if (md === 'stone') {
        kind = c.t === 'hard' ? 3 : Math.floor(rnd(i, st.seed % 97) * 3);
        const sc = 1 + Math.max(0, (c.lv || F.n) - F.n) * 0.1;
        h = STONE_H * sc * (c.t === 'hard' ? 1.08 : 1) * (0.92 + rnd(i, 3) * 0.16); wxz = 0.98 + rnd(i, 4) * 0.1;
      } else { kind = 4; h = CEIL + 0.4; wxz = 1.42 + rnd(i, 4) * 0.12; }
      const im = this.stones[kind], inst = im.count++;
      _q.setFromAxisAngle(_up, rnd(i, 5) * Math.PI * 2);
      const m = new THREE.Matrix4().compose(_p.set(G.mx(p.cx) + (rnd(i, 6) - 0.5) * 0.12, this.sitY(G.mx(p.cx), G.mz(p.cy), wxz) - 0.08, G.mz(p.cy) + (rnd(i, 7) - 0.5) * 0.12), _q, _s.set(wxz, h, wxz));
      im.setMatrixAt(inst, m);
      // fog: nothing known — the same dark rock for every hidden cell (no type, no ore: the site hides it)
      const col = md === 'fog' ? _c.copy(fogA).lerp(fogB, rnd(i, 9)) : md === 'wall' ? this.rockColor({ ...c, t: 'wall' }, i) : this.rockColor(c, i);
      if (md === 'mass') col.multiplyScalar(0.82);
      im.setColorAt(inst, col); col.toArray(this.baseCol, i * 3);
      this.slots.push({ kind, inst, m, h, ore: [], mush: [], mass: md !== 'stone' });
    }
    for (const im of this.stones) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    this.buildOre(M);
    this.buildMushrooms(M);
    this.buildOreGlow(M);
    // tunnel lanterns, special halls, drills, the shaft, vein sparks
    this.dropKit(this.kit3);
    const k3 = this.makeKit('mine:dig3');
    this.sparks3 = buildDig3(k3, G, F, M.dug, mode, P, (x, y, z, r, cc, g) => this.addPool(x, y, z, r, cc, g), this.lanterns, this.caveSeed, this.floorO).sparks;
    this.finishKit(k3); this.kit3 = k3;
    if (this.floorAo && this.kit) this.aoBake(this.floorAo, this.kit, k3);   // the tunnels' scree / crates shade the floor
    this.badgeAtFeet.set(1e9, 0, 1e9);
  }

  /** Add a light-pool candidate; returns its index. */
  private addPool(x: number, y: number, z: number, r: number, color: string, gain: number): number {
    if (this.poolN >= POOL_MAX) return -1;
    const o = this.poolN * 8; _c.set(color);
    this.poolC[o] = x; this.poolC[o + 1] = y; this.poolC[o + 2] = z; this.poolC[o + 3] = r;
    this.poolC[o + 4] = _c.r; this.poolC[o + 5] = _c.g; this.poolC[o + 6] = _c.b; this.poolC[o + 7] = gain;
    return this.poolN++;
  }
  /** Every 0.2 s: the POOL_N enabled candidates nearest to a point a few metres in front of the camera. */
  private updatePools(cam: THREE.Vector3, fx: number, fz: number, dt: number, dark: boolean): void {
    this.poolT -= dt; if (this.poolT > 0) return; this.poolT = 0.2;
    const c = this.poolC, best = this.poolBest, bestD = this.poolBestD, N = POOL_N;
    const qx = cam.x + fx * 4, qz = cam.z + fz * 4;
    for (let i = 0; i < N; i++) { best[i] = -1; bestD[i] = 1e12; }
    for (let i = 0; i < this.poolN; i++) {
      const o = i * 8; if (c[o + 7] <= 0) continue;
      const dx = c[o] - qx, dz = c[o + 2] - qz, d = dx * dx + dz * dz - c[o + 3] * c[o + 3] * 0.3;
      if (d >= bestD[N - 1]) continue;
      let j = N - 1;
      while (j > 0 && bestD[j - 1] > d) { bestD[j] = bestD[j - 1]; best[j] = best[j - 1]; j--; }
      bestD[j] = d; best[j] = i;
    }
    const P = this.pool.uniforms.uL3dP.value, C = this.pool.uniforms.uL3dC.value;
    for (let i = 0; i < N; i++) {
      const k = best[i];
      if (k < 0) { P[i].set(0, -1000, 0, 1); C[i].set(0, 0, 0); continue; }
      const o = k * 8, g = dark ? 0.06 : c[o + 7];
      P[i].set(c[o], c[o + 1], c[o + 2], c[o + 3]); C[i].set(c[o + 4] * g, c[o + 5] * g, c[o + 6] * g);
    }
  }
  /** Real hall lights → the lanterns nearest to the player (every 0.3 s; a moved light fades in). */
  private placeLights(feet: THREE.Vector3, dt: number, dark: boolean): void {
    const Ls = this.hallLights; if (!Ls.length) return;
    for (const l of Ls) l.intensity = dark ? 0 : Math.min(HALL_I, l.intensity + dt * 16);
    this.lightT -= dt; if (this.lightT > 0) return; this.lightT = 0.3;
    const n = this.lanterns.length / 3, nl = Ls.length;
    for (let j = 0; j < nl; j++) { this.lightBest[j] = -1; this.lightBestD[j] = 1e12; }
    for (let i = 0; i < n; i++) {
      const dx = this.lanterns[i * 3] - feet.x, dz = this.lanterns[i * 3 + 2] - feet.z, d = dx * dx + dz * dz;
      if (d >= this.lightBestD[nl - 1]) continue;
      let j = nl - 1;
      while (j > 0 && this.lightBestD[j - 1] > d) { this.lightBestD[j] = this.lightBestD[j - 1]; this.lightBest[j] = this.lightBest[j - 1]; j--; }
      this.lightBestD[j] = d; this.lightBest[j] = i;
    }
    // keep a light on its lantern if that lantern is still wanted; give the free lights the new ones
    for (const l of Ls) { const k = l.userData.k as number; let want = false; for (let j = 0; j < nl; j++) if (k >= 0 && this.lightBest[j] === k) { want = true; this.lightBest[j] = -2; } if (!want) l.userData.k = -1; }
    for (const l of Ls) {
      if (l.userData.k >= 0) continue;
      let k = -1; for (let j = 0; j < nl; j++) if (this.lightBest[j] >= 0) { k = this.lightBest[j]; this.lightBest[j] = -2; break; }
      if (k < 0) { l.position.set(0, -50, 0); continue; }
      l.userData.k = k; l.position.set(this.lanterns[k * 3], this.lanterns[k * 3 + 1], this.lanterns[k * 3 + 2]); l.intensity = 0;
    }
  }
  /** One glow sprite over every ore / gem stone, in the ore's colour (gems brighter). */
  private buildOreGlow(M: MineModel): void {
    if (this.oreGlow) { this.oreGlow.removeFromParent(); this.oreGlow.geometry.dispose(); (this.oreGlow.material as THREE.Material).dispose(); this.oreGlow = null; }
    const F = M.F!, data: number[] = []; this.oreGlowCell = []; this.oreGlowSize = [];
    for (let i = 0; i < this.G.N; i++) {
      const c = F.cells[i], s = this.slots[i]; if (!c || !s || s.mass || !c.r || (c.t !== 'ore' && c.t !== 'rare') || c.r === 'coal') continue;
      const gem = CRYSTAL.has(c.r) || (c.t === 'rare' && c.r === F.gem), C = oreCol(c.r), p = this.G.cellXY(i);
      const size = gem ? 1.6 : c.t === 'rare' ? 1.3 : 1.0;
      _c.set(C[0]).lerp(new THREE.Color(C[1]), 0.35).multiplyScalar(gem ? 0.95 : 0.75);
      data.push(this.G.mx(p.cx), s.h * 0.75, this.G.mz(p.cy), size, _c.r, _c.g, _c.b);
      this.oreGlowCell.push(i); this.oreGlowSize.push(size);
      this.orePoolG[i] = gem ? 1.7 : 1.0;
      this.orePool[i] = this.addPool(this.G.mx(p.cx), s.h + 0.3, this.G.mz(p.cy), gem ? 4.6 : 3.4, C[gem ? 0 : 1], this.orePoolG[i]);
    }
    if (!data.length) return;
    this.oreGlow = glowPoints(data, 7, this.glowTex, { flicker: 0.18, intensity: 0.6 });
    this.oreGlow.name = 'mine:oreGlow'; this.oreGlow.renderOrder = 3;
    this.dynamic.add(this.oreGlow);
  }

  private rockColor(c: Cell, i: number): THREE.Color {
    const P = this.pal;
    if (c.t === 'wall') return _c.set(P.wall).lerp(new THREE.Color(P.wallL), rnd(i, 9) * 0.6);
    const base = c.t === 'hard' ? P.hard : P.rock;
    _c.set(base[0]);
    if (c.t === 'rock' && c.r && ROCK[c.r]) _c.lerp(new THREE.Color(ROCK[c.r]), 0.35);
    if ((c.t === 'ore' || c.t === 'rare') && c.r) _c.lerp(new THREE.Color(oreCol(c.r)[c.r === 'coal' ? 0 : 2]), c.t === 'rare' ? 0.3 : 0.18);
    _c.offsetHSL((rnd(i, 11) - 0.5) * 0.04, (rnd(i, 12) - 0.5) * 0.08, (rnd(i, 10) - 0.5) * 0.14);
    return _c;
  }

  private buildCave(kit: RoomKit, M: MineModel): void {
    const P = this.pal, F = M.F!;
    const zTop = Z_TOP - 3.6;
    // floor: a backing slab under the procedural ground (q1+), the plain hall / entrance boxes at q0
    const cs = this.caveSeed, q = this.quality, q1 = q >= 1;
    if (q1) kit.box('lowPaving', P.floor, -OUT_X - 2, OUT_X + 2, -0.5, -0.27, zTop - 2, Z_WALL + 2);
    else { kit.box('lowPaving', P.floor, -OUT_X - 2, OUT_X + 2, -0.2, 0, zTop - 2, 0); kit.box('lowPaving', P.floorL, -OUT_X - 2, OUT_X + 2, -0.2, 0, 0, Z_WALL + 2); }
    // q1+: the floor is real ground — seeded walkable relief (±17 cm swells and hollows, flat round the hall objects),
    // a worn path down the hall, scree heaped at the wall feet, grime towards the walls
    const FO: FloorOpts = {
      x0: -OUT_X - 1.2, x1: OUT_X + 1.2, z0: zTop - 1.5, z1: Z_WALL + 1.2, cell: q >= 2 ? 0.42 : 0.7, seed: cs,
      floor: mix(P.floor, P.rock[1], FLOOR_LIFT), floorL: mix(P.floorL, P.rock[1], FLOOR_LIFT), dark: mix(P.floor, P.wall, 0.6),
      walk: (x, z) => (z > 0 ? Math.abs(x) < OUT_X - 0.35 : Math.abs(x) < HALL_X - 0.05) && z > Z_TOP - 0.3 && z < Z_WALL - 0.3,
      worn: (x, z) => Math.max(0, 1 - Math.abs(x + Math.sin(z * 0.21 + cs) * 0.8) / 2.2) * (z < Z_BACK ? 1 : 0.5),
      wallDist: (x, z) => Math.min(OUT_X - Math.abs(x), z - zTop, Z_WALL - z),
      relief: RELIEF, reliefK: this.flatAround(), clear: this.clearSpots(),
      beds: [0, -0.4, 0, Z_TOP + 0.7],   // the cart track down the hall
    };
    if (q1) this.floorO = FO;
    if (q1) { const g = rockFloor(FO); kit.geo('lowPaving', g, _m.identity(), null, 1.0); g.dispose(); }
    const C: DressCol = { rock: P.rock[0], rockD: P.rock[2], floorL: P.floorL, dark: FO.dark };
    const fyy = (x: number, z: number) => (q1 ? fy(FO, x, z) : 0);
    // ceiling (dark rock) with timber frames every two rows
    kit.box('stone', P.wall, -OUT_X - 3, OUT_X + 3, CEIL, CEIL + 0.6, zTop - 3, Z_WALL + 3);
    // a lumpy rock ceiling under the flat backing (q1+): ribs and hanging masses
    const S = strataOf(P), cell = q >= 2 ? 0.55 : 0.8;
    if (q1) { const g = rockCeiling({ x0: -OUT_X - 0.5, x1: OUT_X + 0.5, z0: zTop - 1.5, z1: Z_WALL + 1, y: CEIL, amp: 0.62, cell: cell * 1.3, seed: 3 + cs, strata: S }); kit.geo('stone', g, _m.identity(), null, 1.6); g.dispose(); }
    for (let r = 0; r <= GH; r += 2) {
      const z = Z_TOP + r * CELL;
      for (const s of [-1, 1]) {
        timberPost(kit, s * HALL_X + s * 0.05, z, 4.3, q, undefined, fyy(s * HALL_X, z) - 0.06);
        kit.rbox('wood', '#6e4626', s * (HALL_X - 0.45), 3.95, z, 0.12, 1.1, 0.12, 0, 0, s * 0.75);
        // a real lantern on an iron bracket off the post (its light = a warm pool + a real light nearby)
        const lx = s * (HALL_X - 0.52), ly = 2.55, lz = z;
        lantern3d(kit, lx, ly, lz, { q, glass: P.lamp, mount: 'bracket', wx: -s, wz: 0, arm: 0.42 });
        kit.glow(lx, ly, lz, 0.55, GLOW, 0.85);
        this.addPool(lx, ly - LP_DROP, lz, LP_R, P.lamp, LP_GAIN);
        this.lanterns.push(lx - s * 0.6, ly + 0.2, lz);
      }
      kit.box('wood', '#7a4e2a', -HALL_X - 0.2, HALL_X + 0.2, 4.3, 4.6, z - 0.16, z + 0.16);
      // over the middle of the hall: a lantern on a chain from every other cap beam (the floor between the walls gets
      // its own pools of light)
      if (r % 4 === 2 || r === GH) {
        const hx = (r % 8 === 2 ? -1 : 1) * 2.4, hz = z + 0.05;
        lantern3d(kit, hx, 3.05, hz, { q, glass: P.lamp, mount: q1 ? 'chain' : 'none', top: 4.3 });
        kit.glow(hx, 3.05, hz, 0.55, GLOW, 0.85);
        this.addPool(hx, 3.05 - LP_DROP, hz, LP_R + 0.3, P.lamp, LP_GAIN);
        this.lanterns.push(hx, 3.0, hz);
      }
      // stringers from frame to frame along the walls and lagging boards over them (the timbered roof of the hall's sides)
      if (q1 && r + 2 <= GH) for (const s of [-1, 1]) {
        const z1 = z + 2 * CELL, sx = s * (HALL_X - 0.95);
        kit.bevel('wood', '#6e4626', sx - 0.11, sx + 0.11, 4.6, 4.82, z, z1, 0.02);
        for (let lz2 = z + 0.35, k = 0; lz2 < z1 - 0.2; lz2 += 0.55, k++) {
          if (rnd(k + r * 13 + cs + (s > 0 ? 7 : 0), 57) < 0.18) continue;   // a board missing here and there
          kit.rbox('wood', ['#7a4e2a', '#6a4424', '#8a5a32'][(k + r) % 3], s * (HALL_X - 0.55), 4.86, lz2, 1.25, 0.05, 0.4, (rnd(k + r, 58) - 0.5) * 0.08);
        }
      }
    }
    // side walls of the hall and the entrance: flat backing boxes, and in front of them (q1+) continuous rock faces with
    // real relief and the layer's strata (q0: the old rows of wall-rock lumps)
    // (q1+: the backing sits a metre further out, behind the relief of the faces)
    const bk = q1 ? 1.1 : 0;
    for (const s of [-1, 1]) {
      kit.box('stone', P.wall, s * (OUT_X + bk), s * (OUT_X + 1.5 + bk), 0, CEIL, zTop - 2 - bk, Z_WALL + 2 + bk);
      if (!bk) kit.box('stone', P.wallL, s * HALL_X, s * (OUT_X + 0.01), 0, 0.5, Z_TOP, 0);
    }
    kit.box('stone', P.wall, -OUT_X - 2 - bk, OUT_X + 2 + bk, 0, CEIL, Z_WALL + bk, Z_WALL + 1.2 + bk);
    kit.box('stone', P.wall, -OUT_X - 2 - bk, OUT_X + 2 + bk, 0, CEIL, zTop - 1.2 - bk, zTop - bk);
    const lump = rockGeo('pillar', 1);
    if (q1) {
      const face = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number, amp: number, talus: number, seed: number) => {
        const g = rockFace({ ax, az, bx, bz, h: CEIL + 0.1, nx, nz, amp, talus, cell, seed: seed + cs, strata: S, y0: -0.3 });
        kit.geo('stone', g, _m.identity(), null, 1.6); g.dispose();
      };
      for (const s of [-1, 1]) face(s * (OUT_X + 0.25), zTop - 1.6, s * (OUT_X + 0.25), Z_WALL + 1.0, -s, 0, 0.55, 0.75, s > 0 ? 11 : 23);
      face(-OUT_X - 1.0, zTop - 0.2, OUT_X + 1.0, zTop - 0.2, 0, 1, 0.55, 0.7, 37);
      face(-OUT_X - 1.0, Z_WALL + 0.35, OUT_X + 1.0, Z_WALL + 0.35, 0, -1, 0.25, 0.15, 41);   // behind the spawn: shallow (the TP camera is there)
      // the side strips (wall feet, never walked): outcrops, scree mounds, rock teeth, tools, crates by the frames
      let k = 0;
      for (let z = zTop + 0.9; z < Z_BACK - 1; z += 1.45, k++) for (const s of [-1, 1]) {
        const kk = k * 2 + (s > 0 ? 1 : 0) + cs * 3, x = s * (HALL_X + 0.45 + rnd(kk, 3) * 0.35), zz = z + (rnd(kk, 6) - 0.5) * 0.6;
        const nearFrame = Math.abs(((zz - Z_TOP) % (2 * CELL) + 2 * CELL) % (2 * CELL) - 0) < 0.5 || Math.abs(((zz - Z_TOP) % (2 * CELL) + 2 * CELL) % (2 * CELL) - 2 * CELL) < 0.5;
        const t = rnd(kk, 7);
        if (nearFrame) rubble(kit, FO, x, zz, 0.35, q >= 2 ? 6 : 3, kk, C);
        else if (k % 4 === 2 && P.layer) {   // the depth layer's own piece (roots, crystals, magma, a fossil log …)
          const L = layerPiece(kit, FO, P.layer, s * (HALL_X + 0.35), zz, -s, 0, kk, { ...C, glow: P.glow || P.mush, lamp: P.lamp });
          if (L) this.addPool(L[0], L[1], L[2], L[3], L[4], 1.2);
        }
        else if (t < 0.32) outcrop(kit, FO, x, zz, 0.42 + rnd(kk, 2) * 0.35, 0.4 + rnd(kk, 1) * 0.5, kk, mix(P.wall, P.wallL, 0.4 + rnd(kk, 5) * 0.5));
        else if (t < 0.6) rubble(kit, FO, x, zz, 0.5, q >= 2 ? 11 : 5, kk, C);
        else if (t < 0.74) stalagmite(kit, FO, x, zz, 0.6 + rnd(kk, 8) * 0.8, kk, mix(P.wall, P.wallL, 0.6), P.wall);
        else if (t < 0.86) toolPile(kit, FO, s * (HALL_X + 0.25), zz, -s, 0, kk, oreCol(F.cells.find((c) => c && c.r && c.t === 'ore')?.r || 'iron')[0]);
        else crateOrBarrel(kit, FO, s * (HALL_X + 0.55), zz, kk);
      }
      // the back of the hall (behind the last row, rock shelf): bigger outcrops and rubble
      for (let j = 0; j < 9; j++) {
        const x = -HALL_X + (j + 0.5) * (2 * HALL_X / 9) + (rnd(j + cs, 44) - 0.5), z = zTop + 1.0 + rnd(j + cs, 45) * 1.6;
        if (rnd(j + cs, 46) < 0.5) outcrop(kit, FO, x, z, 0.6 + rnd(j, 47) * 0.6, 0.6 + rnd(j, 48) * 0.7, j + cs, mix(P.wall, P.wallL, 0.3 + rnd(j, 49) * 0.5));
        else rubble(kit, FO, x, z, 0.7, q >= 2 ? 12 : 5, j + cs * 5, C);
      }
    } else {
      // the SIDE strips (x < 64 px) are rock shelves with lumps; scatter wall rocks along them
      for (let z = zTop; z < Z_WALL + 0.5; z += 1.1) {
        for (const s of [-1, 1]) {
          const k = Math.round(z * 10) + (s > 0 ? 7 : 0), h = 2.6 + rnd(k, 1) * 3.4, w = 1.1 + rnd(k, 2) * 0.8;
          const x = s * (OUT_X + 0.1 + rnd(k, 3) * 0.4);
          _q.setFromAxisAngle(_up, rnd(k, 4) * 6.28);
          kit.geo('stone', lump.geo, _m.compose(_p.set(x, -0.05, z), _q, _s.set(w, h, w)), mix(P.wall, P.wallL, rnd(k, 5) * 0.7), 1);
        }
      }
      // back walls: a row of big rock lumps
      // (the back row behind the entrance is set into the wall: the third-person camera stands there at the spawn)
      for (const [zw, n] of [[zTop + 0.2, 16], [Z_WALL + 0.45, 16]] as const) for (let k = 0; k < n; k++) {
        const x = -OUT_X + (k + 0.5) * (2 * OUT_X / n), kk = k + (zw > 0 ? 100 : 200), h = 2.8 + rnd(kk, 1) * 3, w = zw > 0 ? 0.8 + rnd(kk, 2) * 0.35 : 1.0 + rnd(kk, 2) * 0.6;
        _q.setFromAxisAngle(_up, rnd(kk, 4) * 6.28);
        kit.geo('stone', lump.geo, _m.compose(_p.set(x, -0.05, zw), _q, _s.set(w, h, w)), mix(P.wall, P.wallL, rnd(kk, 5) * 0.7), 1);
      }
    }
    // the ceiling: stalactite clusters round rock bosses (q1+), single drips at q0 — off the frames' beams
    if (q1) {
      for (let k = 0, made = 0; k < 60 && made < (q >= 2 ? 22 : 12); k++) {
        const x = (rnd(k + cs, 11) - 0.5) * 2 * (OUT_X - 0.6), z = zTop + 0.5 + rnd(k + cs, 12) * (Z_BACK - zTop - 1);
        const fz = ((z - Z_TOP) % (2 * CELL) + 2 * CELL) % (2 * CELL); if (fz < 0.7 || fz > 2 * CELL - 0.7) continue;
        if (Math.abs(x) > HALL_X - 1.6 && Math.abs(x) < HALL_X + 0.4) continue;   // the timbered sides
        stalactiteCluster(kit, x, z, CEIL - 0.25, 0.45 + rnd(k + cs, 13) * 0.55, k + cs, mix(P.wall, P.wallL, 0.65), mix(P.wall, P.wallL, 0.2), q >= 2 ? 6 : 4);
        made++;
      }
    } else {
      const cone = new THREE.ConeGeometry(1, 1, 5).rotateX(Math.PI);
      for (let k = 0; k < 40; k++) {
        const x = (rnd(k + cs, 11) - 0.5) * 2 * OUT_X, z = zTop + rnd(k + cs, 12) * (Z_WALL - zTop), h = 0.4 + rnd(k + cs, 13) * 0.9, r = 0.12 + rnd(k + cs, 14) * 0.15;
        kit.geo('stone', cone, _m.compose(_p.set(x, CEIL - h / 2, z), _q.identity(), _s.set(r, h, r)), mix(P.wall, P.wallL, 0.5), 1);
      }
      cone.dispose();
    }
    // seeded dressing: scree, gravel, puddles, hanging rocks, roots, cobwebs where the frames meet the walls
    const webs: [number, number, number, number, number, number, number][] = [];
    for (let r = 0; r <= GH; r += 2) for (const sx of [-1, 1]) if (rnd(r + cs, 51) < 0.45) webs.push([sx * (HALL_X - 0.12), 4.28, Z_TOP + r * CELL + 0.16, -sx, 0, -1, 0.45 + rnd(r + cs, 52) * 0.3]);
    dressCave(kit, { F: FO, seed: cs, ceil: CEIL - 0.1, q, rock: P.rock[0], rockD: P.rock[2], pud: P.pud, roots: !!P.moss || P.deco === 'moss', webs });
    // the hall floor (walkable, flat pieces only): what every dug stone leaves behind (laid inside the stone: hidden
    // until it is dug), ore crumbs, flagstones, cracks; void cells: puddles or pits with planks
    for (let i = 0; i < this.G.N; i++) {
      const c = F.cells[i]; if (!c) continue;
      const p = this.G.cellXY(i), x = this.G.mx(p.cx), z = this.G.mz(p.cy);
      if (c.t === 'void') {
        if (!q1) { if (P.pud) kit.box('water', P.pud, x - 0.8, x + 0.8, -0.1, 0.015, z - 0.7, z + 0.7); continue; }
        if (P.pud || rnd(i + cs, 19) < 0.35) puddle(kit, FO, x, z, 0.6 + rnd(i, 20) * 0.3, 0.5 + rnd(i, 21) * 0.2, P.pud || DAMP);
        else pitPlanks(kit, FO, x, z, 1.25, 1.0, rnd(i + cs, 22) * 3, i + cs, C);
        continue;
      }
      if (!q1 || c.t === 'wall' || c.t === 'entry') continue;
      const ore = (c.t === 'ore' || c.t === 'rare') && c.r ? oreCol(c.r)[0] : null;
      remains(kit, FO, x, z, i * 7 + cs, C, ore, q);
    }
    if (q1) {
      const area = (2 * HALL_X) * (-Z_TOP);
      for (let k = 0, n = Math.round(area * (q >= 2 ? 0.05 : 0.02)); k < n; k++) {
        const x = (rnd(k + cs, 201) - 0.5) * 2 * (HALL_X - 0.4), z = Z_TOP + 0.3 + rnd(k + cs, 202) * (-Z_TOP - 0.8);
        if (!FO.walk(x, z) || FO.clear!(x, z) || Math.abs(x) < 0.75) continue;
        const nS = 1 + Math.floor(rnd(k, 203) * 3);
        for (let j = 0; j < nS; j++) slab(kit, FO, x + (rnd(k * 3 + j, 204) - 0.5) * 0.9, z + (rnd(k * 3 + j, 205) - 0.5) * 0.9, 0.22 + rnd(k * 3 + j, 206) * 0.28, rnd(k * 3 + j, 207) * 6, mix(P.floorL, P.rock[0], 0.25 + rnd(k * 3 + j, 208) * 0.35), k * 3 + j);
      }
      for (let k = 0, n = q >= 2 ? 16 : 7; k < n; k++) {
        const x = (rnd(k + cs, 211) - 0.5) * 2 * (HALL_X - 0.6), z = Z_TOP + 0.5 + rnd(k + cs, 212) * (-Z_TOP - 1.5);
        if (!FO.walk(x, z) || FO.clear!(x, z)) continue;
        crack(kit, FO, x, z, rnd(k + cs, 213) * 6.28, 0.9 + rnd(k, 214) * 1.8, k * 5 + cs, C);
      }
      // bedrock breaking through the dirt here and there (low crisp-edged shelves)
      for (let k = 0, n = q >= 2 ? 14 : 6; k < n; k++) {
        const x = (rnd(k + cs, 221) - 0.5) * 2 * (HALL_X - 0.8), z = Z_TOP + 0.6 + rnd(k + cs, 222) * (-Z_TOP - 1);
        if (!FO.walk(x, z) || FO.clear!(x, z) || Math.abs(x) < 0.8) continue;
        shelf(kit, FO, x, z, k * 11 + cs, mix(P.rock[2], P.wall, 0.3), P.wall);
      }
      // the cart track: down the middle of the hall from its end to the entrance, a buffer stop at the far end
      railTrack(kit, FO, [0, -0.4, 0, Z_TOP + 0.7], { stop: true, seed: cs });
    }
    const ent = F.entry >= 0 && F.entry < this.G.N ? F.entry : (GH - 1) * GW + 3;
    const ex = this.G.mx(this.G.cellXY(ent).cx), ez = this.G.mz(Y0 + (Math.floor(ent / GW) + 1) * CW);
    for (const s of [-1, 1]) kit.box('wood', '#7a4e2a', ex + s * 1.12 - 0.13, ex + s * 1.12 + 0.13, -0.2, 3.0, ez - 0.13, ez + 0.13);
    kit.box('wood', '#8a5a32', ex - 1.4, ex + 1.4, 3.0, 3.3, ez - 0.16, ez + 0.16);
    kit.sign('ШАХТА', ex, 3.55, ez + 0.2, 1.3, 0, { bg: '#5a3a1e', fg: '#ffd23f' });
    kit.light(ex, 2.6, ez + 0.6, P.lamp, 5, 9, 0); this.addPool(ex, 2.6, ez + 0.6, 6.5, P.lamp, 0.8); this.lanterns.push(ex, 2.8, ez + 1.2);
    lantern3d(kit, ex, 2.55, ez + 0.42, { q, glass: P.lamp, mount: 'bracket', wx: 0, wz: 1, arm: 0.28 });
    kit.glow(ex, 2.55, ez + 0.42, 0.55, GLOW, 0.85);
    // behind the entrance area (camera room): a timber frame along the back wall, two lanterns, a few crates
    for (const x of [-6, -2, 2, 6]) kit.box('wood', '#6e4626', x - 0.13, x + 0.13, 0, CEIL - 0.6, Z_WALL - 0.55, Z_WALL - 0.3);
    kit.box('wood', '#7a4e2a', -OUT_X, OUT_X, CEIL - 0.9, CEIL - 0.6, Z_WALL - 0.6, Z_WALL - 0.25);
    for (const x of [-4, 4]) {
      lantern3d(kit, x, 2.6, Z_WALL - 0.85, { q, glass: P.lamp, mount: q1 ? 'chain' : 'none', top: CEIL - 0.9 });
      kit.glow(x, 2.6, Z_WALL - 0.85, 0.55, GLOW, 0.85);
      this.addPool(x, 2.75, Z_WALL - 0.9, 6, P.lamp, 0.9);
    }
    for (const [x, sd] of [[-7.6, 4], [-6.8, 1], [7.4, 2], [0.5, 9]] as const) crateOrBarrel(kit, FLAT, x, Z_WALL - 1.2 - rnd(Math.round(x * 10), 7) * 0.4, sd, 1.0);
    // rails from the entrance into the cart area
    const cart = this.footM('cart');
    if (q1) railTrack(kit, FO, [-OUT_X + 0.3, cart.cz, ex - 1.5, cart.cz], { seed: cs + 1 });
    else {
      const x0 = -OUT_X + 0.3, x1 = ex - 1.5, z = cart.cz;
      for (const o of [-0.32, 0.32]) kit.box('metal', '#8a8a9a', x0, x1, 0, 0.07, z + o - 0.03, z + o + 0.03);
      for (let x = x0; x < x1; x += 0.55) kit.box('wood', '#5a3a1e', x, x + 0.18, 0, 0.04, z - 0.5, z + 0.5);
    }
    // grass / moss on the floor by nature
    if (P.deco === 'grass' || P.moss) {
      // tufts only along the walls and the back (never in the walkway, where they read as spikes)
      for (let k = 0; k < 60; k++) {
        const side = k % 2 ? 1 : -1, x = side * (OUT_X - 0.25 - rnd(k, 21) * 0.9), z = rnd(k, 22) * Z_WALL;
        kit.cone('leaf', P.moss ? '#5f9e3a' : '#7fae4a', x, fyy(x, z) - 0.02, z, 0.05 + rnd(k, 23) * 0.04, 0.1 + rnd(k, 24) * 0.1, true);
      }
    }
  }

  /**
   * Relief multiplier: 0 on and round the hall objects (FOOT rects + 1 m, smooth to 1 by 2.5 m), on the spawn and the
   * entrance's cart rails; 1 in the open hall / tunnels.
   */
  private flatAround(): (x: number, z: number) => number {
    const R = this.G.FOOT.map((f) => [this.G.mx(f.r[0]), this.G.mx(f.r[2]), this.G.mz(f.r[1]), this.G.mz(f.r[3])]);
    if (this.G.v3) { const [hx, hy, hw, hh] = this.G.hall; R.push([this.G.mx(hx), this.G.mx(hx + hw), this.G.mz(hy), this.G.mz(hy + hh)]); }
    else { const c = this.footM('cart'); R.push([-OUT_X - 1, OUT_X + 1, c.cz - 0.6, c.cz + 0.6]); R.push([-OUT_X - 1, OUT_X + 1, Z_WALL - 2.2, Z_WALL + 2]); }   // the rails; the camera's strip behind the spawn
    return (x, z) => {
      let d = 1e9;
      for (const r of R) d = Math.min(d, Math.hypot(Math.max(r[0] - x, 0, x - r[1]), Math.max(r[2] - z, 0, z - r[3])));
      const t = Math.max(0, Math.min(1, (d - 1) / 1.5));
      return t * t * (3 - 2 * t);
    };
  }
  /** Spots loose stones keep off: the hall objects (FOOT + 0.8 m), the classic entrance's rails, the big floor's lift hall. */
  private clearSpots(): (x: number, z: number) => boolean {
    const R = this.G.FOOT.map((f) => [this.G.mx(f.r[0]) - 0.8, this.G.mx(f.r[2]) + 0.8, this.G.mz(f.r[1]) - 0.8, this.G.mz(f.r[3]) + 0.8]);
    if (this.G.v3) { const [hx, hy, hw, hh] = this.G.hall; R.push([this.G.mx(hx) - 0.5, this.G.mx(hx + hw) + 0.5, this.G.mz(hy) - 0.5, this.G.mz(hy + hh) + 0.5]); }
    else { const c = this.footM('cart'); R.push([-OUT_X, OUT_X, c.cz - 0.8, c.cz + 0.8]); }
    return (x, z) => R.some((r) => x > r[0] && x < r[1] && z > r[2] && z < r[3]);
  }
  /** Room-space rectangle of an object of the entrance area / lift hall (site FOOT r). */
  private footM(k: string): { x0: number; x1: number; z0: number; z1: number; cx: number; cz: number } {
    const G = this.G, f = G.FOOT.find((q) => q.k === k), r = f ? f.r : [0, 0, 0, 0];
    return { x0: G.mx(r[0]), x1: G.mx(r[2]), z0: G.mz(r[1]), z1: G.mz(r[3]), cx: G.mx((r[0] + r[2]) / 2), cz: G.mz((r[1] + r[3]) / 2) };
  }
  /** Set an object's hit volume in place (the interactables hold these Box3 objects: a new floor moves them). */
  private setBox(k: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const b = this.objBoxes[k] || (this.objBoxes[k] = new THREE.Box3());
    b.min.set(x0, y0, z0); b.max.set(x1, y1, z1);
  }

  private buildEntrance(kit: RoomKit): void {
    const P = this.pal, v3 = this.G.v3, lift = v3 ? 'ЛИФТ' : 'В ГОРОД ↑';
    // the far wall of the area for the decor crates (classic: the outer wall; big floor: the lift hall's edge)
    const xMax = v3 ? this.G.mx(this.G.hall[0] + this.G.hall[2]) : OUT_X;
    // lift «В ГОРОД»: a timber cage with a platform, ropes to the ceiling
    const L = this.footM('lift');
    kit.box('wood', '#8a5a32', L.x0, L.x1, 0, 0.18, L.z0, L.z1);
    // slim cage: corner posts up to a top frame at 3 m, only the hoist ropes go on to the ceiling (it stands right by
    // the spawn — thick posts to the ceiling framed the third-person view like a doorway)
    for (const [x, z] of [[L.x0, L.z0], [L.x1, L.z0], [L.x0, L.z1], [L.x1, L.z1]]) kit.box('wood', '#6e4626', x - 0.07, x + 0.07, 0, 3.0, z - 0.07, z + 0.07);
    kit.box('wood', '#6e4626', L.x0, L.x1, 2.9, 3.02, L.z0 - 0.07, L.z0 + 0.07);
    kit.box('wood', '#6e4626', L.x0, L.x1, 2.9, 3.02, L.z1 - 0.07, L.z1 + 0.07);
    for (const x of [L.x0, L.x1]) kit.box('wood', '#6e4626', x - 0.07, x + 0.07, 2.9, 3.02, L.z0, L.z1);
    kit.box('metal', '#3a3448', L.x0 + 0.3, L.x1 - 0.3, 1.0, 1.06, L.z1 - 0.05, L.z1 + 0.05);
    for (const x of [L.cx - 0.5, L.cx + 0.5]) kit.box('metal', '#c8b890', x - 0.015, x + 0.015, 3.0, CEIL, L.cz - 0.015, L.cz + 0.015);
    kit.sign(lift, L.cx, 3.35, v3 ? L.z1 + 0.1 : L.z0 - 0.1, 2.0, v3 ? 0 : Math.PI, { bg: v3 ? '#2e5a2a' : '#3a2a5e', fg: v3 ? '#e8ffd8' : '#ffd23f' });
    if (!v3) kit.sign(lift, L.x1 + 0.1, 3.35, L.cz, 1.4, Math.PI / 2, { bg: '#3a2a5e', fg: '#ffd23f' });
    kit.light(L.cx, 2.4, L.z0 - 0.3, '#ffcf6a', 5, 8, 1.2); this.addPool(L.cx, 2.4, L.z0 - 0.3, 5.5, '#ffcf6a', 0.9);
    // the lift in full (q1+): headframe, pulley, ropes, counterweight, barred cage, gate, a lantern; crates and rope by it
    if (this.quality >= 1) {
      const fr: 1 | -1 = v3 ? 1 : -1;
      liftRig(kit, L, v3 ? CEIL3 : CEIL, fr, this.quality, v3);
      this.addPool(L.cx, 2.4, (fr > 0 ? L.z0 : L.z1) + fr * 0.25, 3.2, '#ffcf6a', 0.6);
      // the big floor's lift hall: crates and a coil of rope behind the cage (the classic lift backs onto the camera's room)
      if (v3) { const bz = L.z0 - 0.55; crateStack(kit, L.x0 + 0.35, bz, 0.2, 3, 2); ropeCoil(kit, L.x1 - 0.3, bz); }
      kit.splash(L.cx, 0.2, L.cz + fr * (L.z1 - L.z0) * 0.5 + fr * 0.8, 3.0, 2.4, '#ffcf6a', 0.25, 0, -Math.PI / 2);
    }
    this.setBox('lift', L.x0, 0, L.z0, L.x1, 2.6, L.z1);
    kit.solid(L.x0, L.x1, L.z0, L.z1, Infinity);
    // minecart on the rails, full of ore — low (≈1 m) and at the lift end of its spot, so it never fills the view
    // from the spawn (players spawn right in front of it) or the third-person camera
    if (!v3) {
    const C = this.footM('cart'), ccx = Math.min(C.cx, C.x0 + 0.75);
    kit.box('metal', '#4a4458', ccx - 0.7, ccx + 0.7, 0.28, 0.74, C.cz - 0.44, C.cz + 0.44);
    kit.box('wood', '#8a5a32', ccx - 0.75, ccx + 0.75, 0.7, 0.78, C.cz - 0.48, C.cz + 0.48);
    for (const sx of [-0.42, 0.42]) kit.box('metal', '#2a2440', ccx + sx - 0.04, ccx + sx + 0.04, 0.28, 0.74, C.cz - 0.45, C.cz + 0.45);
    const wheel = new THREE.CylinderGeometry(0.17, 0.17, 0.08, 12).rotateX(Math.PI / 2);
    for (const sx of [-0.5, 0.5]) for (const sz of [-0.42, 0.42]) kit.geo('metal', wheel, _m.makeTranslation(ccx + sx, 0.2, C.cz + sz), '#2a2440', 1);
    wheel.dispose();
    for (let k = 0; k < 9; k++) kit.geo('stone', chipGeo(k), _m.compose(_p.set(ccx + (rnd(k, 31) - 0.5) * 1.0, 0.8 + rnd(k, 32) * 0.06, C.cz + (rnd(k, 33) - 0.5) * 0.6), _q.setFromAxisAngle(_up, k * 1.7), _s.set(0.19, 0.15, 0.17)), k % 3 ? P.rock[0] : '#c8643a', 1);
    kit.solid(C.x0, C.x1, C.z0, C.z1, 0.8);
    // the rest of the cart's (not walkable) spot: a buffer stop and a low heap of ore sacks — nothing tall
    kit.box('wood', '#5a3a1e', C.x1 - 0.5, C.x1 - 0.3, 0, 0.45, C.cz - 0.5, C.cz + 0.5);
    for (let k = 0; k < 4; k++) sack(kit, C.x1 - 1.0 - k * 0.5, 0, C.cz + (k % 2 ? 0.62 : -0.62) + (rnd(k, 37) - 0.5) * 0.1, rnd(k, 38) * 6, 1, k % 2 ? '#b89a70' : '#a88a62');
    }
    // quest board «ПОРУЧЕНИЯ»
    const B = this.footM('board');
    // a low slanted notice desk (≈1.5 m) instead of a tall roofed board: it stands between the spawn and the hall
    // portal, so it must not cut the sightline; faces its use spot / the spawn (+Z) and carries pinned notices
    const bw = 1.7, bz = B.cz;
    for (const sx of [-1, 1]) kit.box('wood', '#6e4626', B.cx + sx * (bw / 2 - 0.12) - 0.06, B.cx + sx * (bw / 2 - 0.12) + 0.06, 0, 1.25, bz - 0.06, bz + 0.06);
    kit.rbox('wood', '#8a5a32', B.cx, 1.2, bz + 0.05, bw, 0.75, 0.07, 0, -0.5);
    kit.rbox('wood', '#5a3a1e', B.cx, 0.83, bz + 0.22, bw + 0.08, 0.05, 0.1, 0, -0.5);
    const notes = ['#f7e8d0', '#ffe9a8', '#f2d6c8', '#e8f0d8', '#f7e8d0'];
    for (let k = 0; k < 5; k++) {
      const nx = B.cx - bw / 2 + 0.25 + k * 0.3 + (rnd(k, 61) - 0.5) * 0.06, ny = 1.12 + (k % 2) * 0.2;
      kit.rbox('flat', notes[k], nx, ny, bz + 0.09 + (1.2 - ny) * 0.55 * 0.5, 0.22, 0.26, 0.012, (rnd(k, 62) - 0.5) * 0.2, -0.5);
    }
    kit.sign('ПОРУЧЕНИЯ', B.cx, 1.78, bz - 0.12, 1.2, 0, { bg: '#7a0f1d', fg: '#ffd23f' });
    kit.sign('ПОРУЧЕНИЯ', B.cx, 1.78, bz - 0.14, 1.2, Math.PI, { bg: '#7a0f1d', fg: '#ffd23f' });
    for (const sx of [-1, 1]) kit.box('wood', '#6e4626', B.cx + sx * 0.5 - 0.03, B.cx + sx * 0.5 + 0.03, 1.25, 1.62, bz - 0.16, bz - 0.1);
    // hit = the board itself (not its whole floor spot: the spawn is right next to it, the crosshair kept catching it)
    this.setBox('board', B.cx - 0.9, 0.3, B.cz - 0.3, B.cx + 0.9, 1.95, B.cz + 0.4);
    kit.solid(B.x0, B.x1, B.z0, B.z1, Infinity);
    // buyer «СКУПКА»: a stall with a striped awning, crates of ore, scales
    const S = this.footM('buyer');
    kit.prop('stall', S.cx, 0, S.cz, Math.PI, 1.35, { solid: false, colors: ['#e0605a', '#f7e8d0'] });
    kit.sign('СКУПКА', S.cx, 3.3, S.cz - 0.3, 2.0, Math.PI, { bg: '#e0605a', fg: '#ffffff' });
    kit.sign('СКУПКА', S.cx, 3.3, S.cz + 0.3, 2.0, 0, { bg: '#e0605a', fg: '#ffffff' });
    for (const [dx, dz, sd] of [[-2.6, -0.2, 4], [2.4, 0.3, 1], [2.7, -0.6, 2]] as const) if (S.cx + dx < xMax - 0.5) crateOrBarrel(kit, this.floorO ?? FLAT, S.cx + dx, S.cz + dz, sd, 1.05);
    kit.light(S.cx, 2.4, S.z0 - 0.6, '#ffb35c', 6, 9, 1.4); this.addPool(S.cx, 2.4, S.z0 - 0.6, 6, '#ffb35c', 1.0);
    this.setBox('buyer', S.x0, 0, S.z0, S.x1, 2.8, S.z1);
    kit.solid(S.x0, S.x1, S.z0, S.z1, Infinity);
    // supplier's lamp post: a tall post with lanterns + a crate of helmets
    const Lp = this.footM('lamp');
    kit.prop('lamp', Lp.cx - 0.5, 0, Lp.cz, 0, 1, { solid: false });
    kit.prop('crate', Lp.cx + 0.5, 0, Lp.cz, 0.2, 0.8, { solid: false });
    for (let k = 0; k < 3; k++) kit.ball('flat', '#ffcf3a', Lp.cx + 0.3 + k * 0.22, 0.72, Lp.cz - 0.05, 0.12, 0.7);
    kit.light(Lp.cx - 0.5, 2.9, Lp.cz, '#ffcf6a', 6, 9, 1.4); this.addPool(Lp.cx - 0.5, 2.9, Lp.cz, 6.5, '#ffcf6a', 1.0);
    this.setBox('lamp', Lp.x0, 0, Lp.z0, Lp.x1, 3.2, Lp.z1);
    kit.solid(Lp.x0, Lp.x1, Lp.z0, Lp.z1, Infinity);
  }

  private buildTop(kit: RoomKit, M: MineModel): void {
    const F = M.F!;
    const col = F.exit >= 0 && F.exit < GW ? F.exit : 3;
    const x = this.G.mx(SIDE + col * CW + CW / 2), z = Z_TOP - 1.6;
    kit.box('wood', '#8a5a32', x - 1.2, x + 1.2, 0, 0.18, z - 1.0, z + 1.0);
    for (const [dx, dz] of [[-1.1, -0.9], [1.1, -0.9], [-1.1, 0.9], [1.1, 0.9]]) kit.box('wood', '#6e4626', x + dx - 0.1, x + dx + 0.1, 0, CEIL, z + dz - 0.1, z + dz + 0.1);
    kit.box('wood', '#6e4626', x - 1.2, x + 1.2, 2.6, 2.75, z + 0.85, z + 1.0);
    kit.sign('СПУСК ↓', x, 3.15, z + 1.05, 1.8, 0, { bg: '#3a2a5e', fg: '#ffd23f' });
    this.setBox('up', x - 1.2, 0, z - 1.0, x + 1.2, 2.6, z + 1.0);
    this.upLamp.position.set(x, 2.45, z + 1.0); this.upGlow.position.set(x, 2.2, z + 1.4);
    // the top area behind the last row is rock shelf (not walkable): low boulders
    const lump = rockGeo('round', 1);
    for (let k = 0; k < 14; k++) {
      const bx = -HALL_X + rnd(k, 41) * 2 * HALL_X, bz = Z_TOP - 0.8 - rnd(k, 42) * 5;
      if (Math.abs(bx - x) < 1.8 && bz > z - 1.6) continue;
      const s = 0.7 + rnd(k, 44) * 0.8;
      if (this.floorO) { outcrop(kit, this.floorO, bx, bz, s, s * 1.1, k + 300, mix(this.pal.wall, this.pal.wallL, 0.6)); continue; }
      _q.setFromAxisAngle(_up, rnd(k, 43) * 6.28);
      kit.geo('stone', lump.geo, _m.compose(_p.set(bx, -0.05, bz), _q, _s.set(s, s * 1.2, s)), mix(this.pal.wall, this.pal.wallL, 0.6), 1);
    }
  }

  /** Dust motes drifting in the lit part of the cave: the hall + entrance (classic) or the lift hall (big floor). */
  private buildMotes(): void {
    if (this.motes) { this.motes.dispose(); this.motes = null; }
    if (this.quality < 1) return;
    const G = this.G;
    let box: { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number };
    if (G.v3) { const [hx, hy, hw, hh] = G.hall; box = { x0: G.mx(hx) - 3, x1: G.mx(hx + hw) + 3, z0: G.mz(hy) - 3, z1: G.mz(hy + hh) + 3, y0: 0.3, y1: 4.2 }; }
    else box = { x0: -HALL_X, x1: HALL_X, z0: Z_TOP + 6, z1: Z_BACK, y0: 0.3, y1: 4.2 };
    this.motes = buildAtmos({ quality: this.quality, box, shafts: [], warm: '#ffcf8a', motes: this.quality >= 2 ? 170 : 70, size: 0.03, seed: 77 });
    if (this.motes) this.root.add(this.motes.group);
  }

  private buildNpcs(): void {
    const mk = (seed: string, name: string, lk: Record<string, unknown>, x: number, z: number, face: number) => {
      const app = appearanceFrom(seed, { n: name, lk: { ...lk, hat: 'miner' }, g: { h: 'miner', hr: 'common', a: 'robe', ar: 'uncommon' } }, this.style);
      const av = this.avKit.create(app);
      av.root.position.set(x, this.groundAt(x, z), z); av.root.rotation.y = face;
      this.root.add(av.root); this.npcs.push(av);
      return av;
    };
    const nb = this.footM('npcBuy'), nl = this.footM('npcLamp');
    mk('mine-buyer', 'Скупщик Гром', { shape: 'bean', color: '#8a6a4a', eyes: 'happy', mouth: 'grin', acc: ['mustache'] }, nb.cx, nb.cz, Math.PI * 0.85);
    mk('mine-supplier', 'Снабженец Кремень', { shape: 'egg', color: '#6a7a8a', eyes: 'dots', acc: ['scarf'], accColor: '#e0605a' }, nl.cx, nl.cz, Math.PI * 0.8);
    this.labels.set('npc:buyer', { name: 'Скупщик Гром', color: '#ffd23f' });
    this.labels.set('npc:lamp', { name: 'Снабженец Кремень', color: '#ffd23f' });
    this.anchors.set('npc:buyer', new THREE.Vector3(nb.cx, 1.75, nb.cz));
    this.anchors.set('npc:lamp', new THREE.Vector3(nl.cx, 1.75, nl.cz));
    this.setBox('npcBuy', nb.x0 - 0.2, 0, nb.z0 - 0.2, nb.x1 + 0.2, 1.6, nb.z1 + 0.2);
    this.setBox('npcLamp', nl.x0 - 0.2, 0, nl.z0 - 0.2, nl.x1 + 0.2, 1.6, nl.z1 + 0.2);
  }

  /** Ore nuggets / gem crystals on ore and rare stones (stable per floor; hidden with the stone). */
  private buildOre(M: MineModel): void {
    const F = M.F!; this.oreInfo = [];
    let nn = 0, nc = 0;
    for (let i = 0; i < this.G.N; i++) {
      const c = F.cells[i], s = this.slots[i]; if (!c || !s || !c.r || (c.t !== 'ore' && c.t !== 'rare')) continue;
      const g = rockGeo(KINDS[s.kind].kind, KINDS[s.kind].v);
      const gem = CRYSTAL.has(c.r) || c.t === 'rare' && (c.r === F.gem);
      const n = s.mass ? 7 : gem ? 12 : c.t === 'rare' ? 11 : 10;
      // rock behind the front (big floor): ore streaks on its face, at eye height (site: «глубже в толще - только прожилки руды»)
      const tops = s.mass ? g.tops.filter((q) => q.p.y > 0.08 && q.p.y < 0.45) : g.tops;
      for (let k = 0; k < n; k++) {
        const t = tops[Math.floor(rnd(i * 13 + k, 51) * tops.length)]; if (!t) continue;
        // local → stone instance space (the stone matrix scales non-uniformly: place, then orient along the normal)
        _v.copy(t.p).applyMatrix4(s.m);
        _p.copy(t.n).transformDirection(s.m).normalize();
        _q.setFromUnitVectors(_up, _p);
        // veins: many small nuggets; gems: clusters of prisms of mixed size (a few big ones lead)
        const sz = gem ? (k % 4 === 0 ? 0.5 + rnd(i, k + 60) * 0.2 : 0.22 + rnd(i, k + 60) * 0.2) : 0.16 + rnd(i, k + 60) * 0.16;
        const m = new THREE.Matrix4().compose(_v.clone().addScaledVector(_p, gem ? -0.05 : 0.02), _q.clone(), _s.set(sz, gem ? sz * 1.4 : sz, sz));
        const C = oreCol(c.r);
        if (gem) { this.crystal.setMatrixAt(nc, m); this.crystal.setColorAt(nc, _c.set(C[0]).lerp(new THREE.Color(C[1]), 0.2)); this.oreInfo.push({ cell: i, inst: nc, mesh: 1, m }); nc++; }
        else { this.nugget.setMatrixAt(nn, m); this.nugget.setColorAt(nn, _c.set(c.r === 'coal' ? '#2a2a34' : C[0])); this.oreInfo.push({ cell: i, inst: nn, mesh: 0, m }); nn++; }
      }
    }
    this.nugget.count = nn; this.crystal.count = nc;
    this.nugget.instanceMatrix.needsUpdate = this.crystal.instanceMatrix.needsUpdate = true;
    if (this.nugget.instanceColor) this.nugget.instanceColor.needsUpdate = true;
    if (this.crystal.instanceColor) this.crystal.instanceColor.needsUpdate = true;
  }

  /** Glowing mushrooms by nature: at the foot of stones (hidden with them) and along the walls. */
  private buildMushrooms(M: MineModel): void {
    const F = M.F!, P = this.pal; let n = 0;
    const put = (x: number, z: number, s: number, seed: number) => {
      if (n >= 400) return -1;
      _q.setFromAxisAngle(_up, rnd(seed, 1) * 6.28);
      this.mStem.setMatrixAt(n, _m.compose(_p.set(x, this.groundAt(x, z), z), _q, _s.set(s, s, s)));
      this.mCap.setMatrixAt(n, _m);
      _c.set(P.mush).offsetHSL((rnd(seed, 2) - 0.5) * 0.08, 0, (rnd(seed, 3) - 0.5) * 0.1);
      this.mCap.setColorAt(n, _c); this.mStem.setColorAt(n, _c.set('#ffffff'));
      return n++;
    };
    for (let i = 0; i < this.G.N; i++) {
      const s = this.slots[i], c = F.cells[i]; if (!s || !c || c.t === 'wall' || c.t === 'fog') continue;
      if (rnd(i, 70) > (s.mass ? 0.25 : 0.45)) continue;
      const p = this.G.cellXY(i), x = this.G.mx(p.cx), z = this.G.mz(p.cy), a = rnd(i, 71) * 6.28;
      for (let k = 0; k < 3; k++) { const r = (s.mass ? 1.5 : 1.05) + rnd(i, 72 + k) * 0.15, aa = a + k * 0.35; const id = put(x + Math.cos(aa) * r, z + Math.sin(aa) * r, 0.5 + rnd(i, 75 + k) * 0.5, i * 7 + k); if (id >= 0) s.mush.push(id); }
    }
    // along the walls (always visible)
    for (let k = 0; k < (this.G.v3 ? 0 : 34); k++) {
      const side = k % 2 ? 1 : -1, z = Z_TOP + rnd(k, 81) * (Z_BACK - Z_TOP - 1);
      const x = side * (HALL_X + 0.15 + rnd(k, 82) * 0.7);
      for (let j = 0; j < 3; j++) put(x + (rnd(k, 83 + j) - 0.5) * 0.5, z + (rnd(k, 86 + j) - 0.5) * 0.5, 0.5 + rnd(k, 89 + j) * 0.7, 1000 + k * 3 + j);
    }
    this.mStem.count = this.mCap.count = n;
    for (const im of [this.mStem, this.mCap]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    this.mushTotal = n;
  }
  private mushTotal = 0;

  /* ================================================================ dynamic: dug stones, badges, colliders */

  /** Own stone queue shown on the badges and the sign (index = place − 1). */
  private queueOf: number[] = [];
  /**
   * Apply the view: hide dug stones (+ their ore and mushrooms), front badges, camera colliders. `queue` = the own stone
   * queue (site fx.q): those stones get a rose «1» / «2» badge instead of the level badge.
   */
  setView(M: MineModel, queue: readonly number[] = []): void {
    const st = M.st; if (!st || !M.F) return;
    this.setFloor(M);
    // big floor: the rock layout follows the digging, the front, the fog and the drills
    const v3k = this.G.v3 ? `|${st.fl ? st.fl.c.length : 0}|${(st.drills || []).map((d) => d[0] + d[3] + d[4]).join(',')}|${st.fl && st.fl.shaft}` : '';
    if (this.G.v3) { const sk = st.dug + '|' + (st.front || []).join(',') + v3k; if (sk !== this.slotKey) { this.slotKey = sk; this.buildSlots3(M); } }
    const key = st.dug + '|' + (st.front || []).join(',') + '|' + (M.dark ? 1 : 0) + '|' + JSON.stringify(st.bp || {}) + '|' + queue.join(',') + v3k + (this.G.v3 ? `|${Math.round(this.badgeAtFeet.x)},${Math.round(this.badgeAtFeet.z)}` : '');
    if (key === this.dugKey) return;
    this.dugKey = key;
    this.queueOf = queue.slice();
    const hidden = new Set<number>();
    for (let i = 0; i < this.G.N; i++) {
      const s = this.slots[i]; if (!s) continue;
      const im = this.stones[s.kind];
      if (M.dug[i]) { hidden.add(i); im.setMatrixAt(s.inst, _m.makeScale(0, 0, 0)); }
      else im.setMatrixAt(s.inst, s.m);
    }
    // stones that can be dug now are lit up (warmer, brighter); the rest of the face is dimmed a little
    const front = new Set(M.dark ? [] : st.front || []);
    for (let i = 0; i < this.G.N; i++) {
      const s = this.slots[i]; if (!s || M.dug[i]) continue;
      _c.fromArray(this.baseCol, i * 3);
      if (front.has(i)) _c.multiplyScalar(1.1).lerp(WARM, 0.08);
      else if (this.slots[i]!.kind !== 4) _c.multiplyScalar(0.78);
      this.stones[s.kind].setColorAt(s.inst, _c);
    }
    for (const im of this.stones) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    // ore glow / pools go out with their stone
    for (let i = 0; i < this.G.N; i++) if (this.orePool[i] >= 0) this.poolC[this.orePool[i] * 8 + 7] = hidden.has(i) ? 0 : this.orePoolG[i];
    if (this.oreGlow) {
      const sz = this.oreGlow.geometry.attributes.size as THREE.BufferAttribute;
      for (let k = 0; k < this.oreGlowCell.length; k++) sz.setX(k, hidden.has(this.oreGlowCell[k]) || M.dark ? 0 : this.oreGlowSize[k]);
      sz.needsUpdate = true;
    }
    this.poolT = 0;
    for (const o of this.oreInfo) { const im = o.mesh ? this.crystal : this.nugget; im.setMatrixAt(o.inst, hidden.has(o.cell) ? _m.makeScale(0, 0, 0) : o.m); }
    this.nugget.instanceMatrix.needsUpdate = this.crystal.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.G.N; i++) {
      const s = this.slots[i]; if (!s || !s.mush.length) continue;
      for (const id of s.mush) {
        if (hidden.has(i)) { this.mStem.setMatrixAt(id, _m.makeScale(0, 0, 0)); this.mCap.setMatrixAt(id, _m); }
        else { this.mStem.getMatrixAt(id, _m); if (_m.elements[0] === 0 && _m.elements[5] === 0) this.restoreMush(i, id); }
      }
    }
    this.mStem.instanceMatrix.needsUpdate = this.mCap.instanceMatrix.needsUpdate = true;
    // badges over front stones: yellow «level in a circle» (site: stones with a yellow circle are available)
    for (const b of this.badges) b.visible = false;
    let k = 0, nf = 0;
    if (!M.dark) for (const i of this.frontList(st.front || [])) {
      const s = this.slots[i], c = M.F.cells[i]; if (!s || s.mass || !c || M.dug[i]) continue;
      let b = this.badges[k];
      if (!b) { b = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false, transparent: true })); b.scale.set(0.8, 0.8, 1); b.renderOrder = 5; this.badges.push(b); this.dynamic.add(b); }
      const qk = this.queueOf.indexOf(i);
      (b.material as THREE.SpriteMaterial).map = b.userData.plain = qk >= 0 ? badgeQueueTexture(c.lv, qk + 1) : badgeTexture(c.lv, true); (b.material as THREE.SpriteMaterial).needsUpdate = true;
      b.scale.set(0.8, 0.8, 1); b.center.set(0.5, 0.5); b.renderOrder = 5; b.userData.wide = false; b.userData.priced = null;
      const p = this.G.cellXY(i), by = s.m.elements[13] + 0.05 + s.h + 0.45; b.position.set(this.G.mx(p.cx), by, this.G.mz(p.cy)); b.visible = true; b.userData.i = i; b.userData.y0 = by;
      this.fronts.setMatrixAt(nf++, this.onGround(this.G.mx(p.cx), this.G.mz(p.cy), 0.07, _m));
      // the buyer price rides on the badge itself (a tag to its right, one texture): 0 extra draw calls, never collides with it
      if (c.r && qk < 0) { const band = valueCoins(st.bp?.[c.r], st.bp); if (band) b.userData.priced = badgePriceTexture(c.lv, band, st.bp![c.r]); }
      k++;
    }
    this.fronts.count = nf; this.fronts.instanceMatrix.needsUpdate = true;
    this.rebuildColliders(M);
  }
  /** Where the badges were laid out last (big floor: the BADGE_MAX front stones nearest to the player get one). */
  private badgeAtFeet = new THREE.Vector3(1e9, 0, 1e9);
  private frontList(front: readonly number[]): readonly number[] {
    if (!this.G.v3 || front.length <= BADGE_MAX) return front;
    const G = this.G, f = this.badgeAtFeet, d = (i: number) => { const p = G.cellXY(i); return (G.mx(p.cx) - f.x) ** 2 + (G.mz(p.cy) - f.z) ** 2; };
    return front.slice().sort((a, b) => d(a) - d(b)).slice(0, BADGE_MAX);
  }
  private restoreMush(i: number, id: number): void {
    // recompute the original mushroom matrix (deterministic, same as buildMushrooms)
    const s = this.slots[i]!, k = s.mush.indexOf(id), p = this.G.cellXY(i), x = this.G.mx(p.cx), z = this.G.mz(p.cy), a = rnd(i, 71) * 6.28;
    const r = (s.mass ? 1.5 : 1.05) + rnd(i, 72 + k) * 0.15, aa = a + k * 0.35, sc = 0.5 + rnd(i, 75 + k) * 0.5;
    _q.setFromAxisAngle(_up, rnd(i * 7 + k, 1) * 6.28);
    _m.compose(_p.set(x + Math.cos(aa) * r, this.groundAt(x + Math.cos(aa) * r, z + Math.sin(aa) * r), z + Math.sin(aa) * r), _q, _s.set(sc, sc, sc));
    this.mStem.setMatrixAt(id, _m); this.mCap.setMatrixAt(id, _m);
  }
  private rebuildColliders(M: MineModel): void {
    const pos: number[] = [], idx: number[] = [];
    const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
      const o = pos.length / 3;
      for (const y of [y0, y1]) for (const z of [z0, z1]) for (const x of [x0, x1]) pos.push(x, y, z);
      idx.push(o, o + 1, o + 3, o, o + 3, o + 2, o + 4, o + 6, o + 7, o + 4, o + 7, o + 5, o, o + 4, o + 5, o, o + 5, o + 1, o + 2, o + 3, o + 7, o + 2, o + 7, o + 6, o, o + 2, o + 6, o, o + 6, o + 4, o + 1, o + 5, o + 7, o + 1, o + 7, o + 3);
    };
    for (let i = 0; i < this.G.N; i++) {
      const s = this.slots[i]; if (!s || M.dug[i]) continue;
      const p = this.G.cellXY(i), x = this.G.mx(p.cx), z = this.G.mz(p.cy);
      // rock mass of a big floor fills its cell (the camera never looks through a tunnel wall)
      const r = s.mass ? 1.2 : 1.0;
      box(x - r, x + r, 0, Math.min(CEIL, s.h * 0.9), z - r, z + r);
    }
    if (this.G.v3) {
      // ceiling + the rock ring round the floor
      const G = this.G, x0 = G.mx(0), x1 = G.mx(G.W), z0 = G.mz(0), z1 = G.mz(G.H), e = G.PADM;
      box(x0 - 2, x1 + 2, CEIL - 0.2, CEIL + 1, z0 - 2, z1 + 2);
      box(x0 - 2, x0 + e, 0, CEIL, z0 - 2, z1 + 2); box(x1 - e, x1 + 2, 0, CEIL, z0 - 2, z1 + 2);
      box(x0, x1, 0, CEIL, z0 - 2, z0 + e); box(x0, x1, 0, CEIL, z1 - e, z1 + 2);
    } else {
    box(-OUT_X - 1, OUT_X + 1, CEIL - 0.2, CEIL + 1, Z_TOP - 10, Z_WALL + 2);
    for (const sx of [-1, 1]) box(sx * OUT_X - (sx > 0 ? 0 : 1), sx * OUT_X + (sx > 0 ? 1 : 0), 0, CEIL, Z_TOP - 10, Z_WALL + 2);
    box(-OUT_X, OUT_X, 0, CEIL, Z_WALL - 0.1, Z_WALL + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeBoundingSphere(); g.computeBoundingBox();
    this.camCol.geometry.dispose(); this.camCol.geometry = g;
  }

  /* ================================================================ queries */

  /** Can the player stand at room point (x, z)? */
  free(dug: ArrayLike<number>, x: number, z: number): boolean { return this.G.standable(dug, this.G.px(x), this.G.py(z), 4); }
  /** World-space AABB of stone i (for the crosshair). */
  stoneBox(i: number, out = new THREE.Box3()): THREE.Box3 {
    const p = this.G.cellXY(i), x = this.G.mx(p.cx), z = this.G.mz(p.cy), s = this.slots[i];
    return out.set(_v.set(x - 1.1, 0, z - 1.1), _p.set(x + 1.1, s ? Math.min(CEIL, s.h) : STONE_H, z + 1.1));
  }
  stoneHeight(i: number): number { const s = this.slots[i]; return s ? s.h : STONE_H; }

  /* ================================================================ per frame */

  private lastHere = 0;
  /** Outline stone i (−1 = none): exactly the aimed stone's own mesh shape. Called on aim change (no allocations). */
  outlineStone(i: number): void {
    this.hlI = i;
    const s = i >= 0 ? this.slots[i] : null;
    if (s) {
      this.hl.geometry = rockGeo(KINDS[s.kind].kind, KINDS[s.kind].v).geo;
      this.hl.matrix.copy(s.m); this.hl.updateMatrixWorld(true);
      showOutline(this, this.hl);
    } else hideOutline(this);
  }

  /**
   * Per-frame update: highlight of the aimed stone, progress bars, badges bobbing, others (walkers + diggers),
   * debris, labels. `aimI` = stone under the crosshair (−1 none), `feet` = player feet (room metres).
   */
  update(dt: number, t: number, camera: THREE.Camera, M: MineModel, now: number, aimI: number, feet: THREE.Vector3, opts: { hideOthers?: boolean } = {}): void {
    const st = M.st;
    this.glintT.value = t;
    if (this.motes) this.motes.update(t);
    camera.getWorldPosition(this.lastCam);
    // helmet lamp follows the player; darkness
    // the helmet lamp shines ahead of the hero (above the head it blew the helmet itself out)
    camera.getWorldDirection(_f);
    this.heroLight.position.set(feet.x + _f.x * 0.9, feet.y + 1.5, feet.z + _f.z * 0.9);
    const dark = M.dark; this.dark = dark;
    const lamp = M.lampOn() || !dark;
    // the helmet lamp: the one light in a dark floor; on a lit floor a small warm spill round the hero (the lantern pools
    // carry the cave — a strong lamp washed the whole view in front of the hero to one flat brightness)
    this.heroLight.intensity = dark ? (M.lampOn() ? 12 : 0) : M.lampOn() ? 4 : 2.5;
    this.heroLight.distance = dark ? 13 : 7; this.heroLight.decay = dark ? 1.4 : 2;
    this.hemi.intensity = dark ? 0.08 : HEMI; for (const l of this.hallLights) l.visible = !dark;
    // depth fog: beyond the lit stretch the cave falls into its own dark (the room host made the fog from pal.fog;
    // we only pull its range in — the dark floor keeps the host's own tight range)
    if (!dark) { const f = this.fogOf(); if (f) { f.near = FOG_NEAR; f.far = FOG_FAR; } }
    if (this.kit) for (const l of this.kit.lights) l.visible = !dark;
    (this.fronts.material as THREE.MeshBasicMaterial).opacity = 0.75 + Math.sin(t * 3) * 0.2; this.fill.intensity = dark ? 0.02 : FILL;
    // third person (the camera is away from the hero's eyes) → rock near the camera dissolves
    const eye = Math.hypot(this.lastCam.x - feet.x, this.lastCam.y - feet.y - 1.55, this.lastCam.z - feet.z);
    NEAR_FADE.value = eye > 1.0 ? Math.min(2.4, eye * 0.6) : 0;
    camera.getWorldDirection(_f);
    this.updatePools(this.lastCam, _f.x, _f.z, dt, dark);
    this.placeLights(feet, dt, dark);
    if (this.oreGlow) ((this.oreGlow.material as THREE.ShaderMaterial).uniforms.uTime.value = t);
    void lamp;
    // aimed stone: silhouette outline (the carrier takes the stone's geometry and matrix)
    if (aimI !== this.hlI) this.outlineStone(aimI);
    // the own stone: a ring on the floor at the dig spot
    if (st && M.myI >= 0 && !M.dug[M.myI]) {
      const sp = this.G.digSpot(M.dug, M.myI);
      if (sp != null) { const c = this.G.centerOf(sp); this.onGround(this.G.mx(c.x), this.G.mz(c.y), 0.04, this.ring.matrix, 1 + Math.sin(t * 4) * 0.06); this.ring.matrix.decompose(this.ring.position, this.ring.quaternion, this.ring.scale); this.ring.visible = true; }
    } else this.ring.visible = false;
    this.updateEstimateSign(M, now, aimI >= 0 ? aimI : this.lookedAt(_f));
    // badges bob (price glyphs bob with their badge)
    for (const b of this.badges) if (b.visible) b.position.y = b.userData.y0 + Math.sin(t * 2.2 + b.userData.i) * 0.06;
    this.updatePrices(feet, aimI);
    // progress bars of stones being dug («здоровье» камня: full at start, empty at the end)
    let k = 0;
    if (st && st.bl) for (const key in st.bl) {
      const i = +key; if (M.dug[i] || i >= this.G.N) continue;
      if (dark && i !== M.myI) continue;
      if (this.G.v3 && i !== M.myI) { const c = this.G.cellXY(i); if (Math.hypot(this.G.mx(c.cx) - feet.x, this.G.mz(c.cy) - feet.z) > BAR_NEAR) continue; }
      const pr = stoneProgress(st, i, now); if (!pr) continue;
      if (k >= BAR_MAX) break;
      const p = this.G.cellXY(i), rem = 1 - pr.p, sc = i === M.myI ? 1.5 : 1.15;
      _p.set(this.G.mx(p.cx), this.stoneHeight(i) + (this.badgeAt(i) ? 1.0 : 0.45), this.G.mz(p.cy));
      this.barBg.setMatrixAt(k, _m.compose(_p, camera.quaternion, _s.set(sc, sc, sc)));
      // the fill shrinks towards the left end of the plate: shift it along the camera's right axis
      _v.set(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar((-0.5 + rem / 2) * sc);
      _p.add(_v);
      this.barFill.setMatrixAt(k, _m.compose(_p, camera.quaternion, _s.set(Math.max(0.001, rem) * sc, sc, sc)));
      this.barFill.setColorAt(k, _c.set(hp(rem)));
      k++;
    }
    this.barBg.count = k; this.barFill.count = k;
    if (k) { this.barBg.instanceMatrix.needsUpdate = true; this.barFill.instanceMatrix.needsUpdate = true; if (this.barFill.instanceColor) this.barFill.instanceColor.needsUpdate = true; }
    // up-cage glows when the floor is cleared
    const cleared = st && !this.G.v3 ? M.stonesLeft() === 0 : false;
    this.upLamp.visible = !this.G.v3;
    // big floor: badges follow the player (the nearest BADGE_MAX front stones get one)
    if (this.G.v3 && st && Math.hypot(feet.x - this.badgeAtFeet.x, feet.z - this.badgeAtFeet.z) > 6) { this.badgeAtFeet.set(feet.x, 0, feet.z); this.setView(M, this.queueOf); }
    this.upGlow.intensity = cleared ? 6 + Math.sin(t * 3) * 1.5 : 0;
    (this.upLamp.material as THREE.MeshBasicMaterial).color.set(cleared ? '#ffe27a' : '#5a4a3a');
    this.updateActors(dt, t, M, now, feet, opts.hideOthers || dark);
    this.updateParts(dt);
    for (const a of this.npcs) {
      const d = Math.hypot(a.root.position.x - this.lastCam.x, a.root.position.z - this.lastCam.z);
      a.setAlpha(d < 0.9 ? 0 : d < 2.6 ? 0.2 + 0.8 * (d - 0.9) / 1.7 : 1); a.root.visible = d >= 0.9;
      a.update(dt, t, 0);
    }
    this.labels.update(this.anchors, camera, dt);
    void this.lastHere;
  }
  /** Price tags: the badge of a close (≤ 8 m) priced front stone swaps to its «level + price» texture; not on the aimed
   *  stone (its sign shows the price), not at q0, not in the dark. Texture swap only on change; no allocations. */
  private updatePrices(feet: THREE.Vector3, aimI: number): void {
    const on = this.econOn && this.quality > 0 && !this.dark;
    for (const b of this.badges) {
      if (!b.visible) continue;
      const u = b.userData, dx = b.position.x - feet.x, dz = b.position.z - feet.z;
      const wide = on && !!u.priced && u.i !== aimI && dx * dx + dz * dz < 64;
      if (wide) {
        // a priced badge grows a little with camera distance (×1…×1.6 over 3.5–8.5 m) so the tag stays readable
        const cx = b.position.x - this.lastCam.x, cy = b.position.y - this.lastCam.y, cz = b.position.z - this.lastCam.z;
        const d = Math.sqrt(cx * cx + cy * cy + cz * cz), k = d < 3.5 ? 1 : d > 8.5 ? 1.6 : 1 + (d - 3.5) * 0.12;
        b.scale.set(1.6 * k, 0.8 * k, 1); b.center.y = 1 - 0.5 / k;   // grows downwards: the top stays under the progress bar
      }
      if (wide === u.wide) continue;
      u.wide = wide;
      const m = b.material as THREE.SpriteMaterial;
      m.map = wide ? u.priced : u.plain;
      // the circle stays where it was: the tag extends to the right (canvas 2:1, circle in the left quarter)
      // a priced badge draws over the nameplates (renderOrder 10–50) but under chat bubbles (60+); rock still hides it
      if (wide) { b.center.x = 0.25; b.renderOrder = 55; } else { b.scale.set(0.8, 0.8, 1); b.center.set(0.5, 0.5); b.renderOrder = 5; }
    }
  }
  /** Front stone nearest to the view ray within 12 m and a ~10° cone (the sign from afar, beyond the use reach); −1 none. */
  private lookedAt(dir: THREE.Vector3): number {
    let best = -1, bestS = 0.03;
    for (const b of this.badges) {
      if (!b.visible) continue;
      const dx = b.position.x - this.lastCam.x, dy = b.userData.y0 - 0.9 - this.lastCam.y, dz = b.position.z - this.lastCam.z;
      const d2 = dx * dx + dy * dy + dz * dz; if (d2 > 144 || d2 < 1) continue;
      const along = dx * dir.x + dy * dir.y + dz * dir.z; if (along <= 0) continue;
      const off = 1 - along * along / d2;            // sin² of the angle off the view ray
      if (off < bestS) { bestS = off; best = b.userData.i; }
    }
    return best;
  }
  /** Sign over the aimed stone: billboard, constant-ish screen size (reads at 3–10 m), fades out from 10.5 to 12 m; 1 draw call. */
  private updateEstimateSign(M: MineModel, now: number, aimI: number): void {
    const sign = this.sign;
    if (!this.econOn || !M.st || !M.F || aimI < 0 || M.dug[aimI] || M.dark) { if (sign) sign.visible = false; return; }
    const cell = M.F.cells[aimI]; if (!cell) { if (sign) sign.visible = false; return; }
    const p = this.G.cellXY(aimI), x = this.G.mx(p.cx), z = this.G.mz(p.cy), y = this.stoneHeight(aimI) + (this.badgeAt(aimI) ? 1.28 : 0.8);
    const d = Math.hypot(x - this.lastCam.x, y - this.lastCam.y, z - this.lastCam.z);
    const alpha = d < 10.5 ? 1 : 1 - (d - 10.5) / 1.5;
    if (alpha <= 0.02) { if (sign) sign.visible = false; return; }
    if (!this.sign) {
      this.signCanvas = document.createElement('canvas'); this.signCanvas.width = SIGN_W; this.signCanvas.height = SIGN_H;
      this.signTexture = new THREE.CanvasTexture(this.signCanvas); this.signTexture.colorSpace = THREE.SRGBColorSpace; this.signTexture.anisotropy = 4;
      this.sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.signTexture, transparent: true, depthWrite: false, depthTest: false, fog: false, toneMapped: false }));
      // bottom-anchored: the plate grows upwards from above the badge, so it stays above the crosshair and the «[E] …» prompt
      this.sign.center.set(0.5, 0); this.sign.renderOrder = 105; this.dynamic.add(this.sign);   // over nameplates and bubbles (labels: 10–100)
    }
    const s = this.sign!;
    // estimate at most every 2 s, or at once when the stone / snapshot / own stone changes
    if (aimI !== this.signI || M.st.at !== this.signSnap || M.myI !== this.signMy || now - this.signAt > 2000 || this.signQ !== this.dugKey) {
      this.signQ = this.dugKey;
      this.signI = aimI; this.signSnap = M.st.at; this.signMy = M.myI; this.signAt = now;
      const e = estimateStone(M.st, cell, now, M.myI);
      const price = M.st.bp?.[cell.r || ''] ?? null;
      this.signOk = !(e.minutes == null && e.share == null && price == null);
      if (this.signOk) {
        const tx = signText(e, M.myI === aimI);
        const qk = this.queueOf.indexOf(aimI); if (qk >= 0) tx.main = `в очереди №${qk + 1} · ${tx.main}`;
        if (tx.main !== this.signMain || tx.share !== this.signShare || tx.perHour !== this.signHour || aimI !== this.signDrawnI) {
          this.signMain = tx.main; this.signShare = tx.share; this.signHour = tx.perHour; this.signDrawnI = aimI;
          drawEstimateSign(this.signCanvas!, { main: tx.main, share: tx.share, perHour: tx.perHour, res: cell.r || 'stone', price });
          this.signTexture!.needsUpdate = true;
        }
      }
    }
    if (!this.signOk) { s.visible = false; return; }
    // world width ∝ distance (≈ constant screen size, ~20 % smaller at 10 m than at 3 m); clamped near and far
    const dc = d < 2 ? 2 : d > 11 ? 11 : d, w = dc * (0.78 - 0.03 * dc);
    s.scale.set(w, w * SIGN_H / SIGN_W, 1);
    s.position.set(x, y, z);
    (s.material as THREE.SpriteMaterial).opacity = alpha;
    s.visible = true;
  }
  private badgeAt(i: number): boolean { for (const b of this.badges) if (b.visible && b.userData.i === i) return true; return false; }


  /* ---------------------------------------------------------------- others */
  private appOf(login: string, M: MineModel) {
    const v = M.lookOf(login) || {};
    const g = { ...(v.g || {}), h: 'miner', hr: 'common' } as Record<string, unknown>;
    delete g.w; delete g.s;   // hands hold the pickaxe
    // in the mine everybody wears the miner helmet (site: minerHat) — the look's own hat would win over gear.h
    return appearanceFrom(login, { n: v.n || login, lv: v.lv, lk: { ...(v.lk || {}), hat: 'miner' }, g, gh: v.gh }, this.style);
  }
  private makeActor(login: string, M: MineModel): Actor {
    const v = M.lookOf(login), key = JSON.stringify([v && v.lk, v && v.g, v && v.gh]);
    const av = this.avKit.create(this.appOf(login, M));
    const pick = this.makePick();
    this.root.add(av.root);
    const h = hashL(login);
    const a: Actor = { key2: login, av, pick, bone: null, key, x: 0, z: 0, face: 0, dig: -1, swingT: -((h >>> 6) % 140) / 100, tempo: 1.05 + (h % 41) / 100, seen: 0, anchor: new THREE.Vector3(), moving: 0, ox: 0, oz: 0, tox: 0, toz: 0 };
    this.labels.set(login, { name: (v && v.n) || login, level: (v && v.lv) || undefined });
    return a;
  }
  /** Pickaxe in the right paw: attached to the arm bone (avatar bones are named 'b' + index; 3 = right arm). */
  makePick(): THREE.Group {
    const g = new THREE.Group(), pg = pickaxeGeo();
    g.add(new THREE.Mesh(pg.wood, this.pickMats[0]), new THREE.Mesh(pg.iron, this.pickMats[1]));
    // held a little up the handle (choked grip): at rest, with the arm hanging, the head stays above the floor
    // (gripped at the very end it hung 0.3 m into the ground)
    for (const m of g.children) m.position.y = -0.26;
    // in the arm bone's frame (bone 'b3', the arm hangs along −Y; the avatar's 'swing' rotates the arm about X):
    // the handle continues the forearm (≈ −Y, a bit forward), so the head's striking point (pick −Z) lands on the
    // leading side of the swing: rotation.x = atan2(−0.4, −0.9) maps pick +Y → (0, −0.9, −0.4), pick −Z → (0, −0.4, 0.92)
    g.position.set(0.085, -0.175, -0.03); g.rotation.set(Math.atan2(-0.4, -0.9), 0, 0); g.scale.setScalar(1.25);
    return g;
  }
  static attachPick(root: THREE.Object3D, pick: THREE.Group): THREE.Object3D | null {
    const bone = root.getObjectByName('b3');
    if (bone && pick.parent !== bone) bone.add(pick);
    return bone || null;
  }
  private updateActors(dt: number, t: number, M: MineModel, now: number, feet: THREE.Vector3, hide: boolean): void {
    const seen = ++this.frame;
    this.camP.copy(this.lastCam); this.actN = 0;
    if (!hide && M.st) {
      // diggers at stones (first 4 per stone), then walkers; nearest first under a cap
      const want: { l: string; x: number; z: number; dig: number; moving: number; face: number | null }[] = [];
      const digging = new Set<string>();
      for (const d of M.diggers()) {
        digging.add(d.login);
        const c = this.G.cellXY(d.i), sx = this.G.mx(c.cx), sz = this.G.mz(c.cy);
        // the site draws them at the dig spot (3 m away in 3D): pull them to the stone's face, keep the site's spread
        let x = this.G.mx(d.x), z = this.G.mz(d.y);
        const dx0 = x - sx, dz0 = z - sz, L0 = Math.hypot(dx0, dz0) || 1, slot = this.slots[d.i];
        const rr = (slot ? slot.m.elements[0] ** 2 + slot.m.elements[2] ** 2 : 1) ** 0.5 + 0.42;
        if (L0 > rr) { x = sx + dx0 / L0 * rr; z = sz + dz0 / L0 * rr; }
        want.push({ l: d.login, x, z, dig: d.i, moving: 0, face: Math.atan2(-(this.G.mx(c.cx) - x), -(this.G.mz(c.cy) - z)) });
      }
      for (const [l, o] of M.others) {
        if (digging.has(l)) continue;
        const p = M.posOf(o, now, this.tp), q = M.standPt(p);
        const moving = p.x !== o.tx || p.y !== o.ty ? 1 : 0;
        want.push({ l, x: this.G.mx(q.x), z: this.G.mz(q.y), dig: -1, moving, face: moving ? Math.atan2(-(o.tx - o.x), -(o.ty - o.y)) : null });
      }
      want.sort((a, b) => Math.hypot(a.x - feet.x, a.z - feet.z) - Math.hypot(b.x - feet.x, b.z - feet.z));
      // a big floor spreads the crowd over many tunnels: only the nearest ones (the rest is behind rock anyway)
      const v3 = this.G.v3, cap = v3 ? (this.quality <= 0 ? 6 : this.quality === 1 ? 9 : 12) : this.quality <= 0 ? 14 : this.quality === 1 ? 24 : 40;
      for (let j = 0; j < want.length && j < cap; j++) {
        const w = want[j];
        if (v3 && Math.hypot(w.x - feet.x, w.z - feet.z) > ACTOR_NEAR) break;
        let a = this.actors.get(w.l);
        const v = M.lookOf(w.l), key = JSON.stringify([v && v.lk, v && v.g, v && v.gh]);
        if (a && a.key !== key) { a.av.setAppearance(this.appOf(w.l, M)); a.key = key; a.bone = null; this.labels.set(w.l, { name: (v && v.n) || w.l, level: (v && v.lv) || undefined }); }
        if (!a) { a = this.makeActor(w.l, M); this.actors.set(w.l, a); a.x = w.x; a.z = w.z; }
        a.seen = seen;
        // smooth towards the target point (presence already interpolates; this hides snaps)
        const k = 1 - Math.exp(-dt * 10);
        a.x += (w.x - a.x) * k; a.z += (w.z - a.z) * k;
        if (w.face != null) a.face = w.face;
        a.dig = w.dig; a.moving = w.moving;
        this.act[this.actN++] = a;
      }
      this.spread(M, feet, dt);
      for (let j = 0; j < this.actN; j++) {
        const a = this.act[j];
        const x = a.x + a.ox, z = a.z + a.oz;
        a.av.root.position.set(x, this.groundAt(x, z), z); a.av.root.rotation.y = a.face;
        const d = Math.hypot(x - this.camP.x, z - this.camP.z);
        // nobody fills the screen: miners right at the camera fade out (spawn / a crowded corridor)
        a.av.setAlpha(d < 0.9 ? 0 : d < 2.6 ? 0.2 + 0.8 * (d - 0.9) / 1.7 : 1);
        a.av.root.visible = d >= 0.9;
        a.av.setLod(d < 9 ? 0 : d < 20 ? 1 : 2);
        a.av.update(dt, t, a.moving ? 1 : 0);
        if (a.dig >= 0) {
          a.swingT += dt;
          if (a.swingT >= a.tempo) { a.swingT -= a.tempo; a.av.play('swing'); }
        }
        if (!a.bone || (this.frame & 31) === 0) a.bone = MineScene.attachPick(a.av.root, a.pick);
        a.pick.visible = d < (this.G.v3 ? PICK_NEAR : 22);
        a.anchor.set(x, d >= 0.9 ? a.av.headTop + 0.25 : -100, z); this.anchors.set(a.key2, a.anchor);
      }
    }
    for (const [l, a] of this.actors) {
      if (a.seen === seen) continue;
      a.av.root.removeFromParent(); a.av.dispose(); this.actors.delete(l); this.anchors.delete(l); this.labels.remove(l);
    }
  }
  private act: Actor[] = []; private actN = 0;
  /**
   * Idle miners stand where the game puts them — everybody spawns in the same spot in front of the cart. Purely
   * visual spread: walkers are pushed off the player (1.3 m) and off each other (0.9 m), never onto rock or props.
   */
  private spread(M: MineModel, feet: THREE.Vector3, dt: number): void {
    const n = this.actN, A = this.act;
    for (let j = 0; j < n; j++) { A[j].tox = 0; A[j].toz = 0; }
    for (let j = 0; j < n; j++) {
      const a = A[j]; if (a.dig >= 0) continue;
      let dx = a.x - feet.x, dz = a.z - feet.z, d = Math.hypot(dx, dz);
      if (d < 1.3) { if (d < 1e-3) { dx = Math.sin(j * 2.4); dz = Math.cos(j * 2.4); d = 1; } a.tox += dx / d * (1.3 - d); a.toz += dz / d * (1.3 - d); }
      for (let k = j + 1; k < n; k++) {
        const b = A[k]; if (b.dig >= 0) continue;
        dx = a.x - b.x; dz = a.z - b.z; d = Math.hypot(dx, dz);
        if (d >= 0.9) continue;
        if (d < 1e-3) { dx = Math.sin((j + k) * 1.7); dz = Math.cos((j + k) * 1.7); d = 1e-3; }
        const p = (0.9 - d) / 2; dx /= Math.max(d, 1e-3); dz /= Math.max(d, 1e-3);
        a.tox += dx * p; a.toz += dz * p; b.tox -= dx * p; b.toz -= dz * p;
      }
    }
    const k = 1 - Math.exp(-dt * 4);
    for (let j = 0; j < n; j++) {
      const a = A[j];
      if (a.dig >= 0 || !this.G.standable(M.dug, this.G.px(a.x + a.tox), this.G.py(a.z + a.toz), 2)) { a.tox = 0; a.toz = 0; }
      a.ox += (a.tox - a.ox) * k; a.oz += (a.toz - a.oz) * k;
    }
  }
  private frame = 0;
  private camP = new THREE.Vector3(); private lastCam = new THREE.Vector3();
  private tp = { x: 0, y: 0 };

  /** Chat bubble over a miner shown in the scene (others are ignored). */
  say(login: string, text: string): void { if (this.actors.has(login)) this.labels.bubble(login, text, 6000); }

  /* ---------------------------------------------------------------- debris */
  /** Stone i was dug: rock chips fly (colour of the rock and of its ore). */
  burst(i: number, M: MineModel): void {
    const c = M.F && M.F.cells[i]; const p = this.G.cellXY(i), x = this.G.mx(p.cx), z = this.G.mz(p.cy);
    const g = this.parts.geometry, pos = g.attributes.position as THREE.BufferAttribute, col = g.attributes.color as THREE.BufferAttribute;
    const size = g.attributes.aSize as THREE.BufferAttribute, fade = g.attributes.aFade as THREE.BufferAttribute;
    const NP = this.partLife.length, chips = this.quality <= 0 ? 16 : 30, dust = this.quality <= 0 ? 3 : 8;
    for (let k = 0; k < chips + dust; k++) {
      const j = this.partN % NP; this.partN++;
      const isDust = k >= chips, a = Math.random() * 6.28;
      pos.setXYZ(j, x + (Math.random() - 0.5) * (isDust ? 1.4 : 1.0), (isDust ? 0.3 : 0.5) + Math.random() * 1.0, z + (Math.random() - 0.5) * (isDust ? 1.4 : 1.0));
      const sp = isDust ? 0.3 + Math.random() * 0.5 : 1.5 + Math.random() * 3;
      this.partVel[j * 3] = Math.cos(a) * sp; this.partVel[j * 3 + 1] = isDust ? 0.25 + Math.random() * 0.4 : 2 + Math.random() * 3.5; this.partVel[j * 3 + 2] = Math.sin(a) * sp;
      this.partLife[j] = this.partMax[j] = isDust ? 1.6 + Math.random() * 1.0 : 1.1 + Math.random() * 0.6;
      if (isDust) _c.set(this.pal ? this.pal.rock[0] : '#b0a090').lerp(WARM, 0.3).multiplyScalar(0.55);   // low, warm, faint: rock dust (a pale puff read as smoke)
      else _c.set(k % 4 === 0 && c && c.r ? oreCol(c.r)[k % 8 ? 0 : 1] : this.pal ? this.pal.rock[k % 3 === 1 ? 2 : k % 3 === 2 ? 1 : 0] : '#9a8e80');
      col.setXYZ(j, _c.r, _c.g, _c.b);
      size.setX(j, isDust ? 0.32 + Math.random() * 0.3 : 0.06 + Math.random() * 0.1); fade.setX(j, 1);
    }
    pos.needsUpdate = col.needsUpdate = size.needsUpdate = fade.needsUpdate = true;
    this.parts.geometry.setDrawRange(0, Math.min(NP, this.partN));
  }
  private updateParts(dt: number): void {
    const n = Math.min(this.partLife.length, this.partN); if (!n) return;
    const g = this.parts.geometry, pos = g.attributes.position as THREE.BufferAttribute, fade = g.attributes.aFade as THREE.BufferAttribute, size = g.attributes.aSize as THREE.BufferAttribute;
    let any = false;
    for (let j = 0; j < n; j++) {
      if (this.partLife[j] <= 0) continue;
      this.partLife[j] -= dt; any = true;
      const dustP = size.getX(j) > 0.2, lf = Math.max(0, this.partLife[j] / this.partMax[j]);
      if (dustP) { this.partVel[j * 3] *= 1 - dt * 1.2; this.partVel[j * 3 + 2] *= 1 - dt * 1.2; size.setX(j, size.getX(j) + dt * 0.35); fade.setX(j, Math.min(1, lf * 1.6) * Math.min(1, (1 - lf) * 6)); }
      else { this.partVel[j * 3 + 1] -= 12 * dt; fade.setX(j, Math.min(1, lf * 3)); }
      let y = pos.getY(j) + this.partVel[j * 3 + 1] * dt;
      if (y < 0.03) { y = 0.03; this.partVel[j * 3 + 1] *= -0.3; this.partVel[j * 3] *= 0.6; this.partVel[j * 3 + 2] *= 0.6; }
      pos.setXYZ(j, pos.getX(j) + this.partVel[j * 3] * dt, this.partLife[j] <= 0 ? -10 : y, pos.getZ(j) + this.partVel[j * 3 + 2] * dt);
    }
    if (any) { pos.needsUpdate = true; fade.needsUpdate = true; size.needsUpdate = true; }
  }

  /** Room-space point of an entrance object's use spot (FOOT at) or the dig spot of a stone. */
  static digSpotM(M: MineModel, i: number): THREE.Vector3 | null { const G = M.G, sp = G.digSpot(M.dug, i); if (sp == null) return null; const c = G.centerOf(sp); return new THREE.Vector3(G.mx(c.x), 0, G.mz(c.y)); }
  static ZONE_M = { x0: mx(ZONE[0]), x1: mx(ZONE[2]), z0: mz(ZONE[1]), z1: mz(ZONE[3]) };
  static readonly YB = YB;

  dispose(): void {
    if (typeof window !== 'undefined') window.removeEventListener('l3d:settings', this.onSettings);
    for (const a of this.actors.values()) { a.av.root.removeFromParent(); a.av.dispose(); }
    this.actors.clear();
    for (const a of this.npcs) { a.root.removeFromParent(); a.dispose(); }
    this.npcs = [];
    if (this.motes) { this.motes.dispose(); this.motes = null; }
    if (this.kit) { this.kit.dispose(); this.kit = null; }
    this.labels.dispose();
    for (const im of [...this.stones, this.nugget, this.crystal, this.mStem, this.mCap]) { im.dispose(); }
    this.stoneMat.dispose();
    hideOutline(this);
    for (const m of [this.nugget.material, this.crystal.material, this.mStem.material, this.mCap.material, this.hl.material, this.ring.material, this.camCol.material, this.upLamp.material, this.parts.material] as THREE.Material[]) m.dispose();
    this.ring.geometry.dispose(); this.camCol.geometry.dispose(); this.upLamp.geometry.dispose(); this.parts.geometry.dispose();
    for (const b of this.badges) (b.material as THREE.Material).dispose();
    if (this.sign) (this.sign.material as THREE.Material).dispose();
    this.signTexture?.dispose();
    for (const im of [this.barBg, this.barFill]) { im.geometry.dispose(); (im.material as THREE.Material).dispose(); im.dispose(); }
    for (const m of this.pickMats) m.dispose();
    this.fronts.dispose(); this.fronts.geometry.dispose(); (this.fronts.material as THREE.Material).dispose(); for (const l of this.hallLights) l.dispose();
    this.heroLight.dispose(); this.upGlow.dispose(); this.hemi.dispose(); this.fill.dispose();
    if (this.oreGlow) { this.oreGlow.geometry.dispose(); (this.oreGlow.material as THREE.Material).dispose(); }
    this.glowTex.dispose(); this.ringTex.dispose();
    this.root.removeFromParent();
  }
}

export { CELL, CEIL, HALL_X, OUT_X, Z_TOP, Z_BACK, STONE_H };

/** Floor halo of a diggable stone: a crisp ring with a soft glow on both sides (white; tinted by the material). */
function haloTexture(): THREE.CanvasTexture {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!, r0 = S / 2;
  const gr = g.createRadialGradient(r0, r0, 0, r0, r0, r0);
  // ring at ~0.74 of the radius (1.26 m on a 3.4 m plane): just outside the stone's footprint
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.62, 'rgba(255,255,255,0)'); gr.addColorStop(0.69, 'rgba(255,255,255,.18)');
  gr.addColorStop(0.73, 'rgba(255,255,255,1)'); gr.addColorStop(0.765, 'rgba(255,255,255,1)'); gr.addColorStop(0.8, 'rgba(255,255,255,.2)'); gr.addColorStop(0.92, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
