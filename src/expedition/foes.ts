/**
 * Enemies (instanced per art: body + outline, leader crowns), the boss, hp bars (one billboard instanced draw),
 * ground decals (zone tints, my ring, wounded glows, platforms highlight — one instanced draw) and projectiles
 * (arrows instanced; orbs are fx particles). update() never allocates.
 */
import * as THREE from 'three';
import { foeGeo, crownGeo, bossGeo, arrowGeo, hullGeo, FOE_TOP, FOE_FLY, FOE_R, FOE_HEAD_Z } from './art';
import { FOE_ARTS, hasLeadArt, type FoeArt, type FoeState } from './adapter';
import type { ExpMats } from './mats';
import type { Spot } from './layout';
import type { Fx } from '../combat/fx';

const CAP = 24;

export interface FoeActor {
  f: FoeState; a: number; k: number;
  x: number; z: number; face: number; hx: number; hz: number; hface: number;
  act: 'idle' | 'lunge' | 'hurt' | 'windup' | 'flee' | 'enter';
  actT: number; actLen: number; tx: number; tz: number;
  hp: number; shown: number; dead: boolean; deadT: number; flash: number; ph: number; sc: number;
  y: number;
}

export class Foes {
  readonly root = new THREE.Group();
  readonly list: FoeActor[] = [];
  /** Per art, created on first use (60 arts: only the ones a battle shows are built). */
  private inst: (THREE.InstancedMesh | null)[] = new Array(FOE_ARTS.length).fill(null);
  private outl: (THREE.InstancedMesh | null)[] = new Array(FOE_ARTS.length).fill(null);
  private crowns: THREE.InstancedMesh;
  private counts = new Int32Array(FOE_ARTS.length);
  private _m = new THREE.Matrix4(); private _q = new THREE.Quaternion(); private _e = new THREE.Euler(0, 0, 0, 'YXZ'); private _p = new THREE.Vector3(); private _s = new THREE.Vector3(); private _c = new THREE.Color();
  constructor(private mats: ExpMats) {
    this.root.name = 'exp-foes';
    this.crowns = new THREE.InstancedMesh(crownGeo(), mats.tint, 8);
    this.crowns.count = 0; this.crowns.frustumCulled = false; this.crowns.visible = false;
    this.root.add(this.crowns);
  }

  private ensure(a: number): THREE.InstancedMesh {
    let im = this.inst[a];
    if (im) return im;
    const art = FOE_ARTS[a], g = foeGeo(art);
    im = new THREE.InstancedMesh(g, this.mats.tint, CAP);
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3).fill(1), 3);
    im.count = 0; im.visible = false; im.frustumCulled = false; im.name = 'exp-foe-' + art;
    const ol = new THREE.InstancedMesh(hullGeo(g), this.mats.outline, CAP);
    ol.instanceMatrix = im.instanceMatrix; ol.count = 0; ol.visible = false; ol.frustumCulled = false;
    this.inst[a] = im; this.outl[a] = ol; this.root.add(im, ol);
    return im;
  }

  /** Reconcile with the battle's foes (by index; the type may change between battles). `enter`: walk in from afar. */
  set(foes: readonly FoeState[], spots: readonly Spot[], enter: boolean): void {
    const n = foes.length;
    while (this.list.length > n) this.list.pop();
    const used: number[] = new Array(FOE_ARTS.length).fill(0);
    for (let i = 0; i < n; i++) {
      const f = foes[i], s = spots[i], a = Math.max(0, FOE_ARTS.indexOf(f.art));
      let A = this.list[i];
      const fresh = !A || A.a !== a;
      if (fresh) {
        const away = enter ? 10 : 0, dx = -Math.sin(s.face), dz = -Math.cos(s.face);
        A = { f, a, k: 0, x: s.x - dx * away, z: s.z - dz * away, face: s.face, hx: s.x, hz: s.z, hface: s.face, act: enter ? 'enter' : 'idle', actT: 0, actLen: 1,
          tx: s.x, tz: s.z, hp: f.hp, shown: f.hp, dead: f.dead, deadT: f.dead ? 5 : 0, flash: 0, ph: i * 1.7, sc: f.lead ? 1.3 : 1, y: 0 };
        this.list[i] = A;
      }
      A.f = f; A.hx = s.x; A.hz = s.z; A.hface = s.face; A.sc = f.lead ? 1.3 : 1;
      if (A.act === 'idle' || A.act === 'enter') { A.tx = s.x; A.tz = s.z; }
      A.k = used[a]++;
      this.ensure(a);
      if (f.dead && !A.dead) { A.dead = true; A.deadT = 0; }
      if (!f.dead && A.dead) { A.dead = false; A.deadT = 0; }
      A.hp = f.hp;
    }
  }
  clear(): void { this.list.length = 0; }

  top(A: FoeActor): number { return FOE_TOP[FOE_ARTS[A.a]] * A.sc + FOE_FLY[FOE_ARTS[A.a]]; }
  radius(A: FoeActor): number { return FOE_R[FOE_ARTS[A.a]] * A.sc; }
  art(A: FoeActor): FoeArt { return FOE_ARTS[A.a]; }

  lunge(A: FoeActor, x: number, z: number, len = 0.9): void { if (A.dead) return; A.act = 'lunge'; A.actT = 0; A.actLen = len; A.tx = x; A.tz = z; }
  hurt(A: FoeActor): void { A.flash = 1; if (A.act === 'idle') { A.act = 'hurt'; A.actT = 0; A.actLen = 0.35; } }
  windup(A: FoeActor, on: boolean): void { if (A.dead) return; if (on) { A.act = 'windup'; A.actT = 0; A.actLen = 99; } else if (A.act === 'windup') A.act = 'idle'; }
  flee(): void { for (const A of this.list) if (!A.dead) { A.act = 'flee'; A.actT = 0; A.actLen = 99; } }

  update(dt: number, t: number): void {
    const counts = this.counts; counts.fill(0);
    let crowns = 0;
    for (const A of this.list) {
      A.actT += dt;
      if (A.flash > 0) A.flash = Math.max(0, A.flash - dt * 4);
      A.shown += (A.hp - A.shown) * Math.min(1, dt * 4);
      let ox = 0, oz = 0, y = 0, pitch = 0, sy = 1, roll = 0;
      const fly = FOE_FLY[FOE_ARTS[A.a]];
      switch (A.act) {
        case 'enter': {
          const dx = A.hx - A.x, dz = A.hz - A.z, d = Math.hypot(dx, dz);
          if (d < 0.05) { A.act = 'idle'; break; }
          const s = Math.min(d, dt * 6); A.x += dx / d * s; A.z += dz / d * s;
          y = Math.abs(Math.sin(t * 12 + A.ph)) * 0.12; break;
        }
        case 'lunge': {
          const k = Math.min(1, A.actT / A.actLen), e = Math.sin(Math.PI * k);
          ox = (A.tx - A.hx) * e * 0.85; oz = (A.tz - A.hz) * e * 0.85; pitch = -0.3 * e; y = e * (fly ? 0.3 : 0.25);
          if (k >= 1) A.act = 'idle';
          break;
        }
        case 'hurt': { const k = Math.min(1, A.actT / A.actLen); const e = Math.sin(Math.PI * k); const bx = Math.sin(A.face), bz = Math.cos(A.face); ox = bx * e * 0.3; oz = bz * e * 0.3; sy = 1 - 0.2 * e; if (k >= 1) A.act = 'idle'; break; }
        case 'windup': { const bx = Math.sin(A.face), bz = Math.cos(A.face); ox = bx * 0.35; oz = bz * 0.35; pitch = 0.5 + Math.sin(t * 14) * 0.06; sy = 0.92 + Math.abs(Math.sin(t * 7)) * 0.1; y = 0.08; break; }
        case 'flee': { const bx = Math.sin(A.face), bz = Math.cos(A.face); A.x += bx * dt * 5; A.z += bz * dt * 5; y = Math.abs(Math.sin(t * 12 + A.ph)) * 0.12; break; }
        default: {
          A.x += (A.hx - A.x) * Math.min(1, dt * 4); A.z += (A.hz - A.z) * Math.min(1, dt * 4);
          y = Math.sin(t * 3 + A.ph) * 0.03; sy = 1 + Math.sin(t * 3 + A.ph) * 0.025;
        }
      }
      A.face += angDiff(A.face, A.hface) * Math.min(1, dt * 6);
      if (fly) y += Math.sin(t * 4 + A.ph) * 0.15;
      if (A.dead) {
        A.deadT += dt;
        const k = Math.min(1, A.deadT * 2.5);
        roll = k * Math.PI / 2 * (A.ph % 2 > 1 ? 1 : -1); y = 0.12 * k - Math.max(0, A.deadT - 7) * 0.3 + (fly ? -fly * k : 0); sy = 1;
        if (A.deadT > 10) y = -5;
      }
      A.y = y;
      const im = this.inst[A.a];
      if (!im || A.k >= CAP) continue;
      this._e.set(pitch, A.face, roll, 'YXZ'); this._q.setFromEuler(this._e);
      this._p.set(A.x + ox, y, A.z + oz); this._s.set(A.sc, A.sc * sy, A.sc);
      this._m.compose(this._p, this._q, this._s);
      im.setMatrixAt(A.k, this._m);
      const fl = A.flash, d = A.dead ? 0.42 : A.act === 'windup' ? 1.0 + 0.3 * (0.5 + 0.5 * Math.sin(t * 16)) : 1;
      if (A.act === 'windup') this._c.setRGB(d + 0.25, d * 0.75, d * 0.7); else this._c.setRGB(d + fl * 1.6, d + fl * 1.5, d + fl * 1.3);
      im.setColorAt(A.k, this._c);
      counts[A.a] = Math.max(counts[A.a], A.k + 1);
      if (A.f.lead && !A.dead && crowns < 8 && !hasLeadArt(FOE_ARTS[A.a])) {
        const hz = (FOE_HEAD_Z[FOE_ARTS[A.a]] ?? 0) * A.sc;
        this._p.set(A.x + ox + Math.sin(A.face) * hz, y + FOE_TOP[FOE_ARTS[A.a]] * A.sc * sy - 0.02, A.z + oz + Math.cos(A.face) * hz);
        this._q.setFromEuler(this._e); this._s.set(A.sc, A.sc, A.sc);
        this._m.compose(this._p, this._q, this._s); this.crowns.setMatrixAt(crowns++, this._m);
      }
    }
    for (let a = 0; a < this.inst.length; a++) {
      const im = this.inst[a], ol = this.outl[a], n = counts[a];
      if (!im || !ol) continue;
      im.count = n; ol.count = n; im.visible = n > 0; ol.visible = n > 0;
      if (n) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    }
    this.crowns.count = crowns; this.crowns.visible = crowns > 0;
    if (crowns) this.crowns.instanceMatrix.needsUpdate = true;
  }

  /** Where a foe's hp bar goes: over its head (FOE_HEAD_Z along its facing, scaled), just above FOE_TOP. */
  barPos(A: FoeActor, out: THREE.Vector3): THREE.Vector3 {
    this.pos(A, out);
    const hz = (FOE_HEAD_Z[FOE_ARTS[A.a]] ?? 0) * A.sc;
    return out.set(out.x + Math.sin(A.face) * hz, A.y + this.top(A) + 0.32, out.z + Math.cos(A.face) * hz);
  }
  /** Current world position of a foe (with its lunge). */
  pos(A: FoeActor, out: THREE.Vector3): THREE.Vector3 {
    const k = A.act === 'lunge' ? Math.sin(Math.PI * Math.min(1, A.actT / A.actLen)) * 0.85 : 0;
    return out.set(A.x + (A.tx - A.hx) * k, A.y + this.top(A) * 0.55, A.z + (A.tz - A.hz) * k);
  }

  dispose(): void {
    for (const im of this.inst) im?.dispose();
    for (const ol of this.outl) ol?.dispose();
    this.crowns.dispose();
    this.inst.fill(null); this.outl.fill(null); this.list.length = 0;
    this.root.removeFromParent();
  }
}

/* ------------------------------------------------------------------ the boss */

export class Boss {
  readonly root = new THREE.Group();
  readonly mesh: THREE.InstancedMesh;
  private ol: THREE.InstancedMesh;
  x = 9; z = 0; face = Math.PI / 2; scale = 2.6;
  act: 'idle' | 'swing' | 'roar' | 'feint' | 'hurt' = 'idle'; actT = 0; flash = 0; rage = false; dead = false; deadT = 0;
  private _m = new THREE.Matrix4(); private _q = new THREE.Quaternion(); private _e = new THREE.Euler(0, 0, 0, 'YXZ'); private _p = new THREE.Vector3(); private _s = new THREE.Vector3(); private _c = new THREE.Color();
  constructor(mats: ExpMats, pal: number) {
    this.root.name = 'exp-boss';
    const g = bossGeo(pal);
    this.mesh = new THREE.InstancedMesh(g, mats.tint, 1);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3).fill(1), 3);
    this.ol = new THREE.InstancedMesh(hullGeo(g), mats.outlineBig, 1);
    this.ol.instanceMatrix = this.mesh.instanceMatrix;
    this.mesh.frustumCulled = false; this.ol.frustumCulled = false;
    this.root.add(this.mesh, this.ol);
  }
  get top(): number { return 2.4 * this.scale; }
  play(a: Boss['act']): void { this.act = a; this.actT = 0; if (a === 'hurt') this.flash = 1; }
  update(dt: number, t: number): void {
    this.actT += dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);
    let pitch = 0, sy = 1 + Math.sin(t * 2) * 0.03, ox = 0, y = 0, roll = 0;
    const L = this.act === 'swing' ? 1.1 : this.act === 'roar' ? 1.6 : this.act === 'feint' ? 0.9 : this.act === 'hurt' ? 0.35 : 0;
    const k = L ? Math.min(1, this.actT / L) : 0, e = Math.sin(Math.PI * k);
    if (this.act === 'swing') { pitch = k < 0.45 ? 0.35 * (k / 0.45) : 0.35 - 0.95 * Math.sin(Math.PI * (k - 0.45) / 0.55); ox = -Math.max(0, -pitch) * 1.2; }
    else if (this.act === 'roar') { pitch = 0.3 * e; sy = 1 + 0.12 * e; }
    else if (this.act === 'feint') { pitch = 0.35 * e; }
    else if (this.act === 'hurt') { ox = 0.25 * e; sy = 1 - 0.08 * e; }
    if (L && k >= 1) this.act = 'idle';
    if (this.dead) { this.deadT += dt; roll = Math.min(1, this.deadT * 1.5) * 1.4; y = -Math.max(0, this.deadT - 1.5) * 0.8; }
    const fx = -Math.sin(this.face), fz = -Math.cos(this.face);
    this._e.set(-pitch, this.face, roll, 'YXZ'); this._q.setFromEuler(this._e);
    this._p.set(this.x - fx * ox * 0 + fx * -ox, y, this.z + fz * -ox); this._s.set(this.scale, this.scale * sy, this.scale);
    this._m.compose(this._p, this._q, this._s); this.mesh.setMatrixAt(0, this._m); this.mesh.instanceMatrix.needsUpdate = true;
    const r = this.rage ? 0.3 + 0.15 * Math.sin(t * 8) : 0;
    this._c.setRGB(1 + this.flash * 1.6 + r, 1 + this.flash * 1.5 - r * 0.4, 1 + this.flash * 1.4 - r * 0.4);
    this.mesh.setColorAt(0, this._c); this.mesh.instanceColor!.needsUpdate = true;
  }
  dispose(): void { this.mesh.dispose(); this.ol.dispose(); this.root.removeFromParent(); }
}

/* ------------------------------------------------------------------ hp bars (billboards, one draw) */

export class Bars {
  readonly mesh: THREE.InstancedMesh;
  private bar: Float32Array;
  private attr: THREE.InstancedBufferAttribute;
  private n = 0;
  private _m = new THREE.Matrix4();
  constructor(mats: ExpMats, private cap = 64) {
    const g = new THREE.PlaneGeometry(1, 1);
    this.bar = new Float32Array(cap * 4);
    this.attr = new THREE.InstancedBufferAttribute(this.bar, 4);
    g.setAttribute('iBar', this.attr);
    this.mesh = new THREE.InstancedMesh(g, mats.bar, cap);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 15; this.mesh.count = 0; this.mesh.name = 'exp-bars';
  }
  begin(): void { this.n = 0; }
  add(x: number, y: number, z: number, hp: number, w = 0.9, h = 0.11, kind = 0): void {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this._m.makeTranslation(x, y, z); this.mesh.setMatrixAt(i, this._m);
    this.bar[i * 4] = hp; this.bar[i * 4 + 1] = w; this.bar[i * 4 + 2] = h; this.bar[i * 4 + 3] = kind;
  }
  end(): void { this.mesh.count = this.n; this.mesh.visible = this.n > 0; if (this.n) { this.mesh.instanceMatrix.needsUpdate = true; this.attr.needsUpdate = true; } }
  dispose(): void { this.mesh.geometry.dispose(); this.mesh.dispose(); this.mesh.removeFromParent(); }
}

/* ------------------------------------------------------------------ ground decals (one draw) */

export class Decals {
  readonly mesh: THREE.InstancedMesh;
  private col: Float32Array; private p: Float32Array;
  private aCol: THREE.InstancedBufferAttribute; private aP: THREE.InstancedBufferAttribute;
  private n = 0;
  private _m = new THREE.Matrix4(); private _c = new THREE.Color();
  constructor(mats: ExpMats, private cap = 160) {
    const g = new THREE.PlaneGeometry(2, 2); g.rotateX(-Math.PI / 2);
    this.col = new Float32Array(cap * 4); this.p = new Float32Array(cap * 2);
    this.aCol = new THREE.InstancedBufferAttribute(this.col, 4); this.aP = new THREE.InstancedBufferAttribute(this.p, 2);
    g.setAttribute('iCol', this.aCol); g.setAttribute('iP', this.aP);
    this.mesh = new THREE.InstancedMesh(g, mats.decal, cap);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.renderOrder = 2; this.mesh.name = 'exp-decals';
  }
  begin(): void { this.n = 0; }
  add(x: number, y: number, z: number, r: number, color: THREE.ColorRepresentation, a = 1, soft = 0, pulse = 0): void {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this._m.makeScale(r, 1, r).setPosition(x, y + 0.04, z); this.mesh.setMatrixAt(i, this._m);
    this._c.set(color);
    this.col[i * 4] = this._c.r; this.col[i * 4 + 1] = this._c.g; this.col[i * 4 + 2] = this._c.b; this.col[i * 4 + 3] = a;
    this.p[i * 2] = soft; this.p[i * 2 + 1] = pulse;
  }
  end(): void { this.mesh.count = this.n; this.mesh.visible = this.n > 0; if (this.n) { this.mesh.instanceMatrix.needsUpdate = true; this.aCol.needsUpdate = true; this.aP.needsUpdate = true; } }
  dispose(): void { this.mesh.geometry.dispose(); this.mesh.dispose(); this.mesh.removeFromParent(); }
}

/* ------------------------------------------------------------------ projectiles */

interface Shot { on: boolean; kind: 0 | 1 | 2; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; t: number; len: number; arc: number; r: number; g: number; b: number; done: (() => void) | null }
/** Arrows (instanced), magic orbs and heal motes (fx particles along an arc). */
export class Shots {
  readonly mesh: THREE.InstancedMesh;
  private list: Shot[] = [];
  private _m = new THREE.Matrix4(); private _q = new THREE.Quaternion(); private _p = new THREE.Vector3(); private _s = new THREE.Vector3(1.8, 1.8, 1.8);
  private _a = new THREE.Vector3(); private _f = new THREE.Vector3(0, 0, -1);
  constructor(mats: ExpMats, private fx: Fx, cap = 48) {
    this.mesh = new THREE.InstancedMesh(arrowGeo(), mats.tint, cap);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.name = 'exp-arrows';
    for (let i = 0; i < cap; i++) this.list.push({ on: false, kind: 0, x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0, t: 0, len: 1, arc: 0, r: 1, g: 1, b: 1, done: null });
  }
  /** kind 0 arrow, 1 orb, 2 heal mote. */
  fire(kind: 0 | 1 | 2, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: THREE.Color | null, done: (() => void) | null): void {
    let s = this.list.find((x) => !x.on);
    if (!s) s = this.list[0];
    const d = Math.hypot(x1 - x0, z1 - z0);
    s.on = true; s.kind = kind; s.x0 = x0; s.y0 = y0; s.z0 = z0; s.x1 = x1; s.y1 = y1; s.z1 = z1; s.t = 0;
    s.len = kind === 0 ? 0.25 + d / 22 : kind === 1 ? 0.35 + d / 14 : 0.6; s.arc = kind === 0 ? d * 0.18 : kind === 1 ? d * 0.06 : 1.2;
    if (color) { s.r = color.r; s.g = color.g; s.b = color.b; } else { s.r = 0.6; s.g = 0.8; s.b = 1; }
    s.done = done;
  }
  update(dt: number): void {
    let n = 0;
    for (const s of this.list) {
      if (!s.on) continue;
      s.t += dt;
      const k = Math.min(1, s.t / s.len);
      const x = s.x0 + (s.x1 - s.x0) * k, z = s.z0 + (s.z1 - s.z0) * k, y = s.y0 + (s.y1 - s.y0) * k + Math.sin(Math.PI * k) * s.arc;
      if (s.kind === 0) {
        const k2 = Math.min(1, k + 0.02);
        this._a.set(s.x0 + (s.x1 - s.x0) * k2 - x, s.y0 + (s.y1 - s.y0) * k2 + Math.sin(Math.PI * k2) * s.arc - y, s.z0 + (s.z1 - s.z0) * k2 - z).normalize();
        if (this._a.lengthSq() < 0.5) this._a.set(1, 0, 0);
        this._q.setFromUnitVectors(this._f, this._a);
        this._p.set(x, y, z); this._m.compose(this._p, this._q, this._s);
        this.mesh.setMatrixAt(n++, this._m);
        this.fx.emit(0, x, y, z, 0, 0, 0, 0.18, 0.16, 0.02, 1, 0.92, 0.7, 0.8, 0, 0, true);
      } else if (s.kind === 1) {
        this.fx.emit(0, x, y, z, 0, 0, 0, 0, 0.55, 0.55, s.r, s.g, s.b, 1, 0, 0, true);
        this.fx.emit(0, x, y, z, (Math.random() - 0.5) * 0.6, 0.3, (Math.random() - 0.5) * 0.6, 0.35, 0.22, 0.02, s.r, s.g, s.b, 0.8, 0, 1, true);
      } else {
        this.fx.emit(5, x, y, z, 0, 0, 0, 0, 0.3, 0.3, 0.45, 1, 0.55, 1, 0, 0, false);
      }
      if (k >= 1) { s.on = false; const d = s.done; s.done = null; if (d) d(); }
    }
    this.mesh.count = n; this.mesh.visible = n > 0;
    if (n) this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear(): void { for (const s of this.list) { s.on = false; s.done = null; } this.mesh.count = 0; }
  dispose(): void { this.clear(); this.mesh.dispose(); this.mesh.removeFromParent(); }
}

function angDiff(a: number, b: number): number { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
