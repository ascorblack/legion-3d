/**
 * Game UI: HUD + chat + full-screen menus, rendered into a Shadow DOM (site CSS cannot reach in, ours cannot leak out).
 *
 * Menu signalling (for main.ts): whenever the open menu changes the UI
 *   1. calls `host.menuChanged?.(id | null)` (optional host extra), and
 *   2. dispatches `window` CustomEvent 'l3d:menu' with `detail: { open: id | null, orbit: boolean }`.
 * `orbit` is true for 'gear' | 'bag' | 'look' (camera → orbit, character framed in the left ~45 % of the screen).
 * Opening a menu calls host.input.setGameplay(false) + document.exitPointerLock(); closing calls setGameplay(true).
 *
 * Settings: `ui.settings` (live object, see settings.ts for localStorage keys); changes → window event 'l3d:settings'.
 * Chat focus → window event 'l3d:chat' { focus: boolean }.
 */
import type { MountUi, Ui, UiHost } from '../contracts/modules';
import { onPageKeys } from '../engine/input';
import { heldKey } from './repeat';
import { CSS } from './styles';
import { type Ctx, h, extras } from './ctx';
import { Hud } from './hud';
import { Chat } from './chat';
import { Menus } from './menus';
import { loadSettings, SETTINGS_KEYS, type UiSettings } from './settings';
import { TabRegistry } from './tabs';
import { MapSource } from './map';
import type { GameContext, MenuTabDef } from '../contracts/ext';
import { activeStyle, badgeRules } from './data';

export { moneyText, moneyParts, plural } from './money';
export { SETTINGS_KEYS, SETTINGS_DEFAULTS } from './settings';
export type { UiSettings } from './settings';
export { promptView } from './prompt';

export interface GameUi extends Ui {
  readonly settings: UiSettings;
  /** Toggle HUD visibility (F2). */
  setHudVisible(on: boolean): void;
  /**
   * Add (or replace) a menu tab at runtime. Built-in ids can be replaced (removeTab restores the built-in page).
   * 'character' / 'world' tabs join the ribbon by `order` (built-ins use 10…70 and 110…130); 'system' pages open by
   * hotkey, ui.open(id) and the Pause menu. A taken/reserved hotkey is dropped. Returns an unregister function.
   */
  addTab(id: string, def: MenuTabDef): () => void;
  removeTab(id: string): boolean;
  /** Crosshair prompt line, e.g. «[E] Войти: Кузня», «[E] Купить: Коготок · [F] Осмотреть»; «!» prefix = muted; null hides. */
  prompt(text: string | null): void;
  /** GameContext passed to feature tabs' render(el, ctx). */
  setGameContext(ctx: GameContext): void;
  /** Re-read the site's skin (html[data-skin] + its CSS variables) after a live style change (src/features/restyle.ts);
   *  re-renders the open menu. Returns the skin id now adopted ('' = none). */
  reskin(): string;
}

/** Every custom property adoptSkin may set (cleared before a re-adopt: a light skin after a dark one keeps our palette). */
const SKIN_PROPS = ['--l3d-bg', '--l3d-panel', '--l3d-panel-2', '--l3d-ink', '--l3d-mute', '--l3d-accent', '--l3d-gold', '--l3d-up', '--l3d-dn', '--l3d-hd', '--l3d-tx',
  '--rc-common', '--rc-uncommon', '--rc-rare', '--rc-epic', '--rc-legendary'];

/** Map the site's skin variables onto ours (only for dark skins; light skins keep our den palette). */
function adoptSkin(ui: HTMLElement): string {
  for (const p of SKIN_PROPS) ui.style.removeProperty(p);
  let skin = '';
  try { skin = String(document.documentElement.dataset.skin || ''); } catch { /* no document */ }
  // the site's skin id (site-ui.js STYLE_SKIN: forge, den, rage, garden, club, inferno, cave) — for skin-specific CSS of ours
  if (skin) ui.dataset.skin = skin; else delete ui.dataset.skin;
  // the level medal's ears follow the channel style (cats: cat ears, cherts: horns, others: none)
  const br = badgeRules(activeStyle()); if (br) ui.dataset.badge = br; else delete ui.dataset.badge;
  try {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    const lum = (hex: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return 1; const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
    const surf = v('--surface');
    if (surf && lum(surf) < 0.35) {
      const map: [string, string][] = [['--bg', '--l3d-bg'], ['--surface', '--l3d-panel'], ['--surface2', '--l3d-panel-2'], ['--ink', '--l3d-ink'], ['--mute', '--l3d-mute'], ['--accent', '--l3d-accent'], ['--accent-2', '--l3d-gold'], ['--up', '--l3d-up'], ['--dn', '--l3d-dn']];
      for (const [s, d] of map) { const x = v(s); if (x) ui.style.setProperty(d, x); }
      for (const r of ['common', 'uncommon', 'rare', 'epic', 'legendary']) { const x = v('--rc-' + r); if (x) ui.style.setProperty('--rc-' + r, x); }
    }
    const hd = v('--hd'), tx = v('--tx');
    if (hd) ui.style.setProperty('--l3d-hd', hd);
    if (tx) ui.style.setProperty('--l3d-tx', tx);
  } catch { /* no document styles */ }
  return skin;
}

/** Mount the game UI. Returns GameUi (contract Ui + settings, addTab/removeTab, prompt, setGameContext). */
export const mountUi = (root: HTMLElement, host: UiHost): GameUi => {
  const hostEl = document.createElement('div');
  hostEl.className = 'l3d-ui';
  hostEl.style.cssText = 'position:fixed;inset:0;z-index:150;pointer-events:none;';
  root.appendChild(hostEl);
  const shadow = hostEl.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = CSS; shadow.appendChild(style);
  const ui = h('div', 'ui'); shadow.appendChild(ui);
  adoptSkin(ui);

  const settings = loadSettings();
  const tabs = new TabRegistry();
  let gameCtx: GameContext | null = null;
  const toasts = h('div', 'toasts');
  let opened: string | null = null;
  let hudOn = true;
  const unsubs: (() => void)[] = [];

  const toast = (text: string, bad?: boolean) => {
    const t = h('div', 'toast' + (bad ? ' bad' : '')); t.textContent = text;
    toasts.appendChild(t);
    while (toasts.children.length > 3) toasts.firstElementChild!.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 2800);
  };

  const ctx: Ctx = {
    host, shadow, ui, settings, toast,
    opened: () => opened,
    open: (m) => open(m),
    typing: () => chat.typing,
    tabs,
    map: null as unknown as MapSource,
    game: () => gameCtx,
    scale: 1,
    applyScale: () => {
      // design reference 1366×768; smaller windows scale the whole UI down (never below 0.8), big ones up a little
      // (max 1.15 — 1080p text must not be tiny), × user setting
      const auto = Math.max(0.8, Math.min(1.15, window.innerWidth / 1366, window.innerHeight / 768));
      const k = auto * (settings.uiScale || 1);
      ctx.scale = k;
      ui.style.transformOrigin = '0 0';
      ui.style.transform = k === 1 ? '' : `scale(${k})`;
      ui.style.width = `${100 / k}%`; ui.style.height = `${100 / k}%`;
      ui.style.right = 'auto'; ui.style.bottom = 'auto';
    },
  };
  ctx.applyScale();
  ctx.map = new MapSource(ctx);
  const onResize = () => ctx.applyScale();
  window.addEventListener('resize', onResize);

  const hud = new Hud(ctx);
  const chat = new Chat(ctx);
  const menus = new Menus(ctx);
  hud.el.appendChild(chat.el);
  ui.append(hud.el, menus.el, toasts);

  // ------------------------------------------------------------ open / close
  let ownUnlockAt = 0;
  function open(m: string | null) {
    const id = menus.resolve(m);
    if (m != null && id == null) { console.warn('[legion-3d] ui: unknown menu', m); return; }
    if (id === 'quest') { open(null); host.actions.openSitePanel('quest'); return; }
    if (id === opened) { if (id) menus.render(); return; }
    const was = opened;
    opened = id;
    menus.show(id);
    if (id && !was) {
      host.input.setGameplay(false);
      ownUnlockAt = performance.now();
      try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* */ }
      if ((document.activeElement as any)?.blur && chat.typing) (shadow.activeElement as HTMLElement | null)?.blur();
    } else if (!id && was) {
      if (!chat.typing) host.input.setGameplay(true);
      hud.showHints();
    }
    try { extras(host).menuChanged?.(id); } catch (e) { console.warn('[legion-3d] menuChanged', e); }
    try { window.dispatchEvent(new CustomEvent('l3d:menu', { detail: { open: id, orbit: menus.isOrbit(id) } })); } catch { /* */ }
  }

  // ------------------------------------------------------------ store
  const onHero = () => { hud.setHero(host.store.hero); if (opened) menus.render(); };
  unsubs.push(host.store.on('hero', onHero));
  unsubs.push(host.store.on('chat', () => chat.sync()));
  unsubs.push(host.store.on('online', () => hud.setOnline(host.store.online)));
  unsubs.push(host.store.on('layout', () => { ctx.map.invalidate(); hud.setLayout(); }));
  unsubs.push(tabs.onChange(() => {
    if (opened && !menus.resolve(opened)) open(null);       // the open tab was removed
    else if (opened) menus.render();                         // ribbon / page changed
  }));
  const onSettings = (e: Event) => { const d = (e as CustomEvent).detail; if (d && d.key === 'minimap') hud.setMinimap(!!d.value); };
  window.addEventListener('l3d:settings', onSettings);
  unsubs.push(() => window.removeEventListener('l3d:settings', onSettings));
  unsubs.push(() => window.removeEventListener('resize', onResize));
  onHero(); chat.sync(); hud.setOnline(host.store.online); hud.setLayout();

  // HUD clicks (portrait → gear, social chip → rating)
  hud.el.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act=open]');
    if (t) open(t.dataset.m!);
  });

  // ------------------------------------------------------------ keyboard
  let handled: KeyboardEvent | null = null;
  const tabIds = () => menus.tabs().map((t) => t.id);

  /** Keys while a menu is open (own window listener: Input only forwards Escape/Enter when gameplay is off). */
  const menuKey = (e: KeyboardEvent) => {
    if (e === handled) return;                  // already handled by the gameplay path (Input.onKey) for this event
    if (!opened || e.ctrlKey || e.metaKey || e.altKey) return;
    if (chat.typing) return;
    const tgt = e.composedPath()[0] as HTMLElement | undefined;
    if (tgt && (tgt.tagName === 'INPUT' && (tgt as HTMLInputElement).type !== 'range' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
    handled = e;
    const code = e.code;
    const ot = tabs.get(opened);
    const isTab = !!ot && ot.group !== 'system';
    let used = true;
    if (code === 'ShiftLeft' || code === 'ShiftRight') { menus.setShift(true); return; }
    // a held key repeats: only the page's own navigation (arrows, PageUp…: menus.key) may repeat — a held toggle (I, B,
    // Tab, F1–F3, H, Q / E between tabs, Esc) must not open the menu and close it again
    if (heldKey(code, e.repeat, !!tabs.byCode(code)) === 'swallow') { e.preventDefault(); return; }
    if (e.repeat) { if (menus.key(code, e)) e.preventDefault(); return; }   // only the page's own navigation repeats
    if (code === 'Escape') {
      menus.hideTip();   // hover tooltips are not modal: Esc closes the menu right away
      if (opened === 'settings' || opened === 'help') open('pause');
      else open(null);
    } else if (code === 'F2') setHud(!hudOn);
    else if (code === 'F3') hud.togglePerf();
    else if (code === 'F1' || (code === 'KeyH' && opened !== 'help')) open('help');
    else if (menus.key(code, e)) { /* page handled */ }
    else if (isTab && (code === 'KeyQ' || code === 'KeyE' || code === 'BracketLeft' || code === 'BracketRight')) {
      const ids = tabIds(), i = ids.indexOf(opened);
      const d = code === 'KeyQ' || code === 'BracketLeft' ? -1 : 1;
      open(ids[(i + d + ids.length) % ids.length]);
    } else if (code === 'Tab') open(null);
    else if (tabs.byCode(code)) {
      const t = tabs.byCode(code)!;
      if (t.id === opened) open(null); else if (t.group === 'system' || tabIds().includes(t.id)) open(t.id);
    }
    else used = false;
    if (used || code === 'Tab' || code === 'F1' || code === 'F2' || code === 'F3') e.preventDefault();
  };
  const menuKeyUp = (e: KeyboardEvent) => { if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') menus.setShift(false); };
  // at <html>, before the page's listeners: the input's site key shield stops our key events there (src/engine/input.ts)
  unsubs.push(onPageKeys('keydown', menuKey), onPageKeys('keyup', menuKeyUp));

  /** Gameplay keys through Input.onKey. */
  unsubs.push(host.input.onKey((code, e) => {
    if (e === handled || opened) return true;   // menu listener owns keys while a menu is open
    const r = gameKey(code, e);
    if (r) handled = e;                         // whichever listener runs second must ignore this event
    return r;
  }));
  /** T / Enter / '/': the chat takes the keyboard and frees the pointer — our own unlock, never the «Esc left the lock → Pause» case. */
  function chatFocus(prefill?: string) { ownUnlockAt = performance.now(); chat.focus(prefill); }
  function gameKey(code: string, e: KeyboardEvent): boolean {
    if (chat.typing) return false;              // the chat input handles Enter/Escape itself
    if (e.ctrlKey || e.metaKey) return false;
    const play = host.input.gameplay;
    switch (code) {
      case 'Escape': if (play) { open('pause'); return true; } return false;
      case 'Enter': case 'NumpadEnter': if (play) { e.preventDefault(); chatFocus(); return true; } return false;
    }
    if (!play) return false;
    switch (code) {
      case 'KeyT': e.preventDefault(); chatFocus(); return true;
      case 'Slash': e.preventDefault(); chatFocus('/'); return true;
      case 'Tab': e.preventDefault(); open(menus.resolve('character')); return true;
      case 'F1': case 'KeyH': e.preventDefault(); hud.showHints(); open('help'); return true;
      case 'F2': e.preventDefault(); setHud(!hudOn); return true;
      case 'F3': e.preventDefault(); hud.togglePerf(); return true;
    }
    const t = tabs.byCode(code);
    if (t) { if (t.visible && !t.visible(host.store.hero)) return false; open(t.id); return true; }
    return false;
  }

  // Browser eats the Esc that leaves pointer lock: lock lost during play (not by us) → Pause menu.
  const onLock = () => {
    if (document.pointerLockElement) return;
    if (extras(host).pauseOnUnlock === false) return;
    if (performance.now() - ownUnlockAt < 400) return;
    setTimeout(() => { if (!opened && !chat.typing && host.input.gameplay && !document.pointerLockElement) open('pause'); }, 60);
  };
  document.addEventListener('pointerlockchange', onLock);
  unsubs.push(() => document.removeEventListener('pointerlockchange', onLock));

  // settings changed elsewhere (another tab) → reload
  const onStorage = (e: StorageEvent) => { if (e.key && Object.values(SETTINGS_KEYS).includes(e.key)) Object.assign(settings, loadSettings()); };
  window.addEventListener('storage', onStorage);
  unsubs.push(() => window.removeEventListener('storage', onStorage));

  function setHud(on: boolean) { hudOn = on; ui.classList.toggle('nohud', !on); }

  const api: GameUi = {
    el: hostEl,
    get opened() { return opened; },
    settings,
    open,
    toast,
    focusChat: () => { if (opened) open(null); chatFocus(); },
    setHudVisible: setHud,
    addTab: (id, def) => tabs.add(id, def),
    removeTab: (id) => { menus.tabRemoved(id); return tabs.remove(id); },
    prompt: (text) => hud.setPrompt(text),
    setGameContext: (g) => { gameCtx = g; },
    reskin: () => { const s = adoptSkin(ui); hud.setHero(host.store.hero); if (opened) menus.render(); return s; },
    update(dt: number) { hud.update(dt); chat.update(dt); if (opened) menus.tick(dt); },
    dispose() {
      menus.dispose();
      try { chat.dispose(); } catch { /* */ }
      for (const u of unsubs) { try { u(); } catch { /* */ } }
      if (opened) host.input.setGameplay(true);
      hostEl.remove();
    },
  };
  return api;
};
/** Contract check: mountUi still satisfies MountUi. */
export const _mountUiContract: MountUi = mountUi;
