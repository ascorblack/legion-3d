/**
 * «Сцены похода» player: the 3D expedition view (src/expedition ExpeditionView — the same DelayBuffer → adapter →
 * scene path as the real one) fed with a mock view (src/debug/questMocks.ts) or with the deterministic FakeQuest
 * timeline (src/quest/fake.ts: auto-play through every stage, a scrubber, pause, ×1/×2/×4).
 * Its views go ONLY into this player's own ExpeditionView: not to the store, not to the bus, not to the site's
 * LGQuest, never to the server. The scene is a client-only space (src/debug/space.ts).
 */
import * as THREE from 'three';
import type { RoomScene } from '../contracts/ext';
import type { Appearance } from '../contracts';
import type { AvatarKit } from '../contracts/modules';
import { ExpeditionView } from '../expedition';
import { FakeQuest, rebase } from '../quest/fake';
import type { QuestPayload, Role } from '../quest/model';
import { mockById, type QuestMock } from './questMocks';

export interface ScenesHost {
  uiRoot: HTMLElement;
  kit: AvatarKit | null;
  quality(): number;
  me(): { login: string; role: string; app: Appearance | null };
  scene: THREE.Scene;
}

export const SEG_RU: Record<string, string> = { gather: 'Сбор', map: 'Перекрёсток', travel: 'Дорога', battle: 'Бой', treasure: 'Сокровищница', rest: 'Привал', bossgen: 'Босс', loot: 'Добыча', off: 'Конец' };

export class ScenePlayer {
  view: ExpeditionView | null = null;
  /** What plays: a mock id, 'auto' (FakeQuest), or '' (nothing). */
  playing = '';
  fake: FakeQuest | null = null;
  /** Plan time of the auto-play (ms at speed 1). */
  planMs = 0;
  speed = 1;
  paused = false;
  private pushT = 0;
  private mock: QuestMock | null = null;
  constructor(private host: ScenesHost) {}

  get active(): boolean { return !!this.view?.scene; }
  get scene(): RoomScene | null { return (this.view?.scene as unknown as RoomScene) || null; }

  private ensure(): ExpeditionView {
    if (this.view) return this.view;
    const me = this.host.me();
    this.view = new ExpeditionView({
      uiRoot: this.host.uiRoot, kit: this.host.kit, style: String(me.app?.styleId || 'cats'), quality: () => this.host.quality(),
      me: () => { const m = this.host.me(); return { login: m.login, role: m.role }; },
      appOf: (l) => (l === this.host.me().login ? this.host.me().app : null),
      hint: 'Отладка: сцена похода · мышь (зажать) — осмотреться · колесо — ближе/дальше · Esc — назад', hintBottom: 58,
    });
    return this.view;
  }
  /** Open the 3D scene (once) — the caller swaps it in as the space. */
  open(): RoomScene {
    const v = this.ensure();
    const sc = v.scene || v.open(this.host.scene);
    return sc as unknown as RoomScene;
  }
  private reset(): void { this.view?.push({ on: false }, Date.now()); }

  /** Show one mock scene (rebuilt with fresh timers). */
  playMock(id: string): boolean {
    const m = mockById(id); if (!m) return false;
    this.mock = m; this.playing = id; this.fake = null;
    this.reset();
    this.pushMock();
    return true;
  }
  private pushMock(): void {
    const v = this.view; const m = this.mock; if (!v || !m) return;
    const me = this.host.me();
    const p = m.build({ login: me.login, role: me.role, now: Date.now() });
    v.push(p, Date.now());
  }
  /** Auto-play the FakeQuest from plan second `sec`. */
  playAuto(sec = 0): void {
    const me = this.host.me();
    if (!this.fake || this.fake.login !== me.login) this.fake = new FakeQuest({ login: me.login, role: (me.role || 'archer') as Role, speed: 1, dl: 0 });
    this.mock = null; this.playing = 'auto';
    this.seek(sec);
  }
  seek(sec: number): void {
    if (!this.fake) return;
    this.planMs = Math.max(0, Math.min(this.fake.duration - 1, sec * 1000));
    this.reset(); this.pushT = 1;
  }
  get duration(): number { return this.fake ? this.fake.duration / 1000 : 0; }
  get planSec(): number { return this.planMs / 1000; }
  /** Segments of the auto-play plan: [kind, from s, to s]. */
  segments(): [string, number, number][] { return this.fake ? this.fake.segs.map((s) => [s.k, s.from / 1000, s.to / 1000] as [string, number, number]) : []; }
  /** The current scene kind (adapter) and title. */
  status(): { kind: string; title: string } { const s = this.view?.sceneState; return { kind: s?.kind || '—', title: s?.title || '' }; }

  /** Per frame (only while active): advance the auto-play, feed the view at 2 Hz, animate. */
  frame(dt: number, t: number, camera: THREE.Camera): void {
    const v = this.view; if (!v || !v.scene) return;
    if (this.playing === 'auto' && this.fake) {
      if (!this.paused) this.planMs += dt * 1000 * this.speed;
      if (this.planMs >= this.fake.duration) this.planMs = 0;   // loop
      this.pushT += dt;
      if (this.pushT >= 0.5) {
        this.pushT = 0;
        const raw = this.fake.at(this.planMs) as QuestPayload;
        const now = Date.now();
        const p = raw.on ? rebase(raw, now - (this.fake.t0 + this.planMs)) : raw;
        if (!p.on) { this.planMs = 0; this.reset(); } else v.push({ ...p, at: now, dl: 0 }, now);
      }
    }
    v.frame(dt, t, camera);
  }
  look(dx: number, dy: number): void { this.view?.scene?.look(dx, dy); }
  zoom(d: number): void { this.view?.scene?.zoom(d); }
  /** Stop and dispose the scene (and its HUD). */
  close(): void { this.view?.close(); this.view = null; this.playing = ''; this.mock = null; }
}
