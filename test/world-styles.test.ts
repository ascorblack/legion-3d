import { describe, it, expect } from 'vitest';
import { paletteOf, readSitePals } from '../src/world/palette';
import { staticCity } from './world-fixture';
import { fixtureLayout } from '../dev/fixtures';

// a slice of the site's cityart.js PAL (28.10 «art/styles-city-legend») as LGCityArt.PAL exposes it
const SITE = {
  legion: { ink: '#15122e', roof: '#a3122a', sky: 'linear-gradient(#0d0b22, #2b2150)', back: 'wall' },
  cherts: { ink: '#2a0d14', wall: '#2e2228', roof: '#6a1020', water: '#ff7a1a', waterD: '#a8200e', sky: 'linear-gradient(#0e0306 0%, #2a0a10 45%, #5a1418 80%, #8a2a1a 100%)', back: 'cliffs', horns: true, hell: true, iron: true, banner: 'КОТЕЛЬНЫЙ КВАРТАЛ' },
  veggies: { ink: '#2b2118', roof: '#4f9a3a', plaster: '#fff3dc', back: 'garden', sprout: true },
  newstyle: { roof: '#123456', horns: true, wall: 'javascript:alert(1)', sky: 'url(x)' },
};

describe('city quarter palettes per style (site cityart.js, 28.10)', () => {
  it('reads the site table defensively (colours, gradients, flags only)', () => {
    const p = readSitePals(SITE)!;
    expect(p.cherts).toMatchObject({ roof: '#6a1020', hell: true, horns: true, back: 'cliffs' });
    expect(p.cherts.banner).toBeUndefined();
    expect(p.newstyle.wall).toBeUndefined(); expect(p.newstyle.sky).toBeUndefined(); expect(p.newstyle.roof).toBe('#123456');
    expect(readSitePals(null)).toBeUndefined();
    expect(readSitePals({ get x() { throw new Error('no'); } } as any)).toBeUndefined();
  });
  it('cherts is the «Котельный квартал» (no longer Legion\'s): blood-red roofs with horns, lava water, basalt cliffs', () => {
    const P = paletteOf('cherts');
    expect(P.roof).toBe('#6a1020'); expect(P.water).toBe('#ff7a1a');
    expect(P.horns).toBe(true); expect(P.hell).toBe(true); expect(P.back).toBe('cliffs');
    expect(P).not.toEqual(paletteOf('legion'));
    expect(paletteOf('legion').horns).toBeFalsy();
  });
  it('veggies / 42brothers / ugabugi have their own quarter; the site table is laid over the untuned styles only', () => {
    expect(paletteOf('veggies').back).toBe('garden');
    expect(paletteOf('42brothers').roof).toBe('#ff5fa2');
    expect(paletteOf('ugabugi').horns).toBe(true);
    const S = readSitePals({ ...SITE, veggies: { roof: '#00ff00', ink: '#010203' }, legion: { roof: '#00ff00' } })!;
    expect(paletteOf('veggies', S).roof).toBe('#00ff00');
    expect(paletteOf('veggies', S).line).toBe('#010203');
    expect(paletteOf('legion', S).roof).toBe(paletteOf('legion').roof);   // hand-tuned for the 3D light: kept
    const n = paletteOf('newstyle', readSitePals(SITE));                   // unknown to us: Legion's quarter + the site's colours
    expect(n.roof).toBe('#123456'); expect(n.horns).toBe(true); expect(n.wall).toBe(paletteOf('legion').wall);
  });
  it('the cherts fair builds horns on the roofs and a cliff backdrop with lavafalls; other styles do not', () => {
    const run = (st: string) => {
      const r = staticCity(false, { ...fixtureLayout(), styleId: st });
      const cones = r.rec.pieces.filter((p) => p.mat === 'stone' && /^(hall|trainer|forge|board|filler)/.test(p.tag)).length;
      const lava = r.rec.pieces.filter((p) => p.tag === 'backdrop' && p.mat === 'emit').length;
      return { cones, lava, glows: r.k.glows.length };
    };
    const c = run('cherts'), l = run('legion');
    expect(c.cones).toBeGreaterThan(l.cones + 20);
    expect(c.lava).toBeGreaterThan(l.lava + 25);   // lavafalls (2 ribbons each) + glowing chimney mouths
    expect(c.glows).toBeGreaterThan(l.glows);
  });
});
