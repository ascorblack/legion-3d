/**
 * Debug spaces: the test dimension, a room opened from it and the expedition scene viewer are client-only spaces,
 * swapped in exactly like the hybrid 3D rooms (ctx.setSpace): the city is hidden, the site's hero stays where it was —
 * no go() is sent while we are away (the go sender is paused), and leaving puts the player back on the street at the
 * very point and facing they left from (still paused while the space swaps back, so not even that one go goes out).
 *
 * A space is "ours" while its root is attached: if something else swaps the space under us (the room manager, the
 * expedition feature), we notice on the next frame (lost()) and let go quietly.
 */
import type * as THREE from 'three';
import type { RoomScene } from '../contracts/ext';

/** The parts of the CoreContext the space manager needs (tests pass a fake). */
export interface SpaceHost {
  setSpace(scene: RoomScene | null, back?: { x: number; y: number; face: number }): void;
  me: { x: number; y: number };
  rig: { yaw: number; pitch: number };
  state: { inRoom: boolean; mode: string };
  rooms: { current: string | null; busy?: boolean };
  site: unknown;
}

export interface Origin { x: number; y: number; face: number; pitch: number; mode: string }

export class DebugSpace {
  origin: Origin | null = null;
  scene: RoomScene | null = null;
  owner = '';
  constructor(private host: SpaceHost) {}

  private pause(on: boolean): void {
    try { (this.host.site as { pauseMoves?(on: boolean): void } | undefined)?.pauseMoves?.(on); } catch { /* */ }
  }
  get active(): boolean { return !!this.origin; }

  /** Why a debug space cannot open now (a real room / the expedition view is on), or ''. */
  blocked(): string {
    if (this.origin) return '';
    if (this.host.rooms.current || this.host.rooms.busy) return 'Сначала выйди из здания';
    if (this.host.state.inRoom) return 'Сначала закрой текущий вид (поход, комната)';
    return '';
  }

  /** Swap `scene` in (owner = who holds it: 'dim', 'room', 'exp'). The first call remembers where we left the city. */
  enter(scene: RoomScene, owner: string): boolean {
    if (this.blocked()) return false;
    if (!this.origin) {
      const h = this.host;
      this.origin = { x: h.me.x, y: h.me.y, face: h.rig.yaw, pitch: h.rig.pitch, mode: h.state.mode };
      this.pause(true);
    }
    this.scene = scene; this.owner = owner;
    this.host.setSpace(scene);
    return true;
  }

  /** Something else replaced our space (its root got detached without us). */
  lost(): boolean {
    const r = this.scene?.root as THREE.Object3D | undefined;
    return !!this.origin && !!r && !r.parent;
  }

  /** Back to the city where we left it. Returns the origin (null when nothing was open). */
  leave(): Origin | null {
    const o = this.origin;
    if (!o) return null;
    this.scene = null; this.owner = '';
    // still paused: setSpace(null) re-sends the street position, which must not reach the site
    // (a space taken over by someone else is drop()ped by the controller first, never left through here)
    try { this.host.setSpace(null, { x: o.x, y: o.y, face: o.face }); } catch (e) { console.error('[l3d] debug space leave', e); }
    this.host.rig.pitch = o.pitch;
    this.origin = null;
    this.pause(false);
    return o;
  }

  /** Forget the space without swapping back (it was lost to another owner who now manages the city return). */
  drop(): void { this.scene = null; this.owner = ''; if (this.origin) { this.origin = null; this.pause(false); } }
}
