/**
 * Expedition-only mode (owner bug 28.10). While the hero is IN an expedition party the site locks its «Город» tab, so
 * the launcher boots the game without a city (src/net/expedition-site.ts, startGame opts.expeditionOnly) and only the
 * features of EXP_ONLY_FEATURES run. This feature is what the player sees around the 3D expedition there:
 *
 *   - no city behind: own avatar and labels hidden, a dark backdrop, the third-person camera; src/features/expedition.ts
 *     opens the expedition view itself as soon as a running view is known (and never drops back to the empty "city");
 *   - a card when there is nothing to watch: «Ждём поход…» (no running view yet) or «Поход окончен» / «Город снова
 *     открыт» with «Вернуться в город» once the site enables its City tab again (polled 1 Hz, one querySelector);
 *     the same item in the pause menu (Esc) while the tab is open;
 *   - the «Карта» menu page says the city map comes back after the expedition (no city to draw);
 *   - «Вернуться в город» dispatches window 'l3d:return-city': src/content/main.ts disposes this game and runs the
 *     normal boot in place. F8 / «Классический сайт» works as always (classic feature).
 * In the normal (city) game this feature does nothing.
 */
import * as THREE from 'three';
import { cityTab, type CityTab } from '../net/city-tab';
import { registerPauseItem } from '../ui/settings-ext';
import { coreFeature } from './types';
import { setHtml } from '../core/html';

/** Features that run in the expedition-only game (the rest need the city world, the site's City client or walkers). */
export const EXP_ONLY_FEATURES: ReadonlySet<string> = new Set([
  'settings', 'item-models', 'menus', 'camera', 'controls', 'classic', 'quest', 'sound', 'debug', 'whatsnew',
  'closeguard', 'update', 'netstatus', 'quality-info', 'snapshot', 'compassVis', 'startMode', 'expedition', 'expedition-only',
]);

export type ExpCard = 'none' | 'wait' | 'over' | 'open';
/** Which card to show: nothing while the expedition runs and the City stays locked; «Вернуться в город» as soon as the
 *  City opens (over = the expedition ended too); «Ждём…» before the first running view. */
export function expCard(onAir: boolean, tab: CityTab, everOnAir: boolean): ExpCard {
  if (tab === 'open') return onAir ? 'open' : 'over';
  if (onAir) return 'none';
  return everOnAir ? 'over' : 'wait';
}

export const RETURN_EVENT = 'l3d:return-city';

const CSS = `
#l3d-expcard{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:118;min-width:300px;max-width:min(440px,90vw);
  padding:22px 26px 20px;border-radius:18px;background:rgba(20,15,44,.93);border:1px solid rgba(255,226,160,.35);
  box-shadow:0 14px 44px rgba(0,0,0,.5);color:#f4ecff;font:600 15px/1.4 'Golos Text','Nunito',sans-serif;text-align:center;pointer-events:auto}
#l3d-expcard[hidden]{display:none}
#l3d-expcard.mini{top:auto;bottom:96px;transform:translateX(-50%);padding:14px 18px 14px}
#l3d-expcard.mini p{display:none}
#l3d-expcard h2{margin:0 0 6px;font:800 21px/1.2 'Golos Text','Nunito',sans-serif;color:#ffe9a8}
#l3d-expcard p{margin:0 0 16px;color:#d8cff0}
#l3d-expcard .bar{height:5px;margin:-4px auto 16px;max-width:220px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden}
#l3d-expcard .bar i{display:block;height:100%;width:40%;background:linear-gradient(90deg,#b06bff,#ffc94d);border-radius:3px;animation:l3dxbar 1.3s ease-in-out infinite}
@keyframes l3dxbar{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
@media (prefers-reduced-motion:reduce){#l3d-expcard .bar i{animation:none;width:100%;opacity:.5}}
#l3d-expcard .r{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
#l3d-expcard button{font:800 15px/1 'Golos Text','Nunito',sans-serif;padding:11px 18px;border-radius:12px;border:0;cursor:pointer;background:#ffd36b;color:#2a1a08}
#l3d-expcard button.g{background:transparent;color:#f4ecff;border:1px solid rgba(255,255,255,.35)}
#l3d-expcard button:focus-visible{outline:3px solid #fff;outline-offset:2px}
`;

const TEXT: Record<Exclude<ExpCard, 'none'>, [string, string]> = {
  wait: ['Ты в отряде похода', 'Город закрыт, пока идёт поход. Ждём картинку похода со стрима…'],
  over: ['Поход окончен', 'Город откроется, как только сайт его разблокирует.'],
  open: ['Город снова открыт', 'Можно вернуться в 3D-город.'],
};

export default coreFeature({
  id: 'expedition-only',
  order: 83,   // after the expedition (82)
  setup(ctx) {
    if (!ctx.state.expeditionOnly) return;
    const W = window as any;
    // no city: hide the own avatar and labels, dark backdrop, third person (the view-model only shows in first person)
    ctx.meAv.root.visible = false; ctx.labels.root.visible = false;
    ctx.scene.background = new THREE.Color(0x0d0b22); ctx.scene.fog = null;
    ctx.state.mode = 'tp'; ctx.applyCamera(true);
    // the street compass points at buildings of a city that is not there (compassVis only hides it while the view is open)
    let compass: HTMLElement | null = null;
    const hideCompass = () => {
      if (compass?.isConnected) return;
      compass = ctx.uiRoot.querySelector('.l3d-ui')?.shadowRoot?.querySelector<HTMLElement>('.compass') ?? null;
      if (compass) compass.style.display = 'none';
    };
    hideCompass();

    const st = document.createElement('style'); st.id = 'l3d-expcard-css'; st.textContent = CSS; document.head.appendChild(st);
    const card = document.createElement('div'); card.id = 'l3d-expcard'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-live', 'polite');
    setHtml(card, '<h2></h2><p></p><div class="bar" aria-hidden="true"><i></i></div><div class="r"><button type="button" data-a="city">Вернуться в город</button><button type="button" class="g" data-a="classic">Классический сайт (F8)</button></div>');
    card.hidden = true;
    ctx.uiRoot.append(card);
    const h2 = card.querySelector('h2')!, p = card.querySelector('p')!;
    const bar = card.querySelector<HTMLElement>('.bar')!;
    const cityBtn = card.querySelector<HTMLButtonElement>('[data-a="city"]')!;
    const goCity = () => { W.dispatchEvent(new CustomEvent(RETURN_EVENT)); };
    cityBtn.onclick = goCity;
    card.querySelector<HTMLButtonElement>('[data-a="classic"]')!.onclick = () => ctx.game.toClassic();

    let onAir = !!(ctx.dev.expedition as { onAir?: boolean } | undefined)?.onAir, ever = onAir, tab: CityTab = cityTab(), shown = '';
    const render = () => {
      const k = expCard(onAir, tab, ever);
      const key = k + '|' + tab;
      if (key === shown) return;
      shown = key;
      card.hidden = k === 'none';
      if (k === 'none') return;
      h2.textContent = TEXT[k][0]; p.textContent = k === 'over' && tab === 'open' ? 'Город снова открыт — можно вернуться в 3D-город.' : TEXT[k][1];
      card.classList.toggle('mini', k === 'open');   // the expedition still runs: do not cover it
      bar.hidden = k !== 'wait';
      cityBtn.hidden = k === 'wait' || (k === 'over' && tab !== 'open');
      if (!cityBtn.hidden) { ctx.input.unlock(); cityBtn.focus({ preventScroll: true }); }
    };
    const onExp = (e: CustomEvent) => { onAir = !!e.detail?.onAir; if (onAir) ever = true; render(); };
    W.addEventListener('l3d:expedition', onExp);
    const timer = window.setInterval(() => { hideCompass(); const t = cityTab(); if (t !== tab) { tab = t; render(); } }, 1000);
    render();

    // the city map has no city to show: a short note instead (removeTab on dispose restores the built-in page)
    const offMap = ctx.uiApi.addTab('map', {
      title: 'Карта', group: 'world', hotkey: 'KeyM', order: 130,
      render(el) {
        setHtml(el, '<div style="padding:28px 8px;text-align:center;font:600 16px/1.5 \'Golos Text\',sans-serif;color:#e8e0ff">'
          + '<div style="font-size:40px">🗺</div><b style="color:#ffe9a8">Карта города откроется после похода</b><br>'
          + 'Пока ты в отряде, сайт закрывает «Город». Поход смотри здесь, в 3D.</div>');
      },
    });
    const offPause = registerPauseItem({ id: 'return-city', label: 'Вернуться в город', order: 4, enabled: () => cityTab() === 'open', run: goCity });

    return () => {
      W.removeEventListener('l3d:expedition', onExp);
      clearInterval(timer); offPause(); offMap();
      card.remove(); st.remove();
      if (compass) compass.style.display = '';
    };
  },
});
