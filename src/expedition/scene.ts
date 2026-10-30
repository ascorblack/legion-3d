/**
 * ExpeditionScene — the 3D room kind 'expedition' (a RoomScene) that morphs per stage. Driven ONLY by SceneState
 * (adapter.ts, from the delayed `q` view): setState() at ≤ 4 Hz, update() every frame. It reacts to stage changes with
 * animations (battle: intro → party → hit → tele → hit … → end), keeps the party's identity across stages, fades
 * between sets and runs its own cinematic orbit camera (look()/zoom() from the mouse).
 *
 * Draw-call budget at q2: terrain ≤ 12, party ≤ 10 instanced + 3 per detailed avatar (≤ 10), foes ≤ 2 per present
 * type + crowns, boss 2, decals 1, bars 1, fx 2, arrows 1, labels ≤ ~25.
 */
import * as THREE from 'three';
import type { RoomScene } from '../contracts/ext';
import type { Appearance } from '../contracts';
import type { AvatarKit } from '../contracts/modules';
import type { SceneState, Member, FoeState } from './adapter';
import { HOW_RU, isTight } from './adapter';
import { ExpMats } from './mats';
import { Terrain, type TerrainMode } from './terrain';
import { Crowd, type Actor } from './crowd';
import { Foes, Boss, Bars, Decals, Shots, type FoeActor } from './foes';
import { FloatText, Label } from './text';
import { buildSet, Crossroads, type SetPiece } from './sets';
import { partySpots, frontLine, foeSpots, circleSpots, columnSpots, extent, type Spot } from './layout';
import { platformGeo, disposeArt, markerGeo, foeSize } from './art';
import { disposeEventArt } from './art-events';
import { Fx } from '../combat/fx';
import { jhash } from '../avatar';

export interface SceneEnv {
  kit: AvatarKit | null;
  appOf(login: string): Appearance | null;
  style: string;
  /** 0..3 (q2 = 2): fewer detailed avatars on low quality */
  quality: number;
  /** whole seconds left of a server window, as on the stream (delay applied) */
  secLeft(until: number): number;
}

const ZONE_COL = ['#c9a36a', '#d07a5a', '#6f9fd8', '#79c98f'];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _t = new THREE.Vector3(), _c = new THREE.Color();

interface Timed { at: number; run: () => void }

export class ExpeditionScene implements RoomScene {
  readonly root = new THREE.Group();
  readonly spawn = { x: 0, z: 40, face: 0 };
  readonly colliders: THREE.Object3D[] = [];
  readonly mats = new ExpMats();
  readonly fx = new Fx();
  readonly crowd: Crowd;
  readonly foes: Foes;
  readonly bars: Bars;
  readonly decals: Decals;
  readonly shots: Shots;
  readonly floats = new FloatText(10);
  private terrain: Terrain | null = null;
  private tKey = '';
  private set: SetPiece | null = null;
  private setKey = '';
  private boss: Boss | null = null;
  private platforms: THREE.InstancedMesh | null = null;
  private platLight: THREE.PointLight | null = null;
  private platNums: Label[] = [];
  private platSink: number[] = [];
  private bossSign: Label;
  private bossName: Label;
  private teleSign: Label;
  private banner: Label;
  private marker: THREE.Mesh;
  private state: SceneState | null = null;
  private pending: SceneState | null = null;
  private timeline: Timed[] = [];
  private clock = 0;
  private travel = 0;
  private prevStage = '';
  private prevBattle = '';
  private prevRound = -1;
  private prevFoeHp: number[] = [];
  private prevBossHp = -1;
  private prevMech = '';
  private prevBossSt = '';
  private seenFeed = new Set<string>();
  private line = { R: 0.5, L: -0.5, F: -0.5 };
  private spots: Spot[] = [];
  private shake = 0;
  private resPlayed = '';
  /** 0..1 black veil between sets (the view draws it) */
  fade = 0;
  private fadeDir = 0;
  // camera
  private cam = { x: 0, y: 6, z: 14, tx: 0, ty: 1, tz: 0, init: false };
  private user = { yaw: 0, pitch: 0, zoom: 1 };
  private focus: { x: number; y: number; z: number; d: number; pitch: number; yaw: number; lock?: boolean } = { x: 0, y: 1, z: 0, d: 12, pitch: 0.35, yaw: 0 };
  private disposed = false;
  private labelT = 0; private relabel = true; private lastLabelS: SceneState | null = null;
  private teleLead: FoeActor | null = null;
  private confT = 0;

  constructor(private env: SceneEnv) {
    this.root.name = 'expedition';
    const detail = env.quality <= 0 ? 3 : env.quality === 1 ? 5 : env.quality === 2 ? 8 : 10;
    this.crowd = new Crowd(this.mats, { kit: env.kit, detail, appOf: env.appOf, style: env.style });
    this.foes = new Foes(this.mats);
    this.bars = new Bars(this.mats);
    this.decals = new Decals(this.mats);
    this.shots = new Shots(this.mats, this.fx);
    this.bossSign = new Label('word', 768, 240, 1.25); this.bossSign.obj.visible = false;
    this.bossName = new Label('name', 512, 96, 0.42); this.bossName.obj.visible = false;
    this.teleSign = new Label('word', 768, 240, 1.15); this.teleSign.obj.visible = false;
    this.banner = new Label('word', 768, 200, 1.0); this.banner.obj.visible = false;
    this.marker = new THREE.Mesh(markerGeo(), this.mats.glow); this.marker.visible = false;
    this.root.add(this.crowd.root, this.foes.root, this.bars.mesh, this.decals.mesh, this.shots.mesh, this.fx.root, this.floats.root,
      this.bossSign.obj, this.bossName.obj, this.teleSign.obj, this.banner.obj, this.marker);
  }

  /* ---------------------------------------------------------------- RoomScene */
  free(): boolean { return false; }
  groundAt(): number { return 0; }
  solidTop(): number { return Infinity; }

  /* ---------------------------------------------------------------- input */
  look(dx: number, dy: number): void { this.user.yaw = wrap(this.user.yaw + dx); this.user.pitch = Math.max(-0.3, Math.min(0.75, this.user.pitch + dy)); }
  zoom(d: number): void { this.user.zoom = Math.max(0.45, Math.min(2.4, this.user.zoom * Math.pow(1.12, d))); }
  resetView(): void { this.user.yaw = 0; this.user.pitch = 0; this.user.zoom = 1; }

  /** Apply fog / background for the current biome (call once after adding root to a scene, and on set change). */
  private sceneRef: THREE.Scene | null = null;
  attach(scene: THREE.Scene): void { this.sceneRef = scene; this.terrain?.apply(scene); }

  /* ---------------------------------------------------------------- state */
  setState(s: SceneState): void {
    if (this.disposed) return;
    if (!this.state) { this.rebuild(s); this.apply(s, true); return; }
    if (s.setKey !== this.setKey) {
      // fade out, rebuild at black, fade in
      this.pending = s;
      if (this.fadeDir <= 0) this.fadeDir = 1;
      return;
    }
    this.apply(s, false);
  }
  get current(): SceneState | null { return this.state; }

  private rebuild(s: SceneState) {
    this.setKey = s.setKey;
    const mode: TerrainMode = s.kind === 'travel' ? 'path' : 'clearing';
    const biome = s.kind === 'gather' || s.kind === 'town' ? 'meadow' : s.kind === 'dungeon' ? 'dungeon' : s.kind === 'lair' ? 'swamp' : s.biome;
    const night = s.kind === 'rest' && !isTight(biome);
    const tKey = `${biome}|${mode}|${night}`;
    if (tKey !== this.tKey) {
      this.terrain?.dispose();
      this.terrain = new Terrain(this.mats, biome, mode, { night, seed: (jhash(s.ter || biome) % 1000) + 3, quality: this.env.quality });
      this.root.add(this.terrain.root);
      this.tKey = tKey;
      if (this.sceneRef) this.terrain.apply(this.sceneRef);
    }
    this.set?.dispose();
    this.set = buildSet({ mats: this.mats, fx: this.fx, decals: this.decals, secLeft: (u) => this.env.secLeft(u), float: (a, b, x, y, z, sz) => this.floats.spawn(a, b, x, y, z, sz, 2.6), q: this.env.quality }, s);
    this.root.add(this.set.root);
    this.focus = { ...this.set.focus };
    // boss / platforms
    this.boss?.dispose(); this.boss = null;
    this.clearPlatforms();
    if (s.kind === 'boss' && s.boss) {
      this.boss = new Boss(this.mats, jhash(s.boss.name) % 4);
      this.root.add(this.boss.root);
    }
    if (s.kind !== 'battle' && s.kind !== 'boss') { this.foes.clear(); }
    this.timeline.length = 0;
    this.shots.clear();
    this.prevStage = ''; this.prevBattle = ''; this.prevRound = -1; this.prevFoeHp = []; this.prevBossHp = -1; this.prevMech = ''; this.prevBossSt = ''; this.resPlayed = '';
    this.seenFeed.clear();
    this.crowd.setLoopAll(this.set.pose || 'idle');
    this.crowd.march = 0;
  }

  private clearPlatforms() {
    if (this.platforms) { this.platforms.dispose(); this.platforms.removeFromParent(); this.platforms = null; }
    if (this.platLight) { this.platLight.dispose(); this.platLight.removeFromParent(); this.platLight = null; }
    for (const l of this.platNums) l.dispose();
    this.platNums = []; this.platSink = [];
  }

  /** Party spots per kind. */
  private layout(s: SceneState, first: boolean): void {
    const set = this.set!;
    let party: Member[] = s.party;
    let spots: Spot[];
    const enter = first ? undefined : set.party.enter;
    if (s.kind === 'battle' || (s.kind === 'boss' && !s.boss?.zones.length)) {
      const B = s.battle;
      const fronts = B ? B.fronts : ['R' as const];
      spots = partySpots(party, fronts);
      this.line = frontLine(spots);
    } else if (s.kind === 'boss' && s.boss) {
      spots = this.platformSpots(s, party);
      this.line = { R: 2.5, L: -0.5, F: -0.5 };
    } else if (s.kind === 'travel') {
      spots = columnSpots(party.length);
      // centre the column on the camera focus
    } else if (set.slots) {
      const myI = party.findIndex((m) => m.me);
      const sl = set.slots(party.length, myI) || [];
      spots = sl.map((p) => ({ x: p.x, z: p.z, face: 0 }));
    } else {
      spots = circleSpots(party.length, set.party.r, set.party.cx, set.party.cz);
      if (s.kind === 'vote' || s.kind === 'shop' || s.kind === 'dungeon') for (const sp of spots) sp.face = 0;   // look at the posts / stall
      if (s.kind === 'treasure' || s.kind === 'trap' || s.kind === 'event') for (const sp of spots) sp.face = -Math.PI / 2;
      const w = set instanceof Crossroads ? set.winner(s) : null;
      if (w) for (const sp of spots) { sp.x += w.x * 0.6; sp.z += (w.z - set.party.cz) * 0.6; sp.face = Math.atan2(-(w.x * 2 - sp.x), -(w.z - 3 - sp.z)); }
    }
    this.spots = spots;
    this.crowd.setParty(party, spots, { instant: first && s.kind !== 'gather', enter: s.kind === 'gather' ? { x: 8, z: 0, spread: 1.2 } : enter });
  }

  private platformSpots(s: SceneState, party: Member[]): Spot[] {
    const Z = s.boss!.zones;
    const live = Z.filter((z) => !z.gone);
    const use = live.length ? live : Z;
    const per = new Map<number, number>();
    const out: Spot[] = [];
    party.forEach((m, i) => {
      let p = m.me ? (Z.find((z) => z.mine) || use[i % use.length]) : use[i % use.length];
      if (m.me && p.gone) p = use[0];
      const k = per.get(p.n) || 0; per.set(p.n, k + 1);
      const a = k * 2.39996, r = k === 0 ? 0 : 0.42 + Math.sqrt(k) * 0.4;
      out.push({ x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, face: -Math.PI / 2 });
    });
    return out;
  }

  /** Apply a new state within the same set (counts, stages, hp…) and fire the animations of the change. */
  private apply(s: SceneState, first: boolean) {
    const prev = this.state;
    this.state = s;
    const relayout = first || !prev || prev.party.length !== s.party.length || prev.party.some((m, i) => m.login !== s.party[i]?.login || m.side !== s.party[i]?.side)
      || (s.kind === 'boss' && JSON.stringify(s.boss?.zones.map((z) => [z.n, z.gone, z.mine])) !== JSON.stringify(prev.boss?.zones.map((z) => [z.n, z.gone, z.mine])))
      || (s.kind === 'vote' && !!s.vote?.done !== !!prev.vote?.done);
    if (relayout) this.layout(s, first);
    if (s.kind === 'battle' || s.kind === 'boss') this.battle(s, first);
    if (s.kind === 'boss') this.bossEvents(s, first);
    if (s.kind === 'boss' && s.boss?.zones.length) this.ensurePlatforms(s);
    if (s.kind === 'loot' && first) this.crowd.setLoopAll('cheer');
    this.crowd.march = s.kind === 'travel' ? 1 : 0;
    // nicknames over heads in every stage (owner request), following the game's «Ники» setting: off → only mine;
    // 'near' → only the closest few (the crowd caps the count anyway)
    { let n = 'all'; try { n = JSON.parse(localStorage.getItem('l3d.names') || '"all"'); } catch { n = localStorage.getItem('l3d.names') || 'all'; }
      this.crowd.names = n !== 'off'; this.crowd.labelCap = n === 'near' ? 10 : 24; }
    if (s.kind === 'rest') this.crowd.setLoopAll('sit');
  }

  /* ---------------------------------------------------------------- battle */
  private battle(s: SceneState, first: boolean) {
    const B = s.battle;
    if (!B) {
      // boss without a battle block: no foes but the adds
      this.foesFromAdds(s);
      return;
    }
    const newBattle = B.id !== this.prevBattle;
    // foes: battle foes + boss adds
    const foes: FoeState[] = B.foes.slice();
    if (s.kind === 'boss') this.appendAdds(s, foes);
    const fs = s.kind === 'boss' && this.boss ? this.addSpots(foes) : foeSpots(foes, this.line, undefined, undefined, foeSize);
    this.foes.set(foes, fs, newBattle && !first ? true : newBattle && B.stage === 'intro');
    if (newBattle) {
      this.prevBattle = B.id; this.prevFoeHp = foes.map((f) => f.hp); this.prevStage = ''; this.prevRound = -1; this.seenFeed.clear(); this.resPlayed = '';
      if (B.chaos) for (const a of this.crowd.actors) { a.x += (Math.random() - 0.5) * 6; a.z += (Math.random() - 0.5) * 6; }
      for (const l of B.feed) this.seenFeed.add(l);
      this.crowd.setLoopAll('idle');
    }
    const st = B.stage;
    if (st !== this.prevStage || B.round !== this.prevRound) {
      const from = this.prevStage;
      this.prevStage = st; this.prevRound = B.round;
      if (st === 'intro') this.say('В бой!', '#ffe27a', 1.6);
      const beat = resolveBeat(st, from, B.mineK);
      if (beat === 'foes') this.foeAttack(s); else if (beat === 'party') this.partyAttack(s);
      if (st === 'tele') for (const A of this.foes.list) this.foes.windup(A, true);
      else for (const A of this.foes.list) this.foes.windup(A, false);
      if (st === 'trans') { this.say('Новая фаза!', '#ff7af0', 1.6); this.boss?.play('roar'); this.fx.ring(this.boss?.x ?? 6, 0.05, 0, 1, 9, 1.2, '#ff7af0', 1, 0.3); this.shake = 0.6; }
    }
    // hp drops (any stage): hurt + numbers, unless the party attack animation will do it
    foes.forEach((f, i) => {
      const was = this.prevFoeHp[i];
      if (was != null && f.hp < was - 0.001 && st !== 'hit') this.hitFoe(i, was - f.hp, 0);
    });
    this.prevFoeHp = foes.map((f) => f.hp);
    // feed → floating lines
    let fresh = '';
    for (const l of B.feed) if (!this.seenFeed.has(l)) { this.seenFeed.add(l); fresh = l; }
    if (fresh && !first) this.feedLine(fresh);
    // end
    if (st === 'end' && B.res && this.resPlayed !== B.id + B.res.how) {
      this.resPlayed = B.id + B.res.how;
      const how = B.res.how;
      this.say(HOW_RU[how] || 'Бой окончен', how === 'win' ? '#ffe27a' : how === 'lose' ? '#ff9aa8' : '#cfe0ff', 3);
      if (how === 'win') { this.crowd.setLoopAll('cheer'); if (this.boss) { this.boss.dead = true; } this.confetti(); }
      else if (how === 'lose') this.crowd.setLoopAll('down');
      else if (how === 'away') this.foes.flee();
      else if (how === 'retreat') for (const a of this.crowd.actors) { a.tx -= 9; a.tface = Math.PI / 2; }
      if (B.res.xp || B.res.coins) this.timeline.push({ at: this.clock + 1.2, run: () => this.say(`+${B.res!.xp} опыта · +${B.res!.coins} монет`, '#9fe39a', 2.4, 0.42) });
    }
    if (st !== 'end' && this.crowd.actors.length && this.crowd.actors[0].loop === 'cheer' && !newBattle) { /* keep */ }
  }

  private appendAdds(s: SceneState, foes: FoeState[]) {
    const adds = s.boss?.adds || [];
    let i = foes.length;
    for (const a of adds) for (let k = 0; k < Math.min(3, a.count); k++) foes.push({ i: i++, art: a.art, type: a.art, side: 'R', lead: false, hp: a.hp, dead: a.hp <= 0, name: a.name });
  }
  private foesFromAdds(s: SceneState) {
    const foes: FoeState[] = [];
    this.appendAdds(s, foes);
    this.foes.set(foes, this.addSpots(foes), false);
  }
  private addSpots(foes: FoeState[]): Spot[] {
    const bx = this.boss ? this.boss.x : 9;
    return foes.map((_, i) => ({ x: bx - 2.6 - (i % 2) * 0.8, z: (i % 2 ? 1 : -1) * (2.6 + Math.floor(i / 2) * 1.3), face: Math.PI / 2 }));
  }

  private partyAttack(s: SceneState) {
    const alive = this.foes.list.filter((A) => !A.dead || A.deadT < 0.2);
    const targets = alive.length ? alive : this.foes.list;
    const boss = this.boss;
    if (!targets.length && !boss) return;
    const B = s.battle!;
    const drops = B.foes.map((f, i) => Math.max(0, (this.prevFoeHp[i] ?? f.hp) - f.hp));
    const n = Math.min(28, this.crowd.actors.length);
    for (let j = 0; j < n; j++) {
      const a = this.crowd.actors[j];
      if (a.loop === 'down') continue;
      const delay = (j / n) * 1.1 + Math.random() * 0.25;
      const A = targets.length ? targets[(j * 7 + 3) % targets.length] : null;
      this.timeline.push({ at: this.clock + delay, run: () => this.attackOf(a, A, drops) });
    }
    // the hp drop of each foe pops at its first impact (or a little later if nobody reached it)
    this.dropLeft = drops.slice();
    B.foes.forEach((_, i) => { if (drops[i] > 0.001) this.timeline.push({ at: this.clock + 1.6, run: () => this.popDrop(i) }); });
    if (boss && s.boss) {
      const d = this.prevBossHp >= 0 ? Math.max(0, this.prevBossHp - s.boss.hp) : 0;
      this.timeline.push({ at: this.clock + 1.0, run: () => { boss.play('hurt'); this.fx.impact(boss.x - 1, 2.2, 0, -1, 0, _c.set('#ffffff')); if (d > 0) this.floats.spawn(`−${Math.round(d * 100)}%`, '#ffe27a', boss.x, boss.top + 0.6, 0, 0.8); this.shake = 0.35; } });
    }
  }

  private attackOf(a: Actor, A: FoeActor | null, drops: number[]) {
    void drops;
    const role = a.m.role;
    const tgt = A ? this.foes.pos(A, _t) : this.boss ? _t.set(this.boss.x - 0.8, 2.2, this.boss.z) : null;
    if (!tgt) return;
    const tx = tgt.x, ty = tgt.y, tz = tgt.z;
    const hy = 0.7;
    if (role === 'archer') {
      this.crowd.play(a, 'shoot');
      this.timeline.push({ at: this.clock + 0.55, run: () => this.shots.fire(0, a.x, hy + 0.3, a.z, tx, ty, tz, null, () => this.landed(A, tx, ty, tz, 1, 0, _c.set('#ffffff'))) });
    } else if (role === 'mage' || role === 'necromancer') {
      this.crowd.play(a, 'cast');
      const col = role === 'necromancer' ? _v2.set(0.7, 1, 0.5) : _v2.set(0.55, 0.75, 1);
      const c = new THREE.Color(col.x, col.y, col.z);
      this.timeline.push({ at: this.clock + 0.35, run: () => this.shots.fire(1, a.x, hy + 0.6, a.z, tx, ty, tz, c, () => { this.landed(A, tx, ty, tz, 1, 0, c); this.fx.ring(tx, 0.05, tz, 0.2, 1.6, 0.5, c, 0.9, 0.4); }) });
    } else if (role === 'priest') {
      this.crowd.play(a, 'heal');
      const ally = this.crowd.actors[(Math.random() * this.crowd.actors.length) | 0];
      if (ally) this.timeline.push({ at: this.clock + 0.3, run: () => this.shots.fire(2, a.x, hy + 0.7, a.z, ally.x, 1.0, ally.z, null, () => { this.fx.holySparkles(ally.x, 0.6, ally.z, 8); this.fx.ring(ally.x, 0.05, ally.z, 0.2, 1.0, 0.6, '#79e08f', 0.9, 0.5, 0.3); }) });
    } else {
      // melee: leap to the foe, strike, leap back
      this.crowd.play(a, 'attack', 1.0, undefined, tx, tz);
      this.timeline.push({ at: this.clock + 0.45, run: () => {
        const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz) || 1;
        this.landed(A, tx - dx / d * 0.4, ty, tz - dz / d * 0.4, dx / d, dz / d, _c.set('#ffffff'));
        // the slash: a fan of bright streaks across the target
        for (let k = 0; k < 7; k++) { const an = -0.9 + k * 0.3; this.fx.emit(4, tx - dx / d * 0.5, ty + 0.3 + Math.sin(an) * 0.4, tz - dz / d * 0.5, Math.cos(an) * dz / d * 5, Math.sin(an) * 3, -Math.cos(an) * dx / d * 5, 0.2, 0.5, 0.1, 1, 0.95, 0.8, 1, 0, 2, true, an); }
      } });
    }
  }

  private dustT = 0;
  private dropLeft: number[] = [];
  /** A blow landed on foe i: big hit fx, its hp drop number once. */
  private landed(A: FoeActor | null, x: number, y: number, z: number, dx: number, dz: number, col: THREE.Color) {
    this.fx.impact(x, y, z, dx, dz, col);
    this.fx.emit(1, x, y + 0.2, z, 0, 0.6, 0, 0.28, 1.0, 0.3, 1, 0.95, 0.6, 1, 0, 0, false, this.fx.rnd() * 6, 8);
    this.fx.ring(x, 0.05, z, 0.2, 1.4, 0.35, '#fff2c8', 1, 0.2);
    if (this.terrain) { const d = this.terrain.dust; this.fx.dust(x, 0, z, 7, d.r, d.g, d.b, 1.0, 0.8); this.decals.scorch(x, z); }
    this.shake = Math.max(this.shake, 0.18);
    if (A) { this.foes.hurt(A); this.popDrop(this.foes.list.indexOf(A)); }
  }
  private popDrop(i: number) {
    const d = this.dropLeft[i];
    if (!(d > 0.001)) return;
    this.dropLeft[i] = 0;
    const A = this.foes.list[i]; if (!A) return;
    const p = this.foes.pos(A, _v);
    const crit = d > 0.45;
    this.floats.spawn(`${crit ? 'Крит! ' : ''}−${Math.max(1, Math.round(d * 100))}%`, crit ? '#ffb02a' : '#ffffff', p.x, p.y + this.foes.top(A) * 0.6 + 0.7, p.z, crit ? 0.7 : 0.58);
  }

  /** Floating «−N%» over a foe (party hit landed / hp dropped). */
  private hitFoe(i: number, d: number, kind: number) {
    const A = this.foes.list[i];
    if (!A) return;
    this.foes.hurt(A);
    const p = this.foes.pos(A, _v);
    if (kind === 0) this.fx.impact(p.x, p.y, p.z, 1, 0, _c.set('#ffffff'));
    const crit = d > 0.45;
    this.floats.spawn(`${crit ? 'Крит! ' : ''}−${Math.max(1, Math.round(d * 100))}%`, crit ? '#ffb02a' : '#ffffff', p.x, p.y + this.foes.top(A) * 0.6 + 0.4, p.z, crit ? 0.62 : 0.5);
  }

  private foeAttack(s: SceneState) {
    const B = s.battle!;
    const live = this.foes.list.filter((A) => !A.dead);
    live.forEach((A, j) => {
      const side = A.f.side;
      const lx = side === 'L' ? this.line.L - 0.4 : side === 'F' ? A.hx : this.line.R + 0.4;
      const lz = side === 'F' ? this.line.F - 0.4 : A.hz * 0.6;
      this.timeline.push({ at: this.clock + j * 0.12, run: () => {
        this.foes.lunge(A, lx, lz, 0.85);
        this.timeline.push({ at: this.clock + 0.42, run: () => {
          this.fx.impact(lx, 0.8, lz, side === 'L' ? 1 : side === 'F' ? 0 : -1, side === 'F' ? 1 : 0, _c.set('#c9a36a'));
          this.shake = Math.max(this.shake, 0.25);
          // the front row blocks, someone gets hurt
          let k = 0;
          for (const a of this.crowd.actors) {
            if (a.m.zone !== 0 && k > 0) continue;
            const near = Math.hypot(a.x - lx, a.z - lz) < 2.2;
            if (!near) continue;
            this.crowd.play(a, a.m.zone === 0 ? 'block' : 'hurt');
            if (++k > 3) break;
          }
        } });
      } });
    });
    const me = this.crowd.me;
    if (me && B.mineText) this.timeline.push({ at: this.clock + 0.8, run: () => { this.crowd.play(me, /задели|сразили/.test(B.mineText) ? 'hurt' : 'block'); this.floats.spawn(B.mineText, /Отбили/.test(B.mineText) ? '#9fe39a' : '#ff9aa8', me.x, 2.0, me.z, 0.42); } });
    else if (live.length) this.timeline.push({ at: this.clock + 0.9, run: () => this.say('Отбили!', '#9fe39a', 1.2, 0.6) });
  }

  private feedLine(l: string) {
    const c = this.partyCenter(_v);
    this.floats.spawn(l.length > 34 ? l.slice(0, 33) + '…' : l, '#fff6e0', c.x - 1.5, 3.3, c.z, 0.34, 2.4);
  }

  /* ---------------------------------------------------------------- boss events */
  private bossEvents(s: SceneState, first: boolean) {
    const G = s.boss, boss = this.boss;
    if (!G || !boss) return;
    boss.rage = G.rage;
    const B = s.battle;
    if (!B && G.st !== this.prevBossSt) {
      if (this.prevBossSt === 'party' && G.st !== 'party' && !first) this.partyAttack({ ...s, battle: { ...dummyBattle, foes: [] } });
      if (G.st === 'trans') { boss.play('roar'); this.say('Новая фаза!', '#ff7af0', 1.6); this.shake = 0.6; }
      this.prevBossSt = G.st;
    }
    if (B && this.prevBossSt !== B.stage) {
      if (this.prevBossSt === 'party' && B.stage !== 'party' && B.stage !== 'hit' && !first) this.partyAttack(s);
      this.prevBossSt = B.stage;
    }
    const mk = G.mech ? G.mech.name + G.mech.fam + (G.mech.fake ? 'f' : '') : '';
    if (mk !== this.prevMech) {
      const was = this.prevMech;
      this.prevMech = mk;
      if (G.mech) {
        if (G.mech.fake) { boss.play('feint'); this.say('ФИНТ!', '#ff9aa8', 1.4); }
        else boss.play('roar');
        this.fx.ring(boss.x, 0.05, boss.z, 1, 6, 0.9, G.mech.fake ? '#ff4a5a' : G.mech.silence ? '#b87aff' : '#ffb02a', 1, 0.3);
      } else if (was && !first && !/f$/.test(was)) {
        boss.play('swing');
        this.timeline.push({ at: this.clock + 0.65, run: () => { this.fx.impact(boss.x - 3, 0.6, 0, -1, 0, _c.set('#ffb02a')); this.fx.ring(boss.x - 4, 0.05, 0, 0.5, 6, 0.7, '#ffb02a', 1, 0.3); this.shake = 0.6;
          for (const a of this.crowd.actors) if (Math.random() < 0.3) this.crowd.play(a, a.m.zone === 0 ? 'block' : 'hurt'); } });
      }
    }
    if (this.prevBossHp >= 0 && G.hp < this.prevBossHp - 0.001 && !this.timeline.length) { boss.play('hurt'); this.floats.spawn(`−${Math.round((this.prevBossHp - G.hp) * 100)}%`, '#ffe27a', boss.x, boss.top + 0.6, 0, 0.8); }
    this.prevBossHp = G.hp;
  }

  private ensurePlatforms(s: SceneState) {
    const Z = s.boss!.zones;
    if (!this.platforms || this.platforms.count !== Z.length) {
      this.clearPlatforms();
      this.platforms = new THREE.InstancedMesh(platformGeo(), this.mats.tint, Math.max(1, Z.length));
      this.platforms.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, Z.length) * 3).fill(1), 3);
      this.platforms.frustumCulled = false; this.platforms.name = 'exp-platforms';
      this.root.add(this.platforms);
      if (!this.platLight) { this.platLight = new THREE.PointLight('#3ae8ff', 16, 15, 1.6); this.platLight.position.set(0, 1.2, -1); this.root.add(this.platLight); }
      { let cx = 0, cz = 0; for (const z of Z) { cx += z.x; cz += z.z; } this.platLight.position.set(cx / Math.max(1, Z.length), 1.2, cz / Math.max(1, Z.length)); }
      for (const z of Z) { const l = new Label('num', 128, 128, 0.85); l.set(String(z.n)); this.root.add(l.obj); this.platNums.push(l); this.platSink.push(z.gone ? 1 : 0); }
    }
  }

  /* ---------------------------------------------------------------- helpers */
  private say(text: string, color: string, life = 1.6, size = 0.75) {
    const c = this.focusPoint(_v);
    this.floats.spawn(text, color, c.x, c.y + 2.4, c.z, size, life);
  }
  private confetti() {
    const c = this.partyCenter(_v);
    for (let i = 0; i < 40; i++) {
      const a = this.fx.rnd() * 6.28, sp = 2 + this.fx.rnd() * 3, col = CONF[i % CONF.length];
      this.fx.emit(i % 3 ? 2 : 1, c.x, 1.5, c.z, Math.cos(a) * sp, 4 + this.fx.rnd() * 3, Math.sin(a) * sp, 2.2, 0.14, 0.1, col[0], col[1], col[2], 1, -5, 0.6, false, a, 6);
    }
  }
  private partyCenter(out: THREE.Vector3): THREE.Vector3 {
    let x = 0, z = 0, n = 0;
    for (const a of this.crowd.actors) { x += a.x; z += a.z; n++; }
    return n ? out.set(x / n, 0, z / n) : out.set(0, 0, 0);
  }
  private focusPoint(out: THREE.Vector3): THREE.Vector3 { return out.set(this.cam.tx, this.cam.ty, this.cam.tz); }

  /* ---------------------------------------------------------------- frame */
  update(dt: number, t: number, camera: THREE.Camera): void {
    if (this.disposed) return;
    dt = Math.min(dt, 0.1);
    this.clock += dt;
    this.mats.time.value = t;
    // fade between sets
    if (this.fadeDir > 0) {
      this.fade = Math.min(1, this.fade + dt / 0.35);
      if (this.fade >= 1 && this.pending) { const p = this.pending; this.pending = null; this.rebuild(p); this.apply(p, true); this.cam.init = false; this.fadeDir = -1; }
    } else if (this.fadeDir < 0) { this.fade = Math.max(0, this.fade - dt / 0.6); if (this.fade <= 0) this.fadeDir = 0; }
    // timeline (scheduled animation steps)
    for (let i = 0; i < this.timeline.length; i++) {
      const e = this.timeline[i];
      if (e.at <= this.clock) { this.timeline.splice(i, 1); i--; try { e.run(); } catch (err) { console.warn('[l3d] expedition anim', err); } }
    }
    const s = this.state;
    this.decals.begin(); this.decals.marksStep(dt); this.bars.begin();
    if (s) {
      if (s.kind === 'travel') {
        this.travel += dt * 1.9; this.terrain?.scroll(this.travel);
        // footstep dust behind a couple of walkers (cheap: ~9 puffs per second)
        this.dustT -= dt;
        if (this.dustT <= 0 && this.env.quality > 0 && this.terrain) {
          this.dustT = 0.22;
          const A = this.crowd.actors, d = this.terrain.dust;
          for (let k = 0; k < 2 && A.length; k++) { const a = A[Math.floor(this.fx.rnd() * A.length)]; this.fx.dust(a.x - 0.25, 0, a.z, 1, d.r, d.g, d.b, 0.45, 0.35); }
        }
      }
      this.labelT += dt;
      this.relabel = this.labelT >= 0.25 || s !== this.lastLabelS;
      if (this.relabel) { this.labelT = 0; this.lastLabelS = s; }
      if (this.set) { this.set.relabel = this.relabel; this.set.update(dt, t, s); }
      this.frameBattle(dt, t, s);
    }
    this.terrain?.update(t);
    this.crowd.camPos.copy((camera as THREE.PerspectiveCamera).position);
    this.crowd.update(dt, t);
    this.foes.update(dt, t);
    this.boss?.update(dt, t);
    this.shots.update(dt);
    this.shadows();
    this.markers(t, s);
    this.decals.end(); this.bars.end();
    this.floats.update(dt);
    const cam = camera as THREE.PerspectiveCamera;
    this.camera(dt, t, cam, s);
    this.crowd.declutter(cam);
    this.fx.update(dt, cam, (typeof innerHeight === 'number' ? innerHeight : 720));
  }

  private frameBattle(dt: number, t: number, s: SceneState) {
    const B = s.battle;
    // zone tints under the party (battle) and wounded glow
    if (s.kind === 'battle' || s.kind === 'boss') {
      const healer = s.myRole === 'priest';
      if (s.kind === 'battle') this.zoneDecals();
      for (const a of this.crowd.actors) {
        if (a.m.low >= 0) {
          this.decals.add(a.x, 0.02, a.z, healer ? 0.85 : 0.65, '#5aff8a', healer ? 0.95 : 0.55, 0.2, healer ? 7 : 4);
          this.bars.add(a.x, (a.av ? a.av.headTop : 1.15) + a.y + (a.label ? 0.75 : 0.3), a.z, a.m.low, 0.6, 0.08, 2);
        }
      }
      for (const A of this.foes.list) {
        if (A.dead && A.deadT > 0.8) continue;
        const p = this.foes.barPos(A, _v);
        this.bars.add(p.x, p.y, p.z, A.shown, A.f.lead ? 0.95 : 0.7, A.f.lead ? 0.12 : 0.09, 0);
        if (A.act === 'windup') this.decals.add(A.x, 0.02, A.z, this.foes.radius(A) * 2 + 0.3, '#ff3a4a', 0.85, 0.5, 9);
      }
    }
    // victory: confetti keeps popping while the result is shown
    if (B?.stage === 'end' && B.res?.how === 'win') { this.confT += dt; if (this.confT > 1.3) { this.confT = 0; this.confetti(); } }
    // telegraph word over the leading foe
    const tele = B?.stage === 'tele' && B.tele ? B.tele : null;
    if (tele) {
      if (this.relabel || !this.teleLead) this.teleLead = this.foes.list.find((A) => A.f.lead && !A.dead) || this.foes.list.find((A) => !A.dead) || null;
      const lead = this.teleLead;
      const p = lead ? this.foes.pos(lead, _v2) : _v2.set(this.line.R + 4, 0, 0);
      if (this.relabel) this.teleSign.set(tele.word.toUpperCase(), `${tele.ok ? '✓ принято · ' : ''}${tele.need ? `отбили ${tele.got}/${tele.need}` : ''}${tele.text ? ' · ' + tele.text : ''}`);
      this.teleSign.obj.position.set(p.x, (lead ? lead.y + this.foes.top(lead) : 1.5) + 1.25 + Math.sin(t * 4) * 0.08, p.z);
      const k = 1 + Math.sin(t * 6) * 0.04;
      this.teleSign.obj.scale.set(1.15 * (768 / 240) * k, 1.15 * k, 1);
      this.teleSign.obj.visible = true;
    } else this.teleSign.obj.visible = false;
    // boss
    const G = s.boss, boss = this.boss;
    if (G && boss) {
      boss.x = Math.max(this.line.R + 6.5, 8); boss.z = 0;
      boss.scale = 2.0 + 0.2 * (G.ph - 1);
      this.bars.add(boss.x, boss.top + 0.5, boss.z, G.hp, 3.2, 0.24, 1);
      if (this.relabel) this.bossName.set(`${G.name} · фаза ${G.ph}/${G.phs}${G.rage ? ' · ярость' : ''}`); this.bossName.obj.position.set(boss.x, boss.top + 0.95, boss.z); this.bossName.obj.visible = true;
      const M = G.mech;
      if (M) {
        if (this.relabel) {
        const word = M.fake ? 'ФИНТ — НЕ ПИШИ' : M.silence ? 'ТИШИНА' : M.fam === 'position' ? (s.cmds[0]?.text || M.name).toUpperCase() : (M.how || M.words[0] || M.name).toUpperCase();
        const warn = M.fake || M.silence;
        this.bossSign.set(word, `${M.icon} ${M.name}${M.need ? ` · ${M.got}/${M.need}` : ''}${s.until ? ' · ' + this.env.secLeft(s.until) + ' с' : ''}`, warn ? '#ffb0b8' : '');
        }
        const warn = M.fake || M.silence;
        this.bossSign.obj.position.set(boss.x - 3.2, Math.min(boss.top + 0.9, 5.2) + Math.sin(t * 3) * 0.1, boss.z + 0.8);
        const k = warn ? 1 + Math.abs(Math.sin(t * 10)) * 0.06 : 1;
        this.bossSign.obj.scale.set(1.25 * (768 / 240) * k, 1.25 * k, 1);
        this.bossSign.obj.visible = true;
        if (M.fake && Math.sin(t * 12) > 0.6) this.decals.add(boss.x, 0.03, boss.z, 4.5, '#ff2a4a', 0.6, 1, 0);
        if (M.silence) this.decals.add(boss.x - 4, 0.03, 0, 7, '#9a5aff', 0.35, 1, 3);
      } else this.bossSign.obj.visible = false;
      if (G.rage) this.decals.add(boss.x, 0.03, boss.z, 3.2, '#ff3a2a', 0.7, 0.4, 6);
      // platforms
      if (this.platforms && G.zones.length) {
        const m = _m4;
        for (let i = 0; i < G.zones.length && i < this.platSink.length; i++) {
          const z = G.zones[i];
          this.platSink[i] += ((z.gone ? 1 : 0) - this.platSink[i]) * Math.min(1, dt * 1.2);
          const sink = this.platSink[i], y = -sink * 2.2;
          const r = 1.25 + 0.15 * Math.sqrt(Math.max(1, this.crowd.actors.length / Math.max(1, G.zones.length)));
          m.makeScale(r * 1.1, 1, r * 1.1).setPosition(z.x, y, z.z);
          this.platforms!.setMatrixAt(i, m);
          const c = z.danger ? _c.setRGB(1.35, 0.45 + 0.2 * Math.sin(t * 8), 0.45) : z.goal || z.safe ? _c.setRGB(0.75, 1.3, 0.8) : _c.setRGB(1, 1, 1);
          this.platforms!.setColorAt(i, c);
          const lbl = this.platNums[i];
          lbl.obj.position.set(z.x, y + 2.05 + (z.goal ? 0.2 + Math.abs(Math.sin(t * 4)) * 0.25 : 0), z.z);
          lbl.obj.visible = sink < 0.6;
          if (sink < 0.6) {
            if (z.danger) this.decals.add(z.x, y + 0.06, z.z, r * 1.15, '#ff2a3a', 1, 0.75, 8);
            else if (z.goal) this.decals.add(z.x, y + 0.06, z.z, r * 1.25, '#3aff6a', 1, 0.7, 6);
            else if (z.safe) this.decals.add(z.x, y + 0.06, z.z, r * 1.1, '#3aff6a', 0.7, 0, 0);
            if (z.mine) this.decals.add(z.x, y + 0.07, z.z, r * 0.55, '#ffd34d', 0.8, 0, 0);
            if (!z.danger && !z.goal && !z.safe) this.decals.add(z.x, y + 0.03, z.z, r * 1.5, '#3ae8ff', 0.2, 1, 1.6);   // rune glow bleeding onto the ground
          }
        }
        this.platforms.instanceMatrix.needsUpdate = true;
        if (this.platforms.instanceColor) this.platforms.instanceColor.needsUpdate = true;
      }
    } else { this.bossSign.obj.visible = false; this.bossName.obj.visible = false; }
  }

  /** One soft tint per formation zone (and wing) under the party: shields / melee / ranged / priests. */
  private zoneDecals() {
    const acc = this.zacc; acc.fill(0);
    for (const a of this.crowd.actors) {
      const w = a.m.side === 'L' ? 1 : a.m.side === 'F' ? 2 : 0, k = (w * 4 + a.m.zone) * 4;
      acc[k] += a.x; acc[k + 1] += a.z; acc[k + 2]++;
    }
    for (const a of this.crowd.actors) {
      const w = a.m.side === 'L' ? 1 : a.m.side === 'F' ? 2 : 0, k = (w * 4 + a.m.zone) * 4;
      const cx = acc[k] / acc[k + 2], cz = acc[k + 1] / acc[k + 2];
      acc[k + 3] = Math.max(acc[k + 3], Math.hypot(a.tx - cx, a.tz - cz));
    }
    for (let k = 0; k < acc.length; k += 4) {
      if (!acc[k + 2]) continue;
      this.decals.add(acc[k] / acc[k + 2], 0.01, acc[k + 1] / acc[k + 2], acc[k + 3] + 0.75, ZONE_COL[(k / 4) % 4], 0.4, 1, 0);
    }
  }
  private zacc = new Float32Array(12 * 4);

  /** Soft contact shadows under everybody (grounds the figures, separates a crowd). */
  private shadows() {
    for (const a of this.crowd.actors) this.decals.add(a.x, 0.005, a.z, 0.5, '#000000', 1, 1, 0);
    for (const A of this.foes.list) if (!(A.dead && A.deadT > 7)) this.decals.add(A.x, 0.005, A.z, this.foes.radius(A) * 1.25, '#000000', 0.95, 1, 0);
    if (this.boss && !this.boss.dead) this.decals.add(this.boss.x, 0.005, this.boss.z, 1.15 * this.boss.scale, '#000000', 0.95, 1, 0);
  }

  private markers(t: number, s: SceneState | null) {
    const me = this.crowd.me;
    if (me && s) {
      this.decals.add(me.x, 0.03, me.z, 0.75, '#ffd34d', 1, 0, 5);
      const top = (me.av ? me.av.headTop : 1.15) + me.y + (me.label ? 0.95 : 0.45);
      this.marker.position.set(me.x, top + Math.abs(Math.sin(t * 3.2)) * 0.18, me.z);
      this.marker.rotation.y = t * 2;
      this.marker.visible = true;
    } else this.marker.visible = false;
  }

  private camera(dt: number, t: number, cam: THREE.PerspectiveCamera, s: SceneState | null) {
    const F = this.focus;
    let fx = F.x, fy = F.y, fz = F.z, d = F.d, pitch = F.pitch, yaw = F.yaw;
    if (s && (s.kind === 'battle' || s.kind === 'boss')) {
      const pc = this.partyCenter(_v);
      let ex = 0, ez = 0, n = 0;
      for (const A of this.foes.list) if (!A.dead) { ex += A.hx; ez += A.hz; n++; }
      if (this.boss) { ex += this.boss.x * 2; ez += this.boss.z * 2; n += 2; }
      const foeC = n ? _v2.set(ex / n, 0, ez / n) : _v2.set(pc.x + 5, 0, pc.z);
      const multi = !!s.battle?.multi;
      fx = multi ? pc.x * 0.6 + foeC.x * 0.4 : (pc.x + foeC.x) / 2; fz = multi ? pc.z : (pc.z + foeC.z) / 2 + 0.6; fy = this.boss ? 1.2 : -0.2;
      let span = 0;
      if (!multi && n && !this.boss) {
        // single front: centre on the whole fight (party spots + the far edge of the pack), not on the two centres
        let x0 = Infinity, x1 = -Infinity;
        for (const sp of this.spots) if (sp) { x0 = Math.min(x0, sp.x); x1 = Math.max(x1, sp.x); }
        for (const A of this.foes.list) if (!A.dead) { const m = foeSize(this.foes.art(A))[0] * 0.55 * A.sc; x0 = Math.min(x0, A.hx - m); x1 = Math.max(x1, A.hx + m); }
        if (x1 > x0) { fx = (x0 + x1) / 2; span = (x1 - x0) / 2; }
      }
      let r = extent(this.spots, fx, fz);
      for (const A of this.foes.list) if (!A.dead) r = Math.max(r, Math.hypot(A.hx - fx, A.hz - fz) + Math.max(1.2, foeSize(this.foes.art(A))[0] * 0.65 * A.sc));
      if (this.boss) r = Math.max(r, Math.abs(this.boss.x - fx) + 2);
      d = Math.max(this.boss ? 14 : 9.5, r * (multi ? 1.5 : 1.42)) / Math.max(0.45, s.battle?.cam ?? 1) * (isTight(s.biome) ? 0.85 : 1);
      d = Math.max(d, span / 0.62);   // the whole width of the fight fits a 16:9 view
      pitch = multi ? 0.62 : this.boss ? 0.34 : 0.38; yaw = multi ? 0.25 : 0.12;
      yaw += Math.sin(t * 0.06) * 0.12;
    } else if (s && s.kind === 'travel') {
      const n = this.crowd.actors.length;
      fx = -Math.ceil(n / (n > 24 ? 3 : 2)) * 0.55; fz = 0; fy = 1.0;
      d = 9 + Math.sqrt(n) * 1.2; pitch = 0.28; yaw = 0.75 + Math.sin(t * 0.05) * 0.35;
    } else if (s && s.kind === 'gather') {
      d = Math.max(F.d, 8 + Math.sqrt(this.crowd.actors.length) * 1.4);
      yaw += Math.sin(t * 0.05) * 0.1;
    } else {
      // F.lock: the set frames its key object itself (28.10 event / puzzle sets) — the party size must not push the camera back
      d = s && (s.kind === 'shop' || F.lock) ? F.d : Math.max(F.d, 7 + Math.sqrt(this.crowd.actors.length) * 1.3);
      yaw += Math.sin(t * 0.05) * 0.12;
    }
    d *= this.user.zoom; yaw += this.user.yaw; pitch = Math.max(0.05, Math.min(1.25, pitch + this.user.pitch));
    const px = fx + Math.sin(yaw) * Math.cos(pitch) * d, py = fy + Math.sin(pitch) * d, pz = fz + Math.cos(yaw) * Math.cos(pitch) * d;
    const C = this.cam;
    if (!C.init) { C.x = px; C.y = py; C.z = pz; C.tx = fx; C.ty = fy; C.tz = fz; C.init = true; }
    const k = Math.min(1, dt * 2.2);
    C.x += (px - C.x) * k; C.y += (py - C.y) * k; C.z += (pz - C.z) * k;
    C.tx += (fx - C.tx) * k; C.ty += (fy - C.ty) * k; C.tz += (fz - C.tz) * k;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 1.6);
    const sh = this.shake * this.shake * 0.25;
    cam.position.set(C.x + Math.sin(t * 47) * sh, Math.max(0.4, C.y) + Math.sin(t * 61) * sh, C.z + Math.cos(t * 53) * sh);
    cam.lookAt(C.tx, C.ty, C.tz);
    if (Math.abs(cam.fov - FOV) > 0.01) { cam.fov = FOV; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  }

  /** Perf/debug numbers. */
  stats(): { actors: number; detailed: number; foes: number; kind: string } {
    return { actors: this.crowd.actors.length, detailed: this.crowd.detailedCount, foes: this.foes.list.length, kind: this.state?.kind || 'off' };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.timeline.length = 0;
    this.terrain?.dispose(); this.terrain = null;
    this.set?.dispose(); this.set = null;
    this.boss?.dispose(); this.boss = null;
    this.clearPlatforms();
    this.crowd.dispose(); this.foes.dispose(); this.bars.dispose(); this.decals.dispose(); this.shots.dispose(); this.fx.dispose(); this.floats.dispose();
    for (const l of [this.bossSign, this.bossName, this.teleSign, this.banner]) l.dispose();
    this.marker.removeFromParent();
    this.mats.dispose();
    disposeArt(); disposeEventArt();
    this.root.removeFromParent();
    this.sceneRef = null;
  }
}

const _m4 = new THREE.Matrix4();
/** cinematic field of view while the expedition is shown */
export const FOV = 50;
const CONF: [number, number, number][] = [[1, 0.4, 0.5], [1, 0.85, 0.3], [0.4, 0.8, 1], [0.5, 0.95, 0.5], [0.85, 0.5, 1]];
/**
 * Which side's blows land on this battle-stage change: live data resolves the enemy telegraph in 'tele2' (site 28.10),
 * older captures in 'hit' right after 'tele' (or with b.mine.k === 'tele' when we join mid-beat); 'hit' otherwise = the party.
 */
export function resolveBeat(st: string, from: string, mineK: string): 'foes' | 'party' | null {
  if (st === 'tele2') return 'foes';
  if (st !== 'hit') return null;
  return from === 'tele' || (from === '' && mineK === 'tele') ? 'foes' : 'party';
}
const dummyBattle = { id: 'boss', round: 1, maxR: 0, stage: 'hit', fronts: ['R' as const], multi: false, chaos: false, two: false, foes: [], foesAlive: 0, tele: null, res: null, feed: [], mineK: '', mineText: '', cam: 1, fighters: 0,
  me: { st: 'out' as const, hp: null, side: '' as const, role: 'recruit' } };
const wrap = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
