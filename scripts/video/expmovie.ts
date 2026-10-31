/**
 * EXPMOVIE — the expedition music-video's SOURCE shots (render.mjs --cut=expmovie --out=video/expmovie →
 * video/expmovie/frames-expmovie/<id>/). Each source is one demo view of dev/expedition.html (?demo=…, the offline
 * quest mocks — demo names only) in one biome, filmed by a camera DIRECTOR that sits on top of the scene's own camera:
 * after view.frame() has placed the camera, the director re-poses it as an orbit around the scene's own target
 * (yaw / pitch offsets, distance factor, target lift, FOV, roll) — cinematic orbits, dolly-ins, low angles. Nothing
 * in the game changes: the hooks live on this page instance only (view.push → biome override, view.frame → camera,
 * labels / the «ты» marker hidden, DOM over the canvas hidden).
 *
 * The edit itself (beat grid, cuts, whip pans, flashes, shakes, titles, music) is composed afterwards by
 * scripts/video/expmovie-compose.mjs from video/expmovie/timeline.json; nothing here knows about the music.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { type G, keyed } from './page/kit';
import { type Segment, until } from './shots';

type K = [number, number][];
interface Cam { yaw?: K; dp?: K; d?: K; ty?: K; tx?: K; tz?: K; fov?: K; roll?: K; fit?: boolean }
interface Src { id: string; demo?: string; seek?: number; ter?: string; dur?: number; cam: Cam; rate?: [number, number][]; title: string; names?: boolean; extra?: string }

const val = (k: K | undefined, t: number, dflt: number) => (k && k.length ? keyed(k, t) : dflt);

/** Hide everything over the canvas: the dev debug box, the expedition HUD (its shadow-root hosts), toasts. */
function cleanDom(): void {
  if (document.getElementById('xm-css')) return;
  const app = document.getElementById('app');
  for (const e of Array.from(document.body.children)) if (e !== app && e.tagName !== 'SCRIPT' && e.id !== 'video-layer') (e as HTMLElement).style.setProperty('display', 'none', 'important');
  if (app) for (const e of Array.from(app.children)) if (e.tagName !== 'CANVAS') (e as HTMLElement).style.setProperty('display', 'none', 'important');
  const s = document.createElement('style'); s.id = 'xm-css';
  s.textContent = 'body>*:not(#app):not(script){display:none!important}#app>*:not(canvas){display:none!important}';
  document.head.appendChild(s);
}

function source(o: Src): Segment {
  const dur = o.dur ?? 4;
  let T = 0;   // segment (game) time, set by frame()
  return {
    id: 'x-' + o.id, cut: 'expmovie', dur, win: [0, dur], preroll: 40, rate: o.rate, title: o.title,
    // a demo view (?demo=…), or the FakeQuest plan (no demo) sought to plan second `seek` (frame 0 ≈ seek; dl=0: no stream delay)
    page: o.demo ? `expedition?demo=${o.demo}&q=3&nodbg=1${o.extra || ''}` : `expedition?speed=1&dl=0&q=3&nodbg=1${o.extra || ''}`,
    requires: (G) => (G.sc?.view ? null : 'no expedition page'),
    async setup(G) {
      const E = G.sc, view = E.view;
      cleanDom();
      if (o.seek != null) E.seek(o.seek - 2.5);
      if (o.ter) {
        const push = view.push.bind(view);
        view.push = (v: any, n: number) => push(v && v.on ? { ...v, ter: o.ter } : v, n);
        E.warp(0);   // one tick now: the scene starts its fade into the requested biome
      }
      const fr = view.frame.bind(view);
      view.frame = (dt: number, t: number, cam: any) => { fr(dt, t, cam); pose(E, cam, T, o); };
      await until(() => !!view.scene && (!o.ter || view.sceneState?.ter === o.ter), 20000);
      await until(() => { const s = view.scene as any; return !!s && !s.pending && s.fadeDir === 0 && s.fade === 0; }, 20000);
      // the preroll (90 frames) runs after setup: frame 0 lands on plan second `seek`
      if (o.seek != null) { E.seek(o.seek - 1.5); await until(() => { const s = view.scene as any; return !s.pending && s.fadeDir === 0; }, 20000); }
      cleanDom();
    },
    frame(_G, t) { T = t; cleanDom(); },
  };
}

/** Re-pose the camera: orbit around the scene's own (smoothed) target. Keeps the scene's own hit shake. */
function pose(E: any, cam: any, t: number, o: Src): void {
  const sc = E.view.scene; if (!sc) return;
  // clean frames: no name plates, no «you» marker (keep boss / event signs)
  if (!o.names) { for (const a of sc.crowd?.actors || []) if (a.label) a.label.obj.visible = false; if (sc.marker) sc.marker.visible = false; }
  const c: Cam = (window as any).__xmCam || o.cam;   // __xmCam: probe override (scripts/video/expmovie-probe.mjs)
  const C = sc.cam;
  const dx = C.x - C.tx, dy = C.y - C.ty, dz = C.z - C.tz;
  let d0 = Math.hypot(dx, dy, dz) || 10, cx = C.tx, cz = C.tz;
  const yaw0 = Math.atan2(dx, dz), p0 = Math.asin(Math.max(-1, Math.min(1, dy / d0)));
  if (c.fit) {
    // tight framing: centre and radius of everybody that matters (party, live foes, the boss counts double)
    let sx = 0, sz = 0, n = 0; const pts: [number, number, number][] = [];
    for (const a of sc.crowd?.actors || []) pts.push([a.x, a.z, 1]);
    for (const A of sc.foes?.list || []) if (!A.dead) pts.push([A.x, A.z, 1.5]);
    if (sc.boss && !sc.boss.dead) pts.push([sc.boss.x, sc.boss.z, 4]);
    for (const [x, z, w] of pts) { sx += x * w; sz += z * w; n += w; }
    if (n) {
      const mx = sx / n, mz = sz / n; let r = 1.5;
      for (const [x, z] of pts) r = Math.max(r, Math.hypot(x - mx, z - mz));
      cx = mx; cz = mz; d0 = Math.max(4.5, r * 2.0);
    }
  }
  const yaw = yaw0 + val(c.yaw, t, 0), pitch = Math.max(-0.2, Math.min(1.3, p0 + val(c.dp, t, 0))), d = d0 * val(c.d, t, 1);
  const tx = cx + val(c.tx, t, 0), ty = C.ty + val(c.ty, t, 0), tz = cz + val(c.tz, t, 0);
  const sh = (sc.shake || 0) ** 2 * 0.25, tt = t * 1.7;
  cam.position.set(tx + Math.sin(yaw) * Math.cos(pitch) * d + Math.sin(tt * 47) * sh, Math.max(0.25, ty + Math.sin(pitch) * d) + Math.sin(tt * 61) * sh, tz + Math.cos(yaw) * Math.cos(pitch) * d + Math.cos(tt * 53) * sh);
  cam.up.set(0, 1, 0);
  cam.lookAt(tx, ty, tz);
  const roll = val(c.roll, t, 0); if (roll) cam.rotateZ(roll);
  const fov = val(c.fov, t, 50); if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
  cam.updateMatrixWorld();
}

/* ------------------------------------------------------------------ camera moves (t in source seconds) */
const orbit = (y0: number, y1: number, dur = 4, dp = 0, d = 1): Cam => ({ yaw: [[0, y0], [dur, y1]], dp: [[0, dp]], d: [[0, d]] });
const dolly = (d0: number, d1: number, dur = 4, yaw = 0, dp = 0, ty = 0): Cam => ({ d: [[0, d0], [dur, d1]], yaw: [[0, yaw]], dp: [[0, dp]], ty: [[0, ty]] });
const low = (y0: number, y1: number, dur = 4, d = 0.7): Cam => ({ yaw: [[0, y0], [dur, y1]], dp: [[0, -0.22]], d: [[0, d]], ty: [[0, 0.5]], fov: [[0, 46]] });

/* ------------------------------------------------------------------ the sources */
const SRC: Src[] = [
  // gate / gathering
  { id: 'gate', demo: 'travel', ter: 'Врата башни', cam: { yaw: [[0, 1.2], [4, 1.5]], d: [[0, 1.2], [4, 0.95]], dp: [[0, -0.04]], ty: [[0, 0.6]] }, title: 'Gate: tower with the glowing portal, slow push' },
  { id: 'gather', demo: 'gather', cam: { d: [[0, 1.0], [4, 0.72]], yaw: [[0, 0.15], [4, -0.1]], dp: [[0, -0.1]], ty: [[0, 0.3]] }, title: 'Gathering at the gate: sign, tent, party, dolly-in' },
  // the march through the biomes
  { id: 'forest', demo: 'travel', ter: 'Лес', cam: dolly(1.25, 0.8, 4, -0.35, -0.1, 0.4), title: 'Forest march, light shafts, dolly-in' },
  { id: 'river', demo: 'travel', ter: 'Река', cam: orbit(-0.6, -0.1, 4, -0.12, 0.85), title: 'River march, orbit' },
  { id: 'falls', demo: 'travel', ter: 'Водопад', cam: { yaw: [[0, -1.25], [4, -1.6]], d: [[0, 1.1], [4, 1.0]] }, title: 'Waterfall in view, orbit' },
  { id: 'bridge', demo: 'travel', ter: 'Старый мост', cam: { yaw: [[0, -1.3], [4, -1.65]], d: [[0, 1.1], [4, 1.0]] }, title: 'Old bridge beside the party' },
  { id: 'gorge', demo: 'travel', ter: 'Ущелье', cam: { yaw: [[0, 0.55], [4, 0.9]], d: [[0, 0.72]], dp: [[0, -0.1]], ty: [[0, 0.3]] }, title: 'Gorge walls, close orbit' },
  { id: 'desert', demo: 'travel', ter: 'Пустыня', cam: low(0.2, 0.75), title: 'Desert arches, low angle' },
  { id: 'barrow', demo: 'travel', ter: 'Курган', cam: dolly(0.85, 0.68, 4, 0.1, -0.12, 0.35), title: 'Barrow, close' },
  { id: 'swamp', demo: 'travel', ter: 'Болото', cam: dolly(1.2, 0.8, 4, 0.5, -0.12, 0.3), title: 'Swamp, dolly-in' },
  { id: 'taiga', demo: 'travel', ter: 'Тайга', cam: dolly(0.78, 0.62, 4, -0.1, -0.15, 0.4), title: 'Taiga snow, close' },
  { id: 'mine', demo: 'travel', ter: 'Шахта', cam: dolly(0.78, 0.62, 4, 0.1, -0.15, 0.4), title: 'Mine rails, lamps, close' },
  { id: 'cave', demo: 'travel', ter: 'Пещера', cam: dolly(0.78, 0.62, 4, 0.12, -0.15, 0.4), title: 'Crystal cave, close' },
  { id: 'dungeon', demo: 'dungeon', cam: dolly(1.2, 0.8, 4, 0.2, 0, 0.3), title: 'Dungeon crossroads' },
  { id: 'rest', demo: 'rest', cam: orbit(0.4, 0.0, 4, -0.1, 0.8), title: 'Rest at the campfire' },
  // events
  { id: 'well', demo: 'ev-well', cam: dolly(1.15, 0.9), title: 'Event: wishing well' },
  { id: 'goblin', demo: 'gob-shell', cam: dolly(1.15, 0.9), title: 'Event: goblin fair, shell game' },
  { id: 'skel', demo: 'hw-skeldance-show', cam: dolly(1.15, 0.9), title: 'Event: skeleton dance' },
  { id: 'cauldron', demo: 'hw-cauldron', cam: dolly(1.15, 0.9), title: 'Event: witch cauldron' },
  // battles: the FakeQuest wolf battle, sought to its hit stages (plan 56 = party hit r1, 65 = the pack's throw, 77 = hit r2)
  { id: 'b-hit-forest', seek: 55.4, ter: 'Лес', cam: orbit(-0.12, 0.1, 4, -0.05, 0.97), title: 'Battle hit stage, forest' },
  { id: 'b-desert', seek: 55.4, ter: 'Пустыня', cam: orbit(0.1, -0.1, 4, -0.04, 0.97), title: 'Battle hit stage, desert' },
  { id: 'b-gorge', seek: 55.4, ter: 'Ущелье', cam: { yaw: [[0, 0.12], [4, -0.08]], dp: [[0, -0.08]], d: [[0, 0.97]], ty: [[0, 0.3]] }, title: 'Battle hit stage, gorge, lower' },
  { id: 'b-taiga', seek: 76.4, ter: 'Тайга', cam: dolly(1.0, 0.92, 4, -0.12, -0.05, 0.2), title: 'Battle hit r2, taiga' },
  { id: 'b-tele', seek: 64.4, ter: 'Курган', cam: orbit(-0.1, 0.1, 4, -0.05, 0.97), title: 'Battle: the pack throws (tele2), barrow' },
  { id: 'b-cave', seek: 76.4, ter: 'Пещера', cam: { yaw: [[0, -0.12], [4, 0.08]], dp: [[0, -0.1]], d: [[0, 0.97]], ty: [[0, 0.35]] }, title: 'Battle hit r2, cave, lower' },
  { id: 'b-gate', seek: 55.4, ter: 'Врата башни', cam: orbit(0.12, -0.04, 4, -0.05, 0.97), title: 'Battle hit stage at the tower gate' },
  { id: 'b-swamp', seek: 64.4, ter: 'Болото', cam: orbit(-0.1, 0.1, 4, -0.1, 1.0), title: 'Battle: the pack throws, swamp' },
  { id: 'b-mine', seek: 76.4, ter: 'Шахта', cam: dolly(1.0, 0.92, 4, 0.12, -0.06, 0.25), title: 'Battle hit r2, mine' },
  // lair / boss
  { id: 'lair', demo: 'lair', cam: { fit: true, yaw: [[0, 0.15], [4, 0.4]], dp: [[0, -0.12]], d: [[0, 0.8], [4, 0.7]], ty: [[0, 0.8]] }, rate: [[0, 0.35]], title: 'Lair islands, slow-mo orbit' },
  { id: 'boss-reveal', demo: 'boss', cam: { yaw: [[0, 0.75], [4, 0.5]], dp: [[0, -0.12], [4, -0.06]], d: [[0, 1.05], [4, 0.9]], ty: [[0, 0.3], [4, 0.7]] }, rate: [[0, 0.3]], title: 'Boss reveal: low, push, slow-mo' },
  { id: 'boss', demo: 'boss', cam: { fit: true, yaw: [[0, -0.62], [4, -0.38]], dp: [[0, 0.05]], d: [[0, 0.78], [4, 0.72]] }, title: 'Boss fight, both sides in frame' },
  { id: 'boss-adds', demo: 'boss-adds', cam: orbit(0.15, -0.1, 4, -0.05, 0.95), title: 'Boss rage with adds' },
  { id: 'boss-zones', demo: 'boss-zones', cam: { fit: true, yaw: [[0, -0.35], [4, -0.55]], dp: [[0, 0.02]], d: [[0, 0.8]] }, title: 'Boss: platforms collapse' },
  { id: 'boss-words', demo: 'boss-words', cam: orbit(-0.1, 0.1, 4, -0.04, 0.95), title: 'Boss: spell words' },
  { id: 'battle-long', seek: 44, dur: 42, ter: 'Лес', cam: { yaw: [[0, -0.12], [21, 0.12], [42, -0.1]], dp: [[0, -0.05]], d: [[0, 0.97]] }, title: 'Battle 1 long take (plan 44 → 86), forest' },
  // victory / loot
  { id: 'victory', seek: 79.6, ter: 'Луг', cam: { d: [[0, 1.0], [4, 0.9]], yaw: [[0, 0.1], [4, -0.1]] }, title: 'Victory (battle end)' },
  { id: 'victory-demo', demo: 'battle-end', cam: { d: [[0, 1.0], [4, 0.9]], yaw: [[0, 0.1], [4, -0.1]] }, title: 'Victory demo («Победа!»)' },
  // the whole FakeQuest boss fight (plan 184 → 262: rounds, tail swing, phase 2, sinking platforms, feint, death), two cameras
  { id: 'boss-long', seek: 184, dur: 78, cam: { fit: true, yaw: [[0, -0.6], [20, -0.3], [40, -0.6], [60, -0.3], [78, -0.5]], dp: [[0, 0.04]], d: [[0, 0.8]] }, title: 'Boss fight long take, wide' },
  { id: 'boss-low', seek: 184, dur: 78, cam: { yaw: [[0, 0.4], [26, 0.1], [52, 0.45], [78, 0.15]], dp: [[0, -0.12]], d: [[0, 0.88]], ty: [[0, 0.6]] }, title: 'Boss fight long take, low' },
  { id: 'treasure', demo: 'treasure', cam: dolly(1.0, 0.88), title: 'Treasure vault' },
  { id: 'end-gate', demo: 'travel', ter: 'Врата башни', dur: 6, cam: { d: [[0, 0.62], [6, 0.82]], dp: [[0, -0.17], [6, -0.1]], ty: [[0, 0.4], [6, 0.6]], yaw: [[0, 0.06], [6, -0.06]] }, title: 'End: gate, slow crane out under the title' },
];

export const EXPMOVIE: Segment[] = SRC.map(source);
