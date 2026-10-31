/**
 * Pointer lock + chat focus state machine (src/engine/input.ts, src/ui/chatfocus.ts, src/ui/chatone.ts dockCityUnder):
 *  - `locked` is the browser's truth (a late pointerlockchange never leaves a stale «locked» that makes a click skip lock());
 *  - a click on the 3D view (lock()) blurs a focused text field and focuses the canvas, and so does an acquired lock;
 *  - a refused lock (Chrome's ~1 s re-lock cooldown) is retried once after the cooldown, unless cancelled;
 *  - only the player puts the focus into the chat while the game owns the input;
 *  - the site's City re-docking the single chat window while our mine holds it never switches the tab or focuses the field.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

const listeners = new Map<string, Set<(e: any) => void>>();
const on = (k: string, f: (e: any) => void) => { if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k)!.add(f); };
const off = (k: string, f: (e: any) => void) => { listeners.get(k)?.delete(f); };
const fire = (k: string, e: any = {}) => { for (const f of [...(listeners.get(k) ?? [])]) f(e); };
let D: any;

beforeAll(() => {
  (globalThis as any).Element = class {};
  (globalThis as any).window = Object.assign(globalThis as any, { addEventListener: (k: string, f: any) => on('w:' + k, f), removeEventListener: (k: string, f: any) => off('w:' + k, f) });
  D = (globalThis as any).document = {
    addEventListener: (k: string, f: any) => on('d:' + k, f), removeEventListener: (k: string, f: any) => off('d:' + k, f),
    pointerLockElement: null, exitPointerLock: vi.fn(() => { /* the change event comes later, as in Chrome */ }), activeElement: null, body: {},
  };
});

/** A canvas: requestPointerLock answers with `answer` (resolve = the browser locks it after a task, reject = refused). */
function mkCanvas(answer: () => 'ok' | 'refuse' = () => 'ok') {
  const t: any = {
    tagName: 'CANVAS', addEventListener() {}, removeEventListener() {}, hasAttribute: () => true,
    focus: vi.fn(() => { D.activeElement = t; }),
    requestPointerLock: vi.fn(() => {
      if (answer() === 'refuse') return Promise.reject(new Error('cooldown'));
      setTimeout(() => { D.pointerLockElement = t; fire('d:pointerlockchange'); }, 5);
      return Promise.resolve();
    }),
  };
  return t;
}
const field = () => { const f: any = { tagName: 'INPUT', type: 'text', blur: vi.fn(() => { if (D.activeElement === f) D.activeElement = D.body; }) }; return f; };

describe('input: pointer lock state machine', () => {
  beforeEach(() => { vi.useFakeTimers(); D.pointerLockElement = null; D.activeElement = D.body; listeners.clear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('locked follows document.pointerLockElement even before pointerlockchange arrives (no stale flag)', async () => {
    const { createInput } = await import('../src/engine/input');
    const c = mkCanvas(); const inp = createInput(c);
    D.pointerLockElement = c; fire('d:pointerlockchange');
    expect(inp.locked).toBe(true);
    // T: the chat exits the lock — the browser already says «not locked», the event is still in flight
    D.pointerLockElement = null;
    expect(inp.locked).toBe(false);
    // so a click right after T requests the lock again instead of being skipped
    vi.setSystemTime(Date.now() + 1000); vi.advanceTimersByTime(300);
    inp.lock();
    expect(c.requestPointerLock).toHaveBeenCalledTimes(1);
    inp.dispose();
  });

  it('a click on the 3D view (lock) gives the keyboard back to the game: the chat field is blurred, the canvas focused', async () => {
    const { createInput } = await import('../src/engine/input');
    const c = mkCanvas(); const inp = createInput(c);
    const f = field(); D.activeElement = f;
    vi.advanceTimersByTime(300);
    inp.lock();
    expect(f.blur).toHaveBeenCalled();
    expect(c.focus).toHaveBeenCalled();
    expect(D.activeElement).toBe(c);
    await vi.advanceTimersByTimeAsync(10);
    expect(inp.locked).toBe(true);
    inp.dispose();
  });

  it('an acquired lock never leaves a text field focused (a site window would hand the focus back into it later)', async () => {
    const { createInput } = await import('../src/engine/input');
    const c = mkCanvas(); const inp = createInput(c);
    const f = field(); D.activeElement = f;
    D.pointerLockElement = c; fire('d:pointerlockchange');
    expect(f.blur).toHaveBeenCalled();
    expect(D.activeElement).toBe(c);
    inp.dispose();
  });

  it('a refused lock (Chrome cooldown after leaving the lock) is retried once after the cooldown', async () => {
    const { createInput, LOCK_COOLDOWN_MS } = await import('../src/engine/input');
    let n = 0;
    const c = mkCanvas(() => (n++ < 2 ? 'refuse' : 'ok'));   // the raw-input request and its plain fallback are refused
    const inp = createInput(c);
    D.pointerLockElement = c; fire('d:pointerlockchange');
    D.pointerLockElement = null; fire('d:pointerlockchange');   // the player left the lock (Esc)
    vi.advanceTimersByTime(300);
    inp.lock();
    await vi.advanceTimersByTimeAsync(0);
    expect(c.requestPointerLock).toHaveBeenCalledTimes(2);
    expect(inp.locked).toBe(false);
    await vi.advanceTimersByTimeAsync(LOCK_COOLDOWN_MS + 50);
    expect(c.requestPointerLock).toHaveBeenCalledTimes(3);
    expect(inp.locked).toBe(true);
    inp.dispose();
  });

  it('the retry is cancelled by unlock (chat opened), a modal or gameplay off', async () => {
    const { createInput, LOCK_COOLDOWN_MS } = await import('../src/engine/input');
    for (const cancel of ['unlock', 'modal', 'gameplay'] as const) {
      listeners.clear();
      const c = mkCanvas(() => 'refuse'); const inp = createInput(c);
      D.pointerLockElement = c; fire('d:pointerlockchange'); D.pointerLockElement = null; fire('d:pointerlockchange');
      vi.advanceTimersByTime(300);
      inp.lock(); await vi.advanceTimersByTimeAsync(0);
      const k = c.requestPointerLock.mock.calls.length;
      if (cancel === 'unlock') inp.unlock(); else if (cancel === 'modal') inp.pushModal('card'); else inp.setGameplay(false);
      await vi.advanceTimersByTimeAsync(LOCK_COOLDOWN_MS + 100);
      expect(c.requestPointerLock.mock.calls.length, cancel).toBe(k);
      inp.dispose();
    }
  });

  it('mouse look works only while really locked: a lost pointerlockchange is resynced on the next move', async () => {
    const { createInput } = await import('../src/engine/input');
    const c = mkCanvas(); const inp = createInput(c);
    D.pointerLockElement = c;   // locked, but the change event was lost
    fire('d:mousemove', { movementX: 5, movementY: 0 }); fire('d:mousemove', { movementX: 5, movementY: 0 }); // dropped (Chrome's first jump)
    fire('d:mousemove', { movementX: 7, movementY: 2 });
    expect(inp.consumeLook()).toEqual({ dx: 7, dy: 2 });
    D.pointerLockElement = null;   // unlocked behind our back
    fire('d:mousemove', { movementX: 9, movementY: 9 });
    expect(inp.consumeLook()).toEqual({ dx: 0, dy: 0 });
    expect(inp.locked).toBe(false);
    inp.dispose();
  });
});

describe('chat focus guard (src/ui/chatfocus.ts)', () => {
  it('keeps a focus the player asked for, undoes one that came by itself while the game owns the input', async () => {
    const { ChatFocusGuard, gameOwnsInput, INTENT_MS } = await import('../src/ui/chatfocus');
    let t = 1000; const g = new ChatFocusGuard(() => t);
    expect(g.allow(true)).toBe(false);          // the site focused its field under the locked game
    expect(g.allow(false)).toBe(true);          // a menu is open / the game does not own the input
    g.intent();                                 // T / Enter / a click on the chat
    t += 100; expect(g.allow(true)).toBe(true);
    t += INTENT_MS; expect(g.allow(true)).toBe(false);   // a site window giving the focus back much later
    expect(gameOwnsInput({ gameplay: false }, false, { pointerLockElement: {} as Element })).toBe(true);
    expect(gameOwnsInput({ gameplay: true }, false, { pointerLockElement: null })).toBe(true);
    expect(gameOwnsInput({ gameplay: true }, true, { pointerLockElement: null })).toBe(false);
    expect(gameOwnsInput({ gameplay: false }, false, { pointerLockElement: null })).toBe(false);
  });
});

/**
 * A stand-in of the site's LGChatOne dock / place (site-chatone.js 30.10, re-written from its behaviour): place() keeps the
 * window at the LAST docked scene whose root is shown, and when that scene changes switches «Город» ⇄ «Шахта» (the switch
 * focuses the field). Counts tab switches and focus calls.
 */
function fakeChatOne() {
  const S = { docks: new Map<string, any>(), place: '', tab: 'g', switches: [] as string[], focus: 0, at: null as any };
  const shown = (x: any) => x.isConnected && x.style.getPropertyValue('display') !== 'none';
  const api: any = {
    on: () => true,
    dock(k: string, root: any) { S.docks.delete(k); if (root) S.docks.set(k, root); api.place(); },
    place() {
      let k0 = ''; S.at = null;
      for (const [k, x] of [...S.docks].reverse()) if (shown(x)) { k0 = k; S.at = x; break; }
      const want = k0 === 'mine' ? 'mn' : k0 === 'city' ? 'g' : '';
      if (want && want !== S.place && (S.tab === 'g' || S.tab === 'mn') && S.tab !== want) { S.tab = want; S.switches.push(want); S.focus++; }
      S.place = want;
    },
  };
  return { api, S };
}
const mkEl = () => { const st = new Map<string, [string, string]>(); return { isConnected: true, className: '', dataset: {} as Record<string, string>, remove: vi.fn(),
  style: { getPropertyValue: (k: string) => st.get(k)?.[0] ?? '', getPropertyPriority: (k: string) => st.get(k)?.[1] ?? '', setProperty: (k: string, v: string, p = '') => { st.set(k, [v, p]); }, removeProperty: (k: string) => { st.delete(k); } } }; };

describe('single chat window in the 3D mine: one owner of the tab (src/ui/chatone.ts)', () => {
  it('the City re-docking after every «me» (heroChanged → chatInit) and the site\'s place() calls never switch the tab or focus the field', async () => {
    const { OneMine } = await import('../src/ui/chatone');
    const { api, S } = fakeChatOne();
    const city = mkEl(); api.dock('city', city);   // the City under our 3D has the window
    expect(S.tab).toBe('g');
    const host = mkEl();
    const doc = { createElement: () => host, body: { appendChild() {} }, activeElement: null, querySelector: () => null } as unknown as Document;
    const om = new OneMine(api, { lines: () => [] }, doc, () => {});
    om.start();                                    // a real scene change: «Шахта»
    expect(S.tab).toBe('mn'); expect(S.at).toBe(host);
    const sw0 = S.switches.length, f0 = S.focus;
    // two minutes: «me» every 3 s re-docks the City (a re-entered City even brings a new root), SSE / tab changes call place()
    let root = city;
    for (let s = 0; s < 120; s++) {
      if (s % 3 === 0) api.dock('city', root);
      if (s % 40 === 39) root = mkEl(), api.dock('city', root);
      if (s % 7 === 0) api.place();
      om.tick();
    }
    expect(S.switches.length - sw0).toBe(0);
    expect(S.focus - f0).toBe(0);
    expect(S.tab).toBe('mn'); expect(S.at).toBe(host);
    expect(root.style.getPropertyValue('display')).toBe('');   // the City's root is left as it was
    // the player picks «Город» by hand: it stays through more re-docks
    S.tab = 'g';
    for (let s = 0; s < 20; s++) { api.dock('city', root); api.place(); }
    expect(S.tab).toBe('g');
    // leaving the mine is a real scene change: the window goes back to the City
    S.tab = 'mn';
    om.stop();
    expect(S.at).toBe(root); expect(S.tab).toBe('g');
    // and the site's dock is its own again
    api.dock('city', root); expect(S.at).toBe(root);
  });
});

describe('input: derived gameplay, late grants, focus safety net, key owner', () => {
  beforeEach(() => { vi.useFakeTimers(); D.pointerLockElement = null; D.activeElement = D.body; D.exitPointerLock.mockClear(); listeners.clear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('gameplay is derived: a chat hold or an accepted text focus keeps it off whatever setGameplay(true) says', async () => {
    const { createInput } = await import('../src/engine/input');
    const c = mkCanvas(); const inp = createInput(c);
    inp.hold('chat', true);
    inp.setGameplay(true);                      // the overlay poll / classic resume «gives gameplay back»
    expect(inp.gameplay).toBe(false);
    inp.hold('chat', false); expect(inp.gameplay).toBe(true);
    // a text field the player asked for (T → allowFocus) has the keyboard: off; the focus leaves: on again
    const f = field(); inp.allowFocus(); D.activeElement = f; fire('d:focusin');
    expect(D.activeElement).toBe(f);
    expect(inp.gameplay).toBe(false);
    inp.setGameplay(true); expect(inp.gameplay).toBe(false);
    D.activeElement = D.body; fire('d:focusout'); vi.advanceTimersByTime(1);
    expect(inp.gameplay).toBe(true);
    inp.dispose();
  });

  it('a site field focused by itself while the game owns the input is undone (keyboard back on the 3D view)', async () => {
    const { createInput } = await import('../src/engine/input');
    const c = mkCanvas(); const inp = createInput(c);
    vi.advanceTimersByTime(2000);
    const f = field(); D.activeElement = f; fire('d:focusin');   // e.g. a site window's from.focus() on close
    expect(f.blur).toHaveBeenCalled();
    expect(D.activeElement).toBe(c);
    expect(inp.gameplay).toBe(true);
    inp.dispose();
  });

  it('a grant of our request that arrives after a modal opened (or a field took the keyboard) is refused', async () => {
    const { createInput } = await import('../src/engine/input');
    const c = mkCanvas(); const inp = createInput(c);
    vi.advanceTimersByTime(300);
    inp.lock();                                  // the click …
    inp.pushModal('late-grant');                 // … and a card opens before Chrome grants the lock
    await vi.advanceTimersByTimeAsync(10);       // the grant arrives
    expect(D.exitPointerLock).toHaveBeenCalled();
    expect(inp.locked).toBe(false);
    inp.popModal('late-grant');
    D.pointerLockElement = null;
    vi.advanceTimersByTime(300);
    const t1 = performance.now() + 1000, now = vi.spyOn(performance, 'now').mockReturnValue(t1);   // a later click (past the double-click throttle)
    inp.lock(); await vi.advanceTimersByTimeAsync(10);   // a plain click still locks
    now.mockRestore();
    expect(inp.locked).toBe(true);
    inp.dispose();
  });

  it('key owner: our view / body / our UI are the game\'s, the site\'s chat, windows and fields are the site\'s', async () => {
    const { keyOwner } = await import('../src/engine/input');
    const el = (o: { tag?: string; type?: string; sel?: string[]; id?: string; parent?: any; edit?: boolean }) => ({
      tagName: o.tag || 'DIV', type: o.type, id: o.id || '', isContentEditable: !!o.edit, parentElement: o.parent || null,
      closest: (q: string) => (o.sel && o.sel.some((s) => q.includes(s)) ? {} : null), getRootNode: () => ({}),
    }) as unknown as Element;
    const canvas = el({ tag: 'CANVAS' });
    expect(keyOwner(null, canvas)).toBe('game');
    expect(keyOwner(canvas, canvas)).toBe('game');
    expect(keyOwner(D.body, canvas)).toBe('game');
    const uiHost = el({ id: 'l3d-ui' });
    expect(keyOwner(el({ tag: 'INPUT', type: 'text', parent: uiHost }), canvas)).toBe('game');   // typing in our menu
    expect(keyOwner(el({ tag: 'BUTTON', sel: ['.cy-chat'] }), canvas)).toBe('site');            // the docked site chat
    expect(keyOwner(el({ tag: 'INPUT', type: 'text' }), canvas)).toBe('site');                    // a site field
    expect(keyOwner(el({ tag: 'BUTTON', sel: ['[role="dialog"]'] }), canvas)).toBe('site');      // a site window we show
    expect(keyOwner(el({ tag: 'BUTTON' }), canvas)).toBe('game');                                 // a stray site button under the 3D
  });
});

describe('held keys and IME composition', () => {
  beforeEach(() => { listeners.clear(); D.activeElement = D.body; });
  it('a held toggle acts once: repeats of I / B / Tab / F10 / Esc are swallowed, menu navigation may repeat', async () => {
    const { heldKey, TOGGLE_KEYS } = await import('../src/ui/repeat');
    for (const k of ['Escape', 'Tab', 'F10', 'F9', 'F2', 'KeyH', 'KeyQ', 'KeyE']) { expect(TOGGLE_KEYS.has(k)).toBe(true); expect(heldKey(k, false, false)).toBe('act'); expect(heldKey(k, true, false)).toBe('swallow'); }
    // tab keys of the registry (I = bag, B, C, P, M …) are toggles too
    expect(heldKey('KeyI', true, true)).toBe('swallow'); expect(heldKey('KeyI', false, true)).toBe('act');
    expect(heldKey('ArrowDown', true, false)).toBe('act'); expect(heldKey('PageDown', true, false)).toBe('act');
  });
  it('the input dispatches a key once per press (no repeats) in gameplay and to menus', async () => {
    const { createInput } = await import('../src/engine/input');
    const inp = createInput(mkCanvas());
    const seen: string[] = []; inp.onKey((c) => { seen.push(c); return false; });
    const ev = (code: string, repeat: boolean) => ({ code, key: code, target: null, repeat, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {}, stopPropagation() {} });
    fire('w:keydown', ev('KeyI', false)); fire('w:keydown', ev('KeyI', true)); fire('w:keydown', ev('KeyI', true));
    inp.setGameplay(false);
    fire('w:keydown', ev('Escape', false)); fire('w:keydown', ev('Escape', true));
    expect(seen).toEqual(['KeyI', 'Escape']);
    inp.dispose();
  });
  it('Esc during an IME composition in a field only cancels the composition: the game never gets it', async () => {
    const { createInput } = await import('../src/engine/input');
    const { composing } = await import('../src/ui/chat');
    const inp = createInput(mkCanvas());
    const seen: string[] = []; inp.onKey((c) => { seen.push(c); return false; });
    const f = field();
    const esc = (o: Partial<KeyboardEvent>) => ({ code: 'Escape', key: 'Escape', target: f, repeat: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, keyCode: 27, preventDefault() {}, stopPropagation() {}, ...o });
    (globalThis as any).Element = class {}; Object.setPrototypeOf(f, (globalThis as any).Element.prototype);
    fire('w:keydown', esc({ isComposing: true }));
    fire('w:keydown', esc({ keyCode: 229 }));
    expect(seen).toEqual([]);
    fire('w:keydown', esc({}));
    expect(seen).toEqual(['Escape']);            // a plain Esc in the field still reaches the game (blur / close)
    expect(composing(esc({ isComposing: true }) as unknown as KeyboardEvent)).toBe(true);
    expect(composing(esc({ keyCode: 229 }) as unknown as KeyboardEvent)).toBe(true);
    expect(composing(esc({}) as unknown as KeyboardEvent)).toBe(false);
    inp.dispose();
  });
});
