// Build: content scripts → dist/ or dist-firefox/ (unpacked extension); every dev/*.ts → dist-dev/ (standalone demo pages).
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync, readdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Bullets of the current manifest version in CHANGELOG.md (max 3) → baked into the bundle for the «Что нового» card. */
function changelogBullets() {
  try {
    const ver = JSON.parse(readFileSync('public/manifest.json', 'utf8')).version;
    const md = readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/);
    const i = md.findIndex((l) => new RegExp('^##\\s+\\[?v?' + ver.replace(/\./g, '\\.') + '\\b').test(l));
    if (i < 0) return [];
    const out = [];
    for (let j = i + 1; j < md.length && !/^##\s/.test(md[j]); j++) { const m = /^\s*[-*]\s+(.+)$/.exec(md[j]); if (m) out.push(m[1].trim()); }
    return out.slice(0, 3);
  } catch { return []; }
}

const watch = process.argv.includes('--watch');
const prod = process.argv.includes('--prod');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);   // e.g. --only=dev
const browser = process.argv.find((a) => a.startsWith('--browser='))?.slice(10) || 'chrome';
if (!['chrome', 'firefox'].includes(browser)) throw new Error(`Unsupported browser: ${browser}`);
const dist = browser === 'firefox' ? 'dist-firefox' : 'dist';
const common = {
  bundle: true, format: 'iife', target: browser === 'firefox' ? 'firefox128' : 'chrome111', sourcemap: prod ? false : 'linked',
  minify: prod, legalComments: 'none', logLevel: 'warning',
  define: { __DEV__: String(!prod), __L3D_CHANGELOG__: JSON.stringify(changelogBullets()) },
  loader: { '.css': 'text', '.svg': 'text' },
};
const ctxs = [];
if (only !== 'dev') {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  cpSync('public', dist, { recursive: true });
  if (browser === 'firefox') {
    const manifest = JSON.parse(readFileSync(`${dist}/manifest.json`, 'utf8'));
    cpSync('docs/INSTALL-FIREFOX-RU.txt', `${dist}/INSTALL-RU.txt`);
    delete manifest.minimum_chrome_version;
    manifest.browser_specific_settings = { gecko: {
      id: 'legion-3d@ascorblack',
      strict_min_version: '128.0',
      data_collection_permissions: { required: ['none'] },
    } };
    writeFileSync(`${dist}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
  }
  ctxs.push(await esbuild.context({ ...common, entryPoints: { bridge: 'src/bridge/bridge.ts', game: 'src/content/main.ts' }, outdir: dist }));
}
if (only !== 'ext' && existsSync('dev')) {
  mkdirSync('dist-dev', { recursive: true });
  const entries = {};
  for (const f of readdirSync('dev')) {
    if (f.endsWith('.ts')) entries[f.slice(0, -3)] = 'dev/' + f;
    else if (f.endsWith('.html')) cpSync('dev/' + f, 'dist-dev/' + f);
  }
  if (Object.keys(entries).length) ctxs.push(await esbuild.context({ ...common, entryPoints: entries, outdir: 'dist-dev' }));
}
if (watch) { for (const c of ctxs) await c.watch(); console.log('watching…'); }
else { for (const c of ctxs) { await c.rebuild(); await c.dispose(); } console.log('built'); }
