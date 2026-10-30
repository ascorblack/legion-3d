/**
 * Avatar: a skinned instance of a shared model + per-avatar bones, face decal, outline, aura; procedural animation.
 * update() never allocates.
 */
import * as THREE from 'three';
import type { Appearance } from '../contracts';
import type { Avatar } from '../contracts/modules';
import { getModel, releaseModel, faceKeyOf, B, BONE_COUNT, BONE_PARENT, type ModelData } from './model';
import { faceTexture, facePatch, moodFace, MOOD_FACE, type Mood, type FaceKey } from './face';
import { ContactShadow } from './shadows';
import { toonMat, outlineMat, faceMat, alphaLevel, ALPHA_LEVELS, uTime, auraPointsMat, glowMat, glowSolidMat, type Variant } from './materials';
import { nickExtras, jhash } from './appearance';
import { TP_TRACKS, TP_CONTACT, TP_VALUES, FAMILY_TRACK, trackLen, sampleTrack } from './attacks';
import { weaponFamily } from './viewmodel';
import { BowDraw } from './bowdraw';

/**
 * What the combat module (src/combat) needs to drive an avatar as a ragdoll: the live bones and the model's rest
 * data. Returned by `AvatarCombat.combatRig()` (duck-typed: not part of the Avatar contract).
 */
export interface CombatRig {
  bones: THREE.Bone[];
  /** Rest bone positions in model space (feet at y = 0, looking to −Z). */
  rest: THREE.Vector3[];
  handL: THREE.Vector3; handR: THREE.Vector3;
  y0: number; top: number; w: number; depth: number; eyeY: number; ex: number; armY: number;
  headTop: number; hasTail: boolean; hasLegs: boolean;
}
/** Optional avatar hooks used by src/combat (attacks, ragdolls). */
export interface AvatarCombat {
  combatRig(): CombatRig | null;
  /** Bow draw pose (0 = none … 1 = fully drawn); a 'swing' is ignored while drawing. */
  setDraw(k: number): void;
  /** Slow the current attack animation almost to a stop for `sec` (hit-stop). */
  hitStop(sec: number): void;
  /** White hit flash over the body (0 = off). */
  setFlash(a: number): void;
  /** Dizzy face (spiral eyes, wobbly mouth) while knocked down. */
  setDizzy(on: boolean): void;
  /** World position of the nocked arrow's head while drawing (charge glint); false = not drawing. */
  arrowTip(out: THREE.Vector3): boolean;
  /** World positions of the striking edge of the held weapon (or the paw) now, for the swing trail; false = none. */
  bladeSeg(a: THREE.Vector3, b: THREE.Vector3, pivot?: THREE.Vector3): boolean;
}
/** Optional social hooks (src/features/mood, bench, cheer): duck-typed, not part of the Avatar contract. */
export interface AvatarSocial {
  /** Show a chat mood on the face for `sec` seconds (null = back to the own face now). The dizzy face wins. */
  setMood(mood: Mood | null, sec?: number): void;
  /** Sitting pose (legs forward, paws on the lap): 0 = standing … 1 = seated; eased inside update(). */
  setSit(on: boolean): void;
  /** How far below the seat top the avatar root goes when seated (m): the body's bottom rests on the seat. */
  readonly sitDrop: number;
}

/* ------------------------------------------------------------------ aura */
interface AuraDef { color: string; size: number; rise: number; n: number; glow?: string; glowOp?: number; additive?: boolean }
const AURAS: Record<string, AuraDef> = {
  gold: { color: '#ffe9a0', size: 0.05, rise: 1.1, n: 14, glow: '#ffd76a', glowOp: 0.55 },
  sparks: { color: '#fff6c8', size: 0.07, rise: 1.0, n: 16, glow: '#fff0a8', glowOp: 0.25 },
  shadow: { color: '#c48bff', size: 0.05, rise: 0.9, n: 14, glow: '#2a0f44', glowOp: 0.7, additive: false },
  frost: { color: '#e6f7ff', size: 0.06, rise: 0.9, n: 14, glow: '#8fd4ff', glowOp: 0.5 },
  halo: { color: '#fff3b0', size: 0.04, rise: 0.6, n: 6, glow: '#fff3b0', glowOp: 0.25 },
  wisps: { color: '#9fffd0', size: 0.08, rise: 0.8, n: 8 },
  leaves: { color: '#ffb04a', size: 0.06, rise: -0.9, n: 10 },
  haunt: { color: '#b8c4d8', size: 0.1, rise: 0.4, n: 10, glow: '#5a6a88', glowOp: 0.4, additive: false },
  // Halloween (doodle.js hwAura, 26.10): a small colony of bats circling over the head (rise = flight height above the
  // root, set from the model's head top below), and an orange pumpkin glow with little pumpkins rising
  bats: { color: '#2a1f38', size: 0.16, rise: 0, n: 4 },
  jackglow: { color: '#ff8a1f', size: 0.11, rise: 0.9, n: 7, glow: '#ff7a1a', glowOp: 0.6 },
};
const auraGeoCache = new Map<string, THREE.BufferGeometry>();
function auraGeo(n: number, r: number, h: number, key: string): THREE.BufferGeometry {
  let g = auraGeoCache.get(key);
  if (g) return g;
  const pos = new Float32Array(n * 3), seed = new Float32Array(n * 4);
  let s = jhash(key) || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.5, rr = r * (0.8 + rnd() * 0.5);
    pos[i * 3] = Math.cos(a) * rr; pos[i * 3 + 1] = rnd() * h * 0.4; pos[i * 3 + 2] = Math.sin(a) * rr;
    seed[i * 4] = rnd(); seed[i * 4 + 1] = rnd(); seed[i * 4 + 2] = rnd(); seed[i * 4 + 3] = rnd() * 1.2;
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, h / 2, 0), h + r);
  auraGeoCache.set(key, g);
  return g;
}
const discGeo = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
const haloGeo = new THREE.TorusGeometry(0.13, 0.016, 6, 28).rotateX(Math.PI / 2);

/* ------------------------------------------------------------------ shared shadow-only material (first person body) */
let hiddenMat: THREE.MeshBasicMaterial | null = null;
const hidden = () => (hiddenMat ||= new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));

/* ------------------------------------------------------------------ emotes */
const EMOTE_LEN: Record<string, number> = { wave: 1.6, cheer: 1.4, equip: 0.8, swing: 0.45, hit: 0.35, clap: 1.3, laugh: 1.5 };
for (const k in TP_TRACKS) EMOTE_LEN[k] = trackLen(TP_TRACKS[k]);
let flashMatProto: THREE.MeshBasicMaterial | null = null;
const _bm = new THREE.Matrix4(), _bt = new THREE.Vector3(), _bb = new THREE.Vector3(), _bg = new THREE.Vector3(), _bc = new THREE.Vector3(), _bd = new THREE.Vector3();
const _bn = new THREE.Vector3(), _bv = new THREE.Vector3(), _bh = new THREE.Vector3(), _bq = new THREE.Quaternion();
const _base: number[] = new Array(TP_VALUES).fill(0), _out: number[] = new Array(TP_VALUES).fill(0);
/** 'jump' holds the in-air pose until 'land' (or this many seconds, if no landing is reported). */
const JUMP_MAX = 2.5, LAND_LEN = 0.32;
/** TP bow draw: the bow is canted about the arrow (rad) so the drawn string reads from the over-the-shoulder camera. */
export let BOW_CANT = -0.5;
export function setBowCant(v: number) { BOW_CANT = v; }

class AvatarImpl implements Avatar, AvatarCombat, AvatarSocial {
  readonly root = new THREE.Group();
  headTop = 1.35;
  private model: ModelData | null = null;
  private bones: THREE.Bone[] = [];
  private skel: THREE.Skeleton | null = null;
  private mesh: THREE.SkinnedMesh | null = null;
  private outline: THREE.SkinnedMesh | null = null;
  /** Face decal key of THIS avatar's look (faceKeyOf). */
  private faceKey = '';
  private face: THREE.Mesh | null = null;
  private low: THREE.Mesh | null = null;
  private auraGroup = new THREE.Group();
  private auraHalo: THREE.Mesh | null = null;
  private app!: Appearance;
  private lod: 0 | 1 | 2 = 0;
  private alpha = 1; private lvl = ALPHA_LEVELS;
  private fp = false;
  private phase = 0; private walk = 0; private seedT = 0;
  private emote = ''; private emoteT = 0;
  /** Jump state: time since take-off (-1 = on the ground) and since landing (-1 = no landing squash). */
  private jumpT = -1; private landT = -1;
  private restY: number[] = [];
  private drawT = 0; private drawAmt = 0; private stopT = 0;
  private flash: THREE.SkinnedMesh | null = null; private flashA = 0;
  private dizzy = false;
  private mood: Mood | null = null; private moodT = 0;
  private sitOn = false; private sitAmt = 0;
  private bowKit: BowDraw | null = null;
  private armLRest = new THREE.Vector3(); private armRRest = new THREE.Vector3();
  /** Time since the bow was loosed (−1 = not recently). */
  private relT = -1;
  /** Soft contact shadow under the feet (one shared instanced draw per scene). */
  private shadow = new ContactShadow();

  constructor(app: Appearance) {
    this.root.name = 'avatar';
    this.auraGroup.name = 'aura';
    this.setAppearance(app);
  }

  setAppearance(app: Appearance): void {
    this.app = app;
    const prev = this.model;
    const m = getModel(app);
    if (prev) releaseModel(prev);
    this.model = m;
    this.seedT = (jhash(app.login) % 1000) / 1000 * 10;
    this.headTop = m.headTop;
    this.rebuild();
  }

  private variant(): Variant { return this.app.ghost ? 'g' : 'n'; }

  private rebuild() {
    const m = this.model!;
    // clear old scene objects (geometries/materials are shared → no dispose)
    if (this.mesh) { this.root.remove(this.mesh); this.mesh = null; }
    if (this.outline) { this.root.remove(this.outline); this.outline = null; }
    if (this.low) { this.root.remove(this.low); this.low = null; }
    this.skel?.dispose();
    if (this.flash) { this.flash.removeFromParent(); (this.flash.material as THREE.Material).dispose(); this.flash = null; }
    this.auraGroup.clear(); this.root.remove(this.auraGroup); this.auraHalo = null;

    // bones
    const rest = m.rig.rest;
    this.bones = [];
    for (let i = 0; i < BONE_COUNT; i++) {
      const b = new THREE.Bone(); b.name = 'b' + i;
      const par = BONE_PARENT[i];
      b.position.copy(rest[i]); if (par >= 0) b.position.sub(rest[par]);
      this.bones.push(b);
      if (par >= 0) this.bones[par].add(b);
    }
    this.restY = this.bones.map((b) => b.position.y);
    this.armLRest.copy(this.bones[B.armL].position); this.armRRest.copy(this.bones[B.armR].position);
    if (this.bowKit) { this.bowKit.dispose(); this.bowKit = null; }
    const inv = rest.map((r) => new THREE.Matrix4().makeTranslation(-r.x, -r.y, -r.z));
    this.skel = new THREE.Skeleton(this.bones, inv);

    const v = this.variant();
    const mesh = new THREE.SkinnedMesh(m.geo, toonMat(v, this.lvl));
    mesh.add(this.bones[0]);
    mesh.bind(this.skel, new THREE.Matrix4());
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.7, 0), m.radius);
    mesh.castShadow = true;
    mesh.name = 'avatar-body';
    this.mesh = mesh;
    this.root.add(mesh);

    const ol = new THREE.SkinnedMesh(m.geo, outlineMat(v, this.lvl));
    ol.bind(this.skel, new THREE.Matrix4());
    ol.boundingSphere = mesh.boundingSphere;
    ol.name = 'avatar-outline';
    this.outline = ol;
    this.root.add(ol);

    // face decal follows the body bone
    const ex = nickExtras(this.app.login, this.app.styleId);
    void ex;
    this.faceKey = faceKeyOf(this.app, m.dims);   // this avatar's own eyes / mouth / blush (the model is shared)
    const fk = this.faceKey.split('|');
    const tex = faceTexture({ eyes: fk[0], mouth: fk[1], blush: fk[2] === '1', iris: +fk[3], style: fk[4], narrow: fk[5] === '1', ghost: fk[6] === '1' });
    const face = new THREE.Mesh(facePatch(m.dims, m.key), faceMat(tex, this.faceKey, v, this.lvl));
    face.position.y = -rest[B.body].y;
    face.renderOrder = 1;
    face.name = 'avatar-face';
    this.face = face;
    this.bones[B.body].add(face);

    // LOD2 static mesh
    const low = new THREE.Mesh(m.low, toonMat(v, this.lvl));
    low.visible = false; low.name = 'avatar-low';
    this.low = low;
    this.root.add(low);

    // aura
    const kind = this.app.look.aura;
    const def = kind ? AURAS[kind] : undefined;
    if (def) {
      const r = m.dims.w + 0.12, h = m.headTop;
      const pts = new THREE.Points(auraGeo(def.n, r, h, `${kind}|${r.toFixed(2)}`), auraPointsMat(kind!, def.color, def.size, def.rise));
      if (kind === 'bats') pts.position.y = h + 0.2;   // the bats circle above the head (shader: rise 0 = orbit plane)
      pts.frustumCulled = true;
      this.auraGroup.add(pts);
      if (def.glow) {
        const disc = new THREE.Mesh(discGeo, glowMat(def.glow, def.glowOp ?? 0.4, def.additive !== false));
        disc.scale.setScalar(r * 1.7); disc.position.y = 0.02; disc.renderOrder = -1;
        this.auraGroup.add(disc);
      }
      if (kind === 'halo') {
        const halo = new THREE.Mesh(haloGeo, glowSolidMat('#ffe27a'));
        halo.position.y = m.headTop + 0.08;
        this.auraHalo = halo;
        this.auraGroup.add(halo);
      }
      this.root.add(this.auraGroup);
    }
    this.applyState();
  }

  private applyState() {
    const v = this.variant(), lod = this.lod, fp = this.fp;
    const vis = this.lvl > 0;
    if (this.mesh && this.model) {
      this.mesh.visible = vis && lod < 2; this.mesh.material = fp ? hidden() : toonMat(v, this.lvl);
      const g = lod === 1 && !fp ? this.model.mid : this.model.geo;
      if (this.mesh.geometry !== g) this.mesh.geometry = g;
    }
    if (this.outline) this.outline.visible = vis && lod === 0 && !fp;
    if (this.face && this.model) {
      this.face.visible = vis && lod < 2 && !fp;
      const fk = this.faceKey.split('|');
      const dz = this.dizzy, md = dz ? null : this.mood;
      const f: FaceKey = { eyes: dz ? 'dizzy' : fk[0], mouth: dz ? 'wobble' : fk[1], blush: fk[2] === '1', iris: +fk[3], style: fk[4], narrow: fk[5] === '1', ghost: fk[6] === '1' };
      this.face.material = faceMat(faceTexture(moodFace(f, md)), this.faceKey + (dz ? '|dizzy' : md ? '|' + md : ''), v, this.lvl);
    }
    if (this.low) { this.low.visible = vis && lod === 2 && !fp; this.low.material = toonMat(v, this.lvl); }
    this.auraGroup.visible = vis && lod === 0 && !fp;
  }

  update(dt: number, t: number, speed01: number): void {
    uTime.value = t;
    const bones = this.bones;
    if (!bones.length) return;
    if (this.model && this.lvl > 0) {
      const gh = !!this.app.ghost, air = this.jumpT >= 0 ? 0.6 : 1;
      this.shadow.stamp(this.root, (this.model.dims.w * 1.7 + 0.08) * (2 - air), (this.lvl / ALPHA_LEVELS) * (gh ? 0.3 : 0.85) * air);
    }
    if (this.moodT > 0) { this.moodT -= dt; if (this.moodT <= 0) { this.mood = null; this.applyState(); } }
    const sitTarget = this.sitOn ? 1 : 0;
    if (this.sitAmt !== sitTarget) this.sitAmt = Math.abs(sitTarget - this.sitAmt) < 0.01 ? sitTarget : this.sitAmt + (sitTarget - this.sitAmt) * Math.min(1, dt * 9);
    // smooth the walk amount; advance the gait phase with speed
    const target = Math.min(1.6, Math.max(0, speed01));
    this.walk += (target - this.walk) * Math.min(1, dt * 8);
    const w = Math.min(1, this.walk), run = Math.max(0, this.walk - 1);
    this.phase += dt * (6.5 + run * 4) * Math.min(1, this.walk * 2.5);
    const ph = this.phase, tt = t + this.seedT;
    const ghost = !!this.app.ghost || !this.model!.hasLegs;

    if (this.lod === 2) {   // impostor-like low mesh: a cheap bob only
      if (this.low) this.low.position.y = Math.abs(Math.sin(ph)) * 0.04 * w + (ghost ? 0.05 + Math.sin(tt * 2) * 0.03 : 0);
      return;
    }
    const body = bones[B.body], armL = bones[B.armL], armR = bones[B.armR], legL = bones[B.legL], legR = bones[B.legR];
    const wrist = bones[B.wrist];
    wrist.rotation.set(0, 0, 0);
    const s = Math.sin(ph), c = Math.cos(ph);
    // body: bob (two bumps per stride), sway, breathing
    const breathe = Math.sin(tt * 2.2) * 0.012 * (1 - w);
    // waddle: hop on every step, roll towards the planted foot, squash a little on contact
    const hop = Math.abs(s), contact = 1 - hop;
    body.position.y = this.restY[B.body] + hop * (0.055 + run * 0.035) * w + (ghost ? 0.06 + Math.sin(tt * 2) * 0.035 : 0);
    body.rotation.z = s * 0.1 * w + Math.sin(tt * 0.9) * 0.015 * (1 - w);
    body.rotation.x = -0.07 * w - run * 0.12;
    body.rotation.y = s * 0.07 * w;
    const sq = contact * contact * 0.045 * w;
    body.scale.set(1 - breathe * 0.5 + sq * 0.5, 1 + breathe - sq, 1 - breathe * 0.5 + sq * 0.5);
    // legs
    legL.rotation.x = s * (0.95 + run * 0.2) * w; legR.rotation.x = -s * (0.95 + run * 0.2) * w;
    legL.position.y = this.restY[B.legL] + Math.max(0, -c) * 0.075 * w;
    legR.position.y = this.restY[B.legR] + Math.max(0, c) * 0.075 * w;
    // arms: swing opposite to legs, idle sway outward
    const idle = Math.sin(tt * 1.6) * 0.06 * (1 - w);
    // the shield arm swings less (the shield stays in front, clear of a cape)
    armL.rotation.set(-s * (this.app.gear.s ? 0.45 : 0.85) * w, 0, -0.22 - idle - hop * 0.12 * w);
    armR.rotation.set(s * 0.85 * w, 0, 0.22 + idle + hop * 0.12 * w);
    if (this.app.gear.w) armR.rotation.x += 0.25;   // holding a weapon a bit forward
    if (this.app.gear.s) armL.rotation.x += 0.35;
    // tail
    if (this.model!.hasTail) {
      // stiff, perky tail: a slow sway when idle, a small counter-swing with the waddle
      bones[B.tail1].rotation.z = Math.sin(tt * 1.6) * 0.1 * (1 - w) - s * 0.12 * w;
      bones[B.tail1].rotation.x = -0.08 * w + Math.sin(tt * 1.1) * 0.03;
      bones[B.tail2].rotation.z = Math.sin(tt * 1.6 - 0.7) * 0.12 * (1 - w) - s * 0.08 * w;
    }
    // cape: drag back with speed, flutter
    if (this.model!.hasCape) {
      // negative x rotation swings the hem backwards (+Z), away from the body; a cat's tail rises right behind
      // a (shorter) cape, so the drag is smaller there and the cloth never cuts through the tail
      const k = this.model!.hasTail ? 0.45 : 1;
      bones[B.cape1].rotation.x = -k * (0.1 * w + run * 0.22) - Math.abs(Math.sin(tt * 3.1)) * 0.02;
      bones[B.cape2].rotation.x = -k * (0.26 * w + run * 0.32) - Math.abs(Math.sin(tt * 5.3 + 0.6)) * (0.04 + 0.07 * w) * k;
      bones[B.cape2].rotation.z = Math.sin(tt * 2.3) * 0.05;
    } else if (this.model!.wings) {
      // imp wings (cherts) hang on the free cape1 bone: a lazy beat when idle, quicker on the move (span scale)
      bones[B.cape1].scale.x = 1 + Math.sin(tt * (2.2 + 5 * w + run * 4)) * (0.1 + 0.08 * w);
    }
    // sitting: legs forward over the seat edge, paws on the lap, a slow tail swing and a little lean back
    if (this.sitAmt > 0.001) {
      const k = this.sitAmt, kick = Math.sin(tt * 1.3) * 0.12;
      legL.rotation.x += (1.25 + kick - legL.rotation.x) * k; legR.rotation.x += (1.25 - kick - legR.rotation.x) * k;
      legL.position.y += (this.restY[B.legL] - legL.position.y) * k; legR.position.y += (this.restY[B.legR] - legR.position.y) * k;
      body.position.y += (this.restY[B.body] + breathe * 0.5 - body.position.y) * k;
      body.rotation.x += (0.06 - body.rotation.x) * k; body.rotation.y *= 1 - k;
      body.rotation.z += (Math.sin(tt * 0.7) * 0.03 - body.rotation.z) * k;
      armL.rotation.set(armL.rotation.x + (0.55 - armL.rotation.x) * k, armL.rotation.y * (1 - k), armL.rotation.z + (-0.32 - armL.rotation.z) * k);
      armR.rotation.set(armR.rotation.x + (0.55 - armR.rotation.x) * k, armR.rotation.y * (1 - k), armR.rotation.z + (0.32 - armR.rotation.z) * k);
      if (this.model!.hasTail) { bones[B.tail1].rotation.x += -0.5 * k; bones[B.tail1].rotation.z += Math.sin(tt * 1.1) * 0.15 * k; }
    }
    // emotes override arms
    if (this.stopT > 0) this.stopT -= dt;
    if (this.emote) {
      const prevT = this.emoteT;
      this.emoteT += this.stopT > 0 ? dt * 0.06 : dt;
      const len = EMOTE_LEN[this.emote] || 1, k = this.emoteT / len;
      if (k >= 1) this.emote = '';
      else {
        const env = Math.min(1, k * 6, (1 - k) * 6);
        switch (this.emote) {
          case 'wave':
            armR.rotation.set(0.1, 0, 0.18 + env * (2.5 + Math.sin(this.emoteT * 14) * 0.35));
            break;
          case 'cheer': {
            const hop = Math.abs(Math.sin(k * Math.PI * 3));
            armL.rotation.set(0, 0, -0.18 - env * 2.6); armR.rotation.set(0, 0, 0.18 + env * 2.6);
            body.position.y += hop * 0.1 * env;
            break;
          }
          case 'clap': {   // paws in front, clapping together a few times
            const c = Math.abs(Math.sin(this.emoteT * 13));
            armL.rotation.set(env * 1.25, 0, -0.18 + env * (0.75 - c * 0.5)); armR.rotation.set(env * 1.25, 0, 0.18 - env * (0.75 - c * 0.5));
            body.position.y += Math.abs(Math.sin(this.emoteT * 6.5)) * 0.025 * env;
            break;
          }
          case 'laugh': {   // holding the belly, the body shakes and leans back
            const sh = Math.sin(this.emoteT * 24) * env;
            armL.rotation.set(env * 0.9, 0, -0.18 + env * 0.55); armR.rotation.set(env * 0.9, 0, 0.18 - env * 0.55);
            body.rotation.x += 0.16 * env; body.rotation.z += sh * 0.05;
            body.position.y += Math.abs(sh) * 0.02;
            break;
          }
          case 'equip':
            armR.rotation.set(env * 1.6, 0, 0.18 - env * 0.6);
            armL.rotation.set(env * 1.2, 0, -0.18 + env * 0.4);
            break;
          case 'slash': case 'smash': case 'thrust': case 'cast': case 'flick': case 'slap': case 'bonk': {
            const keys = TP_TRACKS[this.emote];
            _base[0] = armR.rotation.x; _base[1] = armR.rotation.y; _base[2] = armR.rotation.z;
            _base[3] = armL.rotation.x; _base[4] = armL.rotation.y; _base[5] = armL.rotation.z;
            _base[6] = _base[7] = _base[8] = _base[9] = _base[10] = _base[11] = 0;
            sampleTrack(keys, this.emoteT, _base, _out);
            // a shield arm keeps the shield mostly in front
            const lw = this.app.gear.s && this.emote !== 'bonk' ? 0.35 : 1;
            armR.rotation.set(_out[0], _out[1], _out[2]);
            armL.rotation.set(_base[3] + (_out[3] - _base[3]) * lw, _base[4] + (_out[4] - _base[4]) * lw, _base[5] + (_out[5] - _base[5]) * lw);
            body.rotation.y += _out[6]; body.rotation.x += _out[7];
            body.position.y += _out[8]; body.position.z = _out[9];
            wrist.rotation.set(_out[10], 0, _out[11]);
            // squash & stretch with the body's dip / rise (crouch in the hold, stretch through the strike)
            { const sy = 1 + Math.max(-0.12, Math.min(0.1, _out[8] * 2.2)), sxz = 1 / Math.sqrt(sy); body.scale.set(body.scale.x * sxz, body.scale.y * sy, body.scale.z * sxz); }
            // up on the toes / a little hop: the legs follow the body up and tuck
            if (_out[8] > 0.02) {
              const up = _out[8] - 0.02;
              legL.position.y += up * 0.9; legR.position.y += up * 0.9;
              legL.rotation.x -= up * 4; legR.rotation.x -= up * 3;
            }
            // lunge: the body forward splits the legs into a stance (one forward, one back)
            if (_out[9] < -0.03) { const l = (_out[9] + 0.03) * 6; legL.rotation.x += l; legR.rotation.x -= l; }
            // the moment of contact: a smash lands with a squash
            const ct = TP_CONTACT[this.emote];
            if (this.emote === 'smash' && this.emoteT >= ct && prevT < ct) { this.landT = 0; }
            break;
          }
          case 'swing': case 'hit': {
            // wind up then strike down-forward
            const a = k < 0.35 ? k / 0.35 : 1 - (k - 0.35) / 0.65;
            const strike = k < 0.35 ? -a * 1.0 : 2.0 * Math.sin(Math.min(1, (k - 0.35) / 0.3) * Math.PI / 2) * (1 - Math.max(0, (k - 0.65) / 0.35));
            armR.rotation.set(0.25 + (k < 0.35 ? 2.4 * a : 2.4 - strike * 0.2 - (k - 0.35) * 3.2), 0, 0.18 + 0.3 * env);
            body.rotation.y += (k < 0.35 ? 0.25 * a : -0.25 * (1 - k)) ;
            break;
          }
        }
      }
    }
    if (!this.emote || !(this.emote in TP_TRACKS)) body.position.z = 0;
    // bow draw: the body turns side-on, the bow paw points at the target with the bow upright (and drawn a size
    // bigger so it reads from behind), the free paw pulls the string back to the side of the face; the drawn string
    // and the nocked arrow are an overlay (bowdraw.ts) while the bow's own straight string is collapsed
    const dTarget = this.drawT;
    this.drawAmt += (dTarget - this.drawAmt) * Math.min(1, dt * (dTarget > this.drawAmt ? 10 : 22));
    const sb = bones[B.bowString];
    armL.position.copy(this.armLRest); armR.position.copy(this.armRRest); wrist.scale.setScalar(1); sb.scale.setScalar(1);
    const bow = this.model!.bow;
    if (this.relT >= 0) this.relT += dt;
    if (this.drawAmt > 0.002) {
      const k = this.drawAmt, e = k * k * (3 - 2 * k), pull = Math.min(1, dTarget);
      const tremble = pull > 0.95 ? Math.sin(tt * 47) * 0.012 : 0;
      body.rotation.y += 0.6 * e;
      body.rotation.x -= 0.04 * e;
      // the bow arm reaches out to the right (noodle arm): the bow clears the body's silhouette from behind
      armR.position.set(this.armRRest.x + 0.13 * e, this.armRRest.y + 0.05 * e, this.armRRest.z - 0.04 * e);
      armR.rotation.set(armR.rotation.x + (1.18 + tremble - armR.rotation.x) * e, armR.rotation.y + (0.81 - armR.rotation.y) * e, armR.rotation.z + (0.74 - armR.rotation.z) * e);
      wrist.rotation.set(wrist.rotation.x + (-1.83 - wrist.rotation.x) * e, 0, wrist.rotation.z + (-0.63 + BOW_CANT - wrist.rotation.z) * e);
      const bs = 1 + 0.65 * e;
      wrist.scale.setScalar(bs);
      if (bow) this.bowOverlay(bow, e, bs, pull, true);
      else armL.rotation.set(armL.rotation.x + (1.4 - 0.45 * pull - armL.rotation.x) * e, armL.rotation.y * (1 - e), armL.rotation.z + (0.75 + 0.1 * pull - armL.rotation.z) * e);
    } else if (bow && this.relT >= 0 && this.relT < 0.22) {
      // release: the bow kicks, the string twangs (a fast decaying wobble), the paw springs back
      const r = 1 - this.relT / 0.22, r2 = r * r;
      armR.rotation.x += 0.3 * r2; wrist.rotation.z += Math.sin(this.relT * 70) * 0.12 * r2;
      body.rotation.x += 0.05 * r2;
      this.bowOverlay(bow, 0, 1, Math.sin(this.relT * 95) * 0.12 * r2, false);
    } else this.bowKit?.hide();
    if (this.flash) this.flash.visible = this.flashA > 0.01 && this.mesh!.visible;
    // jump: squash → stretch on take-off, legs tucked and arms up in the air; landing: squash and settle
    if (this.jumpT >= 0) {
      this.jumpT += dt;
      const jt = this.jumpT;
      if (jt > JUMP_MAX) this.jumpT = -1;
      else {
        let sy: number;
        if (jt < 0.08) sy = 1 - 0.16 * Math.sin((jt / 0.08) * Math.PI / 2);                     // crouch
        else if (jt < 0.22) sy = 0.84 + 0.32 * Math.sin(((jt - 0.08) / 0.14) * Math.PI / 2);   // spring up
        else sy = 1.16 - 0.12 * Math.min(1, (jt - 0.22) / 0.25);                                 // relax to 1.04
        const sxz = 1 / Math.sqrt(sy);
        body.scale.set(body.scale.x * sxz, body.scale.y * sy, body.scale.z * sxz);
        const tuck = Math.min(1, Math.max(0, (jt - 0.08) / 0.12));
        legL.rotation.x = -0.75 * tuck; legR.rotation.x = -0.55 * tuck;
        legL.position.y = this.restY[B.legL] + 0.07 * tuck; legR.position.y = this.restY[B.legR] + 0.06 * tuck;
        if (!this.emote) {
          armL.rotation.set(-0.3 * tuck + (this.app.gear.s ? 0.35 : 0), 0, -0.22 - 0.9 * tuck);
          armR.rotation.set(-0.3 * tuck + (this.app.gear.w ? 0.25 : 0), 0, 0.22 + 0.9 * tuck);
        }
        if (this.model!.hasTail) bones[B.tail1].rotation.x += 0.25 * tuck;
        if (this.model!.hasCape) { bones[B.cape1].rotation.x -= 0.15 * tuck; bones[B.cape2].rotation.x -= 0.3 * tuck; }
      }
    }
    if (this.landT >= 0) {
      this.landT += dt;
      const lt = this.landT / LAND_LEN;
      if (lt >= 1) this.landT = -1;
      else {
        const sq = Math.sin(Math.min(1, lt * 2.5) * Math.PI / 2) * (1 - lt) * (1 - lt);   // fast in, eased out
        const sy = 1 - 0.2 * sq + 0.05 * Math.sin(lt * Math.PI * 2) * (1 - lt), sxz = 1 / Math.sqrt(sy);
        body.scale.set(body.scale.x * sxz, body.scale.y * sy, body.scale.z * sxz);
        body.position.y -= 0.03 * sq;
        if (!this.emote) { armL.rotation.z -= 0.35 * sq; armR.rotation.z += 0.35 * sq; }
      }
    }
    if (this.auraHalo) this.auraHalo.position.y = this.model!.headTop + 0.08 + Math.sin(tt * 2.8) * 0.02 + Math.abs(s) * 0.04 * w;
  }

  setAlpha(a: number): void {
    this.alpha = a;
    const lvl = alphaLevel(a);
    if (lvl === this.lvl) return;
    this.lvl = lvl;
    this.applyState();
  }

  setLod(l: 0 | 1 | 2): void {
    if (l === this.lod) return;
    this.lod = l;
    this.applyState();
  }

  setFirstPerson(on: boolean): void {
    if (on === this.fp) return;
    this.fp = on;
    this.applyState();
  }

  play(anim: string): void {
    // jump / land are body states, not arm emotes: they combine with a wave or a swing
    if (anim === 'jump') { this.jumpT = 0; this.landT = -1; return; }
    if (anim === 'land') { this.jumpT = -1; this.landT = 0; return; }
    if (anim === 'swing') {
      if (this.drawT > 0) return;              // drawing a bow: the click is the draw, not a swing
      anim = FAMILY_TRACK[weaponFamily(this.app.gear.w)];
    }
    this.emote = anim in EMOTE_LEN ? anim : 'wave';
    this.emoteT = 0; this.stopT = 0;
  }

  /* ---- combat hooks (src/combat) ---- */
  combatRig(): CombatRig | null {
    const m = this.model;
    if (!m || !this.bones.length) return null;
    const d = m.dims;
    return {
      bones: this.bones, rest: m.rig.rest, handL: m.rig.handL, handR: m.rig.handR,
      y0: d.y0, top: d.top, w: d.w, depth: d.depth, eyeY: d.eyeY, ex: d.ex, armY: d.armY,
      headTop: m.headTop, hasTail: m.hasTail, hasLegs: m.hasLegs,
    };
  }
  arrowTip(out: THREE.Vector3): boolean {
    const k = this.bowKit;
    if (!k || !k.mesh.visible || !k.hasArrow) return false;
    k.mesh.updateWorldMatrix(true, false);
    out.copy(k.tip).applyMatrix4(k.mesh.matrixWorld);
    return true;
  }
  bladeSeg(a: THREE.Vector3, b: THREE.Vector3, pivot?: THREE.Vector3): boolean {
    const bl = this.model?.blade;
    if (!bl || !this.bones.length || this.lod === 2) return false;
    const bone = this.bones[bl.bone], r = this.model!.rig.rest[bl.bone];
    bone.updateWorldMatrix(true, false);
    if (pivot) pivot.setFromMatrixPosition(this.bones[B.armR].matrixWorld);
    a.copy(bl.a).sub(r).applyMatrix4(bone.matrixWorld);
    b.copy(bl.b).sub(r).applyMatrix4(bone.matrixWorld);
    return true;
  }
  /** Place the drawn string + arrow overlay (body-bone space) and pull the free paw to the nock. */
  private bowOverlay(bow: NonNullable<ModelData['bow']>, e: number, bs: number, pull: number, arrow: boolean) {
    const bones = this.bones, armR = bones[B.armR], wrist = bones[B.wrist], armL = bones[B.armL], r = this.model!.rig.rest[B.wrist];
    armR.updateMatrix(); wrist.updateMatrix();
    _bm.multiplyMatrices(armR.matrix, wrist.matrix);
    _bt.copy(bow.top).sub(r).applyMatrix4(_bm); _bb.copy(bow.bottom).sub(r).applyMatrix4(_bm); _bg.copy(bow.grip).sub(r).applyMatrix4(_bm);
    _bc.addVectors(_bt, _bb).multiplyScalar(0.5);
    _bd.subVectors(_bg, _bc).normalize();                                   // aim: string → grip
    const back = arrow ? (0.03 + 0.24 * pull) * bs : -pull * 0.25 * bs;     // a released string wobbles about the centre
    _bn.copy(_bc).addScaledVector(_bd, -back);
    if (!this.bowKit) { this.bowKit = new BowDraw(); }
    if (this.bowKit.mesh.parent !== bones[B.body]) bones[B.body].add(this.bowKit.mesh);
    this.bowKit.set(_bt, _bb, _bn, _bg, bs, arrow);
    this.bowKit.mesh.visible = this.mesh!.visible && !this.fp && this.lod < 2;
    bones[B.bowString].scale.setScalar(1e-4);
    if (!arrow) return;
    // the free paw on the nock: aim the arm at it, then slide the (noodle) arm out of the shoulder the rest of the way
    const hl = this.model!.rig.handL;
    _bv.subVectors(_bn, this.armLRest); const L = _bv.length(); _bv.divideScalar(L || 1);
    _bq.setFromUnitVectors(_bh.copy(hl).normalize(), _bv);
    armL.quaternion.slerp(_bq, e);
    const reach = hl.length(), shift = Math.min(0.45, Math.max(0, L - reach)) * e;
    armL.position.addScaledVector(_bv, shift);
  }
  setDraw(k: number): void {
    if (k <= 0 && this.drawT > 0.15) this.relT = 0;
    this.drawT = Math.max(0, Math.min(1, k)); if (k > 0 && this.emote && this.emote in TP_TRACKS) this.emote = ''; }
  hitStop(sec: number): void { this.stopT = Math.max(this.stopT, sec); }
  setFlash(a: number): void {
    this.flashA = a;
    if (a > 0.01 && !this.flash && this.mesh && this.skel && this.model) {
      // an additive white copy of the body sharing geometry + skeleton; created on the first hit, one material each
      const mat = (flashMatProto ||= new THREE.MeshBasicMaterial({ color: '#fff6dc', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })).clone();
      const fl = new THREE.SkinnedMesh(this.model.geo, mat);
      fl.bind(this.skel, new THREE.Matrix4());
      fl.boundingSphere = this.mesh.boundingSphere; fl.frustumCulled = false; fl.renderOrder = 2; fl.name = 'avatar-flash';
      this.flash = fl; this.root.add(fl);
    }
    if (this.flash) {
      (this.flash.material as THREE.MeshBasicMaterial).opacity = Math.min(1, a);
      this.flash.visible = a > 0.01 && !!this.mesh?.visible;
      if (this.flash.geometry !== this.mesh!.geometry) this.flash.geometry = this.mesh!.geometry;
    }
  }
  /* ---- social hooks (src/features/mood, bench, cheer) ---- */
  setMood(mood: Mood | null, sec = 2): void {
    const m = mood && mood in MOOD_FACE ? mood : null;
    this.moodT = m ? Math.max(0.1, sec) : 0;
    if (m === this.mood) return;
    this.mood = m;
    this.applyState();
  }
  setSit(on: boolean): void { this.sitOn = on; }
  get sitDrop(): number { return this.model ? this.model.dims.y0 + 0.02 : 0.09; }
  setDizzy(on: boolean): void {
    if (on === this.dizzy) return;
    this.dizzy = on;
    this.applyState();
  }

  dispose(): void {
    this.shadow.release();
    if (this.bowKit) { this.bowKit.dispose(); this.bowKit = null; }
    if (this.flash) { (this.flash.material as THREE.Material).dispose(); this.flash = null; }
    if (this.model) releaseModel(this.model);
    this.model = null;
    this.skel?.dispose();
    this.root.clear();
    this.root.removeFromParent();
  }
}

export function createAvatar(app: Appearance): Avatar { return new AvatarImpl(app); }
