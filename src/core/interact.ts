/**
 * InteractSystem: what the player can use right now (contract in src/contracts/ext.ts).
 *
 * Each frame (update):
 *   - AIM: a ray from the screen centre (the crosshair = camera position + view direction) is tested against every
 *     registered hit volume. Candidates are first culled by distance (bounding sphere vs reach), then by the ray-vs-AABB
 *     test (Box3 hits end here), then, for Object3D hits, by an exact mesh raycast (rotated or odd-shaped volumes).
 *     The nearest hit within `reach` (default 3 m, measured from the eye; in third person the camera→eye distance is
 *     added) is `aimed`.
 *   - NEAR: the closest volume whose footprint is within the proximity reach (default 2.2 m) of the player's feet,
 *     unless the interactable says `proximity: false`.
 *   - target = aimed ?? near.
 * Use: E → target (aimed or nearby). Mouse clicks never interact (like in games: LMB swings, RMB blocks) —
 * use('click') is a no-op kept for the contract. No allocations per frame except the exact raycast while the crosshair is inside an AABB.
 *
 * Highlight: exactly one object — the current target — gets the silhouette outline (src/engine/outline.ts; drawn by
 * the engine: screen-space mask + edge at q2–3, inverted hull at q0–1). An interactable with `highlight(on)` draws its
 * own (shop goods, mine stones: they call showOutline themselves); otherwise the outline sources are, in order:
 * `outline` (objects/meshes, or a function returning them — doors give their door-leaf proxy), the visible meshes of an
 * Object3D hit, or — for a Box3 / invisible hit volume — a fitted proxy: the static scene triangles lying inside the
 * volume (`highlightBox` if given) plus room avatars standing in it, built once per interactable and cached.
 * `hit.userData.highlight = false` turns it off for an object. No boxes, no shells.
 */
import * as THREE from 'three';
import type { Interactable, InteractSystem } from '../contracts/ext';
import type { Unsub } from '../contracts';
import { fitOutlineProxy, hideOutline, outlineOwner, showOutline } from '../engine/outline';

const outlineOwnerIs = (t: unknown) => outlineOwner() === t;

/** Outline sources: objects (their visible meshes) or carrier meshes (used as is), or a lazy getter of them. */
export type OutlineSpec = THREE.Object3D | readonly THREE.Object3D[] | (() => THREE.Object3D | readonly THREE.Object3D[] | null);
/** Interactable with the optional highlight hooks (not in the v2 contract yet; duck-typed). */
export type InteractableEx = Interactable & {
  highlight?(on: boolean): void;
  /** What to outline instead of the hit volume (doors: the door leaf / doorway proxy). */
  outline?: OutlineSpec;
  /** Region of the fitted proxy when it should differ from the hit volume (Box3 / invisible hits). */
  highlightBox?: THREE.Box3;
  soon?: boolean; title?: string;
};

export const AIM_REACH = 3.0;
export const NEAR_REACH = 2.2;

/** What the HUD shows (UiHost.focusTarget). One mutable object, refreshed only when the target changes. */
export interface FocusInfo { id: string; title: string; icon?: string; label: string; soon?: boolean; aimed: boolean }

export interface InteractSystemEx extends InteractSystem {
  /** The interactable under the crosshair (within reach) or null. */
  readonly aimed: Interactable | null;
  /** The nearest interactable usable by E proximity or null. */
  readonly near: Interactable | null;
  /**
   * Recompute targets. feet = player feet (m, world). eyeExtra = distance from the camera to the eye point
   * (0 in first person; the TP boom length otherwise), added to the aim reach.
   */
  update(camera: THREE.Camera, feet: { x: number; y: number; z: number }, eyeExtra?: number): void;
  /** Use the current target: 'key' → aimed or nearby; 'click' → nothing (clicks never interact). Returns true if something was used. */
  use(how: 'key' | 'click'): boolean;
  /** Off: no targets (menus, overlays, loading). */
  setEnabled(on: boolean): void;
  /** HUD info for the current target (null = nothing). */
  focus(): FocusInfo | null;
  /** Number of registered interactables. */
  readonly size: number;
}

interface Entry {
  i: Interactable;
  box: THREE.Box3;          // world AABB (= i.hit for Box3 hits)
  obj: THREE.Object3D | null;
  center: THREE.Vector3; radius: number;
  exact: boolean;           // exact mesh raycast after the AABB test
  hasMesh: boolean;
  /** Fitted outline proxy (Box3 / invisible hits): undefined = not built yet. */
  fit?: THREE.Object3D[];
  fitGeo?: THREE.BufferGeometry;
}

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3();
const _ray = new THREE.Ray();
const _rc = new THREE.Raycaster();
const _hits: THREE.Intersection[] = [];

export function createInteractSystem(opts: { scene?: THREE.Object3D } = {}): InteractSystemEx {
  const entries: Entry[] = [];
  let lit: Entry | null = null;
  const token = {};   // outline owner
  const unlight = () => {
    if (!lit) return;
    const i = lit.i as InteractableEx;
    if (typeof i.highlight === 'function') { try { i.highlight(false); } catch (e) { console.error('[l3d] highlight', i.id, e); } }
    hideOutline(token);
    lit = null;
  };
  const light = (e: Entry) => {
    lit = e;
    const i = e.i as InteractableEx;
    if (typeof i.highlight === 'function') { try { i.highlight(true); } catch (err) { console.error('[l3d] highlight', i.id, err); } return; }
    if (e.obj?.userData?.highlight === false) return;
    try {
      if (i.outline) {
        const o = typeof i.outline === 'function' ? i.outline() : i.outline;
        if (o) showOutline(token, o);
        return;
      }
      if (e.obj && e.hasMesh) {
        showOutline(token, e.obj);
        if (outlineOwnerIs(token)) return;
      }
      // Box3 or invisible hit volume → fitted proxy out of the scene geometry inside it (built once)
      if (!opts.scene) return;
      if (!e.fit) {
        const r = fitOutlineProxy(opts.scene, i.highlightBox ?? e.box, { name: i.id });
        e.fit = r.proxy ? [r.proxy, ...r.avatars] : r.avatars;
        e.fitGeo = r.proxy?.geometry;
      }
      if (e.fit.length) showOutline(token, e.fit);
    } catch (err) { console.error('[l3d] outline', i.id, err); }
  };
  let aimed: Interactable | null = null, near: Interactable | null = null;
  let enabled = true;
  const info: FocusInfo = { id: '', title: '', label: '', aimed: false };
  let infoFor: Interactable | null = null, infoAimed = false, infoLabel = '';

  const refreshBox = (e: Entry) => {
    if (!e.obj) return;
    e.obj.updateWorldMatrix(true, true);
    e.box.setFromObject(e.obj);
    if (e.box.isEmpty()) { e.radius = -1; return; }
    e.box.getCenter(e.center);
    e.radius = e.box.max.distanceTo(e.center);
  };
  /** Parents visible (the hit volume itself may be invisible on purpose). */
  const parentsVisible = (o: THREE.Object3D) => {
    for (let p = o.parent; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  const usable = (e: Entry) => (!e.i.enabled || e.i.enabled()) && (!e.obj || parentsVisible(e.obj));

  const sys: InteractSystemEx = {
    get target() { return aimed ?? near; },
    get aimed() { return aimed; },
    get near() { return near; },
    get size() { return entries.length; },

    add(i): Unsub {
      const isBox = (i.hit as THREE.Box3).isBox3 === true;
      const obj = isBox ? null : (i.hit as THREE.Object3D);
      let hasMesh = false;
      if (obj) obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) hasMesh = true; });
      const e: Entry = {
        i, obj, box: isBox ? (i.hit as THREE.Box3) : new THREE.Box3(), center: new THREE.Vector3(), radius: 0,
        exact: !!obj && hasMesh && obj.userData?.exactHit !== false, hasMesh,
      };
      if (isBox) { e.box.getCenter(e.center); e.radius = e.box.max.distanceTo(e.center); } else refreshBox(e);
      entries.push(e);
      return () => {
        if (lit === e) unlight();
        e.fitGeo?.dispose(); e.fit = undefined; e.fitGeo = undefined;
        const k = entries.indexOf(e); if (k >= 0) entries.splice(k, 1);
        if (aimed === i) aimed = null;
        if (near === i) near = null;
      };
    },

    update(camera, feet, eyeExtra = 0) {
      aimed = null; near = null;
      let aimedE: Entry | null = null, nearE: Entry | null = null;
      if (!enabled || entries.length === 0) { if (lit) unlight(); return; }
      camera.getWorldPosition(_o);
      camera.getWorldDirection(_d);
      _ray.set(_o, _d);
      let bestA = Infinity, bestN = Infinity;
      for (let k = 0; k < entries.length; k++) {
        const e = entries[k];
        if (!usable(e)) continue;
        const i = e.i;
        // moving/animated hit objects: refresh their AABB only when they could be in reach
        if (e.obj && e.obj.matrixWorldAutoUpdate !== false && !e.obj.userData?.staticHit) {
          const dc = _o.distanceTo(e.center) - e.radius;
          if (dc < (i.reach ?? AIM_REACH) + eyeExtra + 2) refreshBox(e);
        }
        if (e.radius < 0) continue;
        const reachA = (i.reach ?? AIM_REACH) + eyeExtra;
        // aim
        if (_o.distanceTo(e.center) - e.radius <= reachA) {
          const hp = _ray.intersectBox(e.box, _p);
          if (hp) {
            let td = _o.distanceTo(hp);
            if (td <= reachA && td < bestA && e.exact) {
              _hits.length = 0;
              _rc.ray.copy(_ray); _rc.near = 0; _rc.far = reachA;
              _rc.intersectObject(e.obj!, true, _hits);
              td = _hits.length ? _hits[0].distance : Infinity;
              _hits.length = 0;
            }
            if (td <= reachA && td < bestA) { bestA = td; aimed = i; aimedE = e; }
          }
        }
        // proximity (horizontal distance from the feet to the AABB footprint; feet roughly at the volume's height)
        if (i.proximity !== false) {
          const reachN = i.reach != null ? Math.min(i.reach, NEAR_REACH * 1.5) : NEAR_REACH;
          const b = e.box;
          if (feet.y < b.min.y - 1.2 || feet.y > b.max.y + 0.5) continue;
          const dx = feet.x < b.min.x ? b.min.x - feet.x : feet.x > b.max.x ? feet.x - b.max.x : 0;
          const dz = feet.z < b.min.z ? b.min.z - feet.z : feet.z > b.max.z ? feet.z - b.max.z : 0;
          const dd = dx * dx + dz * dz;
          if (dd <= reachN * reachN && dd < bestN) { bestN = dd; near = i; nearE = e; }
        }
      }
      const tE = aimedE ?? nearE;
      if (tE !== lit) { unlight(); if (tE) light(tE); }
    },

    use(how) {
      if (how !== 'key') return false;   // the mouse never interacts with the world (E / F only)
      const t = aimed ?? near;
      if (!t) return false;
      try { t.use(how); } catch (e) { console.error('[l3d] interact', t.id, e); }
      return true;
    },

    setEnabled(on) { enabled = on; if (!on) { aimed = null; near = null; unlight(); } },

    focus() {
      const t = aimed ?? near;
      if (!t) { infoFor = null; return null; }
      const isAimed = t === aimed;
      if (t !== infoFor || isAimed !== infoAimed || t.label !== infoLabel) {
        infoFor = t; infoAimed = isAimed; infoLabel = t.label;
        info.id = t.id; info.label = t.label; info.title = (t as InteractableEx).title ?? t.label; info.icon = t.icon;
        info.soon = (t as InteractableEx).soon; info.aimed = isAimed;
      }
      return info;
    },
  };
  return sys;
}
