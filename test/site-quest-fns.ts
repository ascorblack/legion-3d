/**
 * The site's own boss-card code (quest.js zonesHtml / wingsHtml / bgHtml), cut out of the newest downloaded site copy
 * (`.local/site-* /quest.js`, not in the repo) and run in node:vm with small stubs for its helpers — so a test can check that
 * a fixture view renders on the site the way our adapter reads it. null when no copy with these functions is around.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';

export function siteCopy(file: string, needle: string): string | null {
  const base = resolve(__dirname, '../.local');
  if (!existsSync(base)) return null;
  const dirs = readdirSync(base).filter((d) => /^site-/.test(d) && existsSync(join(base, d, file))).sort().reverse();
  for (const d of dirs) { const src = readFileSync(join(base, d, file), 'utf8'); if (src.includes(needle)) return src; }
  return null;
}

/** The text of `function name(...) {...}` (strings, templates and comments skipped while matching braces). */
export function fnSource(src: string, name: string): string | null {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) return null;
  let i = src.indexOf('{', src.indexOf(')', at)), depth = 0;
  const stack: string[] = [];   // '`' while inside a template (its ${ } push '{')
  for (; i < src.length; i++) {
    const c = src[i];
    const top = stack[stack.length - 1];
    if (top === '`') {
      if (c === '\\') { i++; continue; }
      if (c === '`') { stack.pop(); continue; }
      if (c === '$' && src[i + 1] === '{') { stack.push('{'); i++; continue; }
      continue;
    }
    if (c === "'" || c === '"') { const q = c; for (i++; i < src.length && src[i] !== q; i++) if (src[i] === '\\') i++; continue; }
    if (c === '`') { stack.push('`'); continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === '{') { if (stack.length) stack.push('{'); else depth++; continue; }
    if (c === '}') {
      if (stack.length) { stack.pop(); continue; }
      if (--depth === 0) return src.slice(at, i + 1);
    }
  }
  return null;
}

export interface SiteBoss { zonesHtml(g: unknown, M: unknown, noBtn?: boolean): string; wingsHtml(g: unknown): string; bgHtml(v: unknown): string }

/** zonesHtml / wingsHtml / bgHtml of the site copy, with the quick-action buttons on (qaOn, X.say) like a hero with `qa`. */
export function siteBoss(): SiteBoss | null {
  const src = siteCopy('quest.js', 'function wingsHtml(');
  if (!src) return null;
  const names = ['zonesHtml', 'wingsHtml', 'bgHtml'];
  const parts = names.map((n) => fnSource(src, n));
  if (parts.some((p) => !p)) return null;
  const esc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const ctx: Record<string, unknown> = {
    esc, SCH: null, X: { say: () => {}, act: () => {}, hero: () => ({ qa: 1 }) }, qaOn: () => true,
    svgI: (n: string) => `<i data-i="${n}"></i>`, ico: (n: string) => `<i data-i="${n}"></i>`, hpBar: (v: number) => `<hp v="${v}"></hp>`,
    deadIn: () => null, deadHtml: () => '', jackHtml: () => '', bossArt: () => '<boss></boss>', ncText: (t: string) => esc(t),
    wd: (w: string) => `<w>${esc(w)}</w>`, Math, JSON, Set, Map, Object, Array, String, Number,
  };
  vm.createContext(ctx);
  vm.runInContext(parts.join('\n') + `\n;globalThis.__f = { ${names.join(', ')} };`, ctx, { timeout: 5000 });
  return (ctx as { __f: SiteBoss }).__f;
}
