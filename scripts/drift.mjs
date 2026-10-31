#!/usr/bin/env node
// Site drift report: what changed on the game site since the last snapshot, and what the site has that we do not
// support yet. No browser: downloads the channel page and its scripts (public, GET only) and reads them statically.
//
//   npm run drift                                  # default channel, compare with src/data/site-snapshot.json
//   npm run drift -- https://play.multidonate.ru/c/<channel>/
//   npm run drift -- --local=.local/site-new       # read already downloaded scripts (offline)
//   npm run drift -- --write                       # accept the current site as the new snapshot
//   npm run drift -- --save=.local/site-YYYY-MM-DD   # also keep the downloaded scripts
//   npm run drift -- --json                        # machine-readable report
//   npm run drift -- --strict                      # exit 2 when anything is new/removed/unsupported/changed
//   (always) exit 3 when a 'break' check of src/data/site-contract.json fails or an endpoint we call vanished
//
// Scripts: the page's <script src>, the ones app.js / other scripts load on demand (`'/site/x.js?v=`), and the City's
// building windows named by page data (LG_CITYV.bl → /site/cityshop.js, /site/citystore.js, /site/b-<id>.js; 31.10).
// Extracted: building ids (citymap.js run as UMD in node:vm), room ids (city.js `const ROOM = {` keys), look catalog
// (doodle.js `const CATALOG = {` + event looks), game data (game-data.js → self.LG_GAME_DATA: classes and every other
// list of {id}), every `/api/...` path in every script, quest kinds (quest.js `KIND_RU` keys).
// Compared with: the snapshot (new / removed ids) and src/data/supported.json (ids the extension has models/rooms for)
// plus the `/api/...` paths our own src/ uses (a removed endpoint we call = breakage).
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = join(ROOT, 'src/data/site-snapshot.json');
const SUPPORTED = join(ROOT, 'src/data/supported.json');
const CONTRACT = join(ROOT, 'src/data/site-contract.json');
const DEFAULT_URL = 'https://play.multidonate.ru/c/zakvielchannel/';
// Channel-specific bundles differ by art style (cityfair.js / doodle.js carry the channel's styles: zakvielchannel has
// «cats» + «legion», most other channels only «legion»). These channels are fingerprinted too (their /c/<channel>/*.js),
// so a change in another style's bundle is noticed. Public channel ids only.
const EXTRA_CHANNELS = ['exx1dae'];
// Data files loaded on demand that the scripts list does not contain (world map geometry).
const EXTRA_FILES = ['/site/worldgeo.json'];

/* ------------------------------------------------------------------ download */

/** Script URLs of the channel page: <script src> + the ones app.js loads on demand (city, mine, quest…). */
export function scriptUrls(html, appJs, origin, base) {
  const out = new Set();
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) if (!/pixi/.test(m[1])) out.add(m[1].split('?')[0]);
  for (const m of (appJs || '').matchAll(/(\$\{base\}|['"`]\/(?:site|lib)|\(window\.LG_BASE \|\| ''\) \+ ')([\w/.-]*?\/?[\w-]+\.js)(?:\?v=|['"`])/g)) {
    let p = m[2];
    if (m[1].startsWith('${base}') || m[1].startsWith('(window')) p = base + (p.startsWith('/') ? p : '/' + p);
    else p = m[1].slice(1) + (p.startsWith('/') ? p : '/' + p);
    if (!/bugreport/.test(p)) out.add(p.replace(/\/\/+/g, '/'));
  }
  return [...out].map((p) => (p.startsWith('http') ? p : origin + p));
}

/**
 * Building windows of the City (site 31.10, app.js cityWin): the shared shop code /site/cityshop.js, the Storage window
 * /site/citystore.js and one /site/b-<building>.js per id of `LG_CITYV.bl` (page data, version `bw`). app.js builds those
 * paths from a list (`/site/${f}.js`), so the regex of scriptUrls cannot see them: read the list from the page itself.
 */
export function cityModuleUrls(html, origin) {
  let V = null;
  const m = /LG_CITYV\s*=\s*\{/.exec(html || '');
  const lit = m && braceBlock(html, m.index);
  if (lit) { try { V = JSON.parse(lit); } catch { V = evalLiteral(lit); } }
  if (!V || typeof V !== 'object') return [];
  const bl = Array.isArray(V.bl) ? V.bl.filter((b) => typeof b === 'string' && /^[\w-]{1,40}$/.test(b)) : [];
  // without ?v= like every other script here (the newest file); citystore.js is also named in app.js (a Set merges them)
  return ['cityshop', 'citystore', ...bl.map((b) => 'b-' + b)].map((f) => `${origin}/site/${f}.js`);
}

async function get(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'legion-3d-drift (+https://github.com/)' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

async function download(pageUrl) {
  const u = new URL(pageUrl);
  const html = await get(u.href);
  const base = (/LG_BASE="([^"]+)"/.exec(html) || [])[1] || u.pathname.replace(/\/$/, '');
  const appUrl = (/<script[^>]+src="([^"]*\/app\.js)[^"]*"/.exec(html) || [])[1];
  const appJs = appUrl ? await get(new URL(appUrl, u.origin).href) : '';
  const files = {};
  const failed = [];
  const seen = new Set();
  let urls = [...new Set([...scriptUrls(html, appJs, u.origin, base), ...cityModuleUrls(html, u.origin)])];
  // scripts load more scripts on demand (city.js → auction.js, towngen.js…): follow them for a few rounds
  for (let round = 0; round < 3 && urls.length; round++) {
    const todo = urls.filter((x) => !seen.has(x));
    for (const x of todo) seen.add(x);
    await Promise.all(todo.map(async (url) => {
      try { files[url.replace(u.origin, '')] = url.endsWith('/app.js') && appJs ? appJs : await get(url); }
      catch (e) { failed.push(String(e.message || e)); }
    }));
    urls = [];
    for (const src of Object.values(files)) for (const m of src.matchAll(/['"`](\/(?:site|lib)\/[\w/-]+\.js)\?v=/g)) if (!/bugreport/.test(m[1])) urls.push(u.origin + m[1]);
    urls = [...new Set(urls)].filter((x) => !seen.has(x));
  }
  return { files, failed, base };
}

function readLocal(dir) {
  const files = {};
  for (const f of readdirSync(dir)) if (f.endsWith('.js')) files['/' + f] = readFileSync(join(dir, f), 'utf8');
  return { files, failed: [], base: '' };
}

/* ------------------------------------------------------------------ extract */

const pick = (files, name) => { const k = Object.keys(files).find((p) => p.endsWith('/' + name)); return k ? files[k] : null; };

/** The text of a `{ … }` literal starting at the first '{' at or after index i (strings and comments respected). */
export function braceBlock(src, i) {
  const s = src.indexOf('{', i); if (s < 0) return null;
  let d = 0, q = null;
  for (let k = s; k < src.length; k++) {
    const c = src[k];
    if (q) { if (c === '\\') k++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[k + 1] === '/') { k = src.indexOf('\n', k); if (k < 0) return null; continue; }
    if (c === '/' && src[k + 1] === '*') { k = src.indexOf('*/', k + 2) + 1; if (k <= 0) return null; continue; }
    if (c === '{') d++;
    else if (c === '}' && --d === 0) return src.slice(s, k + 1);
  }
  return null;
}
/** Top-level keys of an object literal text: `key: v`, `'key': v`, shorthand `key,` / `key }`, methods `key(…) {`,
 *  `async key(…)`, `get key()`. Comments (also between keys, also after the last one) are skipped; a key that only
 *  appears inside a `//` comment is NOT a key (city.js 27.10: `where`/`towns` ended up in a trailing comment). */
export function topKeys(block) {
  const keys = [];
  let d = 0, q = null, start = true;
  for (let k = 1; k < block.length - 1; k++) {
    const c = block[k];
    if (q) { if (c === '\\') k++; else if (c === q) q = null; continue; }
    if (c === '/' && block[k + 1] === '/') { k = block.indexOf('\n', k); if (k < 0) break; continue; }
    if (c === '/' && block[k + 1] === '*') { k = block.indexOf('*/', k + 2) + 1; if (k <= 0) break; continue; }
    if (d === 0 && start) {
      if (/\s/.test(c)) continue;
      const rest = block.slice(k, k + 120);
      const m = /^(?:(['"])([^'"]+)\1|(?:(?:async|get|set|static)\s+)?\*?([A-Za-z_$][\w$]*))\s*(?=[:(,}]|\/[/*]|$)/.exec(rest);
      // k stops on the last char of the match: a following ',' (shorthand) resets `start`, '(' (method) nests
      if (m) { keys.push(m[2] || m[3]); start = false; k += m[0].length - 1; continue; }
      if (c === '.' && block.startsWith('...', k)) { start = false; continue; }   // spread
      start = false;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if ('{[('.includes(c)) d++;
    else if ('}])'.includes(c)) d--;
    else if (c === ',' && d === 0) start = true;
  }
  return keys;
}
const evalLiteral = (text) => { try { return vm.runInNewContext('(' + text + ')', {}, { timeout: 1000 }); } catch { return null; } };
const literalAfter = (src, re) => { const m = re.exec(src); return m ? braceBlock(src, m.index) : null; };
const sorted = (a) => [...new Set(a)].sort();

export function extract(files) {
  const out = { buildings: [], rooms: [], catalog: {}, gameData: {}, api: [], questKinds: [], scripts: Object.keys(files).sort() };
  const errors = [];
  // buildings — citymap.js is UMD: module.exports = factory()
  const cm = pick(files, 'citymap.js');
  if (cm) {
    try {
      const module = { exports: {} };
      vm.runInNewContext(cm, { module, exports: module.exports, console: { log() {}, warn() {} } }, { timeout: 5000 });
      const M = module.exports;
      out.buildings = sorted((M.BUILDINGS || []).map((b) => b.id));
      out.buildingFlags = Object.fromEntries((M.BUILDINGS || []).filter((b) => b.soon || b.mine || b.magic || b.fair).map((b) => [b.id, ['soon', 'mine', 'magic', 'fair'].filter((f) => b[f])]));
    } catch (e) { errors.push('citymap.js: ' + e.message); }
  } else errors.push('citymap.js not found');
  // rooms — city.js `const ROOM = {`
  const city = pick(files, 'city.js');
  const rb = city && literalAfter(city, /const ROOM = \{/);
  if (rb) out.rooms = sorted(topKeys(rb)); else errors.push('city.js: ROOM not found');
  const fb = city && literalAfter(city, /const FULL = \{/);
  if (fb) out.fullRooms = sorted(topKeys(fb));
  // look catalog — doodle.js `const CATALOG = {` (+ event looks merged into it, e.g. HW_LOOKS)
  const dd = pick(files, 'doodle.js');
  if (dd) {
    const ids = (list) => (Array.isArray(list) ? list.map((x) => (Array.isArray(x) ? x[0] : x)).filter((x) => typeof x === 'string') : []);
    const cat = evalLiteral(literalAfter(dd, /const CATALOG = \{/) || 'null');
    if (cat) for (const [k, v] of Object.entries(cat)) out.catalog[k] = ids(v);
    else errors.push('doodle.js: CATALOG not found');
    for (const m of dd.matchAll(/const ([A-Z_]+_LOOKS) = \{/g)) {
      const extra = evalLiteral(braceBlock(dd, m.index) || 'null');
      if (extra && new RegExp(`CATALOG\\[k\\]\\s*=\\s*CATALOG\\[k\\]\\.concat`).test(dd)) for (const [k, v] of Object.entries(extra)) out.catalog[k] = sorted([...(out.catalog[k] || []), ...ids(v)]);
    }
    for (const k of Object.keys(out.catalog)) if (k !== 'colors') out.catalog[k] = sorted(out.catalog[k]); else delete out.catalog[k];
  }
  // game data — self.LG_GAME_DATA
  const gd = pick(files, 'game-data.js');
  if (gd) {
    try {
      const self = {};
      vm.runInNewContext(gd, { self }, { timeout: 5000 });
      const D = self.LG_GAME_DATA || {};
      out.gameDataVersion = D.v;
      for (const [k, v] of Object.entries(D)) {
        if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === 'object' && typeof x.id === 'string')) out.gameData[k] = sorted(v.map((x) => x.id));
        else if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0 && Object.keys(v).length < 400) {
          const vals = Object.values(v);
          // id → name maps (res: ore/wood ids) and id → record maps
          if (vals.length >= 3 && (vals.every((x) => typeof x === 'string') || vals.every((x) => x && typeof x === 'object' && !Array.isArray(x)))) out.gameData[k] = sorted(Object.keys(v));
          else if (Array.isArray(v.keys) && v.keys.every((x) => typeof x === 'string')) out.gameData[k + '.keys'] = sorted(v.keys);
        }
      }
      if (Array.isArray(D.levels)) out.maxLevel = D.levels.length;
    } catch (e) { errors.push('game-data.js: ' + e.message); }
  }
  // api paths in every script
  const api = [];
  for (const src of Object.values(files)) for (const m of src.matchAll(/['"`](\/api\/[A-Za-z0-9_/-]+)/g)) api.push(m[1].replace(/\/$/, ''));
  out.api = sorted(api);
  // quest kinds
  const q = pick(files, 'quest.js');
  const kb = q && literalAfter(q, /const KIND_RU = \{/);
  if (kb) out.questKinds = sorted(topKeys(kb)); else errors.push('quest.js: KIND_RU not found');
  return { data: out, errors };
}

/* ------------------------------------------------------------------ compare */

/** `/api/...` paths used by our own sources. */
export function ourApi(dir = join(ROOT, 'src')) {
  const out = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|js|mjs)$/.test(f)) for (const m of readFileSync(p, 'utf8').matchAll(/['"`](\/api\/[A-Za-z0-9_/-]+)/g)) out.push(m[1].replace(/\/$/, '')); } };
  walk(dir);
  return sorted(out);
}

const diffList = (now = [], was = []) => ({ added: now.filter((x) => !was.includes(x)), removed: was.filter((x) => !now.includes(x)) });

export function compare(cur, snap, sup, ours) {
  const R = { changes: {}, unsupported: {}, broken: [] };
  const lists = {
    buildings: [cur.buildings, snap?.buildings], rooms: [cur.rooms, snap?.rooms], questKinds: [cur.questKinds, snap?.questKinds], api: [cur.api, snap?.api],
  };
  for (const [k, v] of Object.entries(cur.catalog)) lists['catalog.' + k] = [v, snap?.catalog?.[k]];
  for (const [k, v] of Object.entries(cur.gameData)) lists['gameData.' + k] = [v, snap?.gameData?.[k]];
  for (const k of Object.keys(snap?.catalog || {})) if (!cur.catalog[k]) lists['catalog.' + k] = [[], snap.catalog[k]];
  for (const k of Object.keys(snap?.gameData || {})) if (!cur.gameData[k]) lists['gameData.' + k] = [[], snap.gameData[k]];
  if (snap) for (const [k, [now, was]] of Object.entries(lists)) { const d = diffList(now, was || []); if (d.added.length || d.removed.length) R.changes[k] = d; }
  if (sup) {
    const miss = (ids, have) => ids.filter((x) => !have.includes(x));
    const S = sup;
    R.unsupported['buildings (3D model)'] = miss(cur.buildings, S.buildings?.models || []);
    R.unsupported['buildings (room mapping)'] = miss(cur.buildings, Object.keys(S.buildings?.rooms || {}));
    const kinds = S.roomKinds || [];
    R.unsupported['buildings (room kind not implemented → site screen)'] = cur.buildings.filter((b) => { const k = S.buildings?.rooms?.[b]; return k && k !== 'site' && k !== 'none' && !kinds.includes(k); });
    for (const [k, v] of Object.entries(cur.catalog)) if (S.looks?.[k]) R.unsupported['looks.' + k] = miss(v, S.looks[k]);
    R.unsupported.questKinds = miss(cur.questKinds, S.questKinds || []);
    if (S.classes) R.unsupported.classes = miss(cur.gameData.classes || [], S.classes);
    for (const k of Object.keys(R.unsupported)) if (!R.unsupported[k].length) delete R.unsupported[k];
  }
  R.broken = ours.filter((p) => !cur.api.some((a) => a === p || a.startsWith(p + '/') || p.startsWith(a + '/')));
  return R;
}

/** JSON with arrays of primitives on one line (readable diffs, one key per line). */
export function compactJson(o) {
  return JSON.stringify(o, null, 2).replace(/\[\n\s*((?:(?:"[^"\n]*"|-?[\d.]+|true|false|null),?\n\s*)+)\]/g, (_, body) => '[' + body.split(/,?\n\s*/).filter(Boolean).join(', ') + ']');
}

/* ------------------------------------------------------------------ contract + fingerprints */

/** Top-level keys of the object literal assigned by `window.<obj> = {` (or `root.<obj> =` / `self.<obj> =`) in src. */
export function objectKeys(src, obj) {
  const re = new RegExp(`(?:window|self|globalThis|root)\\.${obj.replace(/[$]/g, '\\$')}\\s*=\\s*\\{`, 'g');
  const out = new Set();
  for (const m of src.matchAll(re)) { const b = braceBlock(src, m.index + m[0].length - 1); if (b) for (const k of topKeys(b)) out.add(k); }
  return out;
}
/** Exports of a UMD / global script run in node:vm (module.exports, or what it assigns on window/self); null if it throws. */
export function moduleExports(files, file, name, seen = new Map()) {
  const path = Object.keys(files).find((p) => p.endsWith('/' + file)); if (!path) return null;
  if (seen.has(path)) return seen.get(path);
  seen.set(path, null);
  try {
    const module = { exports: {} }, g = {};
    const req = (p) => moduleExports(files, String(p).split('/').pop().replace(/^index\.js$/, 'world.js'), '', seen) || {};
    const ctx = { module, exports: module.exports, require: req, console: { log() {}, warn() {}, error() {}, info() {} }, Math, JSON, Date, Object, Array, Set, Map, String, Number, Promise };
    ctx.self = ctx.window = ctx.globalThis = g;
    vm.runInNewContext(files[path], ctx, { timeout: 5000 });
    const ex = Object.keys(module.exports).length ? module.exports : (name && g[name]) || null;
    seen.set(path, ex);
    return ex;
  } catch { return null; }
}
const keyRe = (k) => new RegExp(`(?:^|[^\\w$.])${k.replace(/[$]/g, '\\$')}\\s*(?:[:(,}]|=>|\\s*=\\s*\\()`);

/** Every entry of src/data/site-contract.json checked against the site's scripts → the failing ones (with `missing`).
 *  kind 'keys': each key must be a real top-level key of the `window.<obj> = {` literal (a key inside a comment is not);
 *  kind 'global': the module's exports (node:vm) or, when it cannot run outside a browser, `<name>` + each key in the text;
 *  otherwise (also 'dom'): `re` must match. */
export function checkContract(files, contract) {
  const failed = [];
  for (const c of contract.checks || []) {
    const names = Object.keys(files).filter((k) => !c.file || k.endsWith('/' + c.file));
    if (!names.length) { failed.push({ ...c, reason: `script ${c.file} not found` }); continue; }
    if (c.kind === 'keys') {
      const have = new Set(); for (const n of names) for (const k of objectKeys(files[n], c.obj)) have.add(k);
      if (!have.size) { failed.push({ ...c, reason: `window.${c.obj} = { … } not found`, missing: [c.obj] }); continue; }
      const missing = (c.keys || []).filter((k) => !have.has(k));
      if (missing.length) failed.push({ ...c, reason: `${c.obj} has no ${missing.join(', ')}`, missing });
      continue;
    }
    if (c.kind === 'global') {
      const ex = c.file ? moduleExports(files, c.file, c.name) : null;
      let missing;
      if (ex) missing = (c.keys || []).filter((k) => !(k in ex));
      else {
        const lit = new Set(); for (const n of names) for (const k of objectKeys(files[n], c.name)) lit.add(k);
        const text = names.map((n) => files[n]).join('\n');
        if (!new RegExp(`\\b${c.name}\\b`).test(text)) { failed.push({ ...c, reason: `${c.name} not found`, missing: [c.name] }); continue; }
        missing = (c.keys || []).filter((k) => !lit.has(k) && !keyRe(k).test(text));
      }
      if (missing.length) failed.push({ ...c, reason: `${c.name} has no ${missing.join(', ')}`, missing });
      continue;
    }
    let re; try { re = new RegExp(c.re); } catch { failed.push({ ...c, reason: 'bad regex' }); continue; }
    if (!names.some((k) => re.test(files[k]))) failed.push({ ...c, reason: 'not found' });
  }
  return failed;
}

/** Short content hash of every script (path without the channel, without ?v=) — shows WHICH files changed. */
export function fingerprints(files) {
  const out = {};
  for (const [k, v] of Object.entries(files)) {
    const extra = EXTRA_CHANNELS.some((c) => k.startsWith('/c/' + c + '/'));
    out[(extra ? k : k.replace(/^\/c\/[^/]+/, '/c/…')).split('?')[0]] = createHash('sha256').update(v).digest('hex').slice(0, 12);
  }
  return Object.fromEntries(Object.entries(out).sort());
}

export function diffPrints(cur, old) {
  if (!old) return null;
  const changed = [], added = [], removed = [];
  for (const [k, h] of Object.entries(cur)) { if (!(k in old)) added.push(k); else if (old[k] !== h) changed.push(k); }
  for (const k of Object.keys(old)) if (!(k in cur)) removed.push(k);
  return { changed, added, removed };
}

/* ------------------------------------------------------------------ report */

function print(cur, R, meta) {
  const c = { b: (s) => `\x1b[1m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m` };
  const tty = process.stdout.isTTY;
  const f = (k, s) => (tty ? c[k](s) : s);
  console.log(f('b', `Legion 3D drift — ${meta.source}`));
  console.log(f('d', `scripts: ${cur.scripts.length}${meta.failed.length ? `, failed: ${meta.failed.length}` : ''} · snapshot: ${meta.snapAt || 'none'} · game data v${cur.gameDataVersion || '?'}`));
  console.log(`site: ${cur.buildings.length} buildings, ${cur.rooms.length} rooms, ${Object.values(cur.catalog).reduce((n, l) => n + l.length, 0)} looks, ${Object.keys(cur.gameData).length} data lists, ${cur.api.length} api paths, ${cur.questKinds.length} quest kinds`);
  for (const e of meta.errors) console.log(f('r', `! ${e}`));
  for (const e of meta.failed) console.log(f('y', `! download: ${e}`));
  console.log('\n' + f('b', 'Changed since the snapshot'));
  const ch = Object.entries(R.changes);
  if (!meta.snapAt) console.log(f('d', '  (no snapshot yet — run with --write)'));
  else if (!ch.length) console.log(f('g', '  nothing'));
  for (const [k, d] of ch) {
    if (d.added.length) console.log(`  ${k}: ${f('g', '+ ' + d.added.join(', '))}`);
    if (d.removed.length) console.log(`  ${k}: ${f('r', '− ' + d.removed.join(', '))}`);
  }
  console.log('\n' + f('b', 'Site ids without support (generic fallback in the game)'));
  const un = Object.entries(R.unsupported);
  if (!un.length) console.log(f('g', '  none'));
  for (const [k, l] of un) console.log(`  ${k}: ${f('y', l.join(', '))}`);
  console.log('\n' + f('b', 'Contract (what the extension is built on) — src/data/site-contract.json'));
  if (!meta.contract.length) console.log(f('g', `  all ${meta.contractN} checks found`));
  for (const c of meta.contract) console.log(`  ${f(c.severity === 'break' ? 'r' : 'y', (c.severity === 'break' ? 'BREAK ' : 'degrade ') + c.id)} — ${c.reason}${c.file ? ' in ' + c.file : ''} · ${c.why}`);
  console.log('\n' + f('b', 'Scripts changed since the snapshot (content hash)'));
  const fp = meta.prints;
  if (!fp) console.log(f('d', '  (no fingerprints in the snapshot yet — run with --write)'));
  else if (!fp.changed.length && !fp.added.length && !fp.removed.length) console.log(f('g', '  none'));
  else {
    if (fp.changed.length) console.log('  changed: ' + f('y', fp.changed.join(', ')));
    if (fp.added.length) console.log('  new: ' + f('g', fp.added.join(', ')));
    if (fp.removed.length) console.log('  gone: ' + f('r', fp.removed.join(', ')));
  }
  console.log('\n' + f('b', 'API paths we call that the site no longer mentions'));
  console.log(R.broken.length ? '  ' + f('r', R.broken.join(', ')) : f('g', '  none'));
  if (Object.keys(R.changes).length) console.log(f('d', '\nAfter updating the code: npm run drift -- --write   (see docs/EXTENDING.md)'));
}

async function main() {
  const args = process.argv.slice(2);
  const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
  const url = args.find((a) => !a.startsWith('--')) || DEFAULT_URL;
  const src = opt.local ? readLocal(opt.local) : await download(url);
  if (typeof opt.save === 'string') {   // keep a copy of the downloaded scripts (for a diff with an older copy)
    const { mkdirSync } = await import('node:fs');
    mkdirSync(opt.save, { recursive: true });
    for (const [k, v] of Object.entries(src.files)) writeFileSync(join(opt.save, k.split('/').pop()), v);
  }
  const { data, errors } = extract(src.files);
  const snap = existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, 'utf8')) : null;
  const sup = existsSync(SUPPORTED) ? JSON.parse(readFileSync(SUPPORTED, 'utf8')) : null;
  const R = compare(data, snap, sup, ourApi());
  const contract = existsSync(CONTRACT) ? JSON.parse(readFileSync(CONTRACT, 'utf8')) : { checks: [] };
  const contractFailed = checkContract(src.files, contract);
  if (!opt.local) {
    const origin = new URL(url).origin;
    const chans = typeof opt.channels === 'string' ? opt.channels.split(',').filter(Boolean) : EXTRA_CHANNELS;
    for (const ch of chans) {
      try {
        const html = await get(`${origin}/c/${ch}/`);
        for (const m of html.matchAll(/<script[^>]+src="(\/c\/[^/"]+\/[\w.-]+\.js)/g)) {
          try { src.files['/c/' + ch + '/' + m[1].split('/').pop()] = await get(origin + m[1]); } catch (e) { src.failed.push(String(e.message || e)); }
        }
        for (const f of ['cityfair.js', 'doodle.js', 'questfoes.js', 'questdungeon.js']) {
          const k = '/c/' + ch + '/' + f; if (src.files[k]) continue;
          try { src.files[k] = await get(`${origin}/c/${ch}/${f}`); } catch { /* not every channel loads every bundle up front */ }
        }
      } catch (e) { src.failed.push(`channel ${ch}: ${e.message || e}`); }
    }
    for (const f of EXTRA_FILES) { try { src.files[f] = await get(origin + f); } catch (e) { src.failed.push(String(e.message || e)); } }
  }
  const prints = fingerprints(src.files);
  const printDiff = diffPrints(prints, snap?.fingerprints);
  if (opt.json) console.log(JSON.stringify({ site: data, ...R, contract: contractFailed, scriptsChanged: printDiff, errors, failed: src.failed }, null, 2));
  else print(data, R, { source: opt.local ? `local ${opt.local}` : url, failed: src.failed, errors, snapAt: snap?.at, contract: contractFailed, contractN: contract.checks.length, prints: printDiff });
  if (opt.write) {
    if (errors.length) { console.error('\nnot writing the snapshot: extraction errors above'); process.exit(1); }
    const { scripts, ...rest } = data;
    const snapObj = { at: new Date().toISOString().slice(0, 10), source: opt.local ? 'local' : new URL(url).origin + '/c/…', scripts: scripts.map((s) => s.replace(/^\/c\/[^/]+/, '/c/…')), ...rest, fingerprints: prints };
    writeFileSync(SNAPSHOT, compactJson(snapObj) + '\n');
    console.log(`\nsnapshot written: ${SNAPSHOT.replace(ROOT + '/', '')}`);
  }
  // exit codes: 3 = a 'break' contract check failed or an endpoint we call vanished (the extension is likely broken);
  // 2 (--strict only) = anything new / changed / unsupported (review needed).
  if (contractFailed.some((c) => c.severity === 'break') || R.broken.length) process.exit(3);
  const anyChange = Object.keys(R.changes).length || Object.keys(R.unsupported).length || contractFailed.length
    || (printDiff && (printDiff.changed.length || printDiff.added.length || printDiff.removed.length));
  if (opt.strict && anyChange) process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error(e); process.exit(1); });
