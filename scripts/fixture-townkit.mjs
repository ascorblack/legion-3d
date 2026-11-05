#!/usr/bin/env node
// Test/dev fixture of a «Town Kit» district town (site 05.11: tk-map.js window.LGTownKitMap, tk-city.js LGTownKitCity;
// city.js buildKit for a district town with `TOWN.kit` = window.LGTownKitTowns[id] from /site/towns/<id>.js, only when
// /api/city/towns marks the town `nw` and /api/me has `tn`). Numbers only → test/fixtures/townkit-map.json:
//   - `T`: the kit input (the town spec the site's /site/towns/<id>.js carries);
//   - `cfg`: building levels / constructions the fixture is built with (townMeta levels + building), `lvMap` = mapLevels();
//   - `levelled`: LGTownKitMap.levelled(T, lvMap) — every building's plot at its level (vis / foot shrink below level 5);
//   - `OBST`, `grid` (levels 0 blocked, 1 town, 2 tier, 3 stairs), `home`, `spawn`: townAt(T, lvMap) = make() of the kit.
// Without a published kit town the input is the cats fair's own geometry (fc-map.js, itself built on LGTownKitMap since
// 05.11) restated as a kit spec — the kit is the generalisation of that map; a kit file of the site can be given instead.
//   node scripts/fixture-townkit.mjs <site copy dir> [--kit=<file of /site/towns/<id>.js>] [--id=d06] [--biome=forest]
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return [a.slice(2, i < 0 ? undefined : i), i < 0 ? '1' : a.slice(i + 1)]; }));
if (!dir) { console.error('usage: node scripts/fixture-townkit.mjs <dir with tk-map.js, fc-map.js> [--kit=file] [--id=..] [--biome=..]'); process.exit(1); }
const G0 = { console, Math, JSON, Date, Map, Set, Uint8Array, Uint32Array, Int32Array, Float32Array, Object, Array, Number, String, Infinity, NaN };
const load = (file, req) => { const module = { exports: {} }; vm.runInNewContext(readFileSync(join(dir, file), 'utf8'), { ...G0, module, exports: module.exports, require: req }, { timeout: 20000 }); return module.exports; };
const K = load('tk-map.js');
if (!K || typeof K.townAt !== 'function') { console.error('tk-map.js did not export LGTownKitMap'); process.exit(1); }
const plain = (o) => JSON.parse(JSON.stringify(o));
const NOW = 1798761600000;              // 2027-01-01: fixed clock of the fixture (constructions end in 2100)
const LATER = 4102444800000;

let T;
if (opt.kit) {
  const win = {};
  vm.runInNewContext(readFileSync(opt.kit, 'utf8'), { ...G0, window: win, self: win });
  const all = win.LGTownKitTowns || {};
  const id = opt.id || Object.keys(all)[0];
  T = all[id]; if (!T) { console.error('no kit town in', opt.kit); process.exit(1); }
  T = { ...plain(T), id: T.id || id };
} else {
  const F = load('fc-map.js', (p) => { if (/tkmap|tk-map/.test(p)) return K; throw new Error('require ' + p); });
  if (!F || typeof F.make !== 'function') { console.error('fc-map.js did not export LGFairCats'); process.exit(1); }
  // the fair's building obstacles at full size (lvl 5 `ob`: the tent's ellipse, the magic shop's annex…)
  const OB = F.obstacles();
  const obOf = (id) => OB.filter((o) => o.tag === 'building:' + id).map(({ tag, box, ...o }) => o);
  const P = F.PIER;
  T = {
    id: opt.id || 'kit', biome: opt.biome || 'forest', size: [3, 3], W: F.W, H: F.H, lv: 2, seed: 4242,
    town: F.TOWN,
    tiers: [{ lv: 2, poly: F.PLATEAU, rim: F.RIM, face: F.FACE, sides: [F.SIDE_W] }],
    rocks: [{ poly: F.MOUNT, rim: F.MRIM, face: F.MFACE }],
    // a district town has no jail cage
    buildings: F.BUILDINGS.filter((b) => b.id !== 'jail').map((b) => ({ ...plain(b), ...(obOf(b.id).length > 1 ? { ob: obOf(b.id) } : {}) })),
    houses: F.HOUSES, items: F.ITEMS, stairs: F.STAIRS,
    water: [{ id: 'pond', poly: F.POND }],
    bridges: [{ lv: 1, water: 'pond', rects: [[P.x0, P.y0 + 6, P.x1, P.y1 - 4], [P.end[0] + 8, P.end[1] + 8, P.end[2] - 8, P.end[3] - 6]] }],
    streets: F.STREETS, paths: F.PATHS, rails: F.RAILS,
    yards: [{ id: 'hall', r: [2980, 1196, 3200, 1260] }, { id: 'forge', r: [3690, 1196, 4122, 1380] }],
    wall: F.WALL, spawn: [2880, 2760],
  };
  T = plain(T);
}
// levels the way a channel's town grows: a few buildings below the top level, one construction running
const ids = (T.buildings || []).map((b) => b.id);
const cfg = { now: NOW, levels: {}, building: {} };
const want = { hall: 3, shop: 2, forge: 4, trainer: 1, tent: 5, auction: 3, board: 2, storage: 2 };
for (const [id, lv] of Object.entries(want)) if (ids.includes(id)) cfg.levels[id] = lv;
if (ids.includes('auction')) cfg.building.auction = { to: 4, until: LATER };
const lvMap = K.mapLevels(cfg.levels, cfg.building, NOW);
const M = K.townAt(T, lvMap);
const L = K.layoutOf(T);
const levelled = K.levelled(T, lvMap);
const spawn = L.spawn ? L.spawn.slice() : L.gate ? [L.gate.door.x, L.gate.door.y - 170] : [L.W / 2, L.H / 2];
// level-5 grid too: what the walk grid looks like once everything is built (plots change the obstacles)
const M5 = K.town(T, { levels: Object.fromEntries(ids.map((id) => [id, 5])) });
const runs = [];
for (let i = 0; i < M.G.length;) {
  if (M.G[i] === M5.G[i]) { i++; continue; }
  let n = 0; const v = M5.G[i];
  while (i + n < M.G.length && M5.G[i + n] === v && M.G[i + n] !== v) n++;
  runs.push([i, n, v]); i += n;
}
const out = {
  about: 'Town Kit district town (site tk-map.js window.LGTownKitMap / tk-city.js LGTownKitCity, 05.11): kit input T, levels, levelled plots, obstacles and walk grid (0 blocked, 1 town, 2 tier, 3 stairs) of townAt(T, mapLevels(levels, building)); generated by scripts/fixture-townkit.mjs. Tests and dev pages only.',
  source: opt.kit ? 'site kit file' : 'fc-map.js geometry as a kit spec',
  SPEED: K.SPEED, SCALE: K.SCALE, RAIL: K.RAIL, PAD: K.PAD, STAIR: K.STAIR, SHARE: K.SHARE, HSHARE: K.HSHARE, FIXED: K.FIXED,
  T, cfg, lvMap, levelKey: K.levelKey(T, lvMap),
  layout: { W: L.W, H: L.H, tiers: L.tiers.map((t) => ({ lv: t.lv, faces: t.faces })), rocks: L.rocks.map((t) => ({ faces: t.faces })), gate: L.gate ? L.gate.id : null },
  levelled: plain(levelled),
  OBST: plain(M.OB.map(({ box, ...o }) => o)),
  grid: { C: M.C, cols: M.cols, rows: M.rows, G: Array.from(M.G).join(''), lv5Patch: runs },
  home: M.home, spawn,
};
writeFileSync(join(ROOT, 'test/fixtures/townkit-map.json'), JSON.stringify(plain(out)) + '\n');
const lv = [0, 0, 0, 0]; for (const v of M.G) lv[v]++;
console.log(`townkit fixture (${out.source}): id ${T.id}, biome ${T.biome}, ${L.W}×${L.H}, ${levelled.length} buildings (levels ${levelled.map((b) => b.id + ':' + b.lvl).join(' ')}), ${L.houses.length} houses, ${L.items.length} items, ${L.tiers.length} tiers, ${L.rocks.length} rocks, ${L.water.length} water, ${L.stairs.length} stairs, ${M.OB.length} obstacles, grid ${M.cols}×${M.rows} levels ${lv.join('/')}, lv5 patch ${runs.length} runs → test/fixtures/townkit-map.json`);
if (!opt.kit) {
  // the kit restating the fair must walk like the fair (same obstacles, same rule): cells that differ from fc-map make()
  const F = load('fc-map.js', () => K), m = F.make({});
  const M5f = K.town(T, { levels: Object.fromEntries(ids.map((id) => [id, 5])) });
  let d = 0, dj = 0; for (let i = 0; i < m.G.length; i++) if (m.G[i] !== M5f.G[i]) { d++; if (Math.abs(m.G[i] - M5f.G[i]) > 0) dj++; }
  console.log(`parity with fc-map.js make() at level 5: ${d} of ${m.G.length} cells differ`);
}
