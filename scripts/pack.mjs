// Two archives from the production build: store payload (strict allowlist) and GitHub release (+ install note).
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
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
const allowed = (file) => file === 'manifest.json' || /^(bridge|game)\.js$/.test(file) || /^icons\/(16|48|128)\.png$/.test(file) || /^sounds\/[\w./-]+\.(ogg|mp3|wav)$/.test(file);
const unwanted = files.filter((f) => !allowed(f) && f !== 'INSTALL-RU.txt');
const storeFiles = files.filter((f) => allowed(f));
if (unwanted.length) throw new Error(`Unexpected dist files (use scripts/build.mjs --prod): ${unwanted.join(', ')}`);
for (const f of ['manifest.json', 'bridge.js', 'game.js', 'icons/16.png', 'icons/48.png', 'icons/128.png']) if (!files.includes(f)) throw new Error(`Missing ${f}`);
const store = `legion-3d-${manifest.version}${suffix}-store.zip`;
const github = `legion-3d-${manifest.version}${suffix}.zip`;
for (const name of [store, github]) if (existsSync(name)) unlinkSync(name);
execFileSync('zip', ['-q', '-X', `../${store}`, ...storeFiles], { cwd: dist });
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
console.log(`Store entries (${storeFiles.length}): ${storeFiles.join(', ')}`);
