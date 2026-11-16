// Live check of the site adapter against the real site.
// L3D_COOKIES=<netscape cookies.txt> node e2e/live-probe.mjs [url] [seconds]
// Injects dist/bridge.js at document_start and dist-dev/net-probe.js after load. Never prints cookie values.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const url = process.argv[2] || process.env.L3D_URL || 'https://legiongame.gg/c/zakvielchannel/';
const secs = +(process.argv[3] || 20);
const cookies = readFileSync(process.env.L3D_COOKIES, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => {
  const [domain, , path, secure, exp, name, value] = l.split('\t');
  return { domain, path, secure: secure === 'TRUE', expires: +exp, name, value: value.trim(), httpOnly: true };
});
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const c = await b.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true });
await c.addCookies(cookies);
const p = await c.newPage();
p.on('console', (m) => { const t = m.text(); if (t.startsWith('[probe]') || m.type() === 'error') console.log(t.slice(0, 1500)); });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.addInitScript({ content: readFileSync('dist/bridge.js', 'utf8') });
await p.goto(url, { waitUntil: 'load' });
await p.evaluate(readFileSync('dist-dev/net-probe.js', 'utf8'));
await p.waitForTimeout(secs * 1000);
if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
await b.close();
