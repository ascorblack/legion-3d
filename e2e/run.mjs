// End-to-end check against the real site: loads dist/bridge.js at document_start and dist/game.js after load
// (same as the extension's MAIN-world content scripts), waits for the 3D game, takes screenshots, prints game stats.
//   L3D_COOKIES=cookies.txt node e2e/run.mjs [url] [--secs=40] [--out=e2e/.artifacts] [--steps=...]
// Never prints cookie values. Read-only for the account: it only walks (the site's city client sends go/ping).
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--')) || process.env.L3D_URL || 'https://legiongame.gg/c/zakvielchannel/';
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const out = opt.out || 'e2e/.artifacts';
mkdirSync(out, { recursive: true });
const cookies = readFileSync(process.env.L3D_COOKIES, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => {
  const [domain, , path, secure, exp, name, value] = l.split('\t');
  return { domain, path, secure: secure === 'TRUE', expires: +exp, name, value: value.trim(), httpOnly: true };
});
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const c = await b.newContext({ viewport: { width: +(opt.w || 1280), height: +(opt.h || 720) }, bypassCSP: true });
await c.addCookies(cookies);
const p = await c.newPage();
const errors = [];
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || /legion-3d|\[l3d\]/.test(t)) { console.log(`[${m.type()}]`, t.slice(0, 600)); if (m.type() === 'error') errors.push(t); } });
p.on('pageerror', (e) => { console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(1, 4).join(' | ')); errors.push(e.message); });
await p.addInitScript({ content: readFileSync('dist/bridge.js', 'utf8') });
await p.goto(url, { waitUntil: 'load' });
await p.evaluate(readFileSync('dist/game.js', 'utf8'));
const t0 = Date.now();
await p.waitForFunction(() => !!(window.__l3dGame) || !!document.querySelector('#l3d-splash .l3d-sp-x button'), null, { timeout: 90000 }).catch(() => {});
console.log('boot ms', Date.now() - t0);
const splash = await p.evaluate(() => document.querySelector('#l3d-splash .l3d-sp-t')?.textContent || null);
if (splash) console.log('splash:', splash);
const stats = () => p.evaluate(() => {
  const g = window.__l3dGame; if (!g) return null;
  const s = g.engine.stats(); const st = g.store;
  return { fps: Math.round(s.fps), ms: +s.ms.toFixed(1), calls: s.calls, tris: s.tris, scale: s.scale, q: g.engine.quality,
    walkers: st.walkers.size, me: st.me && [Math.round(st.me.x), Math.round(st.me.y)], cam: g.rig.mode, overlay: g.site.overlay() };
});
await p.waitForTimeout(4000);
console.log('stats', JSON.stringify(await stats()));
const shot = async (name) => { await p.screenshot({ path: `${out}/${name}.png` }); console.log('shot', `${out}/${name}.png`); };
await shot('01-fp');
const steps = (opt.steps || 'walk,tp,gear,bag,close,fp').split(',');
for (const s of steps) {
  if (s === 'walk') { await p.keyboard.down('KeyW'); await p.waitForTimeout(2500); await p.keyboard.up('KeyW'); await p.waitForTimeout(500); await shot('02-walked'); }
  if (s === 'turn') { await p.evaluate(() => { window.__l3dGame.rig.yaw += Math.PI / 2; }); await p.waitForTimeout(800); await shot('02b-turn'); }
  if (s === 'tp') { await p.keyboard.press('KeyV'); await p.waitForTimeout(1500); await shot('03-tp'); }
  if (s === 'gear') { await p.keyboard.press('KeyC'); await p.waitForTimeout(1800); await shot('04-gear'); }
  if (s === 'bag') { await p.keyboard.press('KeyI'); await p.waitForTimeout(1200); await shot('05-bag'); }
  if (s === 'stats') { await p.keyboard.press('KeyP'); await p.waitForTimeout(1200); await shot('05b-stats'); }
  if (s === 'close') { await p.keyboard.press('Escape'); await p.waitForTimeout(1200); await shot('06-closed'); }
  if (s === 'fp') { await p.keyboard.press('KeyV'); await p.waitForTimeout(1200); await shot('07-fp'); }
  if (s === 'classic') { await p.keyboard.press('F8'); await p.waitForTimeout(1500); await shot('08-classic'); await p.keyboard.press('F8'); await p.waitForTimeout(2000); await shot('09-back'); }
}
if (opt.eval) { console.log('eval →', JSON.stringify(await p.evaluate(opt.eval)).slice(0, 2000)); await p.waitForTimeout(1000); await shot('10-eval'); }
console.log('stats', JSON.stringify(await stats()));
console.log('errors', errors.length);
await b.close();
