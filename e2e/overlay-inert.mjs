// Closed overlays must be inert: after closing a menu / panel the 3D canvas is what a click hits, at once (not after a CSS fade),
// even when transitions are frozen (slow WebGL frames). Usage: CHROMIUM=/usr/bin/google-chrome node e2e/overlay-inert.mjs [--keys=KeyM,KeyL,...] [--headed]
// Needs dist-dev/game.html (npm run build). Exit 1 = a closed overlay is still hit-testable or the canvas click did not lock.
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { hitGridSource } from './hit-grid.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => argv.find((x) => x.startsWith('--' + n + '='))?.slice(n.length + 3) ?? d;
const KEYS = opt('keys', 'KeyM,KeyL,KeyC,KeyI,KeyP,KeyZ,F10,F9').split(',');
const html = resolve('dist-dev/game.html');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/google-chrome', headless: !argv.includes('--headed'),
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => { try { localStorage.setItem('l3d.debug', 'on'); localStorage.setItem('l3d.whatsnew.enabled', '0'); } catch { /* */ } });   // F10 needs the debug flag
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + html + '?');
await page.waitForFunction(() => !!window.__l3dGame, null, { timeout: 400000 });
await page.waitForTimeout(4000);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Animation.enable');
await page.evaluate(hitGridSource);   // defines window.__hitGrid(): [{x,y,sig}] deep hit signature per grid point

const failures = [];
const locked = () => page.evaluate(() => !!document.pointerLockElement);
const canvasBox = () => page.locator('#l3d-host canvas').boundingBox();
async function clickUntilLocked(tries, firstWait) {
  for (let attempt = 0; attempt < tries; attempt++) {
    await page.waitForTimeout(attempt ? 600 : firstWait);
    const bb = await canvasBox();
    await page.mouse.click(bb.x + bb.width * 0.5, bb.y + bb.height * 0.5);
    const t0 = Date.now();
    while (Date.now() - t0 < 1000) { if (await locked()) return Date.now() - t0; await page.waitForTimeout(40); }
  }
  return -1;
}

const menuId = () => page.evaluate(() => window.__l3dGame.ctx?.state?.menu ?? null);
// known state: no menu, cursor free (Esc from a lock opens Pause by design, so close whatever is open until nothing is)
async function reset() {
  for (let i = 0; i < 6; i++) {
    if (await locked()) { await page.evaluate(() => document.exitPointerLock()); await page.waitForTimeout(250); }
    if (!(await menuId())) { await page.waitForTimeout(250); if (!(await menuId())) return; }
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  }
}

for (const key of KEYS) {
  await reset();
  await page.waitForTimeout(500);   // let the previous fade finish: the baseline is the settled closed state
  const base = await page.evaluate(() => window.__hitGrid());
  const hold = key === 'KeyZ';
  if (hold) await page.keyboard.down(key); else await page.keyboard.press(key);
  await page.waitForTimeout(700);
  const opened = await page.evaluate(() => window.__hitGrid().filter((h) => h.sig !== 'CANVAS').length);
  // freeze every CSS transition/animation (playback rate ~0) = the worst case of a slow frame, then close
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.0001 });
  if (hold) await page.keyboard.up(key); else await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  const frozen = await page.evaluate(() => window.__hitGrid());
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
  const stale = frozen.map((h, i) => ({ ...h, was: base[i].sig })).filter((h) => h.sig !== h.was);
  // the first click after closing must land on the canvas and take the lock (Chrome's own re-lock cooldown is ~1.25 s)
  const lockMs = await clickUntilLocked(3, 1400);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.__hitGrid());
  const stale2 = after.map((h, i) => ({ ...h, was: base[i].sig })).filter((h) => h.sig !== h.was);
  console.log(JSON.stringify({ key, openedNonCanvasPoints: opened, staleAfterClose: stale.length, staleSettled: stale2.length, lockMs, sample: stale.slice(0, 2) }));
  if (stale.length || stale2.length) failures.push({ key, why: 'closed overlay still hit-testable', stale: stale.slice(0, 4), stale2: stale2.slice(0, 4) });
  if (lockMs < 0) failures.push({ key, why: 'canvas click did not lock within 1 s (3 tries)' });
}
if (errors.length) console.log('pageerrors', errors.slice(0, 5));
await browser.close();
if (failures.length) { console.log('FAIL ' + JSON.stringify(failures)); process.exit(1); }
console.log('OK every closed overlay is inert and the canvas click relocks');
