// Offline Firefox integration test: install the actual extension, then exercise the fixture demo.
// Requires geckodriver on PATH (or GECKODRIVER) and Firefox (FIREFOX or Playwright's downloaded binary).
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import { createServer as netServer } from 'node:net';
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, extname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { firefox } from 'playwright';

const out = resolve(process.env.L3D_TEST_OUT || 'e2e/.artifacts/firefox');
mkdirSync(out, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), 'l3d-firefox-'));
const manifest = JSON.parse(readFileSync('dist-firefox/manifest.json', 'utf8'));
// The GitHub zip is what gets signed and shipped (.xpi); the store zip has the GitHub update check stripped.
const archive = resolve(`legion-3d-${manifest.version}-firefox.zip`);
const storeZip = resolve(`legion-3d-${manifest.version}-firefox-store.zip`);
const archivedManifest = JSON.parse(execFileSync('unzip', ['-p', archive, 'manifest.json'], { encoding: 'utf8' }));
assert.deepEqual(archivedManifest, manifest);
const installNote = execFileSync('unzip', ['-p', archive, 'INSTALL-RU.txt'], { encoding: 'utf8' });
assert.ok(installNote.includes('.xpi'));
assert.ok(!installNote.includes('chrome://extensions'));
const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).trim().split('\n');
assert.ok(!entries.some(p => p.endsWith('.map')));
for (const f of ['background.js', 'notify.js']) assert.ok(entries.includes(f), `${f} must be in the package`);
const storeEntries = execFileSync('unzip', ['-Z1', storeZip], { encoding: 'utf8' }).trim().split('\n');
const storeManifest = JSON.parse(execFileSync('unzip', ['-p', storeZip, 'manifest.json'], { encoding: 'utf8' }));
assert.ok(!storeEntries.includes('background.js') && !storeEntries.includes('notify.js') && !storeEntries.includes('INSTALL-RU.txt'));
assert.ok(!storeManifest.background && !storeManifest.host_permissions && !storeManifest.permissions);
assert.deepEqual(manifest.background, { scripts: ['background.js'] });
assert.deepEqual(manifest.host_permissions, ['https://api.github.com/repos/ascorblack/legion-3d/releases/latest']);
assert.deepEqual(manifest.permissions, ['storage']);
const gameHtml = readFileSync('dist-dev/game.html', 'utf8')
  .replace(/<link[^>]*https:\/\/[^>]*>/g, '')
  .replace('<script src="game.js">', `<script>localStorage.setItem('l3d.whatsnew.seen', ${JSON.stringify(manifest.version)});window.testErrors=[];const logError=console.error.bind(console);console.error=(...args)=>{testErrors.push(args.map(String).join(' '));logError(...args);};window.addEventListener('error',e=>testErrors.push(e.message));window.addEventListener('unhandledrejection',e=>testErrors.push(String(e.reason)));</script><script src="game.js">`);
const fixture = `<!doctype html><meta charset="utf-8"><script nonce="fixture">window.bridgeAtStart=!!window.__L3D_BUS;localStorage.setItem('l3d.auto','0');window.updMsgs=[];window.addEventListener('message',e=>{if(e.source===window&&e.data&&e.data.__l3d==='update')window.updMsgs.push(e.data);});</script><body>Extension fixture<iframe src="/c/frame/"></iframe></body>`;
let requests = 0;
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(temp, 'key.pem'), '-out', join(temp, 'cert.pem'), '-days', '1', '-subj', '/CN=play.multidonate.ru'], { stdio: 'ignore' });
const server = createServer({ key: readFileSync(join(temp, 'key.pem')), cert: readFileSync(join(temp, 'cert.pem')) }, (req, res) => {
  // Every test URL resolves locally. No real game API/account is used.
  if (req.method !== 'GET') { requests++; res.writeHead(405); res.end(); return; }
  const path = new URL(req.url, 'https://localhost').pathname;
  if (path.startsWith('/c/')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "script-src 'nonce-fixture'; object-src 'none'");
    res.end(path === '/c/frame/' ? fixture.replace('<iframe src="/c/frame/"></iframe>', '') : fixture);
  } else if (path === '/api/me') { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true,"fixture":true}'); }
  else if (path === '/api/live') {
    res.setHeader('Content-Type', 'text/event-stream');
    res.end('event: city\ndata: {"fixture":true}\n\n');
  } else if (path === '/game.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(gameHtml); }
  else if (/^\/[\w-]+\.js(\.map)?$/.test(path)) {
    try { res.setHeader('Content-Type', 'text/javascript'); res.end(readFileSync(join('dist-dev', path.slice(1)))); }
    catch { res.writeHead(404); res.end(); }
  } else { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const reservation = netServer();
await new Promise(r => reservation.listen(0, '127.0.0.1', r));
const driverPort = reservation.address().port;
await new Promise(r => reservation.close(r));
const driver = spawn(process.env.GECKODRIVER || 'geckodriver', ['--port', String(driverPort)], { stdio: ['ignore', 'pipe', 'pipe'] });
let driverError;
let log = '';
driver.on('error', e => { driverError = e; });
driver.stdout.on('data', b => { log += b; });
driver.stderr.on('data', b => { log += b; });
let session;
async function command(method, path, body) {
  const r = await fetch(`http://127.0.0.1:${driverPort}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  const { value } = await r.json();
  if (!r.ok) throw new Error(`${method} ${path}: ${JSON.stringify(value)}`);
  return value;
}
const cmd = (method, path, body) => command(method, `/session/${session}${path}`, body);
const js = (script, args = []) => cmd('POST', '/execute/sync', { script, args });
async function until(script, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await js(script)) return; await delay(100); }
  throw new Error(`Timeout: ${script}`);
}
async function key(value, hold = 0) {
  await cmd('POST', '/actions', { actions: [{ type: 'key', id: 'keys', actions: [{ type: 'keyDown', value }, { type: 'pause', duration: hold }, { type: 'keyUp', value }] }] });
}
const checks = [];
try {
  for (let i = 0; ; i++) {
    if (driverError) throw driverError;
    try { await command('GET', '/status'); break; }
    catch (e) { if (i === 100) throw e; await delay(100); }
  }
  const created = await command('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'firefox', acceptInsecureCerts: true,
    'moz:firefoxOptions': { binary: process.env.FIREFOX || firefox.executablePath(), args: ['-headless'], prefs: { 'network.dns.localDomains': 'play.multidonate.ru', 'network.proxy.type': 0 } },
  } } });
  session = created.sessionId;
  console.log('Firefox', created.capabilities.browserVersion);
  await cmd('POST', '/timeouts', { pageLoad: 30000, script: 30000 });
  const id = await cmd('POST', '/moz/addon/install', { path: archive, temporary: true });
  assert.equal(id, manifest.browser_specific_settings.gecko.id);
  checks.push('packaged extension installed; archive manifest and Firefox installation note validated');
  await cmd('POST', '/url', { url: `https://play.multidonate.ru:${port}/c/offline-test/` });
  await until("return !!document.getElementById('l3d-launch')");
  assert.equal(await js('return window.bridgeAtStart'), true);
  assert.equal(await js('return frames[0].bridgeAtStart'), false);
  checks.push('MAIN world at document_start under strict CSP; no iframe injection; launcher at document_idle');
  // Update notice: notify.js (isolated world) must relay the background worker's answer as plain data. The worker's
  // single GET to GitHub may fail offline; then the answer carries no `latest`, which is still a valid reply.
  await until('return window.updMsgs.length > 0', 30000);
  const upd = await js('return window.updMsgs[0]');
  assert.equal(upd.current, manifest.version);
  assert.equal(upd.store, false, 'a temporary/GitHub install has no update_url');
  assert.deepEqual(Object.keys(upd).filter(k => !['__l3d', 'current', 'store', 'latest', 'url'].includes(k)), []);
  if (upd.latest) assert.ok(upd.url.startsWith('https://github.com/ascorblack/legion-3d/releases/'));
  checks.push('update notice relay: background worker -> notify.js -> page message (latest=' + (upd.latest || 'unavailable') + ')');
  // 2D (default): the bridge must leave window.fetch to the page (the site's anti-bot check sees any foreign wrapper);
  // the fetch tee is put on only for 3D and taken out again exactly
  assert.equal(await js('return /\\{\\s*\\[native code\\]\\s*\\}\\s*$/.test(Function.prototype.toString.call(window.fetch))'), true, 'window.fetch must be the native one in 2D');
  assert.equal(await js('window.__fetch0 = window.fetch; return window.__L3D_BUS.fetchTee.on() && window.fetch !== window.__fetch0'), true);
  await cmd('POST', '/execute/async', { script: "const done=arguments[0];fetch('/api/me').then(r=>r.json()).then(()=>{const es=new EventSource('/api/live');es.addEventListener('city',()=>{es.close();done(true);});});", args: [] });
  await until('return !!window.__L3D_BUS.last.me?.fixture && !!window.__L3D_BUS.last["sse:city"]?.fixture');
  assert.equal(await js('return window.__L3D_BUS.fetchTee.off() && window.fetch === window.__fetch0'), true, 'off() must give back the very same fetch');
  checks.push('fetch and EventSource bridge; window.fetch native in 2D, tee on for 3D only and restored exactly');
  await cmd('POST', '/url', { url: `https://localhost:${port}/game.html?bots=4` });
  await until('return !!window.__demo || !!document.querySelector("pre")', 60000);
  assert.equal(await js('return document.querySelector("pre")?.textContent || null'), null);
  await until('return !!window.__l3dGame && window.__l3dGame.engine.renderer.info.render.calls > 0');
  checks.push('WebGL2 scene rendered');
  const mode = await js('return __l3dGame.rig.mode');
  await key('v');
  assert.notEqual(await js('return __l3dGame.rig.mode'), mode);
  await key('v');
  assert.equal(await js('return __l3dGame.rig.mode'), mode);
  checks.push('first/third person keyboard toggle');
  const before = await js('return [__l3dGame.player.x,__l3dGame.player.y]');
  await key('w', 700);
  const after = await js('return [__l3dGame.player.x,__l3dGame.player.y]');
  assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) > 1, 'W must move the hero');
  checks.push('keyboard movement');
  await key('c');
  await until('return __l3dGame.ctx.state.menu === "gear"');
  await key('\uE00C'); // Escape
  await until('return !__l3dGame.ctx.state.menu');
  checks.push('equipment menu opens/closes');
  const canvas = await cmd('POST', '/element', { using: 'css selector', value: '#l3d-host canvas' });
  await cmd('POST', `/element/${canvas['element-6066-11e4-a52e-4f735466cecf']}/click`, {});
  await until('return !!document.pointerLockElement');
  await js('document.exitPointerLock();');
  await until('return !document.pointerLockElement');
  checks.push('pointer lock after a real click and release');
  await js('__demo.g.toClassic();');
  assert.equal(await js('return __demo.g.classic && getComputedStyle(document.getElementById("l3d-host")).display === "none"'), true);
  await js('__demo.g.resume();');
  assert.equal(await js('return !__demo.g.classic && getComputedStyle(document.getElementById("l3d-host")).display !== "none"'), true);
  checks.push('classic mode and resume');
  assert.deepEqual(await js('return window.testErrors'), []);
  assert.equal(requests, 0, 'offline tests must not send POST requests');
  writeFileSync(join(out, 'scene.png'), Buffer.from(await cmd('GET', '/screenshot'), 'base64'));
  writeFileSync(join(out, 'result.json'), JSON.stringify({ firefox: created.capabilities.browserVersion, checks }, null, 2) + '\n');
  for (const check of checks) console.log('PASS', check);
} catch (e) {
  if (session) {
    try { writeFileSync(join(out, 'failure.png'), Buffer.from(await cmd('GET', '/screenshot'), 'base64')); } catch { /* retain original failure */ }
  }
  throw e;
} finally {
  if (session) { try { await cmd('DELETE', ''); } catch { /* driver may already have exited */ } }
  driver.kill();
  server.closeAllConnections();
  await new Promise(r => server.close(r));
  writeFileSync(join(out, 'geckodriver.log'), log);
  rmSync(temp, { recursive: true, force: true });
}
