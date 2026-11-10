/**
 * Protection against closing the tab by accident (owner feedback v0.4.0: «по инерции в полёте хочется нажать Ctrl
 * (вниз)» → Ctrl+W closes the tab). Browsers never let a page cancel Ctrl+W, so two things:
 *
 *  a) a 'beforeunload' guard while the 3D game is shown: Ctrl+W / closing the tab / reloading asks «Покинуть сайт?».
 *     Chrome only shows it after the user interacted with the page (sticky activation), so the listener is added
 *     after the first click / key press; removed in the classic site (F8) and when the game is disposed.
 *     Setting: Настройки → Прочее → «Спрашивать перед закрытием вкладки» (default on).
 *  b) an optional fullscreen game mode (pause menu «Полный экран», or Alt+Enter): requestFullscreen + Keyboard Lock
 *     (navigator.keyboard.lock, Chrome/Edge) of W / Q / N / T / Esc — in that mode Ctrl+W reaches the page and is
 *     ignored; Esc still opens the pause menu, holding Esc exits fullscreen (Chrome's rule; a hint says so).
 *     Without Keyboard Lock it is a plain fullscreen (Esc exits) and only (a) protects.
 */
import { coreFeature } from './types';
import { registerPauseItem, registerSettingRow, settingValue } from '../ui/settings-ext';
import { isTyping } from '../engine/input';

export const GUARD_KEY = 'l3d.closeguard';
/** Keys locked in fullscreen: Ctrl+W / Ctrl+Q / Ctrl+N / Ctrl+T reach the page instead of the browser; Esc = pause. */
export const LOCK_KEYS = ['KeyW', 'KeyQ', 'KeyN', 'KeyT', 'Escape'];

/** Should the beforeunload guard be armed? */
export function guardWanted(s: { setting: boolean; activated: boolean; classic: boolean; disposed: boolean }): boolean {
  return s.setting && s.activated && !s.classic && !s.disposed;
}

/** The beforeunload listener on `win`, armed / disarmed idempotently. */
export function createCloseGuard(win: Pick<Window, 'addEventListener' | 'removeEventListener'>) {
  let armed = false;
  const onBefore = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    // legacy Chrome / Firefox need returnValue set to show the confirm
    try { (e as { returnValue: unknown }).returnValue = ''; } catch { /* read-only in some engines */ }
    return '';
  };
  return {
    get armed() { return armed; },
    set(on: boolean) {
      if (on === armed) return;
      armed = on;
      if (on) win.addEventListener('beforeunload', onBefore as EventListener);
      else win.removeEventListener('beforeunload', onBefore as EventListener);
    },
  };
}

/** A key press that is a browser close / new-window shortcut (swallowed while the keyboard is locked in fullscreen). */
export function isCloseChord(e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey'>): boolean {
  return (e.ctrlKey || e.metaKey) && (e.code === 'KeyW' || e.code === 'KeyQ' || e.code === 'KeyN' || e.code === 'KeyT');
}

interface KeyboardLockApi { lock(keys?: string[]): Promise<void>; unlock(): void }

export default coreFeature({
  id: 'closeguard',
  setup(ctx) {
    const offRow = registerSettingRow({
      key: GUARD_KEY, label: 'Спрашивать перед закрытием вкладки', group: 'Прочее', order: 20, kind: 'seg',
      sub: 'Ctrl+W или закрытие вкладки сначала спросит «Покинуть сайт?» (после первого клика по игре)',
      options: [['on', 'Вкл'], ['off', 'Выкл']], def: 'on',
    });
    const guard = createCloseGuard(window);
    ctx.dev.closeguard = { get armed() { return guard.armed; }, get activated() { return activated; } };
    let activated = !!(navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive;
    let disposed = false;
    const update = () => guard.set(guardWanted({ setting: settingValue(GUARD_KEY, 'on') === 'on', activated, classic: !!ctx.state.classic, disposed }));
    const onAct = () => {
      if (activated) return;
      activated = true; update();
      window.removeEventListener('pointerdown', onAct, true); window.removeEventListener('keydown', onAct, true);
    };
    if (!activated) { window.addEventListener('pointerdown', onAct, true); window.addEventListener('keydown', onAct, true); }
    const onSettings = (e: Event) => { if ((e as CustomEvent).detail?.key === GUARD_KEY) update(); };
    window.addEventListener('l3d:settings', onSettings);
    // the classic toggle has no event: a cheap check twice a second (not per frame — the engine is paused in classic)
    const iv = window.setInterval(update, 500);
    update();

    /* ---- fullscreen game mode ---- */
    const kb = (navigator as Navigator & { keyboard?: Partial<KeyboardLockApi> }).keyboard;
    let kbLocked = false;
    const fsOn = () => !!document.fullscreenElement;
    const fsSupported = () => !!document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === 'function';
    const enter = async () => {
      if (fsOn() || !fsSupported()) return;
      try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (e) { console.warn('[l3d] fullscreen refused', e); return; }
      kbLocked = false;
      if (kb && typeof kb.lock === 'function') { try { await kb.lock(LOCK_KEYS); kbLocked = true; } catch { /* not allowed here */ } }
      ctx.ui.toast(kbLocked
        ? 'Полный экран: Ctrl+W не закроет вкладку. Выйти — зажми Esc (2 секунды) или Alt+Enter'
        : 'Полный экран. Выйти — Esc или Alt+Enter');
    };
    const exit = () => { if (fsOn()) document.exitFullscreen().catch(() => { /* already out */ }); };
    const toggle = () => { if (fsOn()) exit(); else void enter(); };
    let offPause = () => { /* */ };
    const pause = () => {
      offPause();
      offPause = registerPauseItem({ id: 'fullscreen', label: fsOn() ? 'Выйти из полного экрана' : 'Полный экран', key: 'Alt+Enter', order: 30, group: 'system', icon: 'expand',
        enabled: () => fsSupported() && !ctx.state.classic, run: toggle });
    };
    pause();
    const onFs = () => {
      if (!fsOn() && kbLocked) { try { kb?.unlock?.(); } catch { /* */ } kbLocked = false; }
      pause();
    };
    document.addEventListener('fullscreenchange', onFs);
    const onKey = (e: KeyboardEvent) => {
      // keyboard locked: Ctrl+W & co. arrive here instead of closing the tab — ignore them
      if (kbLocked && fsOn() && isCloseChord(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (e.code === 'Enter' && e.altKey && !e.ctrlKey && !e.metaKey && !e.repeat && !ctx.state.classic && !isTyping()) {
        e.preventDefault(); toggle();
      }
    };
    window.addEventListener('keydown', onKey, true);

    return () => {
      disposed = true; update();
      clearInterval(iv); offRow(); offPause();
      window.removeEventListener('l3d:settings', onSettings);
      window.removeEventListener('pointerdown', onAct, true); window.removeEventListener('keydown', onAct, true);
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('fullscreenchange', onFs);
      if (kbLocked) { try { kb?.unlock?.(); } catch { /* */ } kbLocked = false; }
      delete ctx.dev.closeguard;
    };
  },
});
