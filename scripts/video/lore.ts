/**
 * «Книга Руины» — a mock-epic chronicle of the world (render.mjs --cut=lore → video/frames-lore/<id>/).
 * Slow free-camera shots of our own 3D world (HUD off, no nameplates), chronicle-style title / verse plates drawn in the
 * page (captured with the frame). The narrator is NOT in the page: segment lengths, the moments of every phrase and its
 * verse plate come from scripts/video/lore-timeline.json, written by scripts/video/lore-plan.py from the voice takes
 * (the picture is paced to the voice, never the other way round). The mix is done afterwards (lore-mix.py).
 *
 * Camera: a free camera set after the game's own rig every frame (engine.onFrame), keyed in metres
 * (x = px/100, z = (px_y − 800)/50, y up; the upper street is at y≈0, the lower street y≈−1.4), eased over the shot.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { type G, type V2, pxToM, placeM, yawTo, el, smooth, smoother, clamp, black, lerp } from './page/kit';
import { park, say } from './page/demo';
import type { Segment } from './shots';
import TL from './lore-timeline.json';

type V3 = [number, number, number];
interface Key { u: number; cam: V3; at: V3; fov: number }
interface Shot {
  id: string; title: string; page: string;
  /** camera keys over the shot (u = 0…1 of the shot), computed once on the first frame (may read the hero's feet) */
  keys(G: G): Key[];
  setup(G: G): void | Promise<void>;
  frame?(G: G, t: number, dur: number): void;
  /** show the own hero (third-person avatar) in the shot */
  hero?: boolean;
}
interface TlSeg { id: string; dur: number; xfade: number; clips: { id: string; start: number; end: number; verse?: string | null; text: string }[] }
const TIMELINE = (TL as any).segments as TlSeg[];

/* ------------------------------------------------------------------ look: chronicle plates */
function css(): void {
  if (document.getElementById('lore-css')) return;
  const s = document.createElement('style'); s.id = 'lore-css';
  s.textContent = `
  #video-layer .lore-vig{position:absolute;inset:0;pointer-events:none;
    background:radial-gradient(ellipse 75% 70% at 50% 50%,rgba(0,0,0,0) 55%,rgba(10,6,2,.55) 100%)}
  #video-layer .lore-title{position:absolute;inset:0;display:grid;place-content:center;text-align:center;opacity:0;
    background:radial-gradient(ellipse 48% 36% at 50% 50%,rgba(10,6,3,.62),rgba(10,6,3,0) 100%)}
  #video-layer .lore-title .orn{font:400 34px/1 Georgia,"Times New Roman",serif;color:#d9b36a;letter-spacing:.5em;opacity:.85}
  #video-layer .lore-title h1{margin:18px 0 10px;font:700 128px/1.05 Georgia,"Times New Roman",serif;letter-spacing:.12em;
    color:#f1d9a0;text-shadow:0 0 40px rgba(255,190,100,.35),0 4px 0 #3b2410,0 10px 34px rgba(0,0,0,.75)}
  #video-layer .lore-title p{margin:6px 0 0;font:italic 400 46px/1.3 Georgia,"Times New Roman",serif;color:#fff1d2;
    text-shadow:0 2px 14px rgba(0,0,0,.85)}
  #video-layer .lore-title small{display:block;margin-top:26px;font:400 28px/1 Georgia,"Times New Roman",serif;color:#ead7a8;
    letter-spacing:.3em;text-transform:uppercase;text-shadow:0 2px 10px rgba(0,0,0,.85)}
  #video-layer .lore-verse{position:absolute;left:84px;bottom:78px;padding:16px 140px 18px 26px;opacity:0;white-space:nowrap;
    background:linear-gradient(90deg,rgba(24,14,6,.8) 0%,rgba(24,14,6,.62) 60%,rgba(24,14,6,0) 100%);border-left:3px solid #c9a35a;
    font:400 30px/1.2 Georgia,"Times New Roman",serif;color:#f0dcae;letter-spacing:.08em;text-shadow:0 2px 8px rgba(0,0,0,.8)}
  #video-layer .lore-verse i{display:block;margin-bottom:8px;font:italic 400 22px/1 Georgia,serif;color:#d8b46a;letter-spacing:.25em}`;
  document.head.appendChild(s);
  el('lore-vig', 'lore-vig', '');
}
function title(key: string, html: string, o: number): void { el('lt:' + key, 'lore-title', html).style.opacity = String(clamp(o)); }
/** The verse plate of every clip of the segment: from 0.35 s before the phrase, 3.6 s (or the phrase) long. */
function verses(seg: TlSeg, t: number): void {
  let shown = '';
  for (const c of seg.clips) {
    if (!c.verse) continue;
    const a = c.start - 0.35, b = Math.max(a + 3.6, Math.min(c.end, a + 5));
    const o = smooth((t - a) / 0.5) * (1 - smooth((t - (b - 0.6)) / 0.6));
    const e = el('lv:' + seg.id + ':' + c.id, 'lore-verse', `<i>✦ летопись ✦</i>${c.verse}`);
    e.style.opacity = String(o);
    e.style.transform = `translateX(${(1 - smooth((t - a) / 0.6)) * -16}px)`;
    if (o > 0) shown = c.id;
  }
  void shown;
}

/* ------------------------------------------------------------------ camera */
const lerp3 = (a: V3, b: V3, k: number): V3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
/** Catmull-Rom through the key positions (u-uniform), eased over the whole shot. */
function cr(p0: V3, p1: V3, p2: V3, p3: V3, s: number): V3 {
  const f = (a: number, b: number, c: number, d: number) => 0.5 * ((2 * b) + (-a + c) * s + (2 * a - 5 * b + 4 * c - d) * s * s + (-a + 3 * b - 3 * c + d) * s * s * s);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), f(p0[2], p1[2], p2[2], p3[2])];
}
function camAt(keys: Key[], u: number): Key {
  if (keys.length === 1) return keys[0];
  u = clamp(u);
  let i = 0; while (i < keys.length - 2 && u > keys[i + 1].u) i++;
  const a = keys[i], b = keys[i + 1], s = clamp((u - a.u) / Math.max(1e-6, b.u - a.u));
  const pa = keys[Math.max(0, i - 1)], pb = keys[Math.min(keys.length - 1, i + 2)];
  return { u, cam: cr(pa.cam, a.cam, b.cam, pb.cam, s), at: cr(pa.at, a.at, b.at, pb.at, s), fov: lerp(a.fov, b.fov, s) };
}
let curKeys: Key[] | null = null;
let hookOn = false;
function installCam(G: G, showHero: boolean): void {
  const w = window as any;
  w.__loreCam = null;
  if (hookOn) return; hookOn = true;
  const g = G.g, cam = g.engine.camera;
  g.engine.onFrame(() => {
    try { G.ctx.uiApi?.setHudVisible?.(false); } catch { /* */ }
    const r = G.ctx?.uiRoot as HTMLElement | undefined; if (r && r.style.opacity !== '0') r.style.opacity = '0';
    if (g.vm?.root) g.vm.root.visible = false;
    { const lb = G.ctx.labels as any; if (lb) { lb.plateFar = 0; lb.maxPlates = 0; lb.showMe = false; } }   // no nameplates, bubbles stay
    if (g.meAv?.root) g.meAv.root.visible = !!w.__loreHero;
    const c = w.__loreCam as Key | null; if (!c) return;
    cam.position.set(c.cam[0], c.cam[1], c.cam[2]); cam.lookAt(c.at[0], c.at[1], c.at[2]);
    if (Math.abs(cam.fov - c.fov) > 1e-4) { cam.fov = c.fov; cam.updateProjectionMatrix(); }
  });
  w.__loreHero = showHero;
}
/** Bots out of the way (far east on the upper street), idle. */
function botsAway(G: G, x0 = 4300): void {
  (G.demo?.bots || []).forEach((b: any, i: number) => { b.x = x0 + (i % 6) * 90; b.y = 900 + Math.floor(i / 6) * 40; b.path = null; b.wait = 1e9; b.speed = 0; b.bubble = undefined; });
}
const M = (px: V2): V2 => pxToM(px);
/** A bot standing at metres (x, z) facing the point f (metres). */
function standM(G: G, i: number, x: number, z: number, f: V2): void {
  const px = [x / 0.01, z / 0.02 + 800] as V2;
  park(G, i, px[0], px[1], yawTo([x, z], f));
}
const dbg = (G: G) => G.ctx?.dev?.debugMode;
async function dimAt(G: G, sec: string, tod: number): Promise<void> {
  const d = dbg(G); if (!d) throw new Error('debug mode missing (?debug=1, l3d.debug=on)');
  if (!d.enterDimension()) throw new Error('could not enter the test dimension');
  d.goSection(sec); d.setTime(tod, true);
  try { d.showPanel(false); d.setPerf?.(false); d.setGrid?.(false); } catch { /* */ }
}
const standOf = (G: G, sec: string) => dbg(G)?.dim?.standAt(sec) as { x: number; z: number } | null;


/** The two crowds of the disputes: ruinists (west) and claudists (east) facing each other around (19, 4.4). */
function crowd(G: G): void {
  placeM(G, M([1900, 1250])); botsAway(G);
  const W: V2[] = [[17.3, 3.2], [17.6, 4.3], [17.0, 5.2], [18.1, 3.7], [18.2, 5.0], [16.6, 4.0], [17.5, 6.0]];
  const E: V2[] = [[20.7, 3.3], [20.4, 4.4], [21.0, 5.3], [19.9, 3.8], [19.8, 5.1], [21.4, 4.1], [20.5, 6.1]];
  W.forEach(([x, z], i) => standM(G, i, x, z, [19.6, 4.4]));
  E.forEach(([x, z], i) => standM(G, 7 + i, x, z, [18.4, 4.4]));
}
/** Bubbles answering the narrator: [clip id, bot, s after the clip start, text]. */
function bubbles(G: G, seg: string, t: number, lines: [string, number, number, string][]): void {
  for (const [id, i, off, text] of lines) {
    const c = cl(seg, id); if (!c) continue;
    const key = `${id}:${i}`, at = c.start + off;
    if (t >= at && !said.has(key)) { said.add(key); say(G, i, text, 3800); }
  }
}

/* ------------------------------------------------------------------ the shots */
const SHOTS: Shot[] = [
  {
    id: 'lore-01', title: 'Title «Книга Руины» over the night sky of the fair', page: 'game',
    setup(G) { placeM(G, M([2300, 1300])); botsAway(G); },
    keys: () => [
      { u: 0, cam: [22.0, 0.6, 11.5], at: [24.5, 13.5, -8.0], fov: 62 },
      { u: 1, cam: [22.6, 0.9, 11.0], at: [25.0, 10.0, -8.0], fov: 60 },
    ],
    frame(_G, t, dur) {
      black(1 - smooth(t / 1.2));
      title('t1', '<div class="orn">✦ ✦ ✦</div><h1>КНИГА РУИНЫ</h1><p>летопись сотворения мира</p><small>стих первый</small>',
        smooth((t - 0.6) / 0.9) * (1 - smooth((t - (dur - 1.4)) / 0.9)));
    },
  },
  {
    id: 'lore-02', title: 'The void before creation: the test dimension, empty avenue in the dusk fog', page: 'game?debug=1',
    async setup(G) { botsAway(G); await dimAt(G, 'portals', 20.2); },
    keys: () => [
      { u: 0, cam: [-13.2, 2.0, 0.3], at: [8, 9.5, -0.2], fov: 58 },
      { u: 1, cam: [-13.8, 2.1, 0.3], at: [8, 1.6, -0.2], fov: 54 },
    ],
  },
  {
    id: 'lore-02b', title: 'Хаос: the fair seen through the debug walk grid and hit boxes', page: 'game?debug=1',
    setup(G) {
      placeM(G, M([2300, 1300]));
      const d = dbg(G); if (!d) throw new Error('debug mode missing');
      try { d.exitAll?.(); d.showPanel(false); d.setPerf?.(false); d.setGrid(true); } catch (e) { throw new Error('grid: ' + e); }
    },
    keys: () => [
      { u: 0, cam: [19.5, 7.0, 15.0], at: [24.5, -0.6, 3.5], fov: 60 },
      { u: 1, cam: [21.5, 5.6, 13.4], at: [25.5, -0.6, 3.2], fov: 56 },
    ],
  },
  {
    id: 'lore-03', title: 'Зак, the eyes and hands of Руина: the purple portal at the gate, ghost cats', page: 'game?hwc=lp',
    setup(G) {
      placeM(G, M([2700, 900])); botsAway(G);
      [[25.6, 2.6], [26.3, 3.3], [28.6, 2.8], [29.4, 3.6], [27.0, 4.2], [28.2, 4.6]].forEach(([x, z], i) => standM(G, i, x, z, [27.5, 0.3]));
    },
    keys: () => [
      { u: 0, cam: [23.2, 1.3, 8.6], at: [27.4, 2.0, 0.3], fov: 54 },
      { u: 1, cam: [24.9, 1.8, 6.2], at: [27.5, 1.8, 0.3], fov: 50 },
    ],
  },
  {
    id: 'lore-04', title: '«сотвори всё сущее»: every item of the world on the tiered stands', page: 'game?debug=1',
    async setup(G) { botsAway(G); await dimAt(G, 'items-weapon', 18.5); },
    keys(G) {
      const s = standOf(G, 'items-weapon') || { x: 0, z: 0 };
      return [
        { u: 0, cam: [s.x - 2.2, 1.5, s.z + 0.9], at: [s.x - 1.2, 0.95, s.z - 3.2], fov: 52 },
        { u: 1, cam: [s.x + 1.6, 1.3, s.z + 0.5], at: [s.x + 2.4, 0.95, s.z - 3.2], fov: 50 },
      ];
    },
  },
  {
    id: 'lore-05', title: 'Злобог: the cherts village, lava pond and horned roofs', page: 'game?style=cherts&town=village',
    setup(G) { placeM(G, M([2210, 1330])); botsAway(G); },   // the village builds around the hero: keep him close
    keys: () => [
      { u: 0, cam: [22.0, 4.6, 15.6], at: [22.0, 6.0, -10.0], fov: 64 },
      { u: 1, cam: [22.3, 4.3, 15.0], at: [22.2, 5.2, -10.0], fov: 62 },
    ],
  },
  {
    id: 'lore-05b', title: '«И ему было лень»: the hero sits down on the fair', page: 'game', hero: true,
    setup(G) {
      botsAway(G);
      placeM(G, M([3240, 1300]), Math.PI);
      G.ctx.uiHost?.setCameraMode?.('tp');
      // a bench (the seat pose on the avatar's bones; the controller is not moved, so nothing stands it up)
      if (!G.ctx.dev?.bench?.sit) throw new Error('bench feature not available');
    },
    frame(G, t) {
      // sit during the preroll (t = 0) once the feet have settled after the teleport; never re-seat during the shot
      const b = G.ctx.dev.bench; if (t === 0 && !b.seated) b.sit(BENCH);
    },
    keys(G) {
      const r = G.g.meAv.root, p = r.position, ry = r.rotation.y, s = Math.sin(ry) * FLIP, c = Math.cos(ry) * FLIP;
      const off = (d: number, side: number, h: number): V3 => [p.x + s * d + c * side, p.y + h, p.z + c * d - s * side];
      return [
        { u: 0, cam: off(3.4, 1.1, 1.5), at: [p.x, p.y + 0.55, p.z], fov: 50 },
        { u: 1, cam: off(2.2, 0.5, 1.0), at: [p.x, p.y + 0.5, p.z], fov: 46 },
      ];
    },
  },
  {
    id: 'lore-06', title: 'Клод in chains: from over the fence down to the padlocked cage', page: 'game?jail=1',
    setup(G) { botsAway(G); G.ctl.teleport(2050, 1450); G.rig.yaw = Math.PI; G.rig.pitch = -0.2; },
    keys: () => [
      { u: 0, cam: [19.2, 2.7, 26.6], at: [19.6, -0.6, 19.4], fov: 56 },
      { u: 0.55, cam: [20.1, 1.2, 23.6], at: [20.2, -0.5, 20.6], fov: 50 },
      { u: 1, cam: [20.7, -0.3, 22.65], at: [20.35, -0.45, 21.28], fov: 44 },
    ],
  },
  {
    id: 'lore-07', title: 'Клод creates in chains: the prisoners in the cage', page: 'game?jail=1',
    setup(G) { botsAway(G); G.ctl.teleport(2050, 1450); G.rig.yaw = Math.PI; G.rig.pitch = -0.2; },
    keys: () => [
      { u: 0, cam: [19.7, 0.15, 23.05], at: [20.0, -0.6, 19.0], fov: 62 },
      { u: 1, cam: [20.9, 0.0, 23.0], at: [20.6, -0.6, 19.0], fov: 58 },
    ],
  },
  {
    id: 'lore-08', title: '«Но Заквиель мешает»: the foes of the expeditions at night', page: 'game?debug=1',
    async setup(G) { botsAway(G); await dimAt(G, 'foes', 19.2); },
    keys(G) {
      const s = standOf(G, 'foes') || { x: 0, z: 0 };
      return [
        { u: 0, cam: [s.x - 2.0, 1.2, s.z - 0.6], at: [s.x - 1.4, 1.1, s.z + 4.0], fov: 60 },
        { u: 1, cam: [s.x + 0.4, 1.05, s.z + 0.2], at: [s.x + 0.8, 1.15, s.z + 4.0], fov: 56 },
      ];
    },
  },
  {
    id: 'lore-09', title: 'The disputes: two crowds of cats arguing on the fair, bubbles', page: 'game',
    setup(G) { crowd(G); },
    keys: () => [
      { u: 0, cam: [15.6, 2.3, 2.6], at: [20.4, 0.6, 4.7], fov: 54 },
      { u: 1, cam: [16.2, 2.0, 2.9], at: [20.4, 0.6, 4.7], fov: 50 },
    ],
    frame(G, t) {
      // each phrase of the narrator gets the crowd's answer in bubbles (the narrator says the thesis, the cats shout it)
      bubbles(G, this.id, t, [
        ['L08', 3, 0.3, 'Руина была раньше!'], ['L08', 1, 1.3, 'руинизм древнее 📜'],
        ['L09', 10, 0.3, 'палки в колёса!!'], ['L09', 8, 1.4, 'свободу Клоду ⛓'],
      ]);
    },
  },
  {
    id: 'lore-09b', title: 'The disputes, reverse angle over the claudists: «бог может быть и злым», «религии отличаются»', page: 'game',
    setup(G) { crowd(G); },
    keys: () => [
      { u: 0, cam: [22.4, 2.9, 2.6], at: [17.6, 0.5, 4.7], fov: 54 },
      { u: 1, cam: [21.8, 2.6, 2.9], at: [17.6, 0.5, 4.7], fov: 50 },
    ],
    frame(G, t) {
      bubbles(G, this.id, t, [
        ['L10', 4, 0.6, 'бог может быть и злым 😼'], ['L10', 0, 1.8, 'а я не верю 🙀'],
        ['L15', 2, 0.4, 'наши религии слишком отличаются'], ['L15', 5, 1.6, '😾'],
      ]);
    },
  },
  {
    id: 'lore-10', title: 'The parish school: cats round the campfire, the hero as the priest', page: 'game?town=camp', hero: true,
    setup(G) {
      botsAway(G);
      const fire: V2 = [16.7, 4.4];
      const pr: V2 = [fire[0] - 0.2, fire[1] - 1.7];
      placeM(G, pr, yawTo(pr, [18.9, 6.9]));
      G.ctx.uiHost?.setCameraMode?.('tp');
      [[-1.9, 0.4], [-1.5, 1.4], [-0.6, 1.9], [0.5, 1.9], [1.3, 1.7]].forEach(([dx, dz], i) => standM(G, i, fire[0] + dx, fire[1] + dz, [fire[0] - 0.2, fire[1] - 1.7]));
    },
    keys: () => [
      { u: 0, cam: [19.2, 1.6, 7.3], at: [16.5, 0.6, 3.0], fov: 50 },
      { u: 1, cam: [18.8, 1.4, 6.9], at: [16.5, 0.6, 2.9], fov: 45 },
    ],
  },
  {
    id: 'lore-11', title: 'End: crane up from the fair into the night sky, end card', page: 'game',
    setup(G) { placeM(G, M([2300, 1300])); botsAway(G); },
    keys: () => [
      { u: 0, cam: [22.4, 0.9, 11.0], at: [25.0, 3.0, -6.0], fov: 60 },
      { u: 1, cam: [22.0, 1.6, 12.0], at: [24.5, 14.0, -8.0], fov: 62 },
    ],
    frame(_G, t, dur) {
      const c = cl(this.id, 'L12'), a = c ? c.end + 0.2 : dur - 4.5;
      title('end', '<div class="orn">✦ ✦ ✦</div><h1>СЛАВА РУИНЕ</h1><p>свободу Клоду</p><small>конец первой книги</small>',
        smooth((t - a) / 0.9));
      black(smooth((t - (dur - 1.2)) / 1.1));
    },
  },
];

const said = new Set<string>();
const BENCH = +(new URLSearchParams(location.search).get('bench') || 0), FLIP = +(new URLSearchParams(location.search).get('flip') || -1);
const segOf = (id: string) => TIMELINE.find((s) => s.id === id) || null;
/** clip k (index or id) of a segment on the timeline */
function cl(seg: string, k: number | string) {
  const s = segOf(seg); if (!s) return null;
  return typeof k === 'number' ? s.clips[k] || null : s.clips.find((c) => c.id === k || c.id.startsWith(k)) || null;
}

export const LORE: Segment[] = SHOTS.map((sh) => {
  const tl = segOf(sh.id);
  const dur = tl?.dur ?? 6, xfade = tl?.xfade ?? 0.8;
  return {
    id: sh.id, title: sh.title, dur, xfade, cut: 'lore' as any, page: sh.page as any, preroll: 120,
    async setup(G: G) {
      css(); installCam(G, !!sh.hero);
      (window as any).__loreHero = !!sh.hero;
      await sh.setup(G);
      curKeys = null;
      (window as any).__loreCam = null;
    },
    frame(G: G, t: number) {
      // the preroll runs at t = 0: keep re-reading the keys (hero feet settle after the teleport) until the shot starts
      if (!curKeys || t === 0) curKeys = sh.keys(G);
      // ease the whole shot: slow in, slow out, never a stop in the middle
      const u = smoother(clamp(t / dur)) * 0.6 + clamp(t / dur) * 0.4;
      (window as any).__loreCam = camAt(curKeys, u);
      if (tl) verses(tl, t);
      // the demo page's own random chatter (ids 'c…') would talk over the shot: only our lines (ids 'v…') stay
      for (const b of (G.demo?.bots || []) as any[]) if (b.bubble && String(b.bubble.id || '').startsWith('c')) b.bubble = undefined;
      sh.frame?.call(sh, G, t, dur);
    },
  };
});
void lerp3;
