/**
 * «Тюрьма и клетка» (site 30.10): the pure helpers of src/net/jail.ts (me.jail / me.jl, the /api/jail list, the seats like
 * city.js jailDraw, the prisoner's bar like app.js jailUi), the street model of src/world/jail.ts (solids = citymap.js JAIL_OBST,
 * no z-fighting) and the registry / supported data (drift shows no «without support»).
 */
import { describe, it, expect } from 'vitest';
import { createJailHub, jailBar, jailDay, jailFromMe, jailGeoOf, jailList, jailMore, jailSeats, jailWalkOf, jailWalkPt, inJailWalk, jailBackOf, JAIL_OFF } from '../src/net/jail';
import { fixtureLayout, withJail, JAIL_LOW, JAIL_BUILDING } from '../dev/fixtures';
import { staticCity } from './world-fixture';
import { SolidMap, collectSolids, makeSolidTop } from '../src/world/solid';
import { DEFAULT_BUILDINGS } from '../src/core/registries';
import { SUPPORTED_BUILDINGS } from '../src/world/supported';
import { doorInteractables } from '../src/world/worldExt';
import supported from '../src/data/supported.json';
import { toX, toZ } from '../src/world/coords';
import { mySeat, myWalk, needsSeat } from '../src/features/jail';
import doorsFeature from '../src/features/doors';
import map from './fixtures/fair-map.json';

describe('jail state from the site', () => {
  it('me.jail = a prisoner (reason, term), me.jl = the jail is open', () => {
    expect(jailFromMe({ user: {}, hero: {} })).toEqual({ on: false, me: null });
    expect(jailFromMe({ jl: 1 })).toEqual({ on: true, me: null });
    expect(jailFromMe({ jail: { reason: 'спам', until: 1800000000000, untilText: 'до 15 января, 03:00' } }))
      .toEqual({ on: true, me: { reason: 'спам', until: 1800000000000, untilText: 'до 15 января, 03:00' } });
    expect(jailFromMe({ jail: {} }).me).toEqual({ reason: undefined, until: null, untilText: undefined });   // бессрочно
    expect(jailFromMe(null)).toEqual({ on: false, me: null });
  });
  it('/api/jail and SSE «jail»: entries with a login only, logins lower-case, n ≥ list', () => {
    expect(jailList({ ok: false })).toBeNull();
    expect(jailList('x')).toBeNull();
    const v = jailList({ ok: true, list: [{ l: 'Zek1', n: 'Узник', lv: 4, lk: { b: 1 }, u: 5 }, { n: 'no login' }, null, { l: 'zek2', u: null }], n: 7 })!;
    expect(v.list.map((e) => e.l)).toEqual(['zek1', 'zek2']);
    expect(v.list[0]).toMatchObject({ n: 'Узник', lv: 4, lk: { b: 1 }, u: 5 });
    expect(v.list[1].u).toBeNull();
    expect(v.n).toBe(7);
    expect(jailList({ list: [{ l: 'a' }, { l: 'b' }], n: 1 })!.n).toBe(2);
  });
  it('seats like city.js jailDraw: my hero first (a prisoner), then the list without me, up to 8; odd seats turned', () => {
    const J = JAIL_LOW;
    const list = Array.from({ length: 10 }, (_, i) => ({ l: 'p' + i }));
    const st = { ...JAIL_OFF, on: true, me: { reason: 'x' }, list: [{ l: 'me' }, ...list], n: 11 };
    const s = jailSeats(st, J, 'Me');
    expect(s.length).toBe(8);
    expect(s[0]).toMatchObject({ self: true, x: J.seats[0][0], y: J.seats[0][1], flip: 1 });
    expect(s.slice(1).map((x) => x.login)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    expect(s[1].flip).toBe(-1); expect(s[2].flip).toBe(1);
    expect(jailMore(st, s.length, 'me')).toBe(3);
    const free = jailSeats({ ...st, me: null, list: list.slice(0, 3), n: 3 }, J, 'me');
    expect(free.map((x) => x.login)).toEqual(['p0', 'p1', 'p2']);
    expect(jailMore({ ...st, me: null, n: 3 }, 3, 'me')).toBe(0);
    expect(jailMore({ ...st, list: [], n: 0 }, 1, 'me')).toBe(0);   // only me, not in the list yet: 1 in all, 1 shown
  });
  it('the bar and the terms say what the site says', () => {
    expect(jailBar({ reason: 'спам', until: 1, untilText: 'до 31 октября, 15:00' })).toEqual({ title: 'Ты в тюрьме канала', reason: 'Причина: спам', term: 'Выйдешь: 31 октября, 15:00' });
    expect(jailBar({})).toEqual({ title: 'Ты в тюрьме канала', reason: null, term: 'Срок: бессрочно' });
    expect(jailDay(null)).toBe('бессрочно');
    expect(jailDay(Date.UTC(2026, 9, 31, 12, 0))).toMatch(/^выйдет 31 октября, 15:00$/);
  });
  it('the hub emits only on a real change', () => {
    const h = createJailHub(); let n = 0; h.on(() => n++);
    h.setMe({ on: true, me: null }); h.setMe({ on: true, me: null });
    h.setList({ list: [{ l: 'a' }], n: 1 }); h.setList({ list: [{ l: 'a' }], n: 1 });
    expect(n).toBe(2); expect(h.get()).toMatchObject({ on: true, me: null, n: 1 });
  });
  it('geometry: LOW.jail when present, else the 31.10 numbers from the building', () => {
    const L = withJail(fixtureLayout());
    expect(jailGeoOf(JAIL_BUILDING, L.low)).toBe(L.low!.jail);
    const g = jailGeoOf(JAIL_BUILDING, null)!;
    const keys = ['x0', 'x1', 'top', 'base', 'c0', 'c1', 'ct', 'back', 'fy', 'door', 'seats', 'walk'] as const;
    for (const k of keys) expect(g[k], k).toEqual(JAIL_LOW[k]);
    expect(mySeat(L, { ...JAIL_OFF, on: true, me: {}, list: [] })).toEqual(JAIL_LOW.seats[0]);
    expect(mySeat(L, { ...JAIL_OFF, on: true, me: null, list: [] })).toBeNull();
    expect(mySeat({ ...L, id: 'd3' }, { ...JAIL_OFF, on: true, me: {}, list: [] })).toBeNull();
    // the back: LOW.jail.back (31.10), else the retaining wall (a 30.10 LOW.jail without it)
    expect(jailBackOf(JAIL_LOW, L.low)).toBe(1652);
    const { back: _b, ...old } = JAIL_LOW;
    expect(jailBackOf(old, L.low)).toBe(L.low!.edge[1]);
  });
  it('31.10: the jail stands beyond the canal by the lower fence — off the canal, the bridges and the fence', () => {
    const L = withJail(fixtureLayout()), J = JAIL_LOW, low = L.low!;
    expect(J.back).toBeGreaterThan(low.canal[1]);              // behind it: the passage along the canal
    expect(J.fy).toBeLessThan(L.area.y1);                       // in front of it: the strip by the fence
    for (const [a, b] of low.bridges) expect(b < J.x0 || a > J.c1, `bridge ${a}…${b}`).toBe(true);
    // the site's walk grid: the passage behind, the strip in front and the door point are walkable
    for (const x of [J.x0 + 20, (J.x0 + J.c1) / 2, J.c1 - 20]) { expect(L.free(x, J.back! - 20), `passage ${x}`).toBe(true); expect(L.free(x, J.base + 34), `strip ${x}`).toBe(true); }
    expect(L.free(JAIL_BUILDING.door.x, JAIL_BUILDING.door.y)).toBe(true);
    for (const [x, y] of J.seats) expect(L.free(x, y), `seat ${x},${y}`).toBe(false);
  });
  it('the prisoner walks on the cage floor: walk rect (every seat inside), nearest point, reseat rule', () => {
    const L = withJail(fixtureLayout()), J = JAIL_LOW, w = jailWalkOf(J);
    expect(w).toEqual([1870, 1760, 2200, 1844]);
    for (const [x, y] of J.seats) expect(inJailWalk(w, x, y), `seat ${x},${y}`).toBe(true);
    const { walk: _w, ...noWalk } = J;
    expect(jailWalkOf(noWalk)).toEqual(w);   // derived like the site: 40 px off the sides, 22 off the front, back row − 16
    expect(jailWalkPt(w, 2000, 1800)).toEqual([2000, 1800]);
    expect(jailWalkPt(w, 1500, 1300)).toEqual([1870, 1760]);
    expect(jailWalkPt(w, 2600, 1900)).toEqual([2200, 1844]);
    expect(jailWalkPt(w, NaN, 1800)).toEqual([1870, 1800]);
    const st = { ...JAIL_OFF, on: true, me: {}, list: [] };
    expect(myWalk(L, st)).toEqual(w);
    expect(myWalk(L, { ...st, me: null })).toBeNull();
    expect(myWalk({ ...L, id: 'camp' }, st)).toBeNull();
    expect(needsSeat(w, 2100, 1800)).toBe(false);        // walking on the floor: stays
    expect(needsSeat(w, 2200.3, 1844.2)).toBe(false);    // on the edge
    expect(needsSeat(w, 1400, 1880)).toBe(true);         // outside (just jailed / teleported): to the seat
    expect(needsSeat(null, 2100, 1800)).toBe(true);
  });
});

describe('jail street model', () => {
  const L = withJail(fixtureLayout());
  const { k, spec, rec, ground } = staticCity(false, L);
  const top = makeSolidTop(L, new SolidMap(collectSolids(L, spec, k.solids ?? [], k.inst)));
  const J = JAIL_LOW;
  const open = (t: number) => t === -Infinity || t < -1.2;
  it('building and cage are solid from the back to the base (citymap.js JAIL_OBST); the passage behind and the strip in front are open', () => {
    const back = J.back!, mid = (back + J.base) / 2;
    for (const x of [J.x0 + 40, (J.x0 + J.x1) / 2, J.x1 - 40]) for (const y of [back + 6, mid, J.base - 10]) expect(top(x, y), `house ${x},${y}`).toBe(Infinity);
    for (const x of [J.c0 + 30, (J.c0 + J.c1) / 2, J.c1 - 30]) { expect(top(x, J.fy), `front bars ${x}`).toBe(Infinity); expect(top(x, back + 2), `back bars ${x}`).toBe(Infinity); }
    for (const y of [back + 20, mid, J.fy - 20]) { expect(top(J.c0, y)).toBe(Infinity); expect(top(J.c1, y)).toBe(Infinity); }
    // inside: a floor a prisoner stands on (finite, at the lower street), never open to walk in from outside (bars all round)
    for (const [x, y] of J.seats) { const t = top(x, y); expect(t, `seat ${x},${y}`).toBeGreaterThan(-1.5); expect(t).toBeLessThan(-1.2); }
    const w = jailWalkOf(J);
    for (const x of [w[0], (w[0] + w[2]) / 2, w[2]]) for (const y of [w[1], w[3]]) { const t = top(x, y); expect(t, `walk ${x},${y}`).toBeGreaterThan(-1.5); expect(t).toBeLessThan(-1.2); }
    for (const x of [J.x0 + 60, (J.c0 + J.c1) / 2, J.c1 - 20]) { expect(open(top(x, J.fy + 30)), `strip ${x}`).toBe(true); expect(open(top(x, back - 20)), `passage ${x}`).toBe(true); }
  });
  it('nothing of the canal / bridges / fence inside the jail; the decor moved where citymap.js lowJail puts it', () => {
    const solidCanal = toZ(map.LOW.canal[1]) + 0.35;   // the far coping
    expect(toZ(J.back!) - 0.14).toBeGreaterThan(solidCanal);
    const zFence = toZ(map.AREA.y1) + 0.8 + 0.4;          // src/world/terrain.ts cityWalls
    expect(toZ(J.fy) + 0.1).toBeLessThan(zFence - 1.2);
    const inJail = (p: { x: number; z: number }) => p.x > toX(J.x0) - 0.3 && p.x < toX(J.c1) + 0.3 && p.z > toZ(J.back!) - 0.2 && p.z < toZ(J.fy) + 0.2;
    for (const kind of ['bench', 'barrel', 'crate', 'bed', 'tree', 'lamp', 'statue']) for (const p of k.inst.placed.get(kind) ?? []) expect(inJail(p), `${kind} at ${p.x.toFixed(2)},${p.z.toFixed(2)}`).toBe(false);
    const near = (kind: string, x: number, y: number) => (k.inst.placed.get(kind) ?? []).some((p) => Math.abs(p.x - toX(x)) < 0.6 && Math.abs(p.z - toZ(y)) < 0.4);
    expect(near('barrel', 2640, 1700) || near('crate', 2640, 1700)).toBe(true);     // the barrel from the cage's place: right of the bridge
    expect(near('barrel', 1400, 1870) || near('crate', 1400, 1870)).toBe(true);     // the crate at the house's corner: left
    expect(near('barrel', 2100, 1700) || near('crate', 2100, 1700)).toBe(false);
    // the benches stay (31.10: LOW.jail.move.benches = []), the one under the Fair where the jail stood 30.10 is back
    const benches = k.inst.placed.get('bench')!.map((p) => [Math.round(p.x * 100), Math.round(p.z * 50 + 800)]);
    expect(benches.some(([x, y]) => Math.abs(x - 2100) < 30 && Math.abs(y - 1310) < 40)).toBe(true);
  });
  it('no z-fighting in the jail and the cage', () => {
    const hits = rec.find(0.004, 2e-4, ground).filter((h) => h.a.includes('jail') || h.b.includes('jail'));
    if (hits.length) console.log(hits.slice(0, 40).map((h) => `${h.a} × ${h.b}  ${(h.area * 1e4).toFixed(0)} cm² at ${h.at}`).join('\n'));
    expect(hits.length).toBe(0);
  });
  it('one interactable covers the house, the cage and the prisoners; it is not «Войти»', () => {
    const it = doorInteractables(L, () => -1.4, () => undefined).find((x) => x.id === 'door:jail')!;
    const hit = it.hit as import('three').Box3;
    expect(it.label).toBe('Тюрьма: кто в клетке');
    expect(hit.min.x).toBeLessThan(toX(J.x0 + 20)); expect(hit.max.x).toBeGreaterThan(toX(J.c1 - 20));
    expect(hit.max.z).toBeGreaterThan(toZ(J.fy));
  });
});

describe('jail support data', () => {
  it('registry, street models and supported.json know the jail (opens the site\'s window, never a room)', () => {
    expect(DEFAULT_BUILDINGS.jail).toEqual({ model: 'jail', room: 'site' });
    expect(SUPPORTED_BUILDINGS).toContain('jail');
    expect(supported.buildings.models).toContain('jail');
    expect((supported.buildings.rooms as Record<string, string>).jail).toBe('site');
  });
});

describe('jail prisoner: no «E — войти»', () => {
  it('a prisoner has no building door but the Jail\'s window (site 31.10 city.js nearBuilding → null)', () => {
    const L = withJail(fixtureLayout());
    const list = doorInteractables(L, () => -1.4, () => undefined);
    const added: { id: string; enabled?: () => boolean }[] = [];
    const ctx = {
      state: { inRoom: false, jailed: false },
      rooms: { busy: false, enter: () => Promise.resolve() },
      interact: { add: (i: { id: string; enabled?: () => boolean }) => { added.push(i); return () => { /* */ }; } },
      layout: () => L,
      world: () => ({ root: null, doors: [], interactables: () => list }),
      onWorld: () => () => { /* */ },
    };
    const off = doorsFeature.setup(ctx as never);
    const on = () => added.filter((i) => !i.enabled || i.enabled()).map((i) => i.id).sort();
    expect(on().length).toBe(L.buildings.length);
    ctx.state.jailed = true;
    expect(on()).toEqual(['door:jail']);
    ctx.state.jailed = false;
    expect(on().length).toBe(L.buildings.length);
    if (typeof off === 'function') off();
  });
});
