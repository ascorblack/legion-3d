// Headless smoke check of the debug mode in the offline demo (dist-dev/game.html), exit code 0 = all good:
//   npm run build && CHROMIUM=/usr/bin/google-chrome node dev/debug-check.mjs
// - off by default: no F10 binding, no panel element;  - on: F10 opens the panel, F10 / Esc close it (modal stack);
// - the test dimension: enter → walk → every section builds → exit = the same city point / facing, and no go() sent
//   meanwhile (the demo site's moveTo is instrumented like the real go sender: pauseMoves drops points);
// - every expedition mock opens in the 3D view with the expected scene kind; auto-play advances; a shop portal opens.
const { chromium } = await import('playwright').catch(() => import('playwright-core'));
import { resolve } from 'node:path';

const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.addInitScript({ content: "try { localStorage.setItem('l3d.whatsnew.enabled', '0'); localStorage.setItem('l3d.quality', '0'); } catch (e) {}" });
const fails = [];
const ok = (cond, what) => { console.log((cond ? 'ok   ' : 'FAIL ') + what); if (!cond) fails.push(what); };
const url = 'file://' + resolve('dist-dev/game.html') + '?bots=2';
await p.goto(url);
await p.waitForFunction(() => !!window.__l3dGame, null, { timeout: 120000 });
await p.waitForTimeout(2000);
let r = await p.evaluate(() => ({ key: !!window.__l3dGame.registries.keys.get('debug.panel'), el: !!document.getElementById('l3d-debug'), dm: !!window.__l3dGame.ctx.dev.debugMode }));
ok(!r.key && !r.el && !r.dm, 'debug mode off by default: nothing registered, no DOM');

await p.goto(url + '&debug=1');
await p.waitForFunction(() => !!window.__l3dGame?.ctx?.dev?.debugMode, null, { timeout: 120000 });
await p.waitForTimeout(2000);
await p.mouse.click(640, 360);
await p.keyboard.press('F10'); await p.waitForTimeout(300);
r = await p.evaluate(() => { const d = window.__l3dGame.ctx.dev.debugMode; return { open: d.panelOpen, vis: !document.getElementById('l3d-debug').shadowRoot.querySelector('.win').hidden, modal: window.__l3dGame.ctx.input.modals?.includes('debug-panel') }; });
ok(r.open && r.vis && r.modal, 'F10 opens the panel (modal: gameplay off, free cursor)');
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
r = await p.evaluate(() => ({ open: window.__l3dGame.ctx.dev.debugMode.panelOpen, modal: window.__l3dGame.ctx.input.modals?.includes('debug-panel') }));
ok(!r.open && !r.modal, 'Esc closes the panel');
await p.keyboard.press('F10'); await p.waitForTimeout(200);
const tabs = await p.evaluate(async () => { const d = window.__l3dGame.ctx.dev.debugMode, out = []; for (const t of ['dim', 'scenes', 'world', 'over', 'site', 'bus']) { d.panel.setTab(t); out.push([t, d.panel.root.querySelector('.body').textContent.length]); } return out; });
ok(tabs.every(([, n]) => n > 40), 'every tab renders: ' + tabs.map((x) => x.join('=')).join(' '));
await p.keyboard.press('F10'); await p.waitForTimeout(200);
ok(!(await p.evaluate(() => window.__l3dGame.ctx.dev.debugMode.panelOpen)), 'F10 again closes it');

// instrument the demo site like the real go sender
await p.evaluate(() => {
  const g = window.__l3dGame, s = g.site; window.__go = { paused: false, sent: 0 };
  s.pauseMoves = (on) => { window.__go.paused = on; };
  const mv = s.moveTo.bind(s); s.moveTo = (x, y) => { if (!window.__go.paused) window.__go.sent++; mv(x, y); };
});
const before = await p.evaluate(() => { const g = window.__l3dGame; return { x: g.player.x, y: g.player.y, yaw: g.rig.yaw }; });
await p.evaluate(() => { window.__go.sent = 0; window.__l3dGame.ctx.dev.debugMode.enterDimension(); });
await p.waitForTimeout(500);
await p.mouse.click(640, 360);
await p.keyboard.down('KeyW'); await p.waitForTimeout(1500); await p.keyboard.up('KeyW');
const secs = await p.evaluate(async () => {
  const d = window.__l3dGame.ctx.dev.debugMode;
  for (const s of d.dim.sectionList()) { d.goSection(s.id); await new Promise((r) => setTimeout(r, 700)); }
  return { ...d.dim.stats, inside: d.inside };
});
ok(secs.inside && secs.built === secs.sections, `dimension: all ${secs.sections} sections built lazily (${JSON.stringify(secs)})`);
ok(secs.items >= 99 && secs.looks >= 50 && secs.foes >= 25 && secs.npcs >= 10 && secs.portals >= 10, 'dimension has every item, look, foe, NPC and portal');
const target = await p.evaluate(async () => { const g = window.__l3dGame, d = g.ctx.dev.debugMode; d.goSection('items-weapon'); const it = d.dim.hitList.find((i) => i.id === 'debug:item:weapon:axe'); const cx = (it.hit.min.x + it.hit.max.x) / 2; g.ctx.controller().teleport(cx, -0.1); g.rig.yaw = 0; g.rig.pitch = -0.22; await new Promise((r) => setTimeout(r, 900)); const t = window.__l3dGame.interact.target; if (t) t.use('key'); return { label: t?.label || null, card: d.panel?.cardShown }; });
ok(!!target.label && target.card, 'aim + E on a stand shows the item card: ' + target.label);
// a shop through its portal (demo stock, stub actions)
const shop = await p.evaluate(async () => {
  const d = window.__l3dGame.ctx.dev.debugMode; const pt = d.portals().find((x) => x.id === 'forge'); pt.go();
  for (let i = 0; i < 60 && !d.sub; i++) await new Promise((r) => setTimeout(r, 200));
  const inShop = d.where() === 'room';
  const r = await window.__l3dGame.ctx.actions.get('/api/city/stock').catch(() => null);
  d.backToDim(); return { inShop, back: d.where() };
});
ok(shop.inShop && shop.back === 'dim', 'forge portal opens the 3D forge (demo) and comes back to the dimension');
const exit = await p.evaluate(() => { const g = window.__l3dGame, d = g.ctx.dev.debugMode; d.exitAll(); return { x: g.player.x, y: g.player.y, yaw: g.rig.yaw, inRoom: g.ctx.state.inRoom, world: g.world.root.visible, sent: window.__go.sent, paused: window.__go.paused }; });
ok(!exit.inRoom && exit.world, 'exit: back in the city space');
await p.mouse.click(640, 360); await p.waitForTimeout(300);
ok(Math.abs(exit.x - before.x) < 1 && Math.abs(exit.y - before.y) < 1 && Math.abs(exit.yaw - before.yaw) < 1e-6, `exit: same point and facing (${before.x},${before.y}) → (${exit.x},${exit.y})`);
ok(exit.sent === 0 && !exit.paused, `no go() while away (sent ${exit.sent}), moves resumed`);
await p.keyboard.down('KeyW'); await p.waitForTimeout(1200); await p.keyboard.up('KeyW');
ok((await p.evaluate(() => window.__go.sent)) > 0, 'after exit, walking sends go() again (instrumentation works)');

// expedition mocks: every one opens with the expected scene kind
const mocks = await p.evaluate(async () => {
  const d = window.__l3dGame.ctx.dev.debugMode; const { QUEST_MOCKS } = window.__l3dDebugMocks || {}; const list = QUEST_MOCKS || [];
  const bad = [];
  for (const m of list) { d.playMock(m.id); await new Promise((r) => setTimeout(r, 450)); const k = d.scenes.status().kind; if (k !== m.expect) bad.push(m.id + ':' + k); }
  d.playAuto(0); d.scenes.speed = 4; await new Promise((r) => setTimeout(r, 2500)); const plan = d.scenes.planSec;
  d.closeScene(true);
  return { n: list.length, bad, plan, inRoom: window.__l3dGame.ctx.state.inRoom };
});
ok(mocks.n >= 40 && mocks.bad.length === 0, `all ${mocks.n} expedition mocks show their scene` + (mocks.bad.length ? ' — bad: ' + mocks.bad.join(', ') : ''));
ok(mocks.plan > 1, 'auto-play advances (' + mocks.plan.toFixed(1) + ' s)');
ok(!mocks.inRoom, 'closing the scene returns to the city');
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await b.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL OK');
process.exit(fails.length ? 1 : 0);
