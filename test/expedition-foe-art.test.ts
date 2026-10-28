import { describe, it, expect } from 'vitest';
import { foeArt, foeArtOf, FOE_ARTS, DG_FOES, LEAD_ARTS, hasLeadArt } from '../src/expedition/adapter';
import { foeGeo, FOE_TOP, FOE_R, FOE_FLY } from '../src/expedition/art';

const tris = (a: (typeof FOE_ARTS)[number]) => { const g = foeGeo(a); return (g.index ? g.index.count : g.attributes.position.count) / 3; };

describe('foe art (fidelity pass 2: leaders, dungeon packs, triangle budget)', () => {
  it('every art builds, stays in its triangle budget and its head height matches FOE_TOP', () => {
    const bad: string[] = [];
    for (const a of FOE_ARTS) {
      const g = foeGeo(a); g.computeBoundingBox();
      const top = g.boundingBox!.max.y, n = tris(a), cap = a === 'golem' ? 2000 : 1100;
      if (n > cap) bad.push(`${a}: ${n} tris > ${cap}`);
      if (top > FOE_TOP[a] + 0.35 || top < FOE_TOP[a] - 0.3) bad.push(`${a}: bbox top ${top.toFixed(2)} vs FOE_TOP ${FOE_TOP[a]}`);
      expect(FOE_R[a]).toBeGreaterThan(0); expect(FOE_FLY[a]).toBeGreaterThanOrEqual(0);
    }
    expect(bad).toEqual([]);
  });
  it('pack leaders get their own drawing (site o.boss), dungeon packs keep theirs', () => {
    expect(foeArtOf('wolf', 'Вожак стаи', true)).toBe('wolfLead');
    expect(foeArtOf('skeleton', '', true)).toBe('skeletonLead');
    expect(foeArtOf('hw_ghost', '', true)).toBe('ghostLead');
    expect(foeArtOf('hw_bat', '', true)).toBe('batLead');
    expect(foeArtOf('hw_skeleton', '', true)).toBe('bonesLead');
    expect(foeArtOf('hw_pumpkin', '', true)).toBe('golem');
    expect(foeArtOf('hw_jack', '', true)).toBe('jack');   // no leader drawing → the crown marks it
    expect(foeArtOf('dg_rat', '', true)).toBe('rat');
    expect(foeArtOf('wolf', '', false)).toBe('wolf');
    for (const v of Object.values(LEAD_ARTS)) { expect(FOE_ARTS).toContain(v); expect(hasLeadArt(v!)).toBe(true); }
    expect(hasLeadArt('jack')).toBe(false);
  });
  it('every dungeon pack maps to a real model, none falls back to the slime', () => {
    for (const [k, a] of Object.entries(DG_FOES)) { expect(foeArt(k)).toBe(a); expect(FOE_ARTS).toContain(a); expect(a).not.toBe('slime'); }
    expect(foeArt('dg_lavaslime')).toBe('lavaslime');
    expect(foeArt('dg_unknown', 'Пещерная крыса')).toBe('rat');
    expect(foeArt('x', 'Пират')).not.toBe('rat');
  });
});
