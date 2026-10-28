import { describe, it, expect } from 'vitest';
import { nickDefaults, normColor, jhash, appearanceFrom } from '../src/avatar/appearance';
import { chTraits, chFaceBits, chDims, chMix } from '../src/avatar/cherts';
import { getModel, releaseModel } from '../src/avatar/model';

/** MDDoodle.defaultsFor(nick, 'cherts') of the site's doodle.js (styles/cherts, 28.10), demo nicks only. */
const SITE: Record<string, { shape: string; color: string; color2: string; eyes: string; mouth: string; blush: boolean; hat: string; capeColor: string }> = {"imp1": {"shape": "tall", "color": "#b33a8a", "color2": "hsl(210 75% 55%)", "eyes": "sly", "mouth": "grin", "blush": false, "hat": "none", "capeColor": "#2a1a22"}, "imp2": {"shape": "bean", "color": "#7a3ab3", "color2": "hsl(304 75% 55%)", "eyes": "sly", "mouth": "open", "blush": true, "hat": "antenna", "capeColor": "#2a1a22"}, "imp3": {"shape": "ghost", "color": "#b33a8a", "color2": "hsl(15 75% 55%)", "eyes": "cyclops", "mouth": "grin", "blush": false, "hat": "bandana", "capeColor": "#2a1a22"}, "imp4": {"shape": "ghost", "color": "#d94a1a", "color2": "hsl(343 75% 55%)", "eyes": "slit", "mouth": "tongue", "blush": false, "hat": "tophat", "capeColor": "#2a1a22"}, "imp5": {"shape": "egg", "color": "#d94a1a", "color2": "hsl(6 75% 55%)", "eyes": "slit", "mouth": "open", "blush": false, "hat": "wizard", "capeColor": "#2a1a22"}, "imp6": {"shape": "ball", "color": "#c8102e", "color2": "hsl(236 75% 55%)", "eyes": "sly", "mouth": "grin", "blush": false, "hat": "none", "capeColor": "#2a1a22"}, "imp7": {"shape": "ghost", "color": "#c8102e", "color2": "hsl(237 75% 55%)", "eyes": "stars", "mouth": "tongue", "blush": false, "hat": "bandana", "capeColor": "#2a1a22"}, "imp8": {"shape": "tall", "color": "#5aae6a", "color2": "hsl(284 75% 55%)", "eyes": "slit", "mouth": "open", "blush": false, "hat": "sprout", "capeColor": "#2a1a22"}, "imp9": {"shape": "cone", "color": "#c8102e", "color2": "hsl(98 75% 55%)", "eyes": "dots", "mouth": "tongue", "blush": false, "hat": "party", "capeColor": "#2a1a22"}, "imp10": {"shape": "tall", "color": "#9a1a3a", "color2": "hsl(4 75% 55%)", "eyes": "happy", "mouth": "grin", "blush": false, "hat": "none", "capeColor": "#2a1a22"}, "imp11": {"shape": "egg", "color": "#ff5a5a", "color2": "hsl(51 75% 55%)", "eyes": "dots", "mouth": "grin", "blush": true, "hat": "horns", "capeColor": "#2a1a22"}, "imp12": {"shape": "ball", "color": "#e83a3a", "color2": "hsl(23 75% 55%)", "eyes": "big", "mouth": "grin", "blush": true, "hat": "none", "capeColor": "#2a1a22"}, "demo_a": {"shape": "cone", "color": "#e83a3a", "color2": "hsl(354 75% 55%)", "eyes": "dots", "mouth": "tongue", "blush": false, "hat": "party", "capeColor": "#2a1a22"}, "demo_b": {"shape": "ball", "color": "#e83a3a", "color2": "hsl(118 75% 55%)", "eyes": "slit", "mouth": "grin", "blush": false, "hat": "party", "capeColor": "#2a1a22"}, "чертёнок": {"shape": "box", "color": "#ff5a5a", "color2": "hsl(316 75% 55%)", "eyes": "slit", "mouth": "tongue", "blush": true, "hat": "none", "capeColor": "#2a1a22"}, "TestUser": {"shape": "egg", "color": "#ff5a5a", "color2": "hsl(160 75% 55%)", "eyes": "sly", "mouth": "tongue", "blush": true, "hat": "bow", "capeColor": "#2a1a22"}, "x": {"shape": "cone", "color": "#ff8fb0", "color2": "hsl(39 75% 55%)", "eyes": "dots", "mouth": "grin", "blush": false, "hat": "tophat", "capeColor": "#2a1a22"}, "yy": {"shape": "box", "color": "#5aae6a", "color2": "hsl(72 75% 55%)", "eyes": "sly", "mouth": "grin", "blush": false, "hat": "none", "capeColor": "#2a1a22"}, "zz9": {"shape": "egg", "color": "#5aae6a", "color2": "hsl(228 75% 55%)", "eyes": "sly", "mouth": "open", "blush": true, "hat": "none", "capeColor": "#2a1a22"}, "бес": {"shape": "ball", "color": "#5aae6a", "color2": "hsl(153 75% 55%)", "eyes": "dots", "mouth": "open", "blush": false, "hat": "halo", "capeColor": "#2a1a22"}};

describe('cherts: looks by nick', () => {
  it('matches the site defaultsFor for every field', () => {
    for (const [n, s] of Object.entries(SITE)) {
      const d = nickDefaults(n, 'cherts');
      expect({ n, shape: d.shape, color: d.color, color2: d.color2, eyes: d.eyes, mouth: d.mouth, blush: d.blush, hat: d.hat, capeColor: d.capeColor })
        .toEqual({ n, shape: s.shape, color: normColor(s.color), color2: normColor(s.color2), eyes: s.eyes, mouth: s.mouth, blush: s.blush, hat: s.hat, capeColor: s.capeColor });
    }
  });
  it('traits are deterministic, cover every kind, and pack the face bits', () => {
    const horns = new Set<string>(), tails = new Set<string>(), tips = new Set<string>();
    for (let i = 0; i < 400; i++) { const t = chTraits(jhash('imp' + i)); horns.add(t.horn); tails.add(t.tshape); tips.add(t.tip); }
    expect([...horns].sort()).toEqual(['broken', 'bull', 'cone', 'goat', 'nub', 'ram']);
    expect([...tails].sort()).toEqual(['curl', 'ground', 'hook', 'loop', 'scurve', 'wave']);
    expect([...tips].sort()).toEqual(['arrow', 'flame', 'heart', 'tuft']);
    const t = chTraits(jhash('imp7'));
    expect(chTraits(jhash('imp7'))).toEqual(t);
    expect(nickDefaults('imp7', 'cherts').iris).toBe(chFaceBits(t));
  });
  it('mixes colours like the site', () => {
    expect(chMix('#ff0000', '#000000', 0.5)).toBe('#800000');
    expect(chMix('hsl(1 2% 3%)', '#000000', 0.5)).toBe('hsl(1 2% 3%)');
  });
});

describe('cherts: 3D model', () => {
  const SHAPES = ['bean', 'box', 'ball', 'tall', 'ghost', 'cone', 'egg'];
  it('builds every form with sane dims, wings, tail and a bounded triangle count', () => {
    const out: string[] = [];
    for (const shape of SHAPES) for (const [i, gear] of [{}, { w: 'sword', a: 'lorica', am: 'heavy' }].entries()) {
      const app = appearanceFrom('imp' + shape + i, { lk: { shape, acc: i ? ['cape'] : [] }, g: gear }, 'cherts');
      const m = getModel(app);
      const tris = m.geo.index!.count / 3, mid = m.mid.index!.count / 3, low = m.low.index!.count / 3;
      out.push(`${shape}${i ? '+gear' : ''}: ${tris} / ${mid} / ${low}`);
      expect(m.wings).toBe(true);
      expect(m.hasTail).toBe(true);
      expect(m.hasLegs).toBe(shape !== 'ghost' && shape !== 'egg');
      expect(m.headTop).toBeGreaterThan(m.dims.top - 0.01);
      const p = m.geo.attributes.position.array as Float32Array;
      for (let k = 0; k < p.length; k++) expect(Number.isFinite(p[k])).toBe(true);
      expect(tris).toBeLessThan(16000);
      expect(low).toBeLessThan(1500);
      releaseModel(m);
    }
    console.log('cherts tris (lod0 / lod1 / lod2):\n' + out.join('\n'));
  });
  it('dims follow the site proportions (eyes below the top, arms below the eyes except the brute)', () => {
    for (const s of SHAPES) {
      const d = chDims(s, 0.5);
      expect(d.eyeY).toBeLessThan(d.top);
      expect(d.mouthY).toBeLessThan(d.eyeY);
      if (s !== 'box') expect(d.armY).toBeLessThan(d.eyeY); else expect(d.armY).toBeGreaterThan(d.eyeY);
    }
  });
});
