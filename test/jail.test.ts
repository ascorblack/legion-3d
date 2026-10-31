/**
 * «Тюрьма и клетка» (site 30.10): the pure helpers of src/net/jail.ts (me.jail / me.jl, the /api/jail list, the seats like
 * city.js jailDraw, the prisoner's bar like app.js jailUi), the street model of src/world/jail.ts (solids = citymap.js JAIL_OBST,
 * no z-fighting) and the registry / supported data (drift shows no «without support»).
 */
import { describe, it, expect } from 'vitest';
import { createJailHub, jailBar, jailDay, jailFromMe, jailGeoOf, jailList, jailMore, jailSeats, JAIL_OFF } from '../src/net/jail';
import { fixtureLayout, withJail, JAIL_LOW, JAIL_BUILDING } from '../dev/fixtures';
import { staticCity } from './world-fixture';
import { SolidMap, collectSolids, makeSolidTop } from '../src/world/solid';
import { DEFAULT_BUILDINGS } from '../src/core/registries';
import { SUPPORTED_BUILDINGS } from '../src/world/supported';
import { doorInteractables } from '../src/world/worldExt';
import supported from '../src/data/supported.json';
import { toX, toZ } from '../src/world/coords';
import { mySeat } from '../src/features/jail';

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
  it('geometry: LOW.jail when present, else the 30.10 numbers from the building', () => {
    const L = withJail(fixtureLayout());
    expect(jailGeoOf(JAIL_BUILDING, L.low)).toBe(L.low!.jail);
    const g = jailGeoOf(JAIL_BUILDING, null)!;
    expect([g.x0, g.x1, g.c0, g.c1, g.fy, g.door[0], g.door[1]]).toEqual([JAIL_LOW.x0, JAIL_LOW.x1, JAIL_LOW.c0, JAIL_LOW.c1, JAIL_LOW.fy, JAIL_LOW.door[0], JAIL_LOW.door[1]]);
    expect(mySeat(L, { ...JAIL_OFF, on: true, me: {}, list: [] })).toEqual(JAIL_LOW.seats[0]);
    expect(mySeat(L, { ...JAIL_OFF, on: true, me: null, list: [] })).toBeNull();
    expect(mySeat({ ...L, id: 'd3' }, { ...JAIL_OFF, on: true, me: {}, list: [] })).toBeNull();
  });
});

describe('jail street model', () => {
  const L = withJail(fixtureLayout());
  const { k, spec, rec, ground } = staticCity(false, L);
  const top = makeSolidTop(L, new SolidMap(collectSolids(L, spec, k.solids ?? [], k.inst)));
  const J = JAIL_LOW;
  it('building and cage are solid from the wall to the base (citymap.js JAIL_OBST); the street in front is open', () => {
    for (const x of [J.x0 + 40, (J.x0 + J.x1) / 2, J.x1 - 40]) for (const y of [1150, 1250, J.base - 10]) expect(top(x, y), `house ${x},${y}`).toBe(Infinity);
    for (const x of [J.c0 + 30, (J.c0 + J.c1) / 2, J.c1 - 30]) expect(top(x, J.fy), `bars ${x}`).toBe(Infinity);
    for (const y of [1160, 1250, 1320]) { expect(top(J.c0, y)).toBe(Infinity); expect(top(J.c1, y)).toBe(Infinity); }
    // inside: a floor a prisoner stands on (finite, at the lower street), never open to walk in from outside (bars all round)
    for (const [x, y] of J.seats) { const t = top(x, y); expect(t, `seat ${x},${y}`).toBeGreaterThan(-1.5); expect(t).toBeLessThan(-1.2); }
    for (const x of [J.x0 + 60, (J.c0 + J.c1) / 2, J.c1 - 20]) { const t = top(x, J.fy + 40); expect(t === -Infinity || t < -1.2, `street ${x}`).toBe(true); }
  });
  it('the moved benches stand where citymap.js lowJail puts them', () => {
    const benches = k.inst.placed.get('bench')!.map((p) => [Math.round(p.x * 100), Math.round(p.z * 50 + 800)]);
    expect(benches.some(([x, y]) => Math.abs(x - 2330) < 30 && Math.abs(y - 1300) < 40)).toBe(true);
    expect(benches.some(([x, y]) => Math.abs(x - 2100) < 30 && Math.abs(y - 1310) < 40)).toBe(false);   // was in the cage
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
