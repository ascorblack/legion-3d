// Release screenshots of «Ночь Тыквенной Луны» (the site's hero.hwc) in the offline demo (no site, demo names only).
//   npm run build && CHROMIUM=/usr/bin/google-chrome node dev/hw-shots.mjs [outDir=release/hw] [--gpu] [--q=3] [--w=2560] [--h=1440] [--profile=<dir>] [--jpg]
// Opens dist-dev/game.html?bots=12, hides the HUD (F2) and the name tags, locks the quality level (default q3, render
// scale 1, pixel ratio 1), switches hero.hwc live (__demo.hwc: 'look' = decorated «dead» Fair, 'lp' = + the portal and
// ghost cats) and for each view places the hero, the bots and a free photo camera. --gpu: real GPU instead of
// SwiftShader; --profile: one persistent Chrome profile (Windows). --jpg: also write <name>.jpg (≤ 1600 px wide, needs ffmpeg).
const { chromium } = await import('playwright').catch(() => import('playwright-core'));
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)]; }));
const out = args.find((a) => !a.startsWith('--')) || 'release/hw';
mkdirSync(out, { recursive: true });
const Q = +(opt.q ?? 3), W = +(opt.w || 2560), H = +(opt.h || 1440);
// views: hwc state, hero (site px), bots gathered around [x, y, rx, ry] px (null = where they are), free camera (metres:
// x = px/100, z = (px_y − 800)/50, y up) looking at `at`; fov in degrees. The gate (portal) is at x ≈ 27.6 m, z ≈ 0.
export const VIEWS = [
  { name: 'hw-decor', hwc: 'look', what: 'the Fair in its Halloween dress, «dead» grade: cauldron by the gate, candles, cobwebs, bats', hero: [3150, 900], bots: [3000, 1000, 300, 60], cam: [34.0, 2.6, 6.2], at: [28.6, 1.3, 0.6], fov: 58 },
  { name: 'hw-portal', hwc: 'lp', what: 'the portal at the gate, the own hero as a ghost', hero: [2700, 900], bots: [2560, 1010, 160, 40], cam: [25.4, 2.0, 5.6], at: [27.5, 1.6, 0.3], fov: 50 },
  { name: 'hw-ghosts', hwc: 'lp', what: 'the dead city with every cat a ghost', hero: [2470, 1010], bots: [2470, 960, 320, 75], cam: [24.7, 2.8, 7.6], at: [24.9, 0.9, 2.2], fov: 56 },
  { name: 'hw-wide', hwc: 'lp', what: 'wide view along the street: portal, witch and bats over the gate', hero: [2300, 1000], bots: [2600, 960, 400, 60], cam: [20.5, 3.0, 9.5], at: [28.8, 3.9, 1.0], fov: 64 },
];

const gl = opt.gpu ? ['--use-gl=angle', '--ignore-gpu-blocklist', '--enable-gpu'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const winGl = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
const glArgs = opt.gpu && process.platform === 'win32' ? winGl : gl;
const b = opt.profile
  ? await chromium.launchPersistentContext(opt.profile, { headless: true, executablePath: process.env.CHROMIUM || undefined, args: glArgs, viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  : await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox', ...glArgs] });
const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.addInitScript({ content: "try { localStorage.setItem('l3d.whatsnew.enabled', '0'); localStorage.setItem('l3d.event.mode', 'auto'); localStorage.setItem('l3d.names', 'off'); localStorage.setItem('l3d.hwcity', 'on'); } catch (e) {}" });
await p.goto('file://' + resolve('dist-dev/game.html') + '?bots=12');
await p.waitForFunction(() => !!window.__l3dGame && !!window.__demo, null, { timeout: 120000 });
await p.waitForTimeout(5000);
await p.keyboard.press('F2');   // HUD off
const frames = (n) => p.evaluate((k) => new Promise((res) => { let i = 0; const off = window.__l3dGame.engine.onFrame(() => { if (++i >= k) { off(); res(1); } }); setTimeout(() => { off(); res(0); }, 90000); }), n);
await p.evaluate(() => {
  const g = window.__l3dGame, cam = g.engine.camera;
  g.rig.mode = 'tp';
  g.engine.onFrame(() => {
    g.labels.root.visible = false;   // no name tags / bubbles in a photo
    const c = window.__shotCam; if (!c) return;
    g.vm.root.visible = false;
    cam.position.set(c.cam[0], c.cam[1], c.cam[2]);
    cam.lookAt(c.at[0], c.at[1], c.at[2]);
    if (cam.fov !== c.fov) { cam.fov = c.fov; cam.updateProjectionMatrix(); }
  });
});
for (const v of VIEWS) {
  await p.evaluate((v) => {
    const g = window.__l3dGame, D = window.__demo;
    if (g.hwcity.mode().key !== (v.hwc === 'look' ? 'ld' : 'ldpg')) D.hwc(v.hwc);
    g.player.teleport(v.hero[0], v.hero[1]);
    if (v.bots) {
      const [cx, cy, rx, ry] = v.bots, L = g.ctx.layout();
      D.bots.forEach((b, i) => { const a = i * 2.39996, k = Math.sqrt((i + 0.5) / D.bots.length); const [x, y] = L.nearest(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k);
        b.x = x; b.y = y; b.path = null; b.wait = 1e9; b.speed = 0; b.face = 1.2 + (i % 5) * 0.5; D.store.upsertWalker(b); });
    }
    window.__shotCam = v;
    const hide = (r) => { for (const e of r.querySelectorAll('*')) { if (e.shadowRoot) hide(e.shadowRoot); if (e.childElementCount === 0 && /нет связи|резерв/i.test(e.textContent || '')) e.style.visibility = 'hidden'; } };
    hide(document);
  }, v);
  await frames(40);   // transitions (dead grade 2.6 s, portal 1.8 s) and the ghost swaps finish
  await p.waitForTimeout(3000);
  await p.evaluate((q) => window.__l3dGame.engine.setQuality(q), Q);   // full resolution again (the governor lowers it on slow GL)
  await frames(3);
  await p.evaluate(() => window.__l3dGame.engine.pause(true));
  await p.waitForTimeout(300);
  const png = `${out}/${v.name}.png`;
  await p.screenshot({ path: png, timeout: 240000 });
  await p.evaluate(() => window.__l3dGame.engine.pause(false));
  const st = await p.evaluate(() => { const g = window.__l3dGame, s = g.engine.stats(); return { q: g.engine.quality, scale: s.scale, pr: g.engine.renderer.getPixelRatio(), calls: s.calls, tris: s.tris, hwc: g.hwcity.mode().key, ...g.hwcity.state() }; });
  console.log(png, '—', v.what, JSON.stringify({ q: st.q, scale: st.scale, pr: st.pr, calls: st.calls, tris: st.tris, hwc: st.hwc, deadK: st.deadK, portalK: st.portalK, ghosts: st.ghosts }));
  if (opt.jpg) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-vf', 'scale=1600:-1', '-q:v', '4', png.replace(/\.png$/, '.jpg')]);
}
await b.close();
