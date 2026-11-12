/**
 * «Монстры у стен» (site 12.11 afternoon, citymon.js) in 3D — see src/net/citymon.ts for what the site does.
 *
 * The site's own client keeps the view (GET /api/citymon, its own 60 s cache): we only READ it — window.LGCityMon.view() and
 * LGCity.wall() every 1.5 s, like its tick() — and draw the same picture: every pack on the spot citymon.js placeAll() gives
 * it (13 spots on the cats fair: two at the gate in the glade, four along the south wall, four in the north forest, three
 * elite spots at the edges; elsewhere the site's fallback row below the gate), at the members' FORM offsets, wandering inside
 * walkBox like walkStep(). The art is citymon-art.ts (the site's figures, instanced per art id), elites 1.6×, a tag over each
 * group like `.cm-tag` («☠☠ 7 ур.», «Элитный …», «Вернутся через m:ss»).
 *   - A pack that disappears from the view while the view stays (the player beat it, or it left) lies down in the site's dead
 *     pose (`.cmw.dead` / `cm-pose-dead`: flipped, squashed, the eyes become crosses) for a moment, then goes.
 *   - E (aim; the glade is beyond the wall, so no proximity) on a group presses the site's own monster button in its `.cm-wall`
 *     layer: the site opens «Напасть на монстров у стен?» (or the elite group dialog) — a site dialog, so the 3D yields
 *     (overlay 'dialog') and the player decides there. Nothing is sent by us.
 * Dev: ?cm=1 (dev/game.ts stand-ins), window.__l3dGame.citymon.
 */
import { setHtml } from '../core/html';
import * as THREE from 'three';
import type { Interactable } from '../contracts/ext';
import { toX, toZ } from '../world/coords';
import { cityMonGeo, cityMonScale, cityMonTop } from '../world/citymon-art';
import { toonMat, outlineMat } from '../avatar/materials';
import { hullGeo } from '../expedition/art';
import { cityMonWall, cityMonView, cityMonGroups, cityMonKey, cityMonAct, cityMonLabel, type CmGroup, type CmWall, type CmView } from '../net/citymon';
import { coreFeature } from './types';

/** How long a beaten pack lies in the dead pose (s). */
export const CM_DEAD_S = 3.0;
const POLL_S = 1.5, CAP0 = 8;
/** Draw distance (m; scaled in over the last 3 m) and the outline's (the hull only for the near ones): the fair's q2 views
 *  are at the 130k budget with the static town alone — a monster group far across the town is not drawn (its tag neither). */
export const CM_FAR = 26, CM_OUTLINE = 16;
const TAG_FAR = CM_FAR;

interface Mon { id: string; bx: number; by: number; yaw: number; ph: number; mx: THREE.Matrix4; far: number }
interface Grp {
  g: CmGroup; mons: Mon[];
  /** wander offset (px) now, its target and speed (site: 32 px/s, elites 24), moving until / next start (s) */
  ox: number; oy: number; tx: number; ty: number; v: number; until: number; next: number;
  /** dead since (s, scene clock) or −1 */
  deadAt: number;
  box: THREE.Box3; off: (() => void) | null; tag: HTMLElement | null;
}
/** Wander like walkStep / walkGo: a new target inside the box, at least 18 px away, 1.5–5 s rest. Pure (tests). */
export function wanderNext(x: number, box: readonly [number, number, number], rnd: () => number): [number, number] {
  const [bx, y0, y1] = box;
  let nx = (rnd() * 2 - 1) * bx;
  if (Math.abs(nx - x) < 18) nx = x > 0 ? x - 18 - rnd() * bx * 0.6 : x + 18 + rnd() * bx * 0.6;
  nx = Math.max(-bx, Math.min(bx, nx));
  return [nx, y0 + rnd() * (y1 - y0)];
}

export default coreFeature({
  id: 'citymon',
  order: 47,
  setup(ctx) {
    const W = window as any;
    const root = new THREE.Group(); root.name = 'citymon';
    const mats = { body: toonMat('n'), ol: outlineMat('n', 8, 0.014) };
    const meshes = new Map<string, { im: THREE.InstancedMesh; ol: THREE.InstancedMesh; cap: number; n: number; near: number }>();
    const groups = new Map<string, Grp>();
    let wall: CmWall | null = null, view: CmView | null = null, key = '', pollT = POLL_S, clock = 0, vNow = 0, vAt = 0;
    const need = new Map<string, number>();
    const tagBox = document.createElement('div');
    tagBox.className = 'l3d-cm-tags';
    tagBox.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:3';
    ctx.uiRoot.appendChild(tagBox);
    const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _v = new THREE.Vector3();

    const meshOf = (id: string, dead: boolean, need: number) => {
      const k = id + (dead ? ':dead' : '');
      let r = meshes.get(k);
      if (r && r.cap >= need) return r;
      if (r) { root.remove(r.im, r.ol); r.im.dispose(); r.ol.dispose(); }
      const cap = Math.max(CAP0, need), g = cityMonGeo(id, dead);
      const im = new THREE.InstancedMesh(g, mats.body, cap), ol = new THREE.InstancedMesh(hullGeo(g), mats.ol, cap);
      ol.instanceMatrix = im.instanceMatrix;
      for (const m of [im, ol]) { m.count = 0; m.name = 'citymon:' + k; }   // culled by the instances' bounding sphere (recomputed each frame)
      root.add(im, ol);
      r = { im, ol, cap, n: 0, near: 0 };
      meshes.set(k, r);
      return r;
    };
    const ground = (x: number, y: number) => { try { return ctx.world().groundAt(x, y); } catch { return 0; } };

    const dropGroup = (G: Grp) => { G.off?.(); G.off = null; G.tag?.remove(); G.tag = null; };
    const addInteract = (G: Grp) => {
      if (G.g.kind === 'soon') return;
      const it: Interactable = {
        id: 'citymon:' + G.g.key,
        get label() { return cityMonLabel(G.g); },
        icon: G.g.elite ? '👑' : '⚔️',
        hit: G.box, reach: 9, proximity: false,
        enabled: () => G.deadAt < 0 && !ctx.state.inRoom && !ctx.state.classic && !ctx.state.jailed && !!W.LGCityMon,
        use: () => { const how = cityMonAct(G.g); if (!how) ctx.ui.toast('Монстры сейчас недоступны', true); },
      };
      G.off = ctx.interact.add(it);
    };
    const tagHtml = (g: CmGroup) => {
      const sk = '☠'.repeat(Math.max(1, (g.elite ? g.tier + 1 : g.tier) + 1));
      if (g.kind === 'soon') return '';
      return g.elite ? `Элитный <i>${sk}</i>${g.lvl ? ` ${g.lvl} ур.` : ''}` : `<i>${sk}</i> ${g.lvl ?? ''} ур.`;
    };
    const mkTag = (G: Grp) => {
      const t = document.createElement('div');
      const col = G.g.elite ? '#ffd34d' : ['#9fe08a', '#ffcf6a', '#ff8a6a'][G.g.tier] || '#ffcf6a';
      t.style.cssText = `position:absolute;left:0;top:0;transform:translate(-50%,-100%);white-space:nowrap;padding:2px 9px;border-radius:999px;`
        + `background:rgba(20,22,34,.78);border:1.5px solid ${col};color:#fff4d8;font:800 13px/1.3 'Golos Text','Nunito',sans-serif;display:none`;
      setHtml(t, tagHtml(G.g));
      tagBox.appendChild(t);
      return t;
    };

    /** Reconcile the drawn groups with the site's picture. */
    const sync = () => {
      const gs = wall && view ? cityMonGroups(wall, view) : [];
      const seen = new Set<string>();
      for (const g of gs) {
        const k = g.kind + ':' + g.key; seen.add(k);
        let G = groups.get(k);
        if (G && G.mons.map((m) => m.id).join() !== g.mons.map((m) => m.id).join()) { dropGroup(G); groups.delete(k); G = undefined; }
        if (!G) {
          G = { g, mons: g.mons.map((m, i) => ({ id: m.id, bx: m.x, by: m.y, yaw: Math.PI / 2, ph: i * 1.9 + g.spot, mx: new THREE.Matrix4(), far: -1 })),
            ox: 0, oy: 0, tx: 0, ty: 0, v: g.elite ? 24 : 32, until: 0, next: clock + 0.4 + Math.random() * 2.6, deadAt: -1, box: new THREE.Box3(), off: null, tag: null };
          groups.set(k, G); addInteract(G);
        } else { G.g = g; G.mons.forEach((m, i) => { m.bx = g.mons[i].x; m.by = g.mons[i].y; }); }
        if (!G.tag) G.tag = mkTag(G); else if (g.kind !== 'soon') setHtml(G.tag, tagHtml(g));
      }
      for (const [k, G] of groups) {
        if (seen.has(k) || G.deadAt >= 0) continue;
        // gone from the view: a pack / elite lies down while the view is still there (beaten), else it just goes
        if (view && G.g.kind !== 'soon') { G.deadAt = clock; G.off?.(); G.off = null; if (G.tag) G.tag.style.display = 'none'; }
        else { dropGroup(G); groups.delete(k); }
      }
    };
    const poll = () => {
      const dev = ctx.dev.citymonFake as { wall?: () => CmWall | null; view?: () => CmView | null } | undefined;
      const w = dev?.wall ? dev.wall() : cityMonWall(), v = w ? (dev?.view ? dev.view() : cityMonView()) : null;
      const k = w && v ? cityMonKey(w, v) : '';
      wall = w; view = v;
      if (v && Number.isFinite(v.now) && v.now !== vNow) { vNow = v.now!; vAt = Date.now(); }
      if (k !== key) { key = k; sync(); }
    };

    const deadK = (G: Grp) => (G.deadAt >= 0 ? Math.min(1, (clock - G.deadAt) / 0.35) : 0);
    const place = (dt: number, cam: THREE.Camera | null) => {
      // capacity first (a grown InstancedMesh is a new one)
      need.clear();
      for (const G of groups.values()) { const dd = deadK(G) > 0.5; for (const m of G.mons) { const k = m.id + (dd ? ':dead' : ''); need.set(k, (need.get(k) ?? 0) + 1); } }
      for (const [k, n] of need) { const i = k.indexOf(':dead'); meshOf(i < 0 ? k : k.slice(0, i), i >= 0, n); }
      const cp = cam ? (cam as THREE.PerspectiveCamera).position : null;
      const vw = ctx.uiRoot.clientWidth || innerWidth, vh = ctx.uiRoot.clientHeight || innerHeight;
      for (const [k, G] of groups) {
        const g = G.g;
        if (G.deadAt >= 0 && clock - G.deadAt > CM_DEAD_S) { dropGroup(G); groups.delete(k); continue; }
        // wander (walkStep / walkGo)
        if (G.deadAt < 0 && g.kind !== 'soon') {
          if (G.until && clock >= G.until) { G.until = 0; G.next = clock + 1.5 + Math.random() * 3.5; }
          if (!G.until && clock >= G.next) {
            const [nx, ny] = wanderNext(G.ox, g.box, Math.random), d = Math.hypot(nx - G.ox, ny - G.oy);
            G.tx = nx; G.ty = ny; G.until = clock + Math.max(0.8, Math.min(3.2, d / G.v)) + 0.3;
            const yaw = Math.atan2(-(nx - G.ox) * 0.01, -(ny - G.oy) * 0.02);
            for (const m of G.mons) m.yaw = yaw;
          }
          const dx = G.tx - G.ox, dy = G.ty - G.oy, d = Math.hypot(dx, dy), st = G.v * dt;
          if (d > 0.01) { if (d <= st) { G.ox = G.tx; G.oy = G.ty; } else { G.ox += dx / d * st; G.oy += dy / d * st; } }
        }
        const moving = G.until > 0 && Math.hypot(G.tx - G.ox, G.ty - G.oy) > 0.5;
        const dk = deadK(G), fade = G.deadAt >= 0 ? Math.max(0, 1 - Math.max(0, clock - G.deadAt - CM_DEAD_S + 0.5) / 0.5) : 1;
        G.box.makeEmpty();
        let topY = 0, gFar = Infinity;
        for (const m of G.mons) {
          const x = m.bx + G.ox, y = m.by + G.oy, s = cityMonScale(m.id), top = cityMonTop(m.id) * s, gy = ground(x, y);
          _v.set(toX(x), gy, toZ(y));
          const far = cp ? _v.distanceTo(cp) : 0; gFar = Math.min(gFar, far);
          G.box.expandByPoint(_v); _v.y += top; G.box.expandByPoint(_v);
          topY = Math.max(topY, gy + top);
          if (far > CM_FAR) { m.far = -1; continue; }
          m.far = far;
          const k3 = Math.min(1, (CM_FAR - far) / 3) * fade;   // scaled in over the last 3 m of the draw distance
          // breathing (cmBreath 2.6 s, scaleY 1.035), a step bob while walking, the dead pose: flipped over on its back
          // (scaleY −.8 + 6°), resting on its back at the body's height
          const br = 1 + 0.035 * (0.5 - 0.5 * Math.cos((clock + m.ph) * Math.PI * 2 / 2.6));
          const bob = moving && dk === 0 ? Math.abs(Math.sin((clock + m.ph) * Math.PI * 2)) * 0.03 * s : 0;
          _e.set(0, m.yaw, dk * (Math.PI - 0.1)); _q.setFromEuler(_e);
          _s.set(s * k3, s * (dk > 0 ? 1 - dk * 0.2 : br) * k3, s * k3);
          _p.set(toX(x), gy + bob + dk * top * 0.8 * k3, toZ(y));
          m.mx.compose(_p, _q, _s);
        }
        G.box.expandByScalar(0.25);
        // the tag over the group (like `.cm-tag` 152 px over the spot)
        if (G.tag && cam) {
          const cx = toX(g.x + G.ox), cz = toZ(g.y + G.oy), gy = g.kind === 'soon' ? ground(g.x, g.y) + 0.9 : topY + 0.35;
          _v.set(cx, gy, cz);
          const far = g.kind === 'soon' ? _v.distanceTo(cp!) : gFar;
          _v.project(cam);
          const on = G.deadAt < 0 && far < TAG_FAR && _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
          if (on) {
            if (g.kind === 'soon') G.tag.textContent = cityMonLabel(g, vNow ? vNow + Date.now() - vAt : Date.now());
            G.tag.style.transform = `translate(${((_v.x + 1) / 2 * vw).toFixed(1)}px,${((1 - _v.y) / 2 * vh).toFixed(1)}px) translate(-50%,-100%)`;
          }
          const d = on ? '' : 'none';
          if (G.tag.style.display !== d) G.tag.style.display = d;
        }
      }
      // the instances: the near ones first (the outline hull draws the first `near` of the shared matrix buffer), then the rest
      for (const r of meshes.values()) { r.n = 0; r.near = 0; }
      for (let pass = 0; pass < 2; pass++) for (const G of groups.values()) {
        const dd = deadK(G) > 0.5;
        for (const m of G.mons) {
          if (m.far < 0 || (m.far < CM_OUTLINE) !== (pass === 0)) continue;
          const r = meshes.get(m.id + (dd ? ':dead' : ''));
          if (!r || r.n >= r.cap) continue;
          r.im.setMatrixAt(r.n++, m.mx);
          if (pass === 0) r.near++;
        }
      }
      for (const r of meshes.values()) {
        r.im.count = r.n; r.ol.count = r.near;
        r.im.visible = r.n > 0; r.ol.visible = r.near > 0;
        if (r.n) { r.im.instanceMatrix.needsUpdate = true; r.im.computeBoundingSphere(); }
        if (r.near) r.ol.computeBoundingSphere();
      }
    };

    const attach = () => { const w = ctx.world(); if (root.parent !== w.root) { root.removeFromParent(); w.root.add(root); } };
    const offW = ctx.onWorld(() => { attach(); key = ''; for (const G of groups.values()) dropGroup(G); groups.clear(); pollT = POLL_S; });
    attach();
    const offF = ctx.onFrame((dt) => {
      clock += dt;
      root.visible = !ctx.state.inRoom;
      if (!root.visible) { tagBox.style.display = 'none'; return; }
      tagBox.style.display = '';
      pollT += dt;
      if (pollT >= POLL_S) { pollT = 0; poll(); }
      place(dt, ctx.engine.camera);
    });
    ctx.dev.citymon = { groups: () => [...groups.values()].map((G) => ({ kind: G.g.kind, key: G.g.key, spot: G.g.spot, x: G.g.x, y: G.g.y, mons: G.mons.map((m) => m.id), dead: G.deadAt >= 0, box: G.box.clone() })),
      poll: () => { pollT = POLL_S; }, root };
    return () => {
      offW(); offF();
      for (const G of groups.values()) dropGroup(G);
      groups.clear();
      for (const r of meshes.values()) { r.im.dispose(); r.ol.dispose(); }
      meshes.clear(); root.removeFromParent(); tagBox.remove();
      delete ctx.dev.citymon;
    };
  },
});
