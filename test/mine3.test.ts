/**
 * «Шахта 3.0» (site 29.10, flag mine3): the big non-linear floor. A sanitized live view (fixtures/mine3-enter.json, logins
 * → playerN) drives: the floor model (only the cells the site lists, the rest fog), the geometry port of LGWorldLib.mine3
 * (parity with the site's own lib/world.js when a local copy exists), the rock layout of the 3D scene (fog never shows a
 * type), the scene itself (stones, interactables, colliders, budget, dispose), walking in the lift hall and the offline fake.
 * Nothing here talks to the network.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as THREE from 'three';
import fx from './fixtures/mine3-enter.json';
import classic from './fixtures/mine-enter.json';
import { mine3Geo, geomOf, GEO1, OPEN3 } from '../src/rooms/mine/geo3';
import { MineModel, floorOf, cellLevel, type MinePayload, type MineView } from '../src/rooms/mine/state';
import { slots3, open3 } from '../src/rooms/mine/cave3';
import { walkPlan, walkPlan3 } from '../src/rooms/mine/walk';
import { workAtLevel } from '../src/rooms/mine/econ';
import { FakeMine, makeBus, cellTuple } from '../src/rooms/mine/fake';
import { MineClient } from '../src/rooms/mine/net';

const P = fx as unknown as MinePayload;
const st = () => JSON.parse(JSON.stringify(P.st)) as MineView;
const dugOf = (s: string) => s.split('').map((c) => (c === '1' ? 1 : 0));

/** The newest local copy of the site's lib/world.js that has mine3 (never committed; the parity test skips without it). */
function siteLib(): string | null {
  if (!existsSync('.local')) return null;
  const dirs = readdirSync('.local').filter((d) => /^site-/.test(d)).sort().reverse();
  for (const d of dirs) { const f = `.local/${d}/world.js`; if (existsSync(f) && readFileSync(f, 'utf8').includes('function mine3(')) return f; }
  return null;
}
const LIB = siteLib();

describe('Шахта 3.0: floor model', () => {
  it('reads the big floor: w × h cells, only the listed ones visible, the rest fog', () => {
    const v = st(), F = floorOf(v)!;
    expect(F.v3).toBe(1);
    expect([F.w, F.h]).toEqual([32, 18]);
    expect(F.cells.length).toBe(32 * 18);
    const listed = new Set((v.fl!.c as any[]).map((c) => c[0]));
    let vis = 0; for (let i = 0; i < F.cells.length; i++) { expect(!!F.vis![i]).toBe(listed.has(i)); if (F.vis![i]) vis++; else expect(F.cells[i]).toMatchObject({ t: 'fog', lv: 0, r: null }); }
    expect(vis).toBe(listed.size);
    expect(F.cells[F.lift!].t).toBe('lift');
    expect(F.hallBox).toEqual([11, 6, 4, 3]);
    expect(F.veins!.length).toBeGreaterThan(0);
  });
  it('the model takes the view: geometry, own stone rules, no classic "stones left" on a big floor', () => {
    const M = new MineModel('player999');
    const r = M.take(st(), P.me, null, 1);
    expect(r.changed).toBe(true);
    expect(M.G.v3).toBe(true); expect(M.G.N).toBe(576);
    expect(M.stonesLeft()).toBe(0);
    expect(M.upText()).toMatch(/шахты лифта/);
    expect(M.liftChip()).toBe('ищем шахту лифта');
    // the classic view switches back to the classic geometry
    const C = new MineModel('player999'); C.take((classic as any).st, (classic as any).me, null, 1);
    expect(C.G).toBe(GEO1);
  });
  it('levels of listed cells (econ) work for both layouts', () => {
    const v = st(), c = (v.fl!.c as any[]).find((x) => x[1] === 'ore');
    expect(cellLevel(v, c[0])).toBe(c[2]);
    expect(cellLevel(v, 0)).toBe(0);   // fog
    expect(cellLevel((classic as any).st, 0)).toBe((classic as any).st.fl.c[0][1]);
    expect(workAtLevel(v, 4)).toBeGreaterThan(0);
    expect(cellTuple(v, c[0])).toEqual([c[1], c[2], c[3], c[4]]);
  });
  it('a stone of another floor (me.f) is not the own stone of this one', () => {
    const v = st(), i = +Object.keys(v.bl!)[0];
    const M = new MineModel('nobody'); M.take(v, { ...P.me!, i, f: v.n + 1 }, null, 1);
    expect(M.myI).toBe(-1);
  });
});

describe('Шахта 3.0: geometry (port of LGWorldLib.mine3)', () => {
  const v = st(), fl = v.fl!, G = mine3Geo({ w: fl.w!, h: fl.h!, hallBox: fl.hallBox }), dug = dugOf(v.dug);
  it('has the site sizes: 128 px cells, PAD 2, hall in px, REACH 200', () => {
    expect([G.CW, G.W, G.H, G.REACH]).toEqual([128, (32 + 4) * 128, (18 + 4) * 128, 200]);
    expect(G.hall).toEqual([256 + 11 * 128, 256 + 6 * 128, 512, 384]);
    expect(geomOf(v)).toBe(G);   // cached by size and hall
  });
  it('the hall is dug from the start; walkable = dug cells only', () => {
    for (let i = 0; i < G.N; i++) { if (G.inZone(i)) expect(dug[i]).toBe(1); expect(G.walkable(dug, i)).toBe(!!dug[i]); }
  });
  it('spawn and every FOOT use point stand in the hall, off the objects', () => {
    for (const l of ['player1', 'player2', 'abc', 'zz_top']) { const p = G.spawn(l); expect(G.inZone(G.cellAt(p.x, p.y))).toBe(true); expect(G.standable(dug, p.x, p.y, 0)).toBe(true); }
    for (const k of ['buyer', 'lamp', 'board']) { const p = G.frontOfObj(k); expect(G.inZone(G.cellAt(p.x, p.y))).toBe(true); }
  });
  it('front rule agrees with the server front of the captured view', () => {
    const types: string[] = new Array(G.N).fill('fog'); for (const c of fl.c as any[]) types[c[0]] = c[1];
    const mine = G.frontOf(dug, types).sort((a, b) => a - b), server = [...v.front!].sort((a, b) => a - b);
    expect(mine).toEqual(server);
  });
  it.skipIf(!LIB)('matches the site lib/world.js mine3 on the same floor', () => {
    const sb: any = { self: {} }; sb.self = sb; runInNewContext(readFileSync(LIB!, 'utf8'), sb);
    const S = sb.LGWorldLib.mine3({ w: fl.w, h: fl.h, hallBox: fl.hallBox });
    expect([S.W, S.H, S.X0, S.Y0]).toEqual([G.W, G.H, 256, 256]);
    expect(S.hall).toEqual(G.hall); expect(S.ZONE).toEqual(G.ZONE);
    expect(S.FOOT.map((f: any) => [f.k, f.r, f.s, f.at || null])).toEqual(G.FOOT.map((f) => [f.k, f.r, f.s, f.at || null]));
    for (let i = 0; i < G.N; i++) {
      expect(G.cellXY(i)).toEqual(S.cellXY(i));
      expect(G.walkable(dug, i)).toBe(S.walkable(dug, i));
      expect(G.inZone(i)).toBe(S.inHall(i));
      expect(G.digSpot(dug, i)).toBe(S.digSpot(dug, i));
      expect(G.nbrs(i)).toEqual(S.nbrs(i));
      expect(G.centerOf(i)).toEqual(S.centerOf(i));
    }
    for (let k = 0; k < 21; k++) expect(G.free(G.hall[0] + 120 + (k % 7) * 40, G.hall[1] + 210 + (Math.floor(k / 7) % 3) * 24)).toEqual(S.spawn(k));
    let seed = 11; const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const cells = dug.map((d, i) => (d ? i : -1)).filter((i) => i >= 0);
    for (let k = 0; k < 500; k++) {
      const x = r() * G.W, y = r() * G.H;
      expect(G.cellAt(x, y)).toBe(S.cellAt(x, y));
      expect(G.walkPt(dug, { x, y })).toEqual(S.walkPt(dug, { x, y }));
      expect(G.free(x, y)).toEqual(S.free(x, y));
      const a = cells[Math.floor(r() * cells.length)], b = cells[Math.floor(r() * cells.length)];
      expect(G.pathTo(dug, a, b)).toEqual(S.pathTo(dug, a, b));
    }
    // a point is standable for the 3D body only where the site would let a hero stand
    for (let k = 0; k < 2000; k++) {
      const x = r() * G.W, y = r() * G.H;
      if (G.standable(dug, x, y, 4)) { const c = G.cellAt(x, y); expect(S.walkable(dug, c) || S.inHall(c)).toBe(true); }
    }
  });
});

describe('Шахта 3.0: rock layout of the 3D floor', () => {
  const v = st(), F = floorOf(v)!, G = geomOf(v), dug = dugOf(v.dug), front = new Set(v.front!);
  const slot = slots3(G, F, dug, front);
  it('every front stone is a boulder, nothing stands in a passage', () => {
    for (const i of front) expect(slot[i]).toBe('stone');
    for (let i = 0; i < G.N; i++) if (open3(F, dug, i)) expect(slot[i]).toBeNull();
  });
  it('the tunnels are closed: every non-open neighbour of a passage has rock', () => {
    for (let i = 0; i < G.N; i++) {
      if (!open3(F, dug, i)) continue;
      for (const j of G.nbrs(i)) if (!open3(F, dug, j)) expect(slot[j]).not.toBeNull();
    }
  });
  it('fog stays fog: hidden cells never become typed rock (the 3D view does not reveal what the site hides)', () => {
    for (let i = 0; i < G.N; i++) {
      if (!F.vis![i]) expect(slot[i] === null || slot[i] === 'fog').toBe(true);
      if (slot[i] === 'fog') expect(F.vis![i]).toBe(0);
    }
    expect(slot.filter((x) => x === 'fog').length).toBeGreaterThan(0);
  });
  it('open types of a big floor', () => { expect([...OPEN3].sort()).toEqual(['lift', 'shaft', 'void']); });
});

describe('Шахта 3.0: walking in the lift hall and the tunnels', () => {
  const v = st(), G = geomOf(v), dug = dugOf(v.dug);
  it('plans from a tunnel cell into the hall to the buyer, through walkable cells and around the objects', () => {
    const from = G.centerOf(172), to = G.frontOfObj('buyer');
    const plan = walkPlan(dug, { x: from.x, y: from.y - 34 }, to, G)!;
    expect(plan).not.toBeNull();
    for (const p of plan) { const c = G.cellAt(p.x, p.y); expect(G.inZone(c) || !!dug[c]).toBe(true); }
    const end = plan[plan.length - 1]; expect(Math.hypot(end.x - to.x, end.y - to.y)).toBeLessThan(60);
    for (const p of plan) for (const f of G.FOOT) expect(p.x > f.r[0] && p.x < f.r[2] && p.y > f.r[1] && p.y < f.r[3]).toBe(false);
    expect(walkPlan3(G, dug, { x: 0, y: 0 }, to)).toBeNull();   // outside the floor
  });
});

describe('Шахта 3.0: client', () => {
  it('a dig on a big floor names the floor the player sees (site: n) and checks REACH on the big geometry', async () => {
    const calls: { p: string; b: any }[] = [];
    const api = async (p: string, b?: unknown) => { calls.push({ p, b }); return p.startsWith('/api/mine/enter') ? { ...JSON.parse(JSON.stringify(P)), ok: true } : { ok: true }; };
    const T = { setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {} };
    const c = new MineClient({ api, login: 'player999', c: 'home', timers: T as any, now: () => Date.now() } as any);
    await c.enter({ x: 300, y: 2400 });
    const M = c.model, i = M.st!.front![0], sp = M.G.centerOf(M.G.digSpot(M.dug, i)!);
    expect(c.dist(i, sp)).toBeLessThanOrEqual(200);
    expect(await c.dig(i, sp)).toBe(true);
    const d = calls.find((x) => x.p === '/api/mineDig')!;
    expect(d.b).toMatchObject({ i, c: 'home', n: M.st!.n, x: Math.round(sp.x), y: Math.round(sp.y) });
    expect(calls.map((x) => x.p.replace(/\?.*$/, '')).every((p) => ['/api/mine/enter', '/api/mineDig', '/api/mine/go'].includes(p))).toBe(true);
    c.close();
  });
});

describe('Шахта 3.0: offline fake', () => {
  it('digs a front stone, lifts the fog round it and recomputes the front', async () => {
    const bus = makeBus(), hero: any = { login: 'player999', money: 0, items: [], mn: {} };
    const f = new FakeMine({ login: 'player999', enter: JSON.parse(JSON.stringify(P)), hero, bus, digSec: 0.2, bots: false, demo: {} });
    const i = f.st.front![0], n0 = f.st.fl!.c.length;
    expect((await f.api('/api/mineDig', { i, c: 'home' })).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 1300));
    expect(f.st.dug[i]).toBe('1');
    expect(f.st.fl!.c.length).toBeGreaterThan(n0);
    expect(f.st.front).not.toContain(i);
    f.dispose();
  });
});

/* ------------------------------------------------------------------ the scene (minimal DOM / canvas shim) */
let MineScene: typeof import('../src/rooms/mine/scene').MineScene;
beforeAll(async () => {
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'getImageData' || k === 'createImageData') return (_x: number, _y?: number, w = 4, h = 4) => ({ data: new Uint8ClampedArray((w || 4) * (h || 4) * 4), width: w, height: h });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
      if (k === 'measureText') return () => ({ width: 10 });
      return () => {};
    },
    set: () => true,
  });
  class FakeEl {
    style: Record<string, string> = {}; dataset: Record<string, string> = {}; width = 0; height = 0; innerHTML = ''; textContent = ''; className = '';
    classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    getContext() { return ctx; }
    attachShadow() { return new FakeEl(); }
    appendChild(c: unknown) { return c; }
    remove() {} focus() {} setAttribute() {} addEventListener() {} removeEventListener() {}
    querySelector() { return new FakeEl(); }
    querySelectorAll() { return []; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; }
  }
  const g = globalThis as any;
  if (!g.document) g.document = { createElement: () => new FakeEl(), body: new FakeEl(), pointerLockElement: null, exitPointerLock() {} };
  if (!g.window) g.window = Object.assign(g, { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });
  ({ MineScene } = await import('../src/rooms/mine/scene'));
});

/** Renderables of the scene root that are not avatars (draw calls of the mine itself). */
function sceneCalls(root: THREE.Object3D): number {
  let n = 0;
  root.traverseVisible((o) => {
    let p: THREE.Object3D | null = o; while (p) { if (/avatar/i.test(p.name) || (p as any).isSkinnedMesh) return; p = p.parent; }
    if ((o as any).isMesh || (o as any).isSprite || (o as any).isPoints) { const m = (o as THREE.Mesh).material; n += Array.isArray(m) ? m.length : 1; }
  });
  return n;
}

describe('Шахта 3.0: 3D scene', () => {
  it('builds the big floor: stones at their cells, walls, colliders, walkability as the site, within budget, disposes', () => {
    const M = new MineModel('player999'); M.take(st(), P.me, null, 1);
    const S = new MineScene({ quality: 2, login: 'player999', geom: M.G });
    S.setView(M, []);
    const G = M.G, front = M.st!.front!;
    // every front stone: a boulder (not rock mass) with a hit box at its cell centre
    for (const i of front) {
      expect(S.stoneHeight(i)).toBeLessThan(2.5);
      const b = S.stoneBox(i), c = G.cellXY(i);
      expect(b.getCenter(new THREE.Vector3()).x).toBeCloseTo(G.mx(c.cx), 3);
      expect(b.getCenter(new THREE.Vector3()).z).toBeCloseTo(G.mz(c.cy), 3);
    }
    // the hall objects carry hit volumes inside the hall
    for (const k of ['lift', 'buyer', 'lamp', 'board', 'npcBuy', 'npcLamp']) {
      const b = S.objBoxes[k]; expect(b).toBeTruthy();
      const p = b.getCenter(new THREE.Vector3()), c = G.cellAt(G.px(p.x), G.py(p.z));
      expect(G.inZone(c)).toBe(true);
    }
    expect(S.objBoxes.up).toBeUndefined();
    // walkability in room metres = the site's (sampled): standable only on dug cells / in the hall
    let ok = 0;
    for (let k = 0; k < 3000; k++) {
      const x = G.mx(Math.random() * G.W), z = G.mz(Math.random() * G.H);
      if (S.free(M.dug, x, z)) { ok++; const c = G.cellAt(G.px(x), G.py(z)); expect(G.inZone(c) || !!M.dug[c]).toBe(true); }
    }
    expect(ok).toBeGreaterThan(0);
    const sp = G.spawn('player999'); expect(S.free(M.dug, G.mx(sp.x), G.mz(sp.y))).toBe(true);
    // camera colliders exist for the rock round the tunnels
    const col = S.colliders[0] as THREE.Mesh; expect((col.geometry.attributes.position as THREE.BufferAttribute).count).toBeGreaterThanOrEqual((front.length + 5) * 8);
    // budget: the mine itself (static batches + instanced rock + badges + glow) stays small
    const calls = sceneCalls(S.root);
    expect(calls).toBeLessThanOrEqual(70);
    // the captured vein goes on behind the fog: its sparks sit on a passage's rock face (in an open cell, next to rock)
    expect(S.sparks3.length).toBeGreaterThan(0);
    for (let k = 0; k < S.sparks3.length; k += 3) { const c = G.cellAt(G.px(S.sparks3[k]), G.py(S.sparks3[k + 2])); expect(G.inZone(c) || !!M.dug[c]).toBe(true); }
    // a dug stone disappears and the layout follows (a new front, fog lifts in the fake only)
    const i = front[0], v2 = st(); v2.v++; const d = v2.dug.split(''); d[i] = '1'; v2.dug = d.join(''); v2.front = front.filter((x) => x !== i);
    M.take(v2, null, null, 2); S.setView(M, []);
    expect(S.free(M.dug, G.mx(G.cellXY(i).cx), G.mz(G.cellXY(i).cy))).toBe(true);
    S.dispose();
    expect(S.root.parent).toBeNull();
  });
  it('the classic floor still builds the 7 × 12 hall', () => {
    const M = new MineModel('player999'); M.take((classic as any).st, (classic as any).me, null, 1);
    const S = new MineScene({ quality: 2, login: 'player999' });
    S.setView(M, []);
    expect(S.objBoxes.up).toBeTruthy();
    expect(S.free(M.dug, 0, 2)).toBe(true);   // the entrance area
    expect(sceneCalls(S.root)).toBeLessThanOrEqual(70);
    S.dispose();
  });
});
