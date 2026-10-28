/**
 * Expedition buttons and the command line, mirrored from the SITE'S OWN «Поход» tab (quest.js, 26.10–28.10).
 *
 * The site has two kinds of commands in an expedition:
 *  - PRESSED: buttons (qaBtn `data-qa` → X.act, place / Halloween / goblin / puzzle buttons `data-qpb` → sayLine, the dance chain
 *    `data-qhw`, the rune / code pad `data-qdig`, toggles `data-qsel`, path votes `data-qv` → X.vote). Only for heroes with the
 *    server flag `qa` (quest.js qaOn = X.act && X.hero().qa) — the vote by click also for everybody in the party.
 *  - TYPED: the line «Команда в поход» (`.q-say` form, quest.js sayMount: shown when the view is on and qaOn() && X.say) — the site
 *    parses it like a chat message and sends it by its own route; words must be typed by hand (paste is refused by the site).
 *  Without the flag the site says «пиши в чат» (stream chat) — nothing to press, nothing to type on the site.
 *
 * This module never builds a request: a press clicks the site's own element (its delegated handler sends exactly what a click
 * on the site sends), a typed line is put into the site's own input and its own form is submitted. What the site renders —
 * labels, disabled / pending / accepted / declined states, «отправлено…» / «принято…» lines, the history of lines with the
 * game's answers — is read back from its DOM. Pure DOM reads: works on any ParentNode-like tree (tests use a fake one).
 */

export type SiteBtnKind = 'qa' | 'qpb' | 'qhw' | 'qsel' | 'qdig';
export interface SiteBtn {
  /** stable identity to find the same site element after a repaint: `qa:{json without _l}`, `qpb:line`, `qhw:l`, `qsel:t|x`, `qdig:3` */
  key: string;
  kind: SiteBtnKind;
  label: string;
  /** the site's `<small>` under the label (cooldown, price, «ещё раз - точно») */
  sub?: string;
  disabled: boolean;
  /** the site's state classes, whitelisted: main warn urge big on ok wait bad cd sk */
  cls: string[];
  /** toggles (data-qsel) */
  pressed?: boolean;
  tip?: string;
}
export interface SiteGroup { title?: string; kind: 'row' | 'sel' | 'pad'; btns: SiteBtn[] }
export interface SiteLine { cls: 'ok' | 'wait' | 'bad' | 'warn' | 'info'; text: string }
export interface SiteHist { line: string; st: 'wait' | 'ok' | 'no' | 'note'; msg: string; btn: boolean }
export interface SiteSay { placeholder: string; hint: string; label: string; busy: boolean; warn: string }
export interface SiteControls {
  /** the site has painted its quest tab (a `.q-wrap` exists) */
  painted: boolean;
  groups: SiteGroup[];
  /** status lines of the action area: «отправлено: …», «принято: …», «⚠ Точно бежать?…», «твой ответ: …» */
  lines: SiteLine[];
  /** typed-so-far displays: the rune / code digits (`.qa-dig`), the dance chain (`.q-hwc`) */
  displays: string[];
  /** the site's «Команда в поход» line (null = the site offers none to this user right now) */
  say: SiteSay | null;
  /** the site's «предыдущие команды»: lines and presses with the game's answers (newest last) */
  hist: SiteHist[];
  /** the site's own short hint under the stage: «Напечатай ответ в строке команд внизу - или в чат», «Кнопки ниже = команды чата…» */
  hint: string;
}

/** The site's flag for the buttons and the command line (quest.js qaOn: X.hero().qa). */
export const siteQaOn = (hero: unknown): boolean => !!(hero && (hero as Record<string, unknown>).qa);

const ATTRS: [SiteBtnKind, string][] = [['qa', 'data-qa'], ['qpb', 'data-qpb'], ['qhw', 'data-qhw'], ['qsel', 'data-qsel'], ['qdig', 'data-qdig']];
const BTN_SEL = '[data-qa], [data-qpb], [data-qhw], [data-qsel], [data-qdig]';
/** parts of the tab that are not the expedition's actions: hero card, bag, header (join / leave is the squad block), the line, scheme, journal */
const SKIP_CLS = ['qa-hero', 'ql-hero', 'ql-inv', 'q-bag', 'ql-top', 'q-say', 'ql-log', 'q-jr', 'qa-food', 'q-buy', 'q-shl'];
const KEEP_CLS = ['main', 'warn', 'urge', 'big', 'on', 'ok', 'wait', 'bad', 'cd', 'sk'];

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const has = (el: Element | null | undefined, c: string) => !!(el && el.classList && el.classList.contains(c));

/** `data-qa` JSON → identity without the label (quest.js qaSig). null for bad JSON. */
export function qaSig(raw: string | null): string | null {
  if (!raw) return null;
  try { const o = JSON.parse(raw); if (!o || typeof o !== 'object') return null; delete o._l; return JSON.stringify(o); } catch { return null; }
}
function keyOf(el: Element): { kind: SiteBtnKind; key: string; k?: string } | null {
  for (const [kind, attr] of ATTRS) {
    if (!el.hasAttribute(attr)) continue;
    const v = el.getAttribute(attr) || '';
    if (kind === 'qa') { const s = qaSig(v); if (!s) return null; let k = ''; try { k = String(JSON.parse(s).k || ''); } catch { /* */ } return { kind, key: 'qa:' + s, k }; }
    return { kind, key: `${kind}:${v}` };
  }
  return null;
}
function skipped(el: Element, scope: Element): boolean {
  for (let p: Element | null = el; p && p !== scope; p = p.parentElement) if (SKIP_CLS.some((c) => has(p, c))) return true;
  return false;
}
function groupOf(el: Element, scope: Element): Element | null {
  for (let p = el.parentElement; p && p !== scope; p = p.parentElement) if (has(p, 'qa-sel') || has(p, 'qa-pad') || has(p, 'qa-row') || has(p, 'q-pbg') || has(p, 'q-pzc') || has(p, 'q-hwg')) return p;
  return null;
}
function titleOf(g: Element | null): string | undefined {
  if (!g) return undefined;
  if (has(g, 'qa-sel')) { const s = g.querySelector('span'); return (s && norm(s.textContent).replace(/:$/, '')) || norm(g.getAttribute('aria-label')) || undefined; }
  if (has(g, 'qa-row') && has(g.parentElement, 'q-pbg')) return titleOf(g.parentElement);   // place buttons: «Помочь своим», «Уйти из боя»
  if (has(g, 'q-pbg')) { const s = g.querySelector('span.muted'); return s ? norm(s.textContent) || undefined : undefined; }
  return undefined;
}
function labelOf(el: Element): { label: string; sub?: string } {
  const full = norm(el.textContent), sm = el.querySelector('small'), sub = sm ? norm(sm.textContent) : '';
  let label = sub && full.endsWith(sub) ? norm(full.slice(0, full.length - sub.length)) : full;
  if (!label) return { label: sub || norm(el.getAttribute('aria-label')) || '?' };   // icon buttons: the caption is the label
  return sub && sub !== label ? { label, sub } : { label };
}

/** The part of the site's tab that holds the actions: the layout's action card (qa testers), else the whole painted tab. */
export function siteScope(tab: Element | null): Element | null {
  if (!tab) return null;
  return tab.querySelector('[data-ql="act"]') || tab.querySelector('.q-wrap') || tab;
}

/** Read what the site's quest tab offers now. `tab` = document.getElementById('tab-quest'). */
export function readSite(tab: Element | null): SiteControls {
  const out: SiteControls = { painted: false, groups: [], lines: [], displays: [], say: null, hist: [], hint: '' };
  if (!tab) return out;
  out.painted = !!tab.querySelector('.q-wrap');
  const scope = siteScope(tab)!;
  let cur: { g: Element | null; grp: SiteGroup } | null = null;
  for (const el of Array.from(scope.querySelectorAll(BTN_SEL))) {
    if (skipped(el, scope)) continue;
    const id = keyOf(el); if (!id) continue;
    if (id.kind === 'qa' && (id.k === 'eat' || id.k === 'join' || id.k === 'leave')) continue;   // food: the bag; join / leave: the squad block
    const g = groupOf(el, scope);
    if (!cur || cur.g !== g || !g) {
      const kind: SiteGroup['kind'] = has(g, 'qa-pad') ? 'pad' : has(g, 'qa-sel') ? 'sel' : 'row';
      cur = { g, grp: { title: titleOf(g), kind, btns: [] } }; out.groups.push(cur.grp);
    }
    const { label, sub } = labelOf(el);
    const cls = KEEP_CLS.filter((c) => has(el, c));
    const b: SiteBtn = { key: id.key, kind: id.kind, label, disabled: !!(el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true', cls };
    if (sub) b.sub = sub;
    if (id.kind === 'qsel') b.pressed = el.getAttribute('aria-pressed') === 'true' || has(el, 'on');
    const tip = el.getAttribute('data-tip'); if (tip) b.tip = norm(tip);
    cur.grp.btns.push(b);
  }
  for (const p of Array.from(scope.querySelectorAll('.qa-st'))) {
    if (skipped(p, scope)) continue;
    const t = norm(p.textContent); if (!t) continue;
    const cls: SiteLine['cls'] = has(p, 'wait') ? 'wait' : has(p, 'ok') ? 'ok' : has(p, 'warn') ? 'warn' : has(p, 'q-dg') || has(p, 'bad') ? 'bad' : 'info';
    if (!out.lines.some((l) => l.text === t)) out.lines.push({ cls, text: t });
  }
  out.lines = out.lines.slice(0, 4);
  for (const d of Array.from(scope.querySelectorAll('.qa-dig'))) {
    const b = d.querySelector('b'), s = d.querySelector('span');
    out.displays.push(`Набрано: ${norm(b?.textContent) || '…'}${s ? ' · ' + norm(s.textContent) : ''}`);
  }
  for (const c of Array.from(scope.querySelectorAll('.q-hwc'))) {
    const s = c.querySelector('span'), steps = Array.from(c.querySelectorAll('small')).map((x) => norm(x.textContent)).filter((x) => x && x !== '…');
    out.displays.push(`${norm(s?.textContent) || 'Цепочка'}${steps.length ? ': ' + steps.join(' → ') : ''}`);
  }
  for (const p of Array.from(scope.querySelectorAll('p.muted'))) {
    const t = norm(p.textContent);
    if (/строке команд|Кнопки ниже|кнопки = команды|Кнопка = команда|Пиши ответ в чат|Пиши в чат|строкой:|цепочкой из кнопок/i.test(t)) { out.hint = t; break; }
  }
  const box = tab.querySelector('.q-say');
  if (box && !(box as HTMLElement).hidden) {
    const inp = box.querySelector('input'), send = box.querySelector('.q-says'), w = box.querySelector('.q-sayw');
    out.say = {
      label: norm(box.querySelector('label')?.textContent) || 'Команда в поход',
      placeholder: norm(inp?.getAttribute('placeholder')) || 'Команда в поход',
      hint: norm(box.querySelector('.q-sayn')?.textContent),
      busy: !!(send && (send as HTMLButtonElement).disabled),
      warn: w && !(w as HTMLElement).hidden ? norm(w.textContent) : '',
    };
    for (const li of Array.from(box.querySelectorAll('.q-sayh li'))) {
      const st = (['wait', 'ok', 'no', 'note'] as const).find((c) => has(li, c)) || 'note';
      const line = norm(li.querySelector('b')?.textContent), msg = st === 'note' ? norm(li.textContent) : norm(li.querySelector('span')?.textContent);
      out.hist.push({ line, st, msg, btn: has(li, 'btn') });
    }
    out.hist = out.hist.slice(-3);
  }
  return out;
}

/** The site's element for a key (first enabled match in the action area; for `qv:` the path vote `[data-qv="vid:n"]`). */
export function findSite(tab: Element | null, key: string): Element | null {
  if (!tab) return null;
  if (key.startsWith('qv:')) {
    for (const el of Array.from(tab.querySelectorAll('[data-qv]'))) if (el.getAttribute('data-qv') === key.slice(3) && !(el as HTMLButtonElement).disabled) return el;
    return null;
  }
  const scope = siteScope(tab)!;
  for (const el of Array.from(scope.querySelectorAll(BTN_SEL))) {
    if (skipped(el, scope)) continue;
    const id = keyOf(el);
    if (id && id.key === key) { if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') continue; return el; }
  }
  return null;
}

export type PressResult = 'clicked' | 'missing';
/** Press the site's own element once (its delegated handler does the rest). 'missing' = not rendered / disabled now: nothing pressed. */
export function pressSite(tab: Element | null, key: string): PressResult {
  const el = findSite(tab, key);
  if (!el) return 'missing';
  (el as HTMLElement).click();
  return 'clicked';
}

export type FeedResult = 'sent' | 'held' | 'missing';
/**
 * Type a line into the site's «Команда в поход» and submit its form (quest.js saySend → sayLine: the site's own parse and route,
 * its «подожди - прошлая строка ещё в пути» and «экран просит молчать - нажми Enter ещё раз»). 'sent' = the site queued the line
 * (a new «в пути…» entry with it), 'held' = the site kept it back (its note says why), 'missing' = no command line on the site now.
 */
export function feedSiteSay(tab: Element | null, line: string): FeedResult {
  const box = tab && tab.querySelector('.q-say');
  if (!box || (box as HTMLElement).hidden) return 'missing';
  const inp = box.querySelector('input') as HTMLInputElement | null, form = box.querySelector('form') as HTMLFormElement | null;
  if (!inp || !form) return 'missing';
  const before = box.querySelectorAll('.q-sayh li.wait').length;
  inp.value = line;
  try { inp.dispatchEvent(new Event('input', { bubbles: true })); } catch { /* */ }
  if (typeof form.requestSubmit === 'function') form.requestSubmit();
  else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const box2 = tab!.querySelector('.q-say') || box;   // the site keeps the node; a repaint that replaced it is read anew
  const waits = Array.from(box2.querySelectorAll('.q-sayh li.wait'));
  const last = waits[waits.length - 1];
  return waits.length > before && last && norm(last.querySelector('b')?.textContent) === norm(line) ? 'sent' : 'held';
}

/**
 * Make the site paint its «Поход» tab while it is hidden behind the 3D view (quest.js paints only while `shown`: LGQuest.show is
 * what the site's own tab switch calls). Nothing is sent; returns true when it asked the site to paint.
 */
export function primeSite(W: { LGQuest?: { show?: (on: boolean) => void } } | null | undefined, tab: Element | null): boolean {
  if (!tab || has(tab, 'on')) return false;
  const show = W && W.LGQuest && W.LGQuest.show;
  if (typeof show !== 'function') return false;
  try { show.call(W!.LGQuest, true); } catch { return false; }
  return true;
}

/** «пиши в чат стрима»: the command(s) of a `say` urge as separate chips («Кубок 1 / Кубок 2» → two, «1–4» → 1 2 3 4). */
export function chatChips(text: string): string[] {
  const t = norm(text);
  if (!t) return [];
  const r = /^(\d)\s*[–-]\s*(\d)$/.exec(t);
  if (r && +r[2] > +r[1] && +r[2] - +r[1] < 9) return Array.from({ length: +r[2] - +r[1] + 1 }, (_, i) => String(+r[1] + i));
  return t.split(/\s+\/\s+/).map(norm).filter(Boolean).slice(0, 8);
}

/** Buttons that the number keys 1–4 press: the actions (not the toggles, the digit pad, ⌫ or disabled ones), in the site's order. */
export function hotButtons(c: SiteControls): SiteBtn[] {
  const out: SiteBtn[] = [];
  for (const g of c.groups) for (const b of g.btns) if ((b.kind === 'qa' || b.kind === 'qpb' || (b.kind === 'qhw' && b.key !== 'qhw:<')) && !b.disabled && out.length < 4) out.push(b);
  return out;
}
