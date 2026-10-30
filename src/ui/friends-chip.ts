/**
 * «👥 Заявки в друзья · 2» — a small HUD chip that shows only while someone has asked the hero to be friends (the number
 * is the site's own «Друзья» button badge) and opens the site's friends window on click. Pure view: src/features/friends.ts
 * feeds it the count and takes the click. Own Shadow DOM in the HUD layer (F2 / menus hide it with the rest of the HUD),
 * all text through textContent, no network, no per-frame work.
 */
const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.b { pointer-events: auto; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; max-width: 300px; height: 34px; padding: 0 12px 0 8px; border: 0; border-radius: 999px;
  background: linear-gradient(rgba(42,32,48,.9), rgba(29,22,32,.9)); color: var(--l3d-ink, #f7eadf);
  box-shadow: 0 0 0 1.5px var(--l3d-gold, #ffcf6a), 0 4px 12px rgba(0,0,0,.45);
  font: 800 12px/1 var(--l3d-tx, 'Nunito', 'Segoe UI', sans-serif); white-space: nowrap; text-shadow: 0 1px 2px #000a; }
.b[hidden] { display: none; }
.b:hover { filter: brightness(1.1); } .b:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.ic { font-size: 15px; line-height: 1; }
.n { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--l3d-gold, #ffcf6a); color: #2a1d18; font: 400 11.5px/20px var(--l3d-num, 'Arial Black', sans-serif); text-align: center; }
@media (prefers-reduced-motion: no-preference) { .b { animation: pop .35s cubic-bezier(.2,.8,.2,1); } }
@keyframes pop { from { opacity: 0; transform: translateY(-6px) scale(.96); } to { opacity: 1; transform: none; } }
`;

export interface FriendsChip { render(n: number): void; dispose(): void }

/** Where it sits: under the hero card, below the mine status chip (src/ui/mine-chip.ts, top 122). */
export const FRIENDS_CHIP_POS = 'position:absolute;left:16px;top:176px;z-index:30;';

export function mountFriendsChip(parent: Element, onOpen: () => void): FriendsChip {
  const host = document.createElement('div');
  host.className = 'l3d-friends-chip';
  host.style.cssText = FRIENDS_CHIP_POS + 'pointer-events:none;';
  const root = host.attachShadow({ mode: 'open' });
  const st = document.createElement('style'); st.textContent = CSS;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'b'; b.hidden = true;
  const ic = document.createElement('span'); ic.className = 'ic'; ic.setAttribute('aria-hidden', 'true'); ic.textContent = '👥';
  const tx = document.createElement('span'); tx.textContent = 'Заявки в друзья';
  const n = document.createElement('span'); n.className = 'n';
  b.append(ic, tx, n);
  root.append(st, b);
  parent.append(host);
  const click = (e: Event) => { e.stopPropagation(); onOpen(); };
  b.addEventListener('click', click);
  let last = 0;
  return {
    render(c) {
      c = Math.max(0, c | 0);
      if (c === last) return;
      last = c;
      b.hidden = !c;
      n.textContent = c > 99 ? '99+' : String(c);
      b.title = c ? `Заявок в друзья: ${c} — открыть окно друзей` : '';
      b.setAttribute('aria-label', c ? `Друзья, новых заявок: ${c}` : 'Друзья');
    },
    dispose() { b.removeEventListener('click', click); host.remove(); },
  };
}
