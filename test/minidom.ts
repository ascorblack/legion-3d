/**
 * A tiny DOM for node tests (no jsdom in the repo): enough HTML parsing, selectors (tag #id .class [a] [a="v"] [a^="v"], descendant
 * and child combinators, lists), events with bubbling, click() (not on disabled controls), form.requestSubmit(), input.value.
 */
type Listener = (e: any) => void;
const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'source', 'wbr']);
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(#?\w+);/g, (m, k) => ENT[k] ?? (k.startsWith('#') ? String.fromCharCode(+k.slice(1)) : m));

export class MText { nodeType = 3; parentElement: MEl | null = null; constructor(public data: string) {} get textContent() { return this.data; } }
export class MEl {
  nodeType = 1;
  attrs = new Map<string, string>();
  childNodes: (MEl | MText)[] = [];
  parentElement: MEl | null = null;
  private ls = new Map<string, Listener[]>();
  private _value: string | null = null;
  clicks = 0;
  constructor(public tagName: string) { this.tagName = tagName.toUpperCase(); }
  get children() { return this.childNodes.filter((n): n is MEl => n.nodeType === 1); }
  getAttribute(k: string) { return this.attrs.has(k) ? this.attrs.get(k)! : null; }
  hasAttribute(k: string) { return this.attrs.has(k); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  removeAttribute(k: string) { this.attrs.delete(k); }
  get id() { return this.getAttribute('id') || ''; }
  get className() { return this.getAttribute('class') || ''; }
  get classList() {
    const get = () => (this.getAttribute('class') || '').split(/\s+/).filter(Boolean), set = (a: string[]) => this.setAttribute('class', a.join(' '));
    return { contains: (c: string) => get().includes(c), add: (c: string) => { if (!get().includes(c)) set([...get(), c]); }, remove: (c: string) => set(get().filter((x) => x !== c)), toggle: (c: string, on?: boolean) => { const has = get().includes(c); const want = on ?? !has; if (want && !has) set([...get(), c]); if (!want && has) set(get().filter((x) => x !== c)); return want; } };
  }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v: boolean) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v: boolean) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
  get value() { return this._value ?? this.getAttribute('value') ?? ''; }
  set value(v: string) { this._value = String(v); }
  get placeholder() { return this.getAttribute('placeholder') || ''; }
  get textContent(): string { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(t: string) { this.childNodes = []; if (t) this.append(new MText(String(t))); }
  set innerHTML(h: string) { this.childNodes = []; parseInto(this, h); }
  get innerHTML() { return ''; }
  append(n: MEl | MText) { n.parentElement = this; this.childNodes.push(n); }
  appendChild(n: MEl) { this.append(n); return n; }
  remove() { const p = this.parentElement; if (p) { p.childNodes = p.childNodes.filter((x) => x !== this); this.parentElement = null; } }
  contains(n: MEl | null) { for (let p = n; p; p = p.parentElement) if (p === this) return true; return false; }
  descendants(): MEl[] { const out: MEl[] = []; const walk = (e: MEl) => { for (const c of e.children) { out.push(c); walk(c); } }; walk(this); return out; }
  querySelectorAll(sel: string): MEl[] { const S = parseSel(sel); return this.descendants().filter((e) => S.some((s) => matchComplex(e, s, this))); }
  querySelector(sel: string): MEl | null { return this.querySelectorAll(sel)[0] || null; }
  matches(sel: string) { return parseSel(sel).some((s) => matchComplex(this, s, null)); }
  closest(sel: string): MEl | null { for (let p: MEl | null = this; p; p = p.parentElement) if (p.matches(sel)) return p; return null; }
  getElementById(id: string) { return this.descendants().find((e) => e.id === id) || null; }
  addEventListener(t: string, fn: Listener) { const a = this.ls.get(t) || []; a.push(fn); this.ls.set(t, a); }
  removeEventListener(t: string, fn: Listener) { this.ls.set(t, (this.ls.get(t) || []).filter((x) => x !== fn)); }
  dispatchEvent(ev: { type: string; bubbles?: boolean }) {
    const e: any = { type: ev.type, target: this, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
    for (let p: MEl | null = this; p; p = p.parentElement) { for (const fn of p.ls.get(ev.type) || []) fn.call(p, e); if (e.stopped || (ev.bubbles === false && p === this && ev.type !== 'click' && ev.type !== 'submit')) break; }
    return !e.defaultPrevented;
  }
  click() { if (this.disabled && (this.tagName === 'BUTTON' || this.tagName === 'INPUT')) return; this.clicks++; this.dispatchEvent({ type: 'click', bubbles: true }); }
  requestSubmit() { this.dispatchEvent({ type: 'submit', bubbles: true }); }
  blur() { /* */ }
  focus() { /* */ }
}

function parseInto(root: MEl, html: string) {
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let cur = root, m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) { const t = m[1].toUpperCase(); for (let p: MEl | null = cur; p && p !== root; p = p.parentElement) if (p.tagName === t) { cur = p.parentElement!; break; } continue; }
    if (m[2]) {
      const el = new MEl(m[2]);
      const ar = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g; let a: RegExpExecArray | null;
      while ((a = ar.exec(m[3] || ''))) el.setAttribute(a[1], decode(a[2] ?? a[3] ?? a[4] ?? ''));
      cur.append(el);
      if (!m[4] && !VOID.has(m[2].toLowerCase())) cur = el;
      continue;
    }
    if (m[5]) cur.append(new MText(decode(m[5])));
  }
}

type Compound = { tag?: string; id?: string; cls: string[]; attrs: { k: string; op?: string; v?: string }[] };
type Complex = { parts: Compound[]; combs: string[]; scope?: boolean };
const cache = new Map<string, Complex[]>();
function parseSel(sel: string): Complex[] {
  const hit = cache.get(sel); if (hit) return hit;
  const out = sel.split(/,(?![^[]*\])/).map((s) => s.trim()).filter(Boolean).map((s) => {
    let scope = false; if (s.startsWith(':scope')) { scope = true; s = s.slice(6).trim(); }
    const toks = s.replace(/\s*>\s*/g, ' > ').split(/\s+(?![^[]*\])/);
    const parts: Compound[] = [], combs: string[] = [];
    let pend = ' ';
    if (scope && toks[0] === '>') { toks.shift(); }
    for (const t of toks) { if (t === '>') { pend = '>'; continue; } if (parts.length) combs.push(pend); pend = ' '; parts.push(parseCompound(t)); }
    return { parts, combs, scope };
  });
  cache.set(sel, out); return out;
}
function parseCompound(t: string): Compound {
  const c: Compound = { cls: [], attrs: [] };
  const re = /^([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([\^]?=)"?([^"\]]*)"?)?\]/g; let m: RegExpExecArray | null;
  while ((m = re.exec(t))) { if (m[1]) c.tag = m[1].toUpperCase(); else if (m[2]) c.id = m[2]; else if (m[3]) c.cls.push(m[3]); else if (m[4]) c.attrs.push({ k: m[4], op: m[5], v: m[6] }); }
  return c;
}
function matchCompound(e: MEl, c: Compound) {
  if (c.tag && e.tagName !== c.tag) return false;
  if (c.id && e.id !== c.id) return false;
  for (const k of c.cls) if (!e.classList.contains(k)) return false;
  for (const a of c.attrs) { const v = e.getAttribute(a.k); if (v == null) return false; if (a.op === '=' && v !== a.v) return false; if (a.op === '^=' && !v.startsWith(a.v!)) return false; }
  return true;
}
function matchComplex(e: MEl, s: Complex, scope: MEl | null): boolean {
  const n = s.parts.length - 1;
  if (!matchCompound(e, s.parts[n])) return false;
  let cur: MEl | null = e;
  for (let i = n - 1; i >= 0; i--) {
    const comb = s.combs[i];
    if (comb === '>') { cur = cur!.parentElement; if (!cur || !matchCompound(cur, s.parts[i])) return false; }
    else { let p: MEl | null = cur!.parentElement; while (p && !matchCompound(p, s.parts[i])) p = p.parentElement; if (!p) return false; cur = p; }
  }
  if (s.scope) return cur!.parentElement === scope;
  return true;
}

/** A fake document with a body; `getElementById` searches the whole tree. */
export function makeDoc() {
  const html = new MEl('html'), body = new MEl('body'); html.append(body);
  return { documentElement: html, body, getElementById: (id: string) => html.getElementById(id), querySelector: (s: string) => html.querySelector(s), querySelectorAll: (s: string) => html.querySelectorAll(s), createElement: (t: string) => new MEl(t) };
}
