/**
 * Rooms (src/rooms): stock / purchase rules (port of the site's city.js), non-overlapping hit volumes, a whole forge
 * scene built offline with a fake DOM, and the bound purchase (the request uses the item of the open card, never the
 * current aim). Actions are fakes — nothing is ever sent to the site.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import meJson from './fixtures/me.json';
import stockJson from './fixtures/stock.json';
import {
  offerOf, stockOf, goodsOf, standsOf, sampleOffer, coinsFor, topIdsOf, type CityStock, type ShopStock, type TentStock, type StockItem, type PriceEnv,
} from '../src/rooms/common/stock';
import { separateBoxes, overlaps, pickBox } from '../src/rooms/common/hits';
import type { Hero } from '../src/contracts';

const ST = stockJson as unknown as CityStock;
const heroOf = (patch: Record<string, unknown> = {}): Hero => ({ ...JSON.parse(JSON.stringify((meJson as any).hero)), ...patch });
const env = (h: Hero | null, o: Partial<PriceEnv> = {}): PriceEnv => ({ hero: h, ench: { coins: { star: 300, sphere: 900 } }, ...o });

/* ---------------------------------------------------------------- minimal fake DOM (canvas + elements) */
beforeAll(() => {
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
  (globalThis as any).document = { createElement: () => new FakeEl(), body: new FakeEl(), pointerLockElement: null, exitPointerLock() {} };
  (globalThis as any).window = Object.assign(globalThis as any, { addEventListener() {}, removeEventListener() {} });
});

/* ---------------------------------------------------------------- stock rules */
describe('stock', () => {
  it('picks the stock per building (magic shop open → forgeM / tentM)', () => {
    const withMs = heroOf(), noMs = heroOf({ ms: undefined });
    expect(stockOf(ST, 'forge', withMs)).toBe(ST.forgeM);
    expect(stockOf(ST, 'forge', noMs)).toBe(ST.forge);
    expect(stockOf(ST, 'tent', withMs)).toBe(ST.tentM);
    expect(stockOf(ST, 'magic', withMs)).toBe(ST.magic);
    expect(stockOf(ST, 'shop', withMs)).toBe(ST.rows);
    const f = stockOf(ST, 'forge', noMs) as ShopStock;
    expect(standsOf(f).map((s) => s.name)).toEqual(['Легионер', 'Лучник', 'Маг · Жрец']);
    expect(goodsOf('forge', f).length).toBe(17 + 6 + 2);
    expect(goodsOf('shop', ST.rows!).length).toBe(12);
    expect(goodsOf('tent', ST.tent!).length).toBe(6);
  });

  it('coin offer: price, request body exactly like the site (/api/cityBuy {item, price, town?})', () => {
    const it = (ST.forge!.stands![0].top![0]) as StockItem;   // dagger, 32 coins
    const o = offerOf(it, 'forge', env(heroOf({ money: 1000 })));
    expect(o.kind).toBe('coins');
    expect(o.coins).toBe(32);
    expect(o.why).toBe('');
    expect(o.req).toEqual({ path: '/api/cityBuy', body: { item: 'dagger', price: 32 } });
    const t = offerOf(it, 'forge', env(heroOf({ money: 1000 }), { town: 'v3', foreignK: 1 }));
    expect(t.req!.body).toEqual({ item: 'dagger', price: 32, town: 'v3' });
  });

  it('not enough money / ghost / no hero → disabled with the site reason', () => {
    const it = ST.forge!.stands![0].top![2] as StockItem;   // gladius 160
    expect(offerOf(it, 'forge', env(heroOf({ money: 100 }))).why).toBe('Не хватает монет');
    expect(offerOf(it, 'forge', env(heroOf({ money: 100 }))).poor).toBe(true);
    expect(offerOf(it, 'forge', env(heroOf({ money: 9999, ghost: true }))).why).toBe('Призраку не продают.');
    const none = offerOf(it, 'forge', env(null));
    expect(none.kind).toBe('closed'); expect(none.can).toBe(false); expect(none.req).toBeNull();
  });

  it('without hero.cs goods are «сейчас не купить» with their coin price (08.11: no more channel points)', () => {
    const it = ST.forge!.stands![0].top![0] as StockItem;
    const o = offerOf(it, 'forge', env(heroOf({ cs: undefined })));
    expect(o.kind).toBe('closed'); expect(o.list).toBe(32); expect(o.req).toBeNull();
    expect(o.note).toBe('Покупки в «Городе» тебе пока закрыты.');
  });

  it('thief mark-up and foreign towns (best deals locked)', () => {
    const it = ST.forge!.stands![0].top![0] as StockItem;   // dagger 32, top row
    expect(coinsFor(it, env(heroOf({ thK: 1.5 })))).toBe(48);
    const e = env(heroOf(), { foreignK: 2, topIds: topIdsOf(ST) });
    expect(offerOf(it, 'forge', e).kind).toBe('locked');
    const mid = ST.forge!.stands![0].mid![0] as StockItem;
    expect(offerOf(mid, 'forge', e).coins).toBe(128);
  });

  it('enchant materials: /api/buymat for heroes with ef, stream otherwise', () => {
    const star = ST.forge!.mats![0] as StockItem;
    const o = offerOf(star, 'forge', env(heroOf({ money: 5000 })));
    expect(o.kind).toBe('mat'); expect(o.coins).toBe(300);
    expect(o.req).toEqual({ path: '/api/buymat', body: { mat: 'star' } });
    expect(offerOf(star, 'forge', env(heroOf({ money: 5000, thK: 2 }))).req!.body).toEqual({ mat: 'star', ack: 1 });
    expect(offerOf(star, 'forge', env(heroOf({ ef: undefined }))).kind).toBe('closed');
    expect(offerOf(star, 'forge', env(heroOf({ ef: undefined }))).note).toBe('За монеты - когда откроется заточка.');
  });

  it('tent looks: owned → /api/wear, else bought for coins (08.11: look-<booth>-<id>)', () => {
    const T = ST.tent as TentStock, shape = T.booths![0];
    const h = heroOf();   // owns shapes tall + bean, wears bean
    const worn = sampleOffer(h, shape, shape.samples!.find((s) => s.id === 'bean')!);
    expect(worn.kind).toBe('wear'); expect(worn.can).toBe(false);
    const tall = sampleOffer(h, shape, shape.samples!.find((s) => s.id === 'tall')!);
    expect(tall.kind).toBe('wear'); expect(tall.req).toEqual({ path: '/api/wear', body: { field: 'shape', value: 'tall' } });
    const box = sampleOffer(h, shape, shape.samples!.find((s) => s.id === 'box')!);
    expect(box.kind).toBe('coins'); expect(box.coins).toBe(3000);
    expect(box.req).toEqual({ path: '/api/cityBuy', body: { item: 'look-shape-box', price: 3000 } });
  });
});

/* ---------------------------------------------------------------- hit volumes */
describe('hit volumes', () => {
  it('separateBoxes makes overlapping neighbours disjoint and keeps them aimable', () => {
    const B = (x0: number, x1: number) => new THREE.Box3(new THREE.Vector3(x0, 1, -0.2), new THREE.Vector3(x1, 1.6, 0.2));
    const boxes = [B(0, 0.5), B(0.4, 0.9), B(0.8, 1.3), B(0.85, 1.2)];
    separateBoxes(boxes);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j]), `${i}/${j}`).toBe(false);
    for (let i = 0; i < boxes.length; i++) expect(boxes[i].isEmpty()).toBe(false);
  });
});

/* ---------------------------------------------------------------- whole room, offline */
describe('forge room (offline, fake site)', () => {
  it('builds within budget; adjacent goods resolve to distinct targets; the purchase is bound to the card', async () => {
    const { createShopRoom } = await import('../src/rooms/shop');
    const { RoomBase } = await import('../src/rooms/common/base');
    const posts: { path: string; body: any }[] = [];
    const inters: any[] = [];
    let target: any = null;
    const hero = heroOf({ money: 100000 });
    const store: any = { hero, me: null, walkers: new Map(), chat: [], online: 1, quest: null, layout: null, on: () => () => {} };
    const actions: any = { get: async () => ST, post: async (path: string, body: any) => { posts.push({ path, body }); return { ok: true }; } };
    const room = await createShopRoom({
      building: { id: 'forge', title: 'Кузня', hit: [0, 0, 0, 0], door: { x: 0, y: 0 } }, styleId: 'cats', quality: 2, store, actions,
      input: { setGameplay() {} }, interact: { add: (i: any) => { inters.push(i); return () => {}; }, get target() { return target; } },
      scene: null, itemModels: null, toast() {}, exit() {}, player: () => ({ x: 0, z: 3 }), ench: { coins: { star: 300, sphere: 900 } },
    }, { stock: ST });
    // budget
    let tris = 0, meshes = 0;
    room.root.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !(m.material as THREE.Material).visible) return;
      meshes++;
      const g = m.geometry, n = g.index ? g.index.count : g.attributes.position.count;
      tris += Math.min(n, g.drawRange.count) / 3 * ((m as any).isInstancedMesh ? (m as any).count : 1);
    });
    expect(meshes).toBeLessThanOrEqual(80);
    expect(tris).toBeLessThanOrEqual(60000);
    // goods: one Interactable each, labels name the item, hits never overlap
    const goods = inters.filter((i) => i.id.startsWith('room:good:'));
    expect(goods.length).toBe(goodsOf('forge', stockOf(ST, 'forge', hero) as ShopStock).length);
    for (const g of goods) { expect(g.proximity).toBe(false); expect(g.label).toMatch(/^Купить: .+ — /); expect(g.alt.label).toBe('Осмотреть'); }
    const boxes = goods.map((g) => new THREE.Box3().setFromObject(g.hit));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j]), `${goods[i].id} × ${goods[j].id}`).toBe(false);
    // every good can be aimed at from the shop floor and the aim resolves to it (not a neighbour)
    for (let i = 0; i < boxes.length; i++) {
      const c = boxes[i].getCenter(new THREE.Vector3()), sz = boxes[i].getSize(new THREE.Vector3());
      const n = new THREE.Vector3(-c.x, 0, 1.5 - c.z).normalize();   // towards the middle of the shop
      let ok = false;
      for (let a = -0.3; a <= 0.3 && !ok; a += 0.15) for (let b = -0.3; b <= 0.4 && !ok; b += 0.1) {
        const p = c.clone().add(new THREE.Vector3(sz.x * a, sz.y * b, sz.z * a));
        const eye = new THREE.Vector3(p.x + n.x * 1.6, 1.25, p.z + n.z * 1.6);
        const ray = new THREE.Ray(eye, p.clone().sub(eye).normalize());
        if (pickBox(ray, boxes, 4.5) === i) ok = true;
      }
      expect(ok, goods[i].id).toBe(true);
    }
    // neighbours on one row resolve to distinct targets when aimed at their centres from the front
    const row = goods.filter((g) => g.id.includes(':dagger:') || g.id.includes(':smith_hammer:') || g.id.includes(':gladius:'));
    const picked = row.map((g) => { const c = new THREE.Box3().setFromObject(g.hit).getCenter(new THREE.Vector3()); return pickBox(new THREE.Ray(new THREE.Vector3(c.x, c.y, c.z + 1.5), new THREE.Vector3(0, 0, -1)), boxes, 4.5); });
    expect(new Set(picked).size).toBe(row.length);
    // bound purchase: open A, the aim moves to B, «Да» buys A (id + price of A)
    const A = goods.find((g) => g.id.includes(':gladius:'))!, B = goods.find((g) => g.id.includes(':dagger:'))!;
    target = A; room.update(0.016, 1, new THREE.PerspectiveCamera());
    A.use('key');
    target = B; room.update(0.016, 1.1, new THREE.PerspectiveCamera());
    const base = room.root.userData.l3dRoom as InstanceType<typeof RoomBase>;
    const card = base.card as any;
    expect(base.hot && base.hot.it.id).toBe('gladius');   // the open card keeps ITS good lit
    expect(card && card.boundTo && card.boundTo.id).toBe('gladius');
    await card.send();
    expect(posts).toEqual([{ path: '/api/cityBuy', body: { item: 'gladius', price: 160 } }]);
    room.dispose();
  });
});
