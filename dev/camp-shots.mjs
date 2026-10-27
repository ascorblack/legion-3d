// Full HD screenshots of the start camp «Перепутье» in the offline demo (no site, demo names only).
//   npm run build && CHROMIUM=/usr/bin/google-chrome node dev/camp-shots.mjs [outDir=release/camp] [--gpu] [--q=3]
// Opens dist-dev/game.html?town=camp&bots=0 (no name tags in the frame), hides the HUD (F2), locks the quality level, and for each view
// places the hero and a free photo camera, renders a few frames and captures 1920×1080. --gpu: use the real GPU
// (headful-capable machine) instead of SwiftShader. --event=auto keeps the seasonal event (Halloween pumpkins); off by default. --sky=dusk: evening sky. --exposure=1.35: photo exposure.
const { chromium } = await import('playwright').catch(() => import('playwright-core'));
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)]; }));
const out = args.find((a) => !a.startsWith('--')) || 'release/camp';
mkdirSync(out, { recursive: true });
const Q = +(opt.q ?? 3);
const DEG = Math.PI / 180;
// views: where the hero stands (site px) and a free photo camera (metres: x = px/100, z = (px_y − 800)/50, y up) looking at
// `at`; fov in degrees. The camera override runs as the last engine frame callback, so post-processing still applies.
export const VIEWS = [
  { name: 'camp-01', what: 'wide overview of the camp from above the south-east corner', hero: [1760, 1190], cam: [27.0, 6.2, 10.6], at: [15.5, 0.2, 3.4], fov: 58 },
  { name: 'camp-02', what: 'eye level at the campfire: cauldron, log benches, the gate behind', hero: [2300, 1320], cam: [18.5, 1.0, 7.7], at: [16.7, 0.75, 4.4], fov: 64 },
  { name: 'camp-03', what: 'between the tents (west side) with the hero', hero: [800, 1080], cam: [12.8, 2.6, 7.4], at: [5.0, 0.8, 5.4], fov: 60 },
  { name: 'camp-04', what: 'the trade rows (shop) entrance', hero: [1000, 1300], cam: [27.4, 2.6, 9.4], at: [29.6, 1.8, 1.4], fov: 60 },
  { name: 'camp-05', what: 'across the fire to the forge and the storage (looking west)', hero: [3100, 1300], cam: [21.6, 1.8, 7.6], at: [14.4, 1.0, 3.8], fov: 62 },
  { name: 'camp-06', what: 'east side: tents, washing line, torches, palisade', hero: [600, 1300], cam: [25.8, 2.5, 9.2], at: [31.6, 0.9, 5.0], fov: 62 },
];

const gl = opt.gpu ? ['--use-gl=angle', '--ignore-gpu-blocklist', '--enable-gpu'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
// --profile=<dir>: one persistent profile (a fresh one per launch makes Chrome probe the OS password on Windows)
const winGl = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
const glArgs = opt.gpu && process.platform === 'win32' ? winGl : gl;
const b = opt.profile
  ? await chromium.launchPersistentContext(opt.profile, { headless: true, executablePath: process.env.CHROMIUM || undefined, args: glArgs, viewport: { width: 1920, height: 1080 } })
  : await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox', ...glArgs] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.addInitScript({ content: "const opt_event = " + JSON.stringify(opt.event || 'off') + "; try { localStorage.setItem('l3d.whatsnew.enabled', '0'); localStorage.setItem('l3d.event.mode', opt_event); localStorage.setItem('l3d.names', 'off'); } catch (e) {}" });
await p.goto('file://' + resolve('dist-dev/game.html') + '?town=camp&bots=0' + (opt.sky ? '&sky=' + opt.sky : ''));
await p.waitForFunction(() => !!window.__l3dGame, null, { timeout: 120000 });
await p.waitForTimeout(5000);
await p.keyboard.press('F2');   // HUD off
const frames = (n) => p.evaluate((k) => new Promise((res) => { let i = 0; const off = window.__l3dGame.engine.onFrame(() => { if (++i >= k) { off(); res(1); } }); setTimeout(() => { off(); res(0); }, 60000); }), n);
await p.evaluate((EXPOSURE) => {
  const g = window.__l3dGame, cam = g.engine.camera;
  g.rig.mode = 'tp';   // the hero is drawn (first person hides it)
  g.engine.renderer.toneMappingExposure = EXPOSURE;   // photo exposure (game default 1)
  g.engine.onFrame(() => {
    const c = window.__shotCam; if (!c) return;
    g.vm.root.visible = false;   // no first-person hands/weapon in a photo
    cam.position.set(c.cam[0], c.cam[1], c.cam[2]);
    cam.lookAt(c.at[0], c.at[1], c.at[2]);
    if (cam.fov !== c.fov) { cam.fov = c.fov; cam.updateProjectionMatrix(); }
  });
}, +(opt.exposure || 1.35));
for (const v of VIEWS) {
  await p.evaluate((v) => {
    const g = window.__l3dGame;
    g.player.teleport(v.hero[0], v.hero[1]);
    window.__shotCam = v;
    // the offline demo has no live channel: hide the «нет связи» badge (src/features/netstatus.ts) for the photo
    const hide = (r) => { for (const e of r.querySelectorAll('*')) { if (e.shadowRoot) hide(e.shadowRoot); if (e.childElementCount === 0 && /нет связи|резерв/i.test(e.textContent || '')) e.style.visibility = 'hidden'; } };
    hide(document);
  }, v);
  await frames(12);
  await p.evaluate((q) => window.__l3dGame.engine.setQuality(q), Q);   // full resolution again (the governor lowers it on slow GL)
  await frames(3);
  await p.evaluate(() => window.__l3dGame.engine.pause(true));
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/${v.name}.png`, timeout: 180000 });
  await p.evaluate(() => window.__l3dGame.engine.pause(false));
  const st = await p.evaluate(() => { const g = window.__l3dGame, s = g.engine.stats(); return { q: g.engine.quality, scale: s.scale, calls: s.calls, tris: s.tris }; });
  console.log(`${out}/${v.name}.png`, v.what, JSON.stringify(st));
}
await b.close();
