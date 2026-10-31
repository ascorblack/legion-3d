/**
 * «Путешествие» (tab «Дорога» — a longer label overflows the ribbon at 1280 px with every tab unlocked) — change town or channel without leaving the 3D game (hotkey L, the «Мир» ribbon, the pause menu).
 *
 *   Города  the site's own town picker as a 3D menu page (src/ui/travel.ts): Ярмарка, the camp («Кошачий привал» in the
 *           cat style, «Перепутье» elsewhere), district towns. A click calls `LGCity.town(id)` — the same function the
 *           site's picker button calls — and the world rebuilds itself through the town detection (src/net/site.ts):
 *           veil «Дорога в …», new layout, the hero put where the site has him (or at the spawn), the chat/crowd of the new town.
 *   Каналы  the own list + the streamer search of the site's start.js; a pick → «Перейти на канал?» → /c/<login>/.
 *
 * Requests (all on an explicit action of the player, never in the background, never as the account except where the site
 * itself does it): GET /api/city/towns when the page opens (cached 30 s), GET /api/mylist when «Каналы» opens,
 * GET /api/find?q= while typing (≥ 2 characters, 450 ms debounce, old request aborted), and — only for a channel picked in
 * the search results, exactly like start.js — POST /api/mylist {act:'open'} just before the navigation.
 * Off switch: Настройки → Прочее → «Путешествие».
 */
import type { CityLayout } from '../contracts';
import type { Channel } from '../net/travel';
import { channelPath, currentChannel } from '../net/travel';
import { campName, pageCampName, FAIR, CAMP, type HeroTownFlags, type TownRow } from '../net/town';
import { runtimeContract, type ContractCheck } from '../net/contract';
import CONTRACT from '../data/site-contract.json';
import { mountTravel, type TravelPanelDeps } from '../ui/travel';
import { registerPauseItem, registerSettingRow, settingValue } from '../ui/settings-ext';
import { coreFeature } from './types';

export const TRAVEL_KEY = 'l3d.travel';
export const TRAVEL_HOTKEY = 'KeyL';
const W = globalThis as any;
const TOWNS_TTL = 30_000, ARRIVE_TIMEOUT = 12_000;
/** Contract checks the travel page leans on (src/data/site-contract.json). */
export const TRAVEL_CHECKS = ['LGCity.town (travel)', 'DOM .cy-town (town picker button)', 'DOM .cy-tp (town picker window)'];

/** Where a layout is called in the UI: the camp by the channel's style, the fair, a district town by its name. */
export function layoutName(L: Pick<CityLayout, 'id' | 'styleId'> & { title?: string }, cached?: string): string {
  if (L.id === FAIR) return 'Ярмарка';
  if (L.id === CAMP) return campName(L.styleId, W.MDDoodle?.names).name;
  return cached || String(L.title || L.id);
}

export default coreFeature({
  id: 'travel',
  order: 240,
  setup(ctx) {
    const offs: Array<() => void> = [];
    let townsAt = 0, townsP: Promise<unknown> | null = null, townsRaw: any = null;
    let busy = false;

    const base = () => String(W.LG_BASE || '');
    const getJson = async (path: string) => { try { return await ctx.actions.get(path); } catch { return null; } };
    const towns = (force?: boolean): Promise<unknown> => {
      if (!force && townsRaw && Date.now() - townsAt < TOWNS_TTL) return Promise.resolve(townsRaw);
      if (!force && townsP) return townsP;
      const p = getJson('/api/city/towns').then((r) => { if (r && (r as any).ok) { townsRaw = r; townsAt = Date.now(); } return r; });
      townsP = p; void p.then(() => { if (townsP === p) townsP = null; });
      return p;
    };
    const fetchFind = async (q: string, signal: AbortSignal | null) => {
      const r = await fetch(base() + '/api/find?q=' + encodeURIComponent(q), { credentials: 'same-origin', ...(signal ? { signal } : {}) });
      let data: unknown = null; try { data = await r.json(); } catch { /* not JSON */ }
      return { status: r.status, data };
    };
    const townName = (id: string) => {
      const row = (townsRaw?.list as any[] | undefined)?.find((t) => t && t.id === id);
      return row ? String(row.town || id) : '';
    };
    const lock = (): string | null => {
      if (busy) return 'Дорога уже идёт…';
      if (ctx.state.jailed) return 'Ты в тюрьме канала: дороги нет, пока не выпустят.';   // site 30.10: a prisoner has only the City
      if (typeof W.LGCity?.town !== 'function') return 'Сайт изменился: быстрый переход недоступен. Открой город на классическом сайте (F8).';
      if ((ctx.rooms as { kind?: string | null }).kind) return 'Сначала выйди из здания — тогда можно отправляться.';
      return null;
    };

    /* ------------------------------------------------------------ travel to a town */
    const siteMe = (): [number, number] | null => {
      try { const p = W.LGCity?.debug?.()?.me; return Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1]) ? [+p[0], +p[1]] : null; } catch { return null; }
    };
    /** The new world stands: put the hero where the site has him in this town (it restores a per-town position) or at the spawn. */
    const arrive = (L: CityLayout) => {
      const ctl = ctx.controller();
      let p = siteMe();
      if (!p || !L.free(p[0], p[1])) {
        const sp = (L as CityLayout & { spawn?: [number, number] }).spawn ?? [L.QW + 660, 1010];
        p = L.nearest(sp[0], sp[1]) as [number, number];
      }
      ctl.teleport(p[0], p[1]);
      ctx.me.x = p[0]; ctx.me.y = p[1];
      ctx.applyCamera(true);
    };
    const travelTo = (row: TownRow) => {
      const why = lock();
      if (why) { ctx.ui.toast(why, true); return; }
      const from = ctx.layout().id;
      if (row.id === from) { ctx.ui.toast('Ты уже здесь: ' + row.name); return; }
      busy = true;
      ctx.ui.open(null);
      ctx.veil(`Дорога в ${row.name}`);
      let timer = 0, offWorld: () => void = () => { /* */ };
      const end = () => { busy = false; clearTimeout(timer); offWorld(); };
      timer = window.setTimeout(() => { end(); ctx.veil(null); ctx.ui.toast('Не получилось добраться: город закрыт или сайт не ответил.', true); }, ARRIVE_TIMEOUT);
      offWorld = ctx.onWorld(() => {
        const L = ctx.layout();
        if (!L || L.id === from) return;             // a rebuild of the same town (flags), not the trip
        end();
        try { arrive(L); } catch (e) { console.warn('[l3d] travel: placing the hero failed', e); }
        ctx.veil(null);
        const name = layoutName(L, townName(L.id));
        ctx.ui.toast(L.id === row.id ? `Ты прибыл: ${name}` : `Ты в городе «${name}» — выбранный сейчас закрыт`, L.id !== row.id);
      });
      try { W.LGCity.town(row.id); } catch (e) { console.warn('[l3d] travel: LGCity.town failed', e); end(); ctx.veil(null); ctx.ui.toast('Переход не удался.', true); }
    };

    /* ------------------------------------------------------------ move to a channel */
    const navigate = (login: string) => {
      // the close guard («Покинуть сайт?») is for accidents — this is a deliberate move; our capture listener runs first
      window.addEventListener('beforeunload', (e) => e.stopImmediatePropagation(), true);
      location.href = channelPath(login);
    };
    const openChannel = (c: Channel, viaSearch: boolean) => {
      ctx.ui.toast(`Иду на канал ${c.name}…`);
      if (!viaSearch || !ctx.store.hero) { navigate(c.login); return; }
      // start.js: a channel picked from the search goes into the own list first (in case the tab is closed before it loads)
      let done = false;
      const go = () => { if (done) return; done = true; navigate(c.login); };
      const t = window.setTimeout(go, 2500);
      Promise.resolve(ctx.actions.post('/api/mylist', { act: 'open', ch: c.login })).then(go, go).then(() => clearTimeout(t));
    };

    /* ------------------------------------------------------------ the page */
    const deps = (): TravelPanelDeps => ({
      hotkey: 'L',
      towns,
      list: () => getJson('/api/mylist'),
      fetchFind,
      hero: () => (ctx.store.hero as unknown as HeroTownFlags) ?? null,
      currentTown: () => ctx.layout().id,
      style: () => String(ctx.layout().styleId || W.MDDoodle?.active || ''),
      names: () => W.MDDoodle?.names,
      channel: () => currentChannel(location.pathname),
      lock,
      travel: travelTo,
      openChannel,
    });
    let reported = false;
    const reportDrift = () => {
      if (reported) return; reported = true;
      const mine = (CONTRACT.checks as ContractCheck[]).filter((c) => TRAVEL_CHECKS.includes(c.id));
      for (const f of runtimeContract(mine, W, document, 'city')) ctx.drift('contract', f.id, f.missing);
    };

    let offTab: (() => void) | null = null, offPause: (() => void) | null = null;
    const apply = () => {
      const on = settingValue(TRAVEL_KEY, 'on') === 'on';
      if (on && !offTab) {
        offTab = ctx.registries.menus.register('travel', {
          title: 'Дорога', group: 'world', hotkey: TRAVEL_HOTKEY, order: 140,
          render(el) { reportDrift(); return mountTravel(el, deps()); },
        });
        offPause = registerPauseItem({ id: 'travel', label: 'Путешествие', key: 'L', order: 22, run: () => ctx.ui.open('travel') });
      } else if (!on && offTab) { offTab(); offTab = null; offPause?.(); offPause = null; }
    };
    offs.push(registerSettingRow({
      key: TRAVEL_KEY, label: 'Путешествие (клавиша L)', sub: 'страница «Города и каналы»: смена города и канала прямо из 3D; запросы идут только когда ты её открываешь или ищешь',
      group: 'Прочее', order: 40, kind: 'seg', options: [['on', 'Вкл'], ['off', 'Выкл']], def: 'on',
    }));
    const onSettings = (e: Event) => { const k = (e as CustomEvent<{ key?: string }>).detail?.key; if (!k || k === TRAVEL_KEY) apply(); };
    window.addEventListener('l3d:settings', onSettings);
    offs.push(() => window.removeEventListener('l3d:settings', onSettings));
    apply();
    // dev / e2e handle: the same code path as a click, and the camp's name for the current style
    ctx.dev.travel = { to: (id: string, name = id) => travelTo({ id, name, kind: id === FAIR ? 'fair' : id === CAMP ? 'camp' : 'district', icon: '', sub: '', current: false, disabled: false }), campName: () => pageCampName(W) };

    return () => { offTab?.(); offPause?.(); offTab = offPause = null; for (const u of offs.reverse()) { try { u(); } catch { /* */ } } };
  },
});
