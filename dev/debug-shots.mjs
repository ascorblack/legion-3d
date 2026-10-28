// Screenshots of the debug mode (Settings → Отладка) in the offline demo: the test dimension, the expedition scenes
// panel and the overlays. Demo names only (offline fixtures + demo bots), nothing touches the site.
//   npm run build && CHROMIUM=/usr/bin/google-chrome node dev/debug-shots.mjs [outDir=.local/debugmode/shots] [--q=2] [--only=name,name]
//   RTX release shots: node dev/debug-shots.mjs docs/releases/<version> --gpu --q=3 --w=2560 --h=1440 --profile=<persistent dir> --jpg
// --gpu = the real GPU (Windows: d3d11) instead of SwiftShader; --jpg converts each PNG with ffmpeg (-q:v 2) next to it.
const { chromium } = await import('playwright').catch(() => import('playwright-core'));
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)]; }));
const out = args.find((a) => !a.startsWith('--')) || '.local/debugmode/shots';
mkdirSync(out, { recursive: true });
const Q = +(opt.q ?? 2), W = +(opt.w || 1600), H = +(opt.h || 900);
const only = opt.only ? new Set(opt.only.split(',')) : null;

// cam / at: metres in the dimension (x along the avenue, z: north exhibits < 0 < south exhibits); `sec` = teleport the
// hero to that section first (it is built lazily when the player comes near); `ui` = what to show of the HUD / panel.
export const SHOTS = [
  { name: 'debug-01-overview', what: 'the test dimension from above: avenue, stands, mannequins, portals', sec: 'items-weapon', cam: [-13.5, 6.2, 3.2], at: [7, 0.6, -1.2], fov: 58, tod: 18.5 },
  { name: 'debug-02-items', what: 'every item model on tiered stands (weapons, armour, hats)', sec: 'items-hat', cam: 'sec', fov: 52, tod: 12, d: [-0.2, 1.35, 0.6], t: [0.6, 0.95, -3.2] },
  { name: 'debug-03-looks', what: 'looks on mannequin cats (hats)', sec: 'looks-hat', cam: 'sec', fov: 50, tod: 18.5, d: [0, 1.3, 2.4], t: [0, 0.75, -3.2] },
  { name: 'debug-04-foes', what: 'every expedition foe incl. hw_* and the Pumpkin Golem', sec: 'foes', cam: 'sec', fov: 55, tod: 18.5, d: [-2.2, 1.8, -2.2], t: [0.6, 0.6, 7.6] },
  { name: 'debug-05-npcs', what: 'shopkeepers and the Halloween NPCs', sec: 'npcs', cam: 'sec', fov: 55, tod: 12, d: [2.5, 1.5, -2.4], t: [2.5, 1.0, 8.0] },
  { name: 'debug-06-portals', what: 'portals to the 3D shops, interiors, the mine, the camp and the Fair', sec: 'portals', cam: 'sec', fov: 58, tod: 18.5, d: [-3.2, 1.7, -2.8], t: [1.5, 1.6, 7.6] },
  { name: 'debug-07-scenes', what: 'the «Сцены похода» panel over a mock scene (Pumpkin Golem)', ui: 'scenes', mock: 'hw-golem' },
  { name: 'debug-08-autoplay', what: 'auto-play of the whole expedition with the timeline', ui: 'scenes', auto: 120 },
  { name: 'debug-09-perf-grid', what: 'perf HUD + walk grid and hit boxes in the city', ui: 'overlays' },
  { name: 'debug-10-panel', what: 'the debug panel, «Измерение» tab', ui: 'dim' },
];

const gl = opt.gpu ? ['--use-gl=angle', '--ignore-gpu-blocklist', '--enable-gpu'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const glArgs = opt.gpu && process.platform === 'win32' ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : gl;
const b = opt.profile
  ? await chromium.launchPersistentContext(opt.profile, { headless: true, executablePath: process.env.CHROMIUM || undefined, args: glArgs, viewport: { width: W, height: H } })
  : await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox', ...glArgs] });
const p = await b.newPage({ viewport: { width: W, height: H } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
p.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 300)); });
await p.addInitScript({ content: `try { localStorage.setItem('l3d.whatsnew.enabled', '0'); localStorage.setItem('l3d.debug', 'on'); localStorage.setItem('l3d.quality', '${Q}'); localStorage.setItem('l3d.debug.tab', 'dim'); } catch (e) {}` });
await p.goto('file://' + resolve('dist-dev/game.html') + '?debug=1&bots=6');
await p.waitForFunction(() => !!window.__l3dGame?.ctx?.dev?.debugMode, null, { timeout: 120000 });
await p.waitForTimeout(4000);
const frames = (n) => p.evaluate((k) => new Promise((res) => { let i = 0; const off = window.__l3dGame.engine.onFrame(() => { if (++i >= k) { off(); res(1); } }); setTimeout(() => { off(); res(0); }, 90000); }), n);
await p.evaluate(() => {
  const g = window.__l3dGame, cam = g.engine.camera;
  // the offline demo has no live channel: hide the «нет связи / резерв» badge for the photo
  const hide = (r) => { for (const e of r.querySelectorAll('*')) { if (e.shadowRoot) hide(e.shadowRoot); if (e.childElementCount === 0 && /нет связи|резерв/i.test(e.textContent || '')) e.style.visibility = 'hidden'; } };
  window.__hideBadge = () => hide(document);
  g.engine.onFrame(() => {
    const c = window.__shotCam; if (!c) return;
    g.vm.root.visible = false;
    cam.position.set(c.cam[0], c.cam[1], c.cam[2]); cam.lookAt(c.at[0], c.at[1], c.at[2]);
    if (cam.fov !== c.fov) { cam.fov = c.fov; cam.updateProjectionMatrix(); }
  });
});
let hudOff = false;
const hud = async (on) => { if (on === !hudOff) return; await p.keyboard.press('F2'); hudOff = !on; };
for (const s of SHOTS) {
  if (only && !only.has(s.name)) continue;
  const info = await p.evaluate(async (s) => {
    const g = window.__l3dGame, d = g.ctx.dev.debugMode;
    window.__shotCam = null;
    d.showPanel(false); d.setPerf(false); d.setGrid(false);
    if (s.ui === 'overlays' || s.ui === 'dim') { d.exitAll(); }
    if (s.sec) {
      if (d.scenes.active) d.closeScene(true);
      if (!d.dim) d.enterDimension();
      d.goSection(s.sec);
      d.setTime(s.tod ?? 18.5, true);
      if (s.cam === 'sec') { const st = d.dim.standAt(s.sec); window.__pendingCam = { cam: [st.x + s.d[0], s.d[1], st.z + s.d[2]], at: [st.x + s.t[0], s.t[1], s.t[2]], fov: s.fov }; }
      else window.__pendingCam = { cam: s.cam, at: s.at, fov: s.fov };
    }
    if (s.ui === 'scenes') {
      if (s.mock) d.playMock(s.mock); else d.playAuto(s.auto || 0);
      d.showPanel(true); d.panel.setTab('scenes');
    }
    if (s.ui === 'overlays') { d.setPerf(true); d.setGrid(true); d.bots.spawn(0); g.rig.yaw = 0.4; g.rig.pitch = -0.32; }
    if (s.ui === 'dim') { d.showPanel(true); d.panel.setTab('dim'); }
    return { inside: d.inside };
  }, s);
  await hud(s.ui === 'overlays' || s.ui === 'scenes' || s.ui === 'dim');
  await frames(s.sec ? 40 : 30);   // lazy sections build (one per frame) and the scene settles
  await p.evaluate(() => { if (window.__pendingCam) { window.__shotCam = window.__pendingCam; window.__pendingCam = null; } window.__hideBadge(); });
  await frames(8);
  await p.evaluate((q) => window.__l3dGame.engine.setQuality(q), Q);   // full resolution again (the governor lowers it on slow GL)
  await frames(4);
  await p.evaluate(() => window.__l3dGame.engine.pause(true));
  await p.waitForTimeout(300);
  const file = `${out}/${s.name}.png`;
  await p.screenshot({ path: file, timeout: 180000 });
  await p.evaluate(() => window.__l3dGame.engine.pause(false));
  const st = await p.evaluate(() => { const g = window.__l3dGame, x = g.engine.stats(); return { q: g.engine.quality, calls: x.calls, tris: x.tris, fps: x.fps }; });
  console.log(file, '—', s.what, JSON.stringify({ ...st, ...info }));
  if (opt.jpg) { try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-q:v', '2', file.replace(/\.png$/, '.jpg')]); } catch (e) { console.log('ffmpeg failed', e.message); } }
}
await b.close();
