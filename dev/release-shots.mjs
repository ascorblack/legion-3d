// RTX release shots of expedition stages (and other dev pages) — run on the GPU box:
//   node dev/release-shots.mjs <outDir> --gpu --w=2560 --h=1440 --profile=<persistent dir> [--q=3]
// Shots: [page, query, name, waitMs, js|'clean'|key, keyAfter]. HUD of the dev page stays (it is the game's own expedition HUD).
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
const SHOTS = opt.set === '078' ? [
  // 0.7.8 (site 11.11): an own stone dug → the loot toast «Выкопан: … +N руды» (me.lg / dug view), then the next stone's sign
  // «получишь: …» (LGMineShares projection) and the «Сейчас» line; run with --w=960 --h=540 for the review shot
  ['mine', 'dig=2&bots=0&econ=1', 'mine-loot-toast', 9000, 'js:const m=window.__mine,F=m.fake;F.st.bl={};F.st.dg={};m.client.model.st.bl={};m.client.model.st.dg={};for(const b of document.querySelectorAll("[data-a=\\"coach-x\\"]"))b.click();const d=document.getElementById("dbg");if(d)d.style.display="none";const off=m.client.on((e)=>{if(e.type==="burst"&&e.bursts.some((b)=>b.mine)){off();m.goNear(2,1.2);m.look(m.rig.yaw,0.02);}});m.digNear(0);'],
] : opt.set === '073' ? [
  // 0.7.3: the 07.11 boss arena — wings (Левое крыло / Центр / Правое крыло, need / got) with hunters, and a net over a platform; the quest HUD card
  ['expedition', 'demo=boss-wings&hud=battle', 'boss-wings', 9000],
  ['expedition', 'demo=boss-nets&hud=battle', 'boss-nets', 9000],
] : opt.set === '076' ? [
  // 0.7.6: fishing at the cats fair pond (E «Рыбачить · забросов 7 из 10»), the grouped pause menu (Герой / Город и сайт / Система) with the site's new entries, guild tags «[TAG]»
  ['game', 'fc=1&magic=1&bots=0&hwc=off&tod=12:00&fish=1', 'fishing-pier', 12000, 'js:const g=window.__l3dGame;g.player.teleport(640,2410);g.rig.setMode("tp",{instant:true});g.rig.yaw=2.2;g.rig.pitch=-0.25;g.rig.dist=5;'],
  ['game', 'fc=1&magic=1&bots=0&hwc=off&tod=12:00&gu=1', 'pause-menu', 12000, 'js:const g=window.__l3dGame;g.player.teleport(2880,2350);g.rig.setMode("tp",{instant:true});g.rig.yaw=0.25;g.rig.pitch=-0.3;g.rig.dist=14;', 'Escape'],
  ['game', 'fc=1&magic=1&bots=7&hwc=off&tod=12:00&gt=1', 'guild-tags', 12000, `js:const g=window.__l3dGame,d=window.__demo;g.player.teleport(2880,2350);d.bots.forEach((b,i)=>{const a=(i-3)/3*1.1,[x,y]=d.store.layout.nearest(2880+Math.sin(a)*190,2350-90-Math.cos(a)*45-(i%2)*45);b.x=x;b.y=y;b.path=null;b.wait=9999;b.speed=0;b.face=Math.PI;});g.rig.setMode("tp",{instant:true});g.rig.yaw=0;g.rig.pitch=-0.1;g.rig.dist=3.2;`],
] : opt.set === '075' ? [
  // 0.7.5: coin shops — the 3D shop card with the quantity control (−/+), a Будуар sample «Примерить и купить … — N монет»
  ['rooms', 'room=shop&money=5000&bq=10&aim=3&card=1&ask=1', 'shop-card-qty', 9000, `js:for(let i=0;i<2;i++)document.querySelector('.l3d-roomcard').shadowRoot.querySelector('[data-q="1"]').click()`],
  ['rooms', 'room=tent&money=5000&aim=1', 'boudoir-prompt', 9000],
  ['rooms', 'room=tent&money=5000&aim=1&card=1', 'boudoir-card', 9000],
] : opt.set === '071' ? [
  ['game', 'fc=1&magic=1&bots=4&hwc=off&tod=12:00', 'roofs-hall', 14000, at(2880, 1700, 'tp', 0, -0.32, 'g.rig.dist=20;')],
  ['game', 'fc=1&magic=1&bots=4&hwc=off&tod=15:40', 'roofs-street', 14000, at(2880, 2350, 'tp', 0.25, -0.35, 'g.rig.dist=22;')],
] : opt.set === '070' ? [
  ['game', 'fc=1&magic=1&bots=6&hwc=off&tod=12:00', 'fair-day', 14000, at(2880, 2350, 'tp', 0.25, -0.35, 'g.rig.dist=22;')],
  ['game', 'fc=1&magic=1&bots=6&hwc=off&tod=16:15', 'fair-sunset', 14000, at(2880, 2700, 'tp', 0, -0.12)],
  ['game', 'fc=1&magic=1&bots=6&hwc=off&tod=23:00', 'fair-night', 14000, at(2880, 2350, 'tp', 0.25, -0.35, 'g.rig.dist=22;')],
  ['game', 'fc=1&magic=1&bots=4&hwc=off&tod=12:00', 'stairs-magic', 14000, at(3606, 1500, 'tp', 0.6, -0.1)],
  ['game', 'fc=1&magic=1&bots=2&hwc=off&tod=12:00&jail=1', 'jail', 14000, "js:const g=window.__l3dGame;g.ui?.setHudVisible?.(false);const b=g.layout.buildings.find(b=>b.id==='jail');g.player.teleport(b.door.x,b.door.y+260);g.rig.setMode('tp',{instant:true});g.rig.yaw=0;g.rig.pitch=-0.15;"],
] : opt.set === '067' ? [
  ['game', 'fc=1&magic=1&bots=6&hwc=off', 'fc-gate', 14000, at(2880, 2700, 'tp', 0, -0.12)],
  ['game', 'fc=1&magic=1&bots=6&hwc=off', 'fc-plaza', 14000, at(2880, 2350, 'tp', 0.25, -0.5, 'g.rig.dist=24;')],
  ['game', 'fc=1&magic=1&bots=4&hwc=off', 'fc-stairs-hall', 14000, at(3606, 1500, 'tp', 0.6, -0.1)],
] : opt.set === '064' ? [
  ['expedition', 'demo=travel&ter=' + encodeURIComponent('Тыквенное поле'), 'pumpkin', 9000, 'clean'],
  ['expedition', 'demo=travel&ter=' + encodeURIComponent('Кладбище'), 'graveyard', 9000, 'clean'],
  ['expedition', 'demo=travel&ter=' + encodeURIComponent('Мельница'), 'mill', 9000, 'clean'],
] : opt.set === '060' ? [
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
for (const [page, q, name, ms, key, after] of SHOTS) {
  if (opt.only && !opt.only.split(',').includes(name)) continue;
  try {
    await p.goto('file://' + resolve(`dist-dev/${page}.html`) + `?${q}&nodbg=1&q=${Q}`);
    await p.waitForTimeout(ms);
    await p.evaluate(() => {   // close the «Что нового» card (it sits in the body or in the game's shadow root)
      const roots = [document, ...[...document.querySelectorAll('*')].map((e) => e.shadowRoot).filter(Boolean)];
      for (const r of roots) for (const b of r.querySelectorAll('button[aria-label="Закрыть"]')) if (/Что нового/.test(b.parentElement?.textContent || '')) b.click();
    });
    await p.waitForTimeout(400);
    if (key === 'clean') {   // close one-time cards, hide the dev overlay + the «Что нового» note
      await p.keyboard.press('Escape'); await p.waitForTimeout(300); await p.keyboard.press('Escape');
      await p.evaluate(() => { const d = document.getElementById('dbg'); if (d) d.style.display = 'none'; for (const b of document.querySelectorAll('button')) if (/Понятно/.test(b.textContent || '')) b.click(); });
      await p.waitForTimeout(800);
    } else if (key && key.startsWith('js:')) {
      await p.evaluate((c) => (0, eval)(c), key.slice(3)); await p.waitForTimeout(4500);
    } else if (key) { await p.keyboard.press(key); await p.waitForTimeout(600); }
    if (after) { await p.keyboard.press(after); await p.waitForTimeout(1200); }   // e.g. Esc: the pause menu over the placed camera
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
