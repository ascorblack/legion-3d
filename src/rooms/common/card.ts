/**
 * Buy card (DOM, Shadow DOM with the game UI's own CSS): the item card of src/ui/card.ts (stats, comparison with the
 * equipped item, description) + the price and the site's purchase dialog: «Купить…» → «Купить «X» за Y? Да / Нет» →
 * POST exactly like the site (city.js buyAsk → act) → toast with the result. Stream-only, locked and look goods get
 * the site's explanations instead of a buy button.
 *
 * While open, gameplay input is off and the pointer lock is released; Esc / E / «Закрыть» close it.
 */
import { setModal, type ModalInput } from '../../core/modal';
import type { Hero, Store, Actions, ApiResult } from '../../contracts';
import { CSS } from '../../ui/styles';
import { cardHtml } from '../../ui/card';
import { esc, rarOf, coinStyle, CLASS_NAME } from '../../ui/data';
import { moneyParts } from '../../ui/money';
import { offerOf, sampleOffer, tipItem, LOCK_T, type Offer, type PriceEnv, type StockItem, type Booth, type BoothSample } from './stock';
import { RARITY_HEX } from './items';
import { setHtml } from '../../core/html';

export interface CardHost {
  store: Pick<Store, 'hero' | 'on'>;
  actions: Pick<Actions, 'post'>;
  input?: ModalInput & { lock?(): void; readonly gameplay?: boolean };
  toast(text: string, bad?: boolean): void;
  /** Mount point (default document.body). */
  mount?: HTMLElement;
  /** Called with true/false when the card opens/closes. */
  onOpen?(open: boolean): void;
  /** Called after a successful request (e.g. to refresh tags). */
  onDone?(): void;
}

const EXTRA_CSS = String.raw`
.rmc { pointer-events: none; }
.rm-card { position: absolute; right: max(24px, 4vw); top: 50%; transform: translateY(-50%); width: min(360px, calc(100vw - 32px)); max-height: calc(100vh - 40px);
  overflow: auto; pointer-events: auto; padding: 18px 18px 16px; border-radius: 22px;
  background: linear-gradient(rgba(46,35,53,.97), rgba(30,22,35,.97));
  box-shadow: 0 0 0 1.5px var(--rc, var(--l3d-gold)), 0 0 0 6px rgba(29,22,32,.85), 0 24px 48px #000b;
  animation: rmIn .18s var(--ease); }
@keyframes rmIn { from { opacity: 0; transform: translateY(-46%) scale(.97); } }
.rm-x { position: absolute; right: 10px; top: 10px; width: 30px; height: 30px; border-radius: 50%; border: 0; cursor: pointer; background: #ffffff10; color: var(--l3d-ink); font: 700 18px/1 var(--l3d-tx); }
.rm-x:hover { background: #ffffff22; }
.rm-price { margin: 12px 0 0; padding: 10px 12px; border-radius: 14px; background: #00000030; box-shadow: inset 0 0 0 1px #ffffff10; }
.rm-price .lbl { font: 800 11px/1 var(--l3d-tx); letter-spacing: .08em; text-transform: uppercase; color: var(--l3d-mute); }
.rm-money { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; margin-top: 7px; font: 700 15px/1.2 var(--l3d-tx); }
.rm-money span.p { display: inline-flex; align-items: center; gap: 5px; } .rm-money b { font: 400 17px/1 var(--l3d-num); color: var(--l3d-gold); }
.rm-pts { margin-top: 7px; font: 700 15px/1.3 var(--l3d-tx); color: #e7c8ff; } .rm-pts b { font: 400 17px/1 var(--l3d-num); color: #e7c8ff; }
.rm-acts { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; } .rm-acts .btn { flex: 1; }
.rm-why { margin-top: 8px; font: 700 12.5px/1.35 var(--l3d-tx); color: var(--l3d-dn); }
.rm-bal { margin-top: 8px; font: 600 12.5px/1.45 var(--l3d-tx); color: var(--l3d-mute); } .rm-bal b { color: var(--l3d-ink); }
.rm-q .lead { margin: 4px 0 0; font: 700 17px/1.3 var(--l3d-hd); }
.rm-q .lead .money { white-space: nowrap; color: var(--l3d-gold); }
.rm-hint { margin-top: 10px; font: 600 11.5px/1.3 var(--l3d-tx); color: var(--l3d-mute); text-align: center; }
.rm-hint kbd { display: inline-block; min-width: 18px; padding: 2px 5px; border-radius: 6px; background: #ffffff14; font: 800 11px/1 var(--l3d-tx); color: var(--l3d-ink); }
.rm-samples { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.rm-samples button { height: 30px; padding: 0 11px; border-radius: 999px; border: 0; cursor: pointer; font: 700 12.5px/1 var(--l3d-tx); color: var(--l3d-ink);
  background: #ffffff0d; box-shadow: inset 0 0 0 1.5px #ffffff1c; display: inline-flex; align-items: center; gap: 6px; }
.rm-samples button.on { box-shadow: inset 0 0 0 2px var(--l3d-gold); background: #ffcf6a1c; }
.rm-samples button.own small { color: var(--l3d-up); font-weight: 800; }
.rm-samples i { width: 14px; height: 14px; border-radius: 50%; box-shadow: 0 0 0 1.5px #2a2236; }
.rm-head { display: flex; align-items: baseline; gap: 8px; } .rm-head b { font: 700 18px/1.2 var(--l3d-hd); color: var(--l3d-gold); }
.rm-head span { font: 800 12px/1 var(--l3d-tx); color: var(--l3d-mute); }
`;

/** Money as the site prints it (coin discs + words), e.g. «🟡 1 золотая рыбка ⚪ 72 серебряные рыбки». */
export function moneyHtml(n: number, ref?: number): string {
  return `<span class="rm-money money">${moneyParts(n, ref, coinStyle()).map(([k, v, w]) => `<span class="p"><i class="coin ${k}"></i><b>${v}</b> ${esc(w)}</span>`).join('')}</span>`;
}
const ptsHtml = (n: number) => `<b>${(+n || 0).toLocaleString('ru-RU')}</b> баллов канала`;
const kx = (k: number) => '×' + String(k).replace('.', ',');

type View =
  | { t: 'good'; it: StockItem; b: string; env: () => PriceEnv; step: 'card' | 'ask' | 'busy' }
  | { t: 'sample'; booth: Booth; s: BoothSample; step: 'card' | 'ask' | 'busy'; onPick?: (s: BoothSample) => void };

export class BuyCard {
  private host: HTMLElement;
  private root: ShadowRoot;
  private box: HTMLElement;
  private view: View | null = null;
  private unHero: (() => void) | null = null;
  private keyH = (e: KeyboardEvent) => this.onKey(e);

  constructor(private H: CardHost) {
    this.host = document.createElement('div');
    this.host.className = 'l3d-roomcard';
    Object.assign(this.host.style, { position: 'fixed', inset: '0', zIndex: '170', pointerEvents: 'none' });
    this.root = this.host.attachShadow({ mode: 'open' });
    setHtml(this.root, `<style>${CSS}${EXTRA_CSS}</style><div class="ui rmc"></div>`);
    this.box = this.root.querySelector('.rmc') as HTMLElement;
    (H.mount || document.body).appendChild(this.host);
    this.unHero = H.store.on('hero', () => { if (this.view && this.view.step !== 'busy') this.render(); });
  }

  get opened(): boolean { return !!this.view; }

  /**
   * Card for a shop good. The card is BOUND to `it`: the request always uses this item's id and price, whatever the
   * crosshair does afterwards. step 'ask' shows the confirmation right away (still under the full item card).
   */
  openGood(it: StockItem, b: string, env: () => PriceEnv, step: 'card' | 'ask' = 'card'): void {
    const was = !!this.view;
    this.view = { t: 'good', it, b, env, step };
    if (!was) this.shown(true);
    this.render();
  }
  /** The good the open card is bound to (null for samples / closed). */
  get boundTo(): StockItem | null { return this.view && this.view.t === 'good' ? this.view.it : null; }
  /** Card for a tent booth sample (try-on is done by the caller via onPick). */
  openSample(booth: Booth, s: BoothSample, onPick?: (s: BoothSample) => void): void {
    const was = !!this.view;
    this.view = { t: 'sample', booth, s, step: 'card', onPick };
    if (!was) this.shown(true);
    this.render();
  }
  close(): void {
    if (!this.view) return;
    this.view = null; setHtml(this.box, '');
    this.shown(false);
  }
  dispose(): void {
    this.close();
    if (this.unHero) this.unHero();
    this.host.remove();
  }

  private shown(on: boolean) {
    if (on) {
      window.addEventListener('keydown', this.keyH, true);
      setModal(this.H.input, 'room:card', true, () => this.close());
    } else {
      window.removeEventListener('keydown', this.keyH, true);
      setModal(this.H.input, 'room:card', false);
    }
    this.H.onOpen?.(on);
  }
  private onKey(e: KeyboardEvent) {
    if (!this.view) return;
    if (e.code === 'Escape' || e.code === 'KeyE') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (this.view.step === 'ask') { this.view.step = 'card'; this.render(); } else if (this.view.step !== 'busy') this.close();
    } else if (e.code === 'Enter') {
      const b = this.box.querySelector<HTMLButtonElement>('[data-primary]:not([disabled])');
      if (b) { e.preventDefault(); e.stopImmediatePropagation(); b.click(); }
    }
  }
  /** Leave the card by a click → take the pointer lock back (a click is a user gesture). */
  private closeByClick() { this.close(); try { this.H.input?.lock?.(); } catch { /* ignore */ } }

  private offer(): Offer | null {
    const v = this.view, h = this.H.store.hero;
    if (!v) return null;
    return v.t === 'good' ? offerOf(v.it, v.b, v.env()) : sampleOffer(h, v.booth, v.s);
  }

  render(): void {
    const v = this.view; if (!v) return;
    const h = this.H.store.hero as Hero | null, of = this.offer()!;
    let body = '', rc = '';
    if (v.t === 'good') {
      rc = rarOf(v.it.rarity).color;
      const ti = tipItem(v.it);
      const role = v.it.role ? `<p class="rm-bal">Класс: <b>${esc(CLASS_NAME[v.it.role] || v.it.role)}</b>${h && h.role && h.role !== v.it.role && v.it.slot === 'weapon' ? ' — с этим оружием сменишь класс' : ''}</p>` : '';
      body = `<div class="card">${cardHtml(ti, h, { forceCompare: true })}</div>${role}`;
    } else {
      rc = 'var(--l3d-gold)';
      const S = v.booth.samples || [];
      body = `<div class="rm-head"><b>${esc(v.s.name)}</b><span>${esc(v.booth.title || '')} · образец №${v.s.n}</span></div>
        <p class="note">Только внешность — на характеристики не влияет. Примерено на манекене в кабинке.</p>
        ${S.length > 1 ? `<div class="rm-samples" role="group" aria-label="Образцы">${S.map((x) => `<button type="button" data-smp="${esc(x.pos)}" class="${x.pos === v.s.pos ? 'on' : ''}${of && this.ownedS(v.booth, x) ? ' own' : ''}">${v.booth.key === 'color' ? `<i style="background:${esc(x.id)}"></i>` : ''}${esc(x.name)}${this.ownedS(v.booth, x) ? '<small>есть</small>' : ''}</button>`).join('')}</div>` : ''}`;
    }
    let price = '', acts = '';
    const ask = v.step === 'ask' || v.step === 'busy';
    if (of.kind === 'locked') {
      price = `<div class="rm-price"><div class="lbl">Цена</div><div class="rm-pts">🔒 ${LOCK_T}</div></div><p class="note warn">${esc(of.note)}</p>`;
      acts = `<button type="button" class="btn ghost" data-close data-primary>Понятно</button>`;
    } else if (of.kind === 'coins' || of.kind === 'mat') {
      price = `<div class="rm-price"><div class="lbl">Цена</div>${moneyHtml(of.coins)}${of.thief > 1 ? `<div class="rm-bal">Для тебя за воровство цена ${kx(of.thief)}.</div>` : ''}${of.foreign > 1 && of.kind === 'coins' ? `<div class="rm-bal">Чужой округ: цена ${kx(of.foreign)}.</div>` : ''}${of.rank ? `<div class="rm-bal">Звание не ниже «${esc(of.rank)}».</div>` : ''}</div>`;
      if (ask) {
        const have = +(h?.money || 0);
        price += `<div class="rm-q"><p class="lead">Купить «${esc(v.t === 'good' ? v.it.name : '')}» за ${moneyHtml(of.coins)}?</p>
          <div class="rm-bal">У тебя: ${moneyHtml(have, of.coins)}${of.poor ? `<br>Не хватает: ${moneyHtml(of.coins - have, of.coins)}` : ''}</div>${of.why ? `<div class="rm-why">${esc(of.why)}</div>` : ''}</div>`;
        acts = v.step === 'busy' ? `<button type="button" class="btn" disabled>Секунду…</button>`
          : `<button type="button" class="btn gold" data-yes data-primary${of.why ? ' disabled' : ''}>Да</button><button type="button" class="btn ghost" data-no>Нет</button>`;
      } else {
        acts = `<button type="button" class="btn gold" data-buy data-primary${of.why ? ' disabled' : ''}>Купить…</button><button type="button" class="btn ghost" data-close>Закрыть</button>`;
        if (of.why) price += `<div class="rm-why">${esc(of.why)}</div>`;
      }
    } else if (of.kind === 'wear') {
      price = `<div class="rm-price"><div class="lbl">Гардероб</div><div class="rm-pts">Уже есть в гардеробе</div></div>${of.why ? `<div class="rm-why">${esc(of.why)}</div>` : ''}`;
      acts = v.step === 'busy' ? `<button type="button" class="btn" disabled>Секунду…</button>`
        : `<button type="button" class="btn gold" data-yes data-primary${of.why ? ' disabled' : ''}>Надеть</button><button type="button" class="btn ghost" data-close>Закрыть</button>`;
    } else {
      // points / look: the site's «купить можно на стриме»
      price = `<div class="rm-price"><div class="lbl">На стриме</div>${of.points ? `<div class="rm-pts">${ptsHtml(of.points)}</div>` : ''}${of.rank ? `<div class="rm-bal">Звание не ниже «${esc(of.rank)}».</div>` : ''}</div>
        <p class="note amber">«${esc(v.t === 'good' ? v.it.name : v.s.name)}» — купить можно на стриме. ${esc(of.note)}</p>${of.why ? `<div class="rm-why">${esc(of.why)}</div>` : ''}`;
      acts = `<button type="button" class="btn ghost" data-close data-primary>Понятно</button>`;
    }
    const fullBag = v.t === 'good' && h?.sg && typeof h.sg === 'object' && Number((h.sg as { used?: number }).used) === Number((h.sg as { cap?: number }).cap);
    if (fullBag) price += '<p class="note">В сумке нет места.</p>';
    const hint = `<div class="rm-hint"><kbd>Enter</kbd> ${ask ? 'да' : 'выбрать'} · <kbd>Esc</kbd> ${ask ? 'назад' : 'закрыть'}</div>`;
    setHtml(this.box, `<div class="rm-card" role="dialog" aria-modal="true" aria-label="Покупка" style="--rc:${rc}"><button type="button" class="rm-x" aria-label="Закрыть" data-close>×</button>${body}${price}<div class="rm-acts">${acts}</div>${hint}</div>`);
    this.bind();
  }

  private ownedS(b: Booth, s: BoothSample): boolean { const o = sampleOffer(this.H.store.hero, b, s); return o.kind === 'wear'; }

  private bind() {
    const q = (s: string) => this.box.querySelectorAll<HTMLButtonElement>(s);
    q('[data-close]').forEach((b) => b.onclick = () => this.closeByClick());
    q('[data-no]').forEach((b) => b.onclick = () => { if (this.view) { this.view.step = 'card'; this.render(); } });
    q('[data-buy]').forEach((b) => b.onclick = () => { if (this.view) { this.view.step = 'ask'; this.render(); } });
    q('[data-yes]').forEach((b) => b.onclick = () => this.send());
    q('[data-smp]').forEach((b) => b.onclick = () => {
      const v = this.view; if (!v || v.t !== 'sample') return;
      const s = (v.booth.samples || []).find((x) => x.pos === b.dataset.smp); if (!s) return;
      v.s = s; v.step = 'card'; v.onPick?.(s); this.render();
    });
    const p = this.box.querySelector<HTMLButtonElement>('[data-primary]:not([disabled])') || this.box.querySelector<HTMLButtonElement>('[data-close]');
    try { p?.focus({ preventScroll: true }); } catch { /* ignore */ }
  }

  private async send() {
    const v = this.view, of = this.offer();
    if (!v || !of || !of.req || of.why || v.step === 'busy') return;
    v.step = 'busy'; this.render();
    let r: ApiResult | null = null;
    try { r = await this.H.actions.post<ApiResult>(of.req.path, of.req.body); } catch (e) { r = { ok: false, error: String((e as Error)?.message || e) }; }
    if (this.view !== v) return;   // closed meanwhile
    if (!r || !r.ok) { v.step = 'card'; this.render(); this.H.toast((r && r.error) || 'Не получилось', true); return; }
    this.H.toast(of.okText || 'Готово');
    try { window.dispatchEvent(new CustomEvent('l3d:sfx', { detail: { id: 'shop.buy' } })); } catch { /* no sound */ }
    this.H.onDone?.();
    this.closeByClick();
  }
}

export { RARITY_HEX };
