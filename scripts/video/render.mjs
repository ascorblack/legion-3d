// Deterministic frame-capture renderer for the review video (see scripts/video/README.md).
//
//   node scripts/video/render.mjs [--segments=a,b|--test] [--workers=3] [--gpu] [--w=1920 --h=1080]
//        [--frames=N] [--format=jpeg|png] [--jq=95] [--name=legion-3d-review] [--encoder=libx264|h264_nvenc]
//        [--dsf=1.3333 (1080 layout at 1440p)] [--crf=18]
//        [--no-assemble] [--assemble-only] [--bots=20] [--root=.] [--fresh]
//        [--cut=promo|gameplay|edit] [--no-audio] (gameplay/edit: the game's own sound, captured + rendered, see README «Sound»)
//        (edit: source shots → scripts/video/edit-compose.mjs builds the beat-cut trailer from video/edit/timeline.json)
//
// Every segment renders in its own headless Chrome: virtual time (video/bundle/director.js) advances exactly
// 1/60 s per frame, the director poses the game, then a real screenshot (3D canvas + DOM UI) goes to
// video/frames/<segment>/NNNNN.jpg. Existing frames are kept (resume: the segment is fast-forwarded with rendering
// off up to the first missing frame). Finally ffmpeg joins the segments with crossfades into video/<name>.mp4.
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)=(.*)$/s.exec(a); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), '1']; }));
const ROOT = resolve(opt.root || resolve(here, '../..'));
const OUT = resolve(ROOT, opt.out || 'video');
const W = +(opt.w || 1920), H = +(opt.h || 1080);
// --dsf=1.3333 renders the same 1920×1080 layout (HUD, cards, framing) at 2560×1440 pixels (3D canvas included)
const DSF = +(opt.dsf || 1);
const CRF = String(opt.crf || 18);
const FPS = 60, DT = 1000 / FPS;
const FMT = opt.format === 'png' ? 'png' : 'jpeg', EXT = FMT === 'png' ? 'png' : 'jpg';
const JQ = +(opt.jq || 95);
const WORKERS = Math.max(1, +(opt.workers || 3));
const GPU = !!opt.gpu;
const BOTS = +(opt.bots || 20);
// cuts: 'promo' (the review video, frames/) and 'gameplay' (frames-gameplay/, with the game's own sound)
const CUT = opt.cut || 'promo';
const NAME = opt.name || (opt.test ? 'test' : CUT === 'promo' ? 'legion-3d-review' : `legion-3d-${CUT}`);
const FR = join(OUT, CUT === 'promo' ? 'frames' : `frames-${CUT}`);
// lore: picture only — the narrator + music are mixed afterwards (scripts/video/lore-mix.py)
const AUDIO = CUT !== 'promo' && CUT !== 'lore' && !opt['no-audio'];
const ENC = opt.encoder || 'libx264';
const LIMIT = opt.frames ? +opt.frames : Infinity;
const ARGS = GPU
  ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--password-store=basic', '--no-first-run',
     '--disable-features=PasswordManagerEnableSenderService,PasswordLeakDetection']
  : ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const EXE = opt.chrome || process.env.CHROMIUM || undefined;

/* ---- bundle */
const BUNDLE = join(OUT, 'bundle', 'director.js');
if (!opt['assemble-only'] && !opt['no-build']) {
  try { await import(pathToFileURL(join(here, 'build.mjs')).href); }
  catch (e) { if (!existsSync(BUNDLE)) throw e; console.log('esbuild unavailable, using prebuilt bundle'); }
}
const bundle = existsSync(BUNDLE) ? readFileSync(BUNDLE, 'utf8') : '';
// a page may carry its own query ('expedition?at=55&speed=1')
const pageUrl = (page = 'game') => { const [p, q] = page.split('?'); return pathToFileURL(resolve(ROOT, `dist-dev/${p}.html`)).href + `?bots=${BOTS}` + (q ? '&' + q : ''); };

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ---- browsers
 * default: one Chrome per task (separate GPU processes — parallel SwiftShader rendering);
 * --profile=<dir>: ONE persistent Chrome for the whole run, workers are pages of its single context. Use it on
 * Windows: Chrome probes the OS password once per fresh profile (LogonUser with an empty password → a failed logon
 * in the Security log); a persistent profile caches the probe, so the whole render costs at most one probe. */
// gameplay cut: the sound runs (master at 100 % = the fixed video mix level, mastered later), the seasonal decoration is
// forced on («Всегда»), no «what's new» card, the pointer lock is emulated (vtime.ts) so the game plays as with a mouse
// (both cuts: no «Что нового» card over the first shot)
const LS = { 'l3d.quality': '3', 'l3d.cam': 'fp', 'l3d.post': '1', 'l3d.whatsnew.enabled': '0',
  ...(CUT === 'gameplay' || CUT === 'edit' ? { 'l3d.vol.master': '1', 'l3d.vol.amb': '1', 'l3d.vol.sfx': '1', 'l3d.vol.ui': '1', 'l3d.event.mode': 'on', 'l3d.combat': 'on', 'l3d.combat.hint': '1' } : {}),
  // edit cut: no first-time hint toasts over the shots
  ...(CUT === 'edit' ? { 'l3d.fun.flight.hint': '1', 'l3d.fun.bench.hint': '1' } : {}),
  // lore: nameplates limited to 0 in the page (lore.ts; 'off' would hide the bubbles too), debug mode allowed (?debug=1 pages: the test dimension), no hint toasts
  ...(CUT === 'lore' ? { 'l3d.names': 'all', 'l3d.debug': 'on', 'l3d.fun.flight.hint': '1', 'l3d.fun.bench.hint': '1', 'l3d.combat.hint': '1' } : {}) };
const CFG = CUT === 'gameplay' || CUT === 'edit' ? { seed: 20261026, audio: true, lock: true } : { seed: 20261026 };
const INIT = `try{for(const [k,v] of Object.entries(${JSON.stringify(LS)}))localStorage.setItem(k,v);}catch(e){}\nwindow.__VT_CFG=${JSON.stringify(CFG)};\n` + bundle;
let shared = null;   // persistent context (--profile)
async function context() {
  if (opt.profile) {
    if (!shared) {
      shared = await chromium.launchPersistentContext(resolve(opt.profile), { executablePath: EXE, headless: true, args: ARGS, viewport: { width: W, height: H }, deviceScaleFactor: DSF });
      await shared.addInitScript({ content: INIT });
      log('persistent Chrome profile', resolve(opt.profile));
    }
    return { ctx: shared, close: async () => {} };
  }
  const b = await chromium.launch({ executablePath: EXE, headless: true, args: ARGS });
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF });
  await ctx.addInitScript({ content: INIT });
  return { ctx, close: () => b.close().catch(() => {}) };
}
async function openGame(ctx, tag, pg) {
  const page = await ctx.newPage();
  if (DSF !== 1) {
    // a persistent (profile) context does not always apply deviceScaleFactor in headless: force it per page before load
    const c0 = await ctx.newCDPSession(page);
    await c0.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DSF, mobile: false });
  }
  const logs = [];
  page.on('console', (m) => { const t = `[${m.type()}] ${m.text()}`.slice(0, 300); logs.push(t); if (/error/i.test(m.type()) || /\[director\]|\[vt\]/.test(t)) console.log(`  ${tag} ${t}`); });
  page.on('pageerror', (e) => console.log(`  ${tag} [pageerror] ${e.message}`));
  await page.goto(pageUrl(pg), { waitUntil: 'load', timeout: 120000 });
  const cdp = await ctx.newCDPSession(page);
  return { page, cdp, logs };
}
// n frames; between two frames the page gets a macrotask turn (MessageChannel), so promise chains settle exactly as
// they do between two separate evaluate() calls — a room that opens after a few awaits opens on the same frame
// whether the frames are rendered one by one or fast-forwarded in batches (resume, --chunk, stills, audio pass)
const step = (page, n = 1) => page.evaluate(async ([n, dt]) => {
  const mc = window.__vtMC || (window.__vtMC = new MessageChannel());
  const turn = () => new Promise((r) => { mc.port1.onmessage = () => r(); mc.port2.postMessage(0); });
  // the director's dt(): 1/60 s, or less inside a slow-mo segment (rate keys) — game time per output frame
  for (let i = 0; i < n; i++) { if (i) await turn(); window.__vt.step(window.__director ? window.__director.dt() : dt); }
  return window.__vt.frame;
}, [n, DT]);

async function bootSegment(page, id, tag, pg) {
  // boot: step virtual time until the game and the demo exist, fonts are in
  const t0 = Date.now();
  for (;;) {
    const ok = await page.evaluate(([dt, pg]) => { window.__vt.step(dt); return window.__director.booted(pg); }, [DT, pg]);
    if (ok) break;
    if (Date.now() - t0 > 180000) throw new Error('game did not boot in 180 s');
    await new Promise((r) => setTimeout(r, 30));
  }
  log(`${tag} booted in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.evaluate((id) => window.__director.init(id), id);
  // edit cut: the setup (room loads, sound bank decode) runs with rendering off — the simulation is the same, and the
  // rendered preroll afterwards warms up shaders / textures (other cuts keep their exact old behaviour)
  if (CUT === 'edit') await page.evaluate(() => window.__director.fast(true));
  for (let i = 0; ; i++) {
    const st = await page.evaluate((dt) => { window.__vt.step(dt); return window.__director.status; }, DT);
    if (st === 'ready') { if (CUT === 'edit') await page.evaluate(() => window.__director.fast(false)); break; }
    if (st.startsWith('skip:') || st.startsWith('error:')) return st;
    if (CUT === 'edit') {
      // rendering is off during an edit setup: give real async work (sample decode, room loads) real time per step
      if (Date.now() - t0 > 240000) return 'error:setup timeout';
      await new Promise((r) => setTimeout(r, 8));
      continue;
    }
    if (i > 3000) return 'error:setup timeout';
    if (i % 20 === 0) await new Promise((r) => setTimeout(r, 20));   // let real async work (image decode) progress
  }
  return 'ready';
}

async function capture(cdp, file) {
  // with --dsf the page renders at device pixels; ask for them explicitly (a plain capture returns CSS pixels in headless)
  const clip = DSF !== 1 ? { clip: { x: 0, y: 0, width: W, height: H, scale: DSF } } : {};
  const r = await cdp.send('Page.captureScreenshot', { ...(FMT === 'png' ? { format: 'png' } : { format: 'jpeg', quality: JQ }), optimizeForSpeed: true, captureBeyondViewport: false, ...clip });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
}

async function renderSegment(seg, wi, from = 0, to = Infinity) {
  const tag = `[w${wi}:${seg.id}${from || to < Infinity ? `:${from}-${to}` : ''}]`;
  const dir = join(FR, seg.id);
  mkdirSync(dir, { recursive: true });
  // edit sources: only the window [win0, win1) is captured (frames keep their absolute numbers)
  if (seg.win && !opt.at) { from = Math.max(from, Math.round(seg.win[0] * FPS)); to = Math.min(to, Math.round(seg.win[1] * FPS)); }
  const total = Math.min(LIMIT, Math.round(seg.dur * FPS), to);
  const fname = (i) => join(dir, String(i).padStart(5, '0') + '.' + EXT);
  let first = from; if (!opt.at) while (first < total && existsSync(fname(first))) first++;
  if (first >= total) { log(`${tag} complete (${total} frames), skipped`); return { id: seg.id, status: 'done', frames: total }; }
  const B = await context();
  let page = null;
  try {
    const o = await openGame(B.ctx, tag, seg.page); page = o.page; const cdp = o.cdp;
    const st = await bootSegment(page, seg.id, tag, seg.page);
    if (st !== 'ready') { log(`${tag} ${st}`); writeFileSync(join(dir, 'status.txt'), st); return { id: seg.id, status: st, frames: 0 }; }
    const gl = await page.evaluate(() => { const g = (window.__l3dGame || window.__showcase || window.__exp).engine.renderer.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; });
    log(`${tag} ready · ${W}x${H} · GL ${gl} · preroll ${seg.preroll ?? 90} · frames ${first}..${total - 1}`);
    await step(page, seg.preroll ?? 90);
    await page.evaluate(() => window.__director.go());
    if (opt.at) {
      // stills mode: video/probe/<segment>-<t>.jpg at the given segment times (fast-forward between them)
      mkdirSync(join(OUT, 'probe'), { recursive: true });
      let f = 0;
      for (const at of String(opt.at).split(',').map(Number).sort((a, b) => a - b)) {
        const target = Math.round(at * FPS);
        await page.evaluate(() => window.__director.fast(true));
        while (f < target) { const n = Math.min(60, target - f); await step(page, n); f += n; }
        await page.evaluate(() => window.__director.fast(false));
        await step(page, 1); f++;
        await capture(cdp, join(OUT, 'probe', `${seg.id}-${at}.${EXT}`));
        log(`${tag} still t=${at}`, JSON.stringify(await page.evaluate(() => ({ ...window.__director.info(), marks: window.__director.marks }))));
        if (opt.eval) { try { log(`${tag} eval`, JSON.stringify(await page.evaluate(opt.eval)).slice(0, 4000)); } catch (e) { log(`${tag} eval error`, e.message); } }
      }
      return { id: seg.id, status: 'stills', frames: 0 };
    }
    if (first > 0) {
      log(`${tag} fast-forward ${first} frames`);
      await page.evaluate(() => window.__director.fast(true));
      for (let i = 0; i < first; i += 60) await step(page, Math.min(60, first - i));
      await page.evaluate(() => window.__director.fast(false));
    }
    const t0 = Date.now();
    for (let i = first; i < total; i++) {
      await step(page, 1);
      await capture(cdp, fname(i));
      if ((i - first) % 60 === 59 || i === total - 1) {
        const n = i - first + 1, ms = (Date.now() - t0) / n;
        const info = await page.evaluate(() => window.__director.info());
        log(`${tag} frame ${i + 1}/${total} · ${ms.toFixed(0)} ms/frame · ETA ${((total - i - 1) * ms / 60000).toFixed(1)} min · me ${info?.me} ${info?.mode} room ${info?.room} menu ${info?.menu}`);
      }
    }
    return { id: seg.id, status: 'done', frames: total, ms: (Date.now() - t0) / Math.max(1, total - first) };
  } finally { if (page) await page.close().catch(() => {}); await B.close(); }
}

/* ---- audio pass: the whole segment once more with rendering off; the game's SoundEngine logs on the virtual clock */
async function captureAudio(seg, wi) {
  const tag = `[w${wi}:${seg.id}:audio]`, dir = join(FR, seg.id), file = join(dir, 'audio.json');
  mkdirSync(dir, { recursive: true });
  const total = Math.min(LIMIT, Math.round(seg.dur * FPS));
  if (existsSync(file) && !opt.fresh) { const c = JSON.parse(readFileSync(file, 'utf8')); if (c.frames === total) { log(`${tag} capture exists, skipped`); return { id: seg.id, status: 'audio-done' }; } }
  const B = await context();
  let page = null;
  try {
    const o = await openGame(B.ctx, tag, seg.page); page = o.page;
    const st = await bootSegment(page, seg.id, tag, seg.page);
    if (st !== 'ready') { log(`${tag} ${st}`); return { id: seg.id, status: 'audio-' + st }; }
    await step(page, seg.preroll ?? 90);
    await page.evaluate(() => window.__director.go());
    await page.evaluate(() => window.__director.fast(true));
    const t0 = Date.now();
    for (let i = 0; i < total; i += 60) await step(page, Math.min(60, total - i));
    const cap = await page.evaluate(() => ({ t0: window.__director.t0, simT: window.__director.simT, marks: window.__director.marks, log: window.__VT_AUDIO_LOG || [] }));
    // simDur: game seconds the capture covers (≠ output seconds in a slow-mo segment)
    cap.dur = total / FPS; cap.frames = total; cap.id = seg.id; cap.simDur = seg.rate ? cap.simT + 1 / FPS : cap.dur;
    writeFileSync(file, JSON.stringify(cap));
    const voices = cap.log.filter((e) => e.k === 'voice');
    log(`${tag} captured ${total} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s · ${cap.log.length} events, ${voices.length} voices · marks ${cap.marks.map(([n, t]) => `${n}@${t.toFixed(2)}`).join(' ')}`);
    return { id: seg.id, status: 'audio-done' };
  } finally { if (page) await page.close().catch(() => {}); await B.close(); }
}

/* ---- main */
async function segmentList() {
  // the director exposes its list; read it without booting the game (a blank page with the bundle)
  const B = await context();
  try {
    const p = await B.ctx.newPage();
    await p.goto('about:blank');
    await p.setContent('<html><body></body></html>');
    const list = await p.evaluate(() => window.__director.segments);
    await p.close();
    return list;
  } finally { await B.close(); }
}

// the list lives in the page bundle; cached in video/segments.json so --assemble-only needs no browser
const LIST = join(OUT, 'segments.json');
const all = opt['assemble-only'] && existsSync(LIST) ? JSON.parse(readFileSync(LIST, 'utf8')) : await segmentList();
mkdirSync(OUT, { recursive: true }); writeFileSync(LIST, JSON.stringify(all, null, 1));
let segs = opt.segments ? opt.segments.split(',').map((id) => { const s = all.find((x) => x.id === id); if (!s) throw new Error('unknown segment ' + id); return s; })
  : all.filter((s) => (opt.test ? s.test : !s.test) && (s.cut || 'promo') === CUT);
log(`cut ${CUT} → ${NAME}${AUDIO ? ' (with game sound)' : ''} · frames ${FR}`);
log(`config: ${W}x${H}${DSF !== 1 ? ' ×' + DSF + ' = ' + Math.round(W * DSF) + 'x' + Math.round(H * DSF) : ''}@${FPS} · ${FMT}${FMT === 'jpeg' ? ' q' + JQ : ''} · ${GPU ? 'GPU (d3d11)' : 'swiftshader'} · workers ${WORKERS} · bots ${BOTS} · segments ${segs.map((s) => `${s.id}(${s.dur}s)`).join(' ')}`);

const results = new Map();
if (!opt['assemble-only'] && !opt['markers-only']) {
  // tasks: whole segments, or --chunk=<s> pieces (each piece fast-forwards to its start with rendering off;
  // the simulation is identical, see README «Determinism»)
  const CH = opt.chunk ? Math.max(1, Math.round(+opt.chunk * FPS)) : 0;
  const q = [];
  for (const s of segs.slice().sort((a, b) => b.dur - a.dur)) {
    if (opt.fresh && !opt.at) rmSync(join(FR, s.id), { recursive: true, force: true });
    if (AUDIO && !opt.at) q.push({ s, audio: true });
    if (opt['audio-only']) continue;
    const n = Math.min(LIMIT, Math.round((s.win ? s.win[1] : s.dur) * FPS)), w0 = s.win ? Math.round(s.win[0] * FPS) : 0;
    if (!CH || opt.at) q.push({ s, a: 0, b: Infinity });
    else for (let a = w0; a < n; a += CH) q.push({ s, a, b: Math.min(n, a + CH) });
  }
  const t0 = Date.now();
  await Promise.all(Array.from({ length: Math.min(WORKERS, q.length) }, async (_, wi) => {
    for (let k = q.shift(); k; k = q.shift()) {
      const s = k.s, rk = `${s.id}:${k.a}`;
      try { results.set(rk + (k.audio ? ':audio' : ''), k.audio ? await captureAudio(s, wi) : await renderSegment(s, wi, k.a, k.b)); }
      catch (e) { log(`[w${wi}:${s.id}] FAILED ${e?.stack || e}`); results.set(rk, { id: s.id, status: 'error', frames: 0 }); }
    }
  }));
  log(`render done in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}
if (shared) { await shared.close().catch(() => {}); shared = null; }

// --markers-only: the timeline JSON (scenes, marks, sound events, narrator slots) from the audio captures alone —
// no frames needed (run with --audio-only first); the picture is assumed complete (segment length = dur)
if (opt['markers-only']) {
  await soundtrack(segs.map((s) => ({ ...s, n: Math.min(LIMIT, Math.round(s.dur * FPS)), dir: join(FR, s.id) })).filter((p) => existsSync(join(p.dir, 'audio.json'))), null);
} else if (CUT === 'edit' && !opt['no-assemble'] && !opt.at) {
  // the edit trailer: beat-synced composition of the source shots + music + game sound (scripts/video/edit-compose.mjs)
  const C = await import(pathToFileURL(join(here, 'edit-compose.mjs')).href);
  await C.compose({ root: ROOT, out: OUT, frames: FR, ext: EXT, name: NAME, w: Math.round(W * DSF / 2) * 2, h: Math.round(H * DSF / 2) * 2, encoder: ENC, crf: CRF,
    audio: AUDIO, chrome: EXE, args: ARGS, gpu: GPU, profile: opt.profile, segs, opt });
} else if (!opt['no-assemble'] && !opt.at) {
  const parts = [];
  for (const s of segs) {
    const dir = join(FR, s.id);
    const n = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.' + EXT)).length : 0;
    const st = existsSync(join(dir, 'status.txt')) ? readFileSync(join(dir, 'status.txt'), 'utf8') : '';
    if (!n || /^(skip|error)/.test(st)) { log(`assemble: skipping ${s.id} (${st || 'no frames'})`); continue; }
    const want = Math.min(LIMIT, Math.round(s.dur * FPS));
    if (n < want) log(`assemble: WARNING ${s.id} has ${n}/${want} frames (incomplete — run the render again to resume)`);
    parts.push({ ...s, n, dir });
  }
  if (!parts.length) { log('nothing to assemble'); process.exit(1); }
  const args = ['-y', '-hide_banner', '-loglevel', 'warning'];
  for (const p of parts) args.push('-framerate', String(FPS), '-i', join(p.dir, '%05d.' + EXT));
  // crossfade chain; the fade length of a part is its own xfade (into the next), min 1 frame (= a cut)
  let f = '', last = '[0:v]', len = parts[0].n / FPS;
  for (let i = 1; i < parts.length; i++) {
    const d = Math.max(1 / FPS, Math.min(parts[i - 1].xfade || 0, len / 2, parts[i].n / FPS / 2));
    const off = Math.max(0, len - d);
    f += `${last}[${i}:v]xfade=transition=fade:duration=${d.toFixed(4)}:offset=${off.toFixed(4)}[x${i}];`;
    last = `[x${i}]`; len = off + parts[i].n / FPS;
  }
  const OW = Math.round(W * DSF / 2) * 2, OH = Math.round(H * DSF / 2) * 2;
  f += `${last}${DSF !== 1 ? `scale=${OW}:${OH}:flags=lanczos,` : ''}format=yuv420p[out]`;
  args.push('-filter_complex', f, '-map', '[out]', '-r', String(FPS));
  if (ENC === 'h264_nvenc') args.push('-c:v', 'h264_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'vbr', '-cq', CRF, '-b:v', '0', '-profile:v', 'high');
  else args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', CRF, '-profile:v', 'high');
  const mp4 = join(OUT, NAME + (AUDIO ? '.video.mp4' : '.mp4'));
  args.push('-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4);
  log('ffmpeg', parts.map((p) => `${p.id}:${p.n}`).join(' '), '→', mp4);
  const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (r.status !== 0) { log('ffmpeg failed', r.status); process.exit(1); }
  const pr = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=width,height,r_frame_rate,nb_frames', '-of', 'compact', mp4], { encoding: 'utf8' });
  log('result:', (pr.stdout || '').trim().replace(/\n/g, ' | '));
  void spawn;
  if (AUDIO) await soundtrack(parts, mp4);
}
/* ---- the soundtrack (gameplay cut): render each segment's capture, join like the picture, master, mux */
async function soundtrack(parts, videoMp4) {
  const A = await import(pathToFileURL(join(here, 'audio.mjs')).href);
  const abundle = readFileSync(join(OUT, 'bundle', 'audio.js'), 'utf8');
  // --profile (Windows): the same persistent profile again — a fresh one would cost another OS password probe
  const AARGS = ['--autoplay-policy=no-user-gesture-required', ...(GPU ? ARGS : ['--no-sandbox'])];
  const b = opt.profile ? await chromium.launchPersistentContext(resolve(opt.profile), { executablePath: EXE, headless: true, args: AARGS })
    : await chromium.launch({ executablePath: EXE, headless: true, args: AARGS });
  const scenes = [];
  let at = 0;
  try {
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], capF = join(p.dir, 'audio.json'), wav = join(p.dir, 'audio.wav');
      if (!existsSync(capF)) throw new Error(`no audio capture for ${p.id} — run the render again (or --audio-only)`);
      const cap = JSON.parse(readFileSync(capF, 'utf8'));
      if (cap.frames !== p.n) log(`audio: WARNING ${p.id}: capture has ${cap.frames} frames, picture ${p.n}`);
      cap.dur = p.n / FPS;
      const r = videoMp4 ? await A.renderSegment(b, abundle, cap, wav) : { voices: 0, peakDb: -Infinity, lead: 0 };
      const fade = i < parts.length - 1 ? Math.max(1 / FPS, Math.min(p.xfade || 0, (at + p.n / FPS) / 2, parts[i + 1].n / FPS / 2)) : 0;
      // event times on the final timeline: segment start + segment time (audio zero = first captured frame)
      const ev = cap.log.filter((e) => e.k === 'voice').map((e) => ({ t: +(at + e.t - cap.t0).toFixed(3), id: e.id })).filter((e) => e.t >= at && e.t < at + p.n / FPS);
      const narr = (p.narr || []).map((n) => { const m = cap.marks.find(([k]) => k === n.mark); return m ? { start: +(at + m[1] + n.off).toFixed(2), dur: n.dur, text: n.text, scene: p.id } : null; }).filter(Boolean);
      scenes.push({ id: p.id, title: p.title, start: +at.toFixed(3), end: +(at + p.n / FPS).toFixed(3), fadeOut: fade, marks: cap.marks.map(([k, t]) => ({ name: k, t: +(at + t).toFixed(3) })), narr, events: ev });
      log(`audio: ${p.id} ${r.voices} voices, peak ${r.peakDb.toFixed(1)} dBFS, lead ${r.lead.toFixed(2)} s → ${wav}`);
      at += p.n / FPS - fade;
    }
  } finally { await b.close(); }
  const parts2 = scenes.map((s) => ({ wav: join(FR, s.id, 'audio.wav'), fade: s.fadeOut }));
  const res = !videoMp4 ? { final: { I: null, TP: null }, gain: 0, limiter: 0 } : A.joinAndMaster({ parts: parts2, video: videoMp4, outMp4: join(OUT, NAME + '.mp4'), rawWav: join(OUT, NAME + '.raw.wav'), masterWav: join(OUT, NAME + '.wav') });
  // narrator slots must not sit on the purchase coins or the stone breaking (or any UI/impact cue within 0.6 s)
  const KEY = new Set(['shop.buy', 'mine.break', 'door.open']);
  const slots = scenes.flatMap((s) => s.narr);
  for (const n of slots) {
    const hit = scenes.flatMap((s) => s.events).filter((e) => KEY.has(e.id) && e.t > n.start - 0.6 && e.t < n.start + n.dur + 0.6);
    n.clash = hit.map((e) => `${e.id}@${e.t}`);
    if (hit.length) log(`audio: WARNING narrator slot at ${n.start}s overlaps ${n.clash.join(', ')}`);
  }
  const meta = { name: NAME, duration: +at.toFixed(3), mix: { lufs: res.final.I, truePeak: res.final.TP, gainDb: +res.gain.toFixed(2), limiterDb: +res.limiter.toFixed(2) },
    narration: { slots, duck: 'duck the game mix by 4–6 dB under each slot (ramps ≈0.3 s), then re-master the sum to −16 LUFS / ≤ −1 dBTP' }, scenes };
  writeFileSync(join(OUT, NAME + '.markers.json'), JSON.stringify(meta, null, 1));
  log(`soundtrack: ${NAME}.mp4 · ${res.final.I} LUFS · TP ${res.final.TP} dBTP · markers → ${NAME}.markers.json`);
}
writeFileSync(join(OUT, NAME + '.results.json'), JSON.stringify([...results.values()], null, 1));
