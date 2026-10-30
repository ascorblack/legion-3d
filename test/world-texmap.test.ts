/**
 * Texture mapping (bug class «smeared / squeezed textures»): every textured piece the static batcher builds — the city
 * (fair, camp, hand village; cats + cherts), every room, the mine (classic + «Шахта 3.0») — keeps its final UVs
 * undistorted: area-weighted anisotropy of the UV mapping ≤ 2.2 (a box-projected piece maps 1:1). Before the fix the
 * projection axis was picked per VERTEX normal and smooth round pieces (towers, columns, poles) smeared tens of tiles
 * across one face. Kit props that bring their own UV layout ('keep': barrel staves, planters, awnings) are exempt.
 * The instanced proto props (crates, benches, lamps…) keep the city's texel density: 0.5–2 tiles per metre.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { stubDom } from './dom-stub';
import { staticCity } from './world-fixture';
import { fixtureLayout, campFixtureLayout, villageFixtureLayout } from '../dev/fixtures';
import { RoomKit } from '../src/rooms/common/kit';
import { Instancer } from '../src/world/instancer';
import { registerProtoProps } from '../src/world/protoProps';
import { paletteOf } from '../src/world/palette';
import meJson from './fixtures/me.json';
import stockJson from './fixtures/stock.json';
import fx3 from './fixtures/mine3-enter.json';
import classic from './fixtures/mine-enter.json';

const TEXTURED = new Set(['brick', 'plaster', 'wood', 'roof', 'stone', 'metal', 'paving', 'lowPaving', 'canvas', 'rock', 'water']);
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _n = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3();

/** Area-weighted anisotropy of a geometry's UV mapping (1 = conformal). */
export function uvAniso(g: THREE.BufferGeometry): { aniso: number; area: number; dens: number } {
  const pos = g.attributes.position as THREE.BufferAttribute, uv = g.attributes.uv as THREE.BufferAttribute;
  const idx = g.index, n = idx ? idx.count / 3 : pos.count / 3;
  let A = 0, An = 0, D = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < n; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    _e1.subVectors(b, a); _e2.subVectors(c, a); _n.crossVectors(_e1, _e2);
    const wa = _n.length() / 2; if (wa < 1e-6) continue;
    const u1 = uv.getX(i1) - uv.getX(i0), v1 = uv.getY(i1) - uv.getY(i0), u2 = uv.getX(i2) - uv.getX(i0), v2 = uv.getY(i2) - uv.getY(i0);
    const ua = Math.abs(u1 * v2 - u2 * v1) / 2;
    if (ua < 1e-10) { A += wa; An += wa * 50; continue; }   // collapsed UVs: a full smear
    _x.copy(_e1).normalize(); _y.copy(_n).normalize().cross(_x);
    const x1 = _e1.dot(_x), y1 = _e1.dot(_y), x2 = _e2.dot(_x), y2 = _e2.dot(_y), det = x1 * y2 - x2 * y1;
    const ia = y2 / det, ib = -x2 / det, ic = -y1 / det, id = x1 / det;
    const j00 = u1 * ia + u2 * ic, j01 = u1 * ib + u2 * id, j10 = v1 * ia + v2 * ic, j11 = v1 * ib + v2 * id;
    const p = Math.hypot(j00 + j11, j01 - j10) / 2, q = Math.hypot(j00 - j11, j01 + j10) / 2;
    A += wa; An += wa * Math.min(50, (p + q) / Math.max(1e-9, Math.abs(p - q))); D += wa * Math.sqrt(ua / wa);
  }
  return { aniso: A ? An / A : 1, area: A, dens: A ? D / A : 0 };
}

/** Recorder: the stretched textured pieces (tag + where) — box-projected pieces only (not the kit's own 'prop:' UVs). */
function collector() {
  const bad: string[] = []; let n = 0;
  const rec = (mat: string, g: THREE.BufferGeometry, tag: string) => {
    if (!TEXTURED.has(mat) || !g.attributes.uv || tag.startsWith('prop:')) return;
    const r = uvAniso(g); if (r.area < 1e-3) return;
    n++;
    if (r.aniso > 2.2) { g.computeBoundingBox(); const b = g.boundingBox!; bad.push(`${mat}@${tag} aniso ${r.aniso.toFixed(1)} area ${r.area.toFixed(2)} m² at ${[b.min.x, b.min.y, b.min.z].map((v) => v.toFixed(1))}`); }
  };
  return { rec, bad, count: () => n };
}

beforeAll(() => stubDom());

describe('texture mapping: no smeared / squeezed textures', () => {
  for (const [town, style] of [['fair', 'cats'], ['fair', 'cherts'], ['camp', 'cats'], ['camp', 'cherts'], ['village', 'cats'], ['village', 'cherts']]) {
    it(`city ${town} (${style})`, () => {
      const L = town === 'camp' ? campFixtureLayout(style) : town === 'village' ? villageFixtureLayout(style) : fixtureLayout();
      L.styleId = style;
      const c = collector();
      staticCity(false, L, c.rec);
      expect(c.count(), 'textured pieces').toBeGreaterThan(500);
      expect(c.bad, c.bad.slice(0, 12).join('\n')).toEqual([]);
    });
  }

  it('rooms (cats + cherts) and the mine', async () => {
    const c = collector();
    RoomKit.recorder = (mat, g, tag) => c.rec(mat, g, tag);
    try {
      const { createShopRoom } = await import('../src/rooms/shop');
      const { createHybridRoom } = await import('../src/rooms/hybrid');
      for (const st of ['cats', 'cherts']) for (const id of ['forge', 'magic', 'shop', 'tent', 'trainer', 'board', 'hall', 'auction', 'storage', 'gate', 'anvil', 'plain']) {
        const hero = { ...JSON.parse(JSON.stringify((meJson as any).hero)), money: 100000 };
        const store: any = { hero, me: null, walkers: new Map(), chat: [], online: 1, quest: null, layout: null, on: () => () => {} };
        const env: any = { building: { id, title: id, hit: [0, 0, 0, 0], door: { x: 0, y: 0 } }, styleId: st, quality: 2, store, actions: { get: async () => stockJson, post: async () => ({ ok: true }) },
          input: { setGameplay() {} }, interact: { add: () => () => {}, target: null }, scene: null, itemModels: null, toast() {}, exit() {}, showSitePanel() {}, hideSitePanel() {}, player: () => ({ x: 0, z: 3 }), ench: { coins: { star: 300, sphere: 900 } } };
        const room: any = ['forge', 'magic', 'shop', 'tent'].includes(id) ? await createShopRoom(env, { stock: stockJson as any }) : await createHybridRoom(env);
        room.dispose();
      }
      const { MineScene } = await import('../src/rooms/mine/scene');
      const { MineModel } = await import('../src/rooms/mine/state');
      for (const kind of ['classic', 'v3']) {
        const M = new MineModel('player999');
        if (kind === 'v3') M.take(JSON.parse(JSON.stringify((fx3 as any).st)), (fx3 as any).me, null, 1); else M.take((classic as any).st, (classic as any).me, null, 1);
        const S = new MineScene({ quality: 2, login: 'player999', geom: kind === 'v3' ? M.G : undefined } as any);
        S.setView(M, []);
        S.dispose();
      }
    } finally { RoomKit.recorder = null; }
    expect(c.count()).toBeGreaterThan(3000);
    expect(c.bad, c.bad.slice(0, 12).join('\n')).toEqual([]);
  });

  it('instanced proto props keep the city texel density (no whole tile squeezed onto a strap)', () => {
    const inst = new Instancer();
    registerProtoProps(inst, paletteOf('cats'));
    const kinds = (inst as unknown as { kinds: Map<string, { geo: THREE.BufferGeometry; mat: string }[]> }).kinds;
    const bad: string[] = [];
    for (const [kind, parts] of kinds) for (const p of parts) {
      if (!TEXTURED.has(p.mat)) continue;
      const r = uvAniso(p.geo);
      if (r.aniso > 1.8 || r.dens < 0.5 || r.dens > 2) bad.push(`${kind}:${p.mat} aniso ${r.aniso.toFixed(2)} density ${r.dens.toFixed(2)}/m`);
    }
    expect(bad).toEqual([]);
  });
});

