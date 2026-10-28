/**
 * Set pieces per stage (vignettes): the campfire camp at the city gate, the crossroads with signposts, the rune door,
 * traps, the shop stall, events, the dungeon doors, the islands of the lair, the loot pedestal. Each set owns its
 * meshes and labels (disposed with it) and animates from the SceneState it gets every frame. Small: ≤ ~25 draw calls.
 */
import * as THREE from 'three';
import type { SceneState } from './adapter';
import { plural } from './adapter';
import type { ExpMats } from './mats';
import type { Fx } from '../combat/fx';
import type { Decals } from './foes';
import { Label } from './text';
import { propGeo, hullGeo, GB } from './art';
const propCliff = () => propGeo('cliff', 2);
/** Plain primitive with a wood vertex colour (the cel material is vertex-coloured: no colour = black). */
const wood = (g: THREE.BufferGeometry, c = '#8a6a42') => new GB().add(g, c).build();
import {
  campfireGeo, flameGeo, signpostGeo, flagGeo, gateGeo, bannerGeo, tentGeo, chestGeo, lidGeo, runeDoorGeo, doorSlabGeo, platformGeo,
  stallGeo, wellGeo, altarGeo, tableGeo, d20Geo, cartGeo, ropeGeo, logGeo, spikeSlabGeo, pedestalGeo, itemGeo, markerGeo, bossGeo, RARITY_COL,
} from './art';

export interface SetEnv {
  mats: ExpMats; fx: Fx; decals: Decals;
  /** whole seconds left of a server window as on the stream */
  secLeft(until: number): number;
  /** add a spoken float text */
  float(text: string, color: string, x: number, y: number, z: number, size?: number): void;
}
export interface SetPiece {
  readonly root: THREE.Group;
  /** where the party stands (centre + radius) and where new cats come from */
  party: { cx: number; cz: number; r: number; face?: number; enter?: { x: number; z: number }; arc?: number };
  /** camera focus */
  focus: { x: number; y: number; z: number; d: number; pitch: number; yaw: number };
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
      this.banner.set(s.hw ? '🎃 СБОР У ПОРТАЛА' : 'СБОР ОТРЯДА', `${s.n} ${plural(s.n, 'котик', 'котика', 'котиков')}${s.until ? ' · ' + mmss(sec) : ''}`);
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
    this.lid.rotation.x = -this.openK * 1.9;
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

export function buildSet(env: SetEnv, s: SceneState): SetPiece {
  switch (s.kind) {
    case 'gather': return new Camp(env, 'gather', s.title);
    case 'rest': return new Camp(env, 'rest', s.title);
    case 'town': return new Camp(env, 'town', s.town?.name || s.title);
    case 'vote': return new Crossroads(env, s);
    case 'treasure': return new RuneDoor(env, s);
    case 'trap': return s.trap?.type === 'code' ? new RuneDoor(env, s) : new Trap(env, s.trap?.type || 'react', s);
    case 'shop': return new Shop(env, s);
    case 'event': return new Event(env, s.event?.look || 'traveler', s);
    case 'dungeon': return new Dungeon(env, s);
    case 'lair': return new Lair(env, s);
    case 'loot': return new Loot(env, s);
    default: return new Empty(env);
  }
}
export { Crossroads };
