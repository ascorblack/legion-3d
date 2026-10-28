/**
 * Crowd: other players' avatars. Create/update/remove on store 'walkers'; each frame place them on the ground,
 * pick LOD and draw budget nearest-first among those in view (CrowdLod), and set their label anchors.
 * Also re-applies the own appearance when the store replaces it. Hidden while a 3D room is active.
 */
import * as THREE from 'three';
import type { Avatar } from '../contracts/modules';
import { CrowdLod } from '../engine';
import { toX, toZ } from '../world/coords';
import { coreFeature } from './types';

/** A walker whose body is this close to the camera (m, horizontal) is not drawn: players idling on the spawn point
 *  stand exactly where the own hero appears, and their bodies would fill a first-person view with huge flat polygons. */
export const CAM_CLEAR = 0.75;
const _cam = new THREE.Vector3();

export default coreFeature({
  id: 'crowd',
  order: 20,
  setup(ctx) {
    const { store, engine, labels, anchors, kit, meAv, vm, me } = ctx;
    // app: identity of the Appearance object last applied (cheap check first; JSON only when the object was replaced)
    const avs = new Map<string, { av: Avatar; key: string; app: unknown; lod: number; slot: number }>();
    const crowd = new CrowdLod(64);
    let meKey = JSON.stringify(me.app), meApp: unknown = me.app, meTool = false;
    labels.set(me.login, { name: me.app.name, level: me.app.level, me: true });

    const sync = () => {
      for (const [l, a] of avs) if (!store.walkers.has(l)) {
        engine.scene.remove(a.av.root); a.av.dispose(); avs.delete(l); labels.remove(l); anchors.delete(l);
      }
      for (const w of store.walkers.values()) {
        let a = avs.get(w.login);
        if (!a) {
          a = { av: kit.create(w.app), key: JSON.stringify(w.app), app: w.app, lod: -1, slot: -1 }; avs.set(w.login, a); engine.scene.add(a.av.root);
          a.av.root.visible = !ctx.state.inRoom;
          anchors.set(w.login, new THREE.Vector3(0, -999, 0));
          labels.set(w.login, { name: w.app.name, level: w.app.level });
        } else if (a.app !== w.app) {
          a.app = w.app;
          const key = JSON.stringify(w.app);
          if (a.key !== key) { a.av.setAppearance(w.app); a.key = key; labels.set(w.login, { name: w.app.name, level: w.app.level }); }
        }
      }
      const tool = !!ctx.state.toolInHand;
      if (store.me && (store.me.app !== meApp || tool !== meTool)) {
        meApp = store.me.app;
        const k = JSON.stringify(store.me.app);
        // a room tool in the paws (mine pickaxe): the hero's own weapon and shield go away meanwhile (TP model)
        if (tool !== meTool) {
          meTool = tool;
          const g = { ...(store.me.app.gear || {}) } as Record<string, unknown>;
          if (tool) { delete g.w; delete g.wr; delete g.s; delete g.sr; }
          meAv.setAppearance(tool ? { ...store.me.app, gear: g } as typeof store.me.app : store.me.app);
          meKey = k;
        } else if (k !== meKey) { meKey = k; meAv.setAppearance(store.me.app); vm.setAppearance(store.me.app); meAv.play('equip'); labels.set(me.login, { name: store.me.app.name, level: store.me.app.level, me: true }); }
      }
    };
    const offW = store.on('walkers', sync); sync();

    let hidden = false;
    const offF = ctx.onFrame((dt, t) => {
      if (!!ctx.state.toolInHand !== meTool) sync();   // the mine pickaxe came out / went away: re-dress the own hero
      if (ctx.state.inRoom) {
        if (!hidden) { hidden = true; for (const [l, a] of avs) { a.av.root.visible = false; a.lod = -1; anchors.get(l)?.set(0, -999, 0); } }
        return;
      }
      hidden = false;
      const world = ctx.world();
      // draw/LOD budget per quality, nearest-first among those in view (the camera is final for this frame)
      crowd.begin(engine.camera, engine.quality);
      for (const w of store.walkers.values()) {
        const a = avs.get(w.login); if (!a) continue;
        const p = a.av.root.position;
        p.set(toX(w.x), world.groundAt(w.x, w.y), toZ(w.y));
        a.slot = crowd.add(p.x, p.y, p.z, a.lod);
      }
      crowd.resolve();
      engine.camera.getWorldPosition(_cam);
      for (const w of store.walkers.values()) {
        const a = avs.get(w.login); if (!a) continue;
        const q = a.av.root.position;
        const lod = Math.hypot(q.x - _cam.x, q.z - _cam.z) < CAM_CLEAR && Math.abs(q.y + 0.8 - _cam.y) < 1.6 ? -1 : crowd.lod(a.slot);
        a.lod = lod;
        a.av.root.visible = lod >= 0;
        const anc = anchors.get(w.login)!;
        if (lod < 0) { anc.set(0, -999, 0); continue; }
        const p = a.av.root.position;
        a.av.root.rotation.y = w.face;
        a.av.setLod(lod as 0 | 1 | 2);
        a.av.setAlpha(w.alpha);
        a.av.update(dt, t, w.speed / 230);
        // nameplate only for the nearest few (one draw call each); a chat bubble always keeps its anchor
        if (crowd.label(a.slot) || w.bubble) anc.set(p.x, p.y + a.av.headTop + 0.15, p.z); else anc.set(0, -999, 0);
      }
    });
    ctx.dev.avatars = avs;
    return () => { offW(); offF(); for (const a of avs.values()) { engine.scene.remove(a.av.root); a.av.dispose(); } avs.clear(); };
  },
});
