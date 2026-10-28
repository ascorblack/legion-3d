/**
 * Expedition-only site session (owner bug 28.10): while the hero is IN the party of a running «поход» the site disables
 * its «Город» tab (app.js cityVis: aria-disabled + «Вы сейчас в походе»), so connectSite() cannot open the city and
 * returns 'city_locked'. Instead of a dead splash the launcher (src/content/main.ts) boots the game with THIS session:
 *
 *   - store: the hero (/api/me, then SSE `me` / fetch `me` / `hero:act` from the bridge bus), our own walker (look
 *     only — it never walks), the expedition views (bus `sse:q` / `q`, /api/me `ql`) — exactly what features/expedition
 *     and the quest HUD read in the normal game;
 *   - a tiny stub layout (EXP_LAYOUT_ID, no buildings) so the engine's walk space and camera have something to stand on;
 *     game.ts never builds a city world for it (startGame opts.expeditionOnly);
 *   - NO city: no LGCity / LGCityMap calls, no /api/city/* requests, no moves, no city chat (say → a local error);
 *     hero actions the menus use (equip / unequip / use / wear, GET reads) go to the same endpoints as the site's own
 *     «Герой» tab and only on the player's click.
 * The 2D site (its «Поход» tab) keeps running under our canvas; F8 (setClassic) just shows it again.
 * cityTab() (src/net/city-tab.ts) is the one place that reads the city tab's state (the feature src/features/expedition-only.ts polls it to
 * offer «Вернуться в город» when the site enables the tab again).
 */
import type { Hero, Actions, ApiResult } from '../contracts';
import type { SiteSession } from '../contracts/modules';
import type { Bus } from '../bridge/bridge';
import { createStore } from '../store/store';
import { lookStyle, styleId } from './site';

const W = window as any;
const bus = (): Bus | null => W.__L3D_BUS || null;
const base = (): string => String(W.LG_BASE || '');

/** Layout id of the stub layout (no city in expedition-only mode). */
export const EXP_LAYOUT_ID = 'expedition';
export { cityTab, type CityTab } from './city-tab';

const CSS = `
html.l3d-exp body{overflow:hidden!important}
html.l3d-exp .top,html.l3d-exp #qbar,html.l3d-exp .bugfab,html.l3d-exp .style-switch{visibility:hidden!important}
html.l3d-exp #toast{z-index:125!important}
`;

async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const url = path.startsWith('/api/') && base() ? base() + path : path;
  try {
    const r = await fetch(url, body === undefined ? { credentials: 'same-origin' } : {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return await r.json();
  } catch {
    return { ok: false, error: 'нет связи с сайтом' } as any;
  }
}

/** Raw walker record of the hero (what the appearance converter reads — same fields as src/net/site.ts heroApp). */
const heroRaw = (h: Hero) => {
  const lk = h.wardrobe?.cur && Object.keys(h.wardrobe.cur).length ? h.wardrobe.cur : h.look;
  return { lk, raw: { ...h, n: h.name, lv: h.level, lk, g: h.gear, gh: h.ghost ? 1 : 0 } };
};

export interface ExpSiteSession extends SiteSession { readonly expeditionOnly: true }

/**
 * Build the expedition-only session. `meData` = the /api/me answer connectSite() already read (fetched again when
 * absent). Returns null when there is no logged-in hero (the caller shows the usual splash then).
 */
export async function connectExpedition(meData?: any): Promise<ExpSiteSession | null> {
  const me = meData && meData.user ? meData : await api<any>('/api/me');
  if (!me || !me.user || !me.hero) return null;
  const B = bus();
  const store = createStore();
  const myLogin = String(me.user.login || me.hero.login || '').toLowerCase();
  // the game re-resolves looks with the avatar converter (startGame → setAppearanceFn); this is the plain fallback
  const app = (h: Hero) => {
    const { lk, raw } = heroRaw(h);
    return { login: myLogin, name: String(h.name || myLogin), level: +(h.level || 0) || undefined, styleId: lookStyle(lk, styleId()),
      look: (lk || {}) as any, gear: (h.gear || {}) as any, ghost: !!h.ghost, role: (raw as any).role };
  };
  store.setHero(me.hero);
  store.setLayout({
    id: EXP_LAYOUT_ID, styleId: styleId(), W: 400, H: 400, QW: 0, area: { x0: 0, x1: 400, y0: 0, y1: 400 },
    obstacles: [], buildings: [], free: () => true, nearest: (x, y) => [x, y],
  });
  store.setMe({ login: myLogin, app: app(me.hero), x: 200, y: 200, face: 0, speed: 0, alpha: 1, me: true });

  const style = document.createElement('style'); style.id = 'l3d-exp-css'; style.textContent = CSS; document.head.appendChild(style);
  let classic = false;
  document.documentElement.classList.add('l3d-exp');

  let appKey = JSON.stringify(store.me!.app);
  const onHero = (d: any) => {
    const h = d && (d.hero || (d.login ? d : null)); if (!h) return;
    store.setHero(h);
    const a = app(h), k = JSON.stringify(a);
    if (k !== appKey && store.me) { appKey = k; store.me.app = a; store.emit('walkers'); }
  };
  const unsubs: (() => void)[] = [];
  if (B) {
    for (const t of ['sse:me', 'me', 'hero:act']) unsubs.push(B.on(t, onHero));
    for (const t of ['sse:q', 'q']) unsubs.push(B.on(t, (q) => { if (q && typeof q === 'object') store.setQuest(q); }));
  }
  if (me.ql) store.setQuest(me.ql);
  if (B?.last['sse:q']) store.setQuest(B.last['sse:q']);   // the live view wins over the /api/me snapshot

  const post = async (p: string, b: unknown): Promise<ApiResult> => {
    const r = await api<ApiResult>(p, b);
    if (r && r.ok && r.hero) onHero(r.hero);
    return r || { ok: false, error: 'нет ответа' };
  };
  const setClassic = (on: boolean) => {
    if (classic === on) return; classic = on;
    document.documentElement.classList.toggle('l3d-exp', !on);
  };
  const actions: Actions = {
    equip: (uid) => post('/api/equip', { uid }),
    unequip: (slot) => post('/api/unequip', { slot }),
    use: (uid) => post('/api/use', { uid }),
    wear: (field, value) => post('/api/wear', { field, value }),
    // the city chat lives in the City; during the expedition the commands go to the stream chat
    say: async () => ({ ok: false, error: 'Чат города откроется после похода — команды похода пиши в чат стрима' }),
    get: (p) => api(p),
    post: (p, b) => api(p, b),
    openBuilding: () => { /* no city */ },
    openSitePanel: (spec) => {
      const [tab, view] = String(spec).split(':');
      setClassic(true);
      document.querySelector<HTMLButtonElement>(`.tabs button[data-tab="${tab}"]`)?.click();
      if (view) setTimeout(() => document.querySelector<HTMLButtonElement>(`[data-view="${view}"]`)?.click(), 300);
      W.dispatchEvent(new CustomEvent('l3d:classic', { detail: { on: true, tab } }));
    },
  };

  return {
    expeditionOnly: true,
    store, actions,
    moveTo: () => { /* no city moves */ },
    pauseMoves: () => { /* */ },
    art: () => null,
    setClassic,
    tick: () => { /* no walkers */ },
    selfPos: () => null,
    overlay: () => null,
    closeOverlay: () => { /* */ },
    dispose() {
      for (const u of unsubs) u();
      document.documentElement.classList.remove('l3d-exp');
      style.remove();
    },
  };
}
