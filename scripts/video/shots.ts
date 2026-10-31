/**
 * The review video timeline: segments rendered independently (one fresh page each, in parallel), joined with
 * crossfades by render.mjs. Inside a segment everything is a pure function of the segment time t (seconds).
 * Coordinates: city px (x along the street, y = depth; upper street y≈800–1060, lower level y≈1124–1500).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { type G, type V2, Spline, travel, keyed, pxToM, placeM, steer, stopStick, yawTo, clamp, wrap, caption, el, env, smooth, black, cursor, type CursorKey, planPath } from './page/kit';
import { park, say, enableMine, inters, hitCentre, clearAround } from './page/demo';

export const FPS = 60;

export interface Segment {
  id: string;
  /** shown in logs / README */
  title: string;
  /** seconds */
  dur: number;
  /** crossfade into the NEXT segment (seconds, 0 = cut) */
  xfade?: number;
  /** frames stepped (rendered, not captured) after setup with the pose held at t = 0; default 90 */
  preroll?: number;
  /** test-only segments are not part of the final cut */
  test?: boolean;
  /** which video the segment belongs to (render.mjs --cut=…); default 'promo' */
  cut?: 'promo' | 'gameplay' | 'edit' | 'lore' | 'expmovie';
  /** edit cut: capture only output seconds [a, b) of the segment (the rest is fast-forwarded with rendering off) */
  win?: [number, number];
  /** slow-mo / speed ramp: [[output s, game-time rate], …] piecewise linear; frame(G, t) then gets GAME time */
  rate?: [number, number][];
  /** narrator slots anchored on marks (gameplay cut): text is a suggestion for the voice-over */
  narr?: { mark: string; off: number; dur: number; text: string }[];
  /** dist-dev page: 'game' (offline demo, default) or 'showcase' */
  page?: 'game' | 'showcase' | `expedition${string}`;
  /** reason to skip (feature missing) or null */
  requires?(G: G): string | null;
  setup(G: G): Promise<void> | void;
  frame(G: G, t: number): void;
}

/* ------------------------------------------------------------------ helpers */
/** Walk path (px points) with a cruise speed (m/s): returns a driver(t) that steers the player; yawFn gives the camera. */
export function walker(pts: V2[], v: number, acc = 0.9) {
  const sp = new Spline(pts.map(pxToM));
  const dur = travel(0, sp.length, v, acc).total;
  let hd: number[] | null = null;
  return {
    sp, dur,
    /** position on the path at t (m) */
    at(t: number): V2 { return sp.at(travel(t, sp.length, v, acc).s); },
    /** Smoothed travel heading (yaw convention) at walk time t: look-ahead direction, ±0.45 s moving average. */
    heading(t: number): number {
      if (!hd) {
        const N = Math.ceil((dur + 4) * FPS), raw: number[] = [];
        let prev = 0, have = false;
        for (let i = 0; i <= N; i++) {
          const u = i / FPS, a = this.at(Math.max(0, u - 0.25)), b = this.at(u + 0.75);
          if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.15) { const y = yawTo(a, b); prev = have ? prev + wrap(y - prev) : y; have = true; }
          raw.push(prev);
        }
        const W = Math.round(0.45 * FPS); hd = raw.map((_, i) => { let sum = 0, n = 0; for (let k = -W; k <= W; k++) { const j = Math.min(raw.length - 1, Math.max(0, i + k)); sum += raw[j]; n++; } return sum / n; });
      }
      const i = Math.min(hd.length - 1, Math.max(0, Math.round(t * FPS)));
      return hd[i];
    },
    drive(G: G, t: number, yaw: number, t0 = 0): void {
      const tt = t - t0;
      if (tt < 0) { stopStick(G); return; }
      const s0 = travel(tt, sp.length, v, acc).s, s1 = travel(tt + 1 / FPS, sp.length, v, acc).s;
      if (tt > dur + 0.3) { stopStick(G); return; }
      const p0 = sp.at(s0), p1 = sp.at(s1);
      steer(G, p1, [(p1[0] - p0[0]) * FPS, (p1[1] - p0[1]) * FPS], yaw);
    },
  };
}
/**
 * A walker along waypoints (px in the city / metres in rooms), each leg routed around props and walls with A*
 * (planPath) unless marked direct (e.g. the leg that jumps over a bench). Built in setup (needs the walk space).
 */
export type Leg = V2 | { to: V2; direct: true };
export function routed(G: G, start: V2, legs: Leg[], v: number, acc = 0.9) {
  const toM = (p: V2): V2 => (G.ctl.units === 'px' ? pxToM(p) : p);
  const pts: V2[] = [toM(start)];
  for (const L of legs) {
    const to = toM(Array.isArray(L) ? L : L.to), from = pts[pts.length - 1];
    const seg = Array.isArray(L) ? planPath(G, from, to) : null;
    if (seg) pts.push(...seg.slice(1)); else pts.push(to);
    if (Array.isArray(L) && !seg) console.warn('[director] no route to', JSON.stringify(L), '— going straight');
  }
  // drop near-duplicates (the spline needs distinct points)
  const out: V2[] = [pts[0]];
  for (const p of pts) if (Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) > 0.3) out.push(p);
  return walker(out.map((p) => (G.ctl.units === 'px' ? [p[0] / 0.01, p[1] / 0.02 + 800] as V2 : [p[0] / 0.01, p[1] / 0.02 + 800] as V2)), v, acc);
}
export const cam = (G: G, yaw: number, pitch: number) => { G.rig.yaw = yaw; G.rig.pitch = pitch; };
export const mode = (G: G, m: 'fp' | 'tp') => { if (G.ctx.state.mode !== m) G.ctx.uiHost.setCameraMode(m); };
/** Once-per-segment triggers keyed by name: fire(G, 'x', t >= 3, () => …). */
const fired = new Set<string>();
const once = (key: string, cond: boolean, fn: () => void) => { if (cond && !fired.has(key)) { fired.add(key); fn(); } };

/* ------------------------------------------------------------------ cards */
export const uiOpacity = (G: G, o: number) => { const e = G.ctx?.uiRoot as HTMLElement | undefined; if (e) e.style.opacity = String(clamp(o)); };
function titleCard(t: number, a: number, b: number): void {
  const e = el('title', 'card', '<h1>Legion 3D</h1><p>Ярмарка Легиона — от первого и третьего лица</p>');
  const o = env(t, a, b, 0.7, 0.7);
  e.style.opacity = String(o);
  const h = e.querySelector('h1') as HTMLElement;
  h.style.transform = `scale(${0.94 + 0.06 * smooth((t - a) / (b - a))})`;
}
function endCard(t: number, a: number, b: number): void {
  const e = el('end', 'card', `<h1>Legion 3D</h1><p>расширение для Chrome · play.multidonate.ru в 3D</p>
    <div class="keys"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> ходить</span><span><kbd>Space</kbd> прыжок</span>
    <span><kbd>V</kbd> вид 1/3 лица</span><span><kbd>E</kbd> войти / взять</span><span><kbd>Tab</kbd> персонаж</span><span><kbd>M</kbd> карта</span></div>`);
  e.style.opacity = String(env(t, a, b, 0.8, 0.01));
}

/* ------------------------------------------------------------------ segments */
const Y = (y: number) => (y - 800) * 0.02;   // depth px → metres (z)
const E = -Math.PI / 2;                      // yaw facing east (+x)
// FP stroll along the upper street, past the board towards the forge
let fairWalk1 = walker([[1150, 985], [2380, 955]], 1.55, 1.2);
// TP: east past the gate, down the stairs, across the lower square and over a bench
let fairWalk2 = walker([[2380, 955], [3315, 1400]], 2.05, 0.9);
const T_TP = 10.2;
let fairJumpU = 7.4;   // segment time after T_TP when the hero takes off (computed in setup from the path)

const FAIR: Segment = {
  id: 'fair', title: 'Title + FP stroll at night → forge → TP walk past cats, bubbles → jump over a bench', dur: 20.5, xfade: 0.6,
  setup(G) {
    mode(G, 'fp'); G.ctx.applyCamera?.(true);
    placeM(G, pxToM([1150, 985]), E);
    fairWalk1 = routed(G, [1150, 985], [[1450, 975], [1800, 1000], [2120, 1000], [2380, 955]], 1.55, 1.2);
    fairWalk2 = routed(G, [2380, 955], [[2560, 1012], [2760, 1020], [2910, 1046], [2912, 1150], [3060, 1205], [3296, 1232], { to: [3302, 1330], direct: true }, [3315, 1420]], 2.05, 0.9);
    for (let w = 0; w < fairWalk2.dur; w += 1 / FPS) if (fairWalk2.at(w)[1] >= Y(1250)) { fairJumpU = w + 0.5; break; }
    cam(G, E + 0.25, 0.1);
    // a lived-in street: cats standing and chatting along the way
    park(G, 0, 1650, 940, 0.3); park(G, 1, 1720, 955, -1.2);          // near the board
    park(G, 2, 2050, 930, 3.0);                                         // at the anvil
    park(G, 3, 2520, 965, 2.6); park(G, 4, 2610, 1050, -0.6);          // TP stretch
    park(G, 5, 2700, 975, 1.9); park(G, 6, 2980, 1010, -2.2);
    park(G, 7, 3150, 1300, 0.8); park(G, 8, 3440, 1330, -1.0); park(G, 9, 3380, 1420, 2.4);
    park(G, 10, 1950, 1035, 1.3);
  },
  frame(G, t) {
    black(1 - smooth(t / 0.9));
    titleCard(t, 0.2, 3.4);
    uiOpacity(G, smooth((t - 3.0) / 0.7));   // a clean title: the game HUD fades in after it
    if (t < T_TP) {
      const yaw = keyed([[0, E + 0.25], [2.6, E + 0.6], [5.0, E - 0.25], [7.0, E + 0.25], [8.8, 0.02], [T_TP, 0.0]], t, true);
      const pitch = keyed([[0, 0.12], [2.6, 0.06], [5.0, 0.2], [7.0, 0.05], [8.8, 0.02], [T_TP, 0.03]], t);
      cam(G, yaw, pitch);
      fairWalk1.drive(G, t, yaw);
    } else {
      once('tp', true, () => mode(G, 'tp'));
      const u = t - T_TP;
      // follow the walking direction (smoothed), blending in from where the FP shot ended; small look-around offsets
      const head = fairWalk2.heading(Math.max(0, u - 0.5));
      const k = smooth(u / 1.6);
      // around the bench the camera swings to the side so the jump reads as a jump (from behind it looks like sitting)
      const uJ = fairJumpU;
      const look = keyed([[0, 0.1], [3, 0.25], [uJ - 1.9, 0.05], [uJ - 0.45, 1.2], [uJ + 1.1, 1.25], [uJ + 2.6, 0.55]], u);
      const yaw = wrap(head + look) * k;   // from yaw 0 (facing the forge) into the follow direction
      const pitch = keyed([[0, 0.03], [1.6, -0.12], [uJ - 1.9, -0.18], [uJ - 0.45, -0.05], [uJ + 1.1, -0.06], [uJ + 2.6, -0.16]], u);
      cam(G, yaw, pitch);
      fairWalk2.drive(G, u, yaw, 0.5);
      // hop over the bench (obstacle y 1274–1306): take off ~0.4 m before it
      const f = G.ctx.feet;
      once('jump', u > 4 && f.z >= Y(1252) && f.z < Y(1280), () => G.ctl.jump());
    }
    once('say0', t >= 1.4, () => say(G, 1, 'Добрый вечер, ярмарка! 🌙'));
    once('say1', t >= 4.6, () => say(G, 2, 'кузнец сегодня добрый, точит без очереди'));
    once('say2', t >= 11.2, () => say(G, 3, 'Пушок, привет! Идёшь в шахту?'));
    once('say3', t >= 12.6, () => say(G, 5, 'смотрите, какие гирлянды ✨'));
    once('say4', t >= 15.6, () => say(G, 7, 'опа, прыгун!'));
    once('say5', t >= 17.0, () => say(G, 8, 'мяу 😺'));
  },
};

/* ------------------------------------------------------------------ aiming at things */
/** Eye position (m): feet + EYE in FP. */
export const eye = (G: G): [number, number, number] => { const f = G.ctx.feet; return [f.x, f.y + 1.15, f.z]; };
/** yaw/pitch from the eye to a world point. */
export function aimTo(G: G, p: [number, number, number]): [number, number] {
  const e = eye(G), dx = p[0] - e[0], dy = p[1] - e[1], dz = p[2] - e[2];
  return [Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
}
/** Wait (async, virtual time) until cond() or timeout (ms). */
export const until = (cond: () => boolean, ms = 8000) => new Promise<boolean>((res) => {
  const t0 = performance.now();
  const f = () => { if (cond()) res(true); else if (performance.now() - t0 > ms) res(false); else setTimeout(f, 50); };
  f();
});

/* ------------------------------------------------------------------ gear: the camera flies out of the eyes, equip two things */
const gearClicks = new Set<number>();
const GEAR_KEYS: CursorKey[] = [
  { t: 1.5, at: [0.62, 0.6] },
  { t: 2.3, at: '.slot[data-slot="weapon"]', click: true },
  { t: 3.3, at: '.fits .cell[data-uid="iffod"]', click: true },
  { t: 4.3, at: '[data-act="equip"][data-uid="iffod"]', click: true },
  { t: 5.7, at: '.slot[data-slot="helmet"]', click: true },
  { t: 6.7, at: '.fits .cell[data-uid="iipat"]', click: true },
  { t: 7.7, at: '[data-act="equip"][data-uid="iipat"]', click: true },
  { t: 8.6, at: [0.78, 0.8] },
];
const GEAR: Segment = {
  id: 'gear', title: 'Снаряжение: orbit camera out of the eyes, equip a weapon and a hat', dur: 10.8, xfade: 0.5,
  requires: (G) => (G.demo?.hero?.items?.some((i: any) => i.uid === 'iffod') ? null : 'fixture items missing'),
  setup(G) {
    mode(G, 'fp'); G.ctx.applyCamera?.(true);
    placeM(G, pxToM([2210, 1010]), E + 0.5);
    cam(G, E + 0.5, 0.04);
    clearAround(G, 2210, 1010, 5.5);                  // nobody between the orbit camera and the hero
    park(G, 0, 2620, 930, 2.2); park(G, 1, 1820, 940, 0.6);
  },
  frame(G, t) {
    cam(G, keyed([[0, E + 0.5], [0.6, E + 0.62], [9.4, E + 0.62], [10.8, E + 0.4]], t, true), 0.04);
    once('open', t >= 0.6, () => G.ui.open('gear'));
    once('zoom', t >= 0.9, () => G.rig.zoom?.(2.5));   // a little wider than the default orbit framing
    cursor(t, GEAR_KEYS, gearClicks);
    caption('gear', 'Снаряжение — камера облетает героя', t, 1.0, 3.6, true);
    once('close', t >= 9.3, () => G.ui.open(null));
  },
};

/* ------------------------------------------------------------------ map: «Идти сюда» → auto-walk to the shop */
const mapClicks = new Set<number>();
const MAP_KEYS: CursorKey[] = [
  { t: 1.4, at: [0.57, 0.6] },
  { t: 2.6, at: '.mpin[data-pin="shop"]', click: true },
  { t: 3.6, at: '[data-go="shop"]', click: true },
  { t: 4.1, at: '[data-go="shop"]' },
];
const MAP: Segment = {
  id: 'map', title: 'Карта: pick a building, «Идти сюда», the hero walks there (TP)', dur: 9, xfade: 0.5,
  setup(G) {
    mode(G, 'tp'); G.ctx.applyCamera?.(true);
    placeM(G, pxToM([3640, 1000]), E);
    cam(G, E, -0.12);
    park(G, 0, 3900, 990, 1.2); park(G, 1, 4150, 1040, -0.8); park(G, 2, 4300, 975, 2.6);
  },
  frame(G, t) {
    cam(G, keyed([[0, E + 0.1], [4.0, E + 0.1], [6.5, E - 0.05], [9, E + 0.2]], t, true), keyed([[0, -0.12], [4, -0.12], [9, -0.08]], t));
    once('open', t >= 0.5, () => G.ui.open('map'));
    cursor(t, MAP_KEYS, mapClicks);
    caption('map', 'Карта города и автопуть «Идти сюда»', t, 1.0, 3.4, true);
    once('close', t >= 4.2, () => { if (G.ctx.state.menu) G.ui.open(null); });
  },
};

/* ------------------------------------------------------------------ shop interior: walk between shelves, aim at goods */
let shopPath: ReturnType<typeof walker> | null = null;
let shopGoods: string[] = [];
const SHOP: Segment = {
  id: 'shop', title: '3D shop room: walk between the shelves, aim at goods (highlight + card)', dur: 11, xfade: 0.5,
  async setup(G) {
    mode(G, 'fp'); G.ctx.applyCamera?.(true);
    placeM(G, pxToM([4775, 1000]), 0);
    await G.g.rooms.enter('shop');
    if (!(await until(() => G.g.rooms.current === 'shop' && !G.g.rooms.busy, 15000))) throw new Error('shop room did not open: ' + G.g.rooms.kind);
    const sp = G.g.rooms.scene.spawn;
    // goods: interactables of the room with a hit centre, nearest first
    const goods = [...inters.values()].filter((i) => !/exit|door|npc/i.test(i.id) && hitCentre(i));
    const d = (i: any) => { const c = hitCentre(i)!; return Math.hypot(c[0] - sp.x, c[2] - sp.z); };
    goods.sort((a, b) => d(a) - d(b));
    shopGoods = goods.slice(0, 3).map((i) => i.id);
    // a path from the spawn towards the first item (stop 1.1 m in front of it)
    const c = hitCentre(goods[0])!;
    const dir = [c[0] - sp.x, c[2] - sp.z], L = Math.hypot(dir[0], dir[1]) || 1;
    const stop: V2 = [c[0] - dir[0] / L * 1.1, c[2] - dir[1] / L * 1.1];
    shopPath = walker([[sp.x, sp.z], [lerp2(sp, stop, 0.5)[0] + 0.25, lerp2(sp, stop, 0.5)[1]], stop].map((p) => mToPxIf(G, p as V2)), 1.2, 0.9);
    cam(G, sp.face, -0.05);
  },
  frame(G, t) {
    const sp = G.g.rooms.scene?.spawn; if (!sp || !shopPath) return;
    const tgt = (k: number): V2 => { const it = inters.get(shopGoods[Math.min(k, shopGoods.length - 1)]); const c = it && hitCentre(it); return c ? aimTo(G, c) : [sp.face, -0.05]; };
    const a0 = tgt(0) as V2, a1 = tgt(1) as V2, a2 = tgt(2) as V2;
    const yaw = keyed([[0, sp.face + 0.35], [2.0, sp.face - 0.3], [4.2, a0[0]], [6.6, a0[0]], [7.6, a1[0]], [9.0, a1[0]], [10.0, a2[0]], [11, a2[0]]], t, true);
    const pitch = keyed([[0, 0.05], [2.0, 0.08], [4.2, a0[1]], [6.6, a0[1]], [7.6, a1[1]], [9.0, a1[1]], [10.0, a2[1]], [11, a2[1]]], t);
    cam(G, yaw, pitch);
    shopPath.drive(G, t, yaw, 0.3);
    caption('shop', 'Лавки — настоящие 3D-комнаты: подойди и выбери товар', t, 0.6, 3.6);
  },
};
const lerp2 = (a: { x: number; z: number }, b: V2, k: number): V2 => [a.x + (b[0] - a.x) * k, a.z + (b[1] - a.z) * k];
/** Room paths are given in room metres; walker() converts px → m, so feed it px-equivalents in rooms. */
const mToPxIf = (G: G, p: V2): V2 => (G.ctl.units === 'px' ? p : [p[0] / 0.01, p[1] / 0.02 + 800]);

/* ------------------------------------------------------------------ the mine: walk to a stone and dig it */
let minePath: ReturnType<typeof walker> | null = null;
let stoneId = '';
const MINE: Segment = {
  id: 'mine', title: '3D mine: walk to a stone, dig it (E)', dur: 10, xfade: 0.5,
  async setup(G) {
    mode(G, 'fp'); G.ctx.applyCamera?.(true);
    enableMine(G, 2.2);
    placeM(G, pxToM([1310, 1400]), Math.PI);
    await G.g.rooms.enter('mine');
    if (!(await until(() => G.g.rooms.current === 'mine' && !G.g.rooms.busy, 20000))) throw new Error('mine did not open: ' + G.g.rooms.kind);
    const sp = G.g.rooms.scene.spawn;
    // the nearest diggable stone (front row) we can walk up to
    const stones = [...inters.values()].filter((i) => /^mine:stone:/.test(i.id) && hitCentre(i) && (!i.enabled || i.enabled()));
    const d = (i: any) => { const c = hitCentre(i)!; return Math.hypot(c[0] - sp.x, c[2] - sp.z); };
    stones.sort((a, b) => d(a) - d(b));
    let pts: V2[] | null = null;
    for (const st of stones.slice(0, 8)) {
      const c = hitCentre(st)!;
      const dir = [c[0] - sp.x, c[2] - sp.z], L = Math.hypot(dir[0], dir[1]) || 1;
      for (const back of [2.1, 1.75, 2.6, 1.5]) {
        pts = planPath(G, [sp.x, sp.z], [c[0] - dir[0] / L * back, c[2] - dir[1] / L * back]);
        if (pts) break;
      }
      if (pts) { stoneId = st.id; break; }
    }
    if (!pts) {
      const S = G.ctl.space, row = (z: number) => { let r = ''; for (let x = sp.x - 8; x <= sp.x + 8; x += 0.5) r += S.free(x, z) ? '.' : '#'; return r; };
      const map: string[] = []; for (let z = sp.z - 14; z <= sp.z + 2; z += 0.5) map.push(z.toFixed(1) + ' ' + row(z));
      throw new Error('no reachable stone (' + stones.length + ' diggable) spawn ' + JSON.stringify(sp) + ' top ' + (S.solidTop ? S.solidTop(sp.x, sp.z) : 'none') + ' stones ' + JSON.stringify(stones.slice(0, 6).map((x) => hitCentre(x)!.map((v) => +v.toFixed(1)))) + '\n' + map.join('\n'));
    }
    // start ~5.5 m before the stone: teleport along the planned path
    const full = new Spline(pts);
    if (full.length > 6) {
      const st = full.at(full.length - 5.5), end = pts[pts.length - 1];
      placeM(G, st, 0);
      pts = planPath(G, st, end) || [st, end];
    }
    minePath = walker(pts.map((p) => mToPxIf(G, p)), 1.5, 0.9);
    cam(G, sp.face, -0.05);
  },
  frame(G, t) {
    const sp = G.g.rooms.scene?.spawn; if (!sp || !minePath) return;
    const it = inters.get(stoneId), c = it && hitCentre(it);
    const a: V2 = c ? aimTo(G, c) : [sp.face, -0.1];
    const tA = Math.max(2.4, minePath.dur - 0.6), p0 = minePath.at(0), p1 = minePath.at(Math.min(1.2, minePath.dur)), walkYaw = yawTo(p0, p1);
    const yaw = keyed([[0, walkYaw + 0.3], [1.2, walkYaw - 0.15], [tA, a[0]], [10, a[0]]], t, true);
    const pitch = keyed([[0, 0.1], [1.2, 0.05], [tA, a[1] + 0.1], [10, a[1] + 0.14]], t);
    cam(G, yaw, pitch);
    minePath.drive(G, t, yaw, 0.2);
    // dig: E on the aimed stone (the mine keeps digging while you stay)
    const digAt = Math.min(8, minePath.dur + 0.9);
    once('dig', t >= digAt, () => { try { inters.get(stoneId)?.use('key'); } catch (e) { console.warn('[director] dig', e); } });
    caption('mine', 'Шахта в 3D: копай камни, собирай руду', t, 0.6, 3.6);
  },
};

/* ------------------------------------------------------------------ expedition HUD + end card */
const QUEST = {
  on: true, party: 'in', t: 'Тёмный лес',
  b: { id: 'v1', title: 'Волчья стая', round: 2, maxR: 5, st: 'party', until: 0, hp: 0.82, me: 0,
    form: [['player1', 'archer', 'L'], ['bot4', 'warrior', 'L'], ['bot5', 'mage', 'R']], foes: [], two: true, cr: { fr: [1, 2] }, sk: [['залп', 0]] },
};
const EXPED: Segment = {
  id: 'expedition', title: 'Expedition HUD card (battle on the stream)', dur: 6.5, xfade: 0.6,
  setup(G) {
    mode(G, 'tp'); G.ctx.applyCamera?.(true);
    placeM(G, pxToM([2760, 1000]), Math.PI);
    cam(G, 0.1, -0.1);
    park(G, 0, 2700, 960, 0.4); park(G, 1, 2830, 975, -0.5);
  },
  frame(G, t) {
    cam(G, keyed([[0, 0.25], [6.5, -0.15]], t, true), keyed([[0, -0.1], [6.5, -0.06]], t));
    once('q', t >= 0.6, () => {
      const q = structuredClone(QUEST) as any; q.b.until = Date.now() + 25000;
      q.b.form[0][0] = G.store.me?.login || 'player1';
      G.store.setQuest(q);
    });
    caption('exp', 'Поход на стриме: карточка подсказывает, что писать в чат', t, 1.0, 5.6);
  },
};
const END: Segment = {
  id: 'end', title: 'End card over a slow drift of the fair', dur: 6,
  setup(G) {
    mode(G, 'tp'); G.ctx.applyCamera?.(true);
    placeM(G, pxToM([2400, 1030]), 0);
    cam(G, 0.2, 0.05);
  },
  frame(G, t) {
    cam(G, keyed([[0, 0.35], [6, -0.25]], t, true), keyed([[0, 0.02], [6, 0.12]], t));
    endCard(t, 0.4, 6.2);
    uiOpacity(G, 1 - smooth((t - 0.3) / 0.8));
  },
};

/* ------------------------------------------------------------------ segment list */
const testWalk = walker([[1700, 985], [1900, 1000], [2100, 990], [2250, 960]], 2.0);

const TEST: Segment = {
    id: 'test', title: 'Test: FP walk + look, switch to TP', dur: 6, test: true,
    setup(G) {
      mode(G, 'fp');
      placeM(G, testWalk.at(0), -Math.PI / 2);
      cam(G, -Math.PI / 2 + 0.3, -0.02);
      park(G, 0, 1960, 960, 0.4); park(G, 1, 2010, 1000, -0.6);
    },
    frame(G, t) {
      const yaw = keyed([[0, -Math.PI / 2 + 0.3], [2.5, -Math.PI / 2 - 0.25], [4.5, -Math.PI / 2 + 0.2], [6, 0.4]], t, true);
      const pitch = keyed([[0, -0.02], [3, 0.12], [6, 0.02]], t);
      cam(G, yaw, pitch);
      testWalk.drive(G, t, yaw);
      once('say1', t >= 1.2, () => say(G, 0, 'Привет! Красиво сегодня 🌙'));
      once('tp', t >= 3.6, () => mode(G, 'tp'));
      void clamp; void yawTo;
    },
};
const SHOWCASE: Segment = {
    id: 'showcase', title: 'Showcase: every item model, character variants, street props', dur: 13, page: 'showcase', xfade: 0.6,
    requires: (G) => (G.sc ? null : 'no showcase page'),
    setup(G) { G.sc.pose(0); },
    frame(G, t) {
      G.sc.pose(t);
      for (const s of G.sc.sections as { title: string; t0: number; t1: number }[]) {
        if (s.t0 < 0) continue;
        caption('sc:' + s.title, s.title, t, Math.max(0, s.t0 - 0.1), Math.min(13, s.t1 + 0.35));
      }
    },
};

/** The cut, in order. */
export const SEGMENTS: Segment[] = [FAIR, SHOWCASE, GEAR, MAP, SHOP, MINE, EXPED, END, TEST];

