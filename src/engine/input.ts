/**
 * Keyboard + mouse input with pointer-lock mouse look.
 *
 * Gating rules (docs/GAME-DESIGN.md §3.3):
 *  - while an <input>/<textarea>/<select>/contenteditable is focused no game key fires and movement reads zero;
 *    onKey still gets 'Escape' (so the integrator can blur) — 'Enter' is left to the field itself;
 *  - setGameplay(false) (menu open, chat): movement/look read zero, onKey only gets 'Escape' / 'Enter' / 'NumpadEnter'
 *    (menus handle their own hotkeys with their own listeners);
 *  - Ctrl/Meta/Alt chords are never treated as game keys (browser shortcuts stay intact).
 * Held keys are released on window blur, tab hide, focusing a text field and Ctrl/Alt/Meta chords — except a bare
 * Ctrl press while `holdCtrl` is on (mage flight: Ctrl = down), which is held like a game key.
 *
 * Modal stack: every DOM card / window we open over the game (mine cards and journal, the shop buy card…) calls
 * pushModal(id, close) and popModal(id) when it goes. While any modal is open, gameplay reads false whatever
 * setGameplay() says (nobody can switch it back on from under a card), lock() is refused (a click never grabs the
 * pointer), and closeTopModal() — Esc in the integrator — closes the topmost one first.
 *
 * Pointer lock state machine (chat / focus races, 0.6.2):
 *  - `locked` is always the browser's truth (document.pointerLockElement === target): pointerlockchange arrives a
 *    task or more after exitPointerLock / requestPointerLock, and a stale flag made a click right after T skip lock();
 *  - lock() (a real click on the 3D view) first gives the keyboard back to the game: a focused text field (also inside
 *    shadow roots: our chat panel) is blurred and the canvas focused — so no hidden field keeps swallowing keys and no
 *    site window can later «restore» focus to it; the same happens whenever the lock is acquired;
 *  - Chrome refuses a re-lock for ~1 s after the lock was left: a refused request (promise rejection or
 *    pointerlockerror) is retried once after that cooldown while the user activation of the click is still alive and
 *    nothing (unlock, a modal, a menu) has cancelled the wish meanwhile.
 */
import type { Unsub } from '../contracts';
import type { Input } from '../contracts/modules';

/** Input plus jump (Space), read by the player controller. */
export interface InputEx extends Input {
  /** Space held (gameplay only). */
  readonly jump: boolean;
  /** True once per Space press (pressed within the last 250 ms and not consumed yet). */
  consumeJump(): boolean;
  /** Open a modal (idempotent per id): gameplay off, pointer released and never re-grabbed until every modal is gone. */
  pushModal(id: string, close?: () => void): void;
  /** The modal `id` went away (idempotent). */
  popModal(id: string): void;
  /** Ids of the open modals, bottom → top. */
  readonly modals: readonly string[];
  /** Close the topmost modal through its close callback (Esc). False when none is open or it has no callback. */
  closeTopModal(): boolean;
  /**
   * While true (a mage is flying: Ctrl = down), a bare Ctrl press is a held game key: it does not release WASD.
   * Any other key pressed with Ctrl is still a browser chord (released as usual).
   */
  holdCtrl: boolean;
  /** Ctrl held as a game key (only while holdCtrl, gameplay, not typing). */
  readonly ctrl: boolean;
  /** Give the keyboard to the game: blur a focused text field (also in shadow roots) and focus the 3D view. */
  focusGame(): void;
  /** Our UI is about to focus a text field on the player's request (T / Enter → chat): the focus safety net lets it in. */
  allowFocus(): void;
  /**
   * A UI part owns the keyboard (the chat, the site's DM window): gameplay reads false while any hold is on, whatever
   * setGameplay() says. Idempotent per id.
   */
  hold(id: string, on: boolean): void;
}

const JUMP = 'Space';
const JUMP_STALE_MS = 250;

const FWD = new Set(['KeyW', 'ArrowUp']);
const BACK = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const RUN = new Set(['ShiftLeft', 'ShiftRight']);
/** Keys whose browser default we suppress in gameplay (scrolling, focus moves). */
const PREVENT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'F3']);
const MENU_KEYS = new Set(['Escape', 'Enter', 'NumpadEnter']);
/** The real target of an event (through open shadow roots). */
export function evTarget(e: Event): Element | null {
  const t = (typeof e.composedPath === 'function' ? e.composedPath()[0] : e.target) as Element | null;
  return t && typeof (t as Element).tagName === 'string' ? t : null;
}
/** Our own UI: the 3D host, the UI host (and everything in their shadow roots). */
export function inOwnUi(el: Element | null): boolean {
  for (let x: Element | null = el, i = 0; x && i < 64; i++) {
    const id = (x as HTMLElement).id;
    if (id === 'l3d-ui' || id === 'l3d-host' || id === 'l3d-splash') return true;
    x = x.parentElement || (((x.getRootNode?.() as ShadowRoot | undefined)?.host) ?? null);
  }
  return false;
}
/** Site elements whose keys are the site's: its chat window (docked by us), its windows / room panels shown over the 3D. */
const SITE_KEYS_SEL = '.cy-chat, .co-float, .l3d-co-host, .cy-nm, .cy-room, [role="dialog"], [role="alertdialog"], [role="menu"]';
/**
 * Whose is a key event with this real target while the 3D is shown: 'game' (the 3D view, <body> / <html> / no target,
 * our UI) or 'site' (an element of the site's own: its chat, its windows, a site field the player types in).
 */
export function keyOwner(t: Element | null, canvas: Element | null = null): 'game' | 'site' {
  if (!t || t === canvas) return 'game';
  if (typeof document !== 'undefined' && (t === document.body || t === document.documentElement)) return 'game';
  if (inOwnUi(t)) return 'game';
  if (isTyping(t)) return 'site';
  return t.closest?.(SITE_KEYS_SEL) ? 'site' : 'game';
}

/** Mouse deltas above this (px per event) are browser glitches (Chrome pointer-lock spikes) and are dropped. */
const SPIKE = 300;

/** The focused element, through open shadow roots (our UI lives in one: document.activeElement is only its host). */
export function deepActive(doc: Document | null = typeof document !== 'undefined' ? document : null): Element | null {
  let a: Element | null = doc ? doc.activeElement : null;
  for (let i = 0; a && i < 8; i++) { const sr = (a as HTMLElement).shadowRoot; const n = sr ? sr.activeElement : null; if (!n) break; a = n; }
  return a;
}

/** Chrome refuses requestPointerLock for about this long after the lock was left (ms). */
export const LOCK_COOLDOWN_MS = 1100;

export function isTyping(el: Element | null = typeof document !== 'undefined' ? document.activeElement : null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return type !== 'button' && type !== 'checkbox' && type !== 'radio' && type !== 'range' && type !== 'submit';
  }
  return tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable === true;
}

export function createInput(target: HTMLElement): InputEx {
  const down = new Set<string>();
  const move = { x: 0, y: 0 };
  const look = { dx: 0, dy: 0 };
  const lookOut = { dx: 0, dy: 0 };
  let wheel = 0;
  let gameplay = true;       // effective: base && no modal
  let base = true;           // what setGameplay() asked for (the WISH: overlay / classic / menus)
  const holds = new Set<string>();   // UI parts holding gameplay off while they own the keyboard (chat, DM window)
  let textFocus = false;     // a text field has the keyboard (accepted by the focus safety net)
  const modalList: { id: string; close?: () => void }[] = [];
  const modalIds: string[] = [];
  let locked = false;
  let lastLockReq = -1e9;
  let lastExitAt = -1e9;     // performance.now() when the lock was last left (Chrome's re-lock cooldown)
  let wantLock = false;      // a lock() is pending (cleared by unlock, a modal, gameplay off, success)
  let retryT: ReturnType<typeof setTimeout> | 0 = 0;
  let dropNext = 0;          // drop the first events after lock (Chrome sends a jump)
  let jumpAt = -1;           // performance.now() of the last unconsumed Space press
  let holdCtrl = false;      // a bare Ctrl is a game key (flight: down)
  const keyFns: ((code: string, e: KeyboardEvent) => boolean | void)[] = [];

  function recompute(): void {
    if (!gameplay || isTyping()) { move.x = 0; move.y = 0; return; }
    let x = 0, y = 0;
    for (const c of down) {
      if (FWD.has(c)) y += 1; else if (BACK.has(c)) y -= 1;
      else if (LEFT.has(c)) x -= 1; else if (RIGHT.has(c)) x += 1;
    }
    move.x = x > 1 ? 1 : x < -1 ? -1 : x;
    move.y = y > 1 ? 1 : y < -1 ? -1 : y;
  }

  function releaseAll(): void { down.clear(); move.x = 0; move.y = 0; jumpAt = -1; }
  /**
   * Effective gameplay is DERIVED, never forced: wanted (setGameplay) && no modal && no hold (chat / DM window focused)
   * && no text field focused. So a caller that «gives gameplay back» (the overlay poll, classic resume, a closing menu)
   * while the chat legitimately has the keyboard cannot switch it on from under the chat.
   */
  function sync(): void {
    const eff = base && modalList.length === 0 && holds.size === 0 && !textFocus;
    if (eff === gameplay) return;
    gameplay = eff;
    if (!eff) { releaseAll(); look.dx = 0; look.dy = 0; } else recompute();
  }
  /** A refused grant is being exited (exitPointerLock answers a task later): the lock does not count meanwhile. */
  let exiting = false;
  function rawLocked(): boolean { return typeof document !== 'undefined' && document.pointerLockElement === target && !!target; }
  function realLocked(): boolean { const r = rawLocked(); if (!r) exiting = false; return r && !exiting; }
  function cancelRetry(): void { wantLock = false; if (retryT) { clearTimeout(retryT); retryT = 0; } }
  /** Our request is in flight (requestPointerLock answered later), and whether something cancelled the wish meanwhile. */
  let pending = false, cancelled = false;
  /** The wish for the lock is gone (unlock, a modal, gameplay off): a grant that still arrives is refused. */
  function cancelLock(): void { cancelRetry(); if (pending) cancelled = true; }
  /**
   * A grant of OUR request arrived: refuse it when a modal opened, gameplay went off, the request was cancelled or a text
   * field took the keyboard in the gap between the click and the grant (T, E, a menu key) — the cursor stays visible.
   * Grants of other code (photo mode locks the canvas itself under its modal) are left alone.
   */
  function vetoGrant(): boolean {
    if (!pending) return false;
    pending = false;
    if (!(cancelled || modalList.length > 0 || !base || isTyping(deepActive()))) return false;
    cancelled = false;
    try { if (document.pointerLockElement === target) { exiting = true; document.exitPointerLock(); } } catch { /* */ }
    locked = false; look.dx = 0; look.dy = 0;
    return true;
  }
  function unlockNow(): void {
    cancelLock();
    try { if (document.pointerLockElement === target) { document.exitPointerLock(); lastExitAt = performance.now(); } } catch { /* */ }
    locked = false; look.dx = 0; look.dy = 0;
  }
  /** Blur a focused text field and focus the 3D view (keyboard back to the game). */
  function focusGame(): void {
    try {
      const a = deepActive();
      if (a && a !== target && isTyping(a)) (a as HTMLElement).blur?.();
      const t = target as HTMLElement & { focus?: (o?: FocusOptions) => void };
      if (typeof t.focus === 'function' && deepActive() !== target) {
        if (typeof t.hasAttribute === 'function' && !t.hasAttribute('tabindex')) t.tabIndex = -1;
        t.focus({ preventScroll: true });
      }
    } catch { /* */ }
  }
  const activationAlive = (): boolean => {
    const ua = typeof navigator !== 'undefined' ? (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation : undefined;
    return !ua || ua.isActive;
  };
  /** A refused request: retry once after Chrome's cooldown while the click's activation lasts and the wish stands. */
  function refused(): void {
    if (!wantLock || retryT) return;
    const wait = Math.max(60, lastExitAt + LOCK_COOLDOWN_MS - performance.now());
    if (wait > 2500) { wantLock = false; return; }
    retryT = setTimeout(() => {
      retryT = 0;
      if (!wantLock || realLocked() || modalList.length || !base || !activationAlive()) { wantLock = false; return; }
      wantLock = false;   // one retry only
      request();
    }, wait);
  }
  function request(): void {
    lastLockReq = performance.now();
    pending = true; cancelled = false; exiting = false;
    try {
      const r = (target as HTMLElement & { requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | void })
        .requestPointerLock({ unadjustedMovement: true });
      if (r && typeof (r as Promise<void>).then === 'function') {
        (r as Promise<void>).then(() => { if (realLocked()) { if (!vetoGrant() && !locked) onLockChange(); } }, () => {
          if (realLocked()) return;
          // raw input unsupported (or too early after Esc) → retry plain lock once, then after the cooldown
          try {
            const r2 = target.requestPointerLock() as unknown as Promise<void> | void;
            (r2 as Promise<void> | undefined)?.then?.(() => { if (realLocked() && !vetoGrant() && !locked) onLockChange(); }, () => { pending = false; refused(); });
          } catch { pending = false; refused(); }
        });
      }
    } catch {
      try { target.requestPointerLock(); } catch { pending = false; refused(); }
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    const code = e.code;
    const typing = isTyping(e.target instanceof Element ? e.target : document.activeElement);
    const chord = e.ctrlKey || e.metaKey || e.altKey;
    if (typing) {
      // fields own their keys; only Escape reaches the game (to blur / close) — not during an IME composition, where Esc
      // only cancels the composition
      if (code === 'Escape' && !e.isComposing && e.keyCode !== 229) dispatch(code, e);
      return;
    }
    if (!gameplay) {
      if (MENU_KEYS.has(code) && !e.repeat) dispatch(code, e);
      return;
    }
    if (chord) {
      // a bare Ctrl while flying (Ctrl = down): keep the held movement keys
      if (holdCtrl && (code === 'ControlLeft' || code === 'ControlRight') && !e.metaKey && !e.altKey) { down.add(code); return; }
      releaseAll(); return;
    }
    if (!down.has(code)) { down.add(code); recompute(); }
    if (PREVENT.has(code)) e.preventDefault();
    if (code === JUMP && !e.repeat) jumpAt = performance.now();
    if (!e.repeat) dispatch(code, e);
  }
  function onKeyUp(e: KeyboardEvent): void {
    if (down.delete(e.code)) recompute();
  }
  function dispatch(code: string, e: KeyboardEvent): void {
    // a handled key: no browser default; whether the page's own listeners see it is the shield's call (below) — our
    // other window listeners (flight, emotes, quest) still get it
    for (let i = 0; i < keyFns.length; i++) {
      if (keyFns[i](code, e) === true) { e.preventDefault(); break; }
    }
  }
  // the listeners run at <html> (bubble) so they come BEFORE the page's own document / window listeners; an event that
  // never passes <html> (dispatched at document or window) still reaches them through the window fallback
  let seenDown: Event | null = null, seenUp: Event | null = null;
  function keyDownL(e: KeyboardEvent): void { if (e === seenDown) return; seenDown = e; onKeyDown(e); shield(e, true); }
  function keyUpL(e: KeyboardEvent): void { if (e === seenUp) return; seenUp = e; onKeyUp(e); shield(e, false); }
  /**
   * Site key shield: while the 3D view is shown, a key event whose real target is OURS — the 3D view, <body> / <html>
   * (the game has the keyboard), anything in our UI host (shadow DOM: menus, cards, the fallback chat) — stops at <html>
   * after our own listeners there (this one and every feature's onKeys listener), so the page's document / window
   * listeners never see it. The site's City runs hidden under our canvas and walks its hero with W A S D / opens
   * buildings with E from a document listener (city.js kwDown); its kwBusy cannot see into our shadow root, so an open
   * menu of ours did not stop it either. Only stopPropagation — never preventDefault — so typing in our fields keeps its
   * default action. Events of the site's own elements (its chat window that we dock, a site window or room panel we
   * show, a site field the player types in) pass untouched; the classic site (3D hidden) is never touched.
   * A keyup is stopped when its keydown was, or when it is ours by the same rule (no stuck keys on either side).
   */
  const shielded = new Set<string>();
  function shield(e: KeyboardEvent, isDown: boolean): void {
    const own = shown3d() && keyOwner(evTarget(e), target) === 'game';
    if (isDown) { if (!own) return; shielded.add(e.code); e.stopPropagation(); return; }
    if (shielded.delete(e.code) || own) e.stopPropagation();
  }
  /** The 3D view is on screen (not the classic site, not hidden under a site overlay). */
  function shown3d(): boolean {
    const t = target as HTMLElement & { getClientRects?: () => DOMRectList };
    if (typeof t.getClientRects !== 'function') return true;
    return !!t.isConnected && t.getClientRects().length > 0;
  }
  /* ---- focus safety net: while the game owns the input only the player puts the keyboard into a text field ---- */
  let intentAt = -1e9;
  const FOCUS_INTENT_MS = 800;
  function markIntent(): void { intentAt = performance.now(); }
  /** A click / tap on the page's UI (a field, the chat's tab… — not the 3D view), or Tab navigation: the focus that follows is the player's. */
  function onIntentPtr(e: Event): void {
    const t = evTarget(e);
    if (!t || t === target) return;
    if (typeof document !== 'undefined' && (t === document.body || t === document.documentElement)) return;
    markIntent();
  }
  function onIntentKey(e: KeyboardEvent): void { if (e.key === 'Tab') markIntent(); }
  /** Inside our own UI (its shadow host): our code focuses its fields on purpose (cards, menus, our chat — which has its own guard). */
  const ownUi = inOwnUi;

  function onMouseMove(e: MouseEvent): void {
    if (!resync() || !gameplay) return;
    if (dropNext > 0) { dropNext--; return; }
    const dx = e.movementX, dy = e.movementY;
    if (dx > SPIKE || dx < -SPIKE || dy > SPIKE || dy < -SPIKE) return;
    look.dx += dx; look.dy += dy;
  }
  function onWheel(e: WheelEvent): void {
    if (!gameplay && !locked) {
      // menus: wheel over the 3D area still zooms the orbit camera only when it is aimed at the canvas
      if (e.target !== target) return;
    }
    if (isTyping()) return;
    // normalise lines/pages to "notches" of ~100 px
    const k = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 600 : 1;
    wheel += (e.deltaY * k) / 100;
    if (e.target === target) e.preventDefault();
  }
  function onLockChange(): void {
    const was = locked;
    locked = realLocked();
    if (locked && !was && vetoGrant()) return;   // a late grant nobody wants any more
    if (locked) {
      cancelRetry();
      if (!was) dropNext = 2;
      // the game owns the mouse now: no text field may keep the keyboard (it would swallow keys, and a site window
      // closing later would «restore» focus into it)
      focusGame();
    } else { if (was) lastExitAt = performance.now(); look.dx = 0; look.dy = 0; }
  }
  function onLockError(): void { locked = realLocked(); refused(); }
  /** Safety net: the flag and the browser disagree (a late or lost pointerlockchange) → resync. */
  function resync(): boolean { if (locked !== realLocked()) onLockChange(); return locked; }
  function onBlur(): void { releaseAll(); look.dx = 0; look.dy = 0; }
  /** Re-derive «a text field has the keyboard» (focusin / focusout; the focusout's new focus is known a task later). */
  function syncTextFocus(): void {
    const t = isTyping(deepActive());
    if (t !== textFocus) { textFocus = t; sync(); }
  }
  let tfT: ReturnType<typeof setTimeout> | 0 = 0;
  function onFocusOut(): void { if (!tfT) tfT = setTimeout(() => { tfT = 0; syncTextFocus(); }, 0); }
  function onFocusIn(): void {
    guardFocus();
    syncTextFocus();
  }
  function guardFocus(): void {
    const a = deepActive();
    if (!isTyping(a)) return;
    releaseAll();
    // a field focused by the page itself while the game owns the input (a site window giving the focus back on close,
    // a tab switch of the site's chat): the keyboard would go into a hidden field under a locked pointer — undo it
    const owns = realLocked() || gameplay;
    if (!owns || performance.now() - intentAt <= FOCUS_INTENT_MS || ownUi(a)) return;
    // a field inside a window the page shows right now (a site room panel or dialog over the 3D) is that window's own
    if ((a as HTMLElement).closest?.('[role="dialog"], [role="alertdialog"], .cy-room')) return;
    focusGame();
  }
  function onVis(): void { if (document.hidden) onBlur(); }

  const html = typeof document !== 'undefined' ? document.documentElement as HTMLElement | null : null;
  if (html && typeof html.addEventListener === 'function') { html.addEventListener('keydown', keyDownL); html.addEventListener('keyup', keyUpL); }
  window.addEventListener('keydown', keyDownL);
  window.addEventListener('keyup', keyUpL);
  window.addEventListener('pointerdown', onIntentPtr, true);
  window.addEventListener('keydown', onIntentKey, true);
  document.addEventListener('mousemove', onMouseMove);
  target.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('pointerlockerror', onLockError);
  window.addEventListener('blur', onBlur);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  document.addEventListener('visibilitychange', onVis);

  return {
    move,
    get run() { return gameplay && (down.has('ShiftLeft') || down.has('ShiftRight')) && !isTyping(); },
    get jump() { return gameplay && down.has(JUMP) && !isTyping(); },
    get holdCtrl() { return holdCtrl; },
    set holdCtrl(v: boolean) { holdCtrl = v; if (!v) { down.delete('ControlLeft'); down.delete('ControlRight'); } },
    get ctrl() { return holdCtrl && gameplay && (down.has('ControlLeft') || down.has('ControlRight')) && !isTyping(); },
    consumeJump() {
      if (jumpAt < 0) return false;
      const fresh = gameplay && performance.now() - jumpAt <= JUMP_STALE_MS;
      jumpAt = -1;
      return fresh;
    },
    consumeLook() {
      lookOut.dx = look.dx; lookOut.dy = look.dy;
      look.dx = 0; look.dy = 0;
      return lookOut;   // reused object: copy if you keep it
    },
    consumeWheel() { const w = wheel; wheel = 0; return w; },
    onKey(fn): Unsub {
      keyFns.push(fn);
      return () => { const i = keyFns.indexOf(fn); if (i >= 0) keyFns.splice(i, 1); };
    },
    lock() {
      if (resync() || modalList.length) return;
      // the player clicked the 3D view: the keyboard goes back to the game at once (a chat field must not stay focused)
      focusGame();
      wantLock = true;
      const now = performance.now();
      if (now - lastLockReq < 250) return;   // double click / two listeners of one click
      // try at once (a lock we released ourselves has no cooldown); a refusal is retried after Chrome's cooldown
      request();
    },
    unlock() { unlockNow(); },
    get locked() { return resync(); },
    focusGame,
    allowFocus: markIntent,
    setGameplay(on) { base = on; if (!on) cancelLock(); sync(); },
    get gameplay() { return gameplay; },
    pushModal(id, close) {
      const i = modalIds.indexOf(id);
      if (i >= 0) { modalList[i].close = close ?? modalList[i].close; return; }
      modalList.push({ id, close }); modalIds.push(id);
      unlockNow(); sync();   // unlockNow also cancels a pending re-lock
    },
    popModal(id) {
      const i = modalIds.indexOf(id);
      if (i < 0) return;
      modalList.splice(i, 1); modalIds.splice(i, 1);
      sync();
    },
    get modals() { return modalIds; },
    hold(id, on) {
      if (on === holds.has(id)) return;
      if (on) { holds.add(id); cancelLock(); } else holds.delete(id);
      sync();
    },
    closeTopModal() {
      for (let i = modalList.length - 1; i >= 0; i--) {
        const m = modalList[i];
        if (!m.close) continue;
        try { m.close(); } catch (e) { console.error('[l3d] modal close', m.id, e); }
        // a close callback that forgot to pop: pop it here so Esc never gets stuck
        const k = modalIds.indexOf(m.id); if (k >= 0) { modalList.splice(k, 1); modalIds.splice(k, 1); sync(); }
        return true;
      }
      return false;
    },
    dispose() {
      if (html && typeof html.removeEventListener === 'function') { html.removeEventListener('keydown', keyDownL); html.removeEventListener('keyup', keyUpL); }
      window.removeEventListener('keydown', keyDownL);
      window.removeEventListener('keyup', keyUpL);
      window.removeEventListener('pointerdown', onIntentPtr, true);
      window.removeEventListener('keydown', onIntentKey, true);
      document.removeEventListener('mousemove', onMouseMove);
      target.removeEventListener('wheel', onWheel);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('pointerlockerror', onLockError);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      if (tfT) clearTimeout(tfT);
      document.removeEventListener('visibilitychange', onVis);
      keyFns.length = 0;
      cancelRetry();
      if (document.pointerLockElement === target) document.exitPointerLock();
    },
  };
}

/**
 * Listen to page keys where our own listeners must sit: at <html> (bubble) — after the target and every capture
 * listener, before the page's own document / window listeners, so the input's site key shield (it stops our events at
 * <html>) never hides a key from us. An event dispatched at document / window itself still arrives (window fallback,
 * each event once). Use this instead of window.addEventListener('keydown' | 'keyup', fn) for bubble-phase listeners.
 */
export function onPageKeys(type: 'keydown' | 'keyup', fn: (e: KeyboardEvent) => void): () => void {
  let seen: Event | null = null;
  const h = (e: Event) => { if (e === seen) return; seen = e; fn(e as KeyboardEvent); };
  const html = typeof document !== 'undefined' ? document.documentElement : null;
  if (html && typeof html.addEventListener === 'function') html.addEventListener(type, h);
  if (typeof window !== 'undefined') window.addEventListener(type, h);
  return () => {
    if (html && typeof html.removeEventListener === 'function') html.removeEventListener(type, h);
    if (typeof window !== 'undefined') window.removeEventListener(type, h);
  };
}
