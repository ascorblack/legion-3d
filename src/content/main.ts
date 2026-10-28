/**
 * Entry point (content script, MAIN world, document_idle).
 * Adds the "3D" toggle, boots the game on demand and wires modules together.
 *
 * Boot failures always give the site back: once connectSite() has hidden the 2D city (html.l3d-on, shrunk view,
 * hidden others) a failed start calls site.dispose(), which restores it. Auto-start runs once per page load; when
 * WebGL is unavailable this is remembered for the browser session (sessionStorage) and the game is not auto-started
 * again on reload — the launcher button stays with a tooltip explaining why.
 *
 * Expedition-only boot: while the hero is IN an expedition party the site locks its City tab (connectSite →
 * 'city_locked' / 'quest_running'). Then the game boots without a city (src/net/expedition-site.ts, startGame
 * opts.expeditionOnly): the 3D expedition, HUD, menus, F8. «Вернуться в город» (window 'l3d:return-city', or F8 back
 * from the classic site once the City is open again) disposes that game and runs the normal boot in place.
 */
import type { SiteSession } from '../contracts/modules';
import { connectSite, siteGuard, currentTown } from '../net/site';
import { connectExpedition, cityTab } from '../net/expedition-site';
import { RETURN_EVENT } from '../features/expedition-only';
import { startGame, type Game } from './game';
import CSS from './main.css';

const LS_AUTO = 'l3d.auto';
const SS_NOGL = 'l3d.noWebGL';
const W = window as any;

/* ------------------------------------------------------------------ launcher button + toggle */
let game: Game | null = null;
let booting = false;
/** The running game is the expedition-only one (no city). */
let expGame = false;

const ssGet = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const ssSet = (k: string, v: string | null) => { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* */ } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* */ } };

const TITLE = 'Legion 3D: город от первого лица (F8)';
const TITLE_NOGL = 'Браузеру не удалось включить 3D-графику (WebGL). Включи аппаратное ускорение в настройках браузера и перезапусти браузер.';

function launcher() {
  if (document.getElementById('l3d-launch')) return;
  const st = document.createElement('style'); st.id = 'l3d-css'; st.textContent = CSS; document.head.appendChild(st);
  const b = document.createElement('button');
  b.id = 'l3d-launch'; b.type = 'button';
  b.innerHTML = '<span aria-hidden="true">◆</span> Играть в 3D';
  b.title = ssGet(SS_NOGL) ? TITLE_NOGL : TITLE;
  b.onclick = () => toggle();
  document.body.appendChild(b);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F8') { e.preventDefault(); e.stopPropagation(); toggle(); }
  }, true);
  W.addEventListener('l3d:classic', (e: CustomEvent) => { if (game && e.detail?.on) game.classicPanel(); });
  W.addEventListener(RETURN_EVENT, () => { void returnToCity(); });
  W.addEventListener('l3d:contextlost', () => gpuNotice(true));
  W.addEventListener('l3d:contextrestored', () => gpuNotice(false));
  let auto = true; try { auto = localStorage.getItem(LS_AUTO) !== '0'; } catch { /* default on */ }
  if (auto && !ssGet(SS_NOGL)) setTimeout(() => { if (!game && !booting) toggle(); }, 600);
}

/** Leave the expedition-only game and boot the city in place (the site's City tab is open again). */
async function returnToCity() {
  if (booting || !game || !expGame) return;
  const g = game;
  if (typeof g.dispose !== 'function') { location.reload(); return; }
  try { g.dispose(); } catch (e) { console.error('[legion-3d] expedition game dispose failed', e); location.reload(); return; }
  game = null; expGame = false;
  await toggle();
}

/** WebGL could not be created (src/engine NoWebGLError, code 'no_webgl'; three's own message as a fallback). */
const isNoWebGL = (e: unknown) => {
  const x = e as { code?: string; name?: string; message?: string } | null;
  return !!x && (x.code === 'no_webgl' || x.name === 'NoWebGLError' || /webgl/i.test(String(x.message || '')));
};

async function toggle() {
  if (booting) return;
  if (game) {
    // back from the classic site after the expedition: the City is open again → boot the city instead
    if (game.classic && expGame && cityTab() === 'open') { lsSet(LS_AUTO, '1'); void returnToCity(); return; }
    if (game.classic) { game.resume(); lsSet(LS_AUTO, '1'); }
    else { game.toClassic(); lsSet(LS_AUTO, '0'); }
    return;
  }
  booting = true;
  document.getElementById('l3d-launch')?.classList.add('hide');
  const splash = showSplash('Собираем город…');
  let site: SiteSession | null = null;
  try {
    const s = await connectSite({ onStatus: (t) => splash.set(t) });
    if ('error' in s && (s.error === 'city_locked' || s.error === 'quest_running')) {
      // in an expedition party: the City is locked — boot the 3D expedition without the city
      splash.set('Ты в походе — собираем 3D-поход…');
      const xs = await connectExpedition();
      if (xs) {
        site = xs;
        game = await startGame(xs, splash.set, { expeditionOnly: true });
        expGame = true;
        splash.close();
        ssSet(SS_NOGL, null);
        lsSet(LS_AUTO, '1');
        return;
      }
    }
    if ('error' in s) {
      if (s.missing?.length) console.error('[legion-3d] site contract broken:\n  ' + s.missing.join('\n  '));
      splash.error(s.error, s.loginUrl);
      return;
    }
    site = s;
    splash.set('Строим 3D…');
    game = await startGame(s, splash.set);
    expGame = false;
    splash.close();
    ssSet(SS_NOGL, null);
    const b = document.getElementById('l3d-launch'); if (b) b.title = TITLE;
    lsSet(LS_AUTO, '1');
  } catch (e) {
    console.error('[legion-3d] boot failed', e);
    // give the site back: header, tabs and the 2D city (connectSite hid them)
    if (site) { try { site.dispose(); } catch (err) { console.error('[legion-3d] restore failed', err); } }
    game = null;
    if (isNoWebGL(e)) {
      ssSet(SS_NOGL, '1');
      const b = document.getElementById('l3d-launch'); if (b) b.title = TITLE_NOGL;
      splash.error('no_webgl');
    } else splash.error('crash');
  } finally { booting = false; }
}

function showSplash(text: string) {
  const el = document.createElement('div'); el.id = 'l3d-splash';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-live', 'polite');
  el.innerHTML = '<div class="l3d-sp-box"><div class="l3d-sp-logo">ЛЕГИОН <b>3D</b></div><div class="l3d-sp-t"></div><div class="l3d-sp-bar"><i></i></div><div class="l3d-sp-x"></div></div>';
  document.body.appendChild(el);
  const t = el.querySelector('.l3d-sp-t') as HTMLElement; t.textContent = text;
  const msgs: Record<string, string> = {
    no_login: 'Войди через Twitch, чтобы гулять по городу в 3D.',
    no_hero: 'Героя пока нет — он появится, когда ты напишешь в чат на стриме.',
    city_locked: 'Ты сейчас в походе — город закрыт. Следи за походом во вкладке «Поход».',
    site_changed: 'Сайт обновился и расширение пока не умеет с ним работать. Попробуй обновить страницу.',
    quest_running: 'Идёт поход — 3D-город откроется после него.',
    no_webgl: 'Браузеру не удалось включить 3D-графику (WebGL). Включи аппаратное ускорение в настройках браузера (в Firefox: Настройки → Основные → Производительность), затем перезапусти браузер.',
    crash: 'Не получилось запустить 3D. Подробности — в консоли (F12).',
  };
  const close = () => {
    el.classList.add('out'); setTimeout(() => el.remove(), 400);
    if (!game) document.getElementById('l3d-launch')?.classList.remove('hide');
  };
  return {
    set: (s: string) => { t.textContent = s; },
    close,
    error: (code: string, login?: string) => {
      t.textContent = msgs[code] || code;
      el.querySelector('.l3d-sp-bar')?.remove();
      const x = el.querySelector('.l3d-sp-x') as HTMLElement;
      x.textContent = '';
      if (login) { const a = document.createElement('a'); a.className = 'l3d-btn'; a.href = login; a.textContent = 'Войти через Twitch'; x.appendChild(a); }
      if (code === 'no_webgl' || code === 'crash') {
        const r = document.createElement('button'); r.type = 'button'; r.className = 'l3d-btn'; r.textContent = 'Повторить';
        r.onclick = () => { el.remove(); void toggle(); };
        x.appendChild(r);
      }
      const c = document.createElement('button'); c.type = 'button'; c.className = 'l3d-btn ghost'; c.textContent = 'Классический сайт';
      c.onclick = () => close();
      x.appendChild(c);
      (x.querySelector('button, a') as HTMLElement | null)?.focus();
    },
  };
}

/** «Видеокарта перезапускается…» while the WebGL context is lost (engine events). */
function gpuNotice(on: boolean) {
  let el = document.getElementById('l3d-gpu');
  if (!on) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div'); el.id = 'l3d-gpu'; el.setAttribute('role', 'status');
    el.textContent = 'Видеокарта перезапускается…';
    el.style.cssText = "position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:131;padding:8px 16px;border-radius:999px;background:rgba(13,11,34,.9);color:#ffe9a8;font:700 14px/1.2 'Golos Text','Nunito',sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.4)";
    document.body.appendChild(el);
  }
  const mine = el;
  setTimeout(() => { if (mine.isConnected) mine.remove(); }, 15000);   // no restore event → do not hang forever
}

/* ------------------------------------------------------------------ probes (read-only; e2e/contract.mjs, e2e/live.mjs) */
/** Runtime site contract now ('page' = just loaded, 'city' = City tab open): failing checks, never throws. */
W.__l3dContract = (phase: 'page' | 'city' = 'city') => { try { return siteGuard(phase); } catch (e) { return { breaks: ['guard crashed: ' + String(e)], degrades: [] }; } };
/** Which town the site's City shows (src/net/town.ts), from the page + the hero the bridge saw (/api/me, SSE me). */
W.__l3dTownNow = () => {
  try { const B = W.__L3D_BUS, d = B?.last?.['sse:me'] || B?.last?.me, h = d ? (d.hero || (d.login ? d : null)) : null; return currentTown(h); } catch (e) { return { id: '?', via: String(e) }; }
};

/* ------------------------------------------------------------------ boot */
if (/^\/c\/[^/]+\/?$/.test(location.pathname) && !W.LG_DOCK) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', launcher); else launcher();
}
