/**
 * Necromancer minions: cute green "zombie cats" (ordinary avatars with a pale-green coat, empty eye sockets lit by a
 * glow, arms stretched forward, a wobbly walk). They claw their way out of the ground, toddle towards the nearest
 * standing cat for ~12 s, bonk it (it ragdolls), then crumble to dust. Purely local, like everything in src/combat.
 */
import * as THREE from 'three';
import type { Appearance } from '../contracts';
import type { Avatar } from '../contracts/modules';
import type { AvatarCombat, CombatRig } from '../avatar/avatar';
import type { RagdollEnv } from './physics';
import { Fx, SH_GLOW, SH_DUST } from './fx';
import { ZombieBubble } from './bubble';

export interface ZombieTarget { id: string; x: number; y: number; z: number; down: boolean }
export type Bonk = (targetIndex: number, x: number, y: number, z: number, dx: number, dz: number) => void;

const LIFE = 12, RISE = 1.0, CRUMBLE = 0.7, SPEED = 1.05, SCALE = 0.78;
/** Personal space (m): minions keep this far from each other and from standing cats (except to bonk). */
export const ZOMBIE_SPACE = 0.75, CAT_SPACE = 0.62;

/**
 * Separation steering (pure, tested): the push away from every neighbour closer than `r` (stronger when closer),
 * summed into out.x / out.z. `skip` = own index in the lists (−1 = none).
 */
export function separation(x: number, z: number, xs: ArrayLike<number>, zs: ArrayLike<number>, n: number, skip: number, r: number, out: { x: number; z: number }) {
  for (let i = 0; i < n; i++) {
    if (i === skip) continue;
    let dx = x - xs[i], dz = z - zs[i];
    const d = Math.hypot(dx, dz);
    if (d >= r) continue;
    if (d < 1e-4) { const a = (skip + 1) * 2.4 + i; dx = Math.cos(a); dz = Math.sin(a); } else { dx /= d; dz /= d; }
    const k = (r - d) / r;
    out.x += dx * k; out.z += dz * k;
  }
  return out;
}
const _sep = { x: 0, z: 0 };
const _zx = new Float32Array(16), _zz = new Float32Array(16);
const SHAPES = ['bean', 'ball', 'egg', 'cone'];
const COATS = ['#a9d98f', '#9fd0a0', '#b5dc8c'];
const _v = new THREE.Vector3();

let zid = 0;
export function zombieAppearance(n: number, styleId = 'cats'): Appearance {
  return {
    login: `zombie-cat-${n}`, name: '', level: 1, styleId: styleId as Appearance['styleId'],
    look: { shape: SHAPES[n % SHAPES.length], color: COATS[n % COATS.length], color2: '#5d8a4a', eyes: 'void', mouth: n % 2 ? 'open' : 'grin', blush: false, hat: 'none', acc: n % 3 === 0 ? ['cobweb'] : [] },
    gear: {},
  } as Appearance;
}

interface Zombie {
  av: Avatar & Partial<AvatarCombat>; rig: CombatRig | null;
  x: number; y: number; z: number; yaw: number;
  t: number; state: 'rise' | 'walk' | 'bonk' | 'crumble';
  stateT: number; target: string | null; bonkCD: number; hitDone: boolean; seed: number; wander: number;
  bonkDir: [number, number];
  /** Says «Мозги… Рыыыбки!» once it is out of the ground. */
  talk: boolean;
}

export class Zombies {
  readonly root = new THREE.Group();
  readonly list: Zombie[] = [];
  readonly bubble = new ZombieBubble();
  private talker: Zombie | null = null;

  constructor(private create: (app: Appearance) => Avatar, private styleId = 'cats') {
    this.root.name = 'combat-zombies';
    if (this.bubble.sprite) this.root.add(this.bubble.sprite);
  }

  get count() { return this.list.length; }
  /** Live style switch ('l3d:style'): the next zombies rise in the new style (the walking ones keep theirs until they crumble). */
  setStyle(styleId: string) { if (styleId) this.styleId = styleId; }

  /** Raise one at (x, z) facing yaw. Oldest crumbles when more than `max` walk. */
  summon(x: number, y: number, z: number, yaw: number, fx: Fx, max = 3, talk = false) {
    const alive = this.list.filter((q) => q.state !== 'crumble');
    if (alive.length >= max) this.crumble(alive[0], fx);
    const av = this.create(zombieAppearance(zid++, this.styleId)) as Avatar & Partial<AvatarCombat>;
    av.root.scale.setScalar(SCALE);
    av.root.position.set(x, y - 1.2, z);
    av.root.rotation.y = yaw;
    av.setLod(0);
    this.root.add(av.root);
    this.list.push({ av, rig: av.combatRig?.() ?? null, x, y, z, yaw, t: 0, state: 'rise', stateT: 0, target: null, bonkCD: 0.6, hitDone: false, seed: Math.random() * 10, wander: Math.random() * 6, bonkDir: [0, -1], talk });
    fx.dust(x, y, z, 10, 0.45, 0.36, 0.28, 0.9, 0.8);
    fx.ring(x, y, z, 0.2, 0.9, 0.9, '#7dff9a', 0.9, 0.6);
  }

  private crumble(q: Zombie, fx: Fx) {
    if (q.state === 'crumble') return;
    q.state = 'crumble'; q.stateT = 0;
    fx.dust(q.x, q.y + 0.3, q.z, 14, 0.62, 0.7, 0.55, 0.8, 1.0);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('l3d:sfx', { detail: { id: 'combat.poof', x: q.x, y: q.y, z: q.z } }));
  }

  update(dt: number, t: number, targets: ZombieTarget[], env: RagdollEnv, fx: Fx, onBonk: Bonk, lod: 0 | 1 = 0) {
    this.sayUpdate(dt);
    const nz = Math.min(16, this.list.length);
    for (let i = 0; i < nz; i++) { _zx[i] = this.list[i].x; _zz[i] = this.list[i].z; }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const q = this.list[i], zi = i < 16 ? i : -1;
      q.t += dt; q.stateT += dt; q.bonkCD -= dt;
      const root = q.av.root;
      if (q.t > LIFE && q.state !== 'crumble') this.crumble(q, fx);
      let speed01 = 0;
      switch (q.state) {
        case 'rise': {
          const k = Math.min(1, q.stateT / RISE), e = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
          q.y = env.groundAt(q.x, q.z);
          root.position.set(q.x, q.y - 1.2 * (1 - e), q.z);
          root.rotation.set(Math.sin(q.stateT * 18) * 0.12 * (1 - k), q.yaw, 0);
          if (fx.rnd() < 0.5) fx.dust(q.x, q.y, q.z, 1, 0.45, 0.36, 0.28, 0.6, 0.6);
          if (k < 0.75 && fx.rnd() < 0.45) {   // clods of dirt flung out of the hole
            const a = fx.rnd() * Math.PI * 2, sp = 0.6 + fx.rnd() * 1.1, sh = 0.85 + fx.rnd() * 0.3;
            fx.emit(SH_DUST, q.x + Math.cos(a) * 0.15, q.y + 0.05, q.z + Math.sin(a) * 0.15, Math.cos(a) * sp, 2.2 + fx.rnd() * 1.6, Math.sin(a) * sp, 0.65, 0.07 + fx.rnd() * 0.04, 0.05, 0.42 * sh, 0.31 * sh, 0.22 * sh, 1, -11, 0.3, false, fx.rnd() * 6, 5);
          }
          if (fx.rnd() < 0.6) fx.emit(SH_GLOW, q.x + (fx.rnd() - 0.5) * 0.6, q.y + 0.05, q.z + (fx.rnd() - 0.5) * 0.6, 0, 0.8 + fx.rnd(), 0, 0.7, 0.08, 0.02, 0.5, 1, 0.6, 1, 0, 0.5, true);
          if (k >= 1) { q.state = 'walk'; q.stateT = 0; if (q.talk) { q.talk = false; this.talker = q; this.bubble.show(); } }
          break;
        }
        case 'walk': {
          // nearest standing cat within 14 m, else wander
          let bi = -1, bd = 14;
          for (let k = 0; k < targets.length; k++) {
            const c = targets[k]; if (c.down) continue;
            const d = Math.hypot(c.x - q.x, c.z - q.z);
            if (d < bd) { bd = d; bi = k; }
          }
          let dx: number, dz: number;
          if (bi >= 0) { dx = targets[bi].x - q.x; dz = targets[bi].z - q.z; q.target = targets[bi].id; }
          else { q.wander += (Math.sin(t * 0.7 + q.seed) * 0.8) * dt; dx = -Math.sin(q.wander); dz = -Math.cos(q.wander); q.target = null; }
          const d = Math.hypot(dx, dz) || 1;
          if (bi >= 0 && bd < 0.85 && q.bonkCD <= 0) {
            q.state = 'bonk'; q.stateT = 0; q.hitDone = false; q.bonkDir = [dx / d, dz / d];
            q.av.play('bonk');
            break;
          }
          // keep a little personal space from the other minions and from standing cats (but still walk up to the
          // target to bonk it): separation steering added to the goal direction
          _sep.x = 0; _sep.z = 0;
          separation(q.x, q.z, _zx, _zz, nz, zi, ZOMBIE_SPACE, _sep);
          for (let k = 0; k < targets.length; k++) {
            const c = targets[k]; if (c.down || k === bi) continue;
            let ex = q.x - c.x, ez = q.z - c.z; const e = Math.hypot(ex, ez);
            if (e < CAT_SPACE && e > 1e-4) { ex /= e; ez /= e; const w = (CAT_SPACE - e) / CAT_SPACE; _sep.x += ex * w; _sep.z += ez * w; }
          }
          dx = dx / d + _sep.x * 2.2; dz = dz / d + _sep.z * 2.2;
          const want = Math.atan2(-dx, -dz);
          let dy = want - q.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          q.yaw += dy * Math.min(1, dt * 4);
          if (bi < 0 || bd > 0.7) {
            const sp = SPEED * (0.85 + 0.25 * Math.sin(t * 5 + q.seed)) * dt;
            const nx = q.x - Math.sin(q.yaw) * sp, nz = q.z - Math.cos(q.yaw) * sp;
            if (!env.blocked(nx, nz, q.y + 0.3)) { q.x = nx; q.z = nz; speed01 = 0.55; }
            else q.wander += 1.3;
          }
          // and never stand inside each other: a soft positional push
          if (_sep.x !== 0 || _sep.z !== 0) {
            const px = q.x + _sep.x * dt * 2.2, pz = q.z + _sep.z * dt * 2.2;
            if (!env.blocked(px, pz, q.y + 0.3)) { q.x = px; q.z = pz; }
          }
          _zx[zi] = q.x; _zz[zi] = q.z;
          q.y += (env.groundAt(q.x, q.z) - q.y) * Math.min(1, dt * 12);
          root.position.set(q.x, q.y, q.z);
          root.rotation.set(0, q.yaw, 0);
          break;
        }
        case 'bonk': {
          const want = Math.atan2(-q.bonkDir[0], -q.bonkDir[1]);
          let dy = want - q.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          q.yaw += dy * Math.min(1, dt * 10);
          root.rotation.set(0, q.yaw, 0);
          if (!q.hitDone && q.stateT > 0.34) {
            q.hitDone = true;
            const bi = targets.findIndex((c) => c.id === q.target);
            if (bi >= 0 && !targets[bi].down && Math.hypot(targets[bi].x - q.x, targets[bi].z - q.z) < 1.3) {
              const c = targets[bi];
              onBonk(bi, c.x, c.y, c.z, q.bonkDir[0], q.bonkDir[1]);
            }
          }
          if (q.stateT > 0.8) { q.state = 'walk'; q.stateT = 0; q.bonkCD = 1.4; }
          break;
        }
        case 'crumble': {
          const k = Math.min(1, q.stateT / CRUMBLE);
          root.scale.set(SCALE * (1 + 0.35 * k), SCALE * Math.max(0.05, 1 - k), SCALE * (1 + 0.35 * k));
          root.position.y = q.y - 0.05 * k;
          if (fx.rnd() < 0.7) fx.emit(SH_DUST, q.x + (fx.rnd() - 0.5) * 0.5, q.y + 0.6 * (1 - k), q.z + (fx.rnd() - 0.5) * 0.5, (fx.rnd() - 0.5) * 0.6, 0.3, (fx.rnd() - 0.5) * 0.6, 0.8, 0.14, 0.32, 0.62, 0.7, 0.55, 0.8, -0.5, 1.5);
          if (k >= 1) { if (this.talker === q) { this.talker = null; this.bubble.hide(); } q.av.dispose(); this.list.splice(i, 1); continue; }
          break;
        }
      }
      q.av.setLod(lod);
      q.av.update(dt, t, speed01);
      // zombie flavour on top of the animation: arms stretched forward, a drunken wobble
      const b = q.rig?.bones;
      if (b && q.state !== 'bonk' && q.state !== 'crumble') {
        const w = Math.sin(t * 6 + q.seed);
        b[2].rotation.set(1.45 + Math.sin(t * 3.1 + q.seed) * 0.12, 0, -0.08);
        b[3].rotation.set(1.45 + Math.sin(t * 3.1 + q.seed + 1.5) * 0.12, 0, 0.08);
        b[1].rotation.z += w * 0.16; b[1].rotation.x += 0.12;
      }
      // glowing eyes
      if (q.rig && q.state !== 'crumble') {
        const r = q.rig;
        root.updateMatrixWorld();
        for (const s of [-1, 1]) {
          // eye on the face (model space) → body bone (follows the wobble) → world
          _v.set(s * r.ex * 1.15, r.eyeY, -r.w * r.depth * 0.98).sub(r.rest[1]);
          if (b) _v.applyMatrix4(b[1].matrixWorld); else _v.add(r.rest[1]).applyMatrix4(root.matrixWorld);
          fx.emit(SH_GLOW, _v.x, _v.y, _v.z, 0, 0, 0, 0, 0.09, 0.09, 0.45, 1, 0.55, 1, 0, 0, true);
        }
      }
    }
  }

  private sayUpdate(dt: number) {
    const q = this.talker;
    if (!q || !this.bubble.showing) return;
    const h = (q.av.headTop || 1.2) * SCALE;
    this.bubble.update(dt, q.x, q.y + h + 0.12, q.z);
  }

  clear() { for (const q of this.list) q.av.dispose(); this.list.length = 0; this.talker = null; this.bubble.hide(); }
  dispose() { this.clear(); this.bubble.dispose(); this.root.removeFromParent(); }
}
