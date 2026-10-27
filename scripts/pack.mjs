// Two archives from the production build: store payload (strict allowlist) and GitHub release (+ install note).
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync, existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
const browser = process.argv.find((a) => a.startsWith('--browser='))?.slice(10) || 'chrome';
if (!['chrome', 'firefox'].includes(browser)) throw new Error(`Unsupported browser: ${browser}`);
const dist = browser === 'firefox' ? 'dist-firefox' : 'dist';
const suffix = browser === 'firefox' ? '-firefox' : '';
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
if (browser === 'firefox' && !manifest.browser_specific_settings?.gecko?.id) {
  throw new Error('Firefox package requires a Gecko extension ID; run npm run build:firefox -- --prod');
}
const files = [];
function walk(dir) { for (const item of readdirSync(dir, { withFileTypes: true })) {
  const path = join(dir, item.name);
  if (item.isDirectory()) walk(path);
  else if (item.isFile()) files.push(relative(dist, path).replaceAll('\\', '/'));
  else throw new Error(`Unsupported package entry: ${path}`);
} }
walk(dist);
const allowed = (file) => file === 'manifest.json' || /^(bridge|game|background|notify)\.js$/.test(file) || /^icons\/(16|48|128)\.png$/.test(file) || /^sounds\/[\w./-]+\.(ogg|mp3|wav)$/.test(file);
const unwanted = files.filter((f) => !allowed(f) && f !== 'INSTALL-RU.txt');
const storeFiles = files.filter((f) => allowed(f));
if (unwanted.length) throw new Error(`Unexpected dist files (use scripts/build.mjs --prod): ${unwanted.join(', ')}`);
for (const f of ['manifest.json', 'bridge.js', 'game.js', 'background.js', 'notify.js', 'icons/16.png', 'icons/48.png', 'icons/128.png']) if (!files.includes(f)) throw new Error(`Missing ${f}`);
const store = `legion-3d-${manifest.version}${suffix}-store.zip`;
const github = `legion-3d-${manifest.version}${suffix}.zip`;
for (const name of [store, github]) if (existsSync(name)) unlinkSync(name);
// Store payload: the store updates the extension itself, so the GitHub update check (background worker, its relay
// script, the api.github.com host permission and `storage`) is stripped — no unused permissions for the reviewers.
const UPDATE_ONLY = new Set(['background.js', 'notify.js']);
const storeDir = `${dist}-store`;
rmSync(storeDir, { recursive: true, force: true });
const storeOnly = storeFiles.filter((f) => !UPDATE_ONLY.has(f));
for (const f of storeOnly) { mkdirSync(join(storeDir, f, '..'), { recursive: true }); cpSync(join(dist, f), join(storeDir, f)); }
const sm = JSON.parse(JSON.stringify(manifest));
delete sm.background; delete sm.host_permissions;
if (Array.isArray(sm.permissions)) { sm.permissions = sm.permissions.filter((x) => x !== 'storage'); if (!sm.permissions.length) delete sm.permissions; }
sm.content_scripts = (sm.content_scripts || []).filter((c) => !(c.js || []).some((j) => UPDATE_ONLY.has(j)));
writeFileSync(join(storeDir, 'manifest.json'), JSON.stringify(sm, null, 2) + '\n');
try { execFileSync('zip', ['-q', '-X', `../${store}`, ...storeOnly], { cwd: storeDir }); }
finally { rmSync(storeDir, { recursive: true, force: true }); }
let generatedNote = false;
if (!files.includes('INSTALL-RU.txt')) {
  const note = browser === 'firefox'
    ? readFileSync('docs/INSTALL-FIREFOX-RU.txt', 'utf8')
    : 'Legion 3D — установка вручную\n\nРаспакуйте архив, откройте chrome://extensions, включите режим разработчика, нажмите «Загрузить распакованное расширение» и выберите папку с manifest.json. После обновления распакуйте новый архив и нажмите «Обновить».\n';
  writeFileSync(join(dist, 'INSTALL-RU.txt'), note); generatedNote = true;
}
try { execFileSync('zip', ['-q', '-X', `../${github}`, ...storeFiles, 'INSTALL-RU.txt'], { cwd: dist }); }
finally { if (generatedNote) unlinkSync(join(dist, 'INSTALL-RU.txt')); }
for (const name of [store, github]) console.log(`${name}: ${statSync(name).size} bytes (${(statSync(name).size / 1048576).toFixed(2)} MiB)`);
console.log(`Store entries (${storeOnly.length}): ${storeOnly.join(', ')} (update check stripped)`);
