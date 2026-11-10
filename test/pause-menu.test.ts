/**
 * The pause menu (src/ui/pause-menu.ts): entries in three groups (registry `group`, default 'city'), one icon set
 * (registry `icon`, emoji stripped from labels), badges, markup roles, and the spatial keyboard navigation.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pauseEntries, pausePageHtml, pauseNav, navDir, plainLabel, heroPlate, capText, type NavRect } from '../src/ui/pause-menu';
import { registerPauseItem, pauseGroupOf, PAUSE_GROUP_DEFAULT } from '../src/ui/settings-ext';
import { hasPauseIcon, pauseIcon, PAUSE_ICON_NAMES } from '../src/ui/pause-icons';
import { SITE_TABS } from '../src/features/site-places';

const offs: (() => void)[] = [];
afterEach(() => { while (offs.length) offs.pop()!(); });
const base = { charTab: 'gear', quest: false, systemTabs: [] };

describe('pause menu model', () => {
  it('core entries: «Продолжить» first, hero / system blocks, «Классический сайт» last', () => {
    const e = pauseEntries(base);
    expect(e[0]).toMatchObject({ act: 'resume', group: 'resume', key: 'Esc' });
    expect(e.filter((x) => x.group === 'hero').map((x) => x.act)).toEqual(['tab:gear', 'tab:map']);
    expect(e.filter((x) => x.group === 'system').map((x) => x.act)).toEqual(['go:settings', 'go:help', 'classic-site']);
    expect(e[e.length - 1]).toMatchObject({ act: 'classic-site', key: 'F8' });
    expect(pauseEntries({ ...base, quest: true }).some((x) => x.act === 'classic:quest' && x.group === 'hero')).toBe(true);
  });
  it('registered items: group (default «Город и сайт»), order inside the group, icon, emoji-free label, badge', () => {
    offs.push(
      registerPauseItem({ id: 't.photo', label: 'Фоторежим', key: 'F9', order: 10, group: 'system', icon: 'camera', run: () => {} }),
      registerPauseItem({ id: 't.mail', label: '✉ Почта', order: 21, icon: 'mail', badge: () => 3, run: () => {} }),
      registerPauseItem({ id: 't.old', label: '🐞 Старый пункт', order: 5, run: () => {} }),
      registerPauseItem({ id: 't.off', label: 'Скрытый', enabled: () => false, run: () => {} }),
      registerPauseItem({ id: 't.trip', label: 'Путешествие', key: 'L', order: 22, group: 'hero', icon: 'compass', run: () => {} }),
      registerPauseItem({ id: 't.boom', label: 'Сломанный', badge: () => { throw new Error('x'); }, run: () => {} }),
    );
    const e = pauseEntries(base);
    const by = (act: string) => e.find((x) => x.act === act)!;
    expect(by('ext:t.old')).toMatchObject({ group: PAUSE_GROUP_DEFAULT, label: 'Старый пункт', icon: 'dot', badge: '' });
    expect(PAUSE_GROUP_DEFAULT).toBe('city');
    expect(by('ext:t.mail')).toMatchObject({ group: 'city', label: 'Почта', icon: 'mail', badge: '3' });
    expect(by('ext:t.boom').badge).toBe('');
    expect(e.some((x) => x.act === 'ext:t.off')).toBe(false);
    expect(e.filter((x) => x.group === 'system').map((x) => x.act)).toEqual(['go:settings', 'go:help', 'ext:t.photo', 'classic-site']);
    expect(e.filter((x) => x.group === 'hero').map((x) => x.act)).toEqual(['tab:gear', 'tab:map', 'ext:t.trip']);
    expect(e.filter((x) => x.group === 'city').map((x) => x.act)).toEqual(['ext:t.boom', 'ext:t.old', 'ext:t.mail']);   // no order = 0
    // the groups keep their order whatever the item orders are
    const g = e.map((x) => x.group); expect(g.indexOf('system')).toBeGreaterThan(g.lastIndexOf('city'));
  });
  it('pauseGroupOf / plainLabel', () => {
    expect(pauseGroupOf({})).toBe('city');
    expect(pauseGroupOf({ group: 'nope' as never })).toBe('city');
    expect(pauseGroupOf({ group: 'hero' })).toBe('hero');
    expect(plainLabel('🏙️ Вернуться в город')).toBe('Вернуться в город');
    expect(plainLabel('⬆ Обновление 0.8.0')).toBe('Обновление 0.8.0');
    expect(plainLabel('Арена 5×5')).toBe('Арена 5×5');
    expect(plainLabel('3D-режим')).toBe('3D-режим');   // digits are not emoji
    expect(plainLabel('🐞')).toBe('🐞');
    expect([capText('Alt+Enter'), capText('Enter'), capText('F10')]).toEqual(['Alt ↵', 'Enter', 'F10']);
  });
});

describe('pause menu markup', () => {
  it('one menu, labelled groups, roving tabindex, keycaps, badge in the accessible name', () => {
    offs.push(registerPauseItem({ id: 't.mail', label: 'Почта', icon: 'mail', badge: () => '99+', run: () => {} }));
    const e = pauseEntries(base);
    const html = pausePageHtml(e, null, 'go:help');
    expect(html.match(/role="menu"/g)!.length).toBe(1);
    expect(html.match(/role="menuitem"/g)!.length).toBe(e.length);
    expect(html.match(/role="group"/g)!.length).toBe(3);
    for (const id of ['pg-hero', 'pg-city', 'pg-system']) expect(html).toContain(`aria-labelledby="${id}"`);
    expect(html.match(/tabindex="0"/g)!.length).toBe(1);
    expect(html).toMatch(/class="pi cur" data-act="pause" data-p="go:help" tabindex="0"/);
    expect(html).toContain('aria-label="Почта, новых: 99+"');
    expect(html).toContain('<i class="kc sm dk" aria-hidden="true">F8</i>');
    expect(html).toContain('Героя пока нет');
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);   // one icon set, no emoji
    // an empty group is not drawn
    expect(pausePageHtml(e.filter((x) => x.group !== 'city'), null, 'resume')).not.toContain('pg-city');
  });
  it('hero plate: level, name, class, HP / XP, ghost', () => {
    const H: any = { name: 'Кот<b>', level: 7, role: 'rogue', stats: { hp: 80 }, hpNow: 20, xpInLevel: 30, xpToNext: 120, money: 1234 };
    const h = heroPlate(H);
    expect(h).toContain('Кот&lt;b&gt;'); expect(h).toContain('<b>7</b>'); expect(h).toContain('20 / 80'); expect(h).toContain('30 / 120');
    expect(h).toContain('width:25.0%');
    expect(heroPlate({ ...H, ghost: true })).toContain('призрак');
  });
  it('icons: every name draws, unknown → dot, decorative', () => {
    for (const n of PAUSE_ICON_NAMES) expect(pauseIcon(n)).toMatch(/^<svg class="pi-ic"[^>]*aria-hidden="true"/);
    expect(pauseIcon('no-such')).toBe(pauseIcon('dot'));
  });
});

describe('every pause item of the features names its group and a known icon', () => {
  it('registerPauseItem callers', () => {
    const dir = join(__dirname, '../src/features');
    let calls = 0;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      for (const m of src.matchAll(/registerPauseItem\(\{/g)) {
        calls++;
        const body = src.slice(m.index!, src.indexOf('run', m.index!) + 3);
        expect(body, f).toMatch(/group:\s*'(hero|city|system)'/);
        const ic = /icon(?::\s*'([a-z]+)'|,)/.exec(body);
        expect(ic, f + ': icon').toBeTruthy();
        if (ic![1]) expect(hasPauseIcon(ic![1]), f + ' ' + ic![1]).toBe(true);
        expect(body, f + ': emoji in a label').not.toMatch(/label:\s*'\p{Extended_Pictographic}/u);
      }
    }
    expect(calls).toBeGreaterThanOrEqual(14);
    for (const t of SITE_TABS) expect(hasPauseIcon(t[3]), t[0]).toBe(true);
  });
});

describe('pauseNav (spatial keyboard navigation)', () => {
  // left column: resume (0) at the bottom; right: a 3×2 grid (1..6) and a wide row (7)
  const R: NavRect[] = [
    { x: 0, y: 300, w: 280, h: 60 },
    { x: 300, y: 0, w: 200, h: 90 }, { x: 510, y: 0, w: 200, h: 90 }, { x: 720, y: 0, w: 200, h: 90 },
    { x: 300, y: 100, w: 200, h: 44 }, { x: 510, y: 100, w: 200, h: 44 }, { x: 720, y: 100, w: 200, h: 44 },
    { x: 300, y: 300, w: 620, h: 40 },
  ];
  it('moves within rows and columns, across groups', () => {
    expect(pauseNav(R, 1, 'right')).toBe(2);
    expect(pauseNav(R, 2, 'right')).toBe(3);
    expect(pauseNav(R, 3, 'right')).toBe(3);          // the edge: stays
    expect(pauseNav(R, 2, 'down')).toBe(5);
    expect(pauseNav(R, 5, 'down')).toBe(7);
    expect(pauseNav(R, 7, 'up')).toBe(5);             // under a wide row: the tile nearest its centre
    expect(pauseNav(R, 4, 'left')).toBe(0);           // back to the left column
    expect(pauseNav(R, 1, 'left')).toBe(0);
    expect(pauseNav(R, 0, 'right')).toBe(7);          // the same height wins
  });
  it('up / down wrap inside the column', () => {
    expect(pauseNav(R, 7, 'down')).toBe(1);
    expect(pauseNav(R, 3, 'up')).toBe(7);
    expect(pauseNav(R, 0, 'down')).toBe(1);           // alone in its column → the top of the menu
    expect(pauseNav([], 0, 'down')).toBe(-1);
  });
  it('navDir: arrows and WASD', () => {
    expect(['ArrowUp', 'KeyW', 'ArrowDown', 'KeyS', 'ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD', 'KeyQ'].map(navDir))
      .toEqual(['up', 'up', 'down', 'down', 'left', 'left', 'right', 'right', null]);
  });
});
