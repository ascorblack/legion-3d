// Screenshots of «Тюрьма и клетка» (site 30.10; 31.10 beyond the canal by the lower fence) in the offline demo: the jail
// house, the cage with prisoners, the padlocked door, the back from across the canal, and the prisoner's own view (status
// bar, walking on the cage floor, the site's Jail window). No site, demo names only.
//   npm run build && CHROMIUM=/usr/bin/google-chrome node dev/jail-shots.mjs [outDir=.local/jail-shots] [--gpu] [--q=3] [--w=1600] [--h=900] [--only=a,b] [--profile=<dir>]
// --gpu: a real GPU (RTX) instead of SwiftShader; the views are fixed free-camera shots (metres: x = px/100, z = (px_y − 800)/50,
// y up; the lower street is at y = −1.4). The jail: house x 15.5…17.9, cage x 18.3…22.4, back z 17.04, bars on z 21.32, the
// canal z 14…15.9, the lower fence (city wall) z 23.2. `walk` views hold keys and check the prisoner stays on LOW.jail.walk
// and sends nothing (window.__demoMoves); exit code 1 when a check fails.
const { chromium } = await import('playwright').catch(() => import('playwright-core'));
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)]; }));
const out = args.find((a) => !a.startsWith('--')) || '.local/jail-shots';
mkdirSync(out, { recursive: true });
const Q = +(opt.q ?? 3), W = +(opt.w || 1600), H = +(opt.h || 900);

// q = query of the demo page; cam/at/fov = a free camera (null = the game's own camera: the prisoner's view); e = press E after
export const VIEWS = [
  { name: 'jail-front', q: 'jail=1', what: 'the jail and the cage from over the lower fence', hero: [1400, 1440], cam: [19.2, 2.6, 26.4], at: [19.2, -0.6, 19.4], fov: 56 },
  { name: 'jail-cage', q: 'jail=1', what: 'the cage from the strip by the fence: bars all round, the door in the grille, six prisoners on the seats', hero: [2700, 1440], cam: [20.3, 0.05, 23.05], at: [20.3, -0.6, 19.0], fov: 64 },
  { name: 'jail-padlock', q: 'jail=1', what: 'close: the door of the cage, its hinges, the bolt and the padlock', hero: [2700, 1440], cam: [20.75, -0.35, 22.7], at: [20.35, -0.45, 21.28], fov: 44 },
  { name: 'jail-house', q: 'jail=1', what: 'the house: crenellations, barred window, iron-bound door, the sign, the torch, the chain', hero: [2700, 1440], cam: [16.9, 1.2, 25.0], at: [16.75, -0.2, 21.0], fov: 50 },
  { name: 'jail-side', q: 'jail=1', what: 'from the right: side bars, the roof bars, the straw and the bowl at the back', hero: [2900, 1440], cam: [24.6, 0.9, 22.8], at: [20.3, -0.6, 19.0], fov: 58 },
  { name: 'jail-back', q: 'jail=1', what: 'from across the canal: the coping, the passage behind the jail, the back grille and the back wall', hero: [2900, 1440], cam: [19.6, 0.7, 12.6], at: [19.6, -0.7, 18.6], fov: 60 },
  { name: 'jail-wide', q: 'jail=1', what: 'wide: the canal and its bridge, the jail, the cage, the fence; the moved barrel right of the bridge', hero: [2600, 1460], cam: [19.0, 5.2, 9.0], at: [20.0, -1.2, 19.0], fov: 62 },
  { name: 'jail-prisoner', q: 'jail=me', what: 'the hero is a prisoner: on his seat in the cage, the status bar with reason and term (game camera, HUD on)', hud: true, cam: null },
  { name: 'jail-walk', q: 'jail=me', what: 'the prisoner walks on the cage floor (D, then S, then W+A): stops at LOW.jail.walk, nothing sent', hud: true, cam: null,
    walk: [['KeyD', 6000], ['KeyS', 3000], ['KeyW+KeyA', 1200]], rect: [1870, 1760, 2200, 1844] },
  { name: 'jail-window', q: 'jail=me', what: 'E: the site\'s Jail window (demo stand-in) over the 3D, the modal frees the pointer', hud: true, cam: null, e: true },
];

const gl = opt.gpu ? ['--use-gl=angle', '--ignore-gpu-blocklist', '--enable-gpu'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const glArgs = opt.gpu && process.platform === 'win32' ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : gl;
const b = opt.profile
  ? await chromium.launchPersistentContext(opt.profile, { headless: true, executablePath: process.env.CHROMIUM || undefined, args: glArgs, viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  : await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox', ...glArgs] });
let page = null, pageQ = '';
const open = async (q) => {
  if (page && pageQ === q) return page;
  if (page) await page.close();
  page = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 }); pageQ = q;
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (/error/i.test(m.type())) console.log('[console]', m.text().slice(0, 200)); });
  await page.addInitScript({ content: "try { localStorage.setItem('l3d.whatsnew.enabled', '0'); localStorage.setItem('l3d.names', 'off'); localStorage.setItem('l3d.event.mode', 'off'); } catch (e) {}" });
  await page.goto('file://' + resolve('dist-dev/game.html') + '?bots=4&' + q);
  await page.waitForFunction(() => !!window.__l3dGame && !!window.__demo, null, { timeout: 120000 });
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    const g = window.__l3dGame, cam = g.engine.camera;
    g.engine.onFrame(() => {
      const c = window.__shotCam; if (!c) return;
      g.labels.root.visible = false; g.vm.root.visible = false; g.meAv.root.visible = false;
      cam.position.set(c.cam[0], c.cam[1], c.cam[2]); cam.lookAt(c.at[0], c.at[1], c.at[2]);
      if (cam.fov !== c.fov) { cam.fov = c.fov; cam.updateProjectionMatrix(); }
    });
  });
  return page;
};
const frames = (p, n) => p.evaluate((k) => new Promise((res) => { let i = 0; const off = window.__l3dGame.engine.onFrame(() => { if (++i >= k) { off(); res(1); } }); setTimeout(() => { off(); res(0); }, 90000); }), n);

for (const v of VIEWS.filter((x) => !opt.only || opt.only.split(',').includes(x.name))) {
  const p = await open(v.q);
  await p.evaluate((v) => {
    const g = window.__l3dGame, D = window.__demo;
    window.__shotCam = v.cam ? v : null;
    if (v.hero) g.player.teleport(v.hero[0], v.hero[1]);
    // the bots off the jail: far right on the upper street
    D.bots.forEach((b, i) => { b.x = 4200 + i * 90; b.y = 950; b.path = null; b.wait = 1e9; b.speed = 0; D.store.upsertWalker(b); });
    if (!v.cam) { g.rig.mode = 'tp'; g.rig.yaw = 0; g.rig.pitch = -0.32; g.meAv.root.visible = true; }
    // the crowd picks whom to draw by the game's own camera (before the shot camera): the hero north of the canal looks
    // south at the jail (+z), so the prisoners in the cage are in its view; the hero himself is hidden in free-camera shots
    else { g.player.teleport(2050, 1450); g.rig.mode = 'tp'; g.rig.yaw = Math.PI; g.rig.pitch = -0.2; }
  }, v);
  if (v.walk) {
    // the prisoner walks: hold the keys (the game reads held keys through its input), sample where he goes
    // the cheapest quality while walking (SwiftShader at q3 runs ~1–2 fps: the clamped frame time would barely move him)
    await p.evaluate(() => window.__l3dGame.engine.setQuality(0));
    await p.evaluate(() => { const g = window.__l3dGame; g.rig.mode = 'tp'; g.rig.yaw = 0; g.rig.pitch = -0.32; });
    const t0 = await p.evaluate(() => ({ x: window.__l3dGame.player.x, y: window.__l3dGame.player.y, moves: window.__demoMoves || 0 }));
    const path = [];
    for (const [keys, ms] of v.walk) {
      const ks = keys.split('+');
      for (const k of ks) await p.keyboard.down(k);
      const until = Date.now() + ms;
      while (Date.now() < until) { await p.waitForTimeout(150); path.push(await p.evaluate(() => [window.__l3dGame.player.x, window.__l3dGame.player.y])); }
      for (const k of ks) await p.keyboard.up(k);
      await p.waitForTimeout(300);
    }
    const t1 = await p.evaluate(() => ({ x: window.__l3dGame.player.x, y: window.__l3dGame.player.y, moves: window.__demoMoves || 0, walk: window.__l3dGame.ctx.state.jailWalk }));
    const [x0, y0, x1, y1] = v.rect, eps = 1.5;
    const off = path.filter(([x, y]) => x < x0 - eps || x > x1 + eps || y < y0 - eps || y > y1 + eps);
    const xs = path.map((q) => q[0]), ys = path.map((q) => q[1]);
    const walked = Math.max(...xs) - Math.min(...xs) > 150 && Math.max(...ys) - Math.min(...ys) > 30;
    const ok = walked && !off.length && t1.moves === t0.moves && x1 - Math.max(...xs) < 14 && y1 - Math.max(...ys) < 10   // the body probe (8 px in x, 4 in y) stays inside;
    console.log(`[walk] from ${t0.x.toFixed(0)},${t0.y.toFixed(0)} to ${t1.x.toFixed(0)},${t1.y.toFixed(0)} · x ${Math.min(...xs).toFixed(0)}…${Math.max(...xs).toFixed(0)} y ${Math.min(...ys).toFixed(0)}…${Math.max(...ys).toFixed(0)} · off-rect samples ${off.length} · moves sent ${t1.moves - t0.moves} · walk ${JSON.stringify(t1.walk)} → ${ok ? 'OK' : 'FAIL'}`);
    if (!ok) process.exitCode = 1;
    await p.evaluate(() => { const g = window.__l3dGame; g.rig.mode = 'tp'; g.rig.yaw = 0.5; g.rig.pitch = -0.38; });
  }
  const hudOn = await p.evaluate(() => !document.querySelector('#l3d-ui')?.hidden);
  if (!v.hud && hudOn) await p.keyboard.press('F2');
  if (v.e) { await p.keyboard.press('KeyE'); await p.waitForTimeout(600); }
  await frames(p, 30);
  await p.waitForTimeout(1500);
  await p.evaluate((q) => window.__l3dGame.engine.setQuality(q), Q);
  await frames(p, 3);
  await p.evaluate(() => window.__l3dGame.engine.pause(true));
  await p.waitForTimeout(300);
  const png = `${out}/${v.name}.png`;
  await p.screenshot({ path: png, timeout: 240000 });
  await p.evaluate(() => window.__l3dGame.engine.pause(false));
  const st = await p.evaluate(() => {
    const g = window.__l3dGame, s = g.engine.stats();
    return { q: g.engine.quality, calls: s.calls, tris: s.tris, me: [Math.round(g.player.x), Math.round(g.player.y)], jailed: !!g.ctx.state.jailed,
      bar: !!document.getElementById('l3d-jail-bar'), jw: !!document.querySelector('.cy-jw'), prompt: (g.interact.target || {}).label || null };
  });
  console.log(png, '—', v.what, JSON.stringify(st));
  if (!v.hud && hudOn) await p.keyboard.press('F2');
}
await b.close();
