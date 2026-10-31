/**
 * Doors: every building entrance is an interactable. Hit volumes come from the world (World3DExt.interactables(),
 * door-shaped meshes/boxes on the facade) when it provides them, else a Box3 is generated per door: the lower part of
 * the facade around the entrance. Using a door = ctx.rooms.enter(buildingId) (3D room, hybrid or the site's screen).
 * Disabled while a room is active. Rebuilt when the city world is rebuilt (layout change).
 * Highlight: the silhouette outline of the real door (leaf, frame, arch, bands — the static city triangles inside the
 * doorway volume, extracted once on first aim; src/engine/outline.ts), never a box.
 */
import * as THREE from 'three';
import type { Building, Unsub, World3D } from '../contracts';
import type { Interactable, World3DExt } from '../contracts/ext';
import { toX, toZ } from '../world/coords';
import { coreFeature } from './types';
import { fitOutlineProxy } from '../engine/outline';

/** Facade box around a door (world metres): ±0.9 m around the door x (clamped to the building), 2.6 m tall,
 *  from 1.2 m behind the facade line to just before the walkable door point. */
export function doorBox(b: Building, groundY: number, out = new THREE.Box3()): THREE.Box3 {
  const dx = toX(b.door.x);
  const x0 = Math.max(toX(b.hit[0]), dx - 0.9), x1 = Math.min(toX(b.hit[1]), dx + 0.9);
  const zf = Math.min(toZ(b.hit[3]), toZ(b.door.y)) - 0.25;   // facade line (≈ where world builds the wall)
  out.min.set(Math.min(x0, dx - 0.5), groundY, zf - 1.2);
  // reaches out to ~0.4 m before the walkable door point, so E works from the same spots as in v0.1 (2.2 m from the door)
  out.max.set(Math.max(x1, dx + 0.5), groundY + 2.6, Math.max(zf + 0.35, toZ(b.door.y) - 0.4));
  return out;
}

/** The doorway part of doorBox (facade only, without the reach towards the street): the region of the outline proxy. */
export function doorwayBox(b: Building, groundY: number, out = new THREE.Box3()): THREE.Box3 {
  doorBox(b, groundY, out);
  const zf = Math.min(toZ(b.hit[3]), toZ(b.door.y)) - 0.25;
  out.max.z = zf + 0.3;
  out.max.y = groundY + 2.3;
  return out;
}

/**
 * Lazy outline of a door: the city geometry inside `region` (world) as one proxy mesh, built on first use and cached;
 * `dispose` frees it (world rebuilt). Returns null when nothing is there (then nothing is outlined).
 */
export function doorOutline(root: () => THREE.Object3D | null, region: THREE.Box3, id: string): { get: () => THREE.Object3D | null; dispose: () => void } {
  let built = false, proxy: THREE.Mesh | null = null;
  return {
    get: () => {
      if (!built) { const r = root(); if (!r) return null; built = true; proxy = fitOutlineProxy(r, region, { name: 'door:' + id }).proxy; }
      return proxy;
    },
    dispose: () => { proxy?.geometry.dispose(); proxy = null; built = false; },
  };
}

export const doorLabel = (title: string, soon?: boolean, icon?: string) => (soon ? `${title} — скоро откроется` : `Войти: ${icon ? icon + ' ' : ''}${title}`);

export default coreFeature({
  id: 'doors',
  order: 40,
  setup(ctx) {
    let offs: Unsub[] = [];
    const enabled = () => !ctx.state.inRoom && !ctx.rooms.busy;
    const build = (world: World3D) => {
      for (const u of offs) u();
      offs = [];
      const root = () => world.root ?? null;
      const L = ctx.layout();
      const byId = new Map(L.buildings.map((b) => [b.id, b] as const));
      const ext = world as World3D & Partial<World3DExt>;
      let list: Interactable[] | null = null;
      if (typeof ext.interactables === 'function') { try { list = ext.interactables(); } catch (e) { console.warn('[l3d] world.interactables', e); } }
      if (list && list.length) {
        for (const wi of list) {
          // world ids are building ids (optionally 'door:<id>'); using it always goes through the room manager
          const id = wi.id.replace(/^door:/, '');
          const b = byId.get(id);
          const soon = !!b?.soon;
          // the door layer of the facade only (leaf, frame, arch: ≤ 0.13 m in front of the entrance plane = hit max − 0.3),
          // so wall lamps / signs sticking out next to the door stay out of its outline
          const region = (wi.hit as THREE.Box3).isBox3 ? (wi.hit as THREE.Box3).clone() : null;
          if (region) region.max.z = Math.min(region.max.z, region.max.z - 0.3 + 0.13);
          const ol = region ? doorOutline(root, region, id) : null;
          if (ol) offs.push(ol.dispose);
          offs.push(ctx.interact.add({
            ...wi, id: 'door:' + id, ...(ol ? { outline: ol.get } : {}), label: b && !(b.jail || b.id === 'jail') ? doorLabel(b.title, soon, wi.icon ?? b.icon) : wi.label,   // the Jail is not entered: its own label
            icon: wi.icon ?? b?.icon, title: b?.title ?? wi.label, soon,
            enabled: () => enabled() && (!wi.enabled || wi.enabled()),
            use: () => { void ctx.rooms.enter(id); },
          } as Interactable));
        }
        return;
      }
      for (const d of world.doors) {
        const b = byId.get(d.id); if (!b) continue;
        const ol = doorOutline(root, doorwayBox(b, d.pos.y), d.id);
        offs.push(ol.dispose);
        offs.push(ctx.interact.add({
          id: 'door:' + d.id, label: doorLabel(d.title, d.soon, d.icon), icon: d.icon, title: d.title, soon: !!d.soon,
          hit: doorBox(b, d.pos.y), outline: ol.get,
          enabled,
          use: () => { void ctx.rooms.enter(d.id); },
        } as Interactable));
      }
    };
    build(ctx.world());
    const offW = ctx.onWorld(build);
    return () => { offW(); for (const u of offs) u(); offs = []; };
  },
});
