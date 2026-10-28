import { describe, it, expect } from 'vitest';
// @ts-ignore — plain ESM script
import { changelogNotes, amoMetadata } from '../scripts/amo-metadata.mjs';

const CL = '# Changelog\n\n## 0.4.3\n- Первое ![x](a.png)\n* Второе\n\n## 0.4.2\n- Старое\n';

describe('AMO version notes', () => {
  it('takes only the version section, as a list without images', () => {
    expect(changelogNotes(CL, '0.4.3')).toBe('- Первое\n- Второе');
    expect(changelogNotes(CL, '9.9.9')).toBe('');
  });
  it('adds release_notes in both locales and keeps the base metadata', () => {
    const m = amoMetadata({ summary: { ru: 's' }, version: { license: 'MIT' } }, '- a', 'link');
    expect(m.version).toEqual({ license: 'MIT', release_notes: { ru: '- a\n\nlink', 'en-US': '- a\n\nlink' } });
    expect(m.summary).toEqual({ ru: 's' });
  });
});
