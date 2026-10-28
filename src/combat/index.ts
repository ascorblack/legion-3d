/**
 * src/combat — «Драки с котиками»: client-side-only fun. Class attacks with animations, knock-backs and ragdolls on
 * other cats; nothing is ever sent to the site and nobody else sees it.
 *
 *   rules.ts        attack kind per weapon/role, numbers, cooldowns, trail windows, the input gate (pure, tested)
 *   physics.ts      Verlet ragdoll + cat-cat separation (pure, tested)   ragdoll.ts  avatar ↔ ragdoll: toss, squash,
 *                   dizzy stars, get-up, shake-off, return
 *   fx.ts           one-draw-call particles + one instanced draw call for every ground ring / light pool
 *   trail.ts        the swing "swoosh" ribbon (one draw call)  projectiles.ts  arrows (instanced) and orbs
 *   zombies.ts      necromancer minions (separation steering)  bubble.ts   their «Мозги… Рыыыбки!» bubble
 *   sweep.ts        segment/capsule + melee cone (pure)
 *   room.ts         fights inside rooms: the room scene's `combat` field (fighters: shopkeepers, tent mannequins,
 *                   mine miners / NPCs; a hook after the room's own update) and the room's floor/solids as a RagdollEnv
 *
 * CombatSystem is engine-agnostic: the game feature (src/features/combat.ts) and the dev page (dev/combat.ts) give
 * it a CombatHost. Call press()/release() for LMB and update() once per frame AFTER the crowd has animated the
 * avatars (it overrides their transforms while they are ragdolls).
 *
 * Events (window): 'l3d:combat' {kind, x, y, z} with kind swing | whoosh | hit | slam | draw | shot | stick | summon |
 * bonk | burst | getup, and 'l3d:sfx' {id, x, y, z} with combat.swing (when the fast part of a melee swing starts) |
 * combat.hit | combat.bow.draw | combat.bow.release | combat.arrow.hit | combat.arrow.stick | combat.cast |
 * combat.summon | combat.poof | combat.holy for the sound engine (src/audio/defs.ts).
 * Draw calls at q2, worst case (3 minions at LOD 1, 3 hit flashes, arrows, orb, rings, trail, bubble): ≤ 15.
 */
import * as THREE from 'three';
import type { Appearance } from '../contracts';
import type { Avatar } from '../contracts/modules';
import type { ViewModelEx } from '../avatar/viewmodel';
import { attackKind, isHoly, Cooldowns, SPECS, BOW, type AttackKind } from './rules';
import { Fx, SH_GLOW, SH_STAR, SH_HEART, SH_DUST, SH_SPARK, SH_RING } from './fx';
import { AvatarRagdoll, type CombatAvatar } from './ragdoll';
import { Projectiles, type ShotTarget, type ShotKind } from './projectiles';
import { Zombies, type ZombieTarget } from './zombies';
import { inCone } from './sweep';
import { separateRagdolls, pushOutOfCapsule, type RagdollEnv } from './physics';
import { SwingTrail } from './trail';
import { blastImpulse } from './boom';

export { gate, attackKind, SPECS, BOW, Cooldowns, COMBAT_ROOMS } from './rules';
export type { GateInput, AttackKind } from './rules';
export { BOOM, BoomCooldown, blastImpulse } from './boom';

export const MAX_RAGDOLLS = 6;
/** At most this many hit flashes (one extra draw call each) at the same time. */
export const MAX_FLASHES = 2;
/** A blast (src/combat/boom.ts) may toss this many at once for a few seconds. */
export const MAX_BLAST_RAGDOLLS = 14;

export interface CombatHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Other characters that can be hit (id → avatar). Called every frame. */
  forEachTarget(fn: (id: string, av: CombatAvatar) => void): void;
  /** The walkable space now (street or the mine), world metres: what bodies and minions collide with. */
  env(): RagdollEnv;
  /** What projectiles collide with (default: env). On the street the walk grid ends in open air, so arrows only
   *  stop at real walls there. */
  shotEnv?(): RagdollEnv;
  me: {
    av: CombatAvatar;
    feet: THREE.Vector3;
    /** First person (the view-model is shown). */
    fp(): boolean;
    vm?: ViewModelEx;
    app(): Appearance | null;
  };
  createAvatar(app: Appearance): Avatar;
  /** Drawing-buffer height in px (particle size). */
  viewHeight(): number;
  quality(): number;
  /** Show the nameplate of a ragdolled avatar at this point (optional). */
  anchor?(id: string, x: number, y: number, z: number): void;
  reducedMotion?: boolean;
  /** Where the crosshair looks from / to (default: the camera). Dev pages aim without moving their camera. */
  aim?(origin: THREE.Vector3, dir: THREE.Vector3): void;
}

interface Pending { kind: AttackKind; at: number; holy: boolean }

const _t: ShotTarget[] = [], _z: ZombieTarget[] = [], _avs: CombatAvatar[] = [];
const _dir = new THREE.Vector3(), _pos = new THREE.Vector3(), _aim = new THREE.Vector3();
const _col = new THREE.Color();
const ORB_COLOR: Record<string, string> = { mage: '#8fd4ff', necromancer: '#b98bff', priest: '#ffe9a0' };

const p0holy = (a: Appearance | null) => isHoly(a?.gear?.w, a?.role);
const _ta = new THREE.Vector3(), _tb = new THREE.Vector3(), _tp = new THREE.Vector3();

function dispatch(kind: string, x: number, y: number, z: number, sfx?: string, extra?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('l3d:combat', { detail: { kind, x, y, z, ...extra } }));
  if (sfx) window.dispatchEvent(new CustomEvent('l3d:sfx', { detail: { id: sfx, x, y, z } }));
}

export class CombatSystem {
  readonly root = new THREE.Group();
  readonly fx = new Fx();
  readonly shots = new Projectiles();
  readonly zombies: Zombies;
  readonly ragdolls = new Map<string, AvatarRagdoll>();
  readonly cooldowns = new Cooldowns();
  readonly trail = new SwingTrail();
  /** The melee swing in progress (trail sampling). */
  private swingKind: AttackKind | null = null; private swingT0 = 0; private whooshed = false;
  private pending: Pending[] = [];
  private drawStart = -1;
  private now = 0;
  private shake = 0; private shakeT = 0;
  /** Blast hits waiting for the shock front to reach them (see blast()); a raised ragdoll cap until bigUntil. */
  private blastQ: { id: string; av: CombatAvatar; at: number; v: [number, number, number, number, number, number, number] }[] = [];
  private bigUntil = -Infinity;
  /** ms of physics + pose work in the last update (perf HUD / tests). */
  lastMs = 0;
  /** Stats for the perf report. */
  stats = { ragdolls: 0, zombies: 0, particles: 0, arrows: 0 };

  constructor(private host: CombatHost) {
    this.root.name = 'combat';
    this.zombies = new Zombies((app) => host.createAvatar(app), String(host.me.app()?.styleId || 'cats'));
    this.root.add(this.fx.root, this.shots.root, this.zombies.root, this.trail.mesh);
    host.scene.add(this.root);
  }

  /** The attack this hero has now. */
  kind(): AttackKind { const a = this.host.me.app(); return attackKind(a?.gear?.w, a?.role); }
  get drawing(): boolean { return this.drawStart >= 0; }
  /** Bow draw progress 0..1 (0 when not drawing). */
  drawK(): number { return this.drawStart < 0 ? 0 : Math.min(1, (this.now - this.drawStart) / BOW.full); }

  /**
   * LMB down (already gated by the caller). Returns true when it started something. The swing animation itself is
   * played by the caller (controls: vm.swing + meAv.play('swing')) — for the bow nothing must swing.
   */
  press(): boolean {
    const kind = this.kind();
    if (kind === 'bow') {
      if (!this.cooldowns.ready('bow', this.now) || this.drawing) return false;
      this.drawStart = this.now;
      this.host.me.vm?.setDraw?.(0.001); this.host.me.av.setDraw?.(0.001);
      const f = this.host.me.feet; dispatch('draw', f.x, f.y + 1, f.z, 'combat.bow.draw');
      return true;
    }
    if (!this.cooldowns.use(kind, this.now)) return false;
    const a = this.host.me.app();
    this.pending.push({ kind, at: this.now + SPECS[kind].strikeAt, holy: isHoly(a?.gear?.w, a?.role) });
    const f = this.host.me.feet;
    // the whoosh (combat.swing) plays when the fast part of a melee swing starts (sampleTrail); spells have their own
    dispatch('swing', f.x, f.y + 0.8, f.z, undefined, { attack: kind });
    if (kind === 'orb' || kind === 'summon' || kind === 'holy') { this.charge = kind; this.chargeT0 = this.now; }
    if (SPECS[kind].trail[1] > 0) {
      this.swingKind = kind; this.swingT0 = this.now; this.whooshed = false;
      this.trail.begin(p0holy(a) ? '#ffd970' : kind === 'smash' ? '#ffc98a' : '#9fdcff', kind === 'slap' ? 0.75 : kind === 'smash' ? 1.35 : 0.95);
    }
    return true;
  }

  /** LMB up: loose the arrow (if drawn far enough). */
  release(): void {
    if (!this.drawing) return;
    const k = this.drawK();
    this.drawStart = -1;
    this.host.me.vm?.setDraw?.(0); this.host.me.av.setDraw?.(0);
    if (k < BOW.min) return;
    this.cooldowns.use('bow', this.now);
    this.fire('arrow', BOW.vMin + (BOW.vMax - BOW.vMin) * k);
  }

  /** Stop drawing without shooting (gate closed mid-draw). */
  cancel(): void {
    if (this.drawing) { this.drawStart = -1; this.host.me.vm?.setDraw?.(0); this.host.me.av.setDraw?.(0); }
    this.pending.length = 0;
  }

  private spawnPoint(out: THREE.Vector3, dir: THREE.Vector3) {
    const cam = this.host.camera, me = this.host.me;
    if (this.host.aim) this.host.aim(_aim, dir); else { cam.getWorldPosition(_aim); cam.getWorldDirection(dir); }
    if (me.fp()) {
      out.copy(_aim).addScaledVector(dir, 0.45);
      out.y -= 0.07;
    } else {
      // from the hero's paw towards whatever the crosshair is on (40 m ahead)
      const yaw = me.av.root.rotation.y;
      out.set(me.feet.x - Math.sin(yaw) * 0.35, me.feet.y + 0.78, me.feet.z - Math.cos(yaw) * 0.35);
      _aim.addScaledVector(dir, 40);
      dir.copy(_aim).sub(out).normalize();
    }
  }

  private fire(kind: ShotKind, speed: number) {
    this.spawnPoint(_pos, _dir);
    const role = this.host.me.app()?.role || 'mage';
    this.shots.fire(kind, _pos.x, _pos.y, _pos.z, _dir.x * speed, _dir.y * speed + (kind === 'arrow' ? 0.6 : 0), _dir.z * speed, ORB_COLOR[role] || ORB_COLOR.mage);
    dispatch('shot', _pos.x, _pos.y, _pos.z, kind === 'arrow' ? 'combat.bow.release' : 'combat.cast', { shot: kind });
    if (kind === 'orb') {
      _col.set(ORB_COLOR[role] || ORB_COLOR.mage);
      for (let i = 0; i < 8; i++) this.fx.emit(SH_GLOW, _pos.x, _pos.y, _pos.z, (this.fx.rnd() - 0.5) * 2, (this.fx.rnd() - 0.5) * 2, (this.fx.rnd() - 0.5) * 2, 0.35, 0.1, 0.02, _col.r, _col.g, _col.b, 1, 0, 3, true);
    }
  }

  /** Knock a character over: impulse (m/s) at a world point. Creates or re-hits its ragdoll. */
  hit(id: string, av: CombatAvatar, vx: number, vy: number, vz: number, px: number, py: number, pz: number, stop = 0.05, falloff = 0.6, spin = 1): boolean {
    let r = this.ragdolls.get(id);
    let flashing = 0;
    for (const q of this.ragdolls.values()) if (q.flash > 0) flashing++;
    const flash = flashing < MAX_FLASHES;
    if (!r) {
      const rig = av.combatRig?.();
      if (!rig) return false;
      r = new AvatarRagdoll(id, av, rig, stop, flash);
      this.ragdolls.set(id, r);
      if (this.ragdolls.size > (this.now < this.bigUntil ? MAX_BLAST_RAGDOLLS : MAX_RAGDOLLS)) {
        let old: AvatarRagdoll | null = null;
        for (const q of this.ragdolls.values()) if (q !== r && (q.phase === 'fall' || q.phase === 'down') && (!old || q.age > old.age)) old = q;
        old?.hurry();
      }
    } else if (flash || r.flash > 0) { r.flash = 0.45; av.setFlash?.(0.45); }
    r.push(vx, vy, vz, px, py, pz, falloff, spin);
    return true;
  }
  private isDown(id: string) { const r = this.ragdolls.get(id); return !!r && r.phase !== 'return'; }

  private collectTargets() {
    _t.length = 0; _z.length = 0; _avs.length = 0;
    this.host.forEachTarget((id, av) => {
      if (!av.root.parent || !av.root.visible) return;
      const p = av.root.position, down = this.isDown(id);
      const h = (av.headTop || 1.3) * 0.9;
      _t.push({ id, x: p.x, y: p.y, z: p.z, r: 0.34, h, down });
      _z.push({ id, x: p.x, y: p.y, z: p.z, down });
      _avs.push(av);
    });
  }

  private strike(p: Pending) {
    const me = this.host.me, s = SPECS[p.kind], f = me.feet, yaw = me.av.root.rotation.y;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), lx = -Math.cos(yaw), lz = Math.sin(yaw);   // forward, left
    if (p.kind === 'summon') {
      dispatch('summon', f.x + fx * 1.6, f.y, f.z + fz * 1.6, 'combat.summon');
      const env = this.host.env();
      this.fx.ring(f.x + fx * 1.7, env.groundAt(f.x + fx * 1.7, f.z + fz * 1.7), f.z + fz * 1.7, 0.3, 2.2, 1.1, '#8dff9f', 1, 0.8);
      this.zombies.setStyle(String(this.host.me.app()?.styleId || ''));   // follows a live style switch (l3d:style)
      for (const a of [-0.65, 0, 0.65]) {
        const d = a === 0 ? 1.9 : 1.6;
        const x = f.x - Math.sin(yaw + a) * d, z = f.z - Math.cos(yaw + a) * d;
        if (env.blocked(x, z, f.y + 0.3)) continue;
        this.zombies.summon(x, env.groundAt(x, z), z, yaw, this.fx, 3, a === 0);
      }
      return;
    }
    if (p.kind === 'orb') { this.fire('orb', 10); return; }
    if (p.kind === 'holy') { this.holyBurst(f.x, f.y, f.z); return; }
    if (p.kind === 'smash') this.slam(f.x + fx * 0.82 - lx * 0.42, f.z + fz * 0.82 - lz * 0.42);
    // melee: everyone in the cone, nearest first
    this.collectTargets();
    let hits = 0;
    const order: [number, number][] = [];
    for (let i = 0; i < _t.length; i++) {
      const c = _t[i];
      if (Math.abs(c.y - f.y) > 1.2) continue;
      const d = inCone(f.x, f.z, yaw, c.x, c.z, c.r, s.reach, s.cone);
      if (d >= 0) order.push([d, i]);
    }
    order.sort((a, b) => a[0] - b[0]);
    for (const [, i] of order) {
      if (hits >= s.maxHits) break;
      const c = _t[i];
      // strike direction: slash sweeps right → left, smash comes down, thrust and slap push straight on
      let dx = fx, dz = fz;
      if (p.kind === 'slash' || p.kind === 'slap') { dx = fx * 0.55 + lx * 0.85; dz = fz * 0.55 + lz * 0.85; }
      const dl = Math.hypot(dx, dz); dx /= dl; dz /= dl;
      const hy = c.y + c.h * (p.kind === 'smash' ? 0.85 : 0.6);
      const hx = c.x - fx * c.r * 0.8, hz = c.z - fz * c.r * 0.8;
      if (this.hit(c.id, _avs[i], dx * s.push, s.up, dz * s.push, hx, hy, hz, s.stop)) {
        hits++;
        _col.set((_avs[i] as unknown as { app?: Appearance }).app?.look?.color || '#ffd7a8');
        this.fx.impact(hx, hy, hz, dx, dz, _col, p.holy);
        dispatch('hit', hx, hy, hz, 'combat.hit', { attack: p.kind, target: c.id });
      }
    }
    if (hits) this.feelHit(s.stop, s.shake);
  }

  /** Sample the striking edge into the swing trail during the fast part of the swing. */
  private sampleTrail() {
    const k = this.swingKind;
    if (k) {
      const s = SPECS[k], st = this.now - this.swingT0;
      if (st > s.trail[1]) this.swingKind = null;
      else if (st >= s.trail[0] - 0.11 && st < s.trail[0] - 0.01 && k !== 'thrust') {
        // anticipation: a glint runs up the blade while the swing is held back
        const me = this.host.me, fp = me.fp();
        const ok = fp ? !!me.vm?.bladeSeg?.(_ta, _tb) : !!me.av.bladeSeg?.(_ta, _tb);
        if (ok) {
          const u = (st - (s.trail[0] - 0.11)) / 0.1, sc = fp ? 0.3 : 1;
          const x = _ta.x + (_tb.x - _ta.x) * (0.3 + 0.7 * u), y = _ta.y + (_tb.y - _ta.y) * (0.3 + 0.7 * u), z = _ta.z + (_tb.z - _ta.z) * (0.3 + 0.7 * u);
          this.fx.emit(SH_STAR, x, y, z, 0, 0, 0, 0, 0.13 * sc * Math.sin(u * Math.PI), 0, 1, 1, 0.9, 1, 0, 0, false, u * 4);
          this.fx.emit(SH_GLOW, x, y, z, 0, 0, 0, 0, 0.18 * sc, 0, 1, 0.95, 0.8, 0.7 * Math.sin(u * Math.PI), 0, 0, true);
        }
      } else if (st >= s.trail[0]) {
        const me = this.host.me, fp = me.fp();
        if (!this.whooshed) { this.whooshed = true; const f = me.feet; dispatch('whoosh', f.x, f.y + 0.8, f.z, 'combat.swing', { attack: k }); }
        const ok = fp ? !!me.vm?.bladeSeg?.(_ta, _tb) : !!me.av.bladeSeg?.(_ta, _tb, _tp);
        // the arc pivot: the shoulder (TP), a point a little below and behind the eye (FP)
        if (fp) { this.host.camera.getWorldPosition(_tp); _tp.y -= 0.3; }
        if (ok && k === 'smash' && !fp) {
          // a heavy overhead swing is seen edge-on from behind: smear the head's whole width (a band across the hero's
          // right/left), swung round the shoulder
          const yaw = me.av.root.rotation.y, rx = Math.cos(yaw) * 0.17, rz = -Math.sin(yaw) * 0.17;
          _ta.lerp(_tb, 0.6);
          this.trail.fp(false);
          this.trail.push(_ta.x - rx, _ta.y, _ta.z - rz, _ta.x + rx, _ta.y, _ta.z + rz, this.now, _tp);
        } else if (ok && k === 'thrust') {
          // a lunge draws a straight streak: a thin band around the point, not a (degenerate) blade sweep
          const w = fp ? 0.016 : 0.085;
          this.trail.fp(fp);
          this.trail.push(_tb.x, _tb.y - w, _tb.z, _tb.x, _tb.y + w, _tb.z, this.now);
        } else if (ok) {
          // a swoosh is bigger than the blade (cartoon smear): in third person it reaches well past the tip, so the
          // crescent shows around the hero's body; in first person it hugs the blade
          const ka = fp ? 0.15 : k === 'smash' ? 0.8 : 0.1, kb = fp ? 0.12 : k === 'slap' ? 0.7 : 1.0;
          const ax = _ta.x + (_ta.x - _tb.x) * ka, ay = _ta.y + (_ta.y - _tb.y) * ka, az = _ta.z + (_ta.z - _tb.z) * ka;
          _tb.x += (_tb.x - _ta.x) * kb; _tb.y += (_tb.y - _ta.y) * kb; _tb.z += (_tb.z - _ta.z) * kb;
          this.trail.fp(fp); this.trail.push(ax, ay, az, _tb.x, _tb.y, _tb.z, this.now, k === 'smash' || k === 'slash' || k === 'slap' ? _tp : undefined);
        }
      }
    }
    this.trail.update(this.now);
  }

  /** Spells: a glow gathers on the tip of the staff (or over the tome / censer) before the cast. */
  private chargeGlow() {
    const k = this.charge;
    if (!k) return;
    const st = this.now - this.chargeT0, s = SPECS[k];
    if (st > s.strikeAt) { this.charge = null; return; }
    const me = this.host.me, fp = me.fp();
    let ok = fp ? !!me.vm?.bladeSeg?.(_ta, _tb) : !!me.av.bladeSeg?.(_ta, _tb);
    if (!ok) { _tb.set(me.feet.x, me.feet.y + 1.25, me.feet.z); ok = !fp; }
    if (!ok) return;
    const u = Math.min(1, st / s.strikeAt), sc = fp ? 0.3 : 1;
    _col.set(k === 'summon' ? '#8dff9f' : k === 'holy' ? '#ffe9a0' : ORB_COLOR[me.app()?.role || 'mage'] || ORB_COLOR.mage);
    this.fx.emit(SH_GLOW, _tb.x, _tb.y, _tb.z, 0, 0, 0, 0, (0.12 + 0.35 * u) * sc, 0, _col.r, _col.g, _col.b, 0.5 + 0.5 * u, 0, 0, true);
    if (this.fx.rnd() < 0.6) {   // motes drawn in
      const a = this.fx.rnd() * Math.PI * 2, b = this.fx.rnd() * 2 - 1, r = 0.35 * sc;
      this.fx.emit(SH_GLOW, _tb.x + Math.cos(a) * r, _tb.y + b * r, _tb.z + Math.sin(a) * r, -Math.cos(a) * r * 4, -b * r * 4, -Math.sin(a) * r * 4, 0.22, 0.06 * sc, 0.02, _col.r, _col.g, _col.b, 1, 0, 0, true);
    }
  }
  private charge: AttackKind | null = null; private chargeT0 = 0;

  /** Lying cats bump into each other and slide off the standing ones instead of overlapping. */
  private bump() {
    const list = this._rl; list.length = 0;
    for (const r of this.ragdolls.values()) if (r.phase === 'fall' || r.phase === 'down') list.push(r);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) separateRagdolls(list[i].phys, list[j].phys, 0.5);
      for (let k = 0; k < _t.length; k++) {
        const c = _t[k];
        if (c.down || c.id === list[i].id) continue;
        pushOutOfCapsule(list[i].phys, c.x, c.y, c.z, c.r * 0.8, c.h, 0.35);
      }
    }
  }
  private _rl: AvatarRagdoll[] = [];

  /** Smash: the weapon hits the ground — an impact ring, a burst of dust and pebbles, a hard little shake. */
  private slam(x: number, z: number) {
    const y = this.host.env().groundAt(x, z), fx = this.fx;
    fx.ring(x, y, z, 0.5, 2.0, 0.5, '#fff0d0', 1.2, 0.1);
    fx.ring(x, y, z, 0.35, 1.0, 0.28, '#ffffff', 1, 0.5, 0.5);
    fx.emit(SH_GLOW, x, y + 0.12, z, 0, 0, 0, 0.14, 0.9, 1.4, 1, 0.93, 0.78, 1, 0, 0, true);
    fx.emit(SH_RING, x, y + 0.1, z, 0, 0, 0, 0.2, 0.3, 1.6, 1, 0.95, 0.8, 1, 0, 0, true);
    for (let i = 0; i < 10; i++) {   // flat sparks skittering along the ground
      const a = (i / 10) * Math.PI * 2 + fx.rnd() * 0.4, sp = 3.5 + fx.rnd() * 2;
      fx.emit(SH_SPARK, x, y + 0.06, z, Math.cos(a) * sp, 0.4 + fx.rnd() * 0.6, Math.sin(a) * sp, 0.22, 0.14, 0.04, 1, 0.9, 0.6, 1, -4, 4, true, 0.1);
    }
    for (let i = 0; i < 20; i++) {   // a ring of dust rolling out
      const a = (i / 20) * Math.PI * 2 + fx.rnd() * 0.3, sp = 1.8 + fx.rnd() * 1.4;
      fx.emit(SH_DUST, x + Math.cos(a) * 0.25, y + 0.06, z + Math.sin(a) * 0.25, Math.cos(a) * sp, 0.4 + fx.rnd() * 0.6, Math.sin(a) * sp, 0.6 + fx.rnd() * 0.4, 0.22, 0.55, 0.9, 0.84, 0.76, 0.85, -0.4, 3.4, false, fx.rnd() * 6, (fx.rnd() - 0.5) * 3);
    }
    for (let i = 0; i < 12; i++) {   // pebbles hop out
      const a = fx.rnd() * Math.PI * 2, sp = 0.8 + fx.rnd() * 1.8;
      fx.emit(SH_DUST, x, y + 0.05, z, Math.cos(a) * sp, 2.6 + fx.rnd() * 2, Math.sin(a) * sp, 0.65, 0.08, 0.06, 0.55, 0.47, 0.4, 1, -12, 0.4, false, fx.rnd() * 6, 4);
    }
    dispatch('slam', x, y, z, 'combat.hit', { attack: 'smash' });
    if (!this.host.reducedMotion) { this.shake = Math.max(this.shake, 0.026); this.shakeT = 0; }
  }

  private feelHit(stop: number, shake: number) {
    // hit-stop freezes the swing: the trail window moves with it
    if (this.swingKind) this.swingT0 += stop * 0.94;
    this.host.me.vm?.hitStop?.(stop);
    this.host.me.av.hitStop?.(stop);
    if (!this.host.reducedMotion) { this.shake = Math.max(this.shake, shake); this.shakeT = 0; }
  }

  /** Priest / censer: a soft light wave that gently knocks over everyone around. */
  private holyBurst(x: number, y: number, z: number) {
    const s = SPECS.holy;
    this.fx.ring(x, y, z, 0.3, s.reach, 0.75, '#ffe9a0', 1, 0.9);
    this.fx.ring(x, y, z, 0.2, s.reach * 0.6, 0.55, '#fff6d8', 0.8, 0.2);
    this.fx.holySparkles(x, y + 0.6, z, 24);
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; this.fx.emit(SH_HEART, x + Math.cos(a) * 0.4, y + 0.8, z + Math.sin(a) * 0.4, Math.cos(a) * 2.2, 1.4, Math.sin(a) * 2.2, 0.9, 0.12, 0.08, 1, 0.55, 0.7, 1, -2, 2.5); }
    dispatch('burst', x, y, z, 'combat.holy');
    this.collectTargets();
    let n = 0;
    for (let i = 0; i < _t.length && n < s.maxHits; i++) {
      const c = _t[i], dx = c.x - x, dz = c.z - z, d = Math.hypot(dx, dz);
      if (d > s.reach || d < 0.05 || Math.abs(c.y - y) > 1.5) continue;
      const k = 1 - (d / s.reach) * 0.5;
      if (this.hit(c.id, _avs[i], (dx / d) * s.push * k, s.up * k, (dz / d) * s.push * k, c.x, c.y + c.h * 0.4, c.z, 0.02, 0.2)) {
        n++;
        this.fx.holySparkles(c.x, c.y + 0.6, c.z, 5);
      }
    }
    if (n) this.feelHit(0, s.shake);
  }

  /**
   * A big comic blast at (x, y, z): everyone standing within `radius` m is tossed outwards and up (spinning), the
   * near ones harder, each when the shock front (`speed` m/s) reaches them. Returns how many will be hit. The own
   * hero is never a target. Events: 'l3d:combat' kind 'blast' per cat (+ a bonk sound for the first few).
   */
  blast(x: number, y: number, z: number, radius: number, speed = 30, impulse = blastImpulse): number {
    this.collectTargets();
    let n = 0;
    for (let i = 0; i < _t.length; i++) {
      const c = _t[i], dx = c.x - x, dz = c.z - z, d = Math.hypot(dx, dz);
      if (d > radius || Math.abs(c.y - y) > 6 || this.blastQ.some((q) => q.id === c.id)) continue;
      const ux = d > 0.05 ? dx / d : Math.cos(i * 2.4), uz = d > 0.05 ? dz / d : Math.sin(i * 2.4);
      const k = impulse(d, radius);
      this.blastQ.push({ id: c.id, av: _avs[i], at: this.now + d / speed, v: [ux * k.push, k.up, uz * k.push, c.x - ux * c.r, c.y + c.h * 0.35, c.z - uz * c.r, k.spin] });
      n++;
    }
    this.bigUntil = this.now + 6;
    this.blastQ.sort((a, b) => a.at - b.at);
    // the nearest one goes at once: a live ragdoll keeps the combat update running even with fights switched off,
    // so the rest of the queue is served by update()
    if (this.blastQ.length) { this.blastQ[0].at = this.now; this.blastHits(); }
    return n;
  }
  private blastHits() {
    let bonks = 0;
    while (this.blastQ.length && this.blastQ[0].at <= this.now) {
      const q = this.blastQ.shift()!;
      if (!q.av.root.parent || !q.av.root.visible) continue;
      const v = q.v;
      if (this.hit(q.id, q.av, v[0], v[1], v[2], v[3], v[4], v[5], 0.03, 0.35, v[6])) {
        const p = q.av.root.position;
        dispatch('blast', p.x, p.y + 0.6, p.z, bonks < 2 ? 'combat.hit' : undefined, { target: q.id });
        bonks++;
        this.fx.emit(SH_STAR, p.x, p.y + 0.9, p.z, 0, 2.5, 0, 0.7, 0.2, 0.1, 1, 0.9, 0.35, 1, -3, 1, false, 0, 6);
      }
    }
  }
  /** Blast hits still on their way (tests). */
  get blastPending(): number { return this.blastQ.length; }
  /** Something still has to be updated even with fights switched off (a blast on its way, ragdolls). */
  get busy(): boolean { return this.blastQ.length > 0 || this.ragdolls.size > 0; }

  update(dt: number, t: number) {
    const t0 = performance.now();
    this.now = t;
    dt = Math.min(0.05, Math.max(0, dt));
    // bow draw progress; a glint gathers on the arrow head and twinkles at full draw
    if (this.drawing) {
      const k = this.drawK(), me = this.host.me;
      me.vm?.setDraw?.(Math.max(0.001, k)); me.av.setDraw?.(Math.max(0.001, k));
      const ok = me.fp() ? !!me.vm?.arrowTip?.(_ta) : !!me.av.arrowTip?.(_ta);
      if (ok && k > 0.15) {
        const fp = me.fp(), s = fp ? 0.35 : 1, full = k >= 1 ? 1 : 0;
        this.fx.emit(SH_GLOW, _ta.x, _ta.y, _ta.z, 0, 0, 0, 0, (0.05 + 0.1 * k) * s, (0.05 + 0.1 * k) * s, 1, 0.9, 0.7, 0.35 + 0.5 * k, 0, 0, true);
        if (full) this.fx.emit(SH_STAR, _ta.x, _ta.y, _ta.z, 0, 0, 0, 0, (0.09 + 0.03 * Math.sin(t * 18)) * s, 0, 1, 0.96, 0.75, 1, 0, 0, false, t * 3);
      }
    }
    if (this.blastQ.length) this.blastHits();
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (t >= this.pending[i].at) { const p = this.pending[i]; this.pending.splice(i, 1); this.strike(p); }
    }
    const env = this.host.env();
    this.sampleTrail();
    this.chargeGlow();
    // ragdolls (after the crowd animated the avatars this frame)
    for (const [id, r] of this.ragdolls) {
      if (!r.av.root.parent) { this.ragdolls.delete(id); continue; }
      if (!r.update(dt, env, this.fx)) { this.ragdolls.delete(id); dispatch('getup', r.av.root.position.x, r.av.root.position.y, r.av.root.position.z); continue; }
      this.host.anchor?.(id, r.head.x, r.head.y + 0.2, r.head.z);
    }
    const needTargets = this.shots.flying > 0 || this.zombies.count > 0 || this.ragdolls.size > 0;
    if (needTargets) this.collectTargets();
    if (this.ragdolls.size > 0) this.bump();
    if (this.shots.active > 0) {
      this.shots.update(dt, _t, this.host.shotEnv?.() ?? env, this.fx, (kind, i, x, y, z, dx, dy, dz) => {
        const c = _t[i], s = SPECS[kind === 'arrow' ? 'bow' : 'orb'];
        if (this.hit(c.id, _avs[i], dx * s.push, s.up + dy * 2, dz * s.push, x, y, z, s.stop, 0.75, kind === 'arrow' ? 1.3 : 1.1)) {
          _col.set('#ffd7a8');
          this.fx.impact(x, y, z, dx, dz, _col, false);
          dispatch('hit', x, y, z, kind === 'arrow' ? 'combat.arrow.hit' : 'combat.hit', { attack: kind, target: c.id });
          this.feelHit(s.stop * 0.5, s.shake);
        }
      }, (kind, x, y, z) => dispatch('stick', x, y, z, kind === 'arrow' ? 'combat.arrow.stick' : 'combat.poof', { shot: kind }));
    }
    if (this.zombies.count > 0) {
      this.zombies.update(dt, t, _z, env, this.fx, (i, x, y, z, dx, dz) => {
        const c = _t[i];
        const s = SPECS.summon;
        if (this.hit(c.id, _avs[i], dx * s.push, s.up, dz * s.push, x, y + c.h * 0.9, z, 0.04, 0.7)) {
          this.fx.emit(SH_STAR, x, y + c.h, z, 0, 2, 0, 0.6, 0.18, 0.1, 1, 0.9, 0.3, 1, -3, 1);
          _col.set('#a9d98f');
          this.fx.impact(x, y + c.h * 0.9, z, dx, dz, _col, false);
          dispatch('bonk', x, y + c.h, z, 'combat.hit', { attack: 'bonk', target: c.id });
        }
      }, this.host.quality() >= 3 ? 0 : 1);
    }
    this.fx.update(dt, this.host.camera, this.host.viewHeight());
    // camera micro-shake (decays in ~0.15 s; off with prefers-reduced-motion)
    if (this.shake > 0) {
      this.shakeT += dt;
      const k = Math.max(0, 1 - this.shakeT / 0.15);
      if (k <= 0) this.shake = 0;
      else {
        const a = this.shake * k * k, cam = this.host.camera;
        cam.rotation.x += Math.sin(this.shakeT * 90) * a;
        cam.rotation.z += Math.sin(this.shakeT * 70 + 1) * a * 0.6;
        cam.updateMatrixWorld();
      }
    }
    this.stats.ragdolls = this.ragdolls.size; this.stats.zombies = this.zombies.count;
    this.stats.particles = this.fx.count; this.stats.arrows = this.shots.active;
    this.lastMs = performance.now() - t0;
  }

  /** Everything back to normal (setting off, leaving the street…): ragdolls stand up at once, minions vanish. */
  reset() {
    this.cancel();
    this.blastQ.length = 0; this.bigUntil = -Infinity;
    for (const r of this.ragdolls.values()) r.finish();
    this.ragdolls.clear();
    this.zombies.clear();
    this.shots.clear();
    this.fx.clear();
    this.trail.clear(); this.swingKind = null;
    this.shake = 0;
  }

  dispose() {
    this.reset();
    this.fx.dispose(); this.shots.dispose(); this.zombies.dispose(); this.trail.dispose();
    this.root.removeFromParent();
  }
}
