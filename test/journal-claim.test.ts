/** Site 31.10 journal «Забрать» (app.js jClaimBtn, e.cl): which entries wait for the site's own button. */
import { describe, it, expect } from 'vitest';
import { jClaimable } from '../src/ui/menus';

describe('journal claim', () => {
  it('an entry with a reward that waits (cl, not done) — only then', () => {
    expect(jClaimable({ cl: { go: 'Забрать' } })).toBe(true);
    expect(jClaimable({ cl: { pick: 1 } })).toBe(true);
    expect(jClaimable({ cl: { done: 1 } })).toBe(false);
    expect(jClaimable({ cl: null })).toBe(false);
    expect(jClaimable({})).toBe(false);
  });
});
