/**
 * Asset fingerprints of the site's 2D town art (fc-art.js window.LGFairCatsArt.draw for the cats fair, tk-art.js
 * window.LGTownKitArt.drawTown for Town Kit towns): every 3D model in src/world/fcart is pinned to the fingerprint of the
 * SVG asset it was made from (src/data/fcart-fp.json, written by scripts/fcart-fp.mjs), so a changed asset is detected
 * (scripts/drift.mjs «assets changed», the runtime notice in src/world/fcart/live.ts).
 *
 * Self-contained on purpose (no imports, erasable TypeScript only): node scripts import it directly
 * (`import … from '../src/world/fcart/fingerprint.ts'`, Node ≥ 22.18 strips the types), the page bundles it.
 *
 * What a fingerprint is: a 53-bit hash (14 hex digits) of the NORMALISED SVG of one asset —
 *   - generated ids (clipPath / gradient uids) renamed in order of appearance;
 *   - positions made relative to the asset's box (absolute path commands, x/y/cx/cy/x1/…, points, translate/rotate
 *     centres), geometry rounded to whole px, every other number to 2 decimals, whitespace collapsed;
 *   - assets whose drawing is seeded by their position (houses, decor items: tk-art.js rng(x0 + B), tree seeds…) are
 *     re-drawn by the site's own functions at a fixed canonical point (CANON) before hashing, so moving an item on the
 *     map changes nothing while changing how it is drawn changes its fingerprint;
 *   - one representative per ref: the most frequent variant (ties → the smallest hash); `n` = how many props the map
 *     draws for the ref, `v` = distinct variants, `box` = [w, h] px of the representative.
 * Refs (prefix '' for the fair, 'tk:' for a Town Kit town): building id ('hall', 'jail', …), 'house:<roof>' /
 * 'house:tavern', 'i:<kind>', and the map layers 'wall', 'tower', 'forest', 'terrain', 'plaza', 'stairs', 'ramp',
 * 'mine', 'mountain', 'pond', 'relief'.
 */

export interface ArtProp { x: number; y: number; w: number; h: number; z?: number; svg: string; ref?: string }
export interface ArtLayer { x: number; y: number; w: number; h: number; svg: string }
export interface ArtResult { props: ArtProp[]; layers?: ArtLayer[]; flat?: unknown[]; front?: unknown[]; P?: Record<string, string> }
/** One fingerprint row (src/data/fcart-fp.json). */
export interface FpEntry { fp: string; n: number; box: [number, number]; v?: number }
export type FpTable = Record<string, FpEntry>;
/** A normalised asset drawing. */
export interface FpSample { ref: string; svg: string; box: [number, number]; raw?: string; org?: [number, number] }

/** The map data needed to name props (fc-map.js LGFairCats or tk-map.js layoutOf(T)). */
export interface ArtMap {
  ITEMS?: readonly any[]; HOUSES?: readonly any[]; STAIRS?: readonly any[]; STREETS?: readonly any[]; POND?: readonly any[];
  MOUNT?: readonly any[];
  items?: readonly any[]; houses?: readonly any[]; stairs?: readonly any[]; streets?: readonly any[]; water?: readonly any[];
  buildings?: readonly any[]; rocks?: readonly any[]; W?: number; H?: number;
}
/** The site's art kit (window.LGTownKitArt: ITEM table, houseB, tree, pine, bush). */
export interface ArtKit { ITEM?: Record<string, (it: any, o?: any) => { svg: string; box: number[] }>; houseB?: (h: any, o: any) => string; tree?: (...a: any[]) => string; pine?: (...a: any[]) => string; bush?: (...a: any[]) => string }

/** Canonical point the position-seeded assets are re-drawn at (px). */
export const CANON = { x: 1000, y: 1000 };

/* ------------------------------------------------------------------ hash */
/** cyrb53 → 14 hex digits. */
export function hashStr(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, '0');
}

/* ------------------------------------------------------------------ normalisation */
const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi, HASNUM = /\d/;
const g0 = (v: number) => { const r = Math.round(v); return Object.is(r, -0) ? '0' : String(r); };
const n2 = (v: number) => { const r = Math.round(v * 100) / 100; return Object.is(r, -0) ? '0' : String(r); };
const X_ATTR = new Set(['x', 'cx', 'x1', 'x2', 'fx']), Y_ATTR = new Set(['y', 'cy', 'y1', 'y2', 'fy']);
const GEO_ATTR = new Set(['width', 'height', 'r', 'rx', 'ry']);

/** Path data with absolute coordinates shifted by (−ox, −oy), all numbers rounded to px. */
export function normPath(d: string, ox: number, oy: number): string {
  const out: string[] = [];
  let cmd = '', idx = 0;
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    if (m[1]) { cmd = m[1]; idx = 0; out.push(cmd); continue; }
    let v = +m[2];
    switch (cmd) {
      case 'M': case 'L': case 'T': case 'C': case 'S': case 'Q': v -= idx % 2 ? oy : ox; break;
      case 'H': v -= ox; break;
      case 'V': v -= oy; break;
      case 'A': { const k = idx % 7; if (k === 5) v -= ox; else if (k === 6) v -= oy; break; }
      default: break;
    }
    out.push(g0(v)); idx++;
  }
  return out.join(' ');
}

/** Normalised SVG of an asset drawn with its box origin at (ox, oy) (see the header). */
export function normSvg(svg: string, ox: number, oy: number): string {
  // ids → #1, #2 … in order of appearance (uids depend on how much was drawn before)
  const ids = new Map<string, string>();
  svg.replace(/\bid="([^"]+)"/g, (_, id: string) => { if (!ids.has(id)) ids.set(id, 'i' + (ids.size + 1)); return ''; });
  let s = svg.replace(/\s+/g, ' ');
  if (ids.size) s = s.replace(/\bid="([^"]+)"|url\(#([^)]+)\)|href="#([^"]+)"/g, (all, a?: string, b?: string, c?: string) => {
    if (a) return `id="${ids.get(a) ?? a}"`;
    if (b) return `url(#${ids.get(b) ?? b})`;
    return `href="#${ids.get(c!) ?? c}"`;
  });
  return s.replace(/<([a-zA-Z][\w:-]*)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g, (_, tag: string, attrs: string, close: string) => {
    const a = attrs.replace(/([\w:-]+)\s*=\s*"([^"]*)"/g, (__, name: string, val: string) => {
      let v = val;
      if (X_ATTR.has(name) && HASNUM.test(val)) v = val.replace(NUM, (q) => g0(+q - ox));
      else if (Y_ATTR.has(name) && HASNUM.test(val)) v = val.replace(NUM, (q) => g0(+q - oy));
      else if (GEO_ATTR.has(name)) v = val.replace(NUM, (q) => g0(+q));
      else if (name === 'd') v = normPath(val, ox, oy);
      else if (name === 'points') { let i = 0; v = val.replace(NUM, (q) => g0(+q - (i++ % 2 ? oy : ox))); }
      else if (name === 'transform') {
        v = val.replace(/translate\(\s*([^)]*)\)/g, (___, t: string) => { let i = 0; return 'translate(' + t.replace(NUM, (q) => g0(+q - (i++ % 2 ? oy : ox))) + ')'; })
          .replace(/rotate\(\s*([^)]*)\)/g, (___, t: string) => { let i = 0; return 'rotate(' + t.replace(NUM, (q) => { const k = i++; return k === 0 ? n2(+q) : g0(+q - (k === 1 ? ox : oy)); }) + ')'; })
          .replace(/(scale|matrix|skewX|skewY)\(([^)]*)\)/g, (___, f: string, t: string) => `${f}(${t.replace(NUM, (q) => n2(+q))})`);
      } else if (!val.includes('#')) v = val.replace(NUM, (q) => n2(+q));   // colours / url(#id) stay as they are
      return ` ${name}="${v}"`;
    });
    return `<${tag}${a}${close ? '/' : ''}>`;
  }).replace(/(>)\s+|\s+(<)/g, '$1$2').trim();
}

/* ------------------------------------------------------------------ naming */
const bboxOf = (pts: readonly any[] | undefined): [number, number, number, number] | null => {
  if (!pts || !pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { const x = +p[0], y = +p[1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
};
const near = (a: number, b: number, d = 2) => Math.abs(a - b) <= d;

/** Name of a big map layer (not a CH grid tile) by its box; null for a grid tile. */
export function layerRef(l: ArtLayer, map: ArtMap): string | null {
  const x1 = l.x + l.w, y1 = l.y + l.h;
  if (l.w === l.h && (l.w === 940 || l.w === 1200)) return null;   // CH = 640 tiles with a 150 / 280 px margin
  if (near(l.x, -40) && near(l.y, -40)) return 'terrain';
  const streets = map.STREETS ?? map.streets ?? [];
  for (const s of streets) if (s && s.rr && near(l.x, s.rr[0]) && near(l.y, s.rr[1]) && near(x1, s.rr[2]) && near(y1, s.rr[3])) return 'plaza';
  for (const s of map.STAIRS ?? map.stairs ?? []) if (near(l.x, s.x0 - 30) && near(l.y, s.y0 - 30) && near(x1, s.x1 + 30)) return s.k === 'ramp' ? 'ramp' : 'stairs';
  const mine = (map.buildings ?? []).find((b: any) => b && b.id === 'mine');
  if (mine && near(l.x, mine.door.x - 230) && near(x1, mine.door.x + 230)) return 'mine';
  if (!map.buildings && near(l.x, 4700) && near(x1, 5160) && near(l.y, 660)) return 'mine';   // fc-art.js minePortal at x 4925
  const mb = bboxOf(map.MOUNT) ?? bboxOf((map.rocks ?? [])[0]?.poly);
  if (mb && l.x >= mb[0] - 220 && y1 <= mb[3] + 200 && l.x < mb[2]) return 'mountain';
  const pb = bboxOf(map.POND) ?? bboxOf((map.water ?? [])[0]?.poly);
  if (pb && l.x <= pb[0] && x1 >= pb[2] && l.y <= pb[1] && y1 >= pb[3] && l.w < 1200) return 'pond';
  return 'relief';
}

/** A draw() prop's ref → model ref ('' = skip: south forest band / edge trees are named 'forest' elsewhere). */
export function propRef(p: ArtProp, map: ArtMap): string {
  const r = p.ref;
  if (!r || r === 'south' || r === 'edge') return 'forest';
  if (r.startsWith('b:')) return r.slice(2);
  if (r.startsWith('h:')) {
    const id = r.slice(2), h = (map.HOUSES ?? map.houses ?? []).find((q: any) => q && q.id === id);
    return h ? (h.k === 'tavern' ? 'house:tavern' : 'house:' + (h.roof || 'red')) : 'house:?';
  }
  if (r.startsWith('i:')) { const it = (map.ITEMS ?? map.items ?? [])[+r.slice(2)]; return it ? 'i:' + it.k : 'i:?'; }
  return r;   // wall, tower, build, own …
}

/* ------------------------------------------------------------------ samples */
/** Shift an item to the canonical point (x2 / y2 with it). */
function canonItem(it: any): any {
  const dx = CANON.x - (+it.x || 0), dy = CANON.y - (+it.y || 0), o = { ...it, x: CANON.x, y: CANON.y };
  if (typeof it.x2 === 'number') o.x2 = it.x2 + dx;
  if (typeof it.y2 === 'number') o.y2 = it.y2 + dy;
  return o;
}
/** The first piece draw() makes of an item (fences longer than one span are cut in 60 / 240 px pieces). */
function itemPiece(A: (it: any, o?: any) => { svg: string; box: number[] }, it: any, o: any): { svg: string; box: number[] } {
  const fence = it.k === 'fence' || it.k === 'wattle';
  if (fence && it.x === it.x2) { const a = Math.min(it.y, it.y2), b = Math.max(it.y, it.y2); return A({ ...it, y: a, y2: Math.min(b, a + 60) }, o); }
  if (fence && Math.abs(it.x2 - it.x) > 240) { const a = Math.min(it.x, it.x2), b = Math.max(it.x, it.x2); return A({ ...it, x: a, x2: Math.min(b, a + 240) }, o); }
  return A(it, o);
}
const sampleOf = (ref: string, svg: string, box: readonly number[]): FpSample =>
  ({ ref, svg: normSvg(svg, Math.round(box[0]), Math.round(box[1])), box: [Math.round(box[2] - box[0]), Math.round(box[3] - box[1])], raw: svg, org: [box[0], box[1]] });

/**
 * Every asset drawing of one draw() result as normalised samples (several per ref). `kit` = the site's art kit
 * (window.LGTownKitArt): with it houses / items / forest trees are re-drawn at CANON (position-free); without it the
 * draw() props are used as they are (then a position-seeded asset may differ per instance).
 */
export function artSamples(R: ArtResult, map: ArtMap, kit?: ArtKit | null, o: any = {}, prefix = ''): FpSample[] {
  const out: FpSample[] = [], seen = new Set<string>();
  const add = (s: FpSample) => out.push({ ...s, ref: prefix + s.ref });
  // map layers drawn once (G.big): terrain, plaza, stairs, ramp, mine, mountain, pond, relief
  for (const l of R.layers ?? []) { const ref = layerRef(l, map); if (ref) add(sampleOf(ref, l.svg, [l.x, l.y, l.x + l.w, l.y + l.h])); }
  const items = map.ITEMS ?? map.items ?? [], houses = map.HOUSES ?? map.houses ?? [];
  R.props.forEach((p) => {
    const ref = propRef(p, map);
    if (kit && ref === 'forest') return;   // re-drawn below
    if (kit && kit.ITEM && p.ref && p.ref.startsWith('i:')) {
      const idx = +p.ref.slice(2), it = items[idx], A = it && kit.ITEM[it.k];
      if (A && !seen.has(p.ref)) { seen.add(p.ref); const q = itemPiece(A, canonItem(it), o); add(sampleOf(ref, q.svg, q.box)); }
      if (A) return;
    }
    if (kit && kit.houseB && p.ref && p.ref.startsWith('h:')) {
      const i = houses.findIndex((q: any) => q && 'h:' + q.id === p.ref), h = houses[i];
      if (h) {
        const dx = CANON.x - h.vis[0], dy = CANON.y - h.vis[3], hv = [h.vis[0] + dx, h.vis[1] + dy, h.vis[2] + dx, h.vis[3] + dy];
        const hc = { ...h, vis: hv, foot: h.foot ? [h.foot[0] + dx, h.foot[1] + dy, h.foot[2] + dx, h.foot[3] + dy] : h.foot, door: { x: h.door.x + dx, y: h.door.y + dy } };
        add(sampleOf(ref, kit.houseB(hc, { roofCat: i % 2 === 0 }), [hv[0] - 30, hv[1] - 80, hv[2] + 80, hv[3] + 20]));
        return;
      }
    }
    add(sampleOf(ref, p.svg, [p.x, p.y, p.x + p.w, p.y + p.h]));
  });
  if (kit && kit.tree && kit.pine) {
    // the forest round the town: its two tree drawings at CANON (fc-art.js forest(): tree(…,'dark') / pine(…, true)) + a bush
    const { x, y } = CANON;
    const svg = kit.tree(x, y, 1, 7, 'dark') + kit.pine(x + 200, y, 1, 7, true) + (kit.bush ? kit.bush(x + 400, y, 1, 3) : '');
    const n = (R.flat?.length ?? 0) + (R.front?.length ?? 0) + R.props.filter((p) => !p.ref || p.ref === 'edge').length;
    const s = sampleOf('forest', svg, [x - 80, y - 200, x + 480, y + 10]);
    for (let i = 0; i < Math.max(1, n); i++) add(s);
  }
  return out;
}

/** Samples → one row per ref (representative = most frequent variant, ties → smallest hash). */
export function fingerprints(samples: readonly FpSample[]): FpTable {
  const by = new Map<string, Map<string, { c: number; box: [number, number] }>>();
  const cnt = new Map<string, number>();
  for (const s of samples) {
    let m = by.get(s.ref); if (!m) by.set(s.ref, (m = new Map()));
    const h = hashStr(s.svg), e = m.get(h);
    if (e) e.c++; else m.set(h, { c: 1, box: s.box });
    cnt.set(s.ref, (cnt.get(s.ref) ?? 0) + 1);
  }
  const out: FpTable = {};
  for (const ref of [...by.keys()].sort()) {
    const m = by.get(ref)!;
    let best = '', bc = -1;
    for (const [h, e] of m) if (e.c > bc || (e.c === bc && h < best)) { best = h; bc = e.c; }
    out[ref] = { fp: best, n: cnt.get(ref)!, box: m.get(best)!.box, ...(m.size > 1 ? { v: m.size } : {}) };
  }
  return out;
}

/** The representative normalised SVG of every ref (for the reference dumps). */
export function representatives(samples: readonly FpSample[], table: FpTable): Map<string, FpSample> {
  const out = new Map<string, FpSample>();
  for (const s of samples) if (!out.has(s.ref) && table[s.ref] && hashStr(s.svg) === table[s.ref].fp) out.set(s.ref, s);
  return out;
}

/** Rows that differ between a pinned table and a live one. */
export interface FpDiff { changed: string[]; added: string[]; removed: string[] }
export function diffFingerprints(pinned: FpTable, live: FpTable, only?: (ref: string) => boolean): FpDiff {
  const keep = only ?? (() => true);
  const changed: string[] = [], added: string[] = [], removed: string[] = [];
  for (const r of Object.keys(live).sort()) if (keep(r)) { if (!pinned[r]) added.push(r); else if (pinned[r].fp !== live[r].fp) changed.push(r); }
  for (const r of Object.keys(pinned).sort()) if (keep(r) && !live[r]) removed.push(r);
  return { changed, added, removed };
}
