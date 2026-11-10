/**
 * Site update 09–10.11 («Игра» mode, mail, arena, guilds, daily tasks, mini-map, fishing, guild tags).
 *  - app.js: hero `gu` → window.LGGameUi; the tabs hero / legion / season / war / arena open as windows over the City
 *    (GU_WIN, guTab) — src/net/gameui.ts mirrors the list; replayCityEnter must take a tab that really switches the page.
 *  - city.js fishWater / fishSeg / fishPond: where a click on the water opens the fishing screen — src/features/fishing.ts
 *    fishWaters mirrors it; the site's own functions run here (node:vm) against the same fixture geometry.
 *  - pause-menu entries for the site's mail / guilds / daily tasks / mini-map / arena (src/features/site-places.ts).
 *  - city.js labOf / citygl.js nameTex: the guild tag `gt` → Appearance.guild → «[tag]» on the nameplate.
 * The checks against the site's code run when a downloaded copy is around (.local/site-*), skipped otherwise.
 */
import { describe, it, expect, afterEach } from 'vitest';
import vm from 'node:vm';
import { GU_WINDOWS, gameUiOn, guWindowOf, openGuWindow, pickReplayTab, replayTabOrder } from '../src/net/gameui';
import { canalWaters, pondWater, fishWaters, fishOn, fishLabel, type FishWater } from '../src/features/fishing';
import feature, { mailBadge, mailOn, mailUnread, dailiesOn, miniMapOn, SITE_TABS, GUILDS_ENTRY } from '../src/features/site-places';
import { pauseItems } from '../src/ui/settings-ext';
import { FISH } from '../src/net/site';
import { appearanceFrom } from '../src/avatar/appearance';
import { siteCopy, fnSource } from './site-quest-fns';
import FC from './fixtures/faircats-map.json';

const APP = siteCopy('app.js', 'window.LGGameUi = ');
const CITY = siteCopy('city.js', 'function fishWater(');
const CMAP = siteCopy('citymap.js', 'LOW');
const FISH2 = siteCopy('fish2.js', "R.className = 'f2'");
const CGL = siteCopy('citygl.js', 'o.gt ?');
const g = globalThis as any;
afterEach(() => { for (const k of ['LGGameUi', 'LGMail', 'LGDailies', 'LegionMiniMap', 'LGFish2On', 'LGOpenFish2', 'document']) delete g[k]; });

/* ------------------------------------------------------------------ «Игра» mode */
type B = { getAttribute(n: string): string | null; hidden: boolean; dataset: Record<string, string>; id: string };
const btn = (tab: string, o: { hidden?: boolean; disabled?: boolean } = {}): B => ({
  id: tab, hidden: !!o.hidden, dataset: { tab }, getAttribute: (n: string) => (n === 'aria-disabled' ? (o.disabled ? 'true' : null) : n === 'data-tab' ? tab : null),
});

describe('«Игра» mode (app.js LGGameUi)', () => {
  it('on() / windows / open through LGGameUi.win', () => {
    expect(gameUiOn(null)).toBe(false);
    expect(gameUiOn({ LGGameUi: { on: () => 0 } })).toBe(false);
    let cur = '';
    const W = { LGGameUi: { on: () => true, win: (id: string) => { cur = id; }, open: () => cur } };
    expect(guWindowOf(W, 'hero')).toBe(true);
    expect(guWindowOf(W, 'quest')).toBe(false);
    expect(openGuWindow(W, 'arena')).toBe(true);
    expect(cur).toBe('arena');
    expect(openGuWindow(W, 'news')).toBe(false);             // a real tab: classic switch as before
    expect(openGuWindow({ LGGameUi: { on: () => false, win: () => {} } }, 'hero')).toBe(false);
    expect(openGuWindow({ LGGameUi: { on: () => true, win: () => {}, open: () => '' } }, 'hero')).toBe(false);   // the site refused
  });
  it('replayCityEnter tab: «Герой» normally, never a window of the «Игра» mode', () => {
    const city = btn('city');
    const list = [btn('quest', { disabled: true }), btn('hero'), city, btn('legion'), btn('news'), btn('world'), btn('arena')];
    expect(pickReplayTab(list, city, false)!.id).toBe('hero');
    expect(pickReplayTab(list, city, true)!.id).toBe('news');
    expect(pickReplayTab([btn('hero'), city, btn('legion'), btn('news', { hidden: true }), btn('world')], city, true)!.id).toBe('world');
    expect(pickReplayTab([btn('hero'), city, btn('legion')], city, true)).toBeNull();
    for (const t of replayTabOrder(true)) expect(GU_WINDOWS as readonly string[]).not.toContain(t);
  });
  it.skipIf(!APP)('app.js: GU_WIN is our GU_WINDOWS; tab() hands those to guTab; hero gu turns it on', () => {
    const m = /const GU_WIN = \{([^}]*)\}/.exec(APP!)!;
    const ids = [...m[1].matchAll(/(\w+):\s*'/g)].map((x) => x[1]);
    expect(ids).toEqual([...GU_WINDOWS]);
    expect(APP!).toMatch(/guOn = \(\) => !DOCK && !!\(ME && ME\.user && ME\.hero && ME\.hero\.gu && ME\.hero\.cy\) && !inJail\(\)/);
    const guTab = fnSource(APP!, 'guTab')!;
    expect(guTab).toMatch(/GU_WIN\[id\]/);
    expect(guTab).toMatch(/guWin\(id\)/);
    expect(APP!).toMatch(/window\.LGGameUi = \{ on: \(\) => GU\.on, win: \(id\) => guWin\(id\), close: \(\) => guWinClose\(\), open: \(\) => GU\.win \|\| '' \}/);
    // the windows are dialogs: our overlay watcher (DIALOGS) sees them and the 3D yields
    const guWin = fnSource(APP!, 'guWin')!;
    expect(guWin).toMatch(/setAttribute\('role', 'dialog'\)/);
    expect(guWin).toMatch(/setAttribute\('aria-modal', 'true'\)/);
  });
});

/* ------------------------------------------------------------------ fishing */
type P2 = [number, number];
/** The site's fishSeg / fishPond / fishWater (city.js) in a sandbox with the given geometry and flags. */
function siteFish(o: { low?: any; W?: number; cats?: boolean; kit?: boolean; camp?: boolean; town?: boolean; jail?: boolean; on?: boolean; F?: any }) {
  const src = ['fishSeg', 'fishPond', 'fishWater'].map((n) => fnSource(CITY!, n)).join('\n');
  const ctx: any = {
    window: { LGFish2On: () => o.on !== false, LGFairCats: o.F }, S: { cats: !!o.cats, kit: !!o.kit }, WD: { LOW: o.low, W: o.W },
    isCamp: () => !!o.camp, meJail: () => !!o.jail, inTown: () => !!o.town, Math,
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.fishWater = fishWater;', ctx);
  return (x: number, y: number) => ctx.fishWater(x, y) as { x0: number; x1: number; y0: number; y1: number } | null;
}
const inside = (ws: FishWater[], x: number, y: number) => ws.some((w) => x >= w.x0 && x <= w.x1 && y >= w.y0 && y <= w.y1);
const inPoly = (P: readonly P2[], x: number, y: number) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };

describe('fishing (city.js fishWater → src/features/fishing.ts)', () => {
  const LOW = { canal: [1500, 1594] as P2, bridges: [[900, 1100], [2600, 2800]] as P2[] };
  it('canal stretches between bridges (20 px clear), canal ± 10 px', () => {
    const ws = canalWaters(LOW, 5500);
    expect(ws.map((w) => [w.x0, w.x1, w.y0, w.y1])).toEqual([[0, 880, 1490, 1604], [1120, 2580, 1490, 1604], [2820, 5500, 1490, 1604]]);
    expect(canalWaters(null, 5500)).toEqual([]);
  });
  it('only the cats fair pond or the old fair canal; nowhere else', () => {
    const pond = FC.POND as P2[];
    expect(fishWaters({ id: 'fairc', W: FC.W, faircats: { pond } } as any)).toHaveLength(1);
    expect(pondWater(pond)[0]).toMatchObject({ x0: Math.min(...pond.map((p) => p[0])), y1: Math.max(...pond.map((p) => p[1])) });
    expect(fishWaters({ id: 'fair', W: 5500, low: LOW } as any)).toHaveLength(3);
    for (const id of ['camp', 'd12', 'n-kit']) expect(fishWaters({ id, W: 5500, low: LOW, faircats: { pond } } as any)).toEqual([]);
    expect(fishWaters(null)).toEqual([]);
  });
  it('fishOn / label', () => {
    expect(fishOn({})).toBe(false);
    expect(fishOn({ LGFish2On: () => 1, LGOpenFish2: () => {} })).toBe(true);
    expect(fishOn({ LGFish2On: () => 0, LGOpenFish2: () => {} })).toBe(false);
    expect(fishLabel({ cr: { fish: { f2: { on: 1, casts: 12, max: 30 } } } })).toBe('Рыбачить · забросов 12 из 30');
    expect(fishLabel(null)).toBe('Рыбачить');
  });
  it.skipIf(!CITY || !CMAP)('the site\'s fishWater on the old fair\'s canal (citymap.js LOW) = our stretches', () => {
    const mod: any = { exports: {} };
    vm.runInNewContext(CMAP!, { module: mod, exports: mod.exports, Math, JSON, Object, Array, Number, String, Set, Map });
    const M = mod.exports, low = M.LOW, W = M.W;
    const site = siteFish({ low, W });
    const ours = fishWaters({ id: 'fair', W, low } as any);
    expect(ours.length).toBeGreaterThan(1);
    let hits = 0;
    for (let x = 4; x < W; x += 13) for (const y of [low.canal[0] - 4, (low.canal[0] + low.canal[1]) / 2, low.canal[1] + 4]) {
      const s = site(x, y);
      expect(!!s, `x ${x} y ${y}`).toBe(inside(ours, x, y));
      if (s) { hits++; expect(ours.some((w) => w.x0 === s.x0 && w.x1 === s.x1 && w.y0 === s.y0 && w.y1 === s.y1)).toBe(true); }
    }
    expect(hits).toBeGreaterThan(100);
    // never in a district town, the camp, the jail, or when fishing is closed
    expect(siteFish({ low, W, town: true })(100, low.canal[0] + 20)).toBeNull();
    expect(siteFish({ low, W, camp: true })(100, low.canal[0] + 20)).toBeNull();
    expect(siteFish({ low, W, jail: true })(100, low.canal[0] + 20)).toBeNull();
    expect(siteFish({ low, W, on: false })(100, low.canal[0] + 20)).toBeNull();
  });
  it.skipIf(!CITY)('the site\'s fishWater on the cats fair: the pond (not the pier), never in a Town Kit town', () => {
    const POND = FC.POND as P2[], PIER = FC.PIER as any;
    const F = { POND, PIER, inPoly };
    const site = siteFish({ cats: true, F });
    const ours = fishWaters({ id: 'fairc', W: FC.W, faircats: { pond: POND } } as any);
    let n = 0;
    for (let x = 300; x < 900; x += 11) for (let y = 2040; y < 2720; y += 11) {
      const s = site(x, y);
      if (s) { n++; expect(inside(ours, x, y)).toBe(true); expect([s.x0, s.y0, s.x1, s.y1]).toEqual([ours[0].x0, ours[0].y0, ours[0].x1, ours[0].y1]); }
    }
    expect(n).toBeGreaterThan(500);
    expect(siteFish({ cats: true, kit: true, F })(500, 2300)).toBeNull();
  });
  it.skipIf(!FISH2 || !APP)('fish2.js: the screen we watch; app.js opens it with the City asleep', () => {
    expect(FISH).toBe('.f2');
    expect(FISH2!).toMatch(/R\.className = 'f2'; R\.setAttribute\('role', 'dialog'\)/);
    const open = fnSource(APP!, 'openFish2')!;
    expect(open).toMatch(/C\.sleep\(\)/);
    expect(open).toMatch(/close: \(\) => \{[\s\S]*C\.wake\(\)/);
    expect(APP!).toMatch(/const fish2On = \(\) => !!\(ME && ME\.hero && ME\.hero\.cr && ME\.hero\.cr\.fish && ME\.hero\.cr\.fish\.f2 && ME\.hero\.cr\.fish\.f2\.on\)/);
  });
});

/* ------------------------------------------------------------------ pause-menu entries */
describe('site windows in the pause menu (site-places)', () => {
  const fakeDoc = (map: Record<string, any>) => ({ querySelector: (s: string) => map[s] ?? null });
  it('mail / dailies / mini-map / arena / guilds only with the site\'s globals and buttons', async () => {
    const opened: string[] = [], calls: string[] = [];
    const guilds = { hidden: false, clicks: 0, click() { this.clicks++; } };
    g.document = fakeDoc({ [GUILDS_ENTRY]: guilds, '.tabs button[data-tab="arena"]': { hidden: false } });
    const hero: any = { dl: { t: [] } };
    const off = (feature as any).setup({ actions: { openSitePanel: (t: string) => opened.push(t) }, store: { hero }, state: {}, ui: { toast: () => {} } });
    let ids = pauseItems().map((p) => p.id);
    expect(ids).toContain('site.tab.arena');
    expect(ids).toContain('site.guilds');
    expect(ids).not.toContain('site.mail');
    expect(ids).not.toContain('site.dailies');
    expect(ids).not.toContain('site.minimap');
    g.LGMail = { on: () => true, unread: () => 3, open: () => calls.push('mail') };
    g.LGDailies = { open: () => calls.push('dl') };
    g.LGGameUi = { on: () => true };
    g.LegionMiniMap = { open: (o: any) => calls.push('mm:' + o.tab) };
    ids = pauseItems().map((p) => p.id);
    for (const id of ['site.mail', 'site.dailies', 'site.minimap']) expect(ids).toContain(id);
    expect(pauseItems().find((p) => p.id === 'site.mail')!.label).toBe('Почта');
    expect(pauseItems().find((p) => p.id === 'site.mail')!.badge!()).toBe('3');
    for (const id of ['site.mail', 'site.dailies', 'site.minimap', 'site.guilds', 'site.tab.arena']) pauseItems().find((p) => p.id === id)!.run();
    await new Promise((r) => setTimeout(r, 5));
    expect(calls).toEqual(['mail', 'dl', 'mm:map']);
    expect(opened).toEqual(['arena']);
    expect(guilds.clicks).toBe(1);
    delete hero.dl;
    expect(pauseItems().map((p) => p.id)).not.toContain('site.dailies');
    off();
    expect(SITE_TABS.map((t) => t[0])).toEqual(['war', 'season', 'arena']);
  });
  it('helpers', () => {
    expect(mailBadge(0)).toBe('');
    expect(mailBadge(7)).toBe('7');
    expect(mailBadge(150)).toBe('99+');
    expect(mailOn({ LGMail: { on: () => false } })).toBe(false);
    expect(mailUnread({ LGMail: { unread: () => 'x' } })).toBe(0);
    expect(dailiesOn({ dl: 1 }, {})).toBe(false);
    expect(miniMapOn({ LegionMiniMap: { open() {} } })).toBe(false);   // only in the «Игра» mode, like the site's HUD
  });
  it.skipIf(!APP)('app.js: LGMail / LegionMiniMap / LGDailies are what we call', () => {
    expect(APP!).toMatch(/window\.LGMail = \{[\s\S]{0,400}async open\(o\)[\s\S]{0,600}unread\(\) \{ return ML\.off \? 0 : ML\.n; \}[\s\S]{0,200}on\(\) \{ return !ML\.off; \}/);
    expect(APP!).toMatch(/window\.LegionMiniMap = \{[\s\S]{0,100}async open\(o\)/);
    expect(APP!).toMatch(/if \(k === 'quests'\) \{ if \(window\.LGDailies && ME\.hero && ME\.hero\.dl\) \{ window\.LGDailies\.open\(\); return; \}/);
  });
});

/* ------------------------------------------------------------------ guild tags */
describe('guild tag on the nameplate (city.js labOf gt, citygl.js nameTex)', () => {
  it('Appearance.guild from `gt` (5 chars like citygl.js), none without', () => {
    expect(appearanceFrom('cat', { n: 'Кот', gt: 'МУРКИ-ГИЛЬД' }).guild).toBe('МУРКИ');
    expect(appearanceFrom('cat', { n: 'Кот' }).guild).toBeUndefined();
    expect(appearanceFrom('cat', { name: 'Кот', gt: 'ЛИС' }).guild).toBe('ЛИС');   // own hero: hero.gt (app.js guRender)
  });
  it.skipIf(!CITY || !CGL)('the site sends and draws it that way', () => {
    expect(CITY!).toMatch(/\.\.\.\(v\.gt \? \{ gt: String\(v\.gt\) \} : \{\}\)/);
    expect(CGL!).toMatch(/const gt = o\.gt \? `\[\$\{String\(o\.gt\)\.slice\(0, 5\)\}\]` : '';/);
  });
});
