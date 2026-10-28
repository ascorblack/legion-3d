/**
 * First-person view-model: stubby paws (body colour + armour sleeve). It mirrors the third-person body: the weapon —
 * any kind, the bow too — is always in the RIGHT paw, the shield (whenever equipped) on the LEFT forearm, peeking in at
 * the lower-left edge until the player blocks (RMB → `block(true)`); a paw is empty only when nothing is in that hand.
 *
 * Add `root` as a child of the camera. Layout is computed from the camera's aspect every frame (weapon stays in the
 * lower-right quarter of the screen on any aspect) and the whole rig is scaled with tan(fov/2) so it keeps its
 * on-screen size when the player changes the FOV. Recommended camera.near: 0.03.
 * Drawn after the world (transparent queue, renderOrder ≥ 999; one depth clear) so it never clips into walls.
 * update() never allocates.
 */
import * as THREE from 'three';
import { addClaws } from './cherts';
import type { Appearance } from '../contracts';
import type { ViewModel } from '../contracts/modules';
import { Parts, T, mul, sphere, tube, torus, box, cyl, cone, capsule } from './geom';
import { addWeapon, addShield, weaponHold, bladeSpan } from './gear';
import { toonMat, outlineMat } from './materials';
import { RARITY_COLOR } from './appearance';
import { easeK } from './attacks';

const W_CLOTH: Record<string, string> = { common: '#8a7a62', uncommon: '#3f6fb0', rare: '#2f58a8', epic: '#5a2fa8', legendary: '#7a1f3a' };
const SLEEVE: Record<string, (r: string) => string> = {
  robe: (r) => W_CLOTH[r] || W_CLOTH.common,
  shroud: () => '#33403a', leather: () => '#5a3f2c', plate: () => '#dde3eb', lorica: () => '#aab2b8', light: () => '#9a6a3e',
};

export const RECOMMENDED_NEAR = 0.03;

/** Weapon families: how a weapon is held and swung. */
type Kind = 'blade' | 'heavy' | 'pole' | 'spear' | 'bow' | 'book' | 'censer' | 'none';
const KIND: Record<string, Kind> = {
  sword: 'blade', gladius: 'blade', dagger: 'blade', kris: 'blade',
  axe: 'heavy', club: 'heavy', mace: 'heavy', hammer: 'heavy', holymace: 'heavy',
  staff: 'pole', crook: 'pole', skullstaff: 'pole', spear: 'spear', pitchfork: 'spear',
  bow: 'bow', grimoire: 'book', censer: 'censer',
};
/** Weapon family of a weapon look (how it is held and swung); 'none' when unarmed. Unknown looks swing like a blade. */
export function weaponFamily(w: string | undefined | null): Kind { return w ? KIND[w] || 'blade' : 'none'; }
export type WeaponFamily = Kind;

/** Size of the held weapon in view-model space (weapon geometry is in character metres). */
const WSCALE: Record<string, number> = { dagger: 0.64, kris: 0.6, gladius: 0.56, sword: 0.5, axe: 0.5, club: 0.5, mace: 0.5, hammer: 0.48, holymace: 0.48, staff: 0.44, crook: 0.44, skullstaff: 0.44, spear: 0.44, pitchfork: 0.44, bow: 0.48, grimoire: 0.46, censer: 0.52 };

/**
 * Pose = where a paw sits: NDC-ish screen anchor (x, y at depth z, in a 75° / 16:9 reference frame) + euler.
 * [x, y, z, rx, ry, rz]
 */
type Pose = [number, number, number, number, number, number];
const REST_R: Record<Kind, Pose> = {
  blade: [0.56, -0.72, -0.52, -0.12, 0.25, 0.42],   // edge towards the crosshair, the flat turned a little to the camera
  heavy: [0.58, -0.74, -0.52, 0.05, 0.8, 0.32],   // striking head towards the crosshair, its side profile readable
  pole: [0.5, -0.64, -0.52, 0.12, -0.2, 0.2],
  spear: [0.56, -0.74, -0.5, -0.75, -0.15, 0.25],
  bow: [0.4, -0.5, -0.54, 0.0, 0.0, -0.2],   // fist on the grip, limbs up/down in the aim plane, top canted out ~11°
  book: [0.5, -0.6, -0.5, -0.35, -0.3, 0.12],   // tome held by the bottom of its spine, starry cover to the camera
  censer: [0.44, -0.3, -0.5, 0.1, -0.2, 0.05],   // forearm from the side, so the chain hangs free of it
  none: [0.5, -0.86, -0.48, 0.3, 0, 0.15],
};
/**
 * Tuning table (poses are read every frame, so dev pages may tweak them live).
 * lPaw: the bare left paw (mirrors the right paw: same depth and size, forearm from the lower-left corner angled inward)
 * lShield: idle shield — held flat and low, top tilted away: only its rim + a strip of the face peeks in at the bottom-left
 * block: RMB — raised to cover the lower-left quarter only
 */
export const VM_TUNE = {
  right: REST_R,
  lPaw: [-0.52, -0.71, -0.52, 0.3, 0.1, -0.2] as Pose,
  /** both paws empty: a mirror of the right one */
  lPawNone: [-0.5, -0.86, -0.48, 0.3, 0, -0.15] as Pose,
  lShield: [-0.95, -1.93, -0.22, -1.0, 0.05, 0.05] as Pose,
  block: [-0.5, -0.92, -0.3, 0.05, 0.28, -0.06] as Pose,
  /** bow in the right paw: yaw of the bow plane (string towards the camera), extra cant, size */
  bow: { yaw: 0, cant: 0, size: 1 },
  /** forearm direction in paw space (x mirrored for the left paw): from the paw down/back towards the screen corner */
  arm: { def: [0.09, -0.22, 0.19] as [number, number, number], bow: [0.28, -0.12, 0.18] as [number, number, number] },
  /** the free left paw pulling the bow string (src/combat draw) */
  pull: [0.12, -0.36, -0.44, 0.5, 0.35, -0.9] as Pose,
};
const PARRY_R: Pose = [0.18, -0.4, -0.5, -0.2, -0.2, 1.35];

/**
 * Swing keyframes per family: [time s, dx, dy, dz, drx, dry, drz, ease?] offsets from the rest pose; `ease` of the
 * segment ending at the key (attacks.ts easeK: 0 smooth, 1 in, 2 out, 3 linear, 4 back). Same timing as the TP tracks
 * (attacks.ts): wind-up → anticipation hold → fast strike (contact = TP_CONTACT) → follow-through → settle.
 */
type Key = readonly number[];
const SW_SLASH: readonly Key[] = [
  [0, 0, 0, 0, 0, 0, 0],
  [0.09, 0.16, 0.2, 0.06, 0.95, 0.3, -0.85, 2],             // wind-up: up and back over the right shoulder
  [0.19, 0.175, 0.22, 0.07, 1.05, 0.34, -0.92],             // hold
  [0.225, -0.1, 0.0, -0.03, -0.15, 0.25, 0.3, 1],          // arc
  [0.255, -0.4, -0.18, -0.06, -0.85, 0.25, 1.05, 3],       // contact: wrist snap
  [0.36, -0.44, -0.24, -0.05, -0.98, 0.25, 1.15, 2],       // follow-through (stays on screen)
  [0.47, -0.4, -0.22, -0.05, -0.9, 0.22, 1.05, 4],
  [0.74, 0, 0, 0, 0, 0, 0],
];
const SW_SMASH: readonly Key[] = [
  [0, 0, 0, 0, 0, 0, 0],
  [0.12, 0.04, 0.2, 0.06, 0.95, 0, -0.2, 2],
  [0.22, 0.045, 0.24, 0.07, 1.08, 0, -0.22],               // hold at the top
  [0.26, -0.06, 0.05, -0.01, 0.1, 0.05, 0.1, 1],
  [0.29, -0.18, -0.24, -0.06, -0.95, 0.1, 0.45, 1],        // SLAM
  [0.42, -0.2, -0.25, -0.05, -0.98, 0.1, 0.45, 2],
  [0.52, -0.1, -0.1, -0.02, -0.4, 0.05, 0.2],
  [0.74, 0, 0, 0, 0, 0, 0],
];
const SW_THRUST: readonly Key[] = [
  [0, 0, 0, 0, 0, 0, 0],
  [0.1, 0.03, -0.03, 0.07, 0.14, 0, 0, 2],
  [0.2, 0.035, -0.035, 0.085, 0.17, 0, 0],                 // hold (coiled)
  [0.245, -0.12, 0.08, -0.16, -0.3, 0, -0.05, 1],          // lunge
  [0.33, -0.12, 0.08, -0.15, -0.3, 0, -0.05, 2],
  [0.58, 0, 0, 0, 0, 0, 0],
];
const SW_CAST: readonly Key[] = [
  [0, 0, 0, 0, 0, 0, 0],
  [0.14, 0.02, 0.06, 0.04, 0.25, 0, -0.1],
  [0.26, -0.14, 0.14, -0.1, -0.45, 0.1, 0.2],
  [0.4, -0.14, 0.14, -0.09, -0.45, 0.1, 0.2],
  [0.7, 0, 0, 0, 0, 0, 0],
];
const SW_DRAW: readonly Key[] = [   // bow (held in the right paw): raise towards the crosshair and stand it upright, aim, loose (recoil), lower
  [0, 0, 0, 0, 0, 0, 0],
  [0.2, -0.2, 0.17, -0.02, 0.12, 0, 0.15],
  [0.4, -0.21, 0.18, -0.03, 0.12, 0, 0.16],
  [0.46, -0.19, 0.19, 0.03, 0.22, 0, 0.18],
  [0.8, 0, 0, 0, 0, 0, 0],
];
const SW_FLICK: readonly Key[] = [  // censer
  [0, 0, 0, 0, 0, 0, 0],
  [0.12, 0.02, -0.05, 0.03, 0.3, 0, 0],
  [0.26, -0.1, 0.1, -0.08, -0.5, 0, 0.1],
  [0.6, 0, 0, 0, 0, 0, 0],
];
const SWINGS: Record<Kind, readonly Key[]> = { blade: SW_SLASH, heavy: SW_SMASH, pole: SW_CAST, spear: SW_THRUST, bow: SW_DRAW, book: SW_CAST, censer: SW_FLICK, none: SW_THRUST };

/** Shield size in view-model space and an extra idle drop, so every kind peeks in by about the same strip. */
const SH_SCALE: Record<string, number> = { scutum: 0.86, round: 0.78, barrel: 0.78, buckler: 1.22 };
const SH_DROP: Record<string, number> = { scutum: 0.056, round: 0, barrel: 0.002, buckler: -0.007 };

/**
 * The inside of a shield as the player sees it (shield space, back towards +Z): two iron bands with rivets across the
 * back — the upper one shows in the idle strip — plus the leather arm strap and the handle the paw holds.
 */
function addShieldBack(p: Parts, kind: string, m: THREE.Matrix4) {
  const M = (x: THREE.Matrix4) => mul(m, x), BAND = '#9aa3ad', RIVET = '#5d6670';
  if (kind === 'scutum') {
    // curved back (gear.ts: R 0.32, arc 0.85, height 0.42, back layer R − 0.014): bands follow the arc just inside it
    const R = 0.32, arc = 0.85, r = R - 0.014 - 0.005;
    for (const y of [0.13, -0.11]) {
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= 8; i++) { const a = Math.PI - arc * 0.47 + (arc * 0.94 * i) / 8; pts.push([Math.sin(a) * r, y, Math.cos(a) * r + R - 0.02]); }
      p.add(tube(pts, 0.009, 12, 4), BAND, m);
      for (const k of [1, 4, 7]) { const [x, , z] = pts[k]; p.add(sphere(0.0085, 6, 4), RIVET, M(T(x, y, z + 0.006))); }
    }
  } else {
    const rad = kind === 'buckler' ? 0.11 : 0.17, z = (kind === 'buckler' ? 0.025 : kind === 'barrel' ? 0.05 : 0.035) / 2 + 0.004;
    for (const y of kind === 'buckler' ? [0.05] : [0.085, -0.075]) {
      const half = Math.sqrt(rad * rad - y * y) * 0.92;
      p.add(box(half * 2, 0.024, 0.008), BAND, M(T(0, y, z)));
      for (const x of [-half * 0.75, 0, half * 0.75]) p.add(sphere(0.008, 6, 4), RIVET, M(T(x, y, z + 0.005)));
    }
  }
  // arm strap + handle (the paw grips it; mostly hidden behind the paw)
  const zb = kind === 'scutum' ? 0.016 : kind === 'barrel' ? 0.034 : 0.026;
  p.add(box(0.05, 0.2, 0.012), '#5a3f2c', M(T(0, 0, zb)));
  p.add(cyl(0.01, 0.01, 0.16, 6), '#3a2a20', M(T(0, 0, zb + 0.012)));
}

/**
 * The view-model bow, in paw space: the grip runs along +Y through the fist (origin), the limbs curve in the bow's own
 * YZ plane with the tips (and the string) towards +Z — the camera side — then the plane is yawed so the curve reads.
 * Chunkier than the third-person bow (gear.ts) so it never disappears behind the paw.
 */
function addVmBow(p: Parts, rar?: string) {
  const B = VM_TUNE.bow, L = 0.2 * B.size, d = 0.078 * B.size, r0 = 0.0125 * B.size;
  const m = T(0, 0, 0, 0, B.yaw, B.cant);
  const M = (x: THREE.Matrix4) => mul(m, x);
  const acc = rar && rar !== 'common' ? RARITY_COLOR[rar] : '#e8b923';
  const WOOD = '#c4844a', RISER = '#8a5430';
  const g0 = 0.034 * B.size;   // half-height of the grip (inside the fist)
  for (const sy of [1, -1]) {
    // limb: leaves the riser, sweeps towards the string side, and the tip curls back (recurve)
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 7; i++) {
      const u = i / 7, y = g0 + u * (L * 0.9 - g0);
      pts.push([0, sy * y, d * 0.9 * Math.pow(u, 1.7)]);
    }
    pts.push([0, sy * L * 0.97, d * 0.84], [0, sy * L, d * 0.66]);
    p.add(tube(pts, r0, 22, 8, 0.45), WOOD, m);
    // riser shoulder (thicker wood just outside the fist) + a rarity-coloured wrap ring
    p.add(cyl(r0 * 1.25, r0 * 1.1, 0.03 * B.size, 10), RISER, M(T(0, sy * (g0 + 0.012 * B.size), 0.001)));
    p.add(torus(r0 * 1.2, 0.0035 * B.size, 5, 14), acc, M(T(0, sy * (g0 + 0.032 * B.size), d * 0.05, Math.PI / 2 - sy * 0.12, 0, 0)));
    // nock knob at the tip
    p.add(sphere(0.0075 * B.size, 8, 6), acc, M(T(0, sy * L * 0.985, d * 0.74)));
  }
  // arrow rest: a little shelf on the inner side, just above the fist
  p.add(box(0.012 * B.size, 0.006 * B.size, 0.022 * B.size), '#6a3a22', M(T(-0.014 * B.size, g0 + 0.003, 0.004)));
  // leather grip (mostly hidden in the fist)
  p.add(cyl(r0 * 1.35, r0 * 1.35, g0 * 2 + 0.006, 10), '#6a3a22', m);
  // string: tip to tip, on the camera side
  p.add(cyl(0.0021 * B.size, 0.0021 * B.size, 2 * L * 0.985, 4), '#e9dcc6', M(T(0, 0, d * 0.74)));
  // a little bow-tie charm under the upper tip (cute, and it marks the top limb)
  const ty = L * 0.78, tz = d * 0.62;
  p.add(sphere(0.007 * B.size, 6, 4), '#ff7fa0', M(T(0, ty, tz)));
  for (const sx of [-1, 1]) p.add(cone(0.011 * B.size, 0.018 * B.size, 4), '#ff7fa0', M(T(sx * 0.009 * B.size, ty, tz, 0, 0, sx * Math.PI / 2, [1, 1, 0.5])));
}

const TAN_REF = Math.tan((75 / 2) * Math.PI / 180), ASPECT_REF = 16 / 9;
const smooth = (x: number) => x * x * (3 - 2 * x);
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

class ViewModelImpl implements ViewModel {
  readonly root = new THREE.Group();
  private right = new THREE.Group();     // right paw (+ weapon, except censer which hangs from `pend`)
  private pend = new THREE.Group();      // censer pendulum pivot under the right paw
  private left = new THREE.Group();      // left paw / shield / bow
  private clearer: THREE.Mesh;
  private meshes: THREE.Mesh[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private kind: Kind = 'none';
  private hasShield = false;
  /** Extra idle drop for tall shields (the scutum), so every shield peeks in by about the same strip. */
  private shieldDrop = 0;
  private swingT = -1; private swingCD = 0;
  private drawT = 0; private drawAmt = 0; private stopT = 0;
  private nock: THREE.Object3D | null = null;
  /** Time since the bow was loosed (−1 = not recently): the paw kicks up and the bow wobbles. */
  private relT = -1;
  private bobPh = 0; private walk = 0; private t = 0;
  private swayX = 0; private swayY = 0; private swayVX = 0; private swayVY = 0;
  private blockOn = false; private blockAmt = 0;
  private raise = 0;                     // 0 = lowered out of view … 1 = in place (equip / show animation)
  private pendA = 0; private pendV = 0; private pendB = 0; private pendBV = 0;
  private key = '';
  private weapon: THREE.Mesh | null = null;
  /** Swing trail: the striking edge in the space of `bladeObj` (weapon mesh, or the right paw when unarmed). */
  private bladeObj: THREE.Object3D | null = null;
  private bladeA = new THREE.Vector3(); private bladeB = new THREE.Vector3();
  private aspect = ASPECT_REF;

  constructor(app: Appearance) {
    this.root.name = 'view-model';
    this.right.add(this.pend);
    this.root.add(this.right, this.left);
    // a tiny invisible mesh drawn first: clears the depth buffer once, so the view-model never clips into walls
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -1, 0, 0, -1, 0, 0, -1], 3));
    const cm = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true });
    this.clearer = new THREE.Mesh(cg, cm);
    this.clearer.renderOrder = 999; this.clearer.frustumCulled = false;
    this.clearer.onBeforeRender = (r) => { r.state.buffers.depth.setMask(true); r.clearDepth(); };
    this.root.add(this.clearer);
    this.setAppearance(app);
  }

  setAppearance(app: Appearance): void {
    const g = app.gear, l = app.look;
    const key = [l.color, g.w, g.wr, g.s, g.sr, g.a, g.ar, g.am, app.styleId, app.ghost ? 1 : 0].join('|');
    if (key === this.key) return;
    const first = this.key === '';
    this.key = key;
    for (const m of this.meshes) m.removeFromParent();
    if (this.nock) { this.nock.removeFromParent(); this.nock = null; }
    for (const ge of this.geos) ge.dispose();
    this.meshes = []; this.geos = [];
    const fur = l.color || '#f2a65a';
    const ak = g.a === 'lorica' && g.am === 'light' ? 'light' : g.a;
    const sleeve = ak ? (SLEEVE[ak] || SLEEVE.lorica)(g.ar || 'common') : fur;
    const trim = g.ar && g.ar !== 'common' ? RARITY_COLOR[g.ar] : ak === 'plate' ? '#b89a52' : '#c9b28a';
    const cat = app.styleId === 'cats', monkey = app.styleId === 'monkeys' || (app.styleId as string) === 'ugabugi', imp = app.styleId === 'cherts';
    const kind: Kind = g.w ? KIND[g.w] || 'blade' : 'none';
    this.kind = kind;
    // mirrors the third-person body: the weapon (any kind, the bow too) in the right paw, the shield on the left forearm
    this.hasShield = !!g.s;
    this.shieldDrop = SH_DROP[g.s || ''] ?? 0;

    /** Paw at the origin + forearm coming from below/outside the screen. s = +1 right, −1 left; fist = holds something. */
    const paw = (p: Parts, s: number, fist: boolean, arm: readonly [number, number, number] = VM_TUNE.arm.def) => {
      // one continuous limb along a straight axis from off-screen into the paw: sleeve (tapering towards the wrist),
      // a cuff, then a fur wrist that flows into the paw — no bend at the wrist
      const ax = new THREE.Vector3(s * arm[0], arm[1], arm[2]).normalize();
      const at = (k: number): [number, number, number] => [ax.x * k, ax.y * k - 0.004, ax.z * k + 0.012];
      const lim = tube([at(0.36), at(0.2), at(0.046)], 0.03, 8, 12, 0.13);
      p.add(lim, sleeve);
      // cuff ring perpendicular to the forearm axis (trim colour with armour, a darker fold of the sleeve without)
      const qT = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), ax), eT = new THREE.Euler().setFromQuaternion(qT);
      const qC = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), ax), eC = new THREE.Euler().setFromQuaternion(qC);
      p.add(torus(0.0262, 0.0056, 6, 18), g.a ? trim : new THREE.Color(sleeve).multiplyScalar(0.82), T(...at(0.048), eT.x, eT.y, eT.z));
      p.add(cyl(0.027, 0.0255, 0.05, 14, true), fur, T(...at(0.025), eC.x, eC.y, eC.z));
      p.add(sphere(0.0256, 12, 8), fur, T(...at(0.049)));
      if (fist) {
        // closed paw around the grip (grip runs along +Y through the origin): the back of the paw on the outer side, a
        // ring of fur closing around the grip, three curled toes stacked on the inner/front side (they read as fingers
        // from the camera) and the thumb folded over them
        // palm: an ellipsoid along the forearm, from the wrist to just past the grip — the paw continues the arm
        p.add(sphere(0.029, 16, 12), fur, mul(T(...at(0.016)), mul(new THREE.Matrix4().makeRotationFromQuaternion(qT), T(0, 0, 0, 0, 0, 0, [1, 1, 1.45]))));
        p.add(torus(0.0165, 0.011, 8, 16), fur, T(0, 0.0, -0.001, Math.PI / 2, 0, 0, [1.06, 1, 1]));
        // three curled toes wrapped round to the inner side (towards the camera), darker creases between them so they read as fingers
        const crease = new THREE.Color(fur).multiplyScalar(0.62);
        for (let i = 0; i < 3; i++) p.add(sphere(0.0118 - i * 0.0008, 10, 8), fur, T(-s * 0.0165, 0.012 - i * 0.0152, 0.002, 0, 0, 0, [0.95, 0.86, 1.1]));
        for (let i = 0; i < 2; i++) p.add(capsule(0.0019, 0.014, 2, 5), crease, T(-s * 0.0262, 0.0044 - i * 0.0152, 0.003, Math.PI / 2, 0, 0));
        // thumb folded across the front of the grip (camera side): the "opposition" that makes it a grip
        p.add(capsule(0.0098, 0.02, 3, 8), fur, T(-s * 0.009, 0.021, 0.014, 0, -s * 0.35, Math.PI / 2 - s * 0.15));
        // imp hands (cherts): little dark claws on the curled fingers
        if (imp) addClaws(p, [0, 1, 2].map((i) => [-s * 0.027, 0.012 - i * 0.0152, 0.004] as [number, number, number]), new THREE.Vector3(-s, -0.2, 0.5), 0.011);
        return;
      }
      // open paw: a soft mitten, toes on the top-front, beans on the underside
      p.add(sphere(0.033, 16, 12), fur, T(0, 0, 0, 0, 0, 0, [1.08, 0.82, 1.2]));
      for (const k of [-1, 0, 1]) p.add(sphere(0.012, 8, 6), fur, T(k * 0.0145, 0.018, -0.025 - (k === 0 ? 0.004 : 0), 0, 0, 0, [1, 0.85, 1]));
      if (cat) {
        for (const k of [-1, 0, 1]) p.add(sphere(0.0065, 6, 4), '#ff8fa3', T(k * 0.0145, -0.01, -0.036 - (k === 0 ? 0.004 : 0), 0, 0, 0, [1, 0.8, 0.6]));
        p.add(sphere(0.012, 8, 6), '#ff8fa3', T(0, -0.025, -0.018, 0, 0, 0, [1.2, 0.5, 0.9]));
      } else if (monkey) p.add(sphere(0.024, 10, 8), '#ffe4c4', T(0, -0.01, -0.01, 0, 0, 0, [1.1, 0.6, 1.1]));
      else if (imp) addClaws(p, [-1, 0, 1].map((k) => [k * 0.0145, 0.022, -0.035 - (k === 0 ? 0.004 : 0)] as [number, number, number]), new THREE.Vector3(0, 0.45, -1), 0.013);
    };

    // right paw
    const pr = new Parts();
    paw(pr, 1, kind !== 'none', kind === 'bow' || kind === 'censer' ? VM_TUNE.arm.bow : VM_TUNE.arm.def);
    this.mk(pr.build(), this.right, 'vm-right');
    // weapon (own mesh so it can pivot / swing relative to the paw)
    if (g.w) {
      const ws = WSCALE[g.w] ?? 0.6;
      const pw = new Parts();
      if (kind === 'bow') {
        addVmBow(pw, g.wr);   // a chunkier view-model bow, built around the fist
        // the nocked arrow (src/combat: hold LMB to draw): shown only while drawing, slides back with the draw
        const pa = new Parts(), d = 0.078 * VM_TUNE.bow.size;
        pa.add(cyl(0.0032, 0.0032, 0.3, 5), '#d9b07a', T(-0.01, 0.006, d * 0.74 - 0.15, Math.PI / 2, 0, 0));
        pa.add(cone(0.009, 0.03, 4), '#c9d2da', T(-0.01, 0.006, d * 0.74 - 0.315, -Math.PI / 2, 0, 0));
        for (const a of [0, Math.PI * 2 / 3, Math.PI * 4 / 3]) pa.add(box(0.0015, 0.012, 0.036), '#ff7fa0', T(-0.01 + Math.cos(a) * 0.006, 0.006 + Math.sin(a) * 0.006, d * 0.74 - 0.02, 0, 0, a));
        const ng = new THREE.Group(); ng.name = 'vm-nock'; ng.visible = false;
        this.right.add(ng); this.mk(pa.build(), ng, 'vm-nock');
        this.nock = ng;
      } else {
        // hand-space offset × size × the canonical hold shared with the third-person body (gear.ts weaponHold)
        const off = kind === 'censer' ? T(0, -0.036, 0, 0, 0, 0, ws)
          : kind === 'book' ? T(0, -0.01, 0, 0, 0, 0, ws)
            : kind === 'pole' || kind === 'spear' ? T(0, -0.02, 0, 0, 0, 0, ws)
              : T(0, -0.005, -0.005, 0, 0, 0, ws);
        const m = mul(off, weaponHold(g.w));
        addWeapon(pw, g.w, g.wr, m);
        const span = bladeSpan(g.w);
        if (span) { this.bladeA.set(0, span[0], 0).applyMatrix4(m); this.bladeB.set(0, span[1], 0).applyMatrix4(m); }
        if (kind === 'censer') {
          // a chunky chain from the fist to the lid (the third-person chain is a hairline at this distance)
          const CH = '#c9b98a';
          for (let i = 0; i < 6; i++) pw.add(torus(0.0062, 0.0019, 5, 10), CH, T(0, -0.012 - i * 0.0105, 0, 0, i % 2 ? Math.PI / 2 : 0, 0, [0.75, 1.15, 1]));
        }
      }
      this.weapon = this.mk(pw.build(), kind === 'censer' ? this.pend : this.right, 'vm-weapon');
      this.bladeObj = kind === 'bow' || kind === 'censer' || kind === 'book' ? null : this.weapon;
    } else {
      this.weapon = null;
      // bare paw: a short streak through the paw along the forearm
      const ax = new THREE.Vector3(VM_TUNE.arm.def[0], VM_TUNE.arm.def[1], VM_TUNE.arm.def[2]).normalize();
      this.bladeA.copy(ax).multiplyScalar(0.03); this.bladeB.copy(ax).multiplyScalar(-0.045);
      this.bladeObj = this.right;
    }
    // left: shield on the forearm, or the bare paw
    const pl = new Parts();
    if (this.hasShield) {
      paw(pl, -1, true);
      // a leather strap on the back side → reads as "the inside of a shield" when blocking
      const sc = SH_SCALE[g.s!] ?? 0.6;
      const ps = new Parts();
      const sm = T(-0.035, 0.06, -0.045, 0, 0, 0, sc);
      addShield(ps, g.s!, g.sr, sm);
      addShieldBack(ps, g.s!, sm);
      this.mk(ps.build(), this.left, 'vm-shield');
    } else paw(pl, -1, false);
    this.mk(pl.build(), this.left, 'vm-left');
    if (!first) this.raise = 0;           // re-equip: bring the new gear up from below
    else this.raise = 1;
    this.root.visible = this.root.visible;
  }

  /** Two meshes (outline hull + toon) sharing one geometry; returns the toon one. */
  private mk(geo: THREE.BufferGeometry, parent: THREE.Object3D, name: string): THREE.Mesh {
    this.geos.push(geo);
    let last!: THREE.Mesh;
    for (const [mat, order] of [[outlineMat('vm', 8, 0.0028), 1000], [toonMat('vm'), 1001]] as const) {
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = order; m.frustumCulled = false; m.name = name;
      this.meshes.push(m); parent.add(m); last = m;
    }
    return last;
  }

  /** Place a group at a pose (reference-frame screen anchor → view space) plus offsets. */
  private place(o: THREE.Object3D, p: Pose, dx: number, dy: number, dz: number, rx: number, ry: number, rz: number) {
    const z = p[2] + dz;
    o.position.set(p[0] * -z * TAN_REF * this.aspect + dx, p[1] * -z * TAN_REF + dy, z);
    o.rotation.set(p[3] + rx, p[4] + ry, p[5] + rz);
  }

  update(dt: number, t: number, speed01: number, look: { dx: number; dy: number }): void {
    if (!this.root.visible) return;
    dt = Math.min(0.05, Math.max(0, dt));
    this.t = t;
    // follow the camera's fov/aspect
    const cam = this.root.parent as THREE.PerspectiveCamera | null;
    if (cam && (cam as THREE.PerspectiveCamera).isPerspectiveCamera) {
      this.aspect = cam.aspect || ASPECT_REF;
      this.root.scale.setScalar(Math.tan((cam.fov / 2) * Math.PI / 180) / TAN_REF);
    }
    const w = clamp(speed01, 0, 1.6);
    this.walk += (w - this.walk) * Math.min(1, dt * 7);
    const wk = Math.min(1, this.walk), run = clamp((this.walk - 1) / 0.5, 0, 1);
    this.bobPh += dt * (7 + run * 3.5) * Math.min(1, this.walk * 3);
    this.raise = Math.min(1, this.raise + dt * 3.2);
    this.blockAmt += ((this.blockOn ? 1 : 0) - this.blockAmt) * Math.min(1, dt * (this.blockOn ? 14 : 9));
    this.swingCD = Math.max(0, this.swingCD - dt);

    // mouse sway: a damped spring that lags behind the look direction
    const tx = clamp(-look.dx * 0.00055, -0.035, 0.035), ty = clamp(look.dy * 0.00055, -0.03, 0.03);
    this.swayVX += ((tx - this.swayX) * 160 - this.swayVX * 18) * dt;
    this.swayVY += ((ty - this.swayY) * 160 - this.swayVY * 18) * dt;
    this.swayX += this.swayVX * dt; this.swayY += this.swayVY * dt;

    // walk bob (figure-eight), idle breathing
    const s = Math.sin(this.bobPh), c2 = Math.cos(this.bobPh * 2);
    const amp = 0.009 * wk + 0.012 * run;
    const bx = s * amp, by = -Math.abs(Math.sin(this.bobPh)) * amp * 1.3 + c2 * 0.001;
    const br = Math.sin(t * 1.7) * 0.0035 * (1 - wk), br2 = Math.cos(t * 0.9) * 0.002 * (1 - wk);
    const raiseY = -0.22 * (1 - smooth(this.raise));
    this.root.position.set(this.swayX + bx + br2, this.swayY + by + br + raiseY, 0);
    this.root.rotation.set(this.swayY * 0.8, 0, this.swayX * 1.6 + s * 0.012 * wk);

    // right paw: rest (+ parry when blocking without a shield) + swing + sprint lowering
    const kind = this.kind;
    const rest = VM_TUNE.right[kind];
    let dx = 0, dy = 0, dz = 0, rx = 0, ry = 0, rz = 0;
    if (!this.hasShield && this.blockAmt > 0.001) {
      const b = smooth(this.blockAmt);
      const pr = PARRY_R, z = pr[2];
      // interpolate in screen space towards the parry pose
      dx += (pr[0] - rest[0]) * -z * TAN_REF * this.aspect * b; dy += (pr[1] - rest[1]) * -z * TAN_REF * b;
      rx += (pr[3] - rest[3]) * b; ry += (pr[4] - rest[4]) * b; rz += (pr[5] - rest[5]) * b;
    }
    if (this.stopT > 0) this.stopT -= dt;
    if (this.swingT >= 0) {
      this.swingT += this.stopT > 0 ? dt * 0.06 : dt;
      const keys = SWINGS[kind], end = keys[keys.length - 1][0];
      if (this.swingT >= end) this.swingT = -1;
      else {
        let i = 0; while (i < keys.length - 2 && this.swingT > keys[i + 1][0]) i++;
        const a = keys[i], b = keys[i + 1], q = easeK(b[7] ?? 0, clamp((this.swingT - a[0]) / (b[0] - a[0]), 0, 1));
        dx += a[1] + (b[1] - a[1]) * q; dy += a[2] + (b[2] - a[2]) * q; dz += a[3] + (b[3] - a[3]) * q;
        rx += a[4] + (b[4] - a[4]) * q; ry += a[5] + (b[5] - a[5]) * q; rz += a[6] + (b[6] - a[6]) * q;
        if (kind === 'censer' && i === 1) this.pendV -= dt * 40;   // flick kicks the pendulum forward
      }
    }
    // bow draw (src/combat: hold LMB): raise to the aim pose of the draw track and hold; a tremble at full draw
    const dT = this.drawT;
    this.drawAmt += (dT - this.drawAmt) * Math.min(1, dt * (dT > this.drawAmt ? 9 : 24));
    const da = smooth(clamp(this.drawAmt, 0, 1));
    if (da > 0.001) {
      const k = SW_DRAW[2], tr = dT > 0.97 ? Math.sin(t * 53) * 0.0016 : 0;
      dx += k[1] * da + tr; dy += k[2] * da + tr * 0.7; dz += k[3] * da; rx += k[4] * da; ry += k[5] * da; rz += k[6] * da;
    }
    if (this.nock) {
      this.nock.visible = dT > 0.02;
      this.nock.position.z = 0.05 * clamp(dT, 0, 1);   // pulled back towards the camera
    }
    if (this.relT >= 0) {
      this.relT += dt;
      if (this.relT > 0.3) this.relT = -1;
      else {
        // release snap: the bow paw kicks up and forward, the bow wobbles, then settles
        const r = 1 - this.relT / 0.3, r2 = r * r;
        dy += 0.03 * r2; dz -= 0.025 * r2; rx -= 0.22 * r2; rz += Math.sin(this.relT * 60) * 0.06 * r2;
      }
    }
    rx += run * 0.45 * (1 - da); dy -= run * 0.03; rz -= run * 0.15 * (1 - da);
    this.place(this.right, rest, dx, dy, dz, rx, ry, rz);

    // censer pendulum: driven by sway and bob (two axes, damped)
    if (kind === 'censer') {
      const drive = -this.swayVY * 6 + Math.cos(this.bobPh) * 0.6 * wk;
      this.pendV += (-this.pendA * 38 - this.pendV * 2.2 + drive) * dt; this.pendA += this.pendV * dt;
      this.pendBV += (-this.pendB * 38 - this.pendBV * 2.2 - this.swayVX * 6 + s * 0.5 * wk) * dt; this.pendB += this.pendBV * dt;
      this.pend.rotation.set(clamp(this.pendA, -0.9, 0.9), 0, clamp(this.pendB, -0.9, 0.9) + Math.sin(t * 1.3) * 0.04);
    }

    // left paw / shield / bow
    const L = this.left;
    if (this.hasShield) {
      const b = smooth(this.blockAmt), a = VM_TUNE.lShield, k = VM_TUNE.block;
      const z = a[2] + (k[2] - a[2]) * b;
      L.position.set((a[0] + (k[0] - a[0]) * b) * -z * TAN_REF * this.aspect - bx * 0.6, (a[1] + (k[1] - a[1]) * b) * -z * TAN_REF + by * 0.6 - run * 0.03 - this.shieldDrop, z);
      L.rotation.set(a[3] + (k[3] - a[3]) * b + run * 0.3, a[4] + (k[4] - a[4]) * b, a[5] + (k[5] - a[5]) * b);
    } else {
      this.place(L, kind === 'none' ? VM_TUNE.lPawNone : VM_TUNE.lPaw, -bx * 0.8, by * 0.8 - Math.cos(this.bobPh) * 0.006 * wk, 0, run * 0.4, 0, Math.sin(t * 1.3) * 0.03);
      if (da > 0.001 && kind === 'bow') {
        // the free paw comes up to the string and pulls it back towards the cheek
        const P = VM_TUNE.pull, pl = clamp(dT, 0, 1), z = P[2] + 0.05 * pl;
        const px = P[0] * -z * TAN_REF * this.aspect, py = P[1] * -z * TAN_REF;
        L.position.set(L.position.x + (px - L.position.x) * da, L.position.y + (py - L.position.y) * da, L.position.z + (z - L.position.z) * da);
        L.rotation.set(L.rotation.x + (P[3] - L.rotation.x) * da, L.rotation.y + (P[4] - L.rotation.y) * da, L.rotation.z + (P[5] - L.rotation.z) * da);
      }
    }
  }

  /** World positions of the striking edge now (swing trail); false when there is none or the paws are hidden. */
  bladeSeg(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const o = this.bladeObj;
    if (!o || !this.root.visible || !this.root.parent) return false;
    o.updateWorldMatrix(true, false);
    a.copy(this.bladeA).applyMatrix4(o.matrixWorld); b.copy(this.bladeB).applyMatrix4(o.matrixWorld);
    return true;
  }
  /** World position of the nocked arrow's head while drawing; false = not drawing. */
  arrowTip(out: THREE.Vector3): boolean {
    const n = this.nock;
    if (!n || !n.visible || !this.root.visible) return false;
    n.updateWorldMatrix(true, false);
    out.set(-0.01, 0.006, 0.078 * VM_TUNE.bow.size * 0.74 - 0.33).applyMatrix4(n.matrixWorld);
    return true;
  }
  /** Seconds since the current swing started (−1 = none). */
  get swingTime(): number { return this.swingT; }
  /** True when swing() would start a swing now. */
  get swingReady(): boolean { return this.swingCD <= 0 && this.drawT <= 0; }
  /** Bow draw (0 … 1; 0 = released). While drawing, swing() is ignored (the click is the draw). */
  setDraw(k: number): void { if (k <= 0 && this.drawT > 0.15) this.relT = 0; this.drawT = clamp(k, 0, 1); }
  /** Hit-stop: the swing nearly freezes for `sec`. */
  hitStop(sec: number): void { this.stopT = Math.max(this.stopT, sec); }
  swing(): void {
    if (this.swingCD > 0 || this.drawT > 0) return;
    this.swingT = 0;
    const keys = SWINGS[this.kind];
    this.swingCD = keys[keys.length - 1][0] * 0.75;
  }
  /** Raise the shield (or parry with the weapon) while RMB is held. */
  block(on: boolean): void { this.blockOn = on; }
  get blocking(): boolean { return this.blockAmt > 0.5; }
  setVisible(on: boolean): void {
    if (on && !this.root.visible) this.raise = 0.35;   // bring the paws up when re-entering first person
    this.root.visible = on;
  }
  dispose(): void {
    for (const ge of this.geos) ge.dispose();
    this.clearer.geometry.dispose(); (this.clearer.material as THREE.Material).dispose();
    this.root.clear(); this.root.removeFromParent();
  }
}

/** The view-model with the optional extras (block) the integrator may use. */
export type ViewModelEx = ViewModel & {
  block(on: boolean): void; readonly blocking: boolean;
  /** Combat hooks (src/combat): bow draw, hit-stop, swing readiness. */
  setDraw?(k: number): void; hitStop?(sec: number): void; readonly swingReady?: boolean;
  bladeSeg?(a: THREE.Vector3, b: THREE.Vector3): boolean;
  arrowTip?(out: THREE.Vector3): boolean;
};
export function createViewModel(app: Appearance): ViewModelEx { return new ViewModelImpl(app); }
