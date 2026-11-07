/**
 * hybrid rooms — a 3D interior with an NPC, and the site's own functional panel docked over it
 * (ctx.showSitePanel({ side })): trainer (skills), board (news), hall (town storage), auction, storage, gate, anvil
 * (enchanting at the open forge shed).
 *
 *   registerHybridRooms(registries.rooms)     // registers room kind 'hybrid'
 *   BuildingDef { room: 'hybrid', scene?: 'trainer' | 'board' | 'hall' | 'auction' | 'storage' | 'gate' | 'anvil' | 'plain' }
 *
 * The panel opens on entering (side per the site's ROOM table: 'left' for most, 'right' for trainer/board, which the
 * site shows as an overlay) and again when the player uses the NPC / the desk («Открыть: …»).
 *
 * Scene mode: every hybrid room carries a `stage` (src/core/rooms.ts SceneStage): the focus (the desk / NPC box
 * centre, or HybridSpec.stage.focus) and the hero's stand in front of it, facing it (also the spawn, so the hero
 * appears there). The game then keeps the cursor free and frames the hero and the focus in the half of the screen
 * the site panel leaves free (src/features/camera.ts).
 */
import type { Unsub } from '../../contracts';
import type { Registry, RoomDef, RoomContext, RoomScene } from '../../contracts/ext';
import type { SceneStage } from '../../core/rooms';
import { RoomBase, envFromCtx, type RoomEnv } from '../common/base';
import { hitBox } from '../common/kit';
import { HYBRID_SCENES, type HybridSpec } from './scenes';

export { HYBRID_SCENES };
export type { HybridSpec };

/** Build a hybrid room for a RoomEnv (registered RoomDef and dev/rooms.ts). */
export async function createHybridRoom(env: RoomEnv): Promise<RoomScene> {
  const id = env.variant || env.building.id;
  const spec = HYBRID_SCENES[id] || HYBRID_SCENES.plain;
  const R = new RoomBase(env, 'hybrid:' + id);
  try {
    const desk = spec.build(R, env);
    const side = spec.side || 'left';
    const open = () => env.showSitePanel?.({ side });
    if (desk) {
      R.interact({ id: 'room:panel:' + id, label: spec.verb ? (typeof spec.verb === 'function' ? spec.verb(env) : spec.verb) : `Открыть: ${env.building.title || id}`, icon: env.building.icon || '📋',
        hit: hitBox(desk.x, desk.y, desk.z, desk.w, desk.h, desk.d, 'room:hit:panel'), reach: 4, use: open });
    }
    const scene = R.finish();
    const focus = spec.stage?.focus ? { x: spec.stage.focus[0], y: spec.stage.focus[1], z: spec.stage.focus[2] } : desk ? { x: desk.x, y: desk.y, z: desk.z } : { x: 0, y: 1, z: 0 };
    const stand = standBefore(scene, focus, spec.stage?.dist ?? 1.8);
    // the hero appears at the stand (same object as scene.spawn)
    scene.spawn.x = stand.x; scene.spawn.z = stand.z; scene.spawn.face = stand.face;
    const stage: SceneStage = { focus, stand, side, pick: (ray) => R.pick(ray) };
    (scene as RoomScene & { stage: SceneStage }).stage = stage;
    // open the site's panel once the room is shown
    let opened = false;
    const up = scene.update.bind(scene);
    scene.update = (dt, t, cam) => { if (!opened) { opened = true; if (spec.autoOpen !== false) open(); } up(dt, t, cam); };
    const dis = scene.dispose.bind(scene);
    scene.dispose = () => { try { env.hideSitePanel?.(); } catch { /* ignore */ } dis(); };
    return scene;
  } catch (e) { R.dispose(); throw e; }
}

/**
 * Where the hero stands to face `focus`: from the focus towards the spawn (the entrance side), fanning out up to ±0.9 rad
 * when furniture is in the way — the nearest free spot at least `dist` m away whose surroundings (±0.3 m) are free too;
 * facing the focus. Falls back to the spawn.
 */
export function standBefore(scene: RoomScene, focus: { x: number; z: number }, dist = 1.8): { x: number; z: number; face: number } {
  const sp = scene.spawn;
  const L = Math.hypot(sp.x - focus.x, sp.z - focus.z);
  let x = sp.x, z = sp.z;
  if (L > 1e-3) {
    const a0 = Math.atan2(sp.x - focus.x, sp.z - focus.z);
    const ok = (px: number, pz: number) => scene.free(px, pz) && scene.free(px + 0.3, pz) && scene.free(px - 0.3, pz) && scene.free(px, pz + 0.3) && scene.free(px, pz - 0.3);
    search: for (let d = Math.min(dist, L); d <= L; d += 0.1) {
      for (const da of FAN) {
        const px = focus.x + Math.sin(a0 + da) * d, pz = focus.z + Math.cos(a0 + da) * d;
        if (ok(px, pz)) { x = px; z = pz; break search; }
      }
    }
  }
  return { x, z, face: Math.atan2(-(focus.x - x), -(focus.z - z)) };
}
const FAN = [0, 0.15, -0.15, 0.3, -0.3, 0.45, -0.45, 0.6, -0.6, 0.75, -0.75, 0.9, -0.9];

export const hybridRoom: RoomDef = {
  title: 'Здание',
  create: (ctx: RoomContext) => createHybridRoom(envFromCtx(ctx)),
};

/** Register room kind 'hybrid' (scene by BuildingDef.scene or the building id; unknown → 'plain' hall). */
export function registerHybridRooms(rooms: Registry<RoomDef>): Unsub {
  return rooms.register('hybrid', hybridRoom);
}
