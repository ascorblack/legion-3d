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
const SHOTS = opt.set === '051' ? [
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
for (const [page, q, name, ms] of SHOTS) {
  try {
    await p.goto('file://' + resolve(`dist-dev/${page}.html`) + `?${q}&nodbg=1&q=${Q}`);
    await p.waitForTimeout(ms);
    const f = join(out, name + '.png'); await p.screenshot({ path: f, timeout: 60000 });
    try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', f, '-q:v', '2', f.replace(/\.png$/, '.jpg')]); } catch { /* no ffmpeg */ }
    console.log(f);
  } catch (e) { console.log('fail', name, String(e).slice(0, 200)); }
}
await ctx.close();
