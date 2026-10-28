/**
 * The mine status chip of the city HUD (plans/mine-ux.md #3): «⛏ этаж 25 · ≈ 12 мин» while the hero digs, «✅ Камень выкопан»
 * with a «В шахту» button once the stone is out. Pure view: it renders a ChipView and reports clicks — the logic and the
 * data live in src/features/mine-status.ts. Own Shadow DOM inside the HUD layer (so F2 / menus hide it with the rest of
 * the HUD), all text through textContent, no network, no per-frame work.
 */

export interface ChipView {
  kind: 'dig' | 'done';
  /** «этаж 25» or '' when the floor is unknown. */
  floor: string;
  /** Main time text: «≈ 12 мин», «почти готово», «копает», «Камень выкопан». */
  head: string;
  /** Secondary line: bag / day limit; '' hides it. */
  sub: string;
  /** Show the «В шахту» button (the mine of this town is the one being dug and we stand on the street). */
  go: boolean;
  /** Hover text. */
  title: string;
}
export interface ChipHandlers { onGo(): void; onClose(): void }
export interface MineChip { render(v: ChipView | null): void; dispose(): void }

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap { display: flex; align-items: center; gap: 9px; max-width: 300px; padding: 6px 12px 6px 8px; border-radius: 16px; pointer-events: none;
  background: linear-gradient(rgba(42,32,48,.88), rgba(29,22,32,.88)); color: var(--l3d-ink, #f7eadf);
  box-shadow: 0 0 0 1.5px var(--line, rgba(255,207,106,.3)), 0 4px 12px rgba(0,0,0,.45);
  font: 800 12px/1.15 var(--l3d-tx, 'Nunito', 'Segoe UI', sans-serif); transition: opacity .25s, transform .25s; }
.wrap[hidden] { display: none; }
.ic { flex: none; width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; font-size: 16px; line-height: 1;
  background: radial-gradient(circle at 35% 30%, #4a3654, #221a28 70%); box-shadow: 0 0 0 1.5px var(--l3d-gold, #ffcf6a); }
.tx { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.l1 { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; text-shadow: 0 1px 2px #000a; }
.fl { color: var(--l3d-gold, #ffcf6a); letter-spacing: .02em; }
.hd { font-weight: 800; }
.l2 { font-weight: 700; font-size: 11px; line-height: 1.2; color: #d8c8d0; white-space: normal; text-shadow: 0 1px 2px #000a; }
.l2[hidden] { display: none; }
.go { pointer-events: auto; cursor: pointer; flex: none; display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px 0 5px; border: 0; border-radius: 999px;
  font: 800 11.5px/1 var(--l3d-tx, 'Nunito', 'Segoe UI', sans-serif); color: #2a1d18; background: linear-gradient(#fff3d0, var(--l3d-gold, #ffcf6a));
  box-shadow: 0 2px 0 var(--l3d-gold-d, #b8862a), inset 0 1px 0 #fff; }
.go:hover { filter: brightness(1.08); } .go:focus-visible, .x:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.go[hidden] { display: none; }
.kc { display: inline-grid; place-items: center; min-width: 19px; height: 19px; padding: 0 4px; border-radius: 6px; font: 400 10.5px/1 var(--l3d-num, 'Arial Black', sans-serif);
  color: var(--l3d-ink, #f7eadf); background: linear-gradient(#4a3a54, #33263b); box-shadow: 0 1px 0 #160f1a; }
.x { pointer-events: auto; cursor: pointer; flex: none; width: 22px; height: 22px; border: 0; border-radius: 50%; padding: 0; line-height: 1; font-size: 12px;
  color: var(--l3d-mute, #bfaab7); background: rgba(255,255,255,.08); }
.x:hover { color: var(--l3d-ink, #f7eadf); background: rgba(255,255,255,.16); }
.x[hidden] { display: none; }
.wrap.done { box-shadow: 0 0 0 1.5px var(--l3d-up, #8fe39a), 0 4px 12px rgba(0,0,0,.45); }
.wrap.done .ic { box-shadow: 0 0 0 1.5px var(--l3d-up, #8fe39a); }
.wrap.done .hd { color: var(--l3d-up, #8fe39a); }
@media (prefers-reduced-motion: no-preference) {
  .wrap { animation: pop .35s cubic-bezier(.2,.8,.2,1); }
  .wrap.done .ic { animation: glow 2.2s ease-in-out 3; }
}
@keyframes pop { from { opacity: 0; transform: translateY(-6px) scale(.96); } to { opacity: 1; transform: none; } }
@keyframes glow { 50% { box-shadow: 0 0 0 1.5px var(--l3d-up, #8fe39a), 0 0 14px var(--l3d-up, #8fe39a); } }
`;

/** Where the chip sits in the HUD: under the hero card on the left, clear of the compass, the minimap and the chat. */
export const CHIP_POS = 'position:absolute;left:16px;top:122px;z-index:30;';

export function mountMineChip(parent: Element, h: ChipHandlers): MineChip {
  const host = document.createElement('div');
  host.className = 'l3d-mine-chip';
  host.style.cssText = CHIP_POS + 'pointer-events:none;';
  const root = host.attachShadow({ mode: 'open' });
  const st = document.createElement('style'); st.textContent = CSS;
  const wrap = document.createElement('div'); wrap.className = 'wrap'; wrap.setAttribute('role', 'status'); wrap.setAttribute('aria-live', 'polite'); wrap.hidden = true;
  const ic = document.createElement('span'); ic.className = 'ic'; ic.setAttribute('aria-hidden', 'true');
  const tx = document.createElement('div'); tx.className = 'tx';
  const l1 = document.createElement('div'); l1.className = 'l1';
  const fl = document.createElement('span'); fl.className = 'fl';
  const hd = document.createElement('span'); hd.className = 'hd';
  l1.append(fl, hd);
  const l2 = document.createElement('div'); l2.className = 'l2';
  tx.append(l1, l2);
  const go = document.createElement('button'); go.type = 'button'; go.className = 'go'; go.hidden = true;
  const kc = document.createElement('span'); kc.className = 'kc'; kc.textContent = 'U';
  const gl = document.createElement('span'); gl.textContent = 'В шахту';
  go.append(kc, gl);
  const x = document.createElement('button'); x.type = 'button'; x.className = 'x'; x.hidden = true; x.textContent = '✕'; x.setAttribute('aria-label', 'Скрыть');
  wrap.append(ic, tx, go, x);
  root.append(st, wrap);
  parent.append(host);

  const onGo = (e: Event) => { e.stopPropagation(); h.onGo(); };
  const onX = (e: Event) => { e.stopPropagation(); h.onClose(); };
  go.addEventListener('click', onGo); x.addEventListener('click', onX);

  let last: ChipView | null = null, lastKind = '';
  const same = (a: ChipView, b: ChipView) => a.kind === b.kind && a.floor === b.floor && a.head === b.head && a.sub === b.sub && a.go === b.go && a.title === b.title;
  return {
    render(v) {
      if (!v) { if (last) { wrap.hidden = true; last = null; lastKind = ''; } return; }
      if (last && same(last, v)) return;
      last = v;
      wrap.hidden = false;
      if (lastKind !== v.kind) { wrap.classList.remove('dig', 'done'); void (wrap as HTMLElement).offsetWidth; wrap.classList.add(v.kind); lastKind = v.kind; }
      ic.textContent = v.kind === 'done' ? '✅' : '⛏';
      fl.textContent = v.floor; fl.hidden = !v.floor;
      hd.textContent = v.head;
      l2.textContent = v.sub; l2.hidden = !v.sub;
      go.hidden = !v.go; x.hidden = v.kind !== 'done';
      wrap.title = v.title;
    },
    dispose() { go.removeEventListener('click', onGo); x.removeEventListener('click', onX); host.remove(); },
  };
}
