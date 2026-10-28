/**
 * Live channel-style change (site 28.10, fix/style-live). The streamer may switch the channel style on the fly; every open
 * page of the channel gets the server's SSE event «style», and the site (app.js siteRestyle) loads the new /doodle.js,
 * MDDoodle.use(style), redraws, CLOSES and reopens its City (LGCity.close(); openCity()), and dispatches the document event
 * 'lg-style' { style }. No page reload, so we must follow without one:
 *   1. the site session (src/net/site.ts `restyle`) re-resolves every look (walkers, own hero; a personal style `lk.ps` is
 *      kept), rebuilds the layout key (style is part of it → the 3D world is rebuilt: camp «Кошачий привал» / «Чёртов
 *      привал» / «Перепутье» + its theme, palette) and re-hides the reopened 2D City (hideOthers, low quality);
 *      the crowd feature then re-dresses the avatars and the view-model on 'walkers';
 *   2. here: the UI re-reads the site's skin (html[data-skin], CSS variables — src/ui reskin), a 3D shop / hybrid room we
 *      are in is re-entered in the new style once the new layout is in (the site closed its own building panel when it
 *      closed the City), a toast «Стиль канала: X», and the window event 'l3d:style' { style, prev } for other modules.
 * Triggers: 'lg-style' (the main one); the bus 'sse:style' (if the bridge tees it) and a cheap 3 s check of
 * MDDoodle.active are a safety net — both only act when the style the site draws in really changed.
 * Styles our avatars do not know (monkeys, ugabugi, veggies, 42brothers) are drawn with the legion rules (src/avatar
 * appearance.ts rulesFor); the camp / shops fall back to their default look. Zero requests of our own.
 */
import type { Appearance } from '../contracts';
import type { CoreContext } from '../core/context';
import { coreFeature } from './types';
import { restyleApps, lookStyle, siteDefaults } from '../net/site';
import { appearanceFrom } from '../avatar';

/** site-ui.js STYLES (28.10): the 7 channel styles in the site's order. */
export const STYLE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  legion: 'Легион', cats: 'Котики', monkeys: 'Обезьяны', veggies: 'Овощи', '42brothers': '42 Братухи', cherts: 'Чертики', ugabugi: 'Уга-Буги',
});
/** site-ui.js STYLE_SKIN: style → site skin (html[data-skin]); no style → «Арсенал» (forge). */
export const STYLE_SKIN: Readonly<Record<string, string>> = Object.freeze({
  legion: 'forge', cats: 'den', monkeys: 'rage', veggies: 'garden', '42brothers': 'club', cherts: 'inferno', ugabugi: 'cave',
});
export const skinOf = (style: string): string => STYLE_SKIN[style] || 'forge';
export const STYLE_EVENT = 'l3d:style';
const STYLE_RE = /^[\w-]{1,30}$/;
export const validStyle = (s: unknown): s is string => typeof s === 'string' && STYLE_RE.test(s);
/** The avatar rules our 3D characters use for a style (src/avatar/appearance.ts rulesFor): own for cats / cherts, else legion. */
export const avatarRules = (style: string): 'cats' | 'cherts' | 'legion' => (style === 'cats' || style === 'cherts' ? style : 'legion');

/** Human name of a style: the site's own (MDDoodle.styles[id].name), then the site-ui table, then the id. */
export function styleName(style: string, D?: any): string {
  let n = '';
  try { n = String(D?.styles?.[style]?.name || '').replace(/[<>]/g, '').trim().slice(0, 40); } catch { /* hostile getter */ }
  return n || STYLE_NAMES[style] || style;
}
/** Toast text after a change. */
export const styleToast = (style: string, D?: any) => `Стиль канала: ${styleName(style, D)}`;

/**
 * Must the room we stand in be re-entered after a style change? The hybrid room: always (the site closed its building
 * panel together with the City); a 3D shop: its palette, keeper and themes (src/rooms/shop/style.ts) follow the style.
 * The mine and other kinds keep running (they are not built from the street layout's style).
 */
export const reenterRoom = (kind: string | null, prev: string, next: string): boolean =>
  !!kind && prev !== next && (kind === 'hybrid' || kind === 'shop3d');

/** The style the site draws in now (MDDoodle.active), or ''. */
const pageStyle = (): string => { try { const a = (window as any).MDDoodle?.active; return validStyle(a) ? a : ''; } catch { return ''; } };

export default coreFeature({
  id: 'restyle',
  order: 215,
  setup(ctx: CoreContext) {
    const W = window as any;
    const { store, rooms } = ctx;
    let cur = pageStyle() || String(ctx.layout()?.styleId || '');
    let disposed = false;
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => { const t = window.setTimeout(() => { timers.delete(t); if (!disposed) fn(); }, ms); timers.add(t); };

    /** Dev fakes (no site session `restyle`): re-dress the walkers we have and the own hero, swap the layout's style. */
    const fallback = (st: string) => {
      const S = store as unknown as { emit?(e: string): void; setLayout?(L: unknown): void };
      restyleApps(store.walkers.values() as Iterable<{ login: string; app: Appearance; raw?: any }>, (l, raw, s) => appearanceFrom(l, raw, s, (x: string) => siteDefaults(x) as any), st);
      const me = store.me, h = store.hero as any;
      if (me) {
        const lk = h ? (h.wardrobe?.cur && Object.keys(h.wardrobe.cur).length ? h.wardrobe.cur : h.look) : me.app.look;
        const want = lookStyle(lk, st);
        me.app = h ? appearanceFrom(me.login, { ...h, n: h.name, lv: h.level, lk, g: h.gear, gh: h.ghost ? 1 : 0 }, want, (x: string) => siteDefaults(x) as any)
          : { ...me.app, styleId: want };
      }
      S.emit?.('walkers');
      const L = store.layout;
      if (L && L.styleId !== st) S.setLayout?.({ ...L, styleId: st });
    };

    /** Re-enter the room we stood in once the street layout carries the new style. */
    const reenter = (id: string, kind: string, st: string) => {
      let tries = 0;
      const go = () => {
        if (disposed || rooms.current) return;   // the player entered something else meanwhile
        if (String(store.layout?.styleId || '') !== st && tries++ < 20) { later(go, 250); return; }
        void rooms.enter(id);
      };
      later(go, kind === 'hybrid' ? 700 : 80);   // hybrid: let the reopened City finish its enter before the panel opens
    };

    const apply = (hint?: unknown) => {
      if (disposed) return;
      const st = pageStyle() || (validStyle(hint) ? hint : '');
      if (!st) return;
      const prev = cur;
      const room = rooms.current, kind = rooms.kind;
      const again = reenterRoom(kind, prev, st);
      if (again) rooms.exit();
      const r = (ctx.site as { restyle?(): boolean }).restyle;
      try { if (typeof r === 'function') r.call(ctx.site); else fallback(st); } catch (e) { console.warn('[l3d] restyle', e); }
      try { ctx.uiApi.reskin?.(); } catch (e) { console.warn('[l3d] reskin', e); }
      cur = st;
      if (again && room && kind) reenter(room, kind, st);
      if (prev !== st) {
        // the toast after the 3D world is rebuilt in the new style (a rebuild stalls the frame and would eat most of it)
        let shown = false, offW: (() => void) | null = null;
        const show = () => { if (shown || disposed) return; shown = true; try { offW?.(); } catch { /* */ } ctx.ui.toast(styleToast(st, W.MDDoodle)); };
        if (typeof ctx.onWorld === 'function' && store.layout && store.layout.styleId !== prev) { offW = ctx.onWorld(() => later(show, 150)); later(show, 4000); }
        else show();
        try { window.dispatchEvent(new CustomEvent(STYLE_EVENT, { detail: { style: st, prev, skin: skinOf(st), rules: avatarRules(st) } })); } catch { /* */ }
      }
    };

    const onLg = (e: Event) => apply((e as CustomEvent).detail?.style);
    document.addEventListener('lg-style', onLg);
    const bus = W.__L3D_BUS as { on(t: string, fn: (d: any) => void): () => void } | undefined;
    // the SSE event comes before the site has the new bundle: look again later, act only if 'lg-style' did not come
    const offBus = bus?.on?.('sse:style', () => later(() => { const s = pageStyle(); if (s && s !== cur) apply(s); }, 6000));
    const poll = window.setInterval(() => { const s = pageStyle(); if (s && cur && s !== cur) apply(s); else if (s && !cur) cur = s; }, 3000);

    return () => {
      disposed = true;
      document.removeEventListener('lg-style', onLg);
      try { offBus?.(); } catch { /* */ }
      clearInterval(poll);
      for (const t of timers) clearTimeout(t);
      timers.clear();
    };
  },
});
