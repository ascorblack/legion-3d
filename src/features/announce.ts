/**
 * Announcements of the channel / the game (site 12.11, app.js guAnn): /api/me `an` = [{ id, t, g }] (and the live SSE `ann`
 * event) — in the «Игра» mode the site shows up to two of them in its HUD (`#gu-hud .gu-an`: `.gu-ann[data-id]`
 * «Объявление канала» / `.gu-ann-g` «Объявление игры», `.gu-anh` head, `.gu-ant` text, `.gu-anx` close → localStorage
 * `lgAnnX`) while the hero walks in the City (guAnnCity: no window, not jailed, not in the mine / fishing). That HUD lies
 * under our canvas, so the 3D mirrors what the site renders there: the same cards, read from the site's DOM, and its ×
 * presses the site's own close button (a local list on the site — nothing is sent). No site cards → nothing here.
 */
import { coreFeature } from './types';
import { esc } from '../ui/data';
import { setHtml } from '../core/html';

export interface Ann { id: string; head: string; text: string; game: boolean }
/** The site's rendered cards (only while its box is shown: guAnn sets `hidden` when it is off). */
export const ANN_BOX = '.gu-an';
export function readAnns(root: Pick<Document, 'querySelector'> | null | undefined): Ann[] {
  const box = root?.querySelector<HTMLElement>(ANN_BOX);
  if (!box || box.hidden) return [];
  const out: Ann[] = [];
  for (const it of Array.from(box.querySelectorAll<HTMLElement>('.gu-ann')).slice(0, 2)) {
    const id = it.dataset?.id ?? it.getAttribute?.('data-id') ?? '';
    const text = it.querySelector('.gu-ant')?.textContent ?? '';
    if (!id || !text) continue;
    out.push({ id: String(id), head: it.querySelector('.gu-anh')?.textContent || 'Объявление канала', text, game: !!it.classList?.contains('gu-ann-g') });
  }
  return out;
}
export const annKey = (list: readonly Ann[]): string => list.map((a) => a.id + '\u0001' + a.text).join('\u0002');
/** Press the site's × of one card (app.js annClose: its localStorage list, then guAnn repaints). */
export function closeAnn(root: Pick<Document, 'querySelector'> | null | undefined, id: string): boolean {
  const box = root?.querySelector<HTMLElement>(ANN_BOX); if (!box) return false;
  for (const it of Array.from(box.querySelectorAll<HTMLElement>('.gu-ann'))) {
    if ((it.dataset?.id ?? it.getAttribute?.('data-id')) !== id) continue;
    const x = it.querySelector<HTMLButtonElement>('.gu-anx'); if (!x) return false;
    x.click(); return true;
  }
  return false;
}

const CSS = `.l3d-ann{position:absolute;top:96px;left:50%;transform:translateX(-50%);z-index:31;display:flex;flex-direction:column;gap:6px;width:min(440px,calc(100vw - 24px));pointer-events:none}
.l3d-ann .it{position:relative;pointer-events:auto;padding:8px 34px 9px 12px;border-radius:12px;background:#271d2bf0;box-shadow:0 0 0 1.5px #ffcf6a66,0 8px 22px #0007;color:#f7eadf;font:600 13px/1.35 'Nunito','Segoe UI',sans-serif}
.l3d-ann .it.g{box-shadow:0 0 0 1.5px #7fd6e6aa,0 8px 22px #0007}
.l3d-ann b{display:block;color:#ffcf6a;font:800 11px/1.2 'Nunito',sans-serif;letter-spacing:.03em;text-transform:uppercase;margin-bottom:2px}
.l3d-ann .it.g b{color:#7fd6e6}
.l3d-ann p{margin:0;overflow-wrap:anywhere;white-space:pre-line}
.l3d-ann button{position:absolute;top:6px;right:6px;width:24px;height:24px;border:0;border-radius:8px;background:#ffffff14;color:#f7eadf;font:700 14px/1 sans-serif;cursor:pointer}
.l3d-ann button:hover,.l3d-ann button:focus-visible{background:#ffffff2e;outline:none}`;

export default coreFeature({
  id: 'announce',
  order: 236,
  setup(ctx) {
    const ui = ctx.uiRoot?.querySelector?.('.l3d-ui')?.shadowRoot?.querySelector<HTMLElement>('.ui');
    if (!ui || typeof document === 'undefined') return;
    const st = document.createElement('style'); st.textContent = CSS;
    const box = document.createElement('div'); box.className = 'l3d-ann'; box.setAttribute('role', 'region'); box.setAttribute('aria-label', 'Объявления'); box.hidden = true;
    ui.append(st, box);
    let key = '';
    box.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest?.<HTMLButtonElement>('button[data-id]'); if (!b) return;
      closeAnn(document, b.dataset.id || ''); key = ''; tick();
    });
    const tick = () => {
      // the site shows its cards only while the hero walks in the City; the 3D: only while the street is on screen
      const list = !ctx.state.classic && !ctx.state.overlay && !ctx.rooms?.current ? readAnns(document) : [];
      const k = annKey(list);
      if (k !== key) {
        key = k;
        setHtml(box, list.map((a) => `<div class="it${a.game ? ' g' : ''}" role="note"><b>${esc(a.head)}</b><p>${esc(a.text)}</p><button type="button" data-id="${esc(a.id)}" aria-label="Закрыть объявление" title="Закрыть">×</button></div>`).join(''));
      }
      box.hidden = !list.length;
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => { clearInterval(t); box.remove(); st.remove(); };
  },
});
