/**
 * The emote wheel (DOM, its own Shadow DOM root under ctx.uiRoot, styled like src/ui: dark plum glass, gold line,
 * Nunito): 8 sectors around a centre that names the highlighted emote. The feature moves a virtual pointer (pointer
 * lock deltas, or the real cursor offset from the screen centre when the pointer is free) and calls highlight().
 * Built once, shown / hidden with a class (no layout work per frame beyond one transform for the pointer dot).
 */
import { EMOTES, WHEEL } from './defs';
import { setHtml } from '../core/html';

const CSS = `
:host { all: initial; }
.wrap { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; pointer-events: none;
  font: 700 13px/1.2 'Nunito', 'Golos Text', 'Segoe UI', sans-serif; color: #f7eadf; opacity: 0; transition: opacity .12s ease; }
.wrap.on { opacity: 1; }
.dim { position: absolute; inset: 0; background: radial-gradient(circle at 50% 50%, #1d162055 150px, #1d1620b0 420px); }
.ring { position: relative; width: 330px; height: 330px; border-radius: 50%;
  background: radial-gradient(circle, #2a2030f2 0 33%, #221a28e8 34% 100%);
  box-shadow: 0 0 0 1.5px #ffcf6a59, 0 0 0 7px #1d162055, 0 18px 50px #000a; transform: scale(.86); transition: transform .16s cubic-bezier(.2,.8,.2,1); }
.wrap.on .ring { transform: scale(1); }
.sec { position: absolute; left: 50%; top: 50%; width: 76px; height: 76px; margin: -38px 0 0 -38px; border-radius: 50%;
  display: grid; place-content: center; justify-items: center; gap: 3px; transition: transform .12s cubic-bezier(.2,.8,.2,1), background .12s; }
.sec .em { font: 30px/1 'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif; filter: drop-shadow(0 2px 2px #0008); }
  .sec .lb { font: 800 10.5px/1 'Nunito', sans-serif; color: #bfaab7; letter-spacing: .02em; }
.sec.hi .lb { color: #ffcf6a; }
.sec.hi { background: #ffcf6a2e; box-shadow: 0 0 0 2px #ffcf6a; }
.sec.hi .em { transform: scale(1.18); }
.mid { position: absolute; left: 50%; top: 50%; width: 112px; height: 112px; margin: -56px 0 0 -56px; border-radius: 50%;
  display: grid; place-items: center; text-align: center; box-shadow: inset 0 0 0 1px #ffcf6a40; }
.mid b { display: block; font: 800 16px/1.1 'Comfortaa', 'Nunito', sans-serif; color: #ffcf6a; }
.mid i { display: block; font-style: normal; font-size: 11px; color: #bfaab7; margin-top: 4px; }
.dot { position: absolute; left: 50%; top: 50%; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%;
  background: #ffcf6a; box-shadow: 0 0 10px #ffcf6a; }
@media (prefers-reduced-motion: reduce) { .wrap, .ring, .sec { transition: none; } .ring { transform: none; } }
`;

export class EmoteWheel {
  readonly host: HTMLElement;
  private wrap: HTMLElement;
  private secs: HTMLElement[] = [];
  private name: HTMLElement;
  private tip: HTMLElement;
  private dot: HTMLElement;
  private hi = -2;
  open = false;

  constructor(parent: HTMLElement) {
    this.host = document.createElement('div');
    this.host.className = 'l3d-emotes';
    const sh = this.host.attachShadow({ mode: 'open' });
    const st = document.createElement('style'); st.textContent = CSS; sh.appendChild(st);
    this.wrap = document.createElement('div'); this.wrap.className = 'wrap';
    this.wrap.setAttribute('role', 'menu'); this.wrap.setAttribute('aria-label', 'Эмоции'); this.wrap.setAttribute('aria-hidden', 'true');
    setHtml(this.wrap, '<div class="dim"></div><div class="ring"><div class="mid"><div><b></b><i></i></div></div><div class="dot"></div></div>');
    const ring = this.wrap.querySelector('.ring') as HTMLElement;
    const R = 124;
    EMOTES.forEach((e, i) => {
      const a = (i / EMOTES.length) * Math.PI * 2;
      const s = document.createElement('div');
      s.className = 'sec'; s.setAttribute('role', 'menuitem'); s.setAttribute('aria-label', e.label);
      s.style.transform = `translate(${(Math.sin(a) * R).toFixed(1)}px, ${(-Math.cos(a) * R).toFixed(1)}px)`;
      setHtml(s, `<span class="em">${e.emoji}</span><span class="lb">${e.label}</span>`);
      ring.appendChild(s); this.secs.push(s);
    });
    this.name = this.wrap.querySelector('.mid b') as HTMLElement;
    this.tip = this.wrap.querySelector('.mid i') as HTMLElement;
    this.dot = this.wrap.querySelector('.dot') as HTMLElement;
    sh.appendChild(this.wrap);
    parent.appendChild(this.host);
    this.highlight(-1, 0, 0);
  }

  show(on: boolean) {
    if (on === this.open) return;
    this.open = on;
    this.wrap.classList.toggle('on', on);
    this.wrap.setAttribute('aria-hidden', String(!on));
    if (on) this.highlight(-1, 0, 0);
  }

  /** Highlight sector i (-1 = none) and put the pointer dot at (x, y) px from the centre. */
  highlight(i: number, x: number, y: number) {
    const k = Math.min(1, Math.hypot(x, y) / WHEEL.rim);
    this.dot.style.transform = `translate(${(x * 0.62).toFixed(1)}px, ${(y * 0.62).toFixed(1)}px)`;
    this.dot.style.opacity = String(0.35 + 0.65 * k);
    if (i === this.hi) return;
    if (this.hi >= 0) this.secs[this.hi].classList.remove('hi');
    this.hi = i;
    if (i >= 0) { this.secs[i].classList.add('hi'); this.name.textContent = EMOTES[i].label; this.tip.textContent = 'отпусти Z'; }
    else { this.name.textContent = 'Эмоции'; this.tip.textContent = 'веди мышью'; }
  }

  dispose() { this.host.remove(); }
}
