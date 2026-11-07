/**
 * Site 07.11: the guild district (guildhall.js), the tabs «Бой армий» / «Сезоны», the district town's hall (b-hall.js r.hall.w).
 * The pause-menu entries exist only while the site shows its own buttons; the district is a blocking overlay for the 3D.
 */
import { describe, it, expect, afterEach } from 'vitest';
import feature, { present, GUILD_ENTRY, SITE_TABS } from '../src/features/site-places';
import { pauseItems } from '../src/ui/settings-ext';
import { DISTRICT } from '../src/net/site';
import { districtHall, HYBRID_SCENES } from '../src/rooms/hybrid/scenes';
import { siteCopy } from './site-quest-fns';

type El = { hidden: boolean; clicks: number; click(): void };
const el = (hidden = false): El => ({ hidden, clicks: 0, click() { this.clicks++; } });
function fakeDoc(map: Record<string, El | null>) { return { querySelector: (s: string) => (map[s] ?? null) as unknown as Element }; }

const g = globalThis as any;
afterEach(() => { delete g.document; });

describe('site places in the pause menu', () => {
  it('present(): in the page and not [hidden]', () => {
    expect(present(fakeDoc({ a: el() }), 'a')).toBeTruthy();
    expect(present(fakeDoc({ a: el(true) }), 'a')).toBeNull();
    expect(present(fakeDoc({}), 'a')).toBeNull();
  });
  it('entries show only with the site\'s buttons; a press uses the site\'s own button / tab', async () => {
    const entry = el(), war = el(), season = el(true);
    g.document = fakeDoc({ [GUILD_ENTRY]: entry, '.tabs button[data-tab="war"]': war, '.tabs button[data-tab="season"]': season });
    const opened: string[] = [];
    const off = (feature as any).setup({ actions: { openSitePanel: (t: string) => opened.push(t) } });
    const ids = pauseItems().map((p) => p.id);
    expect(ids).toContain('site.guild');
    expect(ids).toContain('site.tab.war');
    expect(ids).not.toContain('site.tab.season');   // hidden tab button: the site keeps it off for this hero
    pauseItems().find((p) => p.id === 'site.tab.war')!.run();
    expect(opened).toEqual(['war']);
    pauseItems().find((p) => p.id === 'site.guild')!.run();
    await new Promise((r) => setTimeout(r, 5));
    expect(entry.clicks).toBe(1);
    g.document = fakeDoc({});
    expect(pauseItems().map((p) => p.id).filter((i) => i.startsWith('site.'))).toEqual([]);
    off();
    expect(SITE_TABS.map((t) => t[0])).toEqual(['war', 'season']);
  });
  it.skipIf(!siteCopy('guildhall.js', 'gd-root'))('guildhall.js: the entry button in the City HUD and the full-screen root we watch', () => {
    const src = siteCopy('guildhall.js', 'gd-root')!;
    expect(DISTRICT).toBe('.gd-root');
    expect(src).toMatch(/root\.className = 'gd-root'/);
    expect(src).toMatch(/querySelector\('\.cy-hud'\)/);
    expect(src).toMatch(/b\.className = 'gd-entry'/);
    expect(src).toMatch(/LGCity\.sleep\(\)/);
  });
  it.skipIf(!siteCopy('app.js', 'openWar'))('app.js: the war / season tabs and their flags', () => {
    const src = siteCopy('app.js', 'openWar')!;
    expect(src).toMatch(/ME\.cw/);
    expect(src).toMatch(/ME\.ss/);
    expect(src).toMatch(/data-tab="war"/);
    expect(src).toMatch(/data-tab="season"/);
  });
});

describe('district town hall (b-hall.js r.hall.w)', () => {
  it('the desk says «Казна города» in a district town, the channel\'s hall store at the fair / camp', () => {
    const verb = HYBRID_SCENES.hall.verb as (e: any) => string;
    expect(verb({ town: { id: 'n-12', foreignK: 1 } })).toBe('Казна города');
    expect(verb({ town: null })).toBe('Казна и склад Ратуши');
    expect(verb({ town: { id: 'camp', foreignK: 1 } })).toBe('Казна и склад Ратуши');
    expect(districtHall({ town: { id: 'n-3', foreignK: 1.2 } })).toBe(true);
  });
  it.skipIf(!siteCopy('b-hall.js', 'hall.w'))('b-hall.js: the town treasury text for r.hall.w', () => {
    const src = siteCopy('b-hall.js', 'hall.w')!;
    expect(src).toMatch(/Казна города/);
    expect(src).toMatch(/гильдии-управляющей/);
  });
});
