/**
 * Test helper for the geometry lint (src/world/lint): every town / room / mine floor / expedition stage the dev
 * fixtures can build, collected as lint sources (world-space pieces + marks + groundAt + door hit boxes). No DOM.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { expect } from 'vitest';
import { fixtureLayout, campFixtureLayout, villageFixtureLayout, fairCatsFixtureLayout, kitFixtureLayout } from '../dev/fixtures';
import type { CityLayout } from '../src/contracts';
import { lintTownSource } from '../src/world/lint/town';
import { formatFindings, type LintReport } from '../src/world/lint';
export { pinTod } from './setup-tod';

/** A town built in node into a lint source (src/world/lint/town.ts). */
export const lintTown = (where: string, L: CityLayout) => lintTownSource(where, L);

export const TOWNS: [string, () => CityLayout][] = [
  ['fair', () => fixtureLayout()],
  ['fairc', () => fairCatsFixtureLayout({ jail: true, magic: true })],
  ['camp', () => campFixtureLayout()],
  ['village', () => villageFixtureLayout('cats')],
  ['cherts', () => villageFixtureLayout('cherts')],
  ['townkit', () => kitFixtureLayout({ magic: true })],
];

/* ------------------------------------------------------------------ the ratchet */
const BASE = 'test/fixtures/lint-baseline.json';
const baseline: Record<string, Record<string, number>> = (() => { try { return JSON.parse(readFileSync(BASE, 'utf8')); } catch { return {}; } })();
/** Classes that must stay at zero everywhere. */
export const HARD = new Set(['door', 'loose', 'lamp']);

export function ratchet(r: LintReport): void {
  if (process.env.LINT_OUT) { mkdirSync(process.env.LINT_OUT, { recursive: true }); writeFileSync(`${process.env.LINT_OUT}/${r.where.replace(/[^\w-]+/g, '_')}.json`, JSON.stringify(r.findings, null, 1)); }
  console.log(formatFindings(r, Number(process.env.LINT_MAX || 12)));
  if (process.env.LINT_WRITE) {
    const all = (() => { try { return JSON.parse(readFileSync(BASE, 'utf8')); } catch { return {}; } })();
    all[r.where] = r.counts; writeFileSync(BASE, JSON.stringify(all, null, 1) + '\n');
    return;
  }
  const b = baseline[r.where] ?? {};
  const grown: string[] = [];
  for (const [c, n] of Object.entries(r.counts)) {
    const max = HARD.has(c) ? 0 : (b[c] ?? 0);
    if (n > max) grown.push(`${c}: ${n} > ${max}\n` + r.findings.filter((f) => f.cls === c).slice(0, 8).map((f) => `    ${f.tag} [${f.kind}] at ${f.at.join(',')}: ${f.what}`).join('\n'));
  }
  expect(grown, `${r.where}: lint findings grew (fix them, or lower nothing: see ${BASE})`).toEqual([]);
}

