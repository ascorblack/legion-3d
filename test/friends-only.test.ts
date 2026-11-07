/**
 * «Только друзей» in the 3D crowd (site city.js lgCityFr / LGFriends.friends; 07.11 the eye button .cy-fro):
 * src/net/friends-only.ts mirrors city.js frOn / frLoad / lodPick.
 */
import { describe, it, expect } from 'vitest';
import { FriendsOnly, FR_KEY, toggleFriendsOnly } from '../src/net/friends-only';
import { siteCopy } from './site-quest-fns';

const flush = () => new Promise((r) => setTimeout(r, 0));
function deps(init: Record<string, string> = {}, list: string[] | null = ['Friend1', 'friend2']) {
  const ls = new Map(Object.entries(init));
  let calls = 0;
  const d = {
    ls, get calls() { return calls; },
    get: (k: string) => ls.get(k) ?? null,
    set: (k: string, v: string | null) => { if (v == null) ls.delete(k); else ls.set(k, v); },
    friends: () => (list ? () => { calls++; return Promise.resolve(list.slice()); } : null),
  };
  return d;
}

describe('FriendsOnly (city.js frOn = lgCityFr && LGFriends.friends)', () => {
  it('off: everybody is drawn and no list is asked for', async () => {
    const d = deps(); const f = new FriendsOnly(d);
    f.tick(0); await flush();
    expect(f.on).toBe(false);
    expect(f.allows('stranger')).toBe(true);
    expect(d.calls).toBe(0);
  });
  it('on: nobody until the list comes, then only friends (case-insensitive)', async () => {
    const d = deps({ [FR_KEY]: '1' }); const f = new FriendsOnly(d);
    f.tick(0);
    expect(f.on).toBe(true);
    expect(f.allows('friend1')).toBe(false);   // the site's S.frs is empty until LGFriends.friends() resolves
    await flush();
    expect(f.allows('FRIEND1')).toBe(true);
    expect(f.allows('friend2')).toBe(true);
    expect(f.allows('stranger')).toBe(false);
    expect(d.calls).toBe(1);
  });
  it('re-reads the flag twice a second, the list once a minute', async () => {
    const d = deps({ [FR_KEY]: '1' }); const f = new FriendsOnly(d);
    f.tick(0); await flush();
    f.tick(100); f.tick(30_000); await flush();
    expect(d.calls).toBe(1);
    f.tick(61_000); await flush();
    expect(d.calls).toBe(2);
    d.ls.delete(FR_KEY);
    f.tick(61_100); expect(f.on).toBe(true);    // < 500 ms since the last read
    f.tick(61_600); expect(f.on).toBe(false);
    expect(f.allows('stranger')).toBe(true);
  });
  it('without the site\'s friends module the flag alone does nothing (frOk)', () => {
    const f = new FriendsOnly(deps({ [FR_KEY]: '1' }, null));
    f.tick(0);
    expect(f.on).toBe(false);
    expect(f.allows('stranger')).toBe(true);
  });
  it('a failing list keeps the filter on with what it had', async () => {
    const d = deps({ [FR_KEY]: '1' });
    const f = new FriendsOnly({ get: d.get, friends: () => () => Promise.reject(new Error('net')) });
    f.tick(0); await flush();
    expect(f.on).toBe(true);
    expect(f.allows('x')).toBe(false);
  });
  it('the pause-menu toggle writes the site\'s own key', () => {
    const d = deps();
    expect(toggleFriendsOnly(d)).toBe(true);
    expect(d.ls.get(FR_KEY)).toBe('1');
    expect(toggleFriendsOnly(d)).toBe(false);
    expect(d.ls.has(FR_KEY)).toBe(false);
  });
  it.skipIf(!siteCopy('city.js', 'cy-fro'))('city.js: the same key, the same friends list, the eye button', () => {
    const src = siteCopy('city.js', 'cy-fro')!;
    expect(src).toMatch(/lgCityFr/);
    expect(src).toMatch(/LGFriends\.friends\(\)/);
    expect(src).toMatch(/S\.onlyFr = on/);
  });
});
