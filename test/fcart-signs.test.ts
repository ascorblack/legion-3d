/**
 * fcart-signs: the signposts ('i:signpost') and the mine sign ('i:minesign') of the new fair carry real Russian text.
 * All of a town's signs are ONE instanced kind 'fc:signs' = 2 draw calls (flat: posts, slabs, paws; sign: the text plates with
 * UVs into the world's sign atlas), whatever their number. Checks: one kind / two parts / one placement, every `to` label of the
 * site's fc-map drawn once into the atlas, board count, arrow side per direction letter, plates upright on the ground, the
 * post stands on the ground, tri budget, atlas budget, and nothing in the static batch.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Batch } from '../src/world/batch';
import { paletteOf } from '../src/world/palette';
import { rng } from '../src/world/textures';
import { Instancer } from '../src/world/instancer';
import { toX, toZ } from '../src/world/coords';
import type { Ctx } from '../src/world/kit';
import type { SignAtlas } from '../src/world/textures';
import fx from './fixtures/faircats-map.json';
import { registerFcItemKinds, placeFcItem, signPattern } from '../src/world/fcart/houses';

type UV = [number, number, number, number];
/** A fake 2D context that records the text it is asked to draw. */
function fakeCanvas(texts: string[]): HTMLCanvasElement {
  const noop = () => undefined;
  const ctx: Record<string, unknown> = new Proxy({ fillText: (t: string) => { texts.push(t); }, measureText: () => ({ width: 10 }) } as Record<string, unknown>, {
    get: (o, p: string) => (p in o ? o[p] : noop), set: (o, p: string, v) => { o[p] = v; return true; },
  });
  return { width: 2048, height: 2048, getContext: () => ctx } as unknown as HTMLCanvasElement;
}
/** An atlas whose every cell is unique (so the plates can be told apart) and which records `add` + the drawn texts. */
function ctx(): { k: Ctx; adds: string[]; drawn: string[]; pieces: number; uvs: UV[] } {
  const adds: string[] = [], drawn: string[] = [], uvs: UV[] = [];
  const signs = {
    canvas: fakeCanvas(drawn), texture: { needsUpdate: false },
    add: (t: string) => { adds.push(t); const i = uvs.length, uv: UV = [(i % 4) / 4, Math.floor(i / 4) / 16, (i % 4 + 1) / 4, (Math.floor(i / 4) + 1) / 16]; uvs.push(uv); return { uv, aspect: 4 }; },
  } as unknown as SignAtlas;
  const k: Ctx = { b: new Batch(14), pal: paletteOf('cats'), signs, inst: new Instancer(), glows: [], lights: [], bulbs: [], wires: [], rnd: rng(1234), quality: 2, lowH: 0, wallZ: 0, colliders: [], pools: [], solids: [] };
  const out = { k, adds, drawn, pieces: 0, uvs };
  k.b.recorder = () => { out.pieces++; };
  return out;
}

const ITEMS: any[] = (fx as any).ITEMS;
const POSTS = ITEMS.filter((i) => i.k === 'signpost'), MINE = ITEMS.filter((i) => i.k === 'minesign');
const signGeo = (k: Ctx) => k.inst.partsOf('fc:signs')!.find((p) => p.mat === 'sign')!.geo;
const flatGeo = (k: Ctx) => k.inst.partsOf('fc:signs')!.find((p) => p.mat === 'flat')!.geo;
/** Bounding box (world space) of the plate quad drawn in the atlas cell `cell`: the vertices whose UVs fall inside it. */
function plateBox(g: THREE.BufferGeometry, cell: UV): THREE.Box3 | null {
  const pos = g.attributes.position as THREE.BufferAttribute, t = g.attributes.uv as THREE.BufferAttribute, b = new THREE.Box3(), e = 1e-6;
  let n = 0;
  for (let i = 0; i < pos.count; i++) {
    const u = t.getX(i), v = t.getY(i);
    if (u >= cell[0] - e && u <= cell[2] + e && v >= cell[1] - e && v <= cell[3] + e) { b.expandByPoint(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))); n++; }
  }
  return n ? b : null;
}
function placeAll(k: Ctx, g = 0.3): void {
  registerFcItemKinds(k);
  for (const it of [...POSTS, ...MINE]) expect(placeFcItem(k, it, g, 2.75, []), it.k).toBe(true);
}

describe('fcart signs: signposts + mine sign', () => {
  it('the fixture has the 4 signposts and the mine sign this test is written for', () => {
    expect(POSTS.length).toBe(4); expect(MINE.length).toBe(1);
  });

  it('every sign of the town is one kind, two parts, one placement; nothing in the static batch', () => {
    const c = ctx(); placeAll(c.k);
    expect([...c.k.inst.placed.keys()].filter((x) => /sign/.test(x))).toEqual(['fc:signs']);
    expect(c.k.inst.count('fc:signs')).toBe(1);
    const parts = c.k.inst.partsOf('fc:signs')!;
    expect(parts.map((p) => p.mat).sort()).toEqual(['flat', 'sign']);
    for (const p of parts) { expect(p.geo.attributes.color, p.mat).toBeTruthy(); expect(p.geo.attributes.uv, p.mat).toBeTruthy(); expect(p.geo.attributes.normal, p.mat).toBeTruthy(); }
    expect(c.pieces).toBe(0);
    const tris = parts.reduce((s, p) => s + p.geo.attributes.position.count / 3, 0);
    expect(tris).toBeLessThan(1600);
    // eslint-disable-next-line no-console
    console.log(`fc:signs calls ${parts.length} tris ${tris} (${POSTS.length} signposts + ${MINE.length} mine sign)`);
  });

  it('every `to` label and «ВАГОНЕТКИ!» is drawn into the atlas; the atlas budget holds', () => {
    const c = ctx(); placeAll(c.k);
    const labels = new Set<string>(); for (const it of POSTS) for (const [t] of it.to) labels.add(String(t).toUpperCase());
    expect(labels.size).toBeGreaterThanOrEqual(7);
    for (const t of labels) expect(c.drawn, t).toContain(t);
    expect(c.drawn).toContain('ВАГОНЕТКИ!');
    expect(c.drawn).toContain('!');
    // one cell per board (+ the warning triangle); the shared atlas has 64 cells for the whole city
    const boards = POSTS.reduce((s, it) => s + Math.min(3, it.to.length), 0) + 1;
    expect(c.adds.length).toBe(boards + 1);
    expect(c.adds.length).toBeLessThanOrEqual(16);
    expect(c.k.signs.texture!.needsUpdate).toBe(true);
  });

  it('a second town on the same atlas re-uses the cells (no atlas growth)', () => {
    const c = ctx(); placeAll(c.k);
    const n = c.adds.length;
    const k2: Ctx = { ...c.k, inst: new Instancer() }; placeAll(k2);
    expect(c.adds.length).toBe(n);
    expect(k2.inst.count('fc:signs')).toBe(1);
  });

  it('boards: count per signpost, arrow side per direction letter (E / S right, else left), upright, stacked 0.5 m apart', () => {
    const c = ctx(); registerFcItemKinds(c.k);
    for (const it of POSTS) {
      const before = c.adds.length;
      placeFcItem(c.k, it, 0, 2.75, []);
      const g = signGeo(c.k), cells = c.uvs.slice(before), X = toX(it.x);
      expect(cells.length, `${it.x},${it.y}`).toBe(Math.min(3, it.to.length));
      const centres: number[][] = [];
      cells.forEach((uv, i) => {
        const b = plateBox(g, uv)!; expect(b, 'plate ' + i).toBeTruthy();
        const w = b.max.x - b.min.x, h = b.max.y - b.min.y;
        expect(h, 'height').toBeGreaterThan(0.38); expect(h).toBeLessThan(0.46);
        expect(w / h, 'aspect').toBeGreaterThan(2.2); expect(w / h).toBeLessThan(9);
        expect(b.max.z - b.min.z, 'flat in the board plane').toBeLessThan(0.02 + w * Math.sin(0.16));   // only the item yaw skews z
        const cx = (b.min.x + b.max.x) / 2 - X, right = /E|S/.test(it.to[i][1]);
        expect(cx > 0, `${it.to[i][0]} ${it.to[i][1]}: board centre ${cx.toFixed(2)} from the post`).toBe(right);
        centres.push([cx, (b.min.y + b.max.y) / 2]);
      });
      for (let i = 1; i < centres.length; i++) expect(centres[i - 1][1] - centres[i][1]).toBeCloseTo(0.525, 1);
      expect(signPattern(it.to).length).toBe(Math.min(3, it.to.length));
    }
  });

  it('the posts stand on the ground and the paw tops them; the mine sign is a triangle over a plaque', () => {
    const c = ctx(); placeAll(c.k, 0.3);
    const f = new THREE.Box3().setFromBufferAttribute(flatGeo(c.k).attributes.position as THREE.BufferAttribute);
    const s = new THREE.Box3().setFromBufferAttribute(signGeo(c.k).attributes.position as THREE.BufferAttribute);
    expect(f.min.y).toBeGreaterThan(0.3 - 1e-3); expect(f.min.y).toBeLessThan(0.3 + 0.03);   // nothing below the ground, the post foot on it
    expect(f.max.y).toBeLessThan(0.3 + 2.6); expect(f.max.y).toBeGreaterThan(0.3 + 2.2);       // paw on a 2 m post
    expect(s.min.y).toBeGreaterThan(0.3 + 0.3);
    const mine = ITEMS.find((i) => i.k === 'minesign'), X = toX(mine.x), Z = toZ(mine.y - 3);
    // the mine sign: the warning quad (aspect ≈ 2.4) above the plaque (aspect 4.77), both centred on the post
    const cells = c.uvs.slice(-2), tri = plateBox(signGeo(c.k), cells[0])!, pl = plateBox(signGeo(c.k), cells[1])!;
    expect(tri.min.y).toBeGreaterThan(pl.min.y); expect((tri.max.y - tri.min.y) / (pl.max.y - pl.min.y)).toBeGreaterThan(1.2);
    const cx = (pl.min.x + pl.max.x) / 2; expect(Math.abs(cx - X)).toBeLessThan(0.05);
    expect((pl.max.x - pl.min.x) / (pl.max.y - pl.min.y)).toBeCloseTo(124 / 26, 0);
    expect(Math.abs((pl.min.z + pl.max.z) / 2 - Z)).toBeLessThan(0.3);
  });

  it('without a canvas (no DOM) the signs still build, with the atlas cell as they are', () => {
    const c = ctx(); (c.k.signs as unknown as { canvas?: unknown }).canvas = undefined;
    placeAll(c.k);
    expect(c.k.inst.partsOf('fc:signs')!.length).toBe(2);
  });
});
