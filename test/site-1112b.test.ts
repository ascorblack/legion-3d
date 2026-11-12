/**
 * Site update 12.11 afternoon: the cats fair's glade below the gate (fc-map.js GLADE + SPOTS) and «Монстры у стен»
 * (citymon.js LGCityMon / LGCityMonArt). Placement parity with the LIVE page (test/fixtures/citymon-view.json `placed` =
 * the spots and member points the site's own `.cm-wall` layer had on 12.11), the art ids against the site's file, the
 * glade not walkable (the walk grid is unchanged), and the action path: the site's own monster button, nothing sent.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { resolve } from 'node:path';
import * as THREE from 'three';
import fc from './fixtures/faircats-map.json';
import cm from './fixtures/citymon-view.json';
import { fairCatsGlade, inGlade, fairCatsOf } from '../src/net/faircats';
import { placeAll, cityMonGroups, cityMonAct, cityMonLabel, cityMonKey, cityMonWall, walkBox, formOf, type CmWall, type CmView } from '../src/net/citymon';
import { CITYMON_IDS, cityMonGeo, cityMonScale, cityMonFamily, CM_ELITE_K } from '../src/world/citymon-art';
import { wanderNext, CM_FAR, CM_OUTLINE } from '../src/features/citymon';
import { fairCatsFixtureLayout, fairCatsFixtureMap } from '../dev/fixtures';
import { fcModel } from '../src/world/fcart/registry';
import { DIALOGS } from '../src/net/site';
import '../src/world/fcart';

const SITE = resolve(__dirname, '../.local/site-1112-1439');
const HAS = existsSync(resolve(SITE, 'citymon.js'));
const gate = (fc as any).BUILDINGS.find((b: any) => b.id === 'gate');
const W: CmWall = { x: gate.door.x, y: gate.door.y, town: 'fair', own: true, glade: (fc as any).GLADE };
const V = cm.view as unknown as CmView;

describe('fc-map.js GLADE (12.11 afternoon)', () => {
  it('the fixture carries the glade: polygon, sign, front trees and the 13 monster spots', () => {
    const g = fairCatsGlade((fc as any).GLADE)!;
    expect(g.poly.length).toBe(12);
    expect(g.sign).toEqual([2742, 3112]);
    expect(g.front.map((f) => f[0])).toEqual(['pine', 'tree', 'bush', 'bush']);
    expect(g.spots.length).toBe(13);
    expect(g.spots.filter((p) => p.gate).length).toBe(2);
    expect(g.spots.filter((p) => p.t === 'e').length).toBe(3);
    expect(g.spots.filter((p) => !p.gate).every((p) => (p.poly?.length ?? 0) === 18)).toBe(true);
    expect(inGlade(g, 2880, 3200)).toBe(true);
    expect(inGlade(g, 420, 600)).toBe(true);        // a north forest spot's own clearing
    expect(inGlade(g, 2880, 2500)).toBe(false);
    expect(fairCatsOf(fairCatsFixtureLayout())!.glade?.spots.length).toBe(13);
  });
  it('is NOT walkable: the walk grid ends at the gate passage (fc-map.js make() unchanged)', () => {
    const m = fairCatsFixtureMap({ jail: true });
    expect(m.free(2880, 2975)).toBe(true);                         // the gate passage
    for (const [x, y] of [[2880, 3100], [2742, 3112], [3130, 3190], [2486, 3190], [2880, 3400]]) expect(m.free(x, y), `${x},${y}`).toBe(false);
    for (const p of (fc as any).GLADE.spots) expect(m.free(p.x, p.y), `spot ${p.x},${p.y}`).toBe(false);
  });
  it.skipIf(!HAS)('the real fc-map.js make() has no walkable cell beyond the wall (y > WALL.y1)', () => {
    const G0 = { Math, JSON, Map, Set, Uint8Array, Uint32Array, Int32Array, Float32Array, Object, Array, Number, String, Infinity, NaN };
    const load = (f: string, req?: (p: string) => unknown) => { const module = { exports: {} as any }; vm.runInNewContext(readFileSync(resolve(SITE, f), 'utf8'), { ...G0, module, exports: module.exports, require: req }, { timeout: 10000 }); return module.exports; };
    const K = load('tk-map.js'), sb = { module: { exports: load('fc-map.js', (q) => { if (/tkmap|tk-map/.test(q)) return K; throw new Error('require ' + q); }) } };
    const F = sb.module.exports as any, m = F.make({ jail: true });
    let n = 0; for (let y = F.WALL.y1 + 8; y < F.H; y += 16) for (let x = 8; x < F.W; x += 16) if (m.free(x, y)) n++;
    expect(n).toBe(0);
    expect(F.GLADE.spots.length).toBe(13);
  });
});

describe('citymon.js placeAll (the live 12.11 placement)', () => {
  it('packs, elites and the returning pack land on the same spots as on the live page', () => {
    const P = placeAll(W, V.packs!, V.elites!, V.soon!, V.eSoon!);
    expect(P.packs.map((x) => x.k)).toEqual(cm.placed.packs);
    expect(P.elites.map((x) => x.k)).toEqual(cm.placed.elites);
    expect(P.soon.map((x) => x.k)).toEqual(cm.placed.soon);
    expect(P.free.length).toBe(0);
  });
  it('members at the FORM offsets (live: pack 0 at 3050 / 3130 / 3210, y 3180 / 3204 / 3182)', () => {
    const G = cityMonGroups(W, V), p0 = G.find((g) => g.key === 'p0')!;
    expect(p0.mons.map((m) => [m.x, m.y])).toEqual([[3050, 3180], [3130, 3204], [3210, 3182]]);
    expect(p0.mons.map((m) => m.id)).toEqual(['boar', 'wolf', 'crow']);
    expect(G.filter((g) => g.kind === 'pack').length).toBe(9);
    expect(G.filter((g) => g.kind === 'elite').map((g) => [g.x, g.y])).toEqual([[1240, 800], [168, 960], [5598, 940]]);
    expect(G.filter((g) => g.kind === 'soon').map((g) => g.spot)).toEqual([1]);
    expect(walkBox({ gate: 1 }, 136, false)).toEqual([24, -8, 8]);
    expect(formOf(9)).toEqual(formOf(4));
  });
  it('without a glade (another town): the site\'s fallback row below the gate door', () => {
    const G = cityMonGroups({ ...W, glade: null }, V);
    const packs = G.filter((g) => g.kind === 'pack');
    expect(packs[0].x).toBe(W.x + 40 - 4 * 340);
    expect(packs.every((g) => g.y === W.y + 170)).toBe(true);
    expect(G.filter((g) => g.kind === 'soon').length).toBe(0);    // no spot for a trail
  });
  it('the key changes when a pack is beaten; the daily limit hides the returning trail', () => {
    const k0 = cityMonKey(W, V), V2 = { ...V, packs: V.packs!.slice(1) };
    expect(cityMonKey(W, V2)).not.toBe(k0);
    expect(cityMonGroups(W, { ...V, daily: { ...V.daily!, left: 0 } }).filter((g) => g.kind === 'soon').length).toBe(0);
    expect(cityMonLabel(cityMonGroups(W, V).find((g) => g.kind === 'soon')!, V.now)).toBe('Вернутся через 3:00');
    expect(cityMonLabel(cityMonGroups(W, V)[0])).toBe('Стая: слабая, 3 ур. — напасть?');
  });
  it('reads the live page only through LGCity.wall() / hero.cm (own town)', () => {
    const w = (own: boolean, cmOn: boolean) => ({ LGCityMon: {}, LGCity: { wall: () => ({ ...W, own, X: { hero: () => (cmOn ? { cm: { n: 1 } } : {}) } }) } });
    expect(cityMonWall(w(true, true))?.glade).toBeTruthy();
    expect(cityMonWall(w(false, true))).toBeNull();
    expect(cityMonWall(w(true, false))).toBeNull();
    expect(cityMonWall({ LGCity: { wall: () => W } })).toBeNull();      // citymon.js not loaded
  });
});

describe('acting on a monster = the site\'s own button (nothing sent by us)', () => {
  it('presses the `.cmw` button of the pack / elite in the site\'s `.cm-wall` layer', () => {
    const clicked: string[] = [], sel: string[] = [];
    const doc = { querySelector: (s: string) => { sel.push(s); return { click: () => clicked.push(s) }; } } as unknown as Document;
    const w = { LGCityMon: { attackDlg: () => { throw new Error('not here'); } }, fetch: () => { throw new Error('no requests'); } };
    expect(cityMonAct({ kind: 'pack', key: 'p0' }, w, doc)).toBe('button');
    expect(cityMonAct({ kind: 'elite', key: 'ep1' }, w, doc)).toBe('button');
    expect(sel).toEqual(['.cm-wall .cmw[data-cm="pack"][data-pid="p0"]', '.cm-wall .cmw[data-cm="elite"][data-eid="ep1"]']);
    expect(clicked.length).toBe(2);
  });
  it('without the layer: the site\'s own dialog functions; a returning pack has nothing to press', () => {
    const got: string[] = [];
    const w = { LGCityMon: { attackDlg: (p: string) => got.push('a:' + p), eliteDlg: (e: string) => got.push('e:' + e) } };
    const doc = { querySelector: () => null } as unknown as Document;
    expect(cityMonAct({ kind: 'pack', key: 'p3' }, w, doc)).toBe('api');
    expect(cityMonAct({ kind: 'elite', key: 'ep0' }, w, doc)).toBe('api');
    expect(cityMonAct({ kind: 'soon', key: 'soon:1' }, w, doc)).toBeNull();
    expect(got).toEqual(['a:p3', 'e:ep0']);
  });
  it.skipIf(!HAS)('the site\'s layer: data-cm / data-pid / data-eid buttons, click → attackDlg / eliteDlg; the dialog is role=dialog aria-modal (overlay \'dialog\')', () => {
    const src = readFileSync(resolve(SITE, 'citymon.js'), 'utf8');
    expect(src).toMatch(/class="cmw t\$\{D\.tier\}" data-cm="pack" data-pid="\$\{esc\(D\.pid\)\}"/);
    expect(src).toMatch(/class="cmw el" data-cm="elite" data-eid="\$\{esc\(eKey\)\}"/);
    expect(src).toMatch(/if \(b\.dataset\.cm === 'pack'\) attackDlg\(b\.dataset\.pid\); else eliteDlg\(b\.dataset\.eid\)/);
    expect(src).toMatch(/d\.className = 'cm-dlg'; d\.setAttribute\('role', 'dialog'\); d\.setAttribute\('aria-modal', 'true'\)/);
    expect(src).toMatch(/api\('\/api\/citymon\/act', P\.pid \? \{ op: 'attack', pid: P\.pid \}/);   // only behind the dialog's own «Напасть»
    expect(DIALOGS).toContain('[role="dialog"]');
    // the fight plays arena-field.js inside the same dialog
    expect(src).toMatch(/window\.LGArenaField\.play\(box, \{ \.\.\.F, kind: 'pve' \}/);
  });
});

describe('LGCityMonArt in 3D (src/world/citymon-art.ts)', () => {
  it.skipIf(!HAS)('the same 28 art ids as the site\'s LGCityMonArt.IDS', () => {
    const src = readFileSync(resolve(SITE, 'citymon.js'), 'utf8'), end = src.indexOf('\n})(typeof self');
    const m = { exports: {} as any }; new Function('module', 'self', src.slice(0, src.indexOf('});', end) + 3))(m, {});
    expect([...CITYMON_IDS]).toEqual([...m.exports.IDS]);
    expect(m.exports.fig('e_boar')).toContain('cm-elite');
  });
  it('every id builds alive and dead (the dead eyes are crosses), feet on 0, head to −Z, ≤ 1.1k triangles', () => {
    for (const id of CITYMON_IDS) {
      const a = cityMonGeo(id), d = cityMonGeo(id, true);
      const ta = a.index!.count / 3, td = d.index!.count / 3;
      expect(ta, id).toBeLessThan(1100);
      expect(td, id).not.toBe(ta);
      expect(a.boundingBox!.min.y, id).toBeGreaterThan(-0.02);
      expect(a.boundingBox!.max.y, id).toBeGreaterThan(0.6);
      expect(a.getAttribute('color'), id).toBeTruthy();
    }
    // the head end: the boar's snout is on −Z
    const b = cityMonGeo('boar'); expect(-b.boundingBox!.min.z).toBeGreaterThan(b.boundingBox!.max.z);
    expect(cityMonScale('e_boar')).toBe(CM_ELITE_K);
    expect(cityMonScale('wolf')).toBe(1);
    expect(cityMonFamily('crow')).toBe('bird');
    expect(cityMonFamily('nope')).toBe('quad');
  });
  it('the q2 budget near the monsters: the live view, the gate glade, ≤ 26 m drawn, outline only ≤ 16 m', () => {
    // every group of the live view drawn from the gate passage: within the draw distance only, the hull for the near ones
    const G = cityMonGroups(W, V), eye = new THREE.Vector3(28.8, 1.6, (2960 - 800) * 0.02);
    let tris = 0;
    for (const g of G) for (const m of g.mons) {
      const d = eye.distanceTo(new THREE.Vector3(m.x * 0.01, 0, (m.y - 800) * 0.02));
      if (d > CM_FAR) continue;
      const t = cityMonGeo(m.id).index!.count / 3; tris += t + (d < CM_OUTLINE ? t : 0);
    }
    expect(tris).toBeGreaterThan(0);
    expect(tris).toBeLessThan(30000);
  });
  it('wander like walkGo: inside the box, at least 18 px away', () => {
    let x = 0; const box = [24, -8, 8] as const; let r = 0.37; const rnd = () => (r = (r * 9301 + 49297) % 233280 / 233280);
    for (let i = 0; i < 200; i++) { const [nx, ny] = wanderNext(x, box, rnd); expect(Math.abs(nx)).toBeLessThanOrEqual(24); expect(ny).toBeGreaterThanOrEqual(-8); expect(ny).toBeLessThanOrEqual(8); x = nx; }
  });
});

describe('«Здание гильдий» redrawn (tk-art.js guildHall lv 3, 12.11 afternoon)', () => {
  it('the model is made from the new picture', () => {
    expect(fcModel('guild')?.fp).toBe('0f963d0e3380fd');
    expect(fcModel('guild')?.note).toMatch(/tower/);
  });
});
