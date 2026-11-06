/**
 * Geometry lint (src/world/lint) over the interiors: every 3D shop / hybrid room, both mine floors (classic geo1,
 * «Шахта 3.0» geo3) and the first expedition stages. Same ratchet as test/geom-lint.test.ts
 * (test/fixtures/lint-baseline.json; hard classes stay at zero).
 */
import { describe, it, beforeAll } from 'vitest';
import * as THREE from 'three';
import { stubDom } from './dom-stub';
import meJson from './fixtures/me.json';
import stockJson from './fixtures/stock.json';
import fx3 from './fixtures/mine3-enter.json';
import classic from './fixtures/mine-enter.json';
import { LintCollector, lintWorld, type LintClass } from '../src/world/lint';
import { RoomKit } from '../src/rooms/common/kit';
import { ratchet } from './geom-lint-fixture';

beforeAll(() => stubDom());

const SHOPS = ['forge', 'magic', 'shop', 'tent'];
const HYBRIDS = ['trainer', 'board', 'hall', 'auction', 'storage', 'gate', 'anvil', 'plain'];
/** Scene-graph meshes that are not geometry to lint (merged room batches come through the recorder). */
const SKIP = (o: THREE.Object3D) => (o as THREE.SkinnedMesh).isSkinnedMesh || /^room:[a-zA-Z]+$|avatar|mannequin|npc|colliders|camCol|glows|splash|light|sky|stars|outline|blob|spill|hl$|label|bubble|fx|beam|fog/i.test(o.name);
/** In a room every class but the town-only ones (doors / stairs / rails / outline need the town's marks). */
const ROOM: LintClass[] = ['float', 'loose', 'sunk', 'overlap', 'zfight', 'uv', 'plane', 'ledge', 'lamp'];

describe('geometry lint: rooms, mine, expedition', () => {
  for (const id of [...SHOPS, ...HYBRIDS]) {
    it(`room:${id}`, async () => {
      const { createShopRoom } = await import('../src/rooms/shop');
      const { createHybridRoom } = await import('../src/rooms/hybrid');
      const col = new LintCollector();
      RoomKit.recorder = col.add;
      try {
        const hero = { ...JSON.parse(JSON.stringify((meJson as any).hero)), money: 100000 };
        const store: any = { hero, me: null, walkers: new Map(), chat: [], online: 1, quest: null, layout: null, on: () => () => {} };
        const env: any = {
          building: { id, title: id, hit: [0, 0, 0, 0], door: { x: 0, y: 0 } }, styleId: 'cats', quality: 2, store, actions: { get: async () => stockJson, post: async () => ({ ok: true }) },
          input: { setGameplay() {} }, interact: { add: () => () => {}, target: null }, scene: null, itemModels: null, toast() {}, exit() {}, showSitePanel() {}, hideSitePanel() {}, player: () => ({ x: 0, z: 3 }), ench: { coins: { star: 300, sphere: 900 } },
        };
        const room: any = SHOPS.includes(id) ? await createShopRoom(env, { stock: stockJson as any }) : await createHybridRoom(env);
        col.addScene(room.root, SKIP);
        const r = lintWorld({ where: 'room:' + id, pieces: col.pieces, groundAt: (x, z) => (room.groundAt ? room.groundAt(x, z) : 0) }, { only: ROOM });
        room.dispose();
        ratchet(r);
      } finally { RoomKit.recorder = null; }
    }, 60000);
  }

  for (const kind of ['geo1', 'geo3']) {
    it(`mine:${kind}`, async () => {
      const { MineScene } = await import('../src/rooms/mine/scene');
      const { MineModel } = await import('../src/rooms/mine/state');
      const col = new LintCollector();
      RoomKit.recorder = col.add;
      try {
        const M = new MineModel('player999');
        if (kind === 'geo3') M.take(JSON.parse(JSON.stringify((fx3 as any).st)), (fx3 as any).me, null, 1);
        else M.take((classic as any).st, (classic as any).me, null, 1);
        const S: any = new MineScene({ quality: 2, login: 'player999', geom: kind === 'geo3' ? M.G : undefined } as any);
        S.setView(M, []);
        for (let i = 0; i < 3; i++) S.update(0.05, i * 0.05, new THREE.PerspectiveCamera(), M, Date.now(), -1, new THREE.Vector3());
        col.addScene(S.root, SKIP);
        const r = lintWorld({ where: 'mine:' + kind, pieces: col.pieces, groundAt: () => 0 }, { only: ROOM });
        S.dispose();
        ratchet(r);
      } finally { RoomKit.recorder = null; }
    }, 60000);
  }

  it('expedition: terrain stage', async () => {
    const { fakeTimeline } = await import('../src/quest/fake');
    const { ExpeditionScene } = await import('../src/expedition/scene');
    const { adapt, Roster } = await import('../src/expedition/adapter');
    const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.03, 400);
    const scene = new THREE.Scene();
    const sc: any = new ExpeditionScene({ kit: null, appOf: () => null, style: 'cats', quality: 2, secLeft: () => 5 } as any);
    scene.add(sc.root); sc.attach(scene);
    const roster = new Roster(); let t = 0;
    for (const v of fakeTimeline({ login: 'murka', role: 'archer', speed: 4 }, 500)) {
      const s = adapt(v, { login: 'murka', role: 'archer', roster });
      if (s.kind === 'off' || !s.ter) continue;
      sc.setState(s);
      for (let i = 0; i < 4; i++) { t += 0.1; sc.update(0.1, t, cam); }
      if (!sc.terrain) continue;
      const col = new LintCollector();
      // the terrain sheet is the ground; avatars / fx / sky are not static geometry
      col.addScene(sc.root, (o) => SKIP(o) || /avatar|foe|hero|ter:|terrain|ground|water|grass|nameplate|arrow|spark|hp/i.test(o.name) || (o as any).isSkinnedMesh);
      const G = (x: number, z: number) => Math.max(sc.terrain.heightAt(x, z), sc.terrain.waterAt?.(x, z) ?? -9);
      const r = lintWorld({ where: 'exp:' + s.ter, pieces: col.pieces, groundAt: G }, { only: ['float', 'sunk', 'overlap', 'plane', 'ledge'] });
      ratchet(r);
      break;
    }
    sc.dispose();
  }, 60000);
});
