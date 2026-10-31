/**
 * «Тюрьма и клетка» (site 30.10, flag legionary.jailPublic) in the 3D City.
 *
 * The building and the cage are street models (src/world/jail.ts), the prisoners in the cage are walkers of the site
 * adapter on LOW.jail.seats (src/net/site.ts syncJail). Here:
 *  - E on the jail / the cage / a prisoner (the door interactable covers all three, src/world/worldExt.ts) → the site's own
 *    Jail window (LGCity.jailOpen: who sits and until when; the reason only for staff), lifted above our canvas, with a modal
 *    on our input while it is open (pointer free, Esc closes it). Only on the player's action — nothing is sent by us; the
 *    window itself re-reads GET /api/jail like on the site;
 *  - the hero is a prisoner (/api/me `jail`): like the site — only the City (rooms refuse, travel refuses, the site itself
 *    keeps every other tab closed), the hero stands in the cage on the first seat and cannot walk (src/content/game.ts sends
 *    nothing while `state.jailed`), and the status «Ты в тюрьме канала · Причина: … · Выйдешь: …» is on screen: the site's own
 *    `.jail-bar` lifted above the canvas, or ours with the same text when the site's is not there. Released → everything back,
 *    the hero steps out next to the jail door (city.js does the same).
 * Without the site's jail (old site, dev pages without ?jail) nothing here does anything.
 */
import type { CityLayout } from '../contracts';
import type { CoreContext } from '../core/context';
import { setModal, type ModalInput } from '../core/modal';
import { jailBar, jailGeoOf, type JailHub, type JailState } from '../net/jail';
import { coreFeature } from './types';

export const JAIL_CSS_ID = 'l3d-jail-css';
/** The site's Jail window (inside the City, under our canvas) and the prisoner's bar go above our canvas and UI (150). */
export const JAIL_CSS = [
  'html.l3d-on .cy-jw{position:fixed!important;z-index:172!important;visibility:visible!important;pointer-events:auto!important}',
  'html.l3d-on .cy-jw *{visibility:visible}',
  'html.l3d-on .jail-bar{z-index:171!important;visibility:visible!important}',
  '#l3d-jail-bar{position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:171;display:flex;flex-wrap:wrap;gap:4px 14px;align-items:baseline;justify-content:center;max-width:calc(100vw - 24px);padding:8px 16px;border-radius:14px;background:rgba(29,22,32,.92);box-shadow:0 0 0 1.5px #c9a33a,0 8px 22px #0008;color:#f7eadf;font:600 13.5px/1.3 Nunito,system-ui,sans-serif;pointer-events:none}',
  '#l3d-jail-bar b{font:400 15px/1.2 "Russo One",system-ui,sans-serif;color:#ffd27a;letter-spacing:.5px}',
].join('\n');
export const JAIL_MODAL_ID = 'site:jail';
export const JAIL_NO_ROOM = 'Ты в тюрьме канала — в здания нельзя';

/** The jail hub of the site session (src/net/site.ts), if the site has the jail. */
export const jailHubOf = (ctx: Pick<CoreContext, 'site'>): JailHub | null => {
  const h = (ctx.site as unknown as { jail?: JailHub }).jail;
  return h && typeof h.get === 'function' && typeof h.on === 'function' ? h : null;
};

/** The cage seat of a prisoner's own hero (px) on this layout, or null (no jail here: district towns, the camp). */
export function mySeat(L: CityLayout | null, st: JailState): [number, number] | null {
  if (!st.me || !L || L.id !== 'fair') return null;
  const b = L.buildings.find((x) => x.jail || x.id === 'jail');
  const J = b ? jailGeoOf(b, L.low) : null;
  return J && J.seats[0] ? [J.seats[0][0], J.seats[0][1]] : null;
}

export default coreFeature({
  id: 'jail',
  order: 45,   // after doors (40): the door of the jail exists; before labels
  setup(ctx) {
    const hub = jailHubOf(ctx);
    if (!hub) return;
    const doc = document;
    const offs: (() => void)[] = [];
    const st0 = doc.createElement('style'); st0.id = JAIL_CSS_ID; st0.textContent = JAIL_CSS; doc.head.appendChild(st0);
    offs.push(() => st0.remove());

    /* ---- prisoner mode ---- */
    let ownBar: HTMLElement | null = null, wasJailed = false;
    const drawBar = (st: JailState) => {
      const want = !!st.me && !doc.getElementById('jailBar') && !doc.querySelector('.jail-bar');
      if (!want) { ownBar?.remove(); ownBar = null; return; }
      const b = jailBar(st.me!);
      if (!ownBar) { ownBar = doc.createElement('div'); ownBar.id = 'l3d-jail-bar'; ownBar.setAttribute('role', 'status'); doc.body.appendChild(ownBar); }
      ownBar.replaceChildren();
      const t = doc.createElement('b'); t.textContent = b.title; ownBar.appendChild(t);
      for (const s of [b.reason, b.term]) if (s) { const e = doc.createElement('span'); e.textContent = s; ownBar.appendChild(e); }
    };
    const apply = (st: JailState) => {
      const on = !!st.me;
      ctx.state.jailed = on;
      if (on && ctx.rooms.current) ctx.rooms.exit();
      if (on && !wasJailed) { ctx.ui.open(null); ctx.ui.toast('Ты в тюрьме канала: только «Город», ходить и заходить в здания нельзя', true); }
      if (!on && wasJailed) {
        // released: out of the cage, next to the jail door (city.js), and the City is open again
        const L = ctx.layout(), b = L?.buildings.find((x) => x.jail || x.id === 'jail');
        if (b) { const [x, y] = L.nearest(b.door.x + 120, b.door.y); ctx.controller().teleport(x, y); ctx.me.x = x; ctx.me.y = y; ctx.applyCamera(true); }
        ctx.ui.toast('Тебя выпустили из тюрьмы канала');
      }
      wasJailed = on;
      drawBar(st);
    };
    offs.push(hub.on(apply));
    apply(hub.get());
    offs.push(ctx.rooms.guard((id) => (ctx.state.jailed && id !== 'jail' ? JAIL_NO_ROOM : null)));
    // the hero stays on his seat (teleports, «Идти сюда», a town rebuild): put back when he is off it
    offs.push(ctx.onFrame(() => {
      if (!ctx.state.jailed || ctx.state.inRoom) return;
      const seat = mySeat(ctx.layout(), hub.get()); if (!seat) return;
      const c = ctx.controller();
      if (Math.abs(c.x - seat[0]) > 3 || Math.abs(c.y - seat[1]) > 3 || c.walking) {
        c.teleport(seat[0], seat[1]); c.setFace(Math.PI); ctx.me.x = seat[0]; ctx.me.y = seat[1];
      }
    }));

    /* ---- the site's Jail window: modal on our input while it is open ---- */
    let modal = false;
    const win = () => doc.querySelector<HTMLElement>('.cy-jw');
    const sync = () => {
      const on = !!win();
      if (!ownBar === !!(hub.get().me && !doc.querySelector('.jail-bar'))) drawBar(hub.get());   // the site's bar came / went
      if (on === modal) return;
      modal = on;
      setModal(ctx.input as unknown as ModalInput, JAIL_MODAL_ID, on, () => { win()?.querySelector<HTMLElement>('[data-jw-x]')?.click(); });
    };
    const timer = window.setInterval(sync, 400);
    offs.push(() => window.clearInterval(timer));
    offs.push(ctx.rooms.onChange(() => setTimeout(sync, 60)));

    return () => {
      for (const u of offs.splice(0)) { try { u(); } catch { /* */ } }
      if (modal) setModal(ctx.input as unknown as ModalInput, JAIL_MODAL_ID, false);
      ownBar?.remove(); ctx.state.jailed = false;
    };
  },
});
