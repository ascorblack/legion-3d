#!/usr/bin/env node
// Asset fingerprints of the site's town art (src/world/fcart/fingerprint.ts explains the format):
//   - runs fc-art.js draw() (window.LGFairCatsArt) on the real fair map (fc-map.js) and tk-art.js drawTown() on the
//     Town Kit fixture town (test/fixtures/townkit-map.json T + cfg) in node, groups the drawn assets by model ref,
//     hashes the normalised SVG → src/data/fcart-fp.json { ref: { fp, n, box: [w, h], v? } } (Town Kit refs 'tk:…');
//   - `--ref`: dumps every ref's representative SVG to .local/fcart/ref/<ref>.svg (and .png when cairosvg is available
//     through `uv run --with cairosvg python`), the references the model makers port from.
//   node scripts/fcart-fp.mjs [<site copy dir>] [--ref] [--print]
// Without a dir the newest .local/site-* with fc-art.js is used. scripts/drift.mjs imports liveFingerprints() from here.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { artSamples, fingerprints, representatives } from '../src/world/fcart/fingerprint.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FP_JSON = join(ROOT, 'src/data/fcart-fp.json');
const G0 = { console, Math, JSON, Date, Map, Set, Uint8Array, Uint32Array, Int32Array, Float32Array, Object, Array, Number, String, Infinity, NaN, RegExp, Error, parseInt, parseFloat, isFinite };

/** The newest .local/site-* copy that has fc-art.js (or null). */
export function newestSiteCopy() {
  const d = join(ROOT, '.local');
  if (!existsSync(d)) return null;
  const c = readdirSync(d).filter((n) => /^site-/.test(n) && existsSync(join(d, n, 'fc-art.js'))).map((n) => join(d, n));
  c.sort((a, b) => statSync(b, { bigint: false }).mtimeMs - statSync(a).mtimeMs || (a < b ? 1 : -1));
  return c[0] ?? null;
}

/** Loads the site's UMD art / map modules (require() between them resolved within the set) from `read(file)` → text | null. */
export function siteModulesFrom(read) {
  const cache = {};
  const load = (file) => {
    if (file in cache) return cache[file];
    const text = read(file);
    if (text == null) return (cache[file] = null);
    const module = { exports: {} };
    cache[file] = module.exports;
    try { vm.runInNewContext(text, { ...G0, module, exports: module.exports, require: req }, { timeout: 20000 }); } catch { return (cache[file] = null); }
    return (cache[file] = module.exports);
  };
  function req(p) {
    const f = /tkmap|tk-map/.test(p) ? 'tk-map.js' : /tkart|tk-art/.test(p) ? 'tk-art.js' : /catsmap|fc-map/.test(p) ? 'fc-map.js' : null;
    const m = f && load(f);
    if (!m) throw new Error('require ' + p);
    return m;
  }
  return { F: load('fc-map.js'), A: load('fc-art.js'), K: load('tk-art.js'), M: load('tk-map.js') };
}
/** The same from a site copy directory. */
export const siteModules = (dir) => siteModulesFrom((f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : null));

/** Writes src/data/fcart-fp.json (one row per line). */
export function writeTable(table) {
  writeFileSync(FP_JSON, '{\n' + Object.entries(table).map(([r, e]) => JSON.stringify(r) + ':' + JSON.stringify(e)).join(',\n') + '\n}\n');
}

/** Which model file registers a ref (a `ref: '<ref>'` literal in src/world/fcart/*.ts), for the drift report. */
export function modelFiles() {
  const dir = join(ROOT, 'src/world/fcart'), out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.ts') || f === 'fingerprint.ts' || f === 'registry.ts') continue;
    for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/\bref:\s*['"`]([^'"`]+)['"`]/g)) out[m[1]] = f;
  }
  return out;
}

/** Live fingerprints: { table, samples, defs } (fair refs bare, Town Kit refs 'tk:'); `src` = a site copy dir or a reader. */
export function liveFingerprints(src) {
  const { F, A, K, M } = typeof src === 'function' ? siteModulesFrom(src) : siteModules(src);
  const samples = [];
  let defs = '';
  if (A && F && typeof A.draw === 'function') {
    const R = A.draw({});
    defs = (R.layers?.[0]?.svg.match(/<defs>.*?<\/defs>/) || [''])[0];
    samples.push(...artSamples(R, F, K, {}));
  }
  if (K && M && typeof K.drawTown === 'function') {
    const fx = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/townkit-map.json'), 'utf8'));
    const o = { levels: fx.cfg?.levels, building: fx.cfg?.building, now: fx.cfg?.now };
    const R = K.drawTown(fx.T, o);
    samples.push(...artSamples(R, M.layoutOf(fx.T), K, o, 'tk:'));
  }
  return { table: fingerprints(samples), samples, defs };
}

/** ref → a file name (':' kept; anything odd → '_'). */
export const refFile = (ref) => ref.replace(/[^\w:.-]/g, '_');

function dumpRefs(table, samples, defs) {
  const out = join(ROOT, '.local/fcart/ref');
  mkdirSync(out, { recursive: true });
  const rep = representatives(samples, table), files = [];
  for (const [ref, s] of rep) {
    const [w, h] = s.box, [ox, oy] = s.org;
    // browsers keep the first of a repeated attribute; strict XML readers (cairosvg) refuse it: drop the repeats
    const raw = s.raw.replace(/<[a-zA-Z][^>]*>/g, (t) => { const seen = new Set(); return t.replace(/\s([\w:-]+)="[^"]*"/g, (a, n) => (seen.has(n) ? '' : (seen.add(n), a))); });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ox} ${oy} ${w} ${h}" width="${w}" height="${h}">${defs}${raw}</svg>\n`;
    const f = join(out, refFile(ref) + '.svg');
    writeFileSync(f, svg); files.push(f);
  }
  // PNG renders (best effort): cairosvg through uv
  const py = `import sys, cairosvg\nfor f in sys.argv[1:]:\n    try:\n        cairosvg.svg2png(url=f, write_to=f[:-4] + '.png', output_width=None)\n    except Exception as e:\n        print('png failed', f, e)\n`;
  const r = spawnSync('uv', ['run', '--quiet', '--with', 'cairosvg', 'python', '-c', py, ...files.filter((f) => !/\/(tk:)?(terrain|relief)\.svg$/.test(f))], { encoding: 'utf8', timeout: 170000 });
  if (r.status !== 0) console.log('png renders skipped:', (r.stderr || r.error || '').toString().split('\n').slice(-3).join(' '));
  else if (r.stdout) console.log(r.stdout.trim());
  console.log(`refs: ${files.length} svg → .local/fcart/ref/`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--')) ?? newestSiteCopy();
  if (!dir || !existsSync(join(dir, 'fc-art.js'))) { console.error('usage: node scripts/fcart-fp.mjs <site copy dir with fc-art.js, fc-map.js, tk-art.js, tk-map.js> [--ref] [--print]'); process.exit(1); }
  const t0 = performance.now();
  const { table, samples, defs } = liveFingerprints(dir);
  writeTable(table);
  const fair = Object.keys(table).filter((r) => !r.startsWith('tk:')).length;
  console.log(`fcart-fp: ${Object.keys(table).length} refs (${fair} fair, ${Object.keys(table).length - fair} town kit) from ${samples.length} drawings in ${Math.round(performance.now() - t0)} ms → src/data/fcart-fp.json`);
  if (args.includes('--print')) for (const [r, e] of Object.entries(table)) console.log(`  ${r.padEnd(22)} ${e.fp}  n=${e.n}${e.v ? ' v=' + e.v : ''}  ${e.box.join('×')}`);
  if (args.includes('--ref')) dumpRefs(table, samples, defs);
}
