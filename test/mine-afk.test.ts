import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { MineModel } from '../src/rooms/mine/state';
import {
  fmtEta, titleFor, mineStatus, alertOf, chimeEvents, bgAlertMode, StepGuard, TabSignals, RenderThrottle, reachK,
  REACH_LIMIT, RING_R, IDLE_MS, HOLD_MS, ECO_AFTER_MS, DONE_TITLE, registerMineAfkSettings, AFK_KEYS, type TabEnv,
} from '../src/rooms/mine/afk';
import { SFX } from '../src/audio/defs';
import { BANK_KEYS } from '../src/audio/bank';
import enter from './fixtures/mine-enter.json';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const ME = 'player43';   // listed among the diggers of stone 11 in the fixture

function digging(): { M: MineModel; st: any; now: number } {
  const M = new MineModel(ME), st = clone((enter as any).st), me = clone((enter as any).me);
  me.day = 120; me.cap = 600;
  M.take(st, me, null, st.at);
  return { M, st, now: st.at };
}
/** Next view where the own stone 11 is dug out. */
function finish(M: MineModel, st: any) {
  const s2 = clone(st); s2.v = st.v + 1; s2.dug = s2.dug.slice(0, 11) + '1' + s2.dug.slice(12);
  delete s2.bl['11']; delete s2.dg['11'];
  return M.take(s2, null, null, st.at + 1000);
}

describe('mine AFK: status and title', () => {
  it('formats the ETA', () => {
    expect(fmtEta(10)).toBe('почти');
    expect(fmtEta(11 * 60 + 5)).toBe('12 мин');
    expect(fmtEta(65 * 60)).toBe('1 ч 05 мин');
  });
  it('l3d:mine-status detail has exactly the contract fields', () => {
    const { M, now } = digging();
    expect(M.myI).toBe(11);
    const d = mineStatus('home', M, now, true);
    expect(Object.keys(d).sort()).toEqual(['at', 'c', 'cap', 'day', 'eta', 'i', 'inMine', 'n'].sort());
    expect(d).toMatchObject({ c: 'home', n: 25, i: 11, at: now, day: 120, cap: 600, inMine: true });
    // bl[11] = [152.1 left, 255, 14.56/min] → ≈ 627 s
    expect(d.eta).toBe(Math.round(152.1 / 14.56 * 60));
    expect(mineStatus('home', M, now + 60_000, false).eta).toBe(Math.round((152.1 - 14.56) / 14.56 * 60));
    const r = finish(M, (M as any).st);
    expect(r.bursts.find((b) => b.i === 11)?.mine).toBe(true);
    const d2 = mineStatus('home', M, now, false);
    expect(d2.i).toBe(-1); expect(d2.eta).toBeNull(); expect(d2.inMine).toBe(false);
  });
  it('title: ETA while digging, «✅» after the own burst, null (site title) otherwise', () => {
    const { M, st, now } = digging();
    expect(titleFor(M, now, false)).toBe('⛏ 11 мин · этаж 25');
    finish(M, st);
    expect(titleFor(M, now, false)).toBeNull();
    expect(titleFor(M, now, true)).toBe(DONE_TITLE);
  });
});

function fakeTab(over: Partial<TabEnv> = {}) {
  const s = { title: 'Легион — игра', icon: null as string | null, notes: [] as string[], hidden: false, focused: true, draws: 0 };
  const env: TabEnv = {
    getTitle: () => s.title, setTitle: (t) => { s.title = t; }, setIcon: (u) => { s.icon = u; },
    drawIcon: (p) => { s.draws++; return 'data:' + p; }, notify: (t, b) => { s.notes.push(t + ' | ' + b); },
    hidden: () => s.hidden, focused: () => s.focused, ...over,
  };
  return { s, env };
}

describe('mine AFK: tab signals (#27)', () => {
  it('shows the ETA, the tick after the burst, restores the original title and icon on dispose', () => {
    const { M, st, now } = digging(); const { s, env } = fakeTab();
    const tab = new TabSignals(env);
    tab.update(M, now, true);
    expect(s.title).toBe('⛏ 11 мин · этаж 25'); expect(s.icon).toMatch(/^data:0\.4/);
    finish(M, st); tab.finished('+2 железо', true); tab.update(M, now + 1000, true);
    expect(s.title).toBe('✅ Камень выкопан'); expect(s.icon).toBe('data:done');
    expect(s.notes).toEqual([]);   // focused, visible tab: no system notification
    tab.dispose();
    expect(s.title).toBe('Легион — игра'); expect(s.icon).toBeNull();
  });
  it('notifies only when hidden or unfocused; the switch off restores the title; respects a title the site set', () => {
    const { M, now } = digging(); const { s, env } = fakeTab();
    const tab = new TabSignals(env);
    tab.update(M, now, true);
    s.hidden = true; tab.finished('Камень разбит', true); expect(s.notes.length).toBe(1);
    tab.finished('x', false); expect(s.notes.length).toBe(1);
    s.title = 'Легион (2)';   // the site changed its title meanwhile
    tab.update(M, now, true); expect(s.title).toMatch(/^⛏/);
    tab.update(M, now, false); expect(s.title).toBe('Легион (2)'); expect(s.icon).toBeNull();
  });
  it('redraws the favicon at most every 30 s while digging', () => {
    const { M, now } = digging(); const { s, env } = fakeTab();
    const tab = new TabSignals(env);
    for (let k = 0; k < 20; k++) tab.update(M, now + k * 1000, true);
    expect(s.draws).toBe(1);
    tab.update(M, now + 31_000, true); expect(s.draws).toBe(2);
  });
});

describe('mine AFK: chimes (#25)', () => {
  it('ore / rock → double chime, rare vein or gem → shimmer, chest → coins', () => {
    const { M } = digging();
    const F = M.F!;
    const rare = F.cells.find((c) => c.t === 'rare')!;
    expect(alertOf({ i: 11, mine: true, got: { r: 'iron', q: 200, any: 3, loot: null } }, M)).toBe('mine.done');
    expect(alertOf({ i: rare.i, mine: true, got: null }, M)).toBe('mine.rare');
    expect(alertOf({ i: 11, mine: true, got: { r: 'iron', q: 0, any: 1, loot: { coins: 5 } } }, M)).toBe('mine.chest');
    const gemCell = { ...F.cells[7], r: 'topaz', t: 'ore' }; F.cells[7] = gemCell;
    expect(alertOf({ i: 7, mine: true, got: null }, M)).toBe('mine.rare');
    for (const id of ['mine.done', 'mine.rare', 'mine.chest', 'mine.cap'] as const) {
      const ev = chimeEvents(id);
      expect(ev.every((e) => e.bg === true)).toBe(true);
    }
    expect(chimeEvents('mine.done').length).toBe(2);
  });
  it('uses only recordings already in the bank, on the ui bus (master volume applies)', () => {
    const keys = new Set(BANK_KEYS as readonly string[]);
    for (const id of ['mine.done', 'mine.rare', 'mine.chest', 'mine.cap'] as const) {
      const d = SFX[id];
      expect(d.bus).toBe('ui');
      for (const f of d.files) expect(keys.has(f)).toBe(true);
    }
  });
  it('a hidden tab wakes for the signal only when «Сигнал шахты в фоне» is on; classic site stays silent', () => {
    expect(bgAlertMode({ classic: false, hidden: false, background: false, signal: false })).toBe('play');
    expect(bgAlertMode({ classic: false, hidden: true, background: true, signal: false })).toBe('play');
    expect(bgAlertMode({ classic: false, hidden: true, background: false, signal: true })).toBe('wake');
    expect(bgAlertMode({ classic: false, hidden: true, background: false, signal: false })).toBe('skip');
    expect(bgAlertMode({ classic: true, hidden: false, background: true, signal: true })).toBe('skip');
  });
});

describe('mine AFK: walk-away protection (#5)', () => {
  it('reach ring radius matches the walk-away rule (REACH + 30 px)', () => {
    expect(REACH_LIMIT).toBe(230);
    expect(RING_R).toBeCloseTo(230 * 2.4 / 128);
    expect(reachK(0)).toBe(0); expect(reachK(115)).toBeCloseTo(0.5); expect(reachK(999)).toBe(1);
  });
  it('first step after > 2 min idle only warns; a second press walks', () => {
    const g = new StepGuard(0);
    expect(g.keyDown('KeyW', false, IDLE_MS - 1, true)).toBe('pass');   // not idle long enough
    g.keyUp('KeyW', IDLE_MS);
    const t = IDLE_MS * 3;
    expect(g.keyDown('KeyW', false, t, false)).toBe('pass');            // not digging: never guarded
    g.keyUp('KeyW', t);
    const t2 = t + IDLE_MS + 1;
    expect(g.keyDown('KeyW', false, t2, true)).toBe('warn');
    expect(g.keyDown('KeyW', true, t2 + 100, true)).toBe('block');      // auto-repeat < 0.4 s
    g.keyUp('KeyW', t2 + 150);
    expect(g.keyDown('KeyW', false, t2 + 600, true)).toBe('pass');      // second press
  });
  it('holding the key > 0.4 s walks; layout-independent codes, other keys reset the idle timer', () => {
    const g = new StepGuard(0);
    const t = IDLE_MS + 10;
    expect(g.keyDown('ArrowUp', false, t, true)).toBe('warn');
    expect(g.keyDown('ArrowUp', true, t + HOLD_MS - 1, true)).toBe('block');
    expect(g.keyDown('ArrowUp', true, t + HOLD_MS, true)).toBe('pass');
    const g2 = new StepGuard(0);
    expect(g2.keyDown('KeyE', false, IDLE_MS + 5, true)).toBe('pass');  // any other key = the player is here
    expect(g2.keyDown('KeyD', false, IDLE_MS + 10, true)).toBe('pass');
    g2.activity(0);
    expect(g2.armed(IDLE_MS + 1, true)).toBe(true);
  });
});

describe('mine AFK: fewer frames without focus', () => {
  it('throttles after 90 s visible-unfocused, one frame per tick, restores at once on focus; hands off when blocked', () => {
    const calls: boolean[] = [];
    const e = { hidden: false, focused: false, blocked: false };
    const th = new RenderThrottle({ pause: (on) => calls.push(on), hidden: () => e.hidden, focused: () => e.focused, blocked: () => e.blocked });
    th.tick(0, true); th.tick(ECO_AFTER_MS - 1, true);
    expect(th.on).toBe(false); expect(calls).toEqual([]);
    th.tick(ECO_AFTER_MS, true);
    expect(th.on).toBe(true); expect(calls).toEqual([false]);
    th.frame(); expect(calls).toEqual([false, true]);
    e.focused = true; th.tick(ECO_AFTER_MS + 250, true);
    expect(th.on).toBe(false); expect(calls.at(-1)).toBe(false);
    // the switch off: never throttles
    e.focused = false; calls.length = 0;
    th.tick(0, false); th.tick(ECO_AFTER_MS * 2, false); expect(calls).toEqual([]);
    // somebody else paused (classic site / overlay): never unpause from under them
    th.tick(0, true); e.blocked = true; th.tick(ECO_AFTER_MS + 1, true); th.frame(); th.wake();
    expect(calls).toEqual([]);
  });
});

describe('mine AFK: settings and no requests', () => {
  const G = globalThis as any;
  afterEach(() => { delete G.window; delete G.Notification; });
  it('turning notifications on asks the page permission once (from the settings click)', () => {
    G.window = new EventTarget();
    const req = vi.fn(() => Promise.resolve('granted'));
    G.Notification = { permission: 'default', requestPermission: req };
    const off = registerMineAfkSettings();
    G.window.dispatchEvent(new CustomEvent('l3d:settings', { detail: { key: AFK_KEYS.notify, value: 'off' } }));
    expect(req).not.toHaveBeenCalled();
    G.window.dispatchEvent(new CustomEvent('l3d:settings', { detail: { key: AFK_KEYS.notify, value: 'on' } }));
    expect(req).toHaveBeenCalledTimes(1);
    off();
    G.window.dispatchEvent(new CustomEvent('l3d:settings', { detail: { key: AFK_KEYS.notify, value: 'on' } }));
    expect(req).toHaveBeenCalledTimes(1);
  });
  it('the AFK module never talks to the game or the network', () => {
    const fetchSpy = vi.fn(); G.fetch0 = G.fetch; G.fetch = fetchSpy;
    try {
      const { M, st, now } = digging(); const { env } = fakeTab();
      const tab = new TabSignals(env); const g = new StepGuard(0);
      const th = new RenderThrottle({ pause: () => {}, hidden: () => false, focused: () => false, blocked: () => false });
      for (let k = 0; k < 50; k++) { tab.update(M, now + k * 5000, true); g.keyDown('KeyW', false, k * 1e5, true); th.tick(k * 5000, true); mineStatus('home', M, now, true); }
      const r = finish(M, st);
      for (const b of r.bursts) { alertOf(b, M); tab.finished('x', true); }
      tab.dispose(); th.dispose();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { G.fetch = G.fetch0; delete G.fetch0; }
    const src = readFileSync(new URL('../src/rooms/mine/afk.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|from '\.\/net'|\/api\//);
  });
});
