import { describe, it, expect } from 'vitest';
import { roleTitle, badgeRules } from '../src/ui/data';
import { rowProblem } from '../src/ui/settings-ext';

describe('roleTitle (live style switch)', () => {
  const names = { cats: { roles: { mage: 'Кот-колдун' } }, cherts: { roles: { mage: 'Чёрт-колдун' } } };
  it('takes the active style’s own title', () => {
    expect(roleTitle({ role: 'mage', roleName: 'Кот-колдун' }, names, 'cherts')).toBe('Чёрт-колдун');
  });
  it('drops a stale title of another loaded style', () => {
    expect(roleTitle({ role: 'mage', roleName: 'Кот-колдун' }, names, 'legion')).toBe('Маг');
  });
  it('keeps the server title when nothing is known', () => {
    expect(roleTitle({ role: 'mage', roleName: 'Волшебник' }, null, '')).toBe('Волшебник');
    expect(roleTitle({ role: 'mage' }, undefined, '')).toBe('Маг');
  });
  it('badge rules', () => {
    expect(badgeRules('')).toBe('');
    expect(badgeRules('cats')).toBe('cats');
    expect(badgeRules('cherts')).toBe('cherts');
    expect(badgeRules('monkeys')).toBe('legion');
  });
});

describe('setting rows: default is a valid value', () => {
  it('seg def must be an option', () => {
    expect(rowProblem({ key: 'k', label: 'l', kind: 'seg', options: [['off', 'Выкл'], ['on', 'Вкл']], def: 'on' })).toBe('');
    expect(rowProblem({ key: 'k', label: 'l', kind: 'seg', options: [['off', 'Выкл'], ['on', 'Вкл']], def: '1' })).toMatch(/not one of/);
  });
  it('range def inside bounds', () => {
    expect(rowProblem({ key: 'k', label: 'l', kind: 'range', min: 0, max: 1, step: 0.1, def: 0.5 })).toBe('');
    expect(rowProblem({ key: 'k', label: 'l', kind: 'range', min: 0, max: 1, step: 0.1, def: 2 })).toMatch(/outside/);
  });
});
