// EXPMOVIE compositor: source shots (video/expmovie/frames-expmovie/<id>/NNNNN.jpg) + video/expmovie/timeline.json
// → the picture (video/expmovie/<name>.video.mp4), then the music mastered (−16 LUFS, one static gain + limiter, true
// peak ≤ −1 dBTP measured on the ENCODED file) and muxed with the video stream copied → <name>.mp4. Never overwrites.
//
//   node scripts/video/expmovie-compose.mjs --name=expmovie-v1 [--w=1920 --h=1080] [--from=S --to=S] [--still=t1,t2]
//        [--no-audio] [--audio-only (re-master + mux onto an existing <name>.video.mp4)] [--crf=17] [--draft (jq 80)]
//
// One headless Chrome page draws every output frame on a 2D canvas as a pure function of the frame number: clips with
// source-time maps (speed ramps, slow-mo sources), zoom keys and beat punch-ins, transitions (whip pans with motion
// ghosts, vertical whips, zoom-through, dips), event tiles popping in on the beat, light leaks, impact echoes, flashes,
// camera shakes, letterbox, vignette, film grain, title cards (Dela Gothic One + Golos Text, local OFL fonts).
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../..');
const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)=(.*)$/s.exec(a); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), '1']; }));
const OUT = resolve(ROOT, opt.out || 'video/expmovie');
const FR = opt.frames ? resolve(ROOT, opt.frames) : join(OUT, 'frames-expmovie');
const NAME = opt.name || 'expmovie-v1';
const W = +(opt.w || 1920), H = +(opt.h || 1080), FPS = 60;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), '[xm]', ...a);

const PAGE = String.raw`<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Dela;src:url(http://xm.local/fonts/DelaGothicOne-Regular.ttf)}
@font-face{font-family:Golos;src:url(http://xm.local/fonts/GolosText.ttf);font-weight:400 900}
html,body{margin:0;background:#000;overflow:hidden}canvas{display:block}</style></head><body><canvas id="c"></canvas><script>
const C = document.getElementById('c'), X = C.getContext('2d');
let TL = null, W = 1920, H = 1080, K = 1, SRC = {};
const cache = new Map();
const load = (u) => { let p = cache.get(u); if (!p) { p = new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = u; }); cache.set(u, p); if (cache.size > 64) cache.delete(cache.keys().next().value); } return p; };
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const lin = (keys, t) => { if (!keys || !keys.length) return 0; if (t <= keys[0][0]) return keys[0][1]; for (let i = 1; i < keys.length; i++) if (t < keys[i][0]) { const [a, va] = keys[i - 1], [b, vb] = keys[i]; return va + (vb - va) * (t - a) / (b - a); } return keys[keys.length - 1][1]; };
const easeOut = (u) => 1 - Math.pow(1 - clamp(u), 3), easeIn = (u) => Math.pow(clamp(u), 3);
const easeIO = (u) => { u = clamp(u); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
const back = (u, c1 = 1.7) => { u = clamp(u); const c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
const HF = 'Dela, Impact, sans-serif', TF = 'Golos, Arial, sans-serif';
// deterministic grain tiles
const GR = [];
function mkGrain() { let s = 12345; const r = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
  for (let k = 0; k < 3; k++) { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); const d = g.createImageData(256, 256);
    for (let i = 0; i < d.data.length; i += 4) { const v = 128 + (r() - 0.5) * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } g.putImageData(d, 0, 0); GR.push(X.createPattern(c, 'repeat')); } }
window.setup = async (tl, w, h, src) => { TL = tl; W = w; H = h; K = w / 1920; C.width = w; C.height = h; SRC = src; mkGrain();
  await Promise.all(['100px Dela', '800 40px Golos', '600 40px Golos'].map((f) => document.fonts.load(f, 'ПОХОД Legion')));
  return document.fonts.check('100px Dela', 'ПОХОД'); };

/* ---- sources */
function srcFrame(c, T) { const S = SRC[c.src]; let f = Math.round(lin(c.map, T) * 60); if (S) f = Math.max(S.f0, Math.min(S.f1 - 1, f)); return f; }
const url = (c, f) => 'http://xm.local/f/' + c.src + '/' + String(f).padStart(5, '0') + '.jpg';
function scaleOf(c, T) {
  const u = (T - c.t0) / Math.max(0.001, c.t1 - c.t0);
  let sc = 1, cx = 0.5, cy = 0.5;
  if (c.zoom) { sc = lin(c.zoom.map((k) => [k[0], k[1]]), u); cx = lin(c.zoom.map((k) => [k[0], k[2]]), u); cy = lin(c.zoom.map((k) => [k[0], k[3]]), u); }
  for (const p of c.punch || []) if (T >= p) sc *= 1 + 0.085 * Math.exp(-(T - p) / 0.11);
  return [sc, cx, cy];
}
// draw a source image covering the box, zoomed by sc around (cx, cy), offset by (dx, dy) px
function cover(img, sc, cx, cy, bx, by, bw, bh, dx = 0, dy = 0, alpha = 1) {
  if (!img) { X.fillStyle = '#1a1430'; X.fillRect(bx, by, bw, bh); return; }
  const ia = img.width / img.height, ba = bw / bh;
  let sw = img.width, sh = img.height; if (ia > ba) sw = sh * ba; else sh = sw / ba;
  // sc < 1 would need pixels outside the frame: draw a bigger box instead
  let ow = bw, oh = bh;
  if (sc >= 1) { sw /= sc; sh /= sc; } else { ow = bw / sc; oh = bh / sc; }
  const sx = clamp(cx * img.width - sw / 2, 0, img.width - sw), sy = clamp(cy * img.height - sh / 2, 0, img.height - sh);
  X.globalAlpha = alpha;
  X.drawImage(img, sx, sy, sw, sh, bx + dx - (ow - bw) / 2, by + dy - (oh - bh) / 2, ow, oh);
  X.globalAlpha = 1;
}
// directional motion blur: a box blur along the pan axis — N copies of the covered frame spread over the blur length,
// averaged (k-th copy at alpha 1/k), so edges streak without the stair-steps a squeeze-and-stretch would leave
function smear(img, sc, cx, cy, dx, dy, f, vert) {
  if (!img) return;
  const a0 = X.globalAlpha, L = (f - 1) * 9 * K, N = 20;
  for (let i = 0; i < N; i++) {
    const o = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2) / (N / 2) * L / 2;   // centre copy first (covers the frame), then ± pairs
    X.globalAlpha = a0 / (i + 1);
    cover(img, sc, cx, cy, 0, 0, W, H, dx + (vert ? 0 : o), dy + (vert ? o : 0), a0 / (i + 1));
  }
  X.globalAlpha = a0;
}
async function full(c, T, o = {}) {
  const img = await load(url(c, srcFrame(c, T)));
  let [sc, cx, cy] = scaleOf(c, T); sc *= o.k || 1; cx += o.ocx || 0; cy += o.ocy || 0;
  const g = o.ghost || 0, dx = o.dx || 0, dy = o.dy || 0;
  if (o.smear && o.smear > 1.5) { X.globalAlpha = o.a ?? 1; smear(img, sc, cx, cy, dx, dy, o.smear, !!o.vy); X.globalAlpha = 1; return img; }
  if (o.smear) { cover(img, sc, cx, cy, 0, 0, W, H, dx, dy, o.a ?? 1); return img; }
  if (g) {
    // motion ghosts trailing behind the movement (whip) or around the zoom
    for (let i = o.zg ? 3 : 5; i >= 1; i--) {
      if (o.zg) cover(img, sc * (1 + o.zg * i), cx, cy, 0, 0, W, H, dx, dy, 0.22 * (o.a ?? 1));
      else cover(img, sc, cx, cy, 0, 0, W, H, dx - (o.vx || 0) * i * g, dy - (o.vy || 0) * i * g, 0.24 * (o.a ?? 1));
    }
  }
  cover(img, sc, cx, cy, 0, 0, W, H, dx, dy, (o.a ?? 1) * (g && !o.zg ? 0.7 : 1));
  return img;
}
function rr(x, y, w, h, r) { X.beginPath(); X.moveTo(x + r, y); X.arcTo(x + w, y, x + w, y + h, r); X.arcTo(x + w, y + h, x, y + h, r); X.arcTo(x, y + h, x, y, r); X.arcTo(x, y, x + w, y, r); X.closePath(); }
async function tile(c, T) {
  let [bx, by, bw, bh] = [c.box[0] * W, c.box[1] * H, c.box[2] * W, c.box[3] * H];
  const k = back((T - c.t0) / c.pop, 2.2), s = 0.4 + 0.6 * k, mx = bx + bw / 2, my = by + bh / 2; bw *= s; bh *= s; bx = mx - bw / 2; by = my - bh / 2;
  const img = await load(url(c, srcFrame(c, T)));
  X.save(); X.globalAlpha = clamp((T - c.t0) / 0.06); rr(bx, by, bw, bh, 18 * K); X.clip(); cover(img, 1.05, 0.5, 0.5, bx, by, bw, bh); X.restore();
  X.save(); X.globalAlpha = clamp((T - c.t0) / 0.06); X.lineWidth = 4 * K; X.strokeStyle = 'rgba(255,214,120,0.9)'; rr(bx, by, bw, bh, 18 * K); X.stroke(); X.restore();
}

/* ---- overlays */
function leak(l, T) {
  if (T < l.t0 || T >= l.t1) return;
  const u = (T - l.t0) / (l.t1 - l.t0), env = Math.sin(Math.PI * u) ** 1.2;
  const x = W * (l.side > 0 ? 1.05 - 0.5 * u : -0.05 + 0.5 * u), y = H * (0.25 + 0.2 * Math.sin(u * 3 + l.hue));
  X.save(); X.globalCompositeOperation = 'screen';
  for (const [r, a, dh] of [[0.75, 1, 0], [0.4, 0.8, 18], [1.1, 0.45, -12]]) {
    const g = X.createRadialGradient(x, y, 0, x, y, H * r);
    g.addColorStop(0, 'hsla(' + (l.hue + dh) + ',95%,62%,' + (l.a * a * env).toFixed(3) + ')'); g.addColorStop(1, 'hsla(' + (l.hue + dh) + ',95%,50%,0)');
    X.fillStyle = g; X.fillRect(0, 0, W, H);
  }
  X.restore();
}
function vignette() { const g = X.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.05); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)'); X.fillStyle = g; X.fillRect(0, 0, W, H); }
function grain(n) { X.save(); X.globalCompositeOperation = 'overlay'; X.globalAlpha = 0.04; X.fillStyle = GR[n % 3]; X.translate((n * 137) % 256, (n * 71) % 256); X.fillRect(-256, -256, W + 512, H + 512); X.restore(); }
const SIZE = { xxl: 300, xl: 210, l: 120, m: 74 };
function label(s, x, y, px, o = {}) {
  X.save(); X.translate(x, y); if (o.rot) X.rotate(o.rot); if (o.sc) X.scale(o.sc, o.sc);
  X.font = (o.font || px + 'px ' + HF); X.textAlign = 'center'; X.textBaseline = 'middle'; X.letterSpacing = (o.ls || 0) + 'px';
  const w = X.measureText(s).width, fit = Math.min(1, (W * 0.92) / Math.max(1, w)); X.scale(fit, fit);
  X.globalAlpha = o.a ?? 1;
  if (o.glow) { X.shadowColor = o.glow; X.shadowBlur = px * 0.5; }
  X.lineJoin = 'round'; X.lineWidth = px * (o.stroke ?? 0.12); X.strokeStyle = o.sc2 || 'rgba(14,8,26,0.92)'; X.strokeText(s, 0, 0);
  X.shadowColor = 'transparent';
  if (o.gold) { const g = X.createLinearGradient(0, -px * 0.5, 0, px * 0.5); g.addColorStop(0, '#fff6d6'); g.addColorStop(0.45, '#ffd36a'); g.addColorStop(0.55, '#f0a530'); g.addColorStop(1, '#ffe39a'); X.fillStyle = g; }
  else X.fillStyle = o.color || '#fff4dc';
  X.fillText(s, 0, 0); X.restore();
}
function streak(x, y, w, a) { X.save(); X.globalCompositeOperation = 'screen'; const g = X.createLinearGradient(x - w / 2, 0, x + w / 2, 0); g.addColorStop(0, 'rgba(255,190,90,0)'); g.addColorStop(0.5, 'rgba(255,236,190,' + a + ')'); g.addColorStop(1, 'rgba(255,190,90,0)'); X.fillStyle = g; X.fillRect(x - w / 2, y - 3 * K, w, 6 * K); X.globalAlpha = a * 0.35; X.fillRect(x - w / 2, y - 18 * K, w, 36 * K); X.restore(); }
function text(t, T) {
  if (T < t.t0 || T >= t.t1) return;
  const u = T - t.t0, L = t.t1 - t.t0, px = SIZE[t.size] * K, x = (t.x ?? 0.5) * W, y = t.y * H;
  const out = clamp((T - (t.t1 - 0.14)) / 0.14);
  if (t.style === 'slam') {
    const s0 = (t.x ?? 0.5) === 0.5 ? 2.3 : 1.6, s = s0 - (s0 - 1) * back(u / 0.16, 1.4), a = clamp(u / 0.05) * (1 - out);
    streak(x, y, W * (0.3 + 0.7 * easeOut(u / 0.4)), 0.8 * (1 - clamp(u / L)) * (1 - out));
    label(t.text, x, y, px, { sc: s * (1 + 0.12 * out), a, gold: true, ls: 6 * K, glow: 'rgba(255,170,60,0.55)', rot: -0.025 });
  } else if (t.style === 'title') {
    const s = 2.6 - 1.6 * back(u / 0.2, 1.3), a = clamp(u / 0.05);
    streak(x, y, W * (0.4 + 0.6 * easeOut(u / 0.6)), 0.9 * Math.max(0.25, 1 - u / 1.5));
    label(t.text, x, y, px, { sc: s * (1 + 0.015 * u), a, gold: true, ls: 18 * K, glow: 'rgba(255,170,60,0.6)', stroke: 0.1 });
    if (t.sub && T >= t.subAt) { const v = T - t.subAt; label(t.sub, x, y + px * 0.6, 96 * K, { font: Math.round(96 * K) + 'px ' + HF, ls: 34 * K * (1 + 0.6 * (1 - easeOut(v / 0.8))), a: clamp(v / 0.25), color: '#fff4dc', stroke: 0.18, glow: 'rgba(0,0,0,0.6)' }); }
  } else {
    // caption: tracks in (letter spacing closes), quick fade; thin gold rules either side
    const a = clamp(u / 0.12) * (1 - out), ls = 26 * K * (1 - easeOut(u / 0.5)) + 6 * K;
    label(t.text, x, y, px, { font: px + 'px ' + HF, ls, a, color: '#fff3d8', stroke: 0.14, glow: 'rgba(0,0,0,0.6)', sc: 1 + 0.04 * (u / L) });
  }
}

/* ---- transitions: the incoming clip c, its predecessor p, u ∈ [0, 1] across [c.t0 − d/2, c.t0 + d/2] */
async function trans(p, c, T) {
  const d = c.tr.d, u = (T - (c.t0 - d / 2)) / d;
  if (c.tr.type === 'whip' || c.tr.type === 'whipv') {
    // whip: no frame edges ever move into view — each shot pans INSIDE a slightly zoomed copy of itself (outgoing speeds
    // off along the axis, incoming arrives from the other side), heavy directional motion blur at the middle, and the
    // incoming shot dissolves in over the outgoing one while both are smeared
    const v = c.tr.type === 'whipv', dir = c.tr.dir || 1, e = easeIO(u);
    const f = 1 + 15 * Math.sin(Math.PI * u) ** 2, mix = clamp((u - 0.4) / 0.2);
    const A = { k: 1 + 0.22 * e, smear: f }, B = { k: 1 + 0.22 * (1 - e), smear: f, a: mix };
    if (v) { A.ocy = dir * 0.09 * e; B.ocy = -dir * 0.09 * (1 - e); A.vy = 1; B.vy = 1; } else { A.ocx = dir * 0.09 * e; B.ocx = -dir * 0.09 * (1 - e); }
    if (mix < 1) await full(p, T, A);
    if (mix > 0) await full(c, T, B);
    X.fillStyle = 'rgba(255,244,225,' + (0.16 * Math.sin(Math.PI * u) ** 2).toFixed(3) + ')'; X.fillRect(0, 0, W, H);
  } else if (c.tr.type === 'zoom') {
    if (u < 0.5) await full(p, T, { k: 1 + 1.4 * easeIn(u * 2), zg: 0.06 * Math.sin(Math.PI * u), ghost: 1 });
    else await full(c, T, { k: 1 + 0.9 * (1 - easeOut((u - 0.5) * 2)), zg: 0.05 * Math.sin(Math.PI * u), ghost: 1 });
    X.fillStyle = 'rgba(255,248,230,' + (0.55 * Math.sin(Math.PI * u) ** 3).toFixed(3) + ')'; X.fillRect(0, 0, W, H);
  } else if (c.tr.type === 'dip') {
    if (u < 0.5) { await full(p, T); X.fillStyle = 'rgba(0,0,0,' + easeIn(u * 2).toFixed(3) + ')'; X.fillRect(0, 0, W, H); }
    else { await full(c, T); X.fillStyle = 'rgba(0,0,0,' + (1 - easeOut((u - 0.5) * 2)).toFixed(3) + ')'; X.fillRect(0, 0, W, H); }
  } else await full(T < c.t0 ? p : c, T);
}

window.frame = async (n) => {
  const T = n / 60;
  X.setTransform(1, 0, 0, 1, 0, 0); X.globalAlpha = 1; X.globalCompositeOperation = 'source-over'; X.filter = 'none';
  X.fillStyle = '#07050f'; X.fillRect(0, 0, W, H);
  let sx = 0, sy = 0, rot = 0;
  for (const s of TL.shakes) { const u = (T - s.t) / s.dur; if (u >= 0 && u < 1) { const a = s.amp * K * (1 - u) * (1 - u); sx += Math.sin(T * 93 + s.t) * a; sy += Math.sin(T * 71 + 1.3 + s.t) * a; rot += Math.sin(T * 57 + s.t) * a * 0.00035; } }
  X.setTransform(1, 0, 0, 1, 0, 0); X.translate(W / 2 + sx, H / 2 + sy); X.rotate(rot); X.scale(1 + Math.min(0.05, (Math.abs(sx) + Math.abs(sy)) / W * 2), 1 + Math.min(0.05, (Math.abs(sx) + Math.abs(sy)) / W * 2)); X.translate(-W / 2, -H / 2);
  const F = TL.clips.filter((c) => !c.z);
  // the full-frame layer: a transition window, or the active clip
  let drawn = false, cur = null;
  for (let i = 0; i < F.length; i++) {
    const c = F[i], p = F[i - 1], d = c.tr.d || 0;
    if (p && d > 0 && T >= c.t0 - d / 2 && T < c.t0 + d / 2 && Math.abs(p.t1 - c.t0) < 1e-3) { await trans(p, c, T); drawn = true; cur = c; break; }
  }
  if (!drawn) { cur = F.find((c) => T >= c.t0 && T < c.t1); if (cur) await full(cur, T); }
  // impact echo: a screen-blended, slightly bigger copy for a few frames after each flash
  if (cur) for (const f of TL.flashes) { const u = (T - f.t) / 0.12; if (u >= 0 && u < 1 && f.a >= 0.4) { X.save(); X.globalCompositeOperation = 'screen'; const img = await load(url(cur, srcFrame(cur, T))); const [sc, cx, cy] = scaleOf(cur, T); cover(img, sc * (1.04 + 0.06 * u), cx, cy, 0, 0, W, H, 0, 0, 0.35 * (1 - u)); X.restore(); } }
  // tiles (the backdrop dims the last full clip)
  const tiles = TL.clips.filter((c) => c.z === 1 && T >= c.t0 && T < c.t1);
  if (tiles.length) { X.fillStyle = 'rgba(8,5,18,' + clamp((T - tiles[0].t0) / 0.2 * 0.6, 0, 0.6) + ')'; X.fillRect(-50, -50, W + 100, H + 100); for (const c of tiles) await tile(c, T); }
  X.setTransform(1, 0, 0, 1, 0, 0);
  for (const l of TL.leaks) leak(l, T);
  vignette();
  const lb = lin(TL.letterbox, T) * H; if (lb > 0.5) { X.fillStyle = '#000'; X.fillRect(0, 0, W, lb); X.fillRect(0, H - lb, W, lb); }
  grain(n);
  for (const f of TL.flashes) { const u = (T - f.t) / f.dur; if (u >= 0 && u < 1) { X.fillStyle = 'rgba(' + f.color + ',' + (f.a * (1 - u) * (1 - u)).toFixed(3) + ')'; X.fillRect(0, 0, W, H); } }
  for (const t of TL.texts) text(t, T);
  const bk = lin(TL.black, T); if (bk > 0.001) { X.fillStyle = 'rgba(0,0,0,' + bk.toFixed(3) + ')'; X.fillRect(0, 0, W, H); }
  return cur ? cur.src : '-';
};
</script></body></html>`;

function sourcesOf(tl) {
  const S = {};
  for (const id of new Set(tl.clips.map((c) => c.src))) {
    const dir = join(FR, id);
    const fs = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.jpg')).map((f) => +f.slice(0, 5)).sort((a, b) => a - b) : [];
    S[id] = fs.length ? { f0: fs[0], f1: fs[fs.length - 1] + 1, n: fs.length } : { f0: 0, f1: 1, n: 0 };
  }
  return S;
}

async function picture(tl, video) {
  const S = sourcesOf(tl);
  const missing = Object.entries(S).filter(([, v]) => !v.n).map(([k]) => k);
  if (missing.length) log('WARNING sources without frames (placeholders):', missing.join(' '));
  const from = Math.round((+(opt.from) || 0) * FPS), to = Math.min(Math.round(tl.duration * FPS), opt.to ? Math.round(+opt.to * FPS) : Infinity);
  log(`config: ${W}x${H}@${FPS} · ${tl.duration} s (frames ${from}..${to - 1}) · ${tl.clips.length} clips · ${tl.texts.length} texts · grid ${tl.grid.bpm.toFixed(2)} BPM · out ${video || 'stills'}`);
  const b = await chromium.launch({ executablePath: opt.chrome || process.env.CHROMIUM, headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('pageerror', e.message));
  await page.route('http://xm.local/**', (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === '/') return r.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE });
    if (u.pathname.startsWith('/fonts/')) { const f = join(OUT, 'fonts', u.pathname.slice(7)); return existsSync(f) ? r.fulfill({ contentType: 'font/ttf', body: readFileSync(f) }) : r.fulfill({ status: 404, body: '' }); }
    const m = /^\/f\/([^/]+)\/(\d+\.jpg)$/.exec(u.pathname); const f = m && join(FR, m[1], m[2]);
    return f && existsSync(f) ? r.fulfill({ contentType: 'image/jpeg', body: readFileSync(f) }) : r.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://xm.local/', { waitUntil: 'load' });
  const ok = await page.evaluate(([tl, w, h, s]) => window.setup(tl, w, h, s), [tl, W, H, S]);
  log('fonts', ok ? 'Dela Gothic One loaded (local)' : 'FALLBACK FONT');
  const cdp = await ctx.newCDPSession(page);
  const shot = async (q = 95) => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: q, optimizeForSpeed: true })).data, 'base64');
  try {
    if (opt.still) {
      mkdirSync(join(OUT, 'stills'), { recursive: true });
      for (const t of String(opt.still).split(',').map(Number)) { const src = await page.evaluate((n) => window.frame(n), Math.round(t * FPS)); { const f = join(OUT, 'stills', `${NAME}-${t.toFixed(2)}.jpg`); writeFileSync(f + '.raw.jpg', await shot(92)); spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', f + '.raw.jpg', '-vf', "eq=contrast=1.15:brightness=-0.03:saturation=1.15,curves=all='0/0 0.1/0.05 0.5/0.48 0.9/0.93 1/1'", '-q:v', '3', f]); spawnSync('rm', ['-f', f + '.raw.jpg']); } log('still', t, src); }
      return null;
    }
    // libx264, yuv420p (TV range) with BT.709 tags; the JPEG input is full range → scaled explicitly
    const enc = ['-c:v', 'libx264', '-preset', opt.preset || 'slow', '-crf', String(opt.crf || 18), '-maxrate', opt.maxrate || '32M', '-bufsize', '64M', '-profile:v', 'high', '-g', '120', '-bf', '2'];
    // a light grade against the game's haze (more contrast, deeper blacks, a little saturation), then full → TV range
    const vf = "eq=contrast=1.15:brightness=-0.03:saturation=1.15,curves=all='0/0 0.1/0.05 0.5/0.48 0.9/0.93 1/1',scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p";
    const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'warning', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-', '-vf', vf, ...enc,
      '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-r', String(FPS), '-movflags', '+faststart', video], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((res) => ff.on('close', res));
    const t0 = Date.now(), q = opt.draft ? 80 : 95;
    for (let n = from; n < to; n++) {
      await page.evaluate((k) => window.frame(k), n);
      const buf = await shot(q);
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if ((n - from) % 300 === 299 || n === to - 1) { const ms = (Date.now() - t0) / (n - from + 1); log(`frame ${n + 1}/${to} · ${ms.toFixed(0)} ms/frame · ETA ${((to - n - 1) * ms / 60000).toFixed(1)} min`); }
    }
    ff.stdin.end();
    if ((await done) !== 0) throw new Error('ffmpeg (picture) failed');
    return video;
  } finally { await b.close().catch(() => {}); }
}

/* ---- sound: music (leads) + procedural whooshes on whip/zoom transitions → −16 LUFS static gain + limiter, TP on the encoded AAC */
function ebur(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const s = r.stderr || ''; const tail = s.slice(s.lastIndexOf('Summary:'));
  return { I: +(/I:\s+(-?[\d.]+) LUFS/.exec(tail) || [])[1], TP: +(/Peak:\s+(-?[\d.]+) dBFS/.exec(tail) || [])[1], LRA: +(/LRA:\s+(-?[\d.]+) LU/.exec(tail) || [])[1] };
}
function sound(tl, video, mp4) {
  const music = resolve(ROOT, opt.music || tl.music.file);
  const L = tl.duration;
  const raw = join(OUT, NAME + '.raw.wav');
  // whooshes: synthesized here (numpy-free: ffmpeg noise + band sweep), one per whip / zoom transition, −14 dB under the music
  const wh = tl.clips.filter((c) => !c.z && ['whip', 'whipv', 'zoom'].includes(c.tr.type)).map((c) => c.t0 - c.tr.d / 2 - 0.08);
  const inputs = ['-i', music], f = [];
  f.push(`[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,atrim=end=${L.toFixed(3)},afade=t=out:st=${(L - tl.music.fadeOut).toFixed(3)}:d=${tl.music.fadeOut}[m]`);
  const mix = ['[m]'];
  if (!opt['no-sfx']) wh.forEach((t, i) => {
    inputs.push('-f', 'lavfi', '-t', '0.42', '-i', `anoisesrc=color=pink:seed=${7 + i}:sample_rate=48000:amplitude=0.9`);
    const k = inputs.filter((x) => x === '-i').length - 1;
    f.push(`[${k}:a]highpass=f=500,lowpass=f=5200,afade=t=in:d=0.24:curve=qsin,afade=t=out:st=0.24:d=0.18:curve=exp,volume=-15dB,pan=stereo|c0=c0|c1=c0,adelay=${Math.round(Math.max(0, t) * 1000)}:all=1[w${i}]`);
    mix.push(`[w${i}]`);
  });
  f.push(`${mix.join('')}amix=inputs=${mix.length}:normalize=0:dropout_transition=0,atrim=end=${L.toFixed(3)}[out]`);
  let r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', f.join(';'), '-map', '[out]', '-c:a', 'pcm_f32le', '-ar', '48000', raw], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('mix failed');
  const m0 = ebur(raw);
  log(`mix: music + ${wh.length} whooshes → ${raw} · ${m0.I} LUFS, TP ${m0.TP} dBTP`);
  // ONE static gain to −16 LUFS + a true-peak limiter; lower the ceiling until the ENCODED file is ≤ −1 dBTP
  let gain = -16 - m0.I;
  let ceil = -1.5, res = null;
  for (let it = 0; it < 6; it++) {
    const master = join(OUT, NAME + '.master.wav');
    r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', raw, '-af', `volume=${gain.toFixed(3)}dB,alimiter=limit=${Math.pow(10, ceil / 20).toFixed(5)}:attack=1:release=60:level=disabled:latency=1`, '-c:a', 'pcm_f32le', '-ar', '48000', master], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('master failed');
    if (existsSync(mp4)) throw new Error('refusing to overwrite ' + mp4);
    const tmp = mp4.replace(/\.mp4$/, `.try${it}.mp4`);
    r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', video, '-i', master, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest', '-movflags', '+faststart', tmp], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('mux failed');
    res = ebur(tmp);
    log(`master try ${it}: gain ${gain.toFixed(2)} dB, ceiling ${ceil} dBFS → encoded ${res.I} LUFS, TP ${res.TP} dBTP`);
    if (res.TP <= -1.0 && Math.abs(res.I + 16) <= 0.05) { spawnSync('mv', [tmp, mp4]); break; }
    spawnSync('rm', ['-f', tmp]);
    if (Math.abs(res.I + 16) > 0.05) gain += -16 - res.I; else ceil -= 0.5;
  }
  const meta = { name: NAME, duration: L, music: tl.music.file, whooshes: wh.length, mix: { lufs: res.I, truePeak: res.TP, lra: res.LRA, gainDb: +gain.toFixed(2), ceilingDb: ceil } };
  writeFileSync(join(OUT, NAME + '.audio.json'), JSON.stringify(meta, null, 1));
  log(`→ ${mp4} · ${res.I} LUFS · TP ${res.TP} dBTP`);
  return meta;
}

const tl = JSON.parse(readFileSync(resolve(ROOT, opt.timeline || 'video/expmovie/timeline.json'), 'utf8'));
const video = join(OUT, NAME + '.video.mp4'), mp4 = join(OUT, NAME + '.mp4');
if (opt.still) await picture(tl, null);
else {
  if (!opt['audio-only']) { if (existsSync(video) && !opt.force) throw new Error('exists: ' + video + ' (new --name, versions are never overwritten)'); await picture(tl, video); }
  const pr = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height,r_frame_rate,nb_frames,pix_fmt,color_space', '-of', 'compact', video], { encoding: 'utf8' });
  log('picture:', (pr.stdout || '').trim().replace(/\n/g, ' | '));
  if (!opt['no-audio']) sound(tl, video, mp4);
}
