/**
 * Expedition 3D overlay HUD: the stage title on top, the «what to type in chat» strip at the bottom (class command,
 * fronts, skill words, vote numbers — the telegraph / mechanic word is drawn on a canvas, never as DOM text), the
 * controls hint and the black veil between sets. Shadow DOM; rebuilt only when the content changes.
 */
import type { Cmd, SceneState } from './adapter';
import { setHtml } from '../core/html';

const CSS = `
:host{all:initial}
.top{position:fixed;left:50%;top:14px;transform:translateX(-50%);display:flex;gap:10px;align-items:center;padding:8px 18px;border-radius:999px;
  background:linear-gradient(180deg,rgba(32,22,66,.9),rgba(18,12,40,.9));border:2px solid rgba(255,201,77,.55);color:#fff6e0;
  font:400 17px/1.2 'Russo One','Dela Gothic One','Golos Text',sans-serif;letter-spacing:.02em;box-shadow:0 8px 24px rgba(0,0,0,.45);white-space:nowrap;max-width:70vw;overflow:hidden}
.top i{font-style:normal}.top em{font:600 14px 'Golos Text',sans-serif;color:#d8d0f5;font-style:normal}.top b{font:800 15px 'Golos Text',sans-serif;color:#ffe27a}
.top b.hot{color:#ff7b7b}
.cmd{position:fixed;left:50%;bottom:64px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;max-width:92vw}
.cmd small.h{font:800 11px 'Golos Text',sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#ffc94d;text-shadow:0 1px 3px #000}
.row{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}
.c{display:flex;flex-direction:column;align-items:center;gap:2px;padding:7px 14px 6px;border-radius:12px;background:rgba(18,12,40,.86);border:2px solid rgba(255,201,77,.6);
  box-shadow:0 6px 18px rgba(0,0,0,.4);min-width:64px}
.c .t{font:900 22px/1.1 'Golos Text','Nunito',sans-serif;color:#ffe9a8}
.c .n{font:600 11px/1.2 'Golos Text',sans-serif;color:#cfc6ef;max-width:220px;text-align:center}
.c.say .t::before{content:'«'}.c.say .t::after{content:'»'}
.c.main{border-color:#ffc94d;background:rgba(60,40,10,.9);transform:scale(1.08)}
.c.main .t{font-size:26px;animation:pulse 1.3s ease-in-out infinite}
.c.word{border-color:#ff6a3a;background:rgba(70,16,10,.9)}
.c.num .t{color:#fff;font-size:24px}.c.num{min-width:54px}
.c.silent{border-color:#e8455c;background:rgba(80,10,24,.92)}.c.silent .t{color:#ffb0b8}
.c.ok{border-color:rgba(76,201,90,.8);background:rgba(10,50,20,.88)}.c.ok .t{color:#9fe39a;font-size:16px}
.c.info{border-color:rgba(200,190,255,.4)}.c.info .t{font-size:15px;color:#f5f2ff;font-weight:700}
.c.dim{opacity:.55;transform:scale(.92)}
canvas{display:block}
@keyframes pulse{50%{text-shadow:0 0 16px rgba(255,201,77,.9)}}
.hint{position:fixed;right:16px;bottom:16px;padding:6px 12px;border-radius:10px;background:rgba(18,12,40,.75);color:#d8d0f5;font:600 12px 'Golos Text',sans-serif;pointer-events:none}
.hint b{color:#ffe27a}
.veil{position:fixed;inset:0;background:#0d0b22;opacity:0;pointer-events:none}
.spec{font:600 12px 'Golos Text',sans-serif;color:#d8d0f5;text-shadow:0 1px 3px #000}
`;

const ICON: Record<string, string> = { gather: '⛺', vote: '🗳', travel: '🥾', battle: '⚔', boss: '👹', trap: '🪤', treasure: '💎', rest: '🔥', shop: '🛒', event: '✦', town: '🏘', dungeon: '🗝', lair: '🏝', loot: '🎁' };

export class ExpeditionHud {
  readonly el: HTMLElement;
  private sh: ShadowRoot;
  private top: HTMLElement; private cmd: HTMLElement; private veil: HTMLElement; private hint: HTMLElement; private timer: HTMLElement | null = null;
  private key = '';
  constructor(root: HTMLElement, hintText = '<b>Q</b> — выйти из 3D · мышь — осмотреться · колесо — ближе/дальше · <b>F8</b> — сайт', hintBottom = 16) {
    this.el = document.createElement('div');
    this.el.className = 'l3d-expedition-hud';
    this.el.style.cssText = 'position:fixed;inset:0;z-index:130;pointer-events:none;';
    root.appendChild(this.el);
    this.sh = this.el.attachShadow({ mode: 'open' });
    setHtml(this.sh, `<style>${CSS}</style><div class="veil"></div><div class="top" role="status" aria-live="polite"></div><div class="cmd"></div><div class="hint">${hintText}</div>`);
    this.veil = this.sh.querySelector('.veil') as HTMLElement;
    this.top = this.sh.querySelector('.top') as HTMLElement;
    this.cmd = this.sh.querySelector('.cmd') as HTMLElement;
    this.hint = this.sh.querySelector('.hint') as HTMLElement;
    this.hint.style.bottom = hintBottom + 'px';
    if (!hintText) this.hint.hidden = true;
  }
  setFade(a: number): void { this.veil.style.opacity = String(Math.round(a * 100) / 100); }
  /** Rebuild when the content changes; the countdown is patched in place. */
  update(s: SceneState | null, secLeft: number): void {
    if (!s || s.kind === 'off') { this.top.style.display = 'none'; setHtml(this.cmd, ''); this.key = ''; return; }
    this.top.style.display = '';
    const key = JSON.stringify([s.kind, s.title, s.status, s.cmds, s.inParty, !!s.until]);
    if (key !== this.key) {
      this.key = key;
      setHtml(this.top, `<i>${ICON[s.kind] || '🗺'}</i><span>${esc(s.title || 'Поход')}</span><em>${esc(s.status && s.status !== s.title ? s.status : '')}</em>${s.until ? '<b class="tm"></b>' : ''}`);
      this.timer = this.top.querySelector('.tm');
      setHtml(this.cmd, '');
      if (s.cmds.length) {
        const h = document.createElement('small'); h.className = 'h';
        const silent = s.cmds[0].kind === 'silent';
        h.textContent = silent ? 'Внимание' : s.cmds.some((c) => c.kind === 'say' || c.kind === 'word' || c.kind === 'num') ? 'Пиши в чат стрима' : 'Что происходит';
        this.cmd.appendChild(h);
        const row = document.createElement('div'); row.className = 'row';
        let mainDone = false;
        for (const c of s.cmds.slice(0, 9)) {
          const main = !mainDone && !c.dim && (c.kind === 'say' || c.kind === 'word' || c.kind === 'silent');
          if (main) mainDone = true;
          row.appendChild(chip(c, main));
        }
        this.cmd.appendChild(row);
        if (!s.inParty && s.kind !== 'gather') { const sp = document.createElement('div'); sp.className = 'spec'; sp.textContent = 'ты смотришь как зритель — команды пишут бойцы отряда'; this.cmd.appendChild(sp); }
      }
    }
    if (this.timer) { this.timer.textContent = `${secLeft} с`; this.timer.classList.toggle('hot', secLeft <= 5); }
  }
  dispose(): void { this.el.remove(); }
}

function chip(c: Cmd, main: boolean): HTMLElement {
  const d = document.createElement('div');
  d.className = `c ${c.kind}${main ? ' main' : ''}${c.dim ? ' dim' : ''}`;
  if (c.kind === 'word') d.appendChild(wordCanvas(c.text, main ? 30 : 24));
  else { const t = document.createElement('div'); t.className = 't'; t.textContent = c.text; d.appendChild(t); }
  if (c.note) { const n = document.createElement('div'); n.className = 'n'; n.textContent = c.note; d.appendChild(n); }
  return d;
}
/** The word as pixels (streamer's rule: telegraph words are not copyable). */
function wordCanvas(text: string, px: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  const font = `900 ${px}px 'Golos Text','Nunito',sans-serif`;
  let w = text.length * px * 0.62 + 12;
  if (ctx) { ctx.font = font; w = Math.ceil(ctx.measureText(text).width) + 12; }
  const h = Math.round(px * 1.35);
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.width = w + 'px'; c.style.height = h + 'px';
  if (ctx) {
    ctx.scale(dpr, dpr); ctx.font = font; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.shadowColor = '#ff6a2a'; ctx.shadowBlur = 10; ctx.fillStyle = '#ffe27a'; ctx.fillText(text, 6, h / 2 + 1);
  }
  c.setAttribute('aria-label', 'слово для чата (на экране)');
  return c;
}
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
