/**
 * Debug mode report and bus log (src/debug/report.ts): what goes to the clipboard carries versions, browser, GPU,
 * settings and the contract — never the login, the display name, cookies, tokens or per-account keys; bus payload
 * previews mask names.
 */
import { describe, it, expect } from 'vitest';
import { buildReport, pickSettings, maskPayload, preview, siteScripts, MASK, type ReportInput } from '../src/debug/report';

const LOGIN = 'secretnick', NAME = 'Секретный Котик';
const store = (o: Record<string, string>) => ({ length: Object.keys(o).length, key: (i: number) => Object.keys(o)[i] ?? null, getItem: (k: string) => o[k] ?? null });

function input(extra: Partial<ReportInput> = {}): ReportInput {
  const ls = store({
    'l3d.quality': '2', 'l3d.debug': 'on', 'l3d.vol.master': '0.5',
    ['l3d.showcase.' + LOGIN]: '["a"]', 'l3d.seen.secretnick': '1', 'l3d.token': 'abc', 'l3d.note': 'hi ' + LOGIN, 'other.key': 'x', 'l3d.big': 'x'.repeat(200),
  });
  return {
    version: '0.4.4', dev: false, ua: 'Mozilla/5.0 Test', platform: 'Win32', lang: 'ru-RU', screen: '2560×1440', dpr: 1, gpu: 'NVIDIA RTX', webgl2: true,
    quality: { setting: 'auto', level: 3 }, perf: { fps: 60, ms: 16.7, calls: 120, tris: 400000 },
    settings: pickSettings(ls, [LOGIN, NAME]),
    contract: { phase: 'город открыт', checked: 20, fails: [{ id: 'city.keys', severity: 'degrade', missing: ['LGCity.where'] }] },
    drift: [{ kind: 'building', id: 'zoo' }], scripts: siteScripts(['https://site.test/site/city.js?v=123', 'https://cdn.other/x.js', '/site/quest.js?v=9'], 'https://site.test'),
    secrets: [LOGIN, NAME], ...extra,
  };
}

describe('debug report', () => {
  it('has the useful parts', () => {
    const r = buildReport(input());
    expect(r).toContain('0.4.4'); expect(r).toContain('NVIDIA RTX'); expect(r).toContain('q3');
    expect(r).toContain('city.keys'); expect(r).toContain('building:zoo');
    expect(r).toContain('site/city.js v=123'); expect(r).not.toContain('cdn.other');
    expect(r).toContain('quality=2'); expect(r).toContain('debug=on');
  });
  it('never contains the login, the name, cookies or tokens', () => {
    const r = buildReport(input({ ua: 'UA with ' + LOGIN + ' inside', town: 'fair' }));
    expect(r.toLowerCase()).not.toContain(LOGIN);
    expect(r).not.toContain(NAME);
    expect(r).not.toMatch(/cookie|token|sid=/i);
    expect(r).not.toContain('showcase.');
    expect(r).not.toContain('l3d.big');
    expect(r).toContain(MASK);   // the UA line got masked
  });
  it('masks names in bus payload previews', () => {
    const v = { a: [{ l: LOGIN, n: NAME, x: 10, y: 20 }], chat: [{ id: 1, l: 'friend', n: 'Друг', t: 'привет ' + LOGIN }], q: { b: { form: [[LOGIN, 'mage']] } } };
    const m = JSON.stringify(maskPayload(v, [LOGIN]));
    expect(m).not.toContain(LOGIN); expect(m).not.toContain(NAME); expect(m).not.toContain('friend'); expect(m).not.toContain('Друг');
    expect(m).toContain('"x":10');
    expect(preview(v, [LOGIN], 50).length).toBeLessThanOrEqual(50);
  });
});
