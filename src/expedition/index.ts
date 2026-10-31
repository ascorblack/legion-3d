/**
 * src/expedition — the expedition («поход») in 3D: a spectator scene driven ONLY by the delayed SSE `q` views.
 *
 *   const view = new ExpeditionView({ uiRoot, kit, appOf, style, quality, me: () => ({ login, role }) });
 *   bus.on('sse:q', (v) => view.push(v));       // or store.on('quest', …) — every raw view
 *   view.open(scene);                            // builds ExpeditionScene (RoomScene) + HUD, adds it to `scene`
 *   per frame: view.frame(dt, t, camera)         // picks the delayed view at 4 Hz → adapt() → scene; animates; camera
 *   view.close();                                // disposes everything (scene, HUD, art caches)
 *
 * Pipeline: DelayBuffer (src/quest/model.ts: the stream delay exactly like quest.js) → adapt() (adapter.ts — the ONE
 * place to fix after a live capture) → ExpeditionScene.setState(). Nothing is ever sent to the site from here.
 * Files: adapter.ts (q view → SceneState), layout.ts (formations), art.ts (models), terrain.ts (biomes), crowd.ts (party),
 * foes.ts (enemies, boss, bars, decals, projectiles), sets.ts (stage vignettes), text.ts (canvas labels), hud.ts, scene.ts.
 */
import * as THREE from 'three';
import type { Appearance } from '../contracts';
import type { AvatarKit } from '../contracts/modules';
import { DelayBuffer, delayS, secondsLeft, clampAdj, ADJ_KEY, isQuestPayload, type QuestPayload } from '../quest/model';
import { adapt, Roster, type SceneState } from './adapter';
import { ExpeditionScene } from './scene';
import { ExpeditionHud, HINT_DEFAULT } from './hud';

export { adapt, Roster, biomeOf, foeArt } from './adapter';
export type { SceneState, SceneKind } from './adapter';
export { ExpeditionScene } from './scene';

export interface ViewHost {
  uiRoot: HTMLElement;
  kit: AvatarKit | null;
  appOf(login: string): Appearance | null;
  style: string;
  quality(): number;
  me(): { login: string; role: string };
  /** ms clock (Date.now by default; dev pages may warp it) */
  now?(): number;
  hint?: string;
  /** px from the bottom for the controls hint (the game's own key bar sits at the bottom) */
  hintBottom?: number;
}

export class ExpeditionView {
  readonly buf = new DelayBuffer();
  readonly roster = new Roster();
  scene: ExpeditionScene | null = null;
  hud: ExpeditionHud | null = null;
  private newest: QuestPayload | null = null;
  private shown: QuestPayload | null = null;
  private state: SceneState | null = null;
  private pickT = 0;
  private bad = 0;
  private town: { name: string; go: () => void } | null = null;
  private hintHtml: string | undefined;
  constructor(private host: ViewHost) {}

  private now(): number { return this.host.now ? this.host.now() : Date.now(); }
  private adj(): number { try { return clampAdj(+(localStorage.getItem(ADJ_KEY) || 0)); } catch { return 0; } }

  /** Feed every raw `q` view (malformed ones are dropped, once logged). */
  push(v: unknown, rx = this.now()): void {
    if (!isQuestPayload(v)) {
      // a live shape we do not know yet: keep going with what is safe (on flag only) — the adapter is defensive
      if (!v || typeof v !== 'object' || typeof (v as QuestPayload).on !== 'boolean') { if (!this.bad++) console.warn('[l3d] expedition: unknown q view', v); return; }
    }
    this.newest = v as QuestPayload;
    this.buf.push(v as QuestPayload, rx);
  }
  /** An expedition is running (newest view, not delayed). */
  get onAir(): boolean { return !!this.newest && !!this.newest.on; }
  /** The view as on the stream right now. */
  get view(): QuestPayload | null { return this.shown; }
  get sceneState(): SceneState | null { return this.state; }
  get active(): boolean { return !!this.scene; }

  /** Seconds left of a server window as on the stream. */
  secLeft(until: number): number { return until ? secondsLeft(until, delayS(this.newest, this.adj()), this.now()) : 0; }

  open(target: THREE.Object3D & { fog?: THREE.Fog | THREE.FogExp2 | null }): ExpeditionScene {
    if (this.scene) return this.scene;
    const sc = new ExpeditionScene({ kit: this.host.kit, appOf: (l) => this.host.appOf(l), style: this.host.style, quality: this.host.quality(), secLeft: (u) => this.secLeft(u) });
    this.scene = sc;
    target.add(sc.root);
    if ((target as THREE.Scene).isScene) sc.attach(target as THREE.Scene);
    this.hud = new ExpeditionHud(this.host.uiRoot, this.hintHtml ?? this.host.hint, this.host.hintBottom);
    if (this.town) this.hud.setTown(this.town.name, this.town.go);
    this.pickT = 1;   // pick at once
    this.state = null;
    return sc;
  }

  /** The party stands in a district town the hero may enter (src/net/city-tab.ts questTown): the HUD shows the site's
   *  «Войти в город «name»» button; `go` runs only on the player's click. null hides it. Survives open/close. */
  setTown(t: { name: string; go: () => void } | null): void {
    this.town = t;
    this.hud?.setTown(t ? t.name : null, t ? t.go : null);
  }
  /** Replace the controls hint (kept across open/close; undefined = the host's default). */
  setHint(html: string | undefined): void {
    if (html === this.hintHtml) return;
    this.hintHtml = html;
    this.hud?.setHint(html ?? this.host.hint ?? HINT_DEFAULT);
  }

  close(): void {
    this.scene?.dispose(); this.scene = null;
    this.hud?.dispose(); this.hud = null;
    this.state = null;
  }

  /** Per frame: pick the delayed view (4 Hz), adapt, animate, place the camera. */
  frame(dt: number, t: number, camera: THREE.Camera): void {
    const sc = this.scene;
    if (!sc) return;
    this.pickT += dt;
    if (this.pickT >= 0.25) {
      this.pickT = 0;
      const v = this.buf.pick(this.now(), this.adj());
      this.shown = v;
      const me = this.host.me();
      const s = adapt(v, { login: me.login, role: me.role, roster: this.roster });
      this.state = s;
      if (s.kind !== 'off') sc.setState(s);
      this.hud?.update(s, this.secLeft(s.until));
    }
    sc.update(dt, t, camera);
    this.hud?.setFade(sc.fade);
  }
}
