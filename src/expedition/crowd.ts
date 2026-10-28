/**
 * The party in 3D: up to `detail` real avatars (src/avatar: me first, then the party order) and every other cat as an
 * instanced chibi cat (5 variants by class × body + outline = ≤ 10 draw calls for any number). Actors keep their
 * identity by login across stages, so on a stage change they walk to their new spots instead of popping.
 * update() never allocates.
 */
import * as THREE from 'three';
import type { Appearance } from '../contracts';
import type { Avatar, AvatarKit } from '../contracts/modules';
import { nickDefaults, appearanceFrom } from '../avatar';
import { catGeo, catGeoLow, catHullGeo, CAT_VARIANTS, catVariant, type CatVariant } from './art';
import type { ExpMats } from './mats';
import type { Member } from './adapter';
import type { Spot } from './layout';
import { Label } from './text';

export type Act = 'idle' | 'attack' | 'shoot' | 'cast' | 'heal' | 'cheer' | 'down' | 'hurt' | 'block' | 'sit' | 'wave';
export interface Actor {
  m: Member;
  av: Avatar | null;
  v: number; k: number;               // instanced: variant, slot (−1 when detailed)
  x: number; z: number; face: number; // current
  tx: number; tz: number; tface: number;
  speed: number;
  act: Act; actT: number; actLen: number; loop: Act;   // loop = pose kept when the act ends (cheer, down, sit)
  ph: number;
  col: THREE.Color;
  label: Label | null;
  flash: number;
  y: number;
  /** dash offset of a melee attack (to the foe and back) */
  dx: number; dz: number;
}

const CAP = 64;
/** more instanced cats than this → the light LOD (the crowd camera is far anyway) */
const COARSE_FROM = 20;
const GEAR: Record<string, Record<string, string>> = {
  legionary: { w: 'gladius', s: 'scutum', a: 'lorica', am: 'heavy' }, paladin: { w: 'holymace', s: 'round', a: 'plate', am: 'heavy' },
  rogue: { w: 'dagger', a: 'leather', am: 'light' }, recruit: { w: 'club' }, archer: { w: 'bow', a: 'leather', am: 'light' },
  mage: { w: 'staff', a: 'robe', am: 'cloth' }, necromancer: { w: 'skullstaff', a: 'shroud', am: 'cloth' }, priest: { w: 'censer', a: 'robe', am: 'cloth' },
};
export const gearFor = (role: string) => GEAR[role] || GEAR.recruit;

export interface CrowdOpts {
  kit: AvatarKit | null;
  detail: number;
  /** real appearance of a login (store walkers / me), or null → generated from the login */
  appOf(login: string): Appearance | null;
  style: string;
}

export class Crowd {
  readonly root = new THREE.Group();
  readonly actors: Actor[] = [];
  private byLogin = new Map<string, Actor>();
  private inst: THREE.InstancedMesh[] = [];
  private outl: THREE.InstancedMesh[] = [];
  private free: number[][] = [];
  private dirty = true;
  private coarse = false;
  private _m = new THREE.Matrix4(); private _q = new THREE.Quaternion(); private _e = new THREE.Euler(0, 0, 0, 'YXZ'); private _p = new THREE.Vector3(); private _s = new THREE.Vector3();
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  /** shared state for all actors: walking speed of the whole column (travel) */
  march = 0;
  /** show the names of the others (off in battles: only mine) */
  names = true;
  /** how many nameplates at most (detailed avatars + the first instanced cats in party order; 1 draw call each) */
  labelCap = 24;
  /** camera position (set by the scene each frame): far nameplates grow so they stay readable on wide battle shots */
  readonly camPos = new THREE.Vector3(0, 6, 12);

  constructor(private mats: ExpMats, private o: CrowdOpts) {
    this.root.name = 'exp-crowd';
    CAT_VARIANTS.forEach((v, i) => {
      const g = catGeo(v);
      const im = new THREE.InstancedMesh(g, mats.tint, CAP);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3).fill(1), 3);
      im.count = 0; im.frustumCulled = false; im.name = 'exp-cats-' + v;
      const ol = new THREE.InstancedMesh(catHullGeo(), mats.outline, CAP);
      ol.instanceMatrix = im.instanceMatrix; ol.count = 0; ol.frustumCulled = false; ol.name = 'exp-cats-ol-' + v;
      for (let k = 0; k < CAP; k++) im.setMatrixAt(k, this.hidden);
      this.inst.push(im); this.outl.push(ol); this.free.push(Array.from({ length: CAP }, (_, k) => CAP - 1 - k));
      this.root.add(im, ol);
      void i;
    });
  }

  get(login: string): Actor | undefined { return this.byLogin.get(login); }
  get me(): Actor | undefined { for (const a of this.actors) if (a.m.me) return a; return undefined; }

  /**
   * Reconcile the party: keep actors that stay (they walk to the new spots), add new ones at `enter` (or at their spot),
   * drop the rest. `instant` puts everybody on the spot at once.
   */
  setParty(list: readonly Member[], spots: readonly Spot[], o: { instant?: boolean; enter?: { x: number; z: number; spread?: number } } = {}): void {
    const want = new Set<string>();
    for (const m of list) want.add(m.login);
    for (let i = this.actors.length - 1; i >= 0; i--) { const a = this.actors[i]; if (!want.has(a.m.login)) { this.drop(a); this.actors.splice(i, 1); this.byLogin.delete(a.m.login); } }
    // who gets a detailed avatar: me + the first ones in order
    const detailed = new Set<string>();
    const meM = list.find((m) => m.me);
    if (meM) detailed.add(meM.login);
    const cap = list.length > 16 ? Math.min(this.o.detail, 6) : this.o.detail;
    for (const m of list) { if (detailed.size >= cap) break; detailed.add(m.login); }
    const next: Actor[] = [];
    list.forEach((m, i) => {
      const s = spots[i] || { x: 0, z: 0, face: 0 };
      let a = this.byLogin.get(m.login);
      const wantAv = detailed.has(m.login) && !!this.o.kit;
      if (a && (!!a.av !== wantAv || (a.k >= 0 && CAT_VARIANTS[a.v] !== catVariant(m.role)))) { this.drop(a); this.byLogin.delete(m.login); a = undefined; }
      if (!a) {
        const e = o.enter;
        const sx = o.instant || !e ? s.x : e.x + (Math.random() - 0.5) * (e.spread ?? 1.5), sz = o.instant || !e ? s.z : e.z + (Math.random() - 0.5) * (e.spread ?? 1.5);
        a = this.make(m, wantAv, sx, sz, s.face);
        this.byLogin.set(m.login, a);
      }
      a.m = m;
      if (a.av) a.av.setLod(m.me || (i < 2 && list.length <= 16) ? 0 : 1);
      a.tx = s.x; a.tz = s.z; a.tface = s.face;
      if (o.instant) { a.x = s.x; a.z = s.z; a.face = s.face; }
      // nameplates: detailed avatars always have one; instanced cats get one while under the cap (party order)
      if (!a.label && (m.me || i < this.labelCap)) { a.label = new Label(m.me ? 'me' : 'name', 384, 80, m.me ? 0.32 : 0.22); this.root.add(a.label.obj); }
      else if (a.label && !a.av && !m.me && i >= this.labelCap) { a.label.dispose(); a.label = null; }
      const nm = short(m.name || m.login);
      if (a.label) a.label.set(m.me ? `ТЫ · ${nm}` : nm);
      next.push(a);
    });
    this.actors.length = 0; this.actors.push(...next);
    this.dirty = true;
  }

  private make(m: Member, detailed: boolean, x: number, z: number, face: number): Actor {
    const nd = nickDefaults(m.login, (this.o.style || 'cats') as any);
    const col = new THREE.Color(nd.color || '#f2a65a');
    const a: Actor = { m, av: null, v: 0, k: -1, x, z, face, tx: x, tz: z, tface: face, speed: 0, act: 'idle', actT: 0, actLen: 0, loop: 'idle', ph: Math.random() * 6.28, col, label: null, flash: 0, y: 0, dx: 0, dz: 0 };
    if (detailed && this.o.kit) {
      let app = this.o.appOf(m.login);
      if (!app) app = appearanceFrom(m.login, { n: m.name, g: gearFor(m.role), role: m.role }, (this.o.style || 'cats') as any);
      try { a.av = this.o.kit.create(app); this.root.add(a.av.root); } catch (e) { console.warn('[l3d] expedition avatar', e); a.av = null; }
      if (a.av) {
        a.label = new Label(m.me ? 'me' : 'name', 384, 80, m.me ? 0.32 : 0.22);
        this.root.add(a.label.obj);
      }
    }
    if (!a.av) {
      a.v = Math.max(0, CAT_VARIANTS.indexOf(catVariant(m.role) as CatVariant));
      const k = this.free[a.v].pop();
      a.k = k ?? -1;
      if (a.k >= 0) this.inst[a.v].setColorAt(a.k, col);
      if (this.inst[a.v].instanceColor) this.inst[a.v].instanceColor!.needsUpdate = true;
    }
    return a;
  }
  private drop(a: Actor) {
    if (a.av) { a.av.root.removeFromParent(); try { a.av.dispose(); } catch { /* */ } a.av = null; }
    if (a.label) { a.label.dispose(); a.label = null; }
    if (a.k >= 0) { this.inst[a.v].setMatrixAt(a.k, this.hidden); this.free[a.v].push(a.k); a.k = -1; }
  }

  /** Start an act; `len` seconds (0 = default); loop pose = what stays after (cheer/down/sit keep going). */
  play(a: Actor, act: Act, len = 0, loop?: Act, toX?: number, toZ?: number): void {
    a.act = act; a.actT = 0; a.actLen = len || DEF_LEN[act]; if (loop) a.loop = loop;
    a.dx = 0; a.dz = 0;
    if (act === 'attack' && toX != null && toZ != null) {
      const dx = toX - a.x, dz = toZ - a.z, d = Math.hypot(dx, dz), go = Math.max(0, Math.min(6, d - 1.25));
      if (d > 0.01) { a.dx = (dx / d) * go; a.dz = (dz / d) * go; }
    }
    const av = a.av as (Avatar & { setDraw?(k: number): void; setFlash?(k: number): void }) | null;
    if (!av) return;
    if (act === 'attack') av.play('swing');
    else if (act === 'cast' || act === 'heal') av.play('cast');
    else if (act === 'cheer') av.play('cheer');
    else if (act === 'wave') av.play('wave');
    else if (act === 'hurt') { a.flash = 1; }
  }
  setLoop(a: Actor, loop: Act): void { a.loop = loop; if (a.act === 'idle' || a.act === a.loop) { a.act = loop; a.actT = a.ph * 0.2; a.actLen = DEF_LEN[loop]; } }
  setLoopAll(loop: Act): void { for (const a of this.actors) this.setLoop(a, loop); }

  /** Head-top world point of an actor (for fx). */
  head(a: Actor, out: THREE.Vector3): THREE.Vector3 { return out.set(a.x, (a.av ? a.av.headTop : 1.15) + a.y, a.z); }

  update(dt: number, t: number): void {
    const step = 3.2 * dt;
    let used = 0;
    for (const a of this.actors) {
      // walk to the target
      const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz);
      let moving = 0;
      if (d > 0.02) {
        const s = Math.min(d, step * (d > 4 ? 1.6 : 1));
        a.x += (dx / d) * s; a.z += (dz / d) * s; moving = d > 0.15 ? 1 : 0;
        if (d > 0.4) a.face = turn(a.face, Math.atan2(-dx, -dz), dt * 10);
        else a.face = turn(a.face, a.tface, dt * 6);
      } else a.face = turn(a.face, a.tface, dt * 6);
      const walk = Math.max(moving, this.march);
      a.speed += (walk - a.speed) * Math.min(1, dt * 8);
      // act timeline
      if (a.act !== a.loop) { a.actT += dt; if (a.actT >= a.actLen) { a.act = a.loop; a.actT = 0; a.actLen = DEF_LEN[a.loop]; } }
      else {
        a.actT += dt;
        // looping emotes of the real avatars (cheer / wave) restart now and then
        if ((a.act === 'cheer' || a.act === 'wave') && a.av && a.actT >= a.actLen) { a.actT = 0; a.av.play(a.act); }
      }
      if (a.flash > 0) a.flash = Math.max(0, a.flash - dt * 4);
      // pose
      const k = a.actLen > 0 ? Math.min(1, a.actT / a.actLen) : 0;
      let ox = 0, oz = 0, y = 0, pitch = 0, roll = 0, sy = 1;
      const fx = -Math.sin(a.face), fz = -Math.cos(a.face);
      switch (a.act) {
        case 'attack': {
          if (a.dx || a.dz) { const e = Math.sin(Math.PI * k); ox = a.dx * e; oz = a.dz * e; y = Math.sin(Math.PI * Math.min(1, k * 2)) * 0.35 * (k < 0.5 ? 1 : 0); pitch = -0.4 * Math.sin(Math.PI * Math.min(1, k * 2)); }
          else { const l = Math.sin(Math.PI * Math.min(1, k * 1.25)) * 0.75; ox = fx * l; oz = fz * l; pitch = -0.35 * Math.sin(Math.PI * k); }
          break;
        }
        case 'shoot': case 'cast': case 'heal': { const l = -Math.sin(Math.PI * k) * 0.12; ox = fx * l; oz = fz * l; y = Math.sin(Math.PI * k) * 0.12; break; }
        case 'hurt': { const l = -Math.sin(Math.PI * k) * 0.35; ox = fx * l; oz = fz * l; sy = 1 - 0.15 * Math.sin(Math.PI * k); break; }
        case 'block': { sy = 1 - 0.1 * Math.sin(Math.PI * k); pitch = 0.15 * Math.sin(Math.PI * k); break; }
        case 'cheer': y = Math.abs(Math.sin(t * 9 + a.ph)) * 0.32; break;
        case 'wave': y = Math.abs(Math.sin(t * 6 + a.ph)) * 0.08; break;
        case 'down': pitch = Math.min(1, a.actT * 3) * (Math.PI / 2 - 0.15); y = 0.12 * Math.min(1, a.actT * 3); break;
        case 'sit': sy = 0.86; y = -0.04; break;
        default: break;
      }
      if (a.speed > 0.05 && a.act !== 'down') { y += Math.abs(Math.sin(t * 10 + a.ph)) * 0.07 * a.speed; roll = Math.sin(t * 10 + a.ph) * 0.07 * a.speed; }
      else if (a.act === 'idle' || a.act === 'sit') y += Math.sin(t * 2.2 + a.ph) * 0.012;
      a.y = y;
      if (a.av) {
        const r = a.av.root;
        r.position.set(a.x + ox, y, a.z + oz);
        r.rotation.set(a.act === 'down' ? -pitch : pitch * 0.5, a.face, roll, 'YXZ');
        r.scale.set(1, sy, 1);
        const av = a.av as Avatar & { setDraw?(k: number): void; setFlash?(k: number): void };
        if (av.setDraw) av.setDraw(a.act === 'shoot' ? (k < 0.7 ? k / 0.7 : 0) : 0);
        if (av.setFlash) av.setFlash(a.flash * 0.8);
        av.update(dt, t, a.speed);
        if (a.label) { a.label.obj.position.set(a.x + ox, a.av.headTop + 0.42 + y, a.z + oz); this.fitLabel(a.label); a.label.obj.visible = a.act !== 'down' && (a.m.me || this.names); }
      } else if (a.k >= 0) {
        this._e.set(a.act === 'down' ? -pitch : pitch, a.face, roll, 'YXZ');
        this._q.setFromEuler(this._e);
        this._p.set(a.x + ox, y + (a.act === 'down' ? 0.25 : 0), a.z + oz);
        this._s.set(1, sy, 1);
        this._m.compose(this._p, this._q, this._s);
        this.inst[a.v].setMatrixAt(a.k, this._m);
        used++;
        if (a.label) { a.label.obj.position.set(a.x + ox, y + 1.3, a.z + oz); this.fitLabel(a.label); a.label.obj.visible = a.act !== 'down' && (a.m.me || this.names); }
      }
    }
    // crowd LOD: many instanced cats → the light model without outlines
    const coarse = used > COARSE_FROM;
    if (coarse !== this.coarse) {
      this.coarse = coarse;
      CAT_VARIANTS.forEach((v, i) => { this.inst[i].geometry = coarse ? catGeoLow(v) : catGeo(v); });
    }
    for (let v = 0; v < this.inst.length; v++) {
      const im = this.inst[v];
      // count = highest used slot + 1 (slots are reused from the top of the free list)
      let hi = 0; for (const a of this.actors) if (a.k >= 0 && a.v === v) hi = Math.max(hi, a.k + 1);
      im.count = hi; this.outl[v].count = hi; im.visible = hi > 0; this.outl[v].visible = hi > 0 && !coarse;
      im.instanceMatrix.needsUpdate = true;
      if (this.dirty && im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    this.dirty = false;
  }

  /** Detailed avatars' draw calls (tests/perf). */
  /** keep a nameplate at least ~the size it has at 6 m from the camera (sprites shrink with distance) */
  private fitLabel(l: Label) {
    const d = l.obj.position.distanceTo(this.camPos), k = Math.max(1, Math.min(2.6, d / 6));
    l.obj.scale.set(l.height * (l.w / l.h) * k, l.height * k, 1);
  }
  get detailedCount(): number { let n = 0; for (const a of this.actors) if (a.av) n++; return n; }

  clear(): void { for (const a of this.actors) this.drop(a); this.actors.length = 0; this.byLogin.clear(); this.dirty = true; }

  dispose(): void {
    this.clear();
    for (const im of this.inst) im.dispose();
    for (const ol of this.outl) ol.dispose();
    this.inst = []; this.outl = [];
    this.root.removeFromParent();
  }
}

const DEF_LEN: Record<Act, number> = { idle: 1, attack: 0.55, shoot: 0.8, cast: 0.75, heal: 0.75, cheer: 1.4, down: 1, hurt: 0.4, block: 0.45, sit: 1, wave: 1.6 };
const short = (s: string) => (s.length > 16 ? s.slice(0, 15) + '…' : s);
function turn(a: number, b: number, k: number): number {
  let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, k);
}
