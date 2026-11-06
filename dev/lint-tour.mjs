// Visual regression tour: ~12 fixed viewpoints per town in the offline demo, SwiftShader 960×540, HUD off, no bots/names.
//   npm run build && CHROMIUM=/usr/bin/google-chrome node dev/lint-tour.mjs [town…] [--out=.local/fcart/tour] [--q=2] [--n=12] [--lint]
// towns: fair fairc camp village cherts townkit (default: all). Shots: <out>/<town>/<nn>-<name>.png + views.json (camera,
// what) so a critic (ImageView) can rate them and a later run can be compared view by view. Views come from the town's own
// layout: an overview, then each building's door seen from the street (3/4 view), then the stairs / ramp / mine of the
// new fair; --lint also turns on the geometry lint pins (src/features/geomlint.ts) so the findings show in the shots.
const { chromium } = await import('playwright').catch(() => import('playwright-core'));
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)]; }));
const QUERY = { fair: 'bots=0', fairc: 'fc=1&jail=1&magic=1&bots=0', camp: 'town=camp&bots=0', village: 'town=village&bots=0', cherts: 'town=village&style=cherts&bots=0', townkit: 'tk=1&bots=0' };
const towns = args.filter((a) => !a.startsWith('--')).filter((t) => QUERY[t]);
const OUT = opt.out || '.local/fcart/tour', Q = +(opt.q ?? 2), N = +(opt.n ?? 12), W = 960, H = 540;
const gl = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox', ...gl] });
for (const town of towns.length ? towns : Object.keys(QUERY)) {
  const dir = `${OUT}/${town}`; mkdirSync(dir, { recursive: true });
  const p = await b.newPage({ viewport: { width: W, height: H } });
  p.on('pageerror', (e) => console.log(`[${town}] pageerror`, e.message));
  await p.addInitScript({ content: `try { localStorage.setItem('l3d.whatsnew.enabled', '0'); localStorage.setItem('l3d.event.mode', 'off'); localStorage.setItem('l3d.names', 'off'); ${opt.lint ? "localStorage.setItem('l3d.geomlint', 'on');" : ''} } catch (e) {}` });
  await p.goto('file://' + resolve('dist-dev/game.html') + '?' + QUERY[town]);
  await p.waitForFunction(() => !!window.__l3dGame?.world, null, { timeout: 120000 });
  await p.waitForTimeout(3000);
  await p.keyboard.press('F2');
  const frames = (n) => p.evaluate((k) => new Promise((res) => { let i = 0; const off = window.__l3dGame.engine.onFrame(() => { if (++i >= k) { off(); res(1); } }); setTimeout(() => { off(); res(0); }, 60000); }), n);
  // the views, from the layout (metres: x = px / 100, z = (px_y − 800) / 50 — src/world/coords.ts)
  const views = await p.evaluate((N) => {
    const g = window.__l3dGame, L = g.ctx.layout(), toX = (x) => x / 100, toZ = (y) => (y - 800) / 50;
    const G = (x, z) => { try { return g.world.groundAt ? g.world.groundAt(x * 100, z * 50 + 800) : 0; } catch { return 0; } };
    const v = [];
    const ax = (toX(L.area.x0) + toX(L.area.x1)) / 2, az = (toZ(L.area.y0) + toZ(L.area.y1)) / 2;
    v.push({ name: 'overview', what: 'whole town from above the south edge', cam: [ax, 16, toZ(L.area.y1) + 10], at: [ax, 0, az] });
    const fc = L.faircats;
    if (fc) {
      for (const st of fc.stairs || []) {
        const x = toX((st.x0 + st.x1) / 2), z0 = toZ(st.y0), z1 = toZ(st.y1);
        v.push({ name: st.k === 'ramp' ? 'ramp' : 'stairs', what: `${st.k === 'ramp' ? 'cart ramp + rails' : 'stairs up the bank'} from below, at an angle`, cam: [x + 2.5, 3.2, z1 + 6.5], at: [x, 1.2, (z0 + z1) / 2] });
        v.push({ name: (st.k === 'ramp' ? 'ramp' : 'stairs') + '-side', what: `${st.k === 'ramp' ? 'the ramp' : 'the stairs'} from the side (cheek walls, bank)`, cam: [x - 4, 4.5, z1 + 3], at: [x, 1.2, (z0 + z1) / 2] });
      }
    }
    for (const bd of L.buildings) {
      const x = toX(bd.door.x), z = toZ(bd.door.y), y = G(x, z), s = (v.length % 2 ? 1 : -1);
      const cz = z + 6.5, cy = Math.max(y, G(x + s * 2.4, cz)) + 2.8;   // from the street, above props and lamp posts
      v.push({ name: bd.id, what: `${bd.title}: the door and the front`, cam: [x + s * 2.4, cy, cz], at: [x, y + 1.4, z - 1.5] });
    }
    return v.slice(0, Math.max(N, 1));
  }, N);
  await p.evaluate(({ Q }) => {
    const g = window.__l3dGame, cam = g.engine.camera;
    g.rig.mode = 'tp';
    g.engine.setQuality(Q);
    g.engine.onFrame(() => { const c = window.__shotCam; if (!c) return; g.vm.root.visible = false; cam.position.set(...c.cam); cam.lookAt(...c.at); if (cam.fov !== 60) { cam.fov = 60; cam.updateProjectionMatrix(); } });
  }, { Q });
  const log = [];
  for (let i = 0; i < views.length; i++) {
    const v = views[i], file = `${dir}/${String(i + 1).padStart(2, '0')}-${v.name}.png`;
    await p.evaluate((v) => { window.__shotCam = v; }, v);
    await frames(6);
    await p.evaluate(() => window.__l3dGame.engine.pause(true));
    await p.screenshot({ path: file, timeout: 120000 });
    await p.evaluate(() => window.__l3dGame.engine.pause(false));
    log.push({ file, ...v });
    console.log(file, '—', v.what);
  }
  const lint = await p.evaluate(() => window.__l3dLint ? { counts: window.__l3dLint.counts, n: window.__l3dLint.findings.length } : null);
  writeFileSync(`${dir}/views.json`, JSON.stringify({ town, q: Q, size: [W, H], lint, views: log }, null, 1));
  if (lint) console.log(`[${town}] lint`, JSON.stringify(lint));
  await p.close();
}
await b.close();
