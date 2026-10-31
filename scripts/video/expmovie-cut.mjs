// EXPMOVIE cut plan → video/expmovie/timeline.json (beat-synced edit of the expedition source shots).
//
//   node scripts/video/expmovie-cut.mjs [--music=video/expmovie/music/expmovie-music-v1.mp3] [--beats=<…beats.json>]
//
// Everything is placed on the music's beat grid: beat k is at OFF + k·P (measured with video-skills beats.py:
// 129.96 BPM, offset 0.042 s; bars start on beats ≡ 1 mod 4 — the braams at beats 1 and 17, the impacts at 33, 113,
// 149). The plan below is written in beat indices; the compositor (expmovie-compose.mjs) reads seconds.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../..');
const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)=(.*)$/s.exec(a); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), '1']; }));
const MUSIC = opt.music || 'video/expmovie/music/expmovie-music-v1.mp3';
const BEATS = opt.beats || MUSIC.replace(/\.mp3$/, '.beats.json');
const g = existsSync(resolve(ROOT, BEATS)) ? JSON.parse(readFileSync(resolve(ROOT, BEATS), 'utf8')) : { bpm: 129.96, offset: 0.042, duration: 73.98 };
const P = 60 / g.bpm, OFF = g.offset;
const bt = (k) => +(OFF + k * P).toFixed(4);
const DUR = 73.95;

/* ------------------------------------------------------------------ the plan (beat indices) */
// clip: [k0, k1, src, {s0: source start s, rate: playback speed or ramp [[u(0..1), rate]], zoom: [[u, scale, cx, cy]],
//        punch: [beat…] (zoom kicks), tr: transition INTO this clip {type: cut|whip|whipv|zoom|dip|flash, d: s}}]
const C = [];
const clip = (k0, k1, src, o = {}) => C.push({ k0, k1, src: 'x-' + src, ...o });
const W = (dir = 1, d = 0.2) => ({ type: 'whip', dir, d });
const Z = (d = 0.24) => ({ type: 'zoom', d });
const V = (dir = 1, d = 0.2) => ({ type: 'whipv', dir, d });

// I. the gate (braam 1 at k1), gathering — letterboxed, slow
clip(1, 9, 'gate', { s0: 0.0, rate: 0.9, zoom: [[0, 1.0, 0.5, 0.5], [1, 1.06, 0.5, 0.45]], tr: { type: 'dip', d: 0.35 } });
clip(9, 17, 'gather', { s0: 0.2, rate: 0.85, tr: { type: 'dip', d: 0.3 } });
// II. braam 2 (k17): on the road
clip(17, 25, 'forest', { s0: 0.0, rate: 0.9, punch: [17], tr: Z(0.22) });
clip(25, 29, 'river', { s0: 0.4, tr: W(1) });
clip(29, 33, 'falls', { s0: 0.3, rate: [[0, 1], [0.6, 1], [1, 2.6]], zoom: [[0, 1, 0.5, 0.5], [0.7, 1.02, 0.5, 0.5], [1, 1.22, 0.5, 0.5]], tr: W(-1) });
// III. impact (k33): the biome rush, one bar each
clip(33, 37, 'bridge', { s0: 0.4, punch: [33], tr: Z(0.2) });
clip(37, 41, 'gorge', { s0: 0.5, tr: W(1, 0.18) });
clip(41, 45, 'desert', { s0: 0.4, punch: [41], tr: V(1, 0.18) });
clip(45, 49, 'barrow', { s0: 0.6, tr: W(-1, 0.18) });
clip(49, 53, 'swamp', { s0: 0.4, tr: Z(0.2) });
clip(53, 57, 'taiga', { s0: 0.5, punch: [55], tr: W(1, 0.18) });
clip(57, 61, 'mine', { s0: 0.4, tr: V(-1, 0.18) });
clip(61, 65, 'cave', { s0: 0.6, rate: [[0, 1], [0.7, 1], [1, 2.2]], tr: W(-1, 0.18) });
clip(65, 72, 'dungeon', { s0: 0.4, rate: [[0, 1], [0.42, 1], [0.5, 0.3], [1, 0.3]], tr: Z(0.2) });
// tiles: the events of the road pop in on the beat (k68…k71), then «В БОЙ!» at k72
const TILES = [['well', 68, [0.035, 0.06, 0.455, 0.42]], ['goblin', 69, [0.51, 0.06, 0.455, 0.42]], ['skel', 70, [0.035, 0.52, 0.455, 0.42]], ['cauldron', 71, [0.51, 0.52, 0.455, 0.42]]];
// IV. battles (k72 … k105) — FakeQuest wolf battle takes; s0 puts the party's strike / the pack's lunge / the kills on the beats
// (measured on battle-long: plan 56.8–57.6 crits, 65.0–65.5 lunge, 77.0–77.5 wolves fall; sources seek 55.4 / 64.4 / 76.4)
clip(72, 77, 'b-hit-forest', { s0: 0.9, punch: [72, 74, 76], zoom: [[0, 1.0, 0.55, 0.5], [1, 1.18, 0.6, 0.52]], tr: { type: 'flash', d: 0 } });
clip(77, 81, 'b-desert', { s0: 1.0, punch: [77, 79], zoom: [[0, 1.25, 0.6, 0.5], [1, 1.1, 0.55, 0.5]], tr: W(1, 0.16) });
clip(81, 83, 'b-gorge', { s0: 1.25, punch: [81], tr: V(1, 0.16) });
clip(83, 85, 'b-taiga', { s0: 0.35, punch: [83], tr: W(-1, 0.16) });
clip(85, 89, 'b-tele', { s0: 0.25, punch: [85, 87], tr: Z(0.2) });
clip(89, 93, 'b-cave', { s0: 0.45, punch: [89, 91], zoom: [[0, 1.1, 0.6, 0.5], [1, 1.3, 0.65, 0.5]], tr: W(1, 0.16) });
clip(93, 95, 'b-gate', { s0: 1.3, punch: [93], tr: V(-1, 0.16) });
clip(95, 97, 'b-swamp', { s0: 0.4, punch: [95], tr: W(1, 0.16) });
clip(97, 101, 'b-mine', { s0: 0.3, punch: [97, 99], zoom: [[0, 1.3, 0.6, 0.5], [1, 1.12, 0.55, 0.5]], tr: Z(0.2) });
clip(101, 102, 'battle-long', { s0: 12.95, punch: [101] });
clip(102, 103, 'b-cave', { s0: 1.0, punch: [102], zoom: [[0, 1.4, 0.68, 0.5]] });
clip(103, 104, 'battle-long', { s0: 21.0, punch: [103] });
clip(104, 105, 'battle-long', { s0: 33.3, punch: [104] });
// V. the hero moment: slow motion into the lair, the boss rises (k105 … k113), letterboxed
clip(105, 109, 'lair', { s0: 0.0, rate: 1, zoom: [[0, 1.0, 0.5, 0.5], [1, 1.08, 0.5, 0.5]], tr: Z(0.3) });
clip(109, 113, 'boss-reveal', { s0: 0.0, rate: 1, zoom: [[0, 1.04, 0.5, 0.5], [1, 1.14, 0.5, 0.42]], tr: { type: 'dip', d: 0.3 } });
// VI. drop 2 (k113): the boss fight — FakeQuest boss long takes (boss-long wide, boss-low low): phase change 30.15,
// jump telegraph 12.8–13.3, «ЦЕЛЬ — ТЫ!» 34.2, the charge 43.6–44.7, the feint shockwave 53.0–53.6, the death 70.2–72.5
clip(113, 117, 'boss-low', { s0: 30.0, punch: [113, 115], tr: { type: 'flash', d: 0 } });
clip(117, 119, 'boss-long', { s0: 12.75, punch: [118], tr: W(1, 0.16) });
clip(119, 121, 'boss-low', { s0: 33.75, punch: [119], zoom: [[0, 1.3, 0.62, 0.45], [1, 1.4, 0.64, 0.45]], tr: V(1, 0.16) });
clip(121, 125, 'boss-long', { s0: 43.25, punch: [121, 123], tr: Z(0.2) });
clip(125, 129, 'boss-low', { s0: 52.85, punch: [125, 127], zoom: [[0, 1.0, 0.5, 0.5], [1, 1.2, 0.6, 0.5]], tr: W(-1, 0.16) });
clip(129, 131, 'boss-low', { s0: 43.5, punch: [129], zoom: [[0, 1.15, 0.55, 0.5], [1, 1.3, 0.5, 0.5]], tr: V(1, 0.14) });
clip(131, 133, 'boss-long', { s0: 29.95, punch: [131], tr: V(-1, 0.14) });
clip(133, 134, 'boss-adds', { s0: 3.0, punch: [133] });
clip(134, 135, 'boss-low', { s0: 31.0, punch: [134], zoom: [[0, 1.45, 0.72, 0.42]] });
clip(135, 136, 'boss-long', { s0: 34.1, punch: [135] });
clip(136, 137, 'boss-low', { s0: 70.25, punch: [136] });
// VII. victory: the boss falls in slow motion, confetti, loot (k137 … k145), the calm (k145 … k149)
clip(137, 140, 'boss-low', { s0: 70.71, rate: 0.55, zoom: [[0, 1.0, 0.6, 0.5], [1, 1.1, 0.65, 0.5]], tr: { type: 'flash', d: 0 } });
clip(140, 141, 'boss-long', { s0: 71.2, punch: [140], tr: W(1, 0.16) });
clip(141, 145, 'treasure', { s0: 0.3, punch: [141], tr: W(1, 0.2) });
clip(145, 149, 'rest', { s0: 0.3, rate: 0.6, tr: { type: 'dip', d: 0.25 } });
// VIII. final impact (k149): the title over the gate
C.push({ k0: 149, t1: DUR, src: 'x-end-gate', s0: 0.0, rate: 0.85, tr: { type: 'flash', d: 0 } });

/* ------------------------------------------------------------------ captions / titles */
const T = [];
const txt = (k0, k1, text, o = {}) => T.push({ t0: bt(k0), t1: typeof k1 === 'number' && k1 < 1000 ? bt(k1) : k1, text, style: 'cap', size: 'm', y: 0.5, ...o });
txt(3, 8.6, 'ВРАТА ОТКРЫТЫ', { style: 'cap', size: 'l', y: 0.3 });
txt(11, 16.6, 'ОТРЯД СОБРАН', { style: 'cap', size: 'l', y: 0.3 });
txt(17, 20.8, 'В ПУТЬ!', { style: 'slam', size: 'xl', y: 0.3 });
const capb = (k, text) => txt(k + 0.15, k + 3.55, text, { y: 0.84, size: 'm' });
capb(33, 'ЧЕРЕЗ МОСТЫ'); capb(37, 'ЧЕРЕЗ УЩЕЛЬЯ'); capb(41, 'СКВОЗЬ ПЕСКИ'); capb(45, 'МИМО КУРГАНОВ');
capb(49, 'ЧЕРЕЗ ТОПИ'); capb(53, 'СКВОЗЬ СНЕГА'); capb(57, 'В ГЛУБЬ ШАХТ'); capb(61, 'В ПЕЩЕРЫ');
txt(65.15, 67.9, 'ВО ТЬМУ', { y: 0.84, size: 'm' });
txt(68.3, 71.95, 'ЧУДЕСА В ПУТИ', { y: 0.5, size: 'm' });
txt(72, 75.8, 'В БОЙ!', { style: 'slam', size: 'xl', y: 0.26 });
txt(105.5, 108.8, 'ЛОГОВО', { style: 'cap', size: 'l', y: 0.25, x: 0.25 });
txt(113, 116.8, 'БОСС', { style: 'slam', size: 'xl', y: 0.24, x: 0.36 });
txt(137, 140.8, 'ПОБЕДА', { style: 'slam', size: 'xl', y: 0.22, x: 0.4 });
txt(141.5, 144.8, 'И ДОБЫЧА', { style: 'cap', size: 'l', y: 0.8 });
T.push({ t0: bt(149), t1: DUR, text: 'ПОХОД', style: 'title', size: 'xxl', y: 0.3, sub: 'LEGION 3D', subAt: bt(151) });

/* ------------------------------------------------------------------ hits */
const flashes = [], shakes = [], leaks = [];
const fl = (k, a = 0.5, dur = 0.22, color = '255,250,235') => flashes.push({ t: bt(k), a, dur, color });
const sk = (k, amp = 14, dur = 0.35) => shakes.push({ t: bt(k), amp, dur });
fl(1, 0.85, 0.5); sk(1, 10, 0.5);
fl(17, 0.7, 0.35); sk(17, 12, 0.4);
fl(33, 0.95, 0.4); sk(33, 22, 0.5);
fl(41, 0.45); fl(55, 0.55); sk(55, 12); fl(49, 0.3); fl(57, 0.3); fl(65, 0.35);
for (const [, k] of TILES) fl(k, 0.25, 0.14);
fl(72, 0.95, 0.35); sk(72, 24, 0.5);
for (const k of [77, 81, 85, 89, 93, 97]) { fl(k, 0.4, 0.18); sk(k, 10, 0.25); }
for (const k of [74, 76, 79, 83, 87, 91, 95, 99]) sk(k, 7, 0.22);
for (const k of [101, 102, 103, 104]) { fl(k, 0.45, 0.16); sk(k, 14, 0.25); }
fl(105, 0.4, 0.5, '255,236,200');
fl(113, 1.0, 0.45); sk(113, 30, 0.6);
for (let k = 115; k < 133; k += 2) sk(k, k % 4 === 1 ? 18 : 10, 0.3);
for (const k of [117, 121, 125, 129, 131]) fl(k, 0.45, 0.2);
for (const k of [133, 134, 135]) { fl(k, 0.5, 0.16); sk(k, 20, 0.28); }
fl(136, 0.9, 0.5); sk(136, 34, 0.7);
fl(137, 0.8, 0.35); sk(137, 14, 0.4); fl(141, 0.35, 0.2);
fl(149, 1.0, 0.6); sk(149, 36, 0.8);
// light leaks (warm burns, screen-blended): [t0, t1, hue, strength, from side]
const lk = (k0, k1, hue, a, side = 1) => leaks.push({ t0: bt(k0), t1: bt(k1), hue, a: +(a * 0.7).toFixed(3), side });
lk(1, 17, 32, 0.3, 1); lk(17, 21, 18, 0.5, -1); lk(31, 35, 28, 0.55, 1); lk(70, 74, 12, 0.55, -1);
lk(105, 113, 300, 0.32, 1); lk(111, 115, 20, 0.6, -1); lk(136, 139, 40, 0.5, 1); lk(147.5, 152, 30, 0.55, -1); lk(152, 158.6, 38, 0.3, 1);

/* ------------------------------------------------------------------ letterbox (fraction of height per bar) + black */
const LB = 0.128;
const letterbox = [[0, LB], [bt(33) - 0.01, LB], [bt(33) + 0.18, 0], [bt(105) - 0.05, 0], [bt(105) + 0.35, LB], [bt(113) - 0.01, LB], [bt(113) + 0.14, 0], [bt(149) - 0.01, 0], [bt(149) + 0.3, LB], [DUR, LB]];
const black = [[0, 1], [bt(1) - 0.02, 1], [bt(1), 0], [bt(112), 0], [bt(113) - 0.02, 0.55], [bt(113), 0], [bt(146.5), 0], [bt(148.3), 0.92], [bt(149) - 0.01, 0.97], [bt(149), 0], [DUR - 0.9, 0], [DUR, 1]];

/* ------------------------------------------------------------------ resolve to seconds */
const clips = C.map((c, i) => {
  const t0 = bt(c.k0), t1 = c.t1 ?? bt(c.k1);
  return { i, src: c.src, t0, t1, s0: c.s0 ?? 0.3, rate: c.rate ?? 1, zoom: c.zoom || null, punch: (c.punch || []).map(bt), tr: c.tr || { type: 'cut', d: 0 }, z: 0 };
});
/** source-time map [[T, s]] of a clip (speed ramps integrated, 20 ms steps; extended 0.5 s both sides for transitions) */
function mapOf(c) {
  const r = (u) => { if (!Array.isArray(c.rate)) return c.rate; const k = c.rate; if (u <= k[0][0]) return k[0][1]; for (let i = 1; i < k.length; i++) if (u < k[i][0]) return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * (u - k[i - 1][0]) / (k[i][0] - k[i - 1][0]); return k[k.length - 1][1]; };
  const L = c.t1 - c.t0, out = [], h = 0.02;
  let s = c.s0 - 0.5 * r(0);
  for (let T = c.t0 - 0.5; T <= c.t1 + 0.5 + 1e-9; T += h) { out.push([+T.toFixed(4), +Math.max(0, s).toFixed(4)]); s += r((T - c.t0) / L) * h; }
  return out;
}
for (const [src, k, box] of TILES) clips.push({ i: clips.length, src: 'x-' + src, t0: bt(k), t1: bt(72), s0: 0.6, rate: 1, zoom: null, punch: [], tr: { type: 'cut', d: 0 }, z: 1, box, pop: 0.22 });
for (const c of clips) c.map = mapOf(c);
const tl = {
  duration: DUR, fps: 60, grid: { bpm: g.bpm, offset: OFF, period: P, downbeat: '≡1 mod 4' },
  music: { file: MUSIC, fadeOut: 0.6 },
  clips, texts: T, flashes, shakes, leaks, letterbox, black,
};
const out = resolve(ROOT, opt.out || 'video/expmovie/timeline.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(tl, null, 1));
// a readable shot list for the report
const list = clips.filter((c) => !c.z).map((c) => `${c.t0.toFixed(2)}–${c.t1.toFixed(2)}  ${c.src.slice(2).padEnd(14)} ${c.tr.type}`);
writeFileSync(join(dirname(out), 'shotlist.txt'), list.join('\n') + '\n');
console.log(`timeline → ${out}: ${clips.length} clips, ${T.length} texts, ${flashes.length} flashes, ${shakes.length} shakes, ${DUR} s @ ${g.bpm.toFixed(2)} BPM`);
// source usage: how many source seconds each source needs (for the render windows)
const need = {};
for (const c of clips) need[c.src] = Math.max(need[c.src] || 0, c.map[c.map.length - 1][1]);
console.log('source seconds needed:', Object.entries(need).map(([k, v]) => `${k}:${v.toFixed(1)}`).join(' '));
