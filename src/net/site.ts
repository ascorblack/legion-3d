/**
 * Site adapter ("hybrid netcode", see docs/ARCHITECTURE.md).
 * The site's own City client keeps running underneath (presence, throttled moves, chat, interiors);
 * we read its live data from the bridge bus and drive it through window.LGCity.
 */
import type { Store, Hero, Walker, ChatMsg, CityLayout, Actions, ApiResult, Appearance, Obstacle, Building } from '../contracts';
import type { SiteSession, ArtProvider } from '../contracts/modules';
import { createStore, type StoreWriter } from '../store/store';
import { SX, SZ } from '../world/coords';
import type { Bus } from '../bridge/bridge';
import { createGoSender } from '../flight/sendpoint';
import CONTRACT from '../data/site-contract.json';
import { runtimeContract, describeFails, type ContractCheck } from './contract';
import { reportDrift } from '../core/drift';
import { npcPlaces, makeOpts } from '../events/halloween/hwnpc';
import { CAMP, campScene, detectTown, readTownSignals, townMeta, type CampScene, type HeroTownFlags } from './town';

/* ------------------------------------------------------------------ site globals (untyped) */
const W = window as any;
const bus = (): Bus | null => W.__L3D_BUS || null;
const base = (): string => String(W.LG_BASE || '');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => T | null | undefined | false, ms: number, step = 100): Promise<T | null> {
  const t0 = performance.now();
  for (;;) {
    try { const v = fn(); if (v) return v as T; } catch { /* keep waiting */ }
    if (performance.now() - t0 > ms) return null;
    await sleep(step);
  }
}

/** fetch() relative to the channel. Uses the page's fetch (already wrapped by the site to add LG_BASE). */
async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const url = path.startsWith('/api/') && !base() ? path : path.startsWith('/api/') ? base() + path : path;
  try {
    const r = await fetch(url, body === undefined ? { credentials: 'same-origin' } : {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return await r.json();
  } catch {
    return { ok: false, error: 'нет связи с сайтом' } as any;
  }
}

/* ------------------------------------------------------------------ appearance hook */
export type AppearanceFn = (login: string, raw: any, styleId: string) => Appearance;
let appearanceFn: AppearanceFn = (login, raw, styleId) => ({
  login, name: String(raw?.n || raw?.name || login), level: +(raw?.lv || raw?.level || 0) || undefined, styleId,
  look: (raw?.lk || raw?.wardrobe?.cur || raw?.look || {}) as any, gear: (raw?.g || raw?.gear || {}) as any,
  ghost: !!(raw?.gh || raw?.ghost), role: raw?.role,
});
/** Plug the avatar module's converter (appearanceFrom). */
export function setAppearanceFn(fn: AppearanceFn) { appearanceFn = fn; }
/** Default look for a login through the site's own generator (MDDoodle.defaultsFor) — values only. */
export function siteDefaults(login: string): Record<string, unknown> | null {
  try {
    const D = W.MDDoodle; if (!D || !D.defaultsFor) return null;
    const d = D.defaultsFor(String(login).toLowerCase());
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(d || {})) out[k] = (v as any)?.v ?? null;
    return out;
  } catch { return null; }
}
export const styleId = (): string => { try { return String(W.MDDoodle?.active || 'legion'); } catch { return 'legion'; } };
/** Style a look is drawn in: a hero with a personal style (Печать Метаморфозы, 26.10: `ps` in the look, doodle.js styleFor)
 *  keeps it in every channel; everyone else is drawn in the channel's style. */
export const lookStyle = (lk: any, channel: string): string => (lk && typeof lk.ps === 'string' && /^[\w-]{1,30}$/.test(lk.ps) ? lk.ps : channel);

/* ------------------------------------------------------------------ layout */
/** Current town id of the site's City (src/net/town.ts: DOM, picker, sessionStorage, hero flags). */
export function currentTown(hero: Hero | null): { id: string; via: string } {
  return detectTown(readTownSignals(W, document, hero as HeroTownFlags | null));
}
/** Districts list (GET /api/city/towns — the same read the site's own town picker does), cached for a minute. */
let townsCache: { at: number; list: any[] } | null = null;
async function townsList(force = false): Promise<any[]> {
  if (!force && townsCache && Date.now() - townsCache.at < 60000) return townsCache.list;
  const r = await api<any>('/api/city/towns');
  const list = r && r.ok && Array.isArray(r.list) ? r.list : [];
  townsCache = { at: Date.now(), list };
  return list;
}
/** Town layout the 3D world can be built from, or null (not available yet / not this town). `townMetaOf` = an entry of
 *  /api/city/towns for district towns. */
function buildLayout(hero: Hero | null, town: string, townMetaOf: any): CityLayout | null {
  const M = W.LGCityMap, D = W.MDDoodle; if (!M || !D) return null;
  if (town === CAMP) return buildCampLayout(hero);
  if (town !== 'fair') return townMetaOf ? buildTownLayout(hero, town, townMetaOf) : null;
  let L: any = null; try { L = D.location('fair', { esc: (s: unknown) => String(s ?? '') }); } catch { /* none */ }
  if (!L) return null;
  const ms = !!(hero && hero.ms), mn = !!(hero && hero.mn && Object.keys(hero.mn as object).length);
  const MS = ms && !!L.magic;
  // HW-NPC (site 28.10): with the Halloween look the site's walk grid also has the NPCs' obstacles (city.js hwNpc → S.mk({ hwObst, hwB })).
  // The grid is swapped in place (hwNpcGrid) — no world rebuild when the night starts / ends.
  const mk = (hw: boolean) => M.make((L.obstacles || []).filter((o: any) => !o.divider), { magic: MS, magicObst: L.magic && L.magic.obstacle, mine: mn, ...(hw ? makeOpts(npcPlaces(W)) : {}) });
  const hold = { on: hwNpcOn(hero), map: null as any };
  try { hold.map = mk(hold.on); } catch { hold.on = false; hold.map = mk(false); }
  const map = hold.map;
  const st = styleId();
  const art: CityLayout['art'] = {};
  try {
    const A = W.LGCityArt;
    if (A) {
      art.quarterSvg = A.quarter(st, M.QW, { auction: !!(hero && hero.au) }).svg;
      art.lowerSvg = A.lower(st, M, { storage: !!(hero && hero.sg), mine: mn }).svg;
    }
    art.fairSvg = L.scene({ city: true, ...(MS ? { magic: true, magicName: String(hero!.ms) } : {}) });
    art.fairX = M.QW + 8;
  } catch { /* art is optional */ }
  const skyM = /\.fr-skybg\{background:([^}]+)\}/.exec(L.css || '');
  const buildings: Building[] = (map.BUILDINGS as any[]).filter((b) => !b.hw).map((b) => ({
    ...b,
    title: b.id === 'magic' && ms ? String(hero!.ms) : b.title,
    soon: !!b.soon && !((b.id === 'auction' && hero?.au) || (b.id === 'storage' && hero?.sg) || (b.id === 'mine' && mn)),
  }));
  const out: CityLayout = {
    id: 'fair', styleId: st, W: map.W, H: map.H, QW: map.QW, area: map.AREA,
    obstacles: (map.OBST as any[]).filter((o) => !o.hwnpc) as Obstacle[], buildings, low: M.LOW,
    sky: skyM ? skyM[1] : undefined, art,
    free: (x, y) => hold.map.free(x, y), nearest: (x, y) => hold.map.nearest(x, y), path: (a, b) => hold.map.path(a, b),
  };
  hwGrids.set(out, (on) => { if (on === hold.on) return; try { hold.map = mk(on); hold.on = on; } catch (e) { console.warn('[legion-3d] hw NPC grid', e); } });
  return out;
}
/** The site shows its Halloween NPCs (and has their obstacles in its grid): look on, hwnpc.js + cityhw.js loaded. */
function hwNpcOn(hero: Hero | null): boolean {
  const c = (hero as any)?.hwc;
  return !!(c && c.look) && !!W.LGHwNpc && typeof W.LGHwNpc.geo === 'function' && !!W.LGCityHW && typeof W.LGCityHW.npcSpots === 'function';
}
const hwGrids = new WeakMap<CityLayout, (on: boolean) => void>();
/** Swap the Fair's walk grid with / without the NPC obstacles (no-op for other towns or when unchanged). */
export function hwNpcGrid(L: CityLayout | null, hero: Hero | null): void { if (L) hwGrids.get(L)?.(hwNpcOn(hero)); }
/** city.js soonB / bOk for a town's buildings (same hero flags as the fair). */
function townBuildings(list: any[], hero: Hero | null, magicOk: boolean): Building[] {
  const h = (hero || {}) as any, mn = !!(h.mn && Object.keys(h.mn).length);
  return list.filter((b) => (!b.magic || magicOk) && (!b.mine || mn)).map((b) => ({
    ...b, door: { ...b.door },
    title: b.id === 'magic' && h.ms ? String(h.ms) : b.title,
    // a building under construction (b.build, towngen.js buildLeft) is closed like a «soon» one
    soon: (!!b.soon && !((b.id === 'auction' && h.au) || (b.id === 'storage' && h.sg) || (b.id === 'mine' && mn)))
      || !!(b.build && safe(() => W.LGTownGen?.buildLeft?.(b, Date.now()), 0)),
  }));
}
function buildTownLayout(hero: Hero | null, id: string, meta: any): CityLayout | null {
  // District towns: the site keeps its generated layout private (TOWN.L); towngen.js is deterministic, so the same
  // generate(townMeta(entry of /api/city/towns)) gives the same layout and walk grid as the site (city.js townPrep/buildTown).
  try {
    const TG = W.LGTownGen; if (!TG) return null;
    const TL = TG.generate(townMeta(meta));
    const MS = !!(hero as any)?.ms;
    const map = TG.map(TL, { magic: MS });
    return {
      id, styleId: styleId(), W: TL.W, H: TL.H, QW: 0, area: TL.AREA,
      obstacles: (map.OBST || TL.OBST || []) as Obstacle[], buildings: townBuildings(TL.BUILDINGS, hero, MS),
      free: (x, y) => map.free(x, y), nearest: (x, y) => map.nearest(x, y), path: (a, b) => map.path(a, b),
      ...(Array.isArray(TL.spawn) ? { spawn: [+TL.spawn[0], +TL.spawn[1]] } : {}),
    } as CityLayout;
  } catch (e) { console.warn('[legion-3d] district town layout', id, e); return null; }
}
/** The start camp «Перепутье» (campmap.js, loaded by city.js on demand): same building ids as the fair, own scene. */
function buildCampLayout(hero: Hero | null): CityLayout | null {
  try {
    const CM = W.LGCampMap; if (!CM || typeof CM.get !== 'function' || typeof CM.map !== 'function') return null;
    const TL = CM.get(), map = CM.map(TL), camp = campScene(TL); if (!camp) return null;
    const L: CityLayout & { camp: CampScene; spawn: [number, number]; title?: string } = {
      id: CAMP, styleId: styleId(), W: TL.W, H: TL.H, QW: 0, area: TL.AREA,
      obstacles: (TL.OBST || []) as Obstacle[], buildings: townBuildings(TL.BUILDINGS, hero, false),
      free: (x, y) => map.free(x, y), nearest: (x, y) => map.nearest(x, y), path: (a, b) => map.path(a, b),
      camp, spawn: camp.spawn, title: String(TL.name || 'Перепутье'),
    };
    return L;
  } catch (e) { console.warn('[legion-3d] camp layout', e); return null; }
}
const safe = <T,>(f: () => T, d: T): T => { try { return f(); } catch { return d; } };

/* ------------------------------------------------------------------ walker simulation */
interface Sim extends Walker { path: [number, number][] | null; lag: number; raw: any; vx: number; vy: number; lookKey: string }
/** Look-relevant fields of a walker record, as one string (computed once per update, compared to the cached one). */
const lookKeyOf = (e: any) => JSON.stringify([e.lk, e.g, e.gh, e.n, e.lv]);
/** Kind of a site chat line. Mirrors site-chat.js tabOf(): an explicit tab (m.tb) wins, then «Летопись» events (m.ev),
 *  trade (k:'tr'), DMs (k:'dm'); local system lines (m.sys). The UI maps 'ev' to «Достижения» or «Общий» by hero flags. */
export const chatKind = (m: any): NonNullable<ChatMsg['kind']> => (m.sys ? 'sys' : m.tb === 'ev' || m.tb === 'tr' || m.tb === 'dm' ? m.tb : m.tb === 'g' ? 'g'
  : m.ev ? 'ev' : m.k === 'tr' ? 'tr' : m.k === 'dm' ? 'dm' : 'g');
export const toChat = (m: any): ChatMsg => ({ id: String(m.id), login: String(m.l || ''), name: String(m.n || m.l || ''), text: String(m.t || ''), at: +m.at || Date.now(), kind: chatKind(m), role: m.c, roleName: m.cn, to: m.to });
/** Does a fresh line get a bubble over its author — site chatApply(): not for ignored players, not for «Достижения» /
 *  events, not for DMs (and our own system lines); history (older than a minute) neither. */
export const bubbleFor = (m: ChatMsg, ign: ReadonlySet<string>, now: number): boolean =>
  !!m.login && m.kind !== 'dm' && m.kind !== 'ev' && m.kind !== 'sys' && !ign.has(m.login.toLowerCase()) && now - m.at <= 60000;
const faceOf = (dx: number, dy: number) => Math.atan2(-(dx * SX), -(dy * SZ));

const GO_MS = 500;

/* ------------------------------------------------------------------ CSS that hides the 2D city under the game */
const HIDE_CSS = `
html.l3d-on body{overflow:hidden!important}
html.l3d-on .top,html.l3d-on #qbar,html.l3d-on .bugfab,html.l3d-on .style-switch{visibility:hidden!important}
html.l3d-on #tab-city .cy-view,html.l3d-on:not(.l3d-chat-dock) #tab-city .cy-chat,html.l3d-on #tab-city .cy-bar,html.l3d-on #tab-city .cy-hud{visibility:hidden!important;pointer-events:none!important}
html.l3d-on #tab-city .cy-room,html.l3d-on #tab-city .cy-room *{visibility:visible}
html.l3d-on #toast{z-index:125!important}
/* the site's own city chat is docked over the game by src/ui/chat.ts (html.l3d-chat-dock, look: SITE_CHAT_CSS) */
/* the 2D city keeps running for presence: shrink its view so Pixi renders a few pixels instead of a full screen */
html.l3d-on #tab-city .cy-view{width:4px!important;height:4px!important;min-height:0!important;overflow:hidden!important;position:absolute!important;left:0;top:0}
`;

/** Boot guard: the runtime site contract (src/data/site-contract.json via src/net/contract.ts). 'break' failures stop
 *  the boot (splash «Сайт обновился…», the list in the console); 'degrade' ones are logged and reported as drift. */
export function siteGuard(phase: 'page' | 'city'): { breaks: string[]; degrades: string[] } {
  const fails = runtimeContract(CONTRACT.checks as ContractCheck[], W, document, phase);
  const breaks = describeFails(fails.filter((f) => f.severity === 'break'));
  const degrades = describeFails(fails.filter((f) => f.severity === 'degrade'));
  for (const f of fails) if (f.severity === 'degrade') reportDrift('site', f.id, f.missing);
  if (degrades.length) console.warn('[legion-3d] the site changed, some features degrade:', degrades);
  if (breaks.length) console.error('[legion-3d] the site changed, 3D cannot run:', breaks);
  return { breaks, degrades };
}

export async function connectSite(opts: { onStatus?: (s: string) => void } = {}): Promise<SiteSession | { error: 'no_login' | 'no_hero' | 'city_locked' | 'site_changed' | 'quest_running'; loginUrl?: string; missing?: string[] }> {
  const say = opts.onStatus || (() => {});
  const B = bus();
  say('Проверяем вход…');
  const me = await api<any>('/api/me');
  if (!me || !me.user) return { error: 'no_login', loginUrl: String(W.LG_LOGIN || '/auth/twitch/login') };
  if (!me.hero) return { error: 'no_hero' };
  if (!me.hero.cy) return { error: 'site_changed' };
  const store = createStore();
  store.setHero(me.hero);

  // City tab must be open for presence. The site blocks it while our party is on an expedition.
  say('Открываем город…');
  const cityBtn = await waitFor(() => document.querySelector<HTMLButtonElement>('.tabs button[data-tab="city"]:not([hidden])'), 8000);
  if (!cityBtn) return { error: 'site_changed' };
  if (cityBtn.getAttribute('aria-disabled') === 'true') return { error: 'city_locked' };
  if (!document.querySelector('#tab-city.on')) cityBtn.click();
  const ok = await waitFor(() => W.LGCity && W.LGCityMap && W.MDDoodle && W.LGCity.debug && W.LGCity.debug(), 30000, 200);
  if (!ok) return { error: document.querySelector('#tab-city.on') ? 'site_changed' : 'city_locked' };
  { const g = siteGuard('city'); if (g.breaks.length) return { error: 'site_changed', missing: g.breaks }; }

  // Hide the 2D layer, keep interiors. Others hidden in the site client = it stops drawing them (we draw them).
  const style = document.createElement('style'); style.id = 'l3d-hide'; style.textContent = HIDE_CSS; document.head.appendChild(style);
  let classic = false;
  const wasHidden = safe(() => !!W.LGCity.debug()?.hidden, false);
  const enter3d = () => {
    document.documentElement.classList.add('l3d-on');
    safe(() => W.LGCity.hideOthers(true), undefined);
    safe(() => W.LGCity.quality(2), undefined);   // site's lowest-cost quality level
  };
  enter3d();

  // Layout (re)build — on start, on town change, when hero flags change (mine/magic open)
  let layoutKey = '';
  let mapRef: CityLayout | null = null as CityLayout | null;
  let townNow = 'fair', townVia = 'default', townWant = '';
  const refreshLayout = () => {
    const h = store.hero;
    const t = currentTown(h); townNow = t.id; townVia = t.via;
    const key = `${t.id}|${!!h?.ms}|${!!(h?.mn && Object.keys(h.mn as object).length)}|${!!h?.au}|${!!h?.sg}|${styleId()}`;
    if (key === layoutKey) return;
    if (t.id !== 'fair' && t.id !== CAMP) {
      // district town: its entry of /api/city/towns (GET, the same read as the site's town picker) → towngen.js
      if (townWant === key) return;
      townWant = key;
      void townsList(true).then((list) => {
        townWant = '';
        if (currentTown(store.hero).id !== t.id) return;   // switched again meanwhile
        const meta = list.find((x) => x && x.id === t.id);
        const L = meta && buildLayout(store.hero, t.id, meta);
        if (!L) { console.warn('[legion-3d] district town not available:', t.id); return; }
        layoutKey = key; store.setLayout(L); mapRef = L;
      });
      return;
    }
    const L = buildLayout(h, t.id, null); if (!L) return;   // camp: null until campmap.js is loaded (the City rebuilds → refresh)
    layoutKey = key; store.setLayout(L); mapRef = L;
  };
  const refreshAll = () => { refreshLayout(); hwNpcGrid(mapRef, store.hero); };
  refreshLayout();
  // the site lazy-loads hwnpc.js once the night starts: re-check the NPC grid now and then (a boolean compare when unchanged)
  const hwTimer = window.setInterval(() => hwNpcGrid(mapRef, store.hero), 2000);
  // the site builds a new town asynchronously (townPrep loads campmap.js / towngen.js, then open()): watch the City root
  let townObs: MutationObserver | null = null;
  {
    const root = document.querySelector('#tab-city');
    if (root && typeof MutationObserver === 'function') {
      let pend = 0;
      townObs = new MutationObserver(() => { if (!pend) pend = window.setTimeout(() => { pend = 0; refreshLayout(); }, 150); });
      townObs.observe(root, { childList: true });   // root.innerHTML = shell / «Город строится…»: direct children only (cheap)
    }
  }

  /* ---------------- walkers ---------------- */
  const sims = store.walkers as Map<string, Sim>;
  // players this user ignores in the chat (city enter → ign; /api/city/chat/ignore answers → ign): no bubbles
  const chatIgn = new Set<string>();
  const setIgn = (list: unknown[]) => { chatIgn.clear(); for (const l of list) chatIgn.add(String(l).toLowerCase()); };
  const myLogin = String(me.user.login).toLowerCase();
  const M = W.LGCityMap;
  const siteMap = () => safe(() => (mapRef && M && (mapRef as any)) || null, null);
  // LGCityMap.follow wants the site map object (path/free/clear). Our layout wraps those functions — enough for follow().
  // One wrapper per layout (was: three closures + an object per move message).
  let mapLikeOf: CityLayout | null = null, mapLike: { path: (a: any, b: any) => any; free: (x: number, y: number) => boolean; clear: (a: any, b: any) => boolean } | null = null;
  const follow = (w: Sim, fx: number, fy: number, tx: number, ty: number, ago: number, fresh: boolean) => {
    const L = siteMap();
    if (!L || !M?.follow || !L.path) { w.x = tx; w.y = ty; w.path = null; return; }
    if (mapLikeOf !== L || !mapLike) { mapLikeOf = L; mapLike = { path: (a, b) => L.path!(a, b), free: (x, y) => L.free(x, y), clear: (a, b) => clearLine(L, a, b) }; }
    try {
      const r = M.follow(mapLike, [w.x, w.y], [fx, fy], [tx, ty], ago, { fresh });
      w.x = r.x; w.y = r.y; w.path = r.path; w.lag = r.lag;
      if (r.fade) w.alpha = 0;
    } catch { w.x = tx; w.y = ty; w.path = null; }
  };
  const addOrUpdate = (e: any) => {
    const l = String(e.l || '').toLowerCase(); if (!l || l === myLogin) return;
    let w = sims.get(l), fresh = false;
    if (!w) {
      const [nx, ny] = mapRef ? mapRef.nearest(+e.x || 0, +e.y || 0) : [+e.x || 0, +e.y || 0];
      w = { login: l, app: appearanceFn(l, e, lookStyle(e?.lk, styleId())), x: nx, y: ny, face: 0, speed: 0, alpha: 0, path: null, lag: 0, raw: e, vx: 0, vy: 0, lookKey: lookKeyOf(e) };
      sims.set(l, w); fresh = true; store.emit('walkers');
    } else {
      const k = lookKeyOf(e);   // one stringify per update (was two)
      if (k !== w.lookKey) { w.lookKey = k; w.raw = e; w.app = appearanceFn(l, e, lookStyle(e?.lk, styleId())); store.emit('walkers'); }
    }
    follow(w, +e.x, +e.y, +(e.tx ?? e.x), +(e.ty ?? e.y), +e.dt || 0, fresh);
  };
  const applyBatch = (d: any) => {
    if (!d || typeof d !== 'object') return;
    for (const l of d.g || []) { if (sims.delete(String(l).toLowerCase())) store.emit('walkers'); }
    for (const e of d.a || []) addOrUpdate(e);
    for (const m of d.m || []) {
      const w = sims.get(String(m[0]).toLowerCase()); if (!w) continue;
      follow(w, +m[1], +m[2], +m[3], +m[4], +m[5] || 0, false);
    }
    if (d.n != null) store.setOnline(+d.n + 1);
    if (Array.isArray(d.chat)) {
      const fresh = store.pushChat(d.chat.map(toChat));
      const now = Date.now();
      const chatOn = !!(store.hero as any)?.cc;   // the site: no chat (and no bubbles) without the hero's cc flag
      for (const m of fresh) {
        if (!chatOn || !bubbleFor(m, chatIgn, now)) continue;
        const w = m.login.toLowerCase() === myLogin ? store.me : sims.get(m.login.toLowerCase());
        if (w) w.bubble = { text: m.text.length > 90 ? m.text.slice(0, 89) + '…' : m.text, until: now + Math.min(9000, 4000 + m.text.length * 50), id: m.id };
      }
    }
    if (Array.isArray(d.chatDel)) {
      store.deleteChat(d.chatDel.map(String));
      const del = d.chatDel as unknown[];
      const me0 = store.me; if (me0?.bubble && del.includes(me0.bubble.id)) me0.bubble = undefined;
      for (const w of sims.values()) if (w.bubble && del.includes(w.bubble.id)) w.bubble = undefined;
    }
  };
  const onEnter = (r: any) => {
    if (!r || !r.ok) return;
    if (Array.isArray(r.ign)) setIgn(r.ign);
    // the site rebuilt its City (tab switch, mine sleep/wake, visibility re-enter): its new instance draws others again
    if (!classic) enter3d();
    sims.clear(); store.emit('walkers');
    if (Array.isArray(r.chat)) store.pushChat(r.chat.map(toChat));
    if (r.me && store.me) { store.me.x = +r.me.x; store.me.y = +r.me.y; }
    refreshAll();
    applyBatch({ ...r, chat: undefined });
  };

  // me (our own walker): position comes from the game, appearance from the hero
  const heroApp = (h: Hero) => appearanceFn(myLogin, { ...h, n: h.name, lv: h.level, lk: (h.wardrobe?.cur && Object.keys(h.wardrobe.cur).length ? h.wardrobe.cur : h.look), g: h.gear, gh: h.ghost ? 1 : 0 }, lookStyle((h.wardrobe?.cur && Object.keys(h.wardrobe.cur).length ? h.wardrobe.cur : h.look), styleId()));
  const startPos = safe(() => W.LGCity.debug()?.me as [number, number] | undefined, undefined);
  store.setMe({ login: myLogin, app: heroApp(me.hero), x: startPos ? startPos[0] : ((mapRef as CityLayout | null)?.QW ?? 1800) + 660, y: startPos ? startPos[1] : 1010, face: 0, speed: 0, alpha: 1, me: true });

  // Our own look: replace store.me.app (and wake the 'walkers' listeners) only when it really changed —
  // the hero arrives on every 'me' SSE event (coins, hp…), most of them do not touch the look.
  let meAppKey = store.me ? JSON.stringify(store.me.app) : '';
  const setMeApp = (app: Appearance) => {
    if (!store.me) return;
    const k = JSON.stringify(app); if (k === meAppKey) return;
    meAppKey = k; store.me.app = app; store.emit('walkers');
  };

  const unsubs: (() => void)[] = [];
  if (B) {
    unsubs.push(B.on('sse:city', (d) => applyBatch(d)));
    unsubs.push(B.on('city:state', (d) => { if (d && d.ok) applyBatch(d); }));
    unsubs.push(B.on('city:enter', (d) => onEnter(d)));
    unsubs.push(B.on('city:ignore', (d) => { if (d && d.ok && Array.isArray(d.ign)) setIgn(d.ign); }));   // needs the bridge WATCH entry
    const onHero = (d: any) => {
      const h = d && (d.hero || (d.login ? d : null)); if (!h) return;
      store.setHero(h);
      setMeApp(heroApp(h));
      refreshAll();
    };
    unsubs.push(B.on('sse:me', onHero));
    unsubs.push(B.on('me', onHero));
    unsubs.push(B.on('hero:act', onHero));
    unsubs.push(B.on('sse:q', (q) => store.setQuest(q)));
    if (B.last['sse:q']) store.setQuest(B.last['sse:q']);
    if (B.last['city:enter']) onEnter(B.last['city:enter']);
  }
  // Fallback snapshot: the site holds walkers privately; peek() gives positions (no looks) — fetch state once for full data.
  if (!sims.size) {
    const st = await api<any>('/api/city/state');
    if (st && st.ok) applyBatch(st);
  }
  if (me.ql) store.setQuest(me.ql);

  /* ---------------- own movement → site ---------------- */
  // throttled LGCity.go(); every point is projected onto the walk grid first (the 3D hero may stand on a roof or
  // fly over the canal — src/flight/sendpoint.ts)
  const sender = createGoSender({
    go: (x, y) => safe(() => W.LGCity.go(x, y), undefined),
    map: () => mapRef,
    // LGCity.go() closes an open building interior (goPoint → closePanel): never move while one is shown
    canSend: () => !anyShown('.cy-room'),
    now: () => performance.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => clearTimeout(id),
    minMs: GO_MS,
  });
  /** Inside our own 3D rooms the street hero must not move: drop pending go and ignore moveTo until resumed. */
  const pauseMoves = (on: boolean) => sender.pause(on);
  const flush = () => sender.flush();
  const moveTo = (x: number, y: number) => { if (!classic) sender.move(x, y); };

  /* ---------------- overlays (site interiors, mine, trade, dialogs) ---------------- */
  let ovAt = 0, ovVal: string | null = null;
  const overlay = (): string | null => {
    const t = performance.now(); if (t - ovAt < 250) return ovVal; ovAt = t;
    ovVal = anyShown('.cy-room') ? 'room' : anyShown('.mn') ? 'mine' : anyShown('.tr-win') ? 'trade'
      : anyShown('.mn-board-w') ? 'board' : anyShown('.cy-read') ? 'read' : anyShown(DIALOGS) ? 'dialog' : null;
    return ovVal;
  };
  const closeOverlay = () => {
    const x = document.querySelector<HTMLButtonElement>('.cy-room:not([hidden]) [data-cyexit]') || document.querySelector<HTMLButtonElement>('.mn [data-mn-exit]');
    if (x && shown(x)) { x.click(); ovAt = 0; return; }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  };

  /* ---------------- classic panels ---------------- */
  const setClassic = (on: boolean) => {
    if (classic === on) return; classic = on;
    if (on) {
      flush();
      document.documentElement.classList.remove('l3d-on');
      safe(() => W.LGCity.hideOthers(wasHidden), undefined);
      // back to the site's own quality: the user's forced level (localStorage lgCityQ, as city.js reads it) or auto
      safe(() => { const v = localStorage.getItem('lgCityQ'); W.LGCity.quality(/^[012]$/.test(v || '') ? +v! : null); }, undefined);
    } else {
      if (!document.querySelector('#tab-city.on')) document.querySelector<HTMLButtonElement>('.tabs button[data-tab="city"]')?.click();
      enter3d();
      // the hero may have walked in the 2D city meanwhile: continue from where the site has it
      const p = safe(() => W.LGCity.debug()?.me as [number, number] | undefined, undefined);
      if (p && store.me && Math.hypot(p[0] - store.me.x, p[1] - store.me.y) > 40) { store.me.x = p[0]; store.me.y = p[1]; sender.reset(); }
    }
  };

  const actions: Actions = {
    equip: (uid) => post('/api/equip', { uid }),
    unequip: (slot) => post('/api/unequip', { slot }),
    use: (uid) => post('/api/use', { uid }),
    wear: (field, value) => post('/api/wear', { field, value }),
    say: (text, o) => api<ApiResult>('/api/city/say', { text, ...(o?.k ? { k: o.k } : {}), ...(o?.to ? { to: o.to } : {}) }),
    get: (p) => api(p),
    post: (p, b) => api(p, b),
    // send the last position first (a delayed go would land after the panel opened and close it), then enter
    openBuilding: (id) => { flush(); safe(() => W.LGCity.panel(id), undefined); ovAt = 0; },
    openSitePanel: (spec) => {
      const [tab, view] = String(spec).split(':');
      setClassic(true);
      document.querySelector<HTMLButtonElement>(`.tabs button[data-tab="${tab}"]`)?.click();
      if (view) setTimeout(() => document.querySelector<HTMLButtonElement>(`[data-view="${view}"]`)?.click(), 300);
      W.dispatchEvent(new CustomEvent('l3d:classic', { detail: { on: true, tab } }));
    },
  };
  async function post(p: string, b: unknown): Promise<ApiResult> {
    const r = await api<ApiResult>(p, b);
    if (r && r.ok && r.hero) { store.setHero(r.hero); setMeApp(heroApp(r.hero)); }
    return r || { ok: false, error: 'нет ответа' };
  }

  /* ---------------- per-frame tick ---------------- */
  const tick = (dt: number) => {
    if (!M?.stepAlong) return;
    const now = Date.now();
    for (const w of sims.values()) {
      if (w.alpha < 1) w.alpha = Math.min(1, w.alpha + dt * 4);
      if (w.bubble && w.bubble.until < now) w.bubble = undefined;
      if (!w.path) { w.speed = 0; continue; }
      const ox = w.x, oy = w.y;
      const r = M.stepAlong(w, Math.min(2, dt));
      w.x = r.x; w.y = r.y; w.path = r.path; w.lag = r.lag;
      const dx = w.x - ox, dy = w.y - oy;
      if (dx * dx + dy * dy > 0.01) { w.face = faceOf(dx, dy); w.speed = Math.hypot(dx * SX, dy * SZ) / Math.max(1e-3, dt) / SX; } else w.speed = 0;
    }
    const me2 = store.me; if (me2?.bubble && me2.bubble.until < now) me2.bubble = undefined;
  };

  const art = (): ArtProvider | null => null;   // facades are rasterized by src/world from layout.art when present

  const onVis = () => { /* site handles leave/enter on visibility itself */ };
  // which town the 3D world shows and how it was detected (debug panel, e2e/live.mjs, e2e/contract.mjs)
  const townInfo = () => ({ id: townNow, via: townVia, layout: mapRef?.id ?? null });
  W.__l3dTown = townInfo;
  document.addEventListener('visibilitychange', onVis);

  return {
    store: store as Store, actions, moveTo, pauseMoves, art, setClassic, tick, overlay, closeOverlay,
    selfPos: () => (store.me ? [store.me.x, store.me.y] : null),
    dispose() {
      for (const u of unsubs) u();
      townObs?.disconnect();
      clearInterval(hwTimer);
      if (W.__l3dTown === townInfo) delete W.__l3dTown;
      document.removeEventListener('visibilitychange', onVis);
      setClassic(true); style.remove();
    },
  };
}

/* ------------------------------------------------------------------ overlay detection */
/** Site dialogs that may cover the game. Our own UI (#l3d-*) and the town picker inside the hidden 2D view are excluded below. */
const DIALOGS = '.su-layer, dialog[open], [role="dialog"], [aria-modal="true"]';
const OWN = '#l3d-host, #l3d-ui, #l3d-splash, .cy-view';
/** Really on screen: connected, not [hidden], rendered, not visibility:hidden (incl. inherited — e.g. our HIDE_CSS), has a box. */
export function shown(e: Element | null): boolean {
  if (!e || !e.isConnected || (e as HTMLElement).hidden) return false;
  const el = e as HTMLElement & { checkVisibility?: (o?: object) => boolean };
  if (typeof el.checkVisibility === 'function') {
    if (!el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })) return false;
  } else if (getComputedStyle(el).visibility === 'hidden') return false;
  const r = el.getBoundingClientRect();
  return r.width > 2 && r.height > 2;
}
function anyShown(sel: string): boolean {
  const list = document.querySelectorAll(sel);
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (sel === DIALOGS && (e.closest(OWN) || e.matches('.cy-room, .mn, .mn-board-w, .tr-win'))) continue;
    if (shown(e)) return true;
  }
  return false;
}

/** Straight-line walkability (6 px steps) — same rule as citymap.js clear(). */
function clearLine(L: CityLayout, a: [number, number], b: [number, number]): boolean {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(d / 6));
  for (let i = 1; i < n; i++) { const t = i / n; if (!L.free(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false; }
  return L.free(b[0], b[1]);
}

export type { StoreWriter };
