/**
 * Set pieces per stage (vignettes): the campfire camp at the city gate, the crossroads with signposts, the rune door,
 * traps, the shop stall, events, the dungeon doors, the islands of the lair, the loot pedestal. Each set owns its
 * meshes and labels (disposed with it) and animates from the SceneState it gets every frame. Small: ≤ ~25 draw calls.
 */
import * as THREE from 'three';
import type { SceneState } from './adapter';
import { plural, revealOf } from './adapter';
import { ingName, HW_ING } from '../quest/model';
import type { ExpMats } from './mats';
import type { Fx } from '../combat/fx';
import type { Decals } from './foes';
import { Label } from './text';
import { propGeo, hullGeo, GB, T } from './art';
import { blobShadowMesh } from './biome-art';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  talkingStoneGeo, stoneMouthGeo, critterGeo, burrowGeo, boardGeo, trinketGeo, letterBlockGeo, orbGeo, cottageGeo, doorGeo, lanternGeo, candyBowlGeo,
  sheetGhostGeo, graveGeo, lanternPoleGeo, fortuneTentGeo, crystalBallGeo, tellerGeo, tarotGeo, cauldronGeo, brewGeo, ladleGeo, witchGeo, bitGeo,
  cryptStageGeo, skelBodyGeo, skelArmGeo, goblinGeo, goblinHandGeo, fairStallGeo, shellCupGeo, ballGeo, bigCoinGeo, playCardGeo, shelfGeo, curtainGeo,
  sackGeo, coinBowlGeo, coinGeo,
} from './art-events';
const propCliff = () => propGeo('cliff', 2);
/** Plain primitive with a wood vertex colour (the cel material is vertex-coloured: no colour = black). */
const wood = (g: THREE.BufferGeometry, c = '#8a6a42') => new GB().add(g, c).build();
import {
  campfireGeo, flameGeo, signpostGeo, flagGeo, gateGeo, bannerGeo, tentGeo, chestGeo, lidGeo, runeDoorGeo, doorSlabGeo, platformGeo,
  puzzleTabletGeo, runeStoneGeo, cupGeo, scalesPostGeo, scalesBeamGeo,
  stallGeo, wellGeo, altarGeo, tableGeo, d20Geo, cartGeo, ropeGeo, logGeo, spikeSlabGeo, pedestalGeo, itemGeo, markerGeo, bossGeo, RARITY_COL,
} from './art';

export interface SetEnv {
  mats: ExpMats; fx: Fx; decals: Decals;
  /** whole seconds left of a server window as on the stream */
  secLeft(until: number): number;
  /** add a spoken float text */
  float(text: string, color: string, x: number, y: number, z: number, size?: number): void;
  /** quality 0..3 (q0: no outlines / lights on the event sets, fewer particles); default 2 */
  q?: number;
}
export interface SetPiece {
  readonly root: THREE.Group;
  /** where the party stands (centre + radius) and where new cats come from */
  party: { cx: number; cz: number; r: number; face?: number; enter?: { x: number; z: number }; arc?: number };
  /** camera focus; lock = keep `d` whatever the party size (the set framed its key object above the HUD strip) */
  focus: { x: number; y: number; z: number; d: number; pitch: number; yaw: number; lock?: boolean };
  /** fire light / sit pose etc. */
  pose?: 'sit' | 'cheer' | 'idle' | 'block';
  /** spots override for the party (islands, platforms) */
  slots?(n: number, myIndex: number): { x: number; z: number }[] | null;
  update(dt: number, t: number, s: SceneState): void;
  /** set by the scene: true at ~4 Hz — the frame to redraw labels / recompute derived data (no string work otherwise) */
  relabel: boolean;
  dispose(): void;
}

class Base {
  readonly root = new THREE.Group();
  protected own: { dispose(): void }[] = [];
  protected labels: Label[] = [];
  relabel = true;
  constructor(protected env: SetEnv, name: string) { this.root.name = 'exp-set-' + name; }
  protected mesh(g: THREE.BufferGeometry, x = 0, y = 0, z = 0, ry = 0, s = 1, mat?: THREE.Material): THREE.Mesh {
    const m = new THREE.Mesh(g, mat || this.env.mats.tint); m.position.set(x, y, z); m.rotation.y = ry; m.scale.setScalar(s); this.root.add(m); return m;
  }
  protected outlined(g: THREE.BufferGeometry, x = 0, y = 0, z = 0, ry = 0, s = 1): THREE.Mesh {
    const m = this.mesh(g, x, y, z, ry, s);
    const o = new THREE.Mesh(hullGeo(g), this.env.mats.outline); m.add(o); return m;
  }
  protected inst(g: THREE.BufferGeometry, n: number, mat?: THREE.Material): THREE.InstancedMesh {
    const im = new THREE.InstancedMesh(g, mat || this.env.mats.tint, Math.max(1, n));
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3).fill(1), 3);
    im.count = n; im.frustumCulled = false; this.root.add(im); this.own.push(im); return im;
  }
  protected label(style: ConstructorParameters<typeof Label>[0], w: number, h: number, height: number, plane = false): Label {
    const l = new Label(style, w, h, height, plane); this.labels.push(l); this.root.add(l.obj); return l;
  }
  protected light(color: string, x: number, y: number, z: number, i: number, d = 14): THREE.PointLight {
    const l = new THREE.PointLight(color, i, d, 1.6); l.position.set(x, y, z); this.root.add(l); return l;
  }
  dispose(): void {
    for (const l of this.labels) l.dispose();
    for (const o of this.own) o.dispose();
    this.labels = []; this.own = [];
    this.root.removeFromParent();
  }
}

/* ------------------------------------------------------------------ camp (gather / rest / town) */

class Camp extends Base implements SetPiece {
  party = { cx: 0, cz: 0, r: 2.9, enter: { x: 8, z: 0 } as { x: number; z: number } | undefined };
  focus = { x: 0.5, y: 1.1, z: 0, d: 13, pitch: 0.36, yaw: -0.32 };
  pose: SetPiece['pose'];
  private flames: THREE.Mesh;
  private fire: THREE.PointLight;
  private banner: Label | null = null;
  private fxT = 0;
  constructor(env: SetEnv, private mode: 'gather' | 'rest' | 'town', title: string) {
    super(env, mode);
    this.pose = mode === 'rest' ? 'sit' : 'idle';
    this.outlined(campfireGeo());
    this.flames = this.mesh(flameGeo(), 0, 0.05, 0, 0, 1, env.mats.glow);
    this.fire = this.light('#ff9a4a', 0, 1.4, 0, mode === 'rest' ? 40 : 14, 16);
    if (mode !== 'rest') {
      this.outlined(gateGeo(), 9.5, 0, 0, 0, 1);
      const pole = this.outlined(bannerGeo(), -2.6, 0, -2.4, 0.5);
      this.banner = this.label('banner', 512, 384, 1.25, true);
      this.banner.obj.position.set(-2.6 + Math.sin(0.5) * 0, 2.55, -2.4); this.banner.obj.rotation.y = 0.5; this.banner.obj.scale.set(1.25 * 512 / 384, 1.25, 1);
      void pole;
      this.outlined(tentGeo(0), -6.5, 0, -3.5, 0.6);
      this.outlined(tentGeo(1), -3.8, 0, -6.2, 0.2);
      if (mode === 'town') { this.banner.set('ГОРОД', title || 'Город'); this.party.enter = undefined; }
    } else {
      this.party.enter = undefined;
      this.outlined(tentGeo(2), -5, 0, -3.8, 0.7);
      this.outlined(tentGeo(0), 4.2, 0, -4.6, -0.5);
      this.focus = { x: 0, y: 0.9, z: 0, d: 10.5, pitch: 0.42, yaw: 0.2 };
    }
  }
  update(dt: number, t: number, s: SceneState): void {
    const f = 1 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.06;
    this.flames.scale.set(1 + Math.sin(t * 9) * 0.05, f, 1 + Math.cos(t * 8) * 0.05);
    this.fire.intensity = (this.mode === 'rest' ? 40 : 14) * (0.85 + 0.15 * Math.sin(t * 17) * Math.sin(t * 5));
    this.fxT += dt;
    if (this.fxT > 0.07) {
      this.fxT = 0;
      const fx = this.env.fx, r = fx.rnd();
      fx.emit(4, (r - 0.5) * 0.4, 0.6, (fx.rnd() - 0.5) * 0.4, (fx.rnd() - 0.5) * 0.4, 1.4 + fx.rnd(), (fx.rnd() - 0.5) * 0.4, 0.9 + fx.rnd() * 0.6, 0.07, 0.02, 1, 0.65, 0.25, 1, 0.3, 0.6, true);
      if (r < 0.3) fx.emit(3, 0, 1.3, 0, 0.1, 0.6, 0, 2.2, 0.25, 0.9, 0.4, 0.38, 0.42, 0.25, 0.05, 0.4);
    }
    this.env.decals.add(0, 0.01, 0, 3.4, '#ff9a4a', 0.35, 1, 0);
    if (this.relabel && this.banner && this.mode === 'gather') {
      const sec = this.env.secLeft(s.until);
      if (s.empty) this.banner.set('Никто не присоединился', 'отряд возвращается в город');   // 28.10 empty party (v.nb)
      else this.banner.set(s.hw ? '🎃 СБОР У ПОРТАЛА' : 'СБОР ОТРЯДА', `${s.n} ${plural(s.n, 'котик', 'котика', 'котиков')}${s.until ? ' · ' + mmss(sec) : ''}`);
    }
  }
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/* ------------------------------------------------------------------ crossroads (vote) */

class Crossroads extends Base implements SetPiece {
  party = { cx: 0, cz: -0.4, r: 1.5 };
  focus = { x: 0, y: 1.4, z: -2.2, d: 12.5, pitch: 0.34, yaw: 0 };
  private posts: { root: THREE.Object3D; label: Label; top: Label; flag: THREE.InstancedMesh; n: number; x: number; z: number; dir: number; votes: number }[] = [];
  private _m = new THREE.Matrix4();
  private key = '';
  private glowT = 0;
  constructor(env: SetEnv, private s0: SceneState) { super(env, 'vote'); this.build(s0); }
  private build(s: SceneState) {
    const opts = s.vote?.opts || [];
    this.key = opts.map((o) => o.n + o.label).join('|');
    for (const p of this.posts) p.root.removeFromParent();
    this.posts = [];
    const fwd = opts.filter((o) => !o.back), back = opts.filter((o) => o.back);
    const all = [...fwd, ...back];
    const N = all.length;
    all.forEach((o, i) => {
      const x = (i - (N - 1) / 2) * 4.3, z = -4.4 + (o.back ? 0 : Math.abs(i - (N - 1) / 2) * 0.6);
      const dir = o.back ? Math.PI : x < -0.5 ? 0.5 : x > 0.5 ? -0.5 : 0;   // arrow tilt (y-rotation) toward the road
      const root = new THREE.Group(); root.position.set(x, 0, z); this.root.add(root);
      const post = new THREE.Mesh(signpostGeo(), this.env.mats.tint);
      post.add(new THREE.Mesh(hullGeo(signpostGeo()), this.env.mats.outline));
      post.position.x = o.back ? 0.55 : x < -0.5 ? 0 : -0.0; post.rotation.y = o.back || x < -0.5 ? Math.PI : 0;
      if (o.back || x < -0.5) post.position.x = 0;
      root.add(post);
      root.scale.setScalar(1.6);
      const label = this.label('sign', 512, 160, 0.5, true);
      label.obj.scale.set(1.45, 1.45 * 160 / 512, 1);
      label.obj.position.set((o.back || x < -0.5) ? -0.55 : 0.55, 2.1, 0.06);
      root.add(label.obj);
      const top = this.label('loot', 512, 192, 1.45);
      top.obj.position.set(x, 5.5, z);
      const flag = this.inst(flagGeo(), 1);
      flag.instanceColor!.setXYZ(0, ...COLS[i % COLS.length]); flag.instanceColor!.needsUpdate = true;
      flag.position.set(x + 0.0, 0, z - 0.1);
      const pole = new THREE.Mesh(wood(new THREE.CylinderGeometry(0.035, 0.035, 3.4, 5)), this.env.mats.tint);
      this.own.push(pole.geometry);
      pole.scale.set(1, 1.3, 1); pole.position.set(x - 1.3, 2.2, z + 0.25); this.root.add(pole);
      // road toward the option
      this.env.decals;   // (roads drawn as decals each frame)
      void dir;
      this.posts.push({ root, label, top, flag, n: o.n, x, z, dir, votes: -1 });
    });
  }
  private hs: number[] = [];
  private announced = false;
  private wins: boolean[] = [];
  update(dt: number, t: number, s: SceneState): void {
    const V = s.vote;
    if (!V) return;
    if (this.relabel) {
      if (V.opts.map((o) => o.n + o.label).join('|') !== this.key) this.build(s);
      const tot = V.opts.reduce((a, o) => a + o.votes, 0) || 1;
      this.posts.forEach((p, i) => {
        const o = V.opts.find((x) => x.n === p.n);
        if (!o) return;
        const win = !!V.done && V.win === o.n, my = V.my === o.n;
        p.label.set(`${o.n} · ${short(o.label, 14)}`, '', '');
        p.top.set(`${o.n} · ${short(o.label, 18)}`, `${o.votes} ${plural(o.votes, 'голос', 'голоса', 'голосов')}${my ? ' · твой голос' : ''}${win ? ' · идём!' : ''}`, win ? '#ffd34d' : my ? '#9fe39a' : '#ffe9a8');
        this.hs[i] = 0.9 + (o.votes / tot) * 3.1; this.wins[i] = win;
        if (win && !this.announced) { this.announced = true; this.env.float(`Идём: ${o.label}!`, '#ffe27a', p.x * 0.5, 3.4, p.z + 2, 0.9); }
      });
    }
    const m = this._m;
    for (let i = 0; i < this.posts.length; i++) {
      const p = this.posts[i], win = !!this.wins[i], h = this.hs[i] ?? 0.8;
      const wave = Math.sin(t * 5 + p.x) * 0.08;
      m.makeRotationY(Math.PI + wave).scale(_s13).setPosition(0, h, 0); p.flag.setMatrixAt(0, m); p.flag.instanceMatrix.needsUpdate = true;
      p.flag.position.set(p.x - 1.3, 0, p.z + 0.25);
      const sc = win ? 1.12 + Math.sin(t * 6) * 0.03 : 1;
      const cur = p.root.scale.x / 1.6;
      p.root.scale.setScalar(1.6 * (cur + (sc - cur) * Math.min(1, dt * 6)));
      const ls = win ? 1.25 + Math.sin(t * 5) * 0.04 : 1;
      p.top.obj.scale.set(1.45 * (512 / 192) * ls, 1.45 * ls, 1);
      for (let k = 1; k <= 4; k++) this.env.decals.add(p.x * (0.25 + k * 0.2), 0.01, p.z * (0.25 + k * 0.2) + 1.0, 0.8, win ? '#ffe27a' : '#e8d8b0', win ? 0.45 : 0.16, 1, win ? 5 : 0);
      if (win) {
        this.env.decals.add(p.x, 0.02, p.z, 1.6, '#ffd34d', 0.9, 0.3, 6);
        this.glowT += dt;
        if (this.glowT > 0.08) { this.glowT = 0; this.env.fx.emit(0, p.x + (this.env.fx.rnd() - 0.5) * 1.5, 2.2 + this.env.fx.rnd(), p.z, 0, 0.6, 0, 0.9, 0.12, 0.02, 1, 0.9, 0.45, 1, 0, 1, true); }
      }
    }
    this.env.decals.add(0, 0.01, 0.6, 3.0, '#e8d8b0', 0.18, 1, 0);
  }
  /** where the party walks after the vote: toward the winning post */
  winner(s: SceneState): { x: number; z: number } | null {
    const V = s.vote; if (!V || !V.done) return null;
    const p = this.posts.find((x) => x.n === V.win); return p ? { x: p.x * 0.6, z: p.z + 2.4 } : null;
  }
}
const _s13 = new THREE.Vector3(1.5, 1.5, 1.5), _s16 = new THREE.Vector3(1.7, 1.7, 1.7);
const COLS: [number, number, number][] = [[1, 0.35, 0.4], [0.35, 0.65, 1], [0.45, 0.85, 0.4], [1, 0.8, 0.3], [0.8, 0.5, 1], [1, 0.6, 0.3]];

/* ------------------------------------------------------------------ rune door (treasure / code trap) */

class RuneDoor extends Base implements SetPiece {
  party = { cx: -1.8, cz: 0.8, r: 2.4 };
  focus = { x: 1.6, y: 1.8, z: 0, d: 12, pitch: 0.28, yaw: -0.35 };
  private slab: THREE.Mesh;
  private lid: THREE.Mesh;
  private runes: Label;
  private openK = 0;
  private burstT = 0;
  constructor(env: SetEnv, private s0: SceneState) {
    super(env, 'runedoor');
    this.outlined(runeDoorGeo(), 6, 0, 0, 0);
    this.slab = this.outlined(doorSlabGeo(), 6, 0, 0, 0);
    this.runes = this.label('word', 512, 192, 1.4, true);
    this.runes.obj.rotation.y = -Math.PI / 2; this.runes.obj.position.set(5.82, 2.9, 0);
    this.slab.add(this.runes.obj); this.runes.obj.position.set(-0.18, 2.9, 0);
    const chest = this.outlined(chestGeo(), 3.2, 0, 1.2, -Math.PI / 2 + 0.3, 1.1);
    this.lid = new THREE.Mesh(lidGeo(), env.mats.tint); this.lid.add(new THREE.Mesh(hullGeo(lidGeo()), env.mats.outline));
    this.lid.position.set(0, 0.56, 0.33); chest.add(this.lid);
    // the hillside the vault is cut into
    for (let i = 0; i < 7; i++) { const a = -1.2 + i * 0.4; this.mesh(propCliff(), 8.5 + Math.cos(a) * 1.5, -0.8, Math.sin(a) * 6.5, i * 1.3, 1.0 + (i % 2) * 0.3); }
    this.light('#7af0ff', 5, 3, 0, 10, 10);
  }
  update(dt: number, t: number, s: SceneState): void {
    const T = s.trap;
    const win = !!T && T.win === true;
    this.openK = Math.min(1, Math.max(0, this.openK + (win ? dt * 0.6 : -dt)));
    this.slab.position.y = this.openK * 3.8;
    this.lid.rotation.x = this.openK * 1.9;   // swings up and back over the hinge
    const digits = !this.relabel ? '' : T && T.st === 'act' ? '? '.repeat(T.len).trim() : win ? '✓' : '? ? ?';
    if (this.relabel) this.runes.set(digits, T && T.st === 'act' ? `код из ${T.len} цифр 1–${T.max}` : T?.text || '', '#9ff4ff');
    this.env.decals.add(6, 0.01, 0, 3, '#7af0ff', 0.4 + 0.2 * Math.sin(t * 3), 0.5, 0);
    if (win) {
      this.burstT += dt;
      if (this.burstT > 0.12) { this.burstT = 0; const fx = this.env.fx; fx.emit(1, 3.2, 0.9, 1.2, (fx.rnd() - 0.5) * 2, 3 + fx.rnd() * 2, (fx.rnd() - 0.5) * 2, 1.2, 0.18, 0.1, 1, 0.82, 0.25, 1, -6, 0.5, false, fx.rnd() * 6, 4); }
    }
  }
}

/* ------------------------------------------------------------------ traps */

class Trap extends Base implements SetPiece {
  party = { cx: -0.5, cz: 0.5, r: 1.8 };
  focus = { x: 1.5, y: 1.6, z: 0, d: 12.5, pitch: 0.32, yaw: -0.25 };
  pose: SetPiece['pose'];
  private log: THREE.Object3D | null = null;
  private slab: THREE.Mesh | null = null;
  private sign: Label;
  private fxT = 0;
  constructor(env: SetEnv, private type: string, s: SceneState) {
    super(env, 'trap-' + type);
    this.sign = this.label('warn', 512, 160, 0.9);
    this.sign.obj.position.set(0, 3.6, 0);
    if (type === 'ceiling') {
      this.slab = this.outlined(spikeSlabGeo(), 0, 7, 0, 0);
      this.pose = 'block';
      for (const x of [-4.4, 4.4]) for (const z of [-3.4, 3.4]) { const p = this.mesh(wood(new THREE.CylinderGeometry(0.25, 0.3, 9, 8)), x, 4.5, z); this.own.push(p.geometry); }
    } else if (type === 'ropes' || type === 'bait' || type === 'greed' || type === 'share' || type === 'plates') {
      if (type === 'ropes') {
        const beam = this.mesh(wood(new THREE.BoxGeometry(0.3, 0.3, 6)), 4, 4.2, 0); this.own.push(beam.geometry);
        const n = Math.max(1, Math.min(6, s.trap?.n || 3));
        const ropes = this.inst(ropeGeo(), n);
        const m = new THREE.Matrix4();
        for (let i = 0; i < n; i++) {
          const z = (i - (n - 1) / 2) * 1.0;
          m.makeScale(1, 2.6, 1).setPosition(4, 1.6, z); ropes.setMatrixAt(i, m);
          const l = this.label('num', 128, 128, 0.42); l.obj.position.set(4, 1.3, z); l.set(String(i + 1));
        }
        for (const z of [-3, 3]) { const p = this.mesh(wood(new THREE.CylinderGeometry(0.15, 0.15, 4.4, 6)), 4, 2.2, z); this.own.push(p.geometry); }
      } else if (type === 'plates') {
        const pl = this.inst(platformGeo(), 9);
        const m = new THREE.Matrix4();
        for (let i = 0; i < 9; i++) {
          const x = 3 + (i % 3) * 1.3, z = (Math.floor(i / 3) - 1) * 1.3;
          m.makeScale(0.55, 0.4, 0.55).setPosition(x, 0.1, z); pl.setMatrixAt(i, m);
          const l = this.label('num', 128, 128, 0.36); l.obj.position.set(x, 0.55, z); l.set(String(i + 1));
        }
      } else {
        this.outlined(pedestalGeo(), 3.5, 0, 0, 0);
        this.outlined(chestGeo(), 3.5, 1.0, 0, -Math.PI / 2, 0.8);
      }
    } else if (type !== 'gas') {
      // react / unknown: a spiked log swinging over the road
      const piv = new THREE.Group(); piv.position.set(2.6, 5.2, 0); this.root.add(piv);
      const log = new THREE.Mesh(logGeo(), env.mats.tint); log.add(new THREE.Mesh(hullGeo(logGeo()), env.mats.outline));
      log.rotation.y = Math.PI / 2; log.position.y = -3.6; piv.add(log);
      for (const z of [-0.8, 0.8]) { const r = new THREE.Mesh(ropeGeo(), env.mats.tint); r.scale.set(1, 3.6, 1); r.position.set(0, -3.6, z); piv.add(r); }
      for (const z of [-3, 3]) { const p = this.mesh(wood(new THREE.CylinderGeometry(0.18, 0.2, 5.6, 7)), 2.6, 2.8, z); this.own.push(p.geometry); }
      const beam = this.mesh(wood(new THREE.BoxGeometry(0.3, 0.3, 6.4)), 2.6, 5.4, 0); this.own.push(beam.geometry);
      this.log = piv;
    }
  }
  update(dt: number, t: number, s: SceneState): void {
    const T = s.trap;
    const act = T?.st === 'act';
    if (this.log) this.log.rotation.x = Math.sin(t * (act ? 2.6 : 1.2)) * (act ? 0.9 : 0.35);
    if (this.slab) {
      const left = T && act && s.until ? this.env.secLeft(s.until) : 9;
      const target = act ? 2.6 + Math.min(4.4, left * 0.4) : T?.done ? 7 : 6.5;
      this.slab.position.y += (target - this.slab.position.y) * Math.min(1, dt * 2);
    }
    const gas = this.type === 'gas' || T?.gas;
    if (gas) {
      this.fxT += dt;
      if (this.fxT > 0.05) { this.fxT = 0; const fx = this.env.fx; const a = fx.rnd() * 6.28, r = 1 + fx.rnd() * 4; fx.emit(3, Math.cos(a) * r, 0.2, Math.sin(a) * r, 0, 0.25 + fx.rnd() * 0.3, 0, 3 + fx.rnd() * 2, 0.4, 1.6, 0.55, 0.9, 0.35, 0.45, 0.02, 0.2, false, fx.rnd() * 6, 0.3); }
      for (let i = 0; i < 4; i++) this.env.decals.add(Math.cos(i * 1.57 + 0.4) * 3.5, 0.01, Math.sin(i * 1.57 + 0.4) * 3.5, 0.8, '#8ae05a', 0.7, 1, 4);
    }
    if (!this.relabel) return;
    const word = T && act && T.type === 'react' && T.word && !T.acted;
    if (gas && act && !T?.acted) this.sign.set('МОЛЧИ!', 'газ: кто пишет — вдыхает');
    else if (word) this.sign.set(T!.word, 'успей написать');
    else this.sign.set(T?.done ? (T.win === false ? 'Ой!' : 'Прошли!') : T?.name || '', T?.done ? T.text : T?.st === 'intro' ? 'приготовься…' : '');
    this.sign.obj.visible = !!T;
    if (this.sign.style === 'warn') { /* */ }
  }
}

/* ------------------------------------------------------------------ shop */

class Shop extends Base implements SetPiece {
  party = { cx: 0, cz: 3.6, r: 1.6 };
  focus = { x: 0, y: 1.7, z: 0.2, d: 8.6, pitch: 0.2, yaw: 0 };
  constructor(env: SetEnv, s: SceneState) {
    super(env, 'shop');
    this.outlined(stallGeo(), 0, 0, -1.6, Math.PI);
    const items = s.shop?.items || [];
    items.slice(0, 9).forEach((it, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const x = (col - 1) * 1.45, y = 0.72 + (2 - row) * 0.75 - (items.length <= 3 ? 0.75 : 0), z = -1.0;
      const im = this.inst(itemGeo(it.slot), 1);
      const c = new THREE.Color(RARITY_COL[it.rarity] || RARITY_COL.common);
      im.setColorAt(0, c); im.instanceColor!.needsUpdate = true;
      im.setMatrixAt(0, new THREE.Matrix4().makeScale(0.9, 0.9, 0.9).setPosition(x, y, z)); im.instanceMatrix.needsUpdate = true;
      const l = this.label('loot', 352, 128, 0.46); l.obj.position.set(x, y + 0.62, z + 0.35);
      l.set(`${it.n} · ${short(it.name, 14)}`, `${it.price} мон.`, RARITY_COL[it.rarity] || '');
    });
    this.light('#ffe0a8', 0, 3, 1, 10, 9);
  }
  update(): void { this.env.decals.add(0, 0.01, 1, 3.5, '#ffe0a8', 0.25, 1, 0); }
}
const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/* ------------------------------------------------------------------ events */

class Event extends Base implements SetPiece {
  party = { cx: -1, cz: 1.2, r: 1.8 };
  focus = { x: 1.2, y: 1.4, z: 0, d: 11, pitch: 0.3, yaw: -0.2 };
  private dice: THREE.Mesh | null = null;
  private sign: Label;
  constructor(env: SetEnv, private look: string, s: SceneState) {
    super(env, 'event-' + look);
    if (look === 'dice') { this.outlined(tableGeo(), 3, 0, 0); this.dice = this.outlined(d20Geo(), 3, 1.15, 0); }
    else if (look === 'well') this.outlined(wellGeo(), 3, 0, 0);
    else if (look === 'priest') { this.outlined(altarGeo(), 3.4, 0, 0, Math.PI / 2); this.light('#ffe8a8', 3, 2, 0, 10, 8); }
    else this.outlined(cartGeo(), 3.4, 0, -0.5, 0.3);
    this.sign = this.label('loot', 512, 160, 0.55);
    this.sign.obj.position.set(3, 3.1, 0);
    void s;
  }
  update(dt: number, t: number, s: SceneState): void {
    if (this.dice) { this.dice.rotation.x += dt * 3; this.dice.rotation.y += dt * 2.2; this.dice.position.y = 1.2 + Math.abs(Math.sin(t * 3)) * 0.35; }
    const E = s.event;
    if (this.relabel) this.sign.set(E?.name || '', E?.text ? short(E.text, 40) : '');
    if (this.look === 'well' && Math.sin(t * 2) > 0.995) this.env.fx.emit(1, 3, 1.4, 0, 0, 2, 0, 0.8, 0.14, 0.08, 1, 0.85, 0.3, 1, -6, 0, false, 0, 6);
  }
}

/* ------------------------------------------------------------------ map puzzle (site 28.10, kind `puzzle`) */

/**
 * The party before a stone tablet («Головоломка»); by puzzle kind: rune stones in a row (runes), three cups on the
 * plinth (cups — the poisoned one tips over after the result), the balance scales (scales — tilt from the sums).
 * The tablet's label shows the name and what to type; the answer is never drawn (it is on the stream).
 */
class Puzzle extends Base implements SetPiece {
  party = { cx: -1.4, cz: 1.0, r: 2.0 };
  focus = { x: 1.4, y: 1.5, z: 0, d: 11.5, pitch: 0.28, yaw: -0.25 };
  private sign: Label;
  private cups: THREE.Mesh[] = [];
  private beam: THREE.Mesh | null = null;
  private glow = 0;
  constructor(env: SetEnv, private kind: string) {
    super(env, 'puzzle-' + kind);
    this.outlined(puzzleTabletGeo(), 3.4, 0, -0.4, -0.25);
    if (kind === 'cups') for (let i = 0; i < 3; i++) this.cups.push(this.outlined(cupGeo(), 1.8 + i * 0.7, 0, 0.9 - i * 0.15, 0));
    else if (kind === 'scales') { this.outlined(scalesPostGeo(), 1.0, 0, 0.9); this.beam = this.outlined(scalesBeamGeo(), 1.0, 2.15, 0.9); }
    else for (let i = 0; i < 4; i++) this.outlined(runeStoneGeo(), 1.2 + i * 0.75, 0, 1.0 - (i % 2) * 0.25, (i - 1.5) * 0.25);
    this.sign = this.label('loot', 512, 160, 0.6);
    this.sign.obj.position.set(3.4, 3.7, -0.4);
    this.light('#7af0ff', 3.4, 2.2, 0.6, 6, 8);
  }
  update(dt: number, t: number, s: SceneState): void {
    const P = s.puzzle;
    if (this.relabel) this.sign.set(P ? `${P.icon} ${P.name}` : 'Головоломка', P ? short(P.line, 44) : '');
    if (this.beam && P) {
      // the heavier plate goes down (≤ 0.35 rad)
      const d = Math.max(-5, Math.min(5, (P.sums[1] || 0) - (P.sums[0] || 0)));
      const a = -d * 0.07; this.beam.rotation.z += (a - this.beam.rotation.z) * Math.min(1, dt * 3);
    }
    if (this.cups.length && P) for (let i = 0; i < this.cups.length; i++) {
      const pois = P.st === 'done' && P.ans === String(i + 1), c = this.cups[i];
      c.rotation.z += ((pois ? 1.3 : 0) - c.rotation.z) * Math.min(1, dt * 4);
    }
    this.glow = P && P.st === 'show' ? 0.6 + 0.3 * Math.sin(t * 4) : 0.35;
    this.env.decals.add(3.4, 0.01, 0.2, 2.2, '#7af0ff', this.glow, 0.5, 0);
  }
}

/* ------------------------------------------------------------------ dungeon doors */

class Dungeon extends Base implements SetPiece {
  party = { cx: 0, cz: 2.2, r: 1.6 };
  focus = { x: 0, y: 1.8, z: -1, d: 12, pitch: 0.3, yaw: 0 };
  private doors: { n: number; label: Label; x: number; z: number }[] = [];
  private fxT = 0;
  constructor(env: SetEnv, s: SceneState) {
    super(env, 'dungeon');
    const opts = s.dungeon?.opts.length ? s.dungeon.opts : [{ n: 1, label: 'Дальше', icon: '', votes: 0, back: false }];
    const N = opts.length;
    opts.forEach((o, i) => {
      const a = (i - (N - 1) / 2) * 0.55, x = Math.sin(a) * 6.5, z = -Math.cos(a) * 6.5 + 2;
      const d = this.outlined(runeDoorGeo(), x, 0, z, Math.PI / 2 - a, 0.7);
      void d;
      const l = this.label('loot', 512, 160, 0.6); l.obj.position.set(x, 4.2, z);
      this.doors.push({ n: o.n, label: l, x, z });
    });
    this.light('#ffb06a', 0, 3, 0, 14, 14);
  }
  update(dt: number, t: number, s: SceneState): void {
    const D = s.dungeon;
    for (const d of this.doors) {
      const o = this.relabel ? D?.opts.find((x) => x.n === d.n) : undefined;
      if (this.relabel) d.label.set(`${d.n} · ${short(o?.label || '?', 16)}`, o ? `${o.votes} ${plural(o.votes, 'голос', 'голоса', 'голосов')}` : '');
      this.env.decals.add(d.x * 0.85, 0.01, d.z * 0.85 + 0.3, 1.3, '#ffd37a', 0.25, 1, 0);
    }
    if (D?.esc) {
      this.fxT += dt;
      if (this.fxT > 0.06) { this.fxT = 0; const fx = this.env.fx; fx.emit(3, (fx.rnd() - 0.5) * 12, 6, (fx.rnd() - 0.5) * 8, 0, -4, 0, 1.5, 0.3, 0.6, 0.5, 0.45, 0.42, 0.8, -6, 0.2); }
    }
  }
}

/* ------------------------------------------------------------------ islands (lair / boss platforms share it) */

class Lair extends Base implements SetPiece {
  party = { cx: 0, cz: 0, r: 1.5 };
  focus = { x: 0, y: 2, z: -1, d: 15, pitch: 0.5, yaw: 0 };
  private isles: THREE.InstancedMesh;
  private nums: Label[] = [];
  private pos = [[-3.2, 0.6], [3.2, 0.6], [-3.2, -4.2], [3.2, -4.2]];
  private sink = [0, 0, 0, 0];
  private eye: THREE.Mesh;
  constructor(env: SetEnv, s: SceneState) {
    super(env, 'lair');
    this.isles = this.inst(platformGeo(), 4);
    this.pos.forEach(([x, z], i) => { const l = this.label('num', 128, 128, 0.7); l.obj.position.set(x, 1.4, z); l.set(String(i + 1)); this.nums.push(l); });
    this.eye = this.outlined(bossGeo(3), 0, -1.6, -11.5, 0, 2.6);
    for (const g of s.lair?.gone || []) if (g >= 1 && g <= 4) this.sink[g - 1] = 1;
    this.my = s.lair?.my || 0;
    this.light('#c87aff', 0, 5, -7, 40, 30);
    this.light('#3ae8ff', 0, 1.1, -1.8, 16, 15);   // rune glow lighting the stone from below
    this.light('#ff7aa8', 0, 3.5, -13, 22, 16);   // a hot rim behind the boss
    void s;
  }
  slots(n: number, me: number): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    const live = [0, 1, 2, 3].filter((i) => this.sink[i] < 0.5);   // on relayout only
    for (let i = 0; i < n; i++) {
      const isle = i === me && this.my > 0 ? this.my - 1 : live[i % Math.max(1, live.length)] ?? 0;
      const k = Math.floor(i / Math.max(1, live.length)), a = k * 2.4, r = 0.35 + Math.sqrt(k) * 0.55;
      out.push({ x: this.pos[isle][0] + Math.cos(a) * r, z: this.pos[isle][1] + Math.sin(a) * r });
    }
    return out;
  }
  private my = 0;
  private _m = new THREE.Matrix4();
  update(dt: number, t: number, s: SceneState): void {
    const L = s.lair;
    this.my = L?.my || 0;
    const m = this._m;
    for (let i = 0; i < 4; i++) {
      const gone = !!L?.gone.includes(i + 1);
      this.sink[i] += ((gone ? 1 : 0) - this.sink[i]) * Math.min(1, dt * 1.5);
      m.makeScale(2.2, 1, 2.2).setPosition(this.pos[i][0], -this.sink[i] * 2.5, this.pos[i][1]);
      this.isles.setMatrixAt(i, m);
      this.nums[i].obj.visible = this.sink[i] < 0.5;
      if (this.my === i + 1) this.env.decals.add(this.pos[i][0], 0.05, this.pos[i][1], 2.3, '#ffd34d', 0.9, 0.2, 5);
      else if (this.sink[i] < 0.6) this.env.decals.add(this.pos[i][0], 0.03, this.pos[i][1], 3.1, '#3ae8ff', 0.22 * (1 - this.sink[i] * 1.6), 1, 1.6);
    }
    this.isles.instanceMatrix.needsUpdate = true;
    this.eye.position.y = -1.6 + Math.sin(t * 0.8) * 0.4;
  }
}

/* ------------------------------------------------------------------ loot */

class Loot extends Base implements SetPiece {
  party = { cx: 0, cz: 0, r: 3.0 };
  focus = { x: 0, y: 1.6, z: 0, d: 11, pitch: 0.34, yaw: 0.15 };
  pose: SetPiece['pose'] = 'cheer';
  private item: THREE.InstancedMesh;
  private sign: Label;
  private fxT = 0;
  private _m = new THREE.Matrix4();
  constructor(env: SetEnv, s: SceneState) {
    super(env, 'loot');
    this.outlined(pedestalGeo(), 0, 0, 0);
    this.item = this.inst(itemGeo(/клык|зуб/i.test(s.loot?.name || '') ? 'tooth' : 'relic'), 1);
    this.item.setColorAt(0, new THREE.Color('#ffc94d')); this.item.instanceColor!.needsUpdate = true;
    this.sign = this.label('loot', 512, 160, 0.7);
    this.sign.obj.position.set(0, 3.1, 0);
    this.light('#ffe27a', 0, 2.5, 0, 16, 10);
  }
  update(dt: number, t: number, s: SceneState): void {
    const m = this._m.makeRotationY(t * 1.4);
    m.scale(_s16).setPosition(0, 1.7 + Math.sin(t * 2) * 0.15, 0);
    this.item.setMatrixAt(0, m); this.item.instanceMatrix.needsUpdate = true;
    const L = s.loot;
    if (this.relabel) this.sign.set(L?.name || 'Добыча', L ? `голосов: ${L.votes}${s.until ? ' · ' + this.env.secLeft(s.until) + ' с' : ''}` : '', '#ffc94d');
    this.env.decals.add(0, 0.01, 0, 2.2, '#ffd34d', 0.7, 0.4, 3);
    this.fxT += dt;
    if (this.fxT > 0.1) { this.fxT = 0; const fx = this.env.fx, a = fx.rnd() * 6.28; fx.emit(1, Math.cos(a) * 0.6, 1.4, Math.sin(a) * 0.6, Math.cos(a) * 0.4, 0.8, Math.sin(a) * 0.4, 1.2, 0.16, 0.05, 1, 0.85, 0.3, 1, -0.5, 0.5, false, a, 3); }
  }
}

/* ------------------------------------------------------------------ empty (travel / battle: the terrain is the set) */

class Empty extends Base implements SetPiece {
  party = { cx: 0, cz: 0, r: 2 };
  focus = { x: 0, y: 1, z: 0, d: 12, pitch: 0.35, yaw: 0 };
  constructor(env: SetEnv) { super(env, 'empty'); }
  update(): void { /* */ }
}

/* ================================================================== 28.10 event / puzzle sets (art-events.ts) */

/** Models face −Z; the camera sits on +Z, the party on −X: this turn faces the camera, a little toward the party. */
const FACE = Math.PI - 0.35;
const _o = new THREE.Object3D(), _ma = new THREE.Matrix4(), _mb = new THREE.Matrix4(), _cc = new THREE.Color(), _wv = new THREE.Vector3();
const STEP_WORD: Record<string, string> = { l: 'влево', r: 'вправо', j: 'прыг', c: 'хлоп' };

/** Goblin reveal parsing lives in the adapter (event.res); re-exported for the fallback and the tests. */
export { revealOf };
/** Numbers the puzzle task line carries (puzzleTask): changed «от 1 до N», letter «Буква К · слов 3 из 10». */
export function puzzleLineInfo(line: string): { items: number; letter: string; got: number; goal: number } {
  const t = String(line || '');
  const it = /до\s+(\d+)/.exec(t), le = /Буква\s+(\S+)/i.exec(t), wg = /слов\s+(\d+)\s+из\s+(\d+)/i.exec(t);
  return { items: it ? +it[1] : 0, letter: le ? le[1].replace(/[·.,]/g, '') : '', got: wg ? +wg[1] : 0, goal: wg ? +wg[2] : 0 };
}

/** letter puzzle numbers: the structured fields (adapter puzzle.letter / got / goal), the task line as a fallback */
function letterInfo(s: SceneState): { letter: string; got: number; goal: number } {
  const P = s.puzzle; if (!P) return { letter: '', got: 0, goal: 0 };
  if (P.letter || P.goal) return { letter: P.letter, got: P.got, goal: P.goal };
  const i = puzzleLineInfo(P.line); return { letter: i.letter, got: i.got, goal: i.goal };
}

class EvBase extends Base {
  protected get q(): number { return this.env.q ?? 2; }
  /** canvases at 2× (q0: 1×): the subtitles stay crisp at 960×540 and on HiDPI; same world size */
  protected label(style: ConstructorParameters<typeof Label>[0], w: number, h: number, height: number, plane = false): Label {
    const k = this.q > 0 ? 2 : 1;
    return super.label(style, w * k, h * k, height, plane);
  }
  /** outlined unless q0; `parent` defaults to the root */
  protected ol(g: THREE.BufferGeometry, x = 0, y = 0, z = 0, ry = 0, s = 1, parent?: THREE.Object3D, mat?: THREE.Material): THREE.Mesh {
    const m = new THREE.Mesh(g, mat || this.env.mats.tint); m.position.set(x, y, z); m.rotation.y = ry; m.scale.setScalar(s);
    if (this.q > 0 && !mat) m.add(new THREE.Mesh(hullGeo(g), this.env.mats.outline));
    (parent || this.root).add(m); return m;
  }
  protected group(x: number, y: number, z: number, ry: number, s = 1): THREE.Group {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; g.scale.setScalar(s); this.root.add(g); return g;
  }
  /** instanced (+ instanced hull unless q0) under `parent` */
  protected instIn(g: THREE.BufferGeometry, n: number, parent: THREE.Object3D, hull = true): THREE.InstancedMesh {
    const im = this.inst(g, n); parent.add(im);
    if (hull && this.q > 0) { const h = new THREE.InstancedMesh(hullGeo(g), this.env.mats.outline, Math.max(1, n)); h.instanceMatrix = im.instanceMatrix; h.count = n; h.frustumCulled = false; im.add(h); }
    return im;
  }
  /** a static canvas-textured plane (one draw call): drawn once at build, `w`×`h` px → `ww`×`wh` m, facing +Z (rotate for −Z) */
  protected canvasPlane(w: number, h: number, ww: number, wh: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, round = false): THREE.Mesh {
    const k = this.q > 0 ? 2 : 1, c = document.createElement('canvas'); c.width = w * k; c.height = h * k;
    const x = c.getContext('2d'); if (x) { x.scale(k, k); draw(x, w, h); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
    const geo = round ? new THREE.CircleGeometry(ww / 2, 28) : new THREE.PlaneGeometry(ww, wh);
    this.own.push(tex, mat, geo);
    const m = new THREE.Mesh(geo, mat); m.renderOrder = 4; return m;
  }
  /** a canvas plane redrawn on demand (`draw(key, fn)` is a no-op while the key is unchanged; call it on relabel frames only) */
  protected board(w: number, h: number, ww: number, wh: number): { mesh: THREE.Mesh; draw(key: string, fn: (c: CanvasRenderingContext2D, w: number, h: number) => void): void } {
    const k = this.q > 0 ? 2 : 1, c = document.createElement('canvas'); c.width = w * k; c.height = h * k;
    const x = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
    const geo = new THREE.PlaneGeometry(ww, wh);
    this.own.push(tex, mat, geo);
    const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 4;
    let key = '\u0000';
    return { mesh, draw(kk, fn) { if (kk === key || !x) return; key = kk; x.setTransform(k, 0, 0, k, 0, 0); x.clearRect(0, 0, w, h); fn(x, w, h); tex.needsUpdate = true; } };
  }
  protected lamp(color: string, x: number, y: number, z: number, i: number, d = 10): THREE.PointLight | null { return this.q > 0 ? this.light(color, x, y, z, i, d) : null; }
  /** particles: fewer at q0 */
  protected fxOk(dt: number, every: number): boolean { this.fxAcc += dt; const e = this.q > 0 ? every : every * 2.5; if (this.fxAcc < e) return false; this.fxAcc = 0; return true; }
  private fxAcc = 0;
  protected stT = 0; protected stPrev = '';
  /** seconds since the stage changed */
  protected stage(st: string, dt: number): number { if (st !== this.stPrev) { this.stPrev = st; this.stT = 0; } else this.stT += dt; return this.stT; }
}
const eventSign = (l: Label, s: SceneState, extra = '') => {
  const E = s.event; if (!E) return;
  l.set(E.name || 'Событие', short(extra || E.text || E.how || '', 46));
};

/* ------------------------------------------------------------------ riddle: «Загадка старого камня» (talking stone) */

class RiddleStone extends EvBase implements SetPiece {
  party = { cx: -1.9, cz: 1.5, r: 1.8 };
  focus = { x: 2.4, y: 1.5, z: -0.3, d: 9.2, pitch: 0.2, yaw: -0.12, lock: true };
  private mouth: THREE.Mesh;
  private sign: Label;
  constructor(env: SetEnv) {
    super(env, 'pz-riddle');
    const st = this.ol(talkingStoneGeo(), 3.2, 0, -0.9, FACE, 1);
    this.mouth = new THREE.Mesh(stoneMouthGeo(), env.mats.tint); this.mouth.position.set(0, 0.92, -1.02); st.add(this.mouth);
    this.ol(graveGeo(2), 5.6, 0, -0.2, FACE + 0.4, 0.9);
    this.sign = this.label('loot', 768, 192, 1.05); this.sign.obj.position.set(2.6, 3.9, -0.6);
    this.lamp('#a8ffd8', 2.2, 2.6, 0.8, 8, 9);
  }
  update(dt: number, t: number, s: SceneState): void {
    const P = s.puzzle, st = P?.st || 'answer', k = this.stage(st, dt);
    if (this.relabel) this.sign.set(P ? `${P.icon} ${P.name}` : 'Загадка', P ? short(P.line, 52) : '', st === 'done' ? '#9fe39a' : '');
    // talks in bursts (3 s speech, 2 s pause); done: a wide happy «О» then a smile
    const talk = st !== 'done' && (t % 5) < 3;
    const open = st === 'done' ? (k < 1.2 ? 1.5 : 0.55) : talk ? 0.45 + 0.75 * Math.abs(Math.sin(t * 9)) : 0.3;
    this.mouth.scale.set(1, this.mouth.scale.y + (open - this.mouth.scale.y) * Math.min(1, dt * 14), 1);
    this.env.decals.add(3.0, 0.01, -0.6, 2.6, '#a8ffd8', st === 'show' ? 0.6 + 0.25 * Math.sin(t * 4) : 0.35, 0.5, 0);
    if (talk && this.fxOk(dt, 0.35)) { const fx = this.env.fx; fx.emit(1, 2.7 + fx.rnd() * 0.3, 1.0, -0.2, -0.6, 0.5, 0.4, 1.1, 0.14, 0.04, 0.75, 1, 0.85, 0.9, 0, 0.5, true, 0, 2); }
    if (st === 'done' && k < 2 && this.fxOk(dt, 0.08)) { const fx = this.env.fx; fx.emit(1, 3 + (fx.rnd() - 0.5) * 2, 2.6, -0.8, (fx.rnd() - 0.5) * 2, 2, 0, 1.2, 0.16, 0.05, 1, 0.85, 0.3, 1, -3, 0.4, false, fx.rnd() * 6, 4); }
  }
}

/* ------------------------------------------------------------------ count: critters dashing between burrows (never countable from here) */

const CRIT = 1.9;
class CountMeadow extends EvBase implements SetPiece {
  party = { cx: -1.9, cz: 1.5, r: 1.8 };
  focus = { x: 3.7, y: 0.8, z: -1.0, d: 8.8, pitch: 0.32, yaw: -0.1, lock: true };
  private crit: THREE.InstancedMesh;
  private holes: [number, number][] = [[0.9, -1.6], [2.6, -0.1], [5.0, -2.1], [3.2, -3.2], [4.3, 0.8]];
  private sign: Label;
  private N = 9;
  constructor(env: SetEnv) {
    super(env, 'pz-count');
    const bur = this.instIn(burrowGeo(), this.holes.length, this.root);
    this.holes.forEach(([x, z], i) => { bur.setMatrixAt(i, _ma.makeRotationY(i).setPosition(x, 0, z)); });
    bur.instanceMatrix.needsUpdate = true;
    this.crit = this.instIn(critterGeo(), this.N, this.root);
    const pal = ['#f4eee6', '#c8864a', '#8a8098', '#f0b8c8', '#a87a4a', '#ffffff', '#7a5a4a'];
    for (let i = 0; i < this.N; i++) this.crit.setColorAt(i, _cc.set(pal[i % pal.length]));
    this.crit.instanceColor!.needsUpdate = true;
    this.ol(boardGeo(), 7.0, 0, -0.9, FACE - 0.1, 1.0);
    this.sign = this.label('sign', 512, 192, 0.62, true);
    this.sign.obj.position.set(7.0 - Math.sin(FACE - 0.1) * 0.11, 1.75, -0.9 - Math.cos(FACE - 0.1) * 0.11); this.sign.obj.rotation.y = FACE - 0.1 + Math.PI;
    this.sign.obj.scale.set(2.05, 2.05 * 192 / 512, 1);
  }
  update(dt: number, t: number, s: SceneState): void {
    const P = s.puzzle, st = P?.st || 'show';
    if (this.relabel) this.sign.set(st === 'done' && P?.ans ? `Было: ${P.ans}` : 'Сколько?', st === 'show' ? 'считай на стриме!' : st === 'done' ? '' : short(P?.line || 'ответ — числом в чат', 30), st === 'done' ? '#2a7a3a' : '');
    const H = this.holes, m = this.crit;
    for (let i = 0; i < this.N; i++) {
      // each critter: own period; runs hole a → hole b, then hides a while (so the scene never shows a countable total)
      const per = 2.6 + (i * 0.73) % 1.9, ph = (t + i * 1.37) / per, cyc = Math.floor(ph), f = ph - cyc;
      const a = (i + cyc * 2) % H.length, b = (a + 1 + (i + cyc) % (H.length - 1)) % H.length;
      let x: number, z: number, y = 0, sc = CRIT, ry = 0;
      if (st === 'show') {
        const run = Math.min(1, f / 0.8), vis = f < 0.82 && (i + cyc) % 4 !== 0;
        x = H[a][0] + (H[b][0] - H[a][0]) * run; z = H[a][1] + (H[b][1] - H[a][1]) * run;
        y = Math.abs(Math.sin(t * 11 + i)) * 0.28; ry = Math.atan2(-(H[b][0] - H[a][0]), -(H[b][1] - H[a][1]));
        if (!vis) sc = 0.0001; else sc = CRIT * Math.min(1, run * 6, (1 - run) * 6 + 0.25);
      } else {
        // peek out of the holes, look around
        const h = H[i % H.length]; x = h[0]; z = h[1] - 0.05;
        const up = Math.max(0, Math.sin(t * 1.3 + i * 2.1)); y = -0.6 + up * 0.75; sc = i < H.length ? CRIT : 0.0001; ry = FACE + Math.sin(t * 2 + i) * 0.6;
        if (st === 'done') { y = 0.02 + Math.abs(Math.sin(t * 7 + i)) * 0.3; sc = i < H.length ? CRIT : 0.0001; }
      }
      _o.position.set(x, y, z); _o.rotation.set(0, ry, 0); _o.scale.setScalar(sc); _o.updateMatrix(); m.setMatrixAt(i, _o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    if (st === 'show') for (const [x, z] of H) this.env.decals.add(x, 0.01, z, 1.0, '#ffe27a', 0.25, 1, 0);
  }
}

/* ------------------------------------------------------------------ changed: «Пропавший предмет» — trinkets on a shelf, curtain while answering */

/** trinket kinds in slot order: the most distinct silhouettes first (mug, apple, bell, mushroom, gem, pear, candle, key, book, scroll) */
const SHELF_KINDS = [1, 0, 7, 5, 6, 8, 3, 2, 4, 9];
class ChangedShelf extends EvBase implements SetPiece {
  party = { cx: -1.9, cz: 1.5, r: 1.8 };
  focus = { x: 2.8, y: 1.6, z: -1.4, d: 8.4, pitch: 0.16, yaw: -0.08, lock: true };
  private shelf: THREE.Group;
  private items: THREE.Mesh;
  private curtain: THREE.Mesh;
  private nums: THREE.Mesh;
  private sign: Label;
  private n: number;
  private spots: [number, number][] = [];
  private gone = 0;
  constructor(env: SetEnv, s: SceneState) {
    super(env, 'pz-changed');
    this.n = Math.max(3, Math.min(10, s.puzzle?.items || puzzleLineInfo(s.puzzle?.line || '').items || 6));
    this.shelf = this.group(3.0, 0, -1.8, Math.PI - 0.1, 1.4);
    this.ol(shelfGeo(), 0, 0, 0, 0, 1, this.shelf);
    const top = Math.ceil(this.n / 2);
    for (let i = 0; i < this.n; i++) {
      const row = i < top ? 0 : 1, k = row ? i - top : i, cnt = row ? this.n - top : top;
      this.spots.push([(cnt - 1) / 2 * 0.75 - k * 0.75, row ? 0.3 : 1.15]);   // slot 1 = viewer's left (local +x)
    }
    this.items = new THREE.Mesh(this.itemsGeo(0), env.mats.tint); this.shelf.add(this.items);
    this.curtain = new THREE.Mesh(curtainGeo(), env.mats.tint); this.curtain.position.set(0, 2.45, -0.4); this.curtain.scale.set(1, 0.05, 1); this.shelf.add(this.curtain);
    this.nums = this.numPlane(); this.shelf.add(this.nums);
    this.sign = this.label('loot', 640, 192, 0.95); this.sign.obj.position.set(3.0, 3.95, -0.7);
    this.lamp('#ffe0a8', 2.4, 3, 0.6, 9, 10);
  }
  private itemsGeo(skip: number): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    this.spots.forEach(([x, y], i) => { if (i + 1 === skip) return; const g = trinketGeo(SHELF_KINDS[i % SHELF_KINDS.length]).clone(); g.scale(1.9, 1.9, 1.9); g.rotateY(Math.PI + (i % 3 - 1) * 0.3); g.translate(x, y + 0.05, -0.05); parts.push(g); });
    const g = parts.length ? mergeGeometries(parts, false) || new THREE.BufferGeometry() : new THREE.BufferGeometry();
    for (const p of parts) p.dispose();
    this.own.push(g);
    return g;
  }
  /** one canvas plane with every slot number (one draw call instead of one label per item) */
  private numPlane(): THREE.Mesh {
    const W = 1024, Hh = 512, c = document.createElement('canvas'); c.width = W; c.height = Hh;
    const x = c.getContext('2d');
    const sx = (u: number) => W / 2 - (u / 3.6) * W, sy = (v: number) => Hh - (v / 2.2) * Hh;   // plane faces local −Z (mirrored u)
    if (x) for (let i = 0; i < this.spots.length; i++) {
      const [u, v] = this.spots[i], cx = sx(u) - 78, cy = sy(v + 0.13);
      slotBadge(x, cx, cy, 30, String(i + 1));
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
    const geo = new THREE.PlaneGeometry(3.6, 2.2);
    const m = new THREE.Mesh(geo, mat); m.position.set(0, 1.1, -0.36); m.rotation.y = Math.PI; m.renderOrder = 5;
    this.own.push(tex, mat, geo);
    return m;
  }
  update(dt: number, t: number, s: SceneState): void {
    const P = s.puzzle, st = P?.st || 'show', k = this.stage(st, dt);
    const down = st === 'answer' ? 2.25 : 0.05;
    this.curtain.scale.y += (down - this.curtain.scale.y) * Math.min(1, dt * 3);
    this.nums.visible = this.curtain.scale.y < 1.2 || st !== 'answer';
    const ans = st === 'done' ? Math.round(+(P?.ans || 0)) : 0;
    if (ans > 0 && ans <= this.n && this.gone !== ans) {
      this.gone = ans; this.items.geometry = this.itemsGeo(ans);
      const [u, v] = this.spots[ans - 1]; _wv.set(u, v + 0.25, -0.1); this.shelf.localToWorld(_wv);
      this.env.float(`пропал №${ans}`, '#ffe27a', _wv.x, _wv.y + 0.6, _wv.z, 0.6);
    }
    if (this.gone && this.fxOk(dt, 0.1)) {
      const [u, v] = this.spots[this.gone - 1]; _wv.set(u, v + 0.25, -0.1); this.shelf.localToWorld(_wv);
      const fx = this.env.fx; fx.emit(1, _wv.x + (fx.rnd() - 0.5) * 0.4, _wv.y, _wv.z, 0, 0.6, 0, 0.9, 0.14, 0.03, 1, 0.85, 0.3, 1, 0, 0.5, true, fx.rnd() * 6, 3);
    }
    if (this.relabel) this.sign.set(P ? `${P.icon} ${P.name}` : 'Что пропало?', st === 'show' ? 'запоминай: что под каким номером' : st === 'answer' ? `какой пропал? номер 1–${this.n}` : this.gone ? `пропал предмет №${this.gone}` : 'итог', st === 'done' ? '#9fe39a' : '');
    this.items.position.y = st === 'show' ? Math.sin(t * 2) * 0.01 : 0;
    void k;
  }
}

/* ------------------------------------------------------------------ letter: the carved letter block and a ring of word-orbs */

class LetterBlock extends EvBase implements SetPiece {
  party = { cx: -1.9, cz: 1.5, r: 1.8 };
  focus = { x: 2.5, y: 1.5, z: -0.6, d: 10.2, pitch: 0.2, yaw: -0.12, lock: true };
  private orbs: THREE.InstancedMesh;
  private letter: Label;
  private sign: Label;
  private G = 10; private got = -1;
  private bx = 3.2; private bz = -1.2;
  constructor(env: SetEnv, s: SceneState) {
    super(env, 'pz-letter');
    this.G = Math.max(3, Math.min(24, letterInfo(s).goal || 10));
    const blk = this.group(this.bx, 0, this.bz, FACE);
    this.ol(letterBlockGeo(), 0, 0, 0, 0, 1, blk);
    this.letter = this.label('word', 256, 256, 1.5, true);
    blk.add(this.letter.obj); this.letter.obj.position.set(0, 1.25, -0.73); this.letter.obj.rotation.y = Math.PI;
    this.orbs = this.instIn(orbGeo(), this.G, this.root, false);
    this.sign = this.label('loot', 512, 160, 0.85); this.sign.obj.position.set(this.bx, 4.3, this.bz);
    this.lamp('#7af0ff', this.bx - 1, 2.6, this.bz + 1.6, 9, 9);
  }
  update(dt: number, t: number, s: SceneState): void {
    const P = s.puzzle, info = letterInfo(s), got = Math.min(this.G, info.got);
    if (this.relabel) {
      this.letter.set((info.letter || '?').toUpperCase(), '', '#9ff4ff');
      this.sign.set(P ? `${P.icon} ${P.name}` : 'Слова на букву', `слов ${info.got} из ${info.goal || this.G}`, P?.st === 'done' ? '#9fe39a' : '');
    }
    if (this.got >= 0 && got > this.got) {
      this.orbAt(got - 1, 0); this.env.float('+слово', '#ffe27a', _wv.x, _wv.y + 0.6, _wv.z, 0.5);
    }
    this.got = got;
    const m = this.orbs;
    for (let i = 0; i < this.G; i++) {
      const on = i < got;
      this.orbAt(i, on ? Math.sin(t * 3 + i) * 0.06 : 0); _o.position.copy(_wv);
      _o.rotation.set(0, 0, 0); _o.scale.setScalar(on ? 1.8 + Math.sin(t * 5 + i) * 0.1 : 1.05); _o.updateMatrix(); m.setMatrixAt(i, _o.matrix);
      m.setColorAt(i, _cc.set(on ? '#ffd34d' : '#3e3a52'));
    }
    m.instanceMatrix.needsUpdate = true; m.instanceColor!.needsUpdate = true;
    this.env.decals.add(this.bx, 0.01, this.bz + 0.3, 2.4, '#7af0ff', 0.4 + 0.15 * Math.sin(t * 3), 0.5, 0);
  }
  /** word lamps in an arch over the block, filled from the viewer's left (a readable «N of G» row) → _wv */
  private orbAt(i: number, bob: number): THREE.Vector3 {
    const a = Math.PI * (0.93 - 0.86 * (this.G > 1 ? i / (this.G - 1) : 0.5)), r = 2.1;
    return _wv.set(this.bx + Math.cos(a) * r * Math.cos(FACE - Math.PI) , 1.55 + Math.sin(a) * 1.55 + bob, this.bz + 0.5 - Math.cos(a) * r * Math.sin(FACE - Math.PI));
  }
}

/* ------------------------------------------------------------------ Изнанка: trick («Сладость или гадость») */

class TrickDoor extends EvBase implements SetPiece {
  party = { cx: -1.9, cz: 1.5, r: 1.8 };
  focus = { x: 2.4, y: 1.3, z: -1.2, d: 13, pitch: 0.42, yaw: -0.1, lock: true };
  private door: THREE.Group;
  private jack: THREE.Mesh; private bowl: THREE.Mesh; private sack: THREE.Mesh;
  private glow: THREE.PointLight | null;
  private sign: Label;
  private H: THREE.Group;
  constructor(env: SetEnv) {
    super(env, 'ev-trick');
    this.H = this.group(3.0, 0, -2.4, FACE + 0.1);
    this.ol(cottageGeo(), 0, 0, 0, 0, 1, this.H);
    this.door = new THREE.Group(); this.door.position.set(0.58, 0, -0.08); this.H.add(this.door);   // hinge on the viewer's left
    this.ol(doorGeo(), 0, 0, 0, Math.PI, 1, this.door);
    this.jack = this.ol(lanternGeo(), 0, 0.2, -1.5, 0, 1.6, this.H);
    this.bowl = this.ol(candyBowlGeo(), 2.15, 0, -1.7, 0, 1.3, this.H);
    this.sack = this.ol(sackGeo(), -2.15, 0, -1.7, 0.2, 1.3, this.H);
    this.glow = this.lamp('#ff9a3a', 0, 0, 0, 6, 9);
    if (this.glow) { this.H.add(this.glow); this.glow.position.set(0.6, 3.0, -2.6); }
    this.sign = this.label('loot', 640, 192, 1.1); this.sign.obj.position.set(2.75, 5.25, -1.4);
    this.tSweet = this.label('num', 128, 128, 0.72); this.tTrick = this.label('num', 128, 128, 0.72);
  }
  private tSweet: Label; private tTrick: Label;
  update(dt: number, t: number, s: SceneState): void {
    const E = s.event, st = E?.st || 'vote', k = this.stage(st, dt);
    const sw = E?.votes[0] || 0, tr = E?.votes[1] || 0, tot = Math.max(1, sw + tr), done = st === 'done';
    const sweetWin = sw >= tr;
    if (this.relabel) {
      this.sign.set(E?.name || 'Сладость или гадость', done ? (sweetWin ? 'сладость!' : 'гадость!') : `сладость ${sw} · гадость ${tr}`, done ? (sweetWin ? '#ffd34d' : '#9fe39a') : '');
      this.tSweet.set(String(sw), '', '#d8346a'); this.tTrick.set(String(tr), '', '#5a2a8a');
      _wv.set(2.15, 0.8 + this.bowl.scale.x * 1.05, -1.7); this.H.localToWorld(_wv); this.tSweet.obj.position.copy(_wv);
      _wv.set(-2.15, 0.6 + this.sack.scale.x * 0.95, -1.7); this.H.localToWorld(_wv); this.tTrick.obj.position.copy(_wv);
    }
    // the jack-o'-lantern rocks and «talks»; the bowl and the sack swell with their share of the vote
    this.jack.rotation.z = Math.sin(t * 3) * 0.08; this.jack.position.y = 0.2 + Math.abs(Math.sin(t * 3)) * 0.06;
    const bs = 1.1 + 0.5 * sw / tot, ss = 1.1 + 0.5 * tr / tot;
    this.bowl.scale.setScalar(this.bowl.scale.x + (bs - this.bowl.scale.x) * Math.min(1, dt * 3));
    this.sack.scale.setScalar(this.sack.scale.x + (ss - this.sack.scale.x) * Math.min(1, dt * 3));
    this.sack.rotation.z = done && !sweetWin ? Math.sin(t * 14) * 0.15 : Math.sin(t * 1.7) * 0.04;
    const open = done ? Math.min(1, k * 0.8) : 0;
    this.door.rotation.y = -open * 1.6;
    if (this.glow) this.glow.intensity = 6 * (0.8 + 0.2 * Math.sin(t * 13) * Math.sin(t * 4.1)) + open * 8;
    if (done && k < 5 && this.fxOk(dt, 0.035)) {
      const fx = this.env.fx;
      _wv.set(sweetWin ? 2.15 : -2.15, 1.2, -1.7); this.H.localToWorld(_wv);
      if (sweetWin) { const c = fx.rnd(); fx.emit(1, _wv.x, _wv.y, _wv.z, (fx.rnd() - 0.5) * 3, 3 + fx.rnd() * 2, (fx.rnd() - 0.5) * 3, 1.5, 0.3, 0.16, c < 0.33 ? 1 : 0.4, c < 0.66 ? 0.5 : 0.9, c > 0.5 ? 0.8 : 0.4, 1, -7, 0.3, false, fx.rnd() * 6, 6); }
      else fx.emit(3, _wv.x + (fx.rnd() - 0.5) * 0.6, _wv.y, _wv.z, 0, 0.9, 0, 2, 0.4, 1.4, 0.5, 0.9, 0.35, 0.5, 0, 0.3);
    }
    _wv.set(0, 0, -1.2); this.H.localToWorld(_wv);
    this.env.decals.add(_wv.x, 0.01, _wv.z, 2.4, '#ff9a3a', 0.35 + 0.1 * Math.sin(t * 5), 0.5, 0);
  }
}

/* ------------------------------------------------------------------ Изнанка: fortune («Гадалка Джека») */

class FortuneTent extends EvBase implements SetPiece {
  party = { cx: -1.9, cz: 1.5, r: 1.8 };
  focus = { x: 2.8, y: 1.4, z: -1.4, d: 11.5, pitch: 0.16, yaw: -0.08, lock: true };
  private ball: THREE.Mesh;
  private cards: THREE.InstancedMesh;
  private teller: THREE.Mesh;
  private glow: THREE.PointLight | null;
  private sign: Label;
  private T: THREE.Group;
  constructor(env: SetEnv) {
    super(env, 'ev-fortune');
    this.T = this.group(3.0, 0, -2.0, FACE + 0.1);
    this.ol(fortuneTentGeo(), 0, 0, 0, 0, 1, this.T);
    this.teller = this.ol(tellerGeo(), 0, 0, 0.75, 0, 1, this.T);
    this.ball = new THREE.Mesh(crystalBallGeo(), env.mats.glow); this.ball.position.set(0, 1.38, -0.2); this.T.add(this.ball);
    this.cards = this.instIn(tarotGeo(), 3, this.T, false);
    this.glow = this.lamp('#c87aff', 0, 0, 0, 14, 8);
    if (this.glow) { this.T.add(this.glow); this.glow.position.set(0, 1.6, -0.7); }
    this.sign = this.label('loot', 640, 192, 1.0); this.sign.obj.position.set(2.8, 5.2, -1.8);
  }
  update(dt: number, t: number, s: SceneState): void {
    const E = s.event, st = E?.st || 'on', done = st === 'done';
    if (this.relabel) eventSign(this.sign, s);
    const pulse = done ? 0.7 : 1.3 + Math.sin(t * 3) * 0.12;
    this.ball.scale.setScalar(this.ball.scale.x + (pulse - this.ball.scale.x) * Math.min(1, dt * 4));
    this.ball.rotation.y += dt * (done ? 0.3 : 1.2);
    if (this.glow) this.glow.intensity = done ? 3 : 14 + Math.sin(t * 3) * 4;
    this.teller.position.y = Math.sin(t * 1.6) * 0.03;
    // three cards; one at a time turns over (a lift-and-flip every 2.4 s) while the tent is open
    for (let i = 0; i < 3; i++) {
      const ph = ((t / 2.4) - i / 3) % 1, f = done ? 0 : Math.max(0, Math.min(1, (ph - 0.1) / 0.3));
      _o.position.set(-0.38 + i * 0.38, 0.91 + Math.sin(f * Math.PI) * 0.25, -0.62 - Math.abs(i - 1) * 0.06);
      _o.rotation.set(0, (i - 1) * -0.3, f * Math.PI); _o.scale.setScalar(1); _o.updateMatrix(); this.cards.setMatrixAt(i, _o.matrix);
    }
    this.cards.instanceMatrix.needsUpdate = true;
    if (!done && this.fxOk(dt, 0.12)) { _wv.set(0, 1.33, -0.2); this.T.localToWorld(_wv); const fx = this.env.fx, a = fx.rnd() * 6.28; fx.emit(1, _wv.x + Math.cos(a) * 0.35, _wv.y, _wv.z + Math.sin(a) * 0.35, 0, 0.5, 0, 1.0, 0.12, 0.02, 0.8, 0.6, 1, 1, 0, 0.4, true, a, 3); }
  }
}

/* ------------------------------------------------------------------ Изнанка: the witch's cauldron («Ведьмин котёл») */

const BREW_COL: Record<string, string> = { pay: '#6a7a5a', ingr: '#6ad84a', brew: '#c86aff', done: '#ffd34d' };
class Cauldron extends EvBase implements SetPiece {
  party = { cx: -1.9, cz: 1.5, r: 1.8 };
  focus = { x: 2.6, y: 1.1, z: -0.8, d: 10, pitch: 0.42, yaw: -0.1, lock: true };
  private brew: THREE.InstancedMesh;
  private ladle: THREE.Mesh;
  private witch: THREE.Mesh;
  private flames: THREE.Mesh;
  private coins: THREE.InstancedMesh;
  private bits: THREE.InstancedMesh;
  private fire: THREE.PointLight | null;
  private sign: Label;
  private cx = 3.0; private cz = -1.0;
  private seen = 0; private drop: number[] = [];
  private C = 20; private B = 12;
  constructor(env: SetEnv) {
    super(env, 'ev-cauldron');
    this.ol(cauldronGeo(), this.cx, 0, this.cz, 0);
    this.flames = this.mesh(flameGeo(), this.cx, 0.02, this.cz, 0, 1.2, env.mats.glow);
    this.brew = this.inst(brewGeo(), 1); this.brew.position.set(this.cx, 1.5, this.cz);
    this.ladle = this.mesh(ladleGeo(), this.cx, 1.5, this.cz);
    this.witch = this.ol(witchGeo(), this.cx + 1.9, 0, this.cz - 0.6, FACE + 0.9, 1.3);
    this.ol(coinBowlGeo(), this.cx - 1.75, 0, this.cz + 0.1, 0, 1.0);
    this.coins = this.instIn(coinGeo(), this.C, this.root, false);
    this.bits = this.instIn(bitGeo(), this.B, this.root, false);
    this.fire = this.lamp('#ff9a4a', this.cx, 1.0, this.cz + 0.8, 14, 10);
    this.sign = this.label('loot', 640, 192, 0.9); this.sign.obj.position.set(this.cx - 0.3, 3.55, this.cz + 0.4);
    for (let i = 0; i < this.B; i++) this.drop.push(1);
  }
  update(dt: number, t: number, s: SceneState): void {
    const E = s.event, st = E?.st || 'ingr', k = this.stage(st, dt), fx = this.env.fx;
    const pool = E?.pool || 0, price = E?.price || 2500, picked = E?.picked || [];
    if (this.relabel) eventSign(this.sign, s, st === 'pay' ? `миска ведьмы: ${Math.min(100, Math.round(pool / Math.max(1, price) * 100))}% · скидывайтесь`
      : st === 'ingr' ? (picked.length ? `в котле: ${picked.slice(-3).map(ingName).join(', ')}${picked.length > 3 ? ' и ещё ' + (picked.length - 3) : ''}` : 'пишите ингредиенты')
      : st === 'brew' ? 'ведьма варит…' : st === 'done' ? 'зелье готово!' : '');
    const col = BREW_COL[st] || '#6ad84a';
    _cc.set(st === 'brew' ? (Math.sin(t * 2) > 0 ? '#c86aff' : '#ff6ad8') : col);
    const cur = this.brew.instanceColor!; const r0 = cur.getX(0), g0 = cur.getY(0), b0 = cur.getZ(0), a = Math.min(1, dt * 3);
    cur.setXYZ(0, r0 + (_cc.r - r0) * a, g0 + (_cc.g - g0) * a, b0 + (_cc.b - b0) * a); cur.needsUpdate = true;
    const boil = st === 'brew' ? 1 : st === 'done' ? 0.6 : st === 'ingr' ? 0.45 : 0.2;
    _o.position.set(0, Math.sin(t * 6) * 0.03 * boil, 0); _o.rotation.set(0, t * 0.4, 0); _o.scale.set(1, 1 + Math.sin(t * 9) * 0.6 * boil, 1); _o.updateMatrix(); this.brew.setMatrixAt(0, _o.matrix); this.brew.instanceMatrix.needsUpdate = true;
    this.ladle.rotation.y += dt * (0.8 + boil * 3);
    this.witch.rotation.y = FACE + 0.9 + Math.sin(t * (1 + boil * 2)) * 0.15;
    this.witch.position.y = st === 'done' && k < 2 ? Math.abs(Math.sin(k * 8)) * 0.3 : 0;
    this.flames.scale.set(1.2 + Math.sin(t * 9) * 0.06, 1.2 * (1 + Math.sin(t * 13) * 0.1) * (0.8 + boil * 0.5), 1.2);
    if (this.fire) this.fire.intensity = 14 * (0.85 + 0.15 * Math.sin(t * 17)) * (0.8 + boil * 0.5);
    // the coin bowl fills with the pool
    const nc = Math.round(Math.min(1, pool / Math.max(1, price)) * this.C);
    this.coins.count = nc;
    for (let i = 0; i < nc; i++) { const aa = i * 2.39, rr = 0.08 + (i % 5) * 0.07; _o.position.set(this.cx - 1.75 + Math.cos(aa) * rr, 0.9 + Math.floor(i / 5) * 0.05, this.cz + 0.1 + Math.sin(aa) * rr); _o.rotation.set(0.3 * Math.sin(aa), 0, 0.3 * Math.cos(aa)); _o.scale.setScalar(0.9); _o.updateMatrix(); this.coins.setMatrixAt(i, _o.matrix); }
    this.coins.instanceMatrix.needsUpdate = true;
    // ingredients: each new one drops in from above, then bobs on the surface
    const nb = Math.min(this.B, picked.length);
    if (nb < this.seen) this.seen = nb;
    while (this.seen < nb) { this.drop[this.seen] = 0; this.bits.setColorAt(this.seen, _cc.set(ingCol(picked[this.seen]))); this.seen++; this.bits.instanceColor!.needsUpdate = true; }
    this.bits.count = st === 'done' ? 0 : nb;
    for (let i = 0; i < nb; i++) {
      const d = this.drop[i] = Math.min(1, this.drop[i] + dt * 1.2), aa = i * 2.1 + t * 0.6, rr = 0.25 + (i % 3) * 0.17;
      const y = 1.66 + (1 - d) * (1 - d) * 2.4 + Math.sin(t * 3 + i) * 0.05;
      if (d < 1 && d + dt * 1.2 >= 1) fx.emit(4, this.cx, 1.6, this.cz, 0, 2, 0, 0.6, 0.15, 0.05, 0.6, 1, 0.5, 1, -4, 0.3, true);
      _o.position.set(this.cx + Math.cos(aa) * rr * d, y, this.cz + Math.sin(aa) * rr * d); _o.rotation.set(t + i, i, 0); _o.scale.setScalar(2.4); _o.updateMatrix(); this.bits.setMatrixAt(i, _o.matrix);
    }
    this.bits.instanceMatrix.needsUpdate = true;
    if (this.fxOk(dt, st === 'brew' ? 0.05 : 0.14)) {
      _cc.set(col);
      fx.emit(3, this.cx + (fx.rnd() - 0.5) * 1.0, 1.7, this.cz + (fx.rnd() - 0.5) * 1.0, 0, 0.6 + boil, 0, 1.6, 0.25, 0.9, 0.6 + _cc.r * 0.3, 0.6 + _cc.g * 0.3, 0.6 + _cc.b * 0.3, 0.45, 0, 0.3);
      if (boil > 0.4) fx.emit(0, this.cx + (fx.rnd() - 0.5) * 1.2, 1.6, this.cz + (fx.rnd() - 0.5) * 1.2, 0, 0.8, 0, 0.5, 0.12, 0.2, _cc.r, _cc.g, _cc.b, 1, 0, 0, true);
    }
    if (st === 'done' && k < 3 && this.fxOk(dt, 0.05)) fx.emit(1, this.cx, 1.8, this.cz, (fx.rnd() - 0.5) * 3, 3 + fx.rnd() * 2, (fx.rnd() - 0.5) * 3, 1.3, 0.18, 0.06, 1, 0.85, 0.35, 1, -6, 0.3, false, fx.rnd() * 6, 5);
    this.env.decals.add(this.cx, 0.01, this.cz, 2.6, col, 0.3 + boil * 0.25, 0.5, 0);
  }
}
/** ingredient colour in quest.js HW_ING order (mushroom, eye, wing, pumpkin, tooth, web, bone, frog, candle, herb, tail); unknown keys by hash */
const ING_COL = ['#e8404a', '#ffffff', '#3a2a4a', '#ff8a2a', '#fff4e2', '#c8c8d8', '#e8e2d0', '#6ac04a', '#ffe27a', '#8ab85a', '#c89a8a'];
const ING_KEYS = Object.keys(HW_ING);
const ingCol = (k: string) => { const i = ING_KEYS.indexOf(k); return ING_COL[(i >= 0 ? i : jh(k)) % ING_COL.length]; };
const jh = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

/* ------------------------------------------------------------------ Изнанка: the lost ghost («Загадка призрака») */

const GX = 2.0;
class LostGhost extends EvBase implements SetPiece {
  party = { cx: -1.9, cz: 1.5, r: 1.8 };
  focus = { x: 3.3, y: 1.75, z: -0.8, d: 9.8, pitch: 0.18, yaw: -0.12, lock: true };
  private ghost: THREE.Mesh;
  private sign: Label;
  private carve: { mesh: THREE.Mesh; draw(key: string, fn: (c: CanvasRenderingContext2D, w: number, h: number) => void): void };
  private gy = 0.35;
  constructor(env: SetEnv) {
    super(env, 'ev-lostghost');
    this.ghost = this.ol(sheetGhostGeo(), GX, 0.35, -0.6, FACE, 1.1);
    const tab = this.ol(puzzleTabletGeo(), 4.75, 0, -1.9, -0.3, 1.3); tab.rotation.z = 0.03;
    // the public riddle carved on the stone (quest.js shows ev.q as «…»), redrawn when it changes
    this.carve = this.board(320, 400, 1.5, 1.875); this.carve.mesh.position.set(0, 1.55, 0.2); tab.add(this.carve.mesh);
    this.ol(graveGeo(1), 0.6, 0, -2.6, FACE + 0.3, 1);
    this.ol(graveGeo(0), 5.8, 0, -0.2, FACE - 0.3, 1);
    this.ol(lanternPoleGeo(), 0.4, 0, -0.9, 0.6);
    this.lamp('#a8c8ff', 2.4, 2.6, 0.4, 10, 10);
    this.sign = this.label('loot', 768, 192, 0.95); this.sign.obj.position.set(2.9, 4.35, -0.6);
  }
  update(dt: number, t: number, s: SceneState): void {
    const E = s.event, st = E?.st || 'riddle', k = this.stage(st, dt), done = st === 'done';
    if (this.relabel) {
      this.sign.set(E?.name || 'Загадка призрака', E?.qn ? `загадка ${Math.max(1, E.qi || 1)} из ${E.qn}${st === 'pause' ? ' · отгадали!' : ''}` : st === 'pause' ? 'отгадали!' : '', done ? '#9fe39a' : '');
      const q = E?.q || '';
      this.carve.draw(`${st}|${q}`, (c, w, h) => carveText(c, w, h, q ? `«${q}»` : done ? 'покой' : '…', st === 'riddle' ? '#bff8ff' : '#ffe9a8'));
    }
    if (st === 'riddle') { const fl = Math.sin(t * 23) * Math.sin(t * 7.1) > 0.6 ? 0.55 : 1; this.sign.material.opacity = fl; }
    else this.sign.material.opacity = 1;
    const tgt = done ? 0.35 + Math.min(9, k * k * 0.8) : 0.35 + Math.sin(t * 1.8) * 0.18;
    this.gy += (tgt - this.gy) * Math.min(1, dt * 4);
    this.ghost.position.y = this.gy;
    this.ghost.rotation.y = st === 'pause' ? FACE + t * 3 : FACE + Math.sin(t * 1.1) * 0.25;
    this.ghost.rotation.z = Math.sin(t * 2.3) * 0.08;
    this.ghost.scale.setScalar(done ? Math.max(0.2, 1.1 - k * 0.12) : 1.1);
    this.ghost.visible = this.gy < 9;
    const soft = st === 'pause' || done;
    this.env.decals.add(GX, 0.01, -0.6, 1.8, soft ? '#ffe27a' : '#a8c8ff', soft ? 0.6 + 0.2 * Math.sin(t * 4) : 0.35, 0.6, soft ? 4 : 0);
    if (soft && this.fxOk(dt, 0.09)) { const fx = this.env.fx, a = fx.rnd() * 6.28; fx.emit(1, GX + Math.cos(a) * 0.8, this.gy + 0.8 + fx.rnd(), -0.6 + Math.sin(a) * 0.6, 0, 0.7, 0, 1.1, 0.16, 0.03, 1, 0.92, 0.6, 1, 0, 0.5, true, a, 3); }
    else if (!soft && this.fxOk(dt, 0.25)) { const fx = this.env.fx; fx.emit(3, GX + (fx.rnd() - 0.5), this.gy + 0.4, -0.6, 0, 0.3, 0, 1.5, 0.3, 0.8, 0.75, 0.82, 0.95, 0.35, 0, 0.3); }
  }
}

/** glowing words carved on a stone face, wrapped to the width, centred */
function carveText(c: CanvasRenderingContext2D, w: number, h: number, text: string, col: string): void {
  c.beginPath(); c.roundRect(4, 4, w - 8, h - 8, 26); c.fillStyle = '#4a4458'; c.fill(); c.lineWidth = 6; c.strokeStyle = '#2a2436'; c.stroke();
  let px = 58; const words = text.split(/\s+/); let lines: string[] = [];
  for (; px >= 22; px -= 2) {
    c.font = `800 ${px}px 'Golos Text','Nunito',sans-serif`; lines = []; let cur = '';
    for (const wd of words) { const t = cur ? cur + ' ' + wd : wd; if (c.measureText(t).width > w - 30 && cur) { lines.push(cur); cur = wd; } else cur = t; }
    if (cur) lines.push(cur);
    if (lines.length * px * 1.2 <= h - 30 && lines.every((l) => c.measureText(l).width <= w - 30)) break;
  }
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.shadowColor = col; c.shadowBlur = 12; c.fillStyle = col; c.lineWidth = 5; c.strokeStyle = '#241c34';
  const y0 = h / 2 - ((lines.length - 1) * px * 1.2) / 2;
  lines.forEach((l, i) => { c.strokeText(l, w / 2, y0 + i * px * 1.2); c.fillText(l, w / 2, y0 + i * px * 1.2); });
  c.shadowBlur = 0;
}

/* ------------------------------------------------------------------ Изнанка: the skeleton dance («Пляска скелетов») */

/** Pose of a dancer for step `k` at progress p (0..1): dx (viewer's right = −), dy, lean, left/right arm (raise sideways, swing forward). */
export function dancePose(k: string, p: number, out: { dx: number; dy: number; lean: number; aSide: number; aFwd: number; clap: number }): typeof out {
  const s = Math.sin(Math.PI * Math.max(0, Math.min(1, p)));
  out.dx = 0; out.dy = 0; out.lean = 0; out.aSide = 0.25; out.aFwd = 0; out.clap = 0;
  if (k === 'l') { out.dx = 0.9 * s; out.lean = -0.35 * s; out.aSide = 0.25 + 1.2 * s; }
  else if (k === 'r') { out.dx = -0.9 * s; out.lean = 0.35 * s; out.aSide = 0.25 + 1.2 * s; }
  else if (k === 'j') { out.dy = 0.9 * s; out.aSide = 0.25 + 2.5 * s; }
  else if (k === 'c') { out.aFwd = 1.5 * s; out.aSide = 0.25 - 0.2 * s; out.clap = s; out.dy = 0.08 * s; }
  return out;
}
class SkelDance extends EvBase implements SetPiece {
  party = { cx: -1.9, cz: 1.5, r: 1.8 };
  focus = { x: 2.4, y: 1.9, z: -1.2, d: 11.2, pitch: 0.18, yaw: -0.1, lock: true };
  private G: THREE.Group;
  private bodies: THREE.InstancedMesh;
  private arms: THREE.InstancedMesh;
  private sign: Label;
  private played = 0; private cur = ''; private p = 1; private idx = -1; private gap = 0;
  private pz = { dx: 0, dy: 0, lean: 0, aSide: 0, aFwd: 0, clap: 0 };
  private clapped = false;
  constructor(env: SetEnv) {
    super(env, 'ev-skeldance');
    this.G = this.group(2.6, 0, -1.8, FACE + 0.15);
    this.ol(cryptStageGeo(), 0, 0, 0, 0, 1, this.G);
    this.bodies = this.instIn(skelBodyGeo(), 3, this.G);
    for (let i = 0; i < 3; i++) this.bodies.setColorAt(i, _cc.set(['#ff5a8a', '#ffc94d', '#7ae0ff'][i]));
    this.bodies.instanceColor!.needsUpdate = true;
    this.arms = this.instIn(skelArmGeo(), 6, this.G, false);
    this.sign = this.label('word', 640, 220, 0.85); this.sign.obj.position.set(2.45, 4.6, -1.0);
    // the step cells over the arch (site q-hwd): shown steps as arrows + words, the rest «?» — never the hidden answer
    this.cells = this.board(640, 180, 4.2, 1.18); this.cells.mesh.position.set(0, 3.75, -0.45); this.cells.mesh.rotation.y = Math.PI; this.G.add(this.cells.mesh);
    this.lamp('#a8ff8a', 2.6, 3.2, 0.4, 12, 11);
  }
  private cells: { mesh: THREE.Mesh; draw(key: string, fn: (c: CanvasRenderingContext2D, w: number, h: number) => void): void };
  update(dt: number, t: number, s: SceneState): void {
    const E = s.event, st = E?.st || 'show', steps = E?.steps || [], L = Math.max(E?.length || 0, steps.length);
    this.stage(st, dt);
    if (steps.length < this.played) this.played = 0;
    // next move: in «show» each newly displayed step plays once as it arrives; «done» loops the public sequence
    this.p += dt / 0.85;
    if (this.p >= 1) {
      this.cur = ''; this.gap -= dt;
      if (st === 'show' && this.played < steps.length) { this.idx = this.played; this.cur = steps[this.played++]; this.p = 0; this.clapped = false; }
      else if (st === 'done' && steps.length && this.gap <= 0) { this.idx = (this.idx + 1) % (steps.length + 1); if (this.idx < steps.length) { this.cur = steps[this.idx]; this.p = 0; this.clapped = false; } else this.gap = 0.8; }
    }
    const P = dancePose(this.cur, this.cur ? this.p : 0, this.pz);
    if (this.relabel) {
      const shownN = st === 'show' ? steps.length : st === 'done' ? steps.length : 0, now = st === 'show' && this.cur ? this.idx : -1, n = Math.max(1, Math.min(8, L || steps.length || 4));
      this.cells.draw(`${st}|${steps.slice(0, shownN).join('')}|${n}|${now}`, (c, w, h) => stepCells(c, w, h, n, steps.slice(0, shownN), now));
      if (st === 'show') this.sign.set(this.cur ? (STEP_WORD[this.cur] || '?').toUpperCase() : 'СМОТРИ!', `па ${Math.max(1, steps.length)} из ${L || '?'} · запоминай`);
      else if (st === 'input') this.sign.set('? '.repeat(Math.max(1, Math.min(8, L))).trim(), `повтори ${L} па одним сообщением`);
      else if (st === 'done') this.sign.set(steps.map((k) => STEP_WORD[k] || '?').join(' ').toUpperCase() || 'ИТОГ', short(E?.text || '', 40));
      else this.sign.set(E?.name || 'Пляска скелетов', short(E?.how || '', 40));
    }
    if (P.clap > 0.95 && !this.clapped) {
      this.clapped = true;
      for (let i = 0; i < 3; i++) { _wv.set((1 - i) * 1.3 + P.dx, 1.55 + P.dy, -0.45); this.G.localToWorld(_wv); this.env.fx.ring(_wv.x, _wv.y, _wv.z, 0.1, 0.9, 0.35, '#ffe27a', 1, 0.2); }
    }
    const idle = !this.cur ? Math.abs(Math.sin(t * (st === 'input' ? 5 : 3))) * 0.05 : 0;
    for (let i = 0; i < 3; i++) {
      const x = (1 - i) * 1.3 + P.dx, y = 0.4 + P.dy + idle;
      _o.position.set(x, y, 0); _o.rotation.set(0, 0, P.lean + (this.cur ? 0 : Math.sin(t * 3 + i) * 0.06)); _o.scale.setScalar(1.4); _o.updateMatrix();
      this.bodies.setMatrixAt(i, _o.matrix);
      _ma.copy(_o.matrix);
      for (let sd = 0; sd < 2; sd++) {
        const sg = sd ? -1 : 1;
        _mb.makeRotationFromEuler(_e.set(-P.aFwd, 0, sg * (P.aSide - P.clap * 0.0) + (P.clap ? -sg * 0.45 * P.clap : 0))).setPosition(sg * 0.24, 1.1, 0);
        this.arms.setMatrixAt(i * 2 + sd, _mb.premultiply(_ma));
      }
    }
    this.bodies.instanceMatrix.needsUpdate = true; this.arms.instanceMatrix.needsUpdate = true;
    _wv.set(0, 0.4, 0); this.G.localToWorld(_wv);
    this.env.decals.add(_wv.x, 0.42, _wv.z, 3.2, st === 'show' ? '#a8ff8a' : '#c87aff', 0.35 + (this.cur ? 0.3 * Math.sin(this.p * Math.PI) : 0), 0.4, 0);
  }
}
const _e = new THREE.Euler();
/** step arrows (canvas): l ←, r →, j ↑, c two palms */
function stepGlyph(c: CanvasRenderingContext2D, k: string, x: number, y: number, r: number): void {
  c.save(); c.translate(x, y); c.lineWidth = r * 0.22; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#1a0e2a'; c.fillStyle = '#1a0e2a';
  const arrow = (a: number) => { c.save(); c.rotate(a); c.beginPath(); c.moveTo(-r * 0.7, 0); c.lineTo(r * 0.6, 0); c.moveTo(r * 0.15, -r * 0.5); c.lineTo(r * 0.7, 0); c.lineTo(r * 0.15, r * 0.5); c.stroke(); c.restore(); };
  if (k === 'l') arrow(Math.PI); else if (k === 'r') arrow(0); else if (k === 'j') arrow(-Math.PI / 2);
  else if (k === 'c') { for (const sg of [-1, 1]) { c.save(); c.rotate(sg * 0.3); c.beginPath(); c.ellipse(sg * r * 0.3, r * 0.1, r * 0.22, r * 0.55, 0, 0, Math.PI * 2); c.fill(); c.restore(); } }
  else { c.font = `900 ${Math.round(r * 1.3)}px 'Golos Text','Nunito',sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#ffe27a'; c.fillText('?', 0, r * 0.06); }
  c.restore();
}
/** n cells; the first `shown` carry their step (arrow + word), `now` glows; the rest «?» */
function stepCells(c: CanvasRenderingContext2D, w: number, h: number, n: number, shown: string[], now: number): void {
  const gap = 10, cw = Math.min(150, (w - gap * (n + 1)) / n), x0 = (w - (cw * n + gap * (n - 1))) / 2, ch = h - 16;
  for (let i = 0; i < n; i++) {
    const x = x0 + i * (cw + gap), k = shown[i] || '', on = !!k;
    c.beginPath(); c.roundRect(x, 8, cw, ch, 18);
    c.fillStyle = i === now ? '#ffe27a' : on ? '#fff4d8' : 'rgba(24,16,44,.9)'; c.fill();
    c.lineWidth = 7; c.strokeStyle = i === now ? '#ff6a2a' : on ? '#4cc95a' : '#ffc94d'; c.stroke();
    stepGlyph(c, k, x + cw / 2, 8 + ch * (on ? 0.34 : 0.5), Math.min(cw, ch) * (on ? 0.26 : 0.32));
    if (on) { c.font = "900 38px 'Golos Text','Nunito',sans-serif"; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#1a0e2a'; c.fillText(STEP_WORD[k] || '?', x + cw / 2, 8 + ch * 0.82); }
  }
}

/* ------------------------------------------------------------------ the goblin fair («Ярмарка гоблинов»): shell / coin / hilo */

/** the coin on its post: local x (viewer's right of the goblin) and the height of its centre */
const COIN_X = -1.22, COIN_Y = 2.15;
/** the goblin stands on a crate behind the table: his face clears the cups */
const GOB_Y = 0.28;
/** hilo cards: either side of the goblin, big enough to read the value */
const CARD_X = 0.8, CARD_S = 1.3;
/** Coin face emblem (canvas, transparent outside): heads = a crown and «ОРЁЛ», tails = a big «1» and «РЕШКА». */
function coinFace(c: CanvasRenderingContext2D, f: 'h' | 't'): void {
  const W = 256, R = 124, ink = '#4a2200';
  c.beginPath(); c.arc(W / 2, W / 2, R, 0, Math.PI * 2); c.fillStyle = '#ffd25a'; c.fill();
  c.lineWidth = 10; c.strokeStyle = '#c8861a'; c.stroke();
  c.beginPath(); c.arc(W / 2, W / 2, R - 22, 0, Math.PI * 2); c.lineWidth = 4; c.strokeStyle = '#d8962a'; c.stroke();
  c.fillStyle = ink; c.textAlign = 'center'; c.textBaseline = 'middle';
  if (f === 'h') {
    // crown: band + five spikes with jewels
    c.beginPath(); c.moveTo(70, 132); c.lineTo(70, 82); c.lineTo(96, 108); c.lineTo(113, 70); c.lineTo(128, 102); c.lineTo(143, 70); c.lineTo(160, 108); c.lineTo(186, 82); c.lineTo(186, 132); c.closePath(); c.fill();
    c.fillRect(66, 136, 124, 18);
    c.fillStyle = '#e8404a'; for (const x of [96, 128, 160]) { c.beginPath(); c.arc(x, 145, 6, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = ink; c.font = "900 46px 'Golos Text','Nunito',sans-serif"; c.fillText('ОРЁЛ', W / 2, 192);
  } else {
    c.font = "900 112px 'Golos Text','Nunito',sans-serif"; c.fillText('1', W / 2, 108);
    c.font = "900 42px 'Golos Text','Nunito',sans-serif"; c.fillText('РЕШКА', W / 2, 192);
  }
}
/** a round slot badge (dark disc, gold ring, white digit) */
function slotBadge(c: CanvasRenderingContext2D, x: number, y: number, r: number, t: string): void {
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = 'rgba(24,16,44,.92)'; c.fill(); c.lineWidth = r * 0.16; c.strokeStyle = '#ffc94d'; c.stroke();
  c.font = `900 ${Math.round(r * 1.25)}px 'Golos Text','Nunito',sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#ffffff'; c.fillText(t, x, y + r * 0.06);
}

class GoblinFair extends EvBase implements SetPiece {
  party = { cx: -1.9, cz: 1.5, r: 1.8 };
  focus = { x: 2.6, y: 1.75, z: -0.8, d: 9.8, pitch: 0.18, yaw: -0.1, lock: true };
  private S: THREE.Group;
  private gob: THREE.Mesh;
  private hands: THREE.InstancedMesh;
  private sign: Label; private res: Label;
  private game: string;
  // shell
  private cups: THREE.InstancedMesh | null = null; private ball: THREE.Mesh | null = null;
  private at = [0, 1, 2];          // slot of cup i
  private swap: [number, number] | null = null; private sp = 0; private swapT = 0;
  // coin
  private coin: THREE.Mesh | null = null;
  // hilo
  private cards: THREE.InstancedMesh | null = null; private v1: Label | null = null; private v2: Label | null = null; private c1 = ''; private flip = 0;
  private hand = [0, 0, 0, 0];     // left x,z / right x,z targets (local)
  constructor(env: SetEnv, s: SceneState) {
    super(env, 'ev-goblin-' + (s.event?.game || 'shell'));
    this.game = s.event?.game || 'shell';
    this.S = this.group(2.8, 0, -1.4, FACE + 0.12, 1.3);
    this.ol(fairStallGeo(), 0, 0, 0, 0, 1, this.S);
    this.gob = this.ol(goblinGeo(), 0, 0, 0.75, 0, 1.05, this.S);
    this.hands = this.instIn(goblinHandGeo(), 2, this.S, false);
    if (this.game === 'coin') {
      // the coin stands on a little post at the viewer's right of the goblin (his face stays visible), its two faces carry a readable emblem
      // the post and its cradle: one merged mesh (one draw + its outline)
      const post = new GB().add(new THREE.CylinderGeometry(0.06, 0.1, 0.5, 8), '#8a6a42', T(0, 0, 0))
        .add(new THREE.TorusGeometry(0.2, 0.04, 4, 10, Math.PI), '#7a5436', T(0, 0.3, 0, 0, 0, Math.PI)).build();
      this.own.push(post);
      this.ol(post, COIN_X, 1.2, -0.2, 0, 1, this.S);
      this.coin = this.ol(bigCoinGeo(), COIN_X, COIN_Y, -0.2, 0, 1.2, this.S);
      const heads = this.canvasPlane(256, 256, 1.08, 1.08, (c) => coinFace(c, 'h'), true);
      heads.position.z = -0.075; heads.rotation.y = Math.PI; this.coin.add(heads);
      const tails = this.canvasPlane(256, 256, 1.08, 1.08, (c) => coinFace(c, 't'), true);
      tails.position.z = 0.075; this.coin.add(tails);
    }
    else if (this.game === 'hilo') {
      this.cards = this.instIn(playCardGeo(), 2, this.S);
      this.v1 = this.label('float', 160, 160, 0.62, true); this.v2 = this.label('float', 160, 160, 0.62, true);
      for (const v of [this.v1, this.v2]) { this.S.add(v.obj); v.obj.rotation.y = Math.PI; }
    } else {
      this.cups = this.instIn(shellCupGeo(), 3, this.S);
      this.ball = this.ol(ballGeo(), 0, 0.95, -0.15, 0, 1.9, this.S);
      // slot numbers: one plane on the table's front edge (one draw call, never hidden by a cup)
      const nums = this.canvasPlane(512, 128, 2.4, 0.6, (c, w, h) => { for (let i = 0; i < 3; i++) slotBadge(c, w / 2 + (i - 1) * (w * 0.72 / 2.4 * 1.0) * 1.0, h / 2, h * 0.42, String(i + 1)); });
      nums.position.set(0, 0.62, -0.64); nums.rotation.y = Math.PI; this.S.add(nums);
    }
    // the sign sits on the awning (inside the frame, under the top bar); the result word floats in front of the goblin
    this.sign = this.label('loot', 640, 192, 0.85); this.sign.obj.position.set(2.65, 4.7, -0.6);
    this.res = this.label('word', 512, 192, 0.8); this.res.obj.position.set(2.4, 3.45, 0.7); this.res.obj.visible = false;
    this.lamp('#ffe0a8', 2.0, 3.2, 0.6, 12, 10);
  }
  /** slot k (0-based) from the viewer's left: local +x is the viewer's left (the stall faces the camera) */
  private slotX(k: number): number { return (1 - k) * 0.72; }
  update(dt: number, t: number, s: SceneState): void {
    const E = s.event, st = E?.st || 'bet', k = this.stage(st, dt), shown = st === 'reveal' || st === 'next';
    // the structured public result (adapter event.res, from rv); the reveal line only as a fallback
    const R0 = E?.res, R = R0 ? { cup: R0.cup, face: R0.face, card: R0.card2 } : revealOf(this.game, E?.text || '');
    if (this.relabel) {
      const GN: Record<string, string> = { shell: '🥤 Напёрстки', coin: '🪙 Орёл или решка', hilo: '🃏 Больше или меньше' };
      const SN: Record<string, string> = { ask: 'сыграем?', bet: 'ставки', shuffle: 'гоблин крутит стаканы', guess: 'угадывайте!', reveal: 'итог игры', next: 'следующая игра', done: 'ярмарка закрыта' };
      this.sign.set(`${GN[this.game] || 'Ярмарка гоблинов'}`, SN[st] || st);
      const rt = !shown ? '' : this.game === 'shell' ? (R.cup ? `СТАКАН ${R.cup}` : '') : this.game === 'coin' ? (R.face === 'h' ? 'ОРЁЛ' : R.face === 't' ? 'РЕШКА' : '') : R.card ? `КАРТА ${R.card}` : '';
      this.res.set(rt, ''); this.res.obj.visible = !!rt;
      if (E?.card) this.c1 = E.card;
    }
    // goblin: sly sway; grins and bounces on the reveal
    this.gob.rotation.y = Math.sin(t * 1.3) * 0.12; this.gob.position.y = GOB_Y + (shown && k < 1.5 ? Math.abs(Math.sin(k * 9)) * 0.12 : Math.sin(t * 2) * 0.02);
    let lx = 0.6, lz = 0.25, rx = -0.6, rz = 0.25, ly = 1.15 + GOB_Y * 0.5, ry = 1.15 + GOB_Y * 0.5;
    if (this.cups && this.ball) {
      // shell: cups cross each other while shuffling, settle for the guess, the winner lifts on the reveal
      if (st === 'shuffle') {
        if (!this.swap) { const a = (Math.random() * 3) | 0, b = (a + 1 + ((Math.random() * 2) | 0)) % 3; this.swap = [a, b]; this.sp = 0; }
        this.sp += dt / 0.42;
        if (this.sp >= 1) { const [a, b] = this.swap; const ia = this.at.indexOf(a), ib = this.at.indexOf(b); this.at[ia] = b; this.at[ib] = a; this.swap = null; }
      } else if (this.swap) { const [a, b] = this.swap; const ia = this.at.indexOf(a), ib = this.at.indexOf(b); this.at[ia] = b; this.at[ib] = a; this.swap = null; }
      if (st === 'ask' || st === 'bet' || st === 'done') { this.at[0] = 0; this.at[1] = 1; this.at[2] = 2; }
      const win = shown && R.cup ? R.cup - 1 : -1;
      for (let i = 0; i < 3; i++) {
        let x = this.slotX(this.at[i]), z = -0.15, y = 0.95, tilt = 0;
        if (this.swap && (this.swap[0] === this.at[i] || this.swap[1] === this.at[i])) {
          const from = this.at[i], to = this.swap[0] === from ? this.swap[1] : this.swap[0], e = this.sp * this.sp * (3 - 2 * this.sp);
          x = this.slotX(from) + (this.slotX(to) - this.slotX(from)) * e; z = -0.15 + Math.sin(e * Math.PI) * (from < to ? -0.45 : 0.45); y += Math.sin(e * Math.PI) * 0.12;
          if (from < to) { lx = x; lz = z + 0.05; ly = 1.4; } else { rx = x; rz = z + 0.05; ry = 1.4; }
        }
        const lift = (st === 'bet' && this.at[i] === 1) ? 0.18 + Math.sin(t * 3) * 0.05 : (win >= 0 && this.at[i] === win) ? Math.min(0.5, k * 1.2) : 0;
        if (lift) tilt = 0.25 * Math.min(1, lift * 3);
        _o.position.set(x, y + lift, z); _o.rotation.set(tilt, 0, 0); _o.scale.setScalar(1.3); _o.updateMatrix(); this.cups.setMatrixAt(i, _o.matrix);
      }
      this.cups.instanceMatrix.needsUpdate = true;
      const bslot = st === 'bet' ? 1 : win;
      this.ball.visible = bslot >= 0 && (st === 'bet' || shown);
      if (this.ball.visible) { this.ball.position.set(this.slotX(bslot), 0.95, -0.15); if (shown) { _wv.set(this.slotX(bslot), 0.96, -0.15); this.S.localToWorld(_wv); this.env.decals.add(_wv.x, _wv.y, _wv.z, 0.5, '#ffe27a', 0.6 + 0.3 * Math.sin(t * 6), 0.5, 0); } }
      if (shown && win >= 0 && k < 1.5 && this.fxOk(dt, 0.06)) { _wv.set(this.slotX(win), 1.3, -0.15); this.S.localToWorld(_wv); const fx = this.env.fx; fx.emit(1, _wv.x, _wv.y, _wv.z, (fx.rnd() - 0.5) * 2, 2, (fx.rnd() - 0.5) * 2, 0.9, 0.14, 0.04, 1, 0.85, 0.3, 1, -4, 0.3, false, fx.rnd() * 6, 4); }
    } else if (this.coin) {
      // coin: spins on its edge while betting, stands still for the guess, flips up and settles face-on for the reveal
      const c = this.coin;
      if (shown && R.face) {
        const f = Math.min(1, k / 1.3), up = Math.sin(f * Math.PI) * 1.2;
        c.position.y = COIN_Y + up; c.rotation.x = (1 - f) * 14; c.rotation.y = R.face === 't' ? Math.PI : 0;
        if (f >= 1 && k < 1.6 && this.fxOk(dt, 0.04)) { _wv.set(COIN_X, COIN_Y, -0.15); this.S.localToWorld(_wv); const fx = this.env.fx; fx.emit(1, _wv.x, _wv.y, _wv.z, (fx.rnd() - 0.5) * 2.4, 1.8, (fx.rnd() - 0.5) * 2.4, 0.9, 0.16, 0.04, 1, 0.85, 0.3, 1, -4, 0.3, false, fx.rnd() * 6, 4); }
      } else if (st === 'guess') { c.position.y = COIN_Y + Math.sin(t * 2) * 0.03; c.rotation.x = 0; c.rotation.y = Math.sin(t * 0.8) * 0.22; }
      else { c.position.y = COIN_Y; c.rotation.x = 0; c.rotation.y += dt * (st === 'bet' ? 2.5 : 0.8); }
      lx = 0.45; ly = 1.2; rx = COIN_X + 0.42; ry = 1.25 + (shown ? Math.max(0, 0.4 - k) : 0); rz = -0.05;
    } else if (this.cards && this.v1 && this.v2) {
      // hilo: two cards on stands; the first shows in the guess, the second flips on the reveal
      const showFirst = (st === 'guess' || shown) && !!this.c1;
      this.flip += ((shown ? 1 : 0) - this.flip) * Math.min(1, dt * 3);
      for (let i = 0; i < 2; i++) {
        const face = i === 0 ? (showFirst ? 1 : 0) : this.flip;
        _o.position.set(i === 0 ? CARD_X : -CARD_X, 0.95 + (i === 1 ? Math.sin(this.flip * Math.PI) * 0.3 : 0), -0.1); _o.rotation.set(-0.12, Math.PI * (1 - face), 0); _o.scale.setScalar(CARD_S); _o.updateMatrix();
        this.cards.setMatrixAt(i, _o.matrix);
      }
      this.cards.instanceMatrix.needsUpdate = true;
      this.v1.obj.position.set(CARD_X, 0.95 + 0.5 * CARD_S, -0.38); this.v1.obj.visible = showFirst; if (this.relabel) this.v1.set(this.c1 || '?', '', '#e8344a');
      this.v2.obj.position.set(-CARD_X, 0.95 + 0.5 * CARD_S + Math.sin(this.flip * Math.PI) * 0.3, -0.38); this.v2.obj.visible = this.flip > 0.6; if (this.relabel) this.v2.set(R.card || '?', '', '#e8344a');
      lx = CARD_X + 0.42; rx = -CARD_X - 0.42;
    }
    // hands (local; idle wiggle unless they ride a cup)
    _o.rotation.set(0, 0, 0); _o.scale.setScalar(1);
    _o.position.set(lx, ly + Math.sin(t * 4) * 0.03, lz); _o.updateMatrix(); this.hands.setMatrixAt(0, _o.matrix);
    _o.position.set(rx, ry + Math.sin(t * 4 + 1) * 0.03, rz); _o.updateMatrix(); this.hands.setMatrixAt(1, _o.matrix);
    this.hands.instanceMatrix.needsUpdate = true;
    void this.hand;
    _wv.set(0, 0, -0.9); this.S.localToWorld(_wv);
    this.env.decals.add(_wv.x, 0.01, _wv.z, 2.6, '#ffe0a8', 0.3, 1, 0);
  }
}

/* ------------------------------------------------------------------ routing */

/** The 28.10 event looks with their own set (null → the generic Event set). */
function eventSet(env: SetEnv, s: SceneState): SetPiece | null {
  switch (s.event?.look) {
    case 'trick': return new TrickDoor(env);
    case 'fortune': return new FortuneTent(env);
    case 'cauldron': return new Cauldron(env);
    case 'lostghost': return new LostGhost(env);
    case 'skeldance': return new SkelDance(env);
    case 'goblin': return new GoblinFair(env, s);
    default: return null;
  }
}
/** Puzzle kinds with their own set (runes / cups / scales keep the tablet set). */
function puzzleSet(env: SetEnv, s: SceneState): SetPiece | null {
  switch (s.puzzle?.kind) {
    case 'riddle': return new RiddleStone(env);
    case 'count': return new CountMeadow(env);
    case 'changed': return new ChangedShelf(env, s);
    case 'letter': return new LetterBlock(env, s);
    default: return null;
  }
}

/** One instanced draw of soft contact shadows under the big static meshes of a set (stalls, tents, gates, wagons…). */
function withContactShadows(env: SetEnv, p: SetPiece): SetPiece {
  p.root.updateMatrixWorld(true);
  const items: number[] = [], box = new THREE.Box3(), sz = new THREE.Vector3(), c = new THREE.Vector3();
  p.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || !m.visible || items.length >= 6 * 22) return;
    if (m.material !== env.mats.tint || !m.geometry.attributes.aTint) return;
    box.setFromObject(m); box.getSize(sz); box.getCenter(c);
    if (box.min.y > 0.5 || sz.x < 0.7 || sz.z < 0.7 || sz.x > 14 || sz.z > 14) return;
    const r = Math.max(sz.x, sz.z) * 0.5;
    items.push(c.x + r * 0.3, 0.03, c.z - r * 0.2, r * 0.95 + 0.25, r * 0.8 + 0.2, 0.5);
  });
  if (items.length) { const im = blobShadowMesh(env.mats.decal, items); p.root.add(im); const d = p.dispose.bind(p); p.dispose = () => { im.geometry.dispose(); im.dispose(); d(); }; }
  return p;
}
export function buildSet(env: SetEnv, s: SceneState): SetPiece { return withContactShadows(env, buildSet0(env, s)); }
function buildSet0(env: SetEnv, s: SceneState): SetPiece {
  switch (s.kind) {
    case 'gather': return new Camp(env, 'gather', s.title);
    case 'rest': return new Camp(env, 'rest', s.title);
    case 'town': return new Camp(env, 'town', s.town?.name || s.title);
    case 'vote': return new Crossroads(env, s);
    case 'treasure': return new RuneDoor(env, s);
    case 'trap': return s.trap?.type === 'code' ? new RuneDoor(env, s) : new Trap(env, s.trap?.type || 'react', s);
    case 'shop': return new Shop(env, s);
    case 'event': return eventSet(env, s) || new Event(env, s.event?.look || 'traveler', s);
    case 'puzzle': return puzzleSet(env, s) || new Puzzle(env, s.puzzle?.kind || 'riddle');
    case 'dungeon': return new Dungeon(env, s);
    case 'lair': return new Lair(env, s);
    case 'loot': return new Loot(env, s);
    default: return new Empty(env);
  }
}
export { Crossroads };
