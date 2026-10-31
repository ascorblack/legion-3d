/**
 * A closed overlay must never catch a click that belongs to the 3D canvas («M → Esc → click → nothing», QA 31.10).
 * Real-browser proof: e2e/overlay-inert.mjs (L3D_BROWSER_E2E=1 runs it from here). Static guards below keep the pattern out of the source:
 *  - the menu shell is inert the moment it starts closing (inert + aria-hidden + pointer-events:none, not only after the CSS fade);
 *  - the veil's own `pointer-events:auto` can never survive a close;
 *  - every full-screen layer (inset:0) of ours is click-through unless it is on the reviewed allow-list.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { CSS } from '../src/ui/styles';
import { deepHit, staleHits, hitGrid, centreIsCanvas, type HitDoc, type HitEl } from './hit-inert';

describe('menu shell closes inert', () => {
  const menus = readFileSync('src/ui/menus.ts', 'utf8');
  it('CSS: a closed .menu and everything in it ignores the pointer immediately', () => {
    expect(CSS).toMatch(/\.menu:not\(\.on\)\s*,\s*\.menu:not\(\.on\) \*\s*\{[^}]*pointer-events:\s*none\s*!important/);
  });
  it('show(null) clears the veil\'s pointer-events and marks the shell inert', () => {
    const show = menus.slice(menus.indexOf('  show(id: string | null) {'), menus.indexOf('  /** A closed menu must not catch'));
    expect(show).toContain('this.setInert(!id)');
    expect(show).toMatch(/if \(!id\) \{[^}]*this\.veil\.style\.pointerEvents = 'none'/);
    const set = menus.slice(menus.indexOf('private setInert'), menus.indexOf('/** Re-render the current page'));
    expect(set).toContain("setAttribute('inert', '')");
    expect(set).toContain("setAttribute('aria-hidden', 'true')");
    expect(set).toContain("removeAttribute('inert')");
  });
  it('the shell starts inert (before the first show())', () => {
    expect(menus).toMatch(/this\.el = h\('div', 'menu'\);\s*this\.setInert\(true\);/);
  });
});

/** A full-screen (inset:0) layer of ours must say pointer-events:none in its own rule, unless reviewed here (key = file:selector). */
const ALLOW: Record<string, string> = {
  'src/content/main.css:#l3d-host': 'the canvas holder: clicks on it ARE the canvas clicks',
  'src/content/main.css:#l3d-splash': 'boot splash; `.out` (pointer-events:none) is added the moment it closes (main.ts splash.close)',
  'src/emotes/wheel.ts:.dim': 'child of .wrap (pointer-events:none, inherited)',
  'src/engine/engine.ts:': 'the canvas itself',
  'src/features/snapshot.ts:': 'image inside the compare panel, which is removed on close',
  'src/ui/styles.ts:.hud': 'child of .ui (pointer-events:none, inherited); interactive children opt in one by one',
  'src/ui/styles.ts:.bar .t': 'label inside a bar', 'src/ui/styles.ts:.cell .cd': 'cooldown shade inside an inventory cell',
  'src/rooms/mine/hud.ts:.l3m-modal': "modal card: renderModal() empties [data-p=modal] when this.card is null (the element is gone, not faded)",
  'src/ui/styles.ts:.hud .mini canvas': 'inside the minimap button',
};
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|css)$/.test(n)) out.push(p); }
  return out;
}
describe('full-screen layers are click-through', () => {
  it('every `position:fixed|absolute; inset:0` layer carries pointer-events:none (or is reviewed)', () => {
    const bad: string[] = [];
    for (const f of walk('src')) {
      const src = readFileSync(f, 'utf8');
      const file = f.replace(/\\/g, '/');
      let from = 0;
      for (;;) {
        const at = src.slice(from).search(/inset:\s*0\s*[;}'"`]/);
        if (at < 0) break;
        const idx = from + at; from = idx + 6;
        const open = src.lastIndexOf('{', idx), close = src.indexOf('}', idx);
        const quoted = (() => { const ls = src.lastIndexOf('\n', idx) + 1; return /cssText|style\.|=\s*['"`]/.test(src.slice(ls, idx)) && !/^\s*[^'"`]*\{/.test(src.slice(ls, idx)); })();
        const body = quoted ? src.slice(Math.max(0, idx - 300), idx + 500) : src.slice(open + 1, close);
        if (!/position:\s*(fixed|absolute)/.test(body)) continue;
        if (/pointer-events:\s*none/.test(body) || /pointerEvents\s*[:=]\s*'none'/.test(body)) continue;
        const sel = quoted ? '' : src.slice(Math.max(src.lastIndexOf('}', open), src.lastIndexOf('`', open), src.lastIndexOf('\n', open)) + 1, open).trim();
        if (ALLOW[`${file}:${sel}`]) continue;
        bad.push(`${file}:${sel} → ${body.trim().replace(/\s+/g, ' ').slice(0, 90)}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('the room-load veil is click-through inline', () => {
    expect(readFileSync('src/content/game.ts', 'utf8')).toMatch(/veilEl\.style\.cssText =[\s\S]{0,400}?pointer-events:none/);
  });
});

describe('hit-inert helper', () => {
  const canvas: HitEl = { tagName: 'CANVAS' };
  const veil: HitEl = { tagName: 'DIV', className: 'veil' };
  const host: HitEl = { tagName: 'DIV', className: 'l3d-ui', shadowRoot: { elementFromPoint: () => veil } };
  const docWith = (top: HitEl): HitDoc => ({ elementFromPoint: () => top });
  it('pierces shadow roots and reports a stale veil', () => {
    expect(deepHit(docWith(host), 5, 5)).toBe(veil);
    const before = hitGrid(docWith(canvas));
    expect(staleHits(docWith(canvas), before)).toEqual([]);
    expect(staleHits(docWith(host), before)).toHaveLength(45);
    expect(centreIsCanvas(docWith(canvas), canvas)).toBe(true);
    expect(centreIsCanvas(docWith(host), canvas)).toBe(false);
  });
});

describe.skipIf(!process.env.L3D_BROWSER_E2E)('real browser (dist-dev/game.html)', () => {
  it('M, L, C, I, P, Z, F10, F9 → close → the canvas takes the click and the lock', () => {
    const r = spawnSync('node', ['e2e/overlay-inert.mjs'], { encoding: 'utf8', env: process.env, timeout: 900000 });
    expect(r.stdout + r.stderr).toContain('OK every closed overlay is inert');
    expect(r.status).toBe(0);
  }, 900000);
});
