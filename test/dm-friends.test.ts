/**
 * Site DMs (window.LGDm) and friends (window.LGFriends) in the 3D UI — src/ui/dm.ts, src/ui/friends-chip.ts,
 * src/features/friends.ts. Fake LGDm / LGFriends / DOM: the site's own code is never loaded here; the real thing runs in the page
 * harness (.local/dmfr/scenarios.mjs). What is pinned: the nick menu of the mine tab = the site's items and actions, nothing is
 * sent by building a menu, the toast of an incoming DM, the small window's focus handling, the friends window's modal,
 * the chip's count from the site's badge, «zero requests of our own».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DM_KEY, DmBridge, dmOneOn, dmToast, nickMenuItems, type DmApi, type DmHooks, type FriendsApi } from '../src/ui/dm';
import { FRIENDS_CSS_ID, MODAL_ID, badgeCount, startFriends } from '../src/features/friends';
import { pauseItem } from '../src/ui/settings-ext';

/* ------------------------------------------------------------------ fakes */

class FakeEl extends EventTarget {
  hidden = false; disabled = false; isConnected = true; shown = true; value = '';
  private cls = new Set<string>();
  kids: Record<string, FakeEl | null> = {};
  textContent = '';
  clicks = 0; focused = 0; blurred = 0;
  classList = { contains: (c: string) => this.cls.has(c), add: (c: string) => { this.cls.add(c); }, remove: (c: string) => { this.cls.delete(c); } };
  getClientRects() { return this.shown ? [{}] : []; }
  querySelector(sel: string) { return this.kids[sel] ?? null; }
  contains(x: unknown) { return x === this || Object.values(this.kids).includes(x as FakeEl); }
  click() { this.clicks++; this.dispatchEvent(new Event('click')); }
  focus() { this.focused++; (this.doc as any).activeElement = this; this.dispatchEvent(new Event('focusin')); }
  blur() { this.blurred++; if ((this.doc as any).activeElement === this) { (this.doc as any).activeElement = null; } this.dispatchEvent(new Event('focusout')); }
  doc: unknown = null;
}

function fakeLgDm(unread = 0) {
  const listeners = new Map<string, (why: string) => void>();
  const api = {
    open: vi.fn((_l: string, _o?: unknown) => true), on: vi.fn((k: string, f: ((w: string) => void) | null) => { if (f) listeners.set(k, f); else listeners.delete(k); }),
    place: vi.fn(), report: vi.fn(async () => true), unread: vi.fn(() => unread),
  };
  return { api: api as unknown as DmApi & typeof api, listeners, set: (n: number) => { unread = n; }, fire: (why = 'change') => { for (const f of listeners.values()) f(why); } };
}
function fakeFriends(state: 'none' | 'friends' | 'in' = 'none') {
  const api = {
    open: vi.fn(),
    menuItems: vi.fn((_nk: string): Array<[string, string, boolean?]> => state === 'friends' ? [['fr-on', 'В друзьях', true], ['fr-blk', 'Заблокировать']] : state === 'in' ? [['fr-acc', 'Принять в друзья'], ['fr-blk', 'Заблокировать']] : [['fr-add', 'Добавить в друзья'], ['fr-blk', 'Заблокировать']]),
    menuAct: vi.fn(),
  };
  return api as unknown as FriendsApi & typeof api;
}

/* ------------------------------------------------------------------ nick menu of the mine tab */

describe('nickMenuItems — the site\'s nick menu on a line of our mine tab', () => {
  type Deps = Parameters<typeof nickMenuItems>[2];
  type Full = Deps & { dmApi: NonNullable<Deps['dmApi']>; friends: NonNullable<Deps['friends']> };
  const base = (over: Partial<Deps> = {}): Full => ({ me: 'me_player', dm: true, dmApi: fakeLgDm().api, friends: fakeFriends(), reply: vi.fn(), ask: vi.fn(() => 'спам'), ...over }) as Full;

  it('no menu for myself or an empty nick', () => {
    expect(nickMenuItems('me_player', 'Я', base())).toEqual([]);
    expect(nickMenuItems('@ME_PLAYER', 'Я', base())).toEqual([]);
    expect(nickMenuItems('', '', base())).toEqual([]);
  });

  it('site order: Ответить · Написать · Пожаловаться · friends items (key titles of LGFriends.menuItems)', () => {
    const d = base();
    const items = nickMenuItems('Kotik_One', 'Котик_1', d);
    expect(items.map((i) => i.label)).toEqual(['Ответить', '✉ Написать', 'Пожаловаться', 'Добавить в друзья', 'Заблокировать']);
    expect(items.map((i) => !!i.bad)).toEqual([false, false, false, false, true]);
    expect(d.friends.menuItems).toHaveBeenCalledWith('kotik_one');
  });

  it('building the menu sends nothing: no open / report / menuAct until an item is picked', () => {
    const d = base(); nickMenuItems('kotik_one', 'Котик_1', d);
    expect(d.dmApi.open).not.toHaveBeenCalled(); expect(d.dmApi.report).not.toHaveBeenCalled(); expect(d.friends.menuAct).not.toHaveBeenCalled(); expect(d.reply).not.toHaveBeenCalled();
  });

  it('every pick is the site\'s own action: Ответить → «@ник», Написать → LGDm.open(ник, {name}), friends → LGFriends.menuAct(key, ник)', () => {
    const d = base();
    const [reply, write, , add, block] = nickMenuItems('kotik_one', 'Котик_1', d);
    reply.run(); expect(d.reply).toHaveBeenCalledWith('kotik_one');
    write.run(); expect(d.dmApi.open).toHaveBeenCalledWith('kotik_one', { name: 'Котик_1' });
    add.run(); expect(d.friends.menuAct).toHaveBeenLastCalledWith('fr-add', 'kotik_one');
    block.run(); expect(d.friends.menuAct).toHaveBeenLastCalledWith('fr-blk', 'kotik_one');   // the site's confirm() is inside menuAct
    expect(d.friends.menuAct).toHaveBeenCalledTimes(2);
  });

  it('Пожаловаться asks for the reason like the site and reports only when not cancelled', async () => {
    const d = base();
    const rep = nickMenuItems('kotik_one', 'Котик_1', d)[2];
    d.ask = vi.fn(() => null); await rep.run(); expect(d.dmApi.report).not.toHaveBeenCalled();
    const d2 = base(); await nickMenuItems('kotik_one', 'Котик_1', d2)[2].run();
    expect(d2.ask).toHaveBeenCalledOnce(); expect(String((d2.ask as any).mock.calls[0][0])).toContain('последние 30 сообщений');
    expect(d2.dmApi.report).toHaveBeenCalledWith('kotik_one', 'спам');
  });

  it('friend states come from the site: «Принять в друзья», a disabled «В друзьях» still opens the list through menuAct', () => {
    expect(nickMenuItems('a_b', 'A', base({ friends: fakeFriends('in') })).map((i) => i.label)).toContain('Принять в друзья');
    const d = base({ friends: fakeFriends('friends') });
    const it = nickMenuItems('a_b', 'A', d).find((i) => i.label === 'В друзьях')!;
    it.run(); expect(d.friends.menuAct).toHaveBeenCalledWith('fr-on', 'a_b');
  });

  it('no Личные for this hero → no Написать / Пожаловаться; no LGDm / LGFriends (old site) → only Ответить', () => {
    expect(nickMenuItems('a_b', 'A', base({ dm: false })).map((i) => i.label)).toEqual(['Ответить', 'Добавить в друзья', 'Заблокировать']);
    expect(nickMenuItems('a_b', 'A', base({ dmApi: null, friends: null })).map((i) => i.label)).toEqual(['Ответить']);
  });

  it('a throwing LGFriends.menuItems does not break the menu', () => {
    const f = fakeFriends(); f.menuItems.mockImplementation(() => { throw new Error('x'); });
    expect(nickMenuItems('a_b', 'A', base({ friends: f })).map((i) => i.label)).toEqual(['Ответить', '✉ Написать', 'Пожаловаться']);
  });
});

describe('dmToast', () => {
  it('names the sender, trims it, and has a generic form', () => {
    expect(dmToast('Мурка')).toBe('✉ Мурка: новое личное сообщение');
    expect(dmToast('')).toBe('✉ Новое личное сообщение'); expect(dmToast(null)).toBe('✉ Новое личное сообщение');
    expect(dmToast('x'.repeat(100))).toBe(`✉ ${'x'.repeat(40)}: новое личное сообщение`);
  });
});

/* ------------------------------------------------------------------ DmBridge */

function bridge(over: { lg?: ReturnType<typeof fakeLgDm> | null; float?: FakeEl | null; me?: string; one?: () => boolean } = {}) {
  const bus = new Map<string, Array<(d: any) => void>>();
  const win: any = {
    LGDm: over.lg === null ? undefined : (over.lg ?? fakeLgDm()).api,
    __L3D_BUS: { on: (t: string, f: (d: any) => void) => { bus.set(t, [...(bus.get(t) || []), f]); return () => bus.set(t, (bus.get(t) || []).filter((x) => x !== f)); } },
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (t: any) => clearTimeout(t),
  };
  const doc: any = { activeElement: null, querySelector: (s: string) => (s === '.dm-float' ? (over.float ?? null) : null) };
  if (over.float) { over.float.doc = doc; for (const k of Object.values(over.float.kids)) if (k) k.doc = doc; }
  const hooks = { toast: vi.fn(), floatFocus: vi.fn(), show: vi.fn(), me: () => over.me ?? 'me_player', one: over.one } satisfies DmHooks;
  const br = new DmBridge(hooks, win, doc);
  const emit = (t: string, d: unknown) => { for (const f of bus.get(t) || []) f(d); };
  return { br, win, doc, hooks, emit, bus };
}

describe('DmBridge — LGDm hooks, toast', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000); });
  afterEach(() => { vi.useRealTimers(); });

  it('subscribes to LGDm under its own key (also when the site loads LGDm late) and does not touch anything else', () => {
    const lg = fakeLgDm();
    const t = bridge({ lg: null });
    t.br.scan(); expect(lg.api.on).not.toHaveBeenCalled();
    t.win.LGDm = lg.api; t.br.scan();
    expect(lg.api.on).toHaveBeenCalledWith(DM_KEY, expect.any(Function));
    t.br.scan(); expect(lg.api.on).toHaveBeenCalledTimes(1);
    expect(lg.api.open).not.toHaveBeenCalled();
    t.br.dispose(); expect(lg.api.on).toHaveBeenLastCalledWith(DM_KEY, null);
  });

  it('«show» (someone asked LGDm to show a conversation) → the hook that steps the mine tab back', () => {
    const lg = fakeLgDm(); const t = bridge({ lg }); t.br.scan();
    lg.fire('show'); expect(t.hooks.show).toHaveBeenCalledOnce();
    lg.fire('change'); expect(t.hooks.show).toHaveBeenCalledOnce();
  });

  it('unread grows → one toast with the sender from the SSE «dm» event (either order of the two listeners)', () => {
    const lg = fakeLgDm(); const t = bridge({ lg }); t.br.scan();
    lg.set(1); lg.fire();                                                       // LGDm first …
    t.emit('sse:dm', { m: { id: '1', fl: 'murka_mod', fn: 'Мурка', tl: 'me_player', t: 'ау' } });   // … the bus after
    vi.advanceTimersByTime(80);
    expect(t.hooks.toast).toHaveBeenCalledOnce(); expect(t.hooks.toast).toHaveBeenCalledWith('✉ Мурка: новое личное сообщение');
  });

  it('a toast without a known sender is generic; own messages (other tab) never name or raise one; a read DM (unread drops) is silent', () => {
    const lg = fakeLgDm(); const t = bridge({ lg }); t.br.scan();
    t.emit('sse:dm', { m: { id: '0', fl: 'me_player', fn: 'Я', tl: 'x' } });    // my own message from another tab: not a sender
    lg.set(1); lg.fire(); vi.advanceTimersByTime(80);
    expect(t.hooks.toast).toHaveBeenLastCalledWith('✉ Новое личное сообщение');
    lg.set(0); lg.fire(); vi.advanceTimersByTime(3000);
    expect(t.hooks.toast).toHaveBeenCalledTimes(1);
  });

  it('a burst is one toast per 2.5 s; a stale sender is not named', () => {
    const lg = fakeLgDm(); const t = bridge({ lg }); t.br.scan();
    t.emit('sse:dm', { m: { id: '1', fl: 'a_b', fn: 'Аб' } });
    lg.set(1); lg.fire(); lg.set(2); lg.fire(); lg.set(3); lg.fire(); vi.advanceTimersByTime(80);
    expect(t.hooks.toast).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    lg.set(4); lg.fire(); vi.advanceTimersByTime(80);
    expect(t.hooks.toast).toHaveBeenCalledTimes(2); expect(t.hooks.toast).toHaveBeenLastCalledWith('✉ Новое личное сообщение');
  });

  it('site 30.10 chatone (c1): no listener on LGDm (its open() waits for the single chat only while nobody listens); toasts from the counter; off again → listener back', () => {
    const lg = fakeLgDm(); let one = true;
    const t = bridge({ lg, one: () => one });
    t.br.scan(); expect(lg.api.on).not.toHaveBeenCalled();
    lg.set(1); t.br.scan(); vi.advanceTimersByTime(80);
    expect(t.hooks.toast).toHaveBeenCalledOnce();
    lg.fire('show'); expect(t.hooks.show).not.toHaveBeenCalled();   // «show» is the single chat's
    one = false; t.br.scan(); expect(lg.api.on).toHaveBeenCalledWith(DM_KEY, expect.any(Function));
    one = true; t.br.scan(); expect(lg.api.on).toHaveBeenLastCalledWith(DM_KEY, null);
    t.br.dispose(); expect(lg.api.on).toHaveBeenCalledTimes(2);
  });
  it('dmOneOn mirrors app.js oneIsOn: c1 and a feed (cc / mc) and LGChatOne', () => {
    const w: any = { LGChatOne: {} };
    expect(dmOneOn({ c1: 1, cc: 1 }, w)).toBe(true);
    expect(dmOneOn({ c1: 1, mc: 1 }, w)).toBe(true);
    expect(dmOneOn({ c1: 1 }, w)).toBe(false);
    expect(dmOneOn({ cc: 1 }, w)).toBe(false);
    expect(dmOneOn({ c1: 1, cc: 1 }, {} as any)).toBe(false);
    expect(dmOneOn(null, w)).toBe(false);
  });

  it('unread at the time of the first scan is not announced (restored from the page)', () => {
    const lg = fakeLgDm(3); const t = bridge({ lg }); t.br.scan(); lg.fire(); vi.advanceTimersByTime(200);
    expect(t.hooks.toast).not.toHaveBeenCalled();
  });

  it('place() is LGDm.place() and tolerates an old LGDm without it', () => {
    const lg = fakeLgDm(); const t = bridge({ lg }); t.br.scan(); t.br.place(); expect(lg.api.place).toHaveBeenCalledOnce();
    delete (lg.api as any).place; expect(() => t.br.place()).not.toThrow();
  });
});

describe('DmBridge — the site\'s small window outside the chat', () => {
  const mkFloat = () => {
    const fl = new FakeEl(); const inp = new FakeEl(); const ft = new FakeEl();
    fl.kids = { '.dm-f input': inp, '.dm-ft': ft };
    return { fl, inp, ft };
  };
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('focus in → gameplay off hook; Esc leaves the field (and is eaten: no pause menu); focus out → on again', () => {
    const { fl, inp } = mkFloat(); const t = bridge({ float: fl }); t.br.scan();
    inp.focus(); fl.dispatchEvent(new Event('focusin'));
    expect(t.br.floatFocused).toBe(true); expect(t.hooks.floatFocus).toHaveBeenCalledWith(true);
    const esc = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
    t.doc.activeElement = inp; let stopped = false; (esc as any).stopPropagation = () => { stopped = true; };
    fl.dispatchEvent(esc); expect(stopped).toBe(true); expect(esc.defaultPrevented).toBe(true);
    t.doc.activeElement = null; fl.dispatchEvent(new Event('focusout')); vi.advanceTimersByTime(5);
    expect(t.br.floatFocused).toBe(false); expect(t.hooks.floatFocus).toHaveBeenLastCalledWith(false);
  });

  it('focusFloat: needs a visible window with a field; unfolds a folded one; false when nothing to focus', () => {
    const { fl, inp, ft } = mkFloat(); const t = bridge({ float: fl }); t.br.scan();
    expect(t.br.floatShown()).toBe(true);
    fl.classList.add('fold');
    expect(t.br.focusFloat()).toBe(true); expect(ft.clicks).toBe(1); expect(inp.focused).toBe(1);
    inp.disabled = true; expect(t.br.focusFloat()).toBe(false);
    inp.disabled = false; fl.hidden = true; expect(t.br.floatShown()).toBe(false); expect(t.br.focusFloat()).toBe(false);
    const none = bridge({ float: null }); none.br.scan(); expect(none.br.focusFloat()).toBe(false);
  });

  it('the window going away while focused gives gameplay back', () => {
    const { fl } = mkFloat(); const t = bridge({ float: fl }); t.br.scan();
    fl.dispatchEvent(new Event('focusin')); expect(t.br.floatFocused).toBe(true);
    (t.doc as any).querySelector = () => null; t.br.scan();
    expect(t.br.floatFocused).toBe(false); expect(t.hooks.floatFocus).toHaveBeenLastCalledWith(false);
  });
});

/* ------------------------------------------------------------------ friends feature */

describe('badgeCount — the badge of the site\'s «Друзья» button', () => {
  const btn = (n: FakeEl | null) => ({ querySelector: () => n }) as unknown as Element;
  it('hidden / empty / junk = 0, numbers and 99+', () => {
    const b = new FakeEl();
    expect(badgeCount(null)).toBe(0); expect(badgeCount(btn(null))).toBe(0);
    b.hidden = true; b.textContent = '3'; expect(badgeCount(btn(b))).toBe(0);
    b.hidden = false; expect(badgeCount(btn(b))).toBe(3);
    b.textContent = '99+'; expect(badgeCount(btn(b))).toBe(99);
    b.textContent = ''; expect(badgeCount(btn(b))).toBe(0); b.textContent = 'x'; expect(badgeCount(btn(b))).toBe(0);
  });
});

function friendsSetup(over: { api?: boolean; btn?: boolean; badge?: string } = {}) {
  const badge = new FakeEl(); badge.textContent = over.badge ?? ''; badge.hidden = !over.badge;
  const frBtn: any = over.btn === false ? null : { querySelector: () => badge };
  const style = { id: '', textContent: '', removed: false, remove() { this.removed = true; } };
  let win: FakeEl | null = null; const xBtn = new FakeEl();
  const bodyMo: { cb: (() => void) | null } = { cb: null };
  const docListeners = new Map<string, () => void>();
  const doc: any = {
    getElementById: (id: string) => (id === 'frBtn' ? frBtn : id === FRIENDS_CSS_ID && style.id ? style : null),
    querySelector: (s: string) => (s === '.fr-back' ? win : s === '.fr-back .fr-x' ? (win ? xBtn : null) : null),
    createElement: () => style, head: { appendChild: vi.fn() }, body: {}, fullscreenElement: null,
    addEventListener: (t: string, f: () => void) => { docListeners.set(t, f); }, removeEventListener: (t: string) => { docListeners.delete(t); },
  };
  class FakeWin extends EventTarget {}
  const w: any = new FakeWin(); w.setInterval = (f: () => void, ms: number) => setInterval(f, ms); w.clearInterval = (t: any) => clearInterval(t);
  const fr = over.api === false ? null : fakeFriends();
  (globalThis as any).MutationObserver = class { constructor(public cb: () => void) { bodyMo.cb = cb; } observe() { /* */ } disconnect() { bodyMo.cb = null; } };
  const input = { setGameplay: vi.fn(), pushModal: vi.fn(), popModal: vi.fn(), unlock: vi.fn() };
  const fetchSpy = vi.fn(); (globalThis as any).fetch = fetchSpy;
  const get = vi.fn(), post = vi.fn();
  const ctx: any = { input, actions: { get, post }, uiRoot: null };
  const renders: number[] = []; let chipOpen: (() => void) | null = null; let chipDisposed = false;
  const off = startFriends(ctx, { win: w, doc, api: () => fr, hudParent: () => ({}) as Element, pollMs: 500,
    mount: (_p, onOpen) => { chipOpen = onOpen; return { render: (n) => { renders.push(n); }, dispose: () => { chipDisposed = true; } }; } });
  return {
    off, fr, input, renders, style, xBtn, badge, get, post, fetchSpy, w,
    chipOpen: () => chipOpen!(), chipDisposed: () => chipDisposed,
    showWindow: (on: boolean) => { win = on ? new FakeEl() : null; bodyMo.cb?.(); },
    setBadge: (t: string) => { badge.textContent = t; badge.hidden = !t; },
  };
}

describe('friends feature — «Друзья» in the 3D UI', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); delete (globalThis as any).MutationObserver; delete (globalThis as any).fetch; });

  it('pause-menu entry «Друзья» only when the site started friends (LGFriends + its header button)', () => {
    const a = friendsSetup(); const it = pauseItem('friends.open')!;
    expect(it.label).toBe('Друзья'); expect(it.enabled!()).toBe(true);
    a.off(); expect(pauseItem('friends.open')).toBeUndefined();
    const b = friendsSetup({ api: false }); expect(pauseItem('friends.open')!.enabled!()).toBe(false); b.off();
    const c = friendsSetup({ btn: false }); expect(pauseItem('friends.open')!.enabled!()).toBe(false); c.off();
  });

  it('the entry opens the site\'s window: LGFriends.open() and nothing else', () => {
    const s = friendsSetup();
    pauseItem('friends.open')!.run();
    expect(s.fr!.open).toHaveBeenCalledOnce(); expect(s.fr!.menuAct).not.toHaveBeenCalled();
    s.off();
  });

  it('chip: count from the site\'s badge, polled; a click opens the window; hidden by photo mode', () => {
    const s = friendsSetup({ badge: '2' });
    expect(s.renders.at(-1)).toBe(2);
    s.setBadge('5'); vi.advanceTimersByTime(600); expect(s.renders.at(-1)).toBe(5);
    s.setBadge(''); vi.advanceTimersByTime(600); expect(s.renders.at(-1)).toBe(0);
    s.setBadge('3'); vi.advanceTimersByTime(600);
    s.w.dispatchEvent(Object.assign(new Event('l3d:photo'), { detail: { on: true } })); expect(s.renders.at(-1)).toBe(0);
    s.w.dispatchEvent(Object.assign(new Event('l3d:photo'), { detail: { on: false } })); expect(s.renders.at(-1)).toBe(3);
    s.chipOpen(); expect(s.fr!.open).toHaveBeenCalledOnce();
    s.off(); expect(s.chipDisposed()).toBe(true);
  });

  it('the site\'s window = a modal on the input (pointer free, gameplay off, Esc closes via its «×»); popped when it goes', () => {
    const s = friendsSetup();
    expect(s.input.pushModal).not.toHaveBeenCalled();
    s.showWindow(true);
    expect(s.input.pushModal).toHaveBeenCalledWith(MODAL_ID, expect.any(Function));
    const close = s.input.pushModal.mock.calls[0][1] as () => void;
    close(); expect(s.xBtn.clicks).toBe(1);
    s.showWindow(true); expect(s.input.pushModal).toHaveBeenCalledOnce();     // idempotent
    s.showWindow(false); expect(s.input.popModal).toHaveBeenCalledWith(MODAL_ID);
    s.off();
  });

  it('a window opened by the site itself (nick menu «В друзьях») is picked up by the poll too; dispose pops an open modal', () => {
    const s = friendsSetup();
    s.showWindow(true); s.input.pushModal.mockClear();
    s.off(); expect(s.input.popModal).toHaveBeenCalledWith(MODAL_ID);
  });

  it('CSS lifting the window above the canvas is added once and removed on dispose; zero requests of our own', () => {
    const s = friendsSetup({ badge: '1' });
    expect(s.style.id).toBe(FRIENDS_CSS_ID); expect(s.style.textContent).toContain('.fr-back'); expect(s.style.textContent).toContain('z-index');
    pauseItem('friends.open')!.run(); s.chipOpen(); s.showWindow(true); vi.advanceTimersByTime(5000);
    expect(s.get).not.toHaveBeenCalled(); expect(s.post).not.toHaveBeenCalled(); expect(s.fetchSpy).not.toHaveBeenCalled();
    s.off(); expect(s.style.removed).toBe(true);
  });

  it('without LGFriends the chip stays at 0 and open() does nothing', () => {
    const s = friendsSetup({ api: false, badge: '4' });
    expect(s.renders.at(-1)).toBe(0); s.chipOpen(); expect(s.input.pushModal).not.toHaveBeenCalled();
    s.off();
  });
});
