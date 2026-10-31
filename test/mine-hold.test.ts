import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startMineHold, type MineHoldDeps } from '../src/features/mine-hold';
import { VIEW_EVENT } from '../src/features/classic';
import { takeMineKey } from '../src/rooms/mine';

/**
 * F8 inside the mine (0.6.1: F8 in the site's 2D mine never showed the 3D; F8 twice in the 3D mine left the mine).
 * The feature against a fake room manager / game and fake site-mine deps: which room opens, what the 3D mine's hold is
 * told, and what is asked of the site's mine — never a City request, never a leave of the mine.
 */
type Log = string[];
function setup(o: { siteOpen?: boolean; key?: string | null; entered?: boolean; cityLive?: boolean; heldKey?: string | null } = {}) {
  const log: Log = [];
  const site = { open: o.siteOpen ?? true, key: o.key === undefined ? 'home.3' : o.key, entered: !!o.entered, cityLive: !!o.cityLive, heldKey: o.heldKey ?? null as string | null };
  const hold = {
    held: false,
    suspend: () => { hold.held = true; log.push('hold.suspend'); },
    resume: (k: string | null, re: boolean) => { hold.held = false; log.push(`hold.resume:${k}:${re}`); },
    release: () => log.push('hold.release'),
    key: () => 'home.3',
  };
  const rooms: any = {
    kind: null as string | null, current: null as string | null, scene: null as unknown,
    async enter(id: string) { log.push(`rooms.enter:${id}:${takeMineKey()}`); rooms.kind = 'mine3d'; rooms.current = id; rooms.scene = { hold }; },
    exit() { log.push('rooms.exit'); rooms.kind = null; rooms.current = null; rooms.scene = null; },
  };
  const game = { classic: false, toClassic: () => { game.classic = true; log.push('toClassic'); } };
  const ctx: any = { rooms, game };
  const deps: Partial<MineHoldDeps> = {
    open: () => site.open,
    key: (since) => (since === undefined || since === -Infinity || site.entered ? site.key : null),
    enteredSince: () => site.entered,
    hide: (k) => log.push(`site.hide:${k}`),
    show: () => { log.push('site.show'); return () => log.push('site.show.stop'); },
    openFromCity: (k) => { log.push(`site.openFromCity:${k}`); return true; },
    cityLive: () => site.cityLive,
    heldKey: () => site.heldKey,
    setHeldKey: (k) => { site.heldKey = k; },
    now: () => 1000,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
  };
  return { log, site, hold, rooms, game, ctx, deps };
}
const view = (classic: boolean, reason?: string) => window.dispatchEvent(new CustomEvent(VIEW_EVENT, { detail: { classic, reason } }));
const flush = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => { vi.stubGlobal('window', new EventTarget()); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('mine-hold: 3D starts inside the site\'s own 2D mine (F8 there)', () => {
  it('opens the 3D mine on the floor the site\'s mine shows, keeping the site\'s mine hidden underneath', async () => {
    const t = setup({ key: 'home.3' });
    const off = startMineHold(t.ctx, t.deps);
    await flush();
    expect(t.log).toEqual(['site.hide:home.3', 'rooms.enter:mine:home.3']);
    expect(t.rooms.kind).toBe('mine3d');
    off();
  });
  it('outside the mine nothing happens', async () => {
    const t = setup({ siteOpen: false });
    const off = startMineHold(t.ctx, t.deps); await flush();
    expect(t.log).toEqual([]); off();
  });
});

describe('mine-hold: F8 out of / back into the 3D mine', () => {
  const inMine = async (o: Parameters<typeof setup>[0] = {}) => { const t = setup(o); const off = startMineHold(t.ctx, t.deps); await flush(); t.log.length = 0; return { ...t, off }; };

  it('F8 out: the 3D mine holds (no leave), the site\'s mine is shown and takes the presence back', async () => {
    const t = await inMine();
    view(true);
    expect(t.log).toEqual(['hold.suspend', 'site.show']);
    expect(t.rooms.kind).toBe('mine3d');   // the room is NOT left
    t.off();
  });
  it('F8 back after the site took the presence back: hidden again, our client enters once on the same floor', async () => {
    const t = await inMine();
    view(true); t.site.entered = true; t.log.length = 0;
    view(false);
    expect(t.log).toEqual(['site.show.stop', 'site.hide:home.3', 'hold.resume:home.3:true']);
    t.off();
  });
  it('F8 back with nothing sent by the site meanwhile: no enter (a state read only), the held floor', async () => {
    const t = await inMine({ heldKey: 'home.3' });
    view(true); t.log.length = 0;
    view(false);
    expect(t.log).toEqual(['site.show.stop', 'site.hide:home.3', 'hold.resume:home.3:false']);
    t.off();
  });
  it('the site\'s mine rode to another floor in 2D: the 3D mine follows it', async () => {
    const t = await inMine();
    view(true); t.site.entered = true; t.site.key = 'home'; t.log.length = 0;
    view(false);
    expect(t.log).toContain('hold.resume:home:true');
    t.off();
  });
  it('the site left its mine in 2D («В город»): the 3D mine closes without a request, the 3D street shows', async () => {
    const t = await inMine({ heldKey: 'home.3' });
    view(true); t.site.open = false; t.log.length = 0;
    view(false);
    expect(t.log).toEqual(['site.show.stop', 'hold.release', 'rooms.exit']);
    t.off();
  });
  it('a 3D mine entered from the 3D street (no site mine, the City live): F8 opens the site\'s mine the way a click does', async () => {
    const t = setup({ siteOpen: false, cityLive: true });
    const off = startMineHold(t.ctx, t.deps); await flush();
    await t.rooms.enter('mine'); t.log.length = 0;
    view(true);
    expect(t.log).toEqual(['hold.suspend', 'site.openFromCity:home.3']);
    off();
  });
  it('a site panel asked for from the 3D menu: the 3D mine holds, the site\'s mine stays hidden', async () => {
    const t = await inMine();
    view(true, 'panel');
    expect(t.log).toEqual(['hold.suspend']);
    t.off();
  });
  it('the site\'s mine opened in 2D while the 3D was on the street: F8 opens it in 3D', async () => {
    const t = setup({ siteOpen: false });
    const off = startMineHold(t.ctx, t.deps); await flush();
    view(true); t.site.open = true; t.site.entered = true; t.site.key = 'd12';
    view(false); await flush();
    expect(t.log).toEqual(['site.hide:d12', 'site.hide:d12', 'rooms.enter:mine:d12']);
    off();
  });
  it('the 3D mine cannot open: back to the classic site honestly (no hidden 3D behind the site\'s mine)', async () => {
    vi.useFakeTimers();
    const t = setup();
    t.rooms.enter = async () => { t.log.push('rooms.enter:fail'); };
    const off = startMineHold(t.ctx, { ...t.deps, now: () => Date.now() });
    await vi.advanceTimersByTimeAsync(20000);
    expect(t.log[t.log.length - 1]).toBe('toClassic');
    off(); vi.useRealTimers();
  });
});
