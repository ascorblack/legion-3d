// RTX release shots of expedition stages (and other dev pages) — run on the GPU box:
//   node dev/release-shots.mjs <outDir> --gpu --w=2560 --h=1440 --profile=<persistent dir> [--q=3]
// Shots: [page, query, name, waitMs]. HUD of the dev page stays (it is the game's own expedition HUD).
const { chromium } = await import('playwright').catch(() => import('playwright-core'));
import { resolve, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)]; }));
const out = args.find((a) => !a.startsWith('--')) || '.local/relshots'; mkdirSync(out, { recursive: true });
const W = +(opt.w || 1600), H = +(opt.h || 900), Q = opt.q ?? '3';
const glArgs = opt.gpu ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
// js:<code> as the 5th field: run in the page after the wait (camera placement via the dev hook), then wait 2.5 s
const at = (x, y, mode, yaw, pitch, extra = '') => `js:const g=window.__l3dGame;g.ui?.setHudVisible?.(false);g.player.teleport(${x},${y});g.rig.setMode('${mode}',{instant:true});g.rig.yaw=${yaw};g.rig.pitch=${pitch};${extra}`;
const SHOTS = opt.set === '060' ? [
  ['game', 'hwc=off&bots=6', 'city-spawn', 14000, at(2460, 1010, 'tp', 0, -0.12)],
  ['game', 'hwc=off&bots=6', 'city-lower', 14000, at(1400, 1480, 'tp', 0.2, -0.02)],
  ['game', 'hwc=off&bots=4', 'city-shopfront', 14000, at(4700, 990, 'tp', 0.1, -0.2)],
  ['game', 'hwc=off&bots=0', 'city-canal', 14000, at(2200, 1460, 'tp', 2.7, -0.3)],
  ['game', 'bots=6', 'halloween-spawn', 14000, at(2460, 1010, 'tp', 0.35, -0.08)],
  ['game', 'hwc=off&bots=0', 'forge', 14000, "js:const g=window.__l3dGame;g.rig.setMode('tp',{instant:true});g.rooms.enter('forge');setTimeout(()=>{g.rig.pitch=-0.08},3000)"],
  ['game', 'hwc=off&bots=0', 'shop', 14000, "js:const g=window.__l3dGame;g.rig.setMode('tp',{instant:true});g.rooms.enter('shop');setTimeout(()=>{g.rig.pitch=-0.08},3000)"],
  ['mine', 'bots=3&tp=1', 'mine-classic', 12000, 'clean'],
  ['mine', 'f=v3&dig=20&bots=3', 'mine3-tunnel', 12000, 'clean'],
  ['mine', 'f=v3&bots=3&tp=1', 'mine3-hall', 12000, 'clean'],
  ['expedition', 'demo=battle&ter=' + encodeURIComponent('Пустыня'), 'exp-desert', 9000, 'clean'],
  ['expedition', 'demo=boss&ter=' + encodeURIComponent('Курган'), 'exp-boss', 9000, 'clean'],
  ['expedition', 'demo=travel&ter=' + encodeURIComponent('Водопад'), 'exp-falls', 9000, 'clean'],
  ['expedition', 'demo=travel&ter=' + encodeURIComponent('Лес'), 'exp-forest', 9000, 'clean'],
] : opt.set === '053' ? [
  ['mine', 'f=v3&dig=20&bots=0', 'mine3-tunnel', 10000, 'clean'],
  ['mine', 'f=v3&bots=0&tp=1', 'mine3-hall', 10000, 'clean'],
] : opt.set === '052' ? [
  ['game', 'town=village&bots=6', 'village', 12000, 'F2'],
  ['game', 'style=cherts&bots=6', 'cherts-quarter', 12000, 'F2'],
  ['game', 'town=village&style=cherts&bots=6', 'cherts-village', 12000, 'F2'],
] : opt.set === '051' ? [
  ['expedition', 'hud=battle&qa=1', 'quest-buttons', 8000],
  ['expedition', 'hud=skeldance&qa=1', 'quest-dance', 8000],
  ['mine', 'dig=20&bots=0&chatmod=own', 'mine-chatmod', 9000],
] : [
  ['expedition', 'demo=gob-shell', 'gob-shell', 8000],
  ['expedition', 'demo=hw-skeldance-show', 'skeldance', 9000],
  ['expedition', 'demo=hw-cauldron', 'cauldron', 8000],
  ['expedition', 'demo=hw-lostghost', 'lostghost', 8000],
  ['mine', 'dig=20&econ=1&bots=0', 'mine-sign', 9000],
];
const ctx = opt.profile ? await chromium.launchPersistentContext(opt.profile, { headless: true, executablePath: process.env.CHROMIUM || undefined, args: glArgs, viewport: { width: W, height: H } })
  : await chromium.launchPersistentContext('', { headless: true, executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox', ...glArgs], viewport: { width: W, height: H } });
const p = ctx.pages()[0] || await ctx.newPage();
await p.addInitScript((q) => { try { localStorage.setItem('l3d.quality', JSON.stringify(q)); localStorage.setItem('l3d.whatsnew.seen', '"9.9.9"'); } catch {} }, Q === '3' ? 'q3' : 'q' + Q);
for (const [page, q, name, ms, key] of SHOTS) {
  try {
    await p.goto('file://' + resolve(`dist-dev/${page}.html`) + `?${q}&nodbg=1&q=${Q}`);
    await p.waitForTimeout(ms);
    if (key === 'clean') {   // close one-time cards, hide the dev overlay + the «Что нового» note
      await p.keyboard.press('Escape'); await p.waitForTimeout(300); await p.keyboard.press('Escape');
      await p.evaluate(() => { const d = document.getElementById('dbg'); if (d) d.style.display = 'none'; for (const b of document.querySelectorAll('button')) if (/Понятно/.test(b.textContent || '')) b.click(); });
      await p.waitForTimeout(800);
    } else if (key && key.startsWith('js:')) {
      await p.evaluate((c) => (0, eval)(c), key.slice(3)); await p.waitForTimeout(4500);
    } else if (key) { await p.keyboard.press(key); await p.waitForTimeout(600); }
    if (opt.hide) {   // canvas only: no HUD, badges, cards or dev overlays
      await p.evaluate(() => { const c = document.querySelector('canvas'); const keep = new Set(); for (let e = c; e; e = e.parentElement) keep.add(e); for (const x of document.querySelectorAll('body *')) if (!keep.has(x) && !x.closest('canvas')) x.style.setProperty('display', 'none', 'important'); });
      await p.waitForTimeout(500);
    }
    const f = join(out, name + '.png'); await p.screenshot({ path: f, timeout: 60000 });
    try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', f, '-q:v', '2', f.replace(/\.png$/, '.jpg')]); } catch { /* no ffmpeg */ }
    console.log(f);
  } catch (e) { console.log('fail', name, String(e).slice(0, 200)); }
}
await ctx.close();
