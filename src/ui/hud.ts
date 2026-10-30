/** HUD: vitals, money, social chip, compass, online, crosshair, interaction prompt, ghost banner, perf, level-up, hints. */
import type { Hero } from '../contracts';
import { toX, toZ } from '../world/coords';
import { type Ctx, h, extras } from './ctx';
import { esc, hpInfo, xpInfo, plainCountdown, coinStyle, roleTitle } from './data';
import { moneyCompact } from './money';
import { statIcon } from './icons';
import { promptView } from './prompt';
import { MiniMap } from './map';

const TAU = Math.PI * 2;
const HINTS_S = 20;
const FOV_COMPASS = Math.PI * 0.75;   // the strip spans 135°
const CARD: [number, string][] = [[0, 'С'], [Math.PI / 4, 'СЗ'], [Math.PI / 2, 'З'], [Math.PI * 3 / 4, 'ЮЗ'], [Math.PI, 'Ю'], [-Math.PI * 3 / 4, 'ЮВ'], [-Math.PI / 2, 'В'], [-Math.PI / 4, 'СВ']];
const wrap = (a: number) => { a %= TAU; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU; return a; };

interface Mark { el: HTMLElement; ang: number; x?: number; y?: number; vis: boolean; tx: number; lab?: boolean }

export class Hud {
  el: HTMLElement;
  private c: Ctx;
  private vit!: HTMLElement; private hpBar!: HTMLElement; private hpFill!: HTMLElement; private hpGhost!: HTMLElement; private hpT!: HTMLElement;
  private xpFill!: HTMLElement; private xpT!: HTMLElement; private lv!: HTMLElement; private nm!: HTMLElement; private cls!: HTMLElement;
  private money!: HTMLElement; private candy!: HTMLElement; private soc!: HTMLElement; private online!: HTMLElement; private onlineN!: HTMLElement;
  private comp!: HTMLElement; private strip!: HTMLElement; private marks: Mark[] = [];
  private cross!: HTMLElement; private prompt!: HTMLElement; private ghost!: HTMLElement; private perf!: HTMLElement; private hints!: HTMLElement; private clickp!: HTMLElement;
  private lastTarget = '\u0000'; private lastMoney: number | null = null; private lastLevel: number | null = null; private lastHp = -1;
  private perfOn = false; private perfT = 0; private secT = 0; private playT = 0; private hintsHidden = false; private lastYaw = NaN; private lastCross = '';
  private compW = 460;
  /** ui.prompt(): once the interact system drives the prompt, host.focusTarget() is no longer polled. */
  private driven = false; private ptext: string | null = null; private pDirty = false;
  readonly mini: MiniMap;
  /** «Click to return» gate: pointer lock is supported, the user has interacted, and we have held the lock before. */
  private lockOk: boolean; private gestured = false; private hadLock = false; private unlockedT = 0; private clickOn = false;

  constructor(c: Ctx) {
    this.c = c;
    this.el = h('div', 'hud');
    this.lockOk = typeof document !== 'undefined' && 'pointerLockElement' in document && typeof Element !== 'undefined' && typeof Element.prototype.requestPointerLock === 'function';
    const ua = (navigator as any).userActivation;
    this.gestured = !!(ua && ua.hasBeenActive);
    if (!this.gestured) {
      const g = (e: Event) => { if (!e.isTrusted) return; this.gestured = true; window.removeEventListener('pointerdown', g, true); window.removeEventListener('keydown', g, true); };
      window.addEventListener('pointerdown', g, true); window.addEventListener('keydown', g, true);
    }
    this.build();
    this.mini = new MiniMap(c, c.map);
    this.el.appendChild(this.mini.el);
    this.mini.setOn(!!c.settings.minimap);
  }

  /** Crosshair prompt from the interact system: «[E] Войти: Кузня», «[E] Купить: … · [F] Осмотреть»; null hides it. */
  setPrompt(text: string | null) {
    this.driven = true;
    const t = text && text.trim() ? text : null;
    if (t !== this.ptext) { this.ptext = t; this.pDirty = true; }
  }
  setMinimap(on: boolean) { this.mini.setOn(on); this.el.classList.toggle('withmini', on); }

  private build() {
    const e = this.el;
    this.vit = h('div', 'vit', `<div class="medal" data-act="open" data-m="gear" title="Снаряжение (C)"><span class="ears"></span><span class="lv">1</span><span class="lvt">Ур.</span></div>
      <div class="vbox"><div class="vname"><b></b><span></span></div>
        <div class="bar hp"><i class="ghost"></i><i class="fill"></i><span class="t"></span></div>
        <div class="bar xp"><i class="fill"></i><span class="t"></span></div>
        <div class="chips"><span class="chip money" title="Монеты"></span><span class="chip candy" hidden title="Конфеты Хэллоуина — не занимают место в сумке; меняют у «Ступы сладостей»"></span><span class="chip soc click" data-act="open" data-m="legion" title="Соц. рейтинг"></span></div></div>`);
    e.appendChild(this.vit);
    const q = (s: string) => this.vit.querySelector(s) as HTMLElement;
    this.lv = q('.lv'); this.nm = q('.vname b'); this.cls = q('.vname span');
    this.hpBar = q('.bar.hp'); this.hpFill = q('.bar.hp .fill'); this.hpGhost = q('.bar.hp .ghost'); this.hpT = q('.bar.hp .t');
    this.xpFill = q('.bar.xp .fill'); this.xpT = q('.bar.xp .t'); this.money = q('.chip.money'); this.candy = q('.chip.candy'); this.soc = q('.chip.soc');

    this.comp = h('div', 'compass', `<div class="rail"></div><div class="strip"></div><div class="needle"></div>`);
    this.strip = this.comp.querySelector('.strip') as HTMLElement;
    e.appendChild(this.comp);
    for (const [a, t] of CARD) this.addMark(`<span>${t}</span>`, 'm c' + (t === 'С' ? ' n' : ''), a);
    for (let i = 0; i < 24; i++) if (i % 3) this.addMark('', 'm tk', (i / 24) * TAU);

    this.online = h('div', 'online', `<span class="chip" title="В городе сейчас"><i class="dot"></i>${statIcon('people', 'si')}<b>0</b><span class="mut">онлайн</span></span>`);
    (this.online.querySelector('.si') as HTMLElement).style.cssText = 'width:18px;height:18px';
    this.onlineN = this.online.querySelector('b') as HTMLElement;
    e.appendChild(this.online);

    this.cross = h('div', 'cross'); e.appendChild(this.cross);
    this.prompt = h('div', 'prompt'); e.appendChild(this.prompt);
    this.ghost = h('div', 'ghostban'); this.ghost.hidden = true; e.appendChild(this.ghost);
    this.perf = h('div', 'perf'); this.perf.hidden = true; e.appendChild(this.perf);
    this.clickp = h('div', 'clickplay', '<i class="mouse" aria-hidden="true"></i>Кликни, чтобы вернуться в игру'); this.clickp.hidden = true; e.appendChild(this.clickp);
    this.hints = h('div', 'hints', `<span><i class="kc sm dk">Tab</i>Персонаж</span><span><i class="kc sm dk">M</i>Карта</span><span><i class="kc sm dk">Enter</i>Чат</span><span><i class="kc sm dk">F1</i>Помощь</span>`);
    e.appendChild(this.hints);
  }

  private addMark(html: string, cls: string, ang: number, x?: number, y?: number): Mark {
    const el = h('div', cls, html);
    this.strip.appendChild(el);
    const m: Mark = { el, ang, x, y, vis: true, tx: NaN };
    this.marks.push(m);
    return m;
  }

  /** Building markers on the compass (rebuilt on layout change). */
  setLayout() {
    this.marks = this.marks.filter((m) => { if (m.x != null) { m.el.remove(); return false; } return true; });
    const L = this.c.host.store.layout; if (!L) return;
    for (const b of L.buildings) {
      if (b.soon) continue;
      const m = this.addMark(`<i class="d"></i><span class="lb"><span class="emo">${esc(b.icon || '')}</span> ${esc(b.title)}</span>`, 'm b', 0, toX(b.door.x), toZ(b.door.y));
      m.lab = true;
    }
  }

  setHero(H: Hero | null) {
    if (!H) return;
    this.lv.textContent = String(H.level);
    this.nm.textContent = H.name;
    this.cls.textContent = roleTitle(H);
    const hp = hpInfo(H), xp = xpInfo(H);
    const dead = !!H.ghost;
    this.hpBar.classList.toggle('dead', dead);
    this.hpBar.classList.toggle('low', !dead && hp.pct < 0.3);
    const w = `calc(${(hp.pct * 100).toFixed(1)}% - 4px)`;
    if (this.lastHp >= 0 && hp.now < this.lastHp) { this.hpGhost.style.width = this.hpFill.style.width; requestAnimationFrame(() => { this.hpGhost.style.width = w; }); }
    else this.hpGhost.style.width = w;
    this.hpFill.style.width = w; this.lastHp = hp.now;
    this.hpT.textContent = dead ? '👻 призрак' : `${hp.now} / ${hp.max}`;
    this.xpFill.style.width = `calc(${(xp.pct * 100).toFixed(1)}% - 4px)`;
    this.xpT.textContent = xp.xneed == null ? 'максимум' : `${xp.xin} / ${xp.xneed}`;
    // money
    this.money.innerHTML = coinsHtml(H.money);
    // 29.10: Halloween candies (site hero card «🍬 Конфеты», hero.hw.c) — shown only while the site sends them
    { const hw = (H as { hw?: { c?: unknown } | null }).hw; const on = !!hw; this.candy.hidden = !on; if (on) this.candy.textContent = `🍬 ${Math.max(0, Math.floor(+(hw!.c as number) || 0))}`; }
    if (this.lastMoney != null && H.money !== this.lastMoney) this.floatMoney(H.money - this.lastMoney);
    this.lastMoney = H.money;
    // social
    const s = H.soc;
    if (s) { this.soc.hidden = false; this.soc.classList.toggle('bad', !!s.bad); this.soc.innerHTML = `<span class="emo">${esc(s.icon)}</span>${esc(s.rankName)} · ${s.score} <span class="mut">#${s.place}</span>`; this.soc.title = `Соц. рейтинг: место ${s.place} из ${s.total}`; }
    else this.soc.hidden = true;
    if (this.lastLevel != null && H.level > this.lastLevel) this.levelUp(H.level);
    this.lastLevel = H.level;
    this.tickGhost();
  }

  private floatMoney(d: number) {
    const f = h('span', 'mfloat' + (d < 0 ? ' neg' : ''), (d > 0 ? '+' : '−') + coinsHtml(Math.abs(d)));
    const r = this.money.getBoundingClientRect(), r0 = this.c.ui.getBoundingClientRect(), k = this.c.scale || 1;
    f.style.left = ((r.left - r0.left) / k + 10) + 'px'; f.style.top = ((r.top - r0.top) / k - 4) + 'px';
    f.style.display = 'flex'; f.style.gap = '4px'; f.style.alignItems = 'center';
    this.el.appendChild(f); setTimeout(() => f.remove(), 1700);
  }

  private levelUp(lv: number) {
    const sc = (() => { try { const D = (window as any).MDDoodle; const p = D && D.part && D.part('scenes'); return p && p.level && p.level.title; } catch { return null; } })();
    const t = h('div', 'lvup', `<b>${esc(sc || 'УРОВЕНЬ')} ${lv}</b><span>Новый уровень!</span>`);
    this.el.appendChild(t); setTimeout(() => t.remove(), 2500);
  }

  private tickGhost() {
    const H = this.c.host.store.hero;
    if (H && H.ghost) {
      this.ghost.hidden = false;
      const du = +(H.deadUntil || 0);
      this.ghost.innerHTML = `👻 Пал в Походе${du > Date.now() ? ` · до воскрешения <b>${plainCountdown(du)}</b>` : ''} · раньше — свиток воскрешения`;
      if (du > Date.now()) this.hpT.textContent = '👻 ' + plainCountdown(du);
    } else this.ghost.hidden = true;
  }

  setOnline(n: number) { this.onlineN.textContent = String(n); }
  togglePerf() { this.perfOn = !this.perfOn; this.perf.hidden = !this.perfOn; }

  /** Per frame. Must not allocate in the steady state. */
  update(dt: number) {
    const host = this.c.host, menu = this.c.opened();
    this.playT += dt; this.secT += dt;
    if (!this.hintsHidden && this.playT > HINTS_S) { this.hintsHidden = true; this.hints.classList.add('off'); }
    if (this.secT >= 1) { this.secT = 0; this.tickGhost(); }
    if (this.perfOn) {
      this.perfT += dt;
      if (this.perfT > 0.5) {
        this.perfT = 0;
        const s = host.stats() as any;
        this.perf.textContent = `${Math.round(s.fps)} fps · ${(+s.ms).toFixed(1)} ms` + (s.calls != null ? ` · ${s.calls} calls · ${Math.round(s.tris / 1000)}k tris` : '') + (s.scale != null ? ` · ×${(+s.scale).toFixed(2)}` : '');
      }
    }
    if (menu) { if (this.clickOn) this.setClick(false); this.unlockedT = 0; return; }
    this.tickClick(dt);
    // compass
    const yawF = extras(host).yaw;
    const yaw = yawF ? yawF.call(host) : 0;
    const me = host.store.me, pos = me ? null : extras(host).pos?.();
    const px = me ? me.x : pos ? pos[0] : NaN, py = me ? me.y : pos ? pos[1] : NaN;
    if (yaw !== this.lastYaw || px === px) {
      this.lastYaw = yaw;
      const X = toX(px), Z = toZ(py), half = this.compW / 2, k = this.compW / FOV_COMPASS;
      for (let i = 0; i < this.marks.length; i++) {
        const m = this.marks[i];
        let ang = m.ang, vis = true;
        if (m.x != null) {
          if (px !== px) vis = false;
          else {
            const dx = m.x - X, dz = m.y! - Z;
            const d2 = dx * dx + dz * dz;
            if (d2 > 900 || d2 < 1) vis = false;   // within 30 m, not the one we stand in
            ang = Math.atan2(-dx, -dz);
          }
        }
        const rel = wrap(ang - yaw);
        if (Math.abs(rel) > FOV_COMPASS / 2) vis = false;
        if (vis !== m.vis) { m.vis = vis; m.el.style.display = vis ? '' : 'none'; }
        if (vis) {
          const tx = Math.round(half - rel * k); if (tx !== m.tx) { m.tx = tx; m.el.style.left = tx + 'px'; }
          // only the building near the centre of the strip shows its title (others: a dot) — no label collisions
          if (m.x != null) { const lab = Math.abs(rel) < 0.16; if (lab !== m.lab) { m.lab = lab; m.el.classList.toggle('lab', lab); } }
        }
      }
    }
    this.mini.update(dt);
    // crosshair + prompt
    if (this.driven) {
      const fp = host.getCameraMode() === 'fp', hot = this.ptext != null;
      const cs = (fp ? 'f' : 'n') + (hot ? '1' : '0');
      if (cs !== this.lastCross) { this.lastCross = cs; this.cross.hidden = !fp; this.cross.classList.toggle('hot', hot); }
      if (this.pDirty) {
        this.pDirty = false;
        if (this.ptext) { const v = promptView(this.ptext); this.prompt.className = 'prompt on' + (v.muted ? ' soon' : ''); this.prompt.innerHTML = v.html; }
        else this.prompt.className = 'prompt';
      }
      return;
    }
    const ft = host.focusTarget();
    const fp = host.getCameraMode() === 'fp';
    const cs = (fp ? 'f' : 'n') + (ft ? '1' : '0');
    if (cs !== this.lastCross) { this.lastCross = cs; this.cross.hidden = !fp; this.cross.classList.toggle('hot', !!ft); }
    const key = ft ? ft.id + '|' + ft.title : '';
    if (key !== this.lastTarget) {
      this.lastTarget = key;
      if (ft) {
        const soon = !!(ft as any).soon;
        this.prompt.className = 'prompt on' + (soon ? ' soon' : '');
        this.prompt.innerHTML = soon ? `<span class="ic emo">🚧</span>${esc(ft.title)} — скоро откроется`
          : `<i class="kc">E</i>Войти: ${ft.icon ? `<span class="ic emo">${esc(ft.icon)}</span>` : ''}${esc(ft.title)}`;
      } else this.prompt.className = 'prompt';
    }
  }

  /**
   * «Кликни, чтобы вернуться в игру»: only after the pointer lock was really held and then lost while gameplay is on
   * (closing a menu, alt-tab…). Never in environments without pointer lock or before any user gesture (headless demo).
   * While it shows, the door prompt and the crosshair are hidden so the screen never stacks two prompts.
   */
  private tickClick(dt: number) {
    const inp = this.c.host.input;
    if (inp.locked) { this.hadLock = true; this.unlockedT = 0; if (this.clickOn) this.setClick(false); return; }
    const want = this.lockOk && this.gestured && this.hadLock && inp.gameplay && !this.c.typing();
    if (!want) { this.unlockedT = 0; if (this.clickOn) this.setClick(false); return; }
    this.unlockedT += dt;
    if (!this.clickOn && this.unlockedT > 0.35) this.setClick(true);   // short grace: a re-lock right after a menu closes
  }
  private setClick(on: boolean) { this.clickOn = on; this.clickp.hidden = !on; this.el.classList.toggle('unlocked', on); }

  /** Key hints (bottom-right) for HINTS_S seconds: on start, after a menu closes, on F1. */
  showHints() { this.playT = 0; this.hintsHidden = false; this.hints.classList.remove('off'); }
}

export function coinsHtml(n: number): string {
  const cs = coinStyle();
  return moneyCompact(n).map(([k, v]) => {
    let ic = `<i class="coin ${k}"></i>`;
    if (cs && typeof cs.svg === 'function') { try { ic = `<i class="coin svg">${cs.svg(k, 18)}</i>`; } catch { /* keep css coin */ } }
    return `<span class="mp" style="display:inline-flex;align-items:center;gap:4px">${ic}<b>${v}</b></span>`;
  }).join('');
}
