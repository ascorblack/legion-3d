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
// --gpu = the Windows GPU box (d3d11); --gpu=native: Chromium's own choice (a Linux box with a GPU draws WebGL on it by itself)
const glArgs = opt.gpu === 'native' ? [] : opt.gpu ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
// js:<code> as the 5th field: run in the page after the wait (camera placement via the dev hook), then wait 2.5 s
const at = (x, y, mode, yaw, pitch, extra = '') => `js:const g=window.__l3dGame;g.ui?.setHudVisible?.(false);g.player.teleport(${x},${y});g.ctx?.uiHost?.setCameraMode?.('${mode}');g.rig.setMode('${mode}',{instant:true});g.rig.yaw=${yaw};g.rig.pitch=${pitch};${extra}`;
// the longest boom, no camera colliders (a framing over walls / towers), a field of view, interaction off
// the hero and every name tag out of the frame (a view of the place), interaction outline off
const HIDE = 'g.meAv.root.visible=false;g.labels.root.visible=false;g.interact.setEnabled(false);setTimeout(()=>{g.meAv.root.visible=false;},1500);';
const FPV = (fov) => `g.vm.root.visible=false;g.labels.root.visible=false;g.interact.setEnabled(false);g.rig.fov=${fov};setTimeout(()=>{g.vm.root.visible=false;g.labels.root.visible=false;},1500);`;
const CAMX = (fov) => `g.rig.zoom(10);g.rig.setColliders([]);g.rig.setColliderBoxes([]);g.rig.fov=${fov};g.interact.setEnabled(false);`;
const SHOTS = opt.set === '083' ? [
  // 0.8.3 (site 15.11): a guild invite (site-chat.js ginvShow `#cy-ginv`, z 70) is lifted over the 3D below the compass; its focus
  // grab of «Принять» is undone (src/engine/input.ts FOCUS_GRAB_SEL). The plaque is the site's markup + city.css rules; html.l3d-on as on the live page. No --hide.
  ['game', 'fc=1&magic=1&bots=0&hwc=off&tod=12:00', 'guild-invite', 14000, 'js:const g=window.__l3dGame;g.player.teleport(2880,2350);g.rig.setMode("tp",{instant:true});g.rig.yaw=0;g.rig.pitch=-0.2;g.rig.dist=6;document.documentElement.classList.add("l3d-on");const st=document.createElement("style");st.textContent=".cy-ginv{position:fixed;z-index:70;left:50%;top:12px;transform:translateX(-50%);width:min(380px,calc(100vw - 16px));box-sizing:border-box;padding:10px 12px;border-radius:12px;background:rgba(15,12,34,.97);box-shadow:0 8px 24px rgba(0,0,0,.45);border:1px solid rgba(255,210,120,.45);font:600 14px/1.3 system-ui;color:#fff}.cy-ginv p{margin:0 0 8px}.cy-ginv p small{opacity:.7}.cy-ginv .cy-ginv-e{margin:0}.cy-ginv div{display:flex;gap:6px}.cy-ginv button{min-height:36px;padding:0 14px;border:0;border-radius:8px;background:#c81e17;color:#fff;font:inherit}.cy-ginv button.ghost{background:rgba(255,255,255,.14)}.cy-ginv button.x{margin-left:auto;padding:0 10px;background:transparent;font-size:18px}";document.head.appendChild(st);setTimeout(()=>{const el=document.createElement("div");el.id="cy-ginv";el.className="cy-ginv";el.setAttribute("role","alertdialog");el.innerHTML="<p>Гильдия <b>[КОТ] Пушистый дозор</b> приглашает тебя <small>(Мурзик)</small></p><p class=\'cy-ginv-e\' role=\'status\'></p><div><button type=\'button\' data-gi=\'join\'>Принять</button><button type=\'button\' data-gi=\'refuse\' class=\'ghost\'>Отклонить</button><button type=\'button\' data-gi=\'x\' class=\'x\' aria-label=\'Закрыть\'>×</button></div>";document.body.appendChild(el);el.querySelector("button").focus({preventScroll:true});setTimeout(()=>{window.__ginvFocus=document.activeElement&&document.activeElement.closest&&document.activeElement.closest("#cy-ginv")?"plaque":"game";},300);},1500);'],
] : opt.set === '082' ? [
  // 0.8.2 (site 14.11): enchant materials are no longer sold — the forge's star / sphere read «не продаётся» and their card
  // says where they are found (only «Понятно», nothing is sent); the rows' counter carries potions only. The HUD: a new
  // announcement while the site's ticker runs it (window.LGAnnTick, hero `ak`) and the maintenance-pause countdown (`pz`).
  // Run WITHOUT --hide (the card and the HUD lines are the subject); 960×540 for the review.
  ['rooms', 'room=forge&ms=0&aim=23', 'forge-mats', 6000],
  ['rooms', 'room=forge&ms=0&aim=23&card=1', 'forge-mat-card', 6000],
  ['rooms', 'room=shop&ms=0&cam=0.3,1.55,1.0&look=0,0.9,-1.9', 'rows-counter', 6000],
  ['game', 'fc=1&magic=1&bots=0&hwc=off&tod=12:00', 'hud-ticker-pause', 14000, 'js:const g=window.__l3dGame;g.player.teleport(2880,2350);g.rig.setMode("tp",{instant:true});g.rig.yaw=0;g.rig.pitch=-0.2;g.rig.dist=6;window.LGAnnTick={held:()=>false,event(){},queue:()=>[],now:()=>({p:"d1",t:"Сегодня в 20:00 — турнир на арене!\\nПриходите всей гильдией",g:false})};window.__L3D_BUS.emit("sse:pz",{on:false,warnAt:Date.now()+45000});'],
] : opt.set === '081' ? [
  // 0.8.1 (site 13.11): the Town Kit town «Рябиново» (?tk=d04 = test/fixtures/townkit-d04.json from /site/towns/d04.js): the wooden
  // palisade with watchtowers, the rowans (the big one with its bench), berry racks and beehives, the glade beyond the gate.
  // First person with the weapon and every name tag hidden (FPV): views of the town. g.rig.yaw: forward = (−sin yaw, −cos yaw)
  // in (x, z) — 0 north, π/2 west, π south. Run with --hide.
  ['game', 'tk=d04&magic=1&bots=0&hwc=off&tod=12:00', 'tk-rowan', 15000, at(3050, 2280, 'fp', 0.42, 0.12, FPV(68))],
  ['game', 'tk=d04&magic=1&bots=0&hwc=off&tod=12:00', 'tk-tower', 15000, at(2700, 2700, 'fp', 3.68, 0.18, FPV(68))],
  ['game', 'tk=d04&magic=1&bots=0&hwc=off&tod=12:00', 'tk-tower-w', 15000, at(1250, 2800, 'fp', 2.47, 0.16, FPV(68))],
  ['game', 'tk=d04&magic=1&bots=0&hwc=off&tod=12:00', 'tk-hives', 15000, at(2660, 720, 'fp', 0, -0.35, FPV(58))],
  ['game', 'tk=d04&magic=1&bots=0&hwc=off&tod=12:00', 'tk-racks', 15000, at(2560, 2110, 'fp', 0, -0.08, FPV(66))],
  ['game', 'tk=d04&magic=1&bots=0&hwc=off&tod=12:00', 'tk-glade', 15000, at(2000, 3380, 'tp', 0, -0.35, HIDE + CAMX(70) + 'g.labels.root.visible=false;')],
] : opt.set === '080' ? [
  ['game', 'fc=1&magic=1&bots=0&hwc=off&tod=12:00&cm=1', 'glade-in', 16000, at(2810, 3330, 'tp', 0, -0.25, 'g.rig.dist=9;g.interact.setEnabled(false);')],
  ['game', 'fc=1&magic=1&bots=0&hwc=off&tod=12:00&cm=1', 'glade-in2', 16000, at(2700, 3300, 'tp', 0.0, -0.2, 'g.rig.dist=7;g.interact.setEnabled(false);')],
  // 0.8.0 (site 12.11 afternoon): «Монстры у стен» (?cm=1 = the live 12.11 view) in the glade beyond the gate, from the gate
  // passage in third person (boom at its longest, the camera colliders off so it rises over the gate towers; interaction off);
  // a beaten pack in the dead pose; the north forest packs from the town edge; the redrawn «Здание гильдий». Run with --hide.
  ['game', 'fc=1&magic=1&bots=0&hwc=off&tod=12:00&cm=1', 'glade-gate', 16000, at(2930, 2990, 'tp', 2.84, -1.15, CAMX(58))],
  ['game', 'fc=1&magic=1&bots=0&hwc=off&tod=12:00&cm=1', 'glade-dead', 16000, at(2930, 2990, 'tp', 2.84, -1.15, CAMX(58) + 'setTimeout(()=>{window.__demo.cmBeat("p0");g.citymon.poll();},3300);')],
  ['game', 'fc=1&magic=1&bots=0&hwc=off&tod=12:00&cm=1', 'forest-north', 16000, at(1300, 950, 'tp', 0.2, -0.22, 'g.rig.fov=62;g.interact.setEnabled(false);')],
  ['game', 'fc=1&magic=1&bots=0&hwc=off&tod=15:40', 'guild-day', 14000, at(3600, 2610, 'tp', -0.05, 0.2, 'g.rig.zoom(-1);g.rig.fov=82;g.interact.setEnabled(false);')],
  ['game', 'fc=1&magic=1&bots=0&hwc=off&tod=15:40', 'guild-wide', 14000, at(3600, 2600, 'tp', -0.05, 0.08, 'g.rig.fov=80;g.interact.setEnabled(false);')],
] : opt.set === '079' ? [
  // 0.7.9 (site 12.11): the cats fair's new «Здание гильдий» (the agent's wide framing; interaction outline off); run with --hide.
  ['game', 'fc=1&magic=1&bots=0&hwc=off&tod=15:40', 'guild-day', 14000, at(3600, 2600, 'tp', -0.05, -0.55, 'g.rig.dist=6;g.interact.setEnabled(false);')],
  ['game', 'fc=1&magic=1&bots=0&hwc=off&tod=23:00', 'guild-night', 14000, at(3600, 2600, 'tp', -0.05, -0.55, 'g.rig.dist=6;g.interact.setEnabled(false);')],
] : opt.set === '078' ? [
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
