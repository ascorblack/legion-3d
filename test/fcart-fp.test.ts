// Asset fingerprints (src/world/fcart/fingerprint.ts, scripts/fcart-fp.mjs, scripts/drift.mjs «assets changed»,
// runtime check src/world/fcart/live.ts) and the registry wiring of src/world/faircats.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { normSvg, normPath, hashStr, artSamples, fingerprints, diffFingerprints, CANON, type ArtResult, type ArtKit } from '../src/world/fcart/fingerprint';
import { checkFcModels, noteFcModel, staleText, _resetFcLive } from '../src/world/fcart/live';
import { driftList, _resetDrift } from '../src/core/drift';
import PINNED from '../src/data/fcart-fp.json';

/* a tiny fake art kit: a position-seeded tree (like tk-art.js tree(x, y, s, seed)) and a house */
const rng = (s: number) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
const mkKit = (leaf = '#3b6b40'): ArtKit => ({
  ITEM: {
    tree: (it: any) => {
      const r = rng(Math.round(it.x * 3 + it.y)), k = 0.9 + r() * 0.2;
      return { svg: `<path d="M${it.x - 9} ${it.y} C${it.x - 6} ${it.y - 30} ${it.x} ${it.y - 60} ${it.x + 4} ${it.y - 70} l3 4 Z" fill="${leaf}"/><circle cx="${it.x}" cy="${(it.y - 92 * k).toFixed(1)}" r="${(64 * k).toFixed(1)}" fill="${leaf}"/>`, box: [it.x - 76, it.y - 166, it.x + 76, it.y + 6] };
    },
  },
  houseB: (h: any) => `<clipPath id="u${Math.round(h.vis[0])}"><rect x="${h.vis[0]}" y="${h.vis[1]}" width="${h.vis[2] - h.vis[0]}" height="${h.vis[3] - h.vis[1]}"/></clipPath><g clip-path="url(#u${Math.round(h.vis[0])})"><rect x="${h.vis[0]}" y="${h.vis[1] + 40}" width="80" height="60" fill="#c8402a"/></g>`,
  tree: (x: number, y: number) => `<circle cx="${x}" cy="${y - 90}" r="60" fill="#2c5532"/>`,
  pine: (x: number, y: number) => `<path d="M${x} ${y - 180} L${x + 60} ${y} H${x - 60} Z" fill="#244a2c"/>`,
});
const map = (items: any[], houses: any[] = []) => ({ ITEMS: items, HOUSES: houses, STAIRS: [], STREETS: [] });
const drawOf = (K: ArtKit, M: ReturnType<typeof map>): ArtResult => ({
  props: [
    ...M.ITEMS.map((it, i) => { const q = K.ITEM!.tree(it); return { x: q.box[0], y: q.box[1], w: q.box[2] - q.box[0], h: q.box[3] - q.box[1], svg: q.svg, ref: 'i:' + i }; }),
    ...M.HOUSES.map((h) => ({ x: h.vis[0] - 30, y: h.vis[1] - 80, w: 400, h: 300, svg: K.houseB!(h, {}), ref: 'h:' + h.id })),
    { x: 100, y: 2860, w: 420, h: 150, svg: '<rect x="100" y="2874" width="400" height="120" fill="#8f766b"/>', ref: 'wall' },
  ],
  layers: [], flat: [{}, {}], front: [],
});
const fpOf = (K: ArtKit, M: ReturnType<typeof map>) => fingerprints(artSamples(drawOf(K, M), M, K));

describe('asset fingerprints (fingerprint.ts)', () => {
  it('normalises position: absolute coordinates relative to the box, relative path commands untouched, ids renumbered', () => {
    const at = (x: number, y: number, id: string) => `<g transform="translate(${x + 5} ${y + 5})"><clipPath id="${id}"><rect x="${x}" y="${y}" width="40" height="20"/></clipPath><path d="M${x} ${y} l10 -5 Q${x + 4} ${y + 9} ${x + 8} ${y} H${x + 30} V${y + 12} A4 4 0 0 1 ${x + 2} ${y + 3} Z" clip-path="url(#${id})" fill="#3e5aa8" opacity=".22"/><polygon points="${x},${y} ${x + 3},${y + 4}"/></g>`;
    const a = normSvg(at(1234.4, 2001.1, 'fcW7'), 1234, 2001), b = normSvg(at(300.4, 50.1, 'fcW91'), 300, 50);
    expect(a).toBe(b);
    expect(a).toContain('fill="#3e5aa8"');   // colours are never read as numbers (#3e5…)
    expect(a).toContain('url(#i1)');
    expect(normPath('M10 20 l5 5 h3', 10, 20)).toBe('M 0 0 l 5 5 h 3');
  });
  it('moving an item (or a house) changes nothing; editing its drawing changes its fp', () => {
    const items = [{ k: 'tree', x: 400, y: 600 }, { k: 'tree', x: 900, y: 1300 }, { k: 'tree', x: 1500, y: 700 }];
    const houses = [{ id: 'h1', k: 'house', roof: 'red', vis: [1000, 2000, 1300, 2204], foot: [1010, 2050, 1290, 2204], door: { x: 1150, y: 2224 } }];
    const K = mkKit(), base = fpOf(K, map(items, houses));
    expect(Object.keys(base).sort()).toEqual(['forest', 'house:red', 'i:tree', 'wall']);
    expect(base['i:tree'].n).toBe(3);
    const moved = fpOf(K, map(items.map((it, i) => ({ ...it, x: it.x + 137 * (i + 1), y: it.y - 51 })), [{ ...houses[0], vis: [1400, 2100, 1700, 2304], foot: [1410, 2150, 1690, 2304], door: { x: 1550, y: 2324 } }]));
    expect(moved).toEqual(base);
    const edited = fpOf(mkKit('#5a9a4a'), map(items, houses));
    expect(edited['i:tree'].fp).not.toBe(base['i:tree'].fp);
    expect(edited['house:red'].fp).toBe(base['house:red'].fp);
    expect(diffFingerprints(base, edited)).toEqual({ changed: ['i:tree'], added: [], removed: [] });
    // the re-draw point is fixed
    expect(CANON).toEqual({ x: 1000, y: 1000 });
  });
  it('hash: 14 hex digits, stable', () => {
    expect(hashStr('abc')).toMatch(/^[0-9a-f]{14}$/);
    expect(hashStr('abc')).toBe(hashStr('abc'));
    expect(hashStr('abc')).not.toBe(hashStr('abd'));
  });
  it('src/data/fcart-fp.json has the fair\'s refs in the format { fp, n, box }', () => {
    const T = PINNED as unknown as Record<string, { fp: string; n: number; box: number[] }>;
    for (const r of ['hall', 'jail', 'magic', 'tent', 'storage', 'gate', 'house:tavern', 'house:teal', 'i:lamp', 'i:tree', 'wall', 'tower', 'forest', 'terrain', 'plaza', 'stairs', 'ramp', 'mountain', 'mine']) {
      expect(T[r], r).toBeTruthy();
      expect(T[r].fp).toMatch(/^[0-9a-f]{14}$/);
      expect(T[r].n).toBeGreaterThan(0);
      expect(T[r].box.length).toBe(2);
    }
    expect(Object.keys(T).some((r) => r.startsWith('tk:'))).toBe(true);
  });
});

// with a local copy of the site's scripts (never in the repo): the real draw()
// the copy the pinned src/data/fcart-fp.json was made from (10.11: the fair's signpost texts changed)
const SITE = ['.local/site-1110-0007'].map((d) => resolve(__dirname, '..', d)).find((d) => existsSync(resolve(d, 'fc-art.js')));
describe.skipIf(!SITE)('asset fingerprints of the real fc-art.js (local site copy)', () => {
  it('the pinned table is what the copy draws; moving every decor item and house changes no fingerprint', async () => {
    const { siteModules, liveFingerprints } = (await import('../scripts/fcart-fp.mjs' as string)) as any;
    const live = liveFingerprints(SITE!).table as Record<string, { fp: string }>;
    const fair = Object.fromEntries(Object.entries(live).filter(([r]) => !r.startsWith('tk:')));
    const { F, A, K } = siteModules(SITE!);
    for (const it of F.ITEMS) { it.x += 37; it.y -= 23; if (typeof it.x2 === 'number') { it.x2 += 37; it.y2 -= 23; } }
    for (const h of F.HOUSES) { for (const q of [h.vis, h.foot]) { q[0] += 50; q[2] += 50; q[1] += 10; q[3] += 10; } h.door.x += 50; h.door.y += 10; }
    const moved = fingerprints(artSamples(A.draw({}), F, K, {}));
    const items = (t: Record<string, any>) => Object.fromEntries(Object.entries(t).filter(([r]) => r.startsWith('i:') || r.startsWith('house:')));
    expect(items(moved)).toEqual(items(fair));
    // the pinned json matches this copy (re-run `node scripts/fcart-fp.mjs` after a new site copy)
    const P = PINNED as unknown as Record<string, { fp: string }>;
    expect(Object.keys(fair).filter((r) => P[r]?.fp !== fair[r].fp)).toEqual([]);
  });
  it('drift.mjs names a changed asset under «assets changed»', async () => {
    const { readFileSync } = await import('node:fs');
    const { assetDrift, assetLines } = (await import('../scripts/drift.mjs' as string)) as any;
    const files: Record<string, string> = {};
    for (const f of ['fc-art.js', 'fc-map.js', 'tk-art.js', 'tk-map.js']) files['/site/' + f] = readFileSync(resolve(SITE!, f), 'utf8');
    files['/site/fc-art.js'] = files['/site/fc-art.js'].replace(`let s = '<g data-ol="jail">';`, `let s = '<g data-ol="jail"><circle cx="3860" cy="2000" r="20" fill="#f00"/>';`);
    const as = await assetDrift(files);
    expect(as.changed).toEqual(['jail']);
    expect(assetLines(as)[0]).toMatch(/^assets changed: jail/);
  }, 30000);
});

describe('runtime asset check (fcart/live.ts)', () => {
  beforeEach(() => { _resetFcLive(); _resetDrift(); });
  const winOf = (K: ArtKit, M: ReturnType<typeof map>) => ({ LGFairCatsArt: { draw: () => drawOf(K, M) }, LGFairCats: M, LGTownKitArt: K });
  it('a model whose fp differs from the live asset is reported once: «модель X сделана по старой картинке сайта»', () => {
    const M = map([{ k: 'tree', x: 400, y: 600 }]), K = mkKit();
    const live = fpOf(K, M);
    noteFcModel('i:tree', 'deadbeef000000');   // made from an older picture
    noteFcModel('wall', live.wall.fp);          // up to date
    expect(checkFcModels(winOf(K, M), { kind: 'fc' })).toEqual(['i:tree']);
    const l = driftList();
    expect(l.length).toBe(1);
    expect(l[0].kind).toBe('asset');
    expect(l[0].id).toBe(staleText('i:tree'));
    expect(l[0].id).toBe('модель i:tree сделана по старой картинке сайта');
  });
  it('nothing is computed without a model built or without the art on the page', () => {
    let calls = 0;
    const M = map([{ k: 'tree', x: 400, y: 600 }]), K = mkKit();
    const win = { LGFairCatsArt: { draw: () => { calls++; return drawOf(K, M); } }, LGFairCats: M, LGTownKitArt: K };
    expect(checkFcModels(win, { kind: 'fc' })).toEqual([]);
    expect(calls).toBe(0);
    noteFcModel('i:tree', 'x');
    expect(checkFcModels({}, { kind: 'fc' })).toEqual([]);
    checkFcModels(win, { kind: 'fc' }); checkFcModels(win, { kind: 'fc' });
    expect(calls).toBe(1);   // once per town
  });
});
