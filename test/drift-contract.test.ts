import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-ignore — plain ESM script
import { checkContract, fingerprints, diffPrints, topKeys, braceBlock, objectKeys } from '../scripts/drift.mjs';

const contract = JSON.parse(readFileSync('src/data/site-contract.json', 'utf8'));

describe('site contract', () => {
  it('every check has an id, a reason, a severity and what to check', () => {
    for (const c of contract.checks) {
      expect(c.id && c.why).toBeTruthy();
      expect(['break', 'degrade']).toContain(c.severity);
      if (c.kind === 'keys') expect(c.obj && c.file && c.keys?.length).toBeTruthy();
      else if (c.kind === 'global') expect(c.name && c.file).toBeTruthy();
      else expect(() => new RegExp(c.re)).not.toThrow();
      if (c.kind === 'dom') expect(c.sel).toBeTruthy();
      if (c.when) expect(['page', 'city', 'lazy']).toContain(c.when);
    }
    expect(new Set(contract.checks.map((c: any) => c.id)).size).toBe(contract.checks.length);
  });
  it('reports a missing hook and a missing script', () => {
    const files = { '/site/city.js': 'window.LGCity = { go(){}, debug(){} }' };
    const f = checkContract(files, { checks: [
      { id: 'go', file: 'city.js', re: '\\bgo\\s*[:(]', severity: 'break', why: '' },
      { id: 'panel', file: 'city.js', re: '\\bpanel\\s*[:(]', severity: 'break', why: '' },
      { id: 'mine', file: 'mine.js', re: 'LGMine', severity: 'degrade', why: '' },
    ] });
    expect(f.map((x: any) => [x.id, x.reason])).toEqual([['panel', 'not found'], ['mine', 'script mine.js not found']]);
  });
  it('fingerprints strip the channel and diff changed / new / gone files', () => {
    const a = fingerprints({ '/c/abc/site/a.js': '1', '/site/b.js': '2' });
    expect(Object.keys(a)).toEqual(['/c/…/site/a.js', '/site/b.js']);
    const b = fingerprints({ '/c/xyz/site/a.js': '1!', '/site/c.js': '3' });
    expect(diffPrints(b, a)).toEqual({ changed: ['/c/…/site/a.js'], added: ['/site/c.js'], removed: ['/site/b.js'] });
  });
  it('topKeys: shorthand, methods, quoted keys, comments between keys; a key inside a // comment is not a key', () => {
    const src = `window.LGCity = {
      board: { render: (b) => b, read: (i) => i },   // 22.10: a comment
      open, close, sleep,
      'quoted': 1, async later() { return { inner: 1 }; }, get on() { return 1; },
      /* block */ debug: () => ({ me: [1, 2] }),
      questChanged: () => {},   // 25.10: comment that swallowed towns: () => TLIST, where: () => ({ id: 1 }),
      go: (x, y) => x + y, panel: (id) => id,
    };`;
    const b = braceBlock(src, src.indexOf('{'));
    expect(topKeys(b)).toEqual(['board', 'open', 'close', 'sleep', 'quoted', 'later', 'on', 'debug', 'questChanged', 'go', 'panel']);
    expect([...objectKeys(src, 'LGCity')]).not.toContain('where');
  });
  it("kind 'keys' fails on a key that only exists in a comment (city.js 27.10 where/towns)", () => {
    const files = { '/site/city.js': 'window.LGCity = {\n  go: (x, y) => 1, // towns: () => TLIST, where: () => 1,\n  debug: () => 1,\n};' };
    const f = checkContract(files, { checks: [
      { id: 'core', kind: 'keys', obj: 'LGCity', file: 'city.js', keys: ['go', 'debug'], severity: 'break', why: '' },
      { id: 'towns', kind: 'keys', obj: 'LGCity', file: 'city.js', keys: ['where', 'towns'], severity: 'degrade', why: '' },
      { id: 'other', kind: 'keys', obj: 'LGOther', file: 'city.js', keys: ['x'], severity: 'degrade', why: '' },
    ] });
    expect(f.map((x: any) => [x.id, x.missing])).toEqual([['towns', ['where', 'towns']], ['other', ['LGOther']]]);
  });
  it("kind 'global': UMD exports in node:vm, text fallback for browser-only scripts", () => {
    const files = {
      '/site/campmap.js': "(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.LGCampMap = f(); })(this, function () { return { get() { return 1; }, map() {} }; });",
      '/site/mine.js': "(() => { document.body; window.LGMine = { open, close, get on() { return 1; } }; })();",
    };
    const f = checkContract(files, { checks: [
      { id: 'camp', kind: 'global', name: 'LGCampMap', file: 'campmap.js', keys: ['get', 'map'], severity: 'degrade', why: '' },
      { id: 'camp2', kind: 'global', name: 'LGCampMap', file: 'campmap.js', keys: ['spawnAt'], severity: 'degrade', why: '' },
      { id: 'mine', kind: 'global', name: 'LGMine', file: 'mine.js', keys: ['open', 'on'], severity: 'degrade', why: '' },
      { id: 'mine2', kind: 'global', name: 'LGMine', file: 'mine.js', keys: ['dig'], severity: 'degrade', why: '' },
    ] });
    expect(f.map((x: any) => [x.id, x.missing])).toEqual([['camp2', ['spawnAt']], ['mine2', ['dig']]]);
  });
});
