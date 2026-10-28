#!/usr/bin/env node
// AMO (addons.mozilla.org) submission metadata for one version: store/amo-metadata.json + the version's
// «Version Notes» (release_notes) taken from its CHANGELOG.md section, in the limited Markdown AMO renders
// (bold, italic, links, lists — no headings, no images).
//   node scripts/amo-metadata.mjs <version> [out=amo-metadata.gen.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The bullet list of `## <version>` in CHANGELOG.md, as AMO-friendly Markdown. */
export function changelogNotes(changelog, version) {
  const lines = changelog.split('\n');
  const i = lines.findIndex((l) => l.trim() === `## ${version}`);
  if (i < 0) return '';
  const out = [];
  for (const l of lines.slice(i + 1)) {
    if (/^##\s/.test(l)) break;
    const t = l.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trimEnd();   // no images on AMO
    if (t.trim()) out.push(t.replace(/^\s*[*+]\s/, '- '));
  }
  return out.join('\n').trim();
}

export function amoMetadata(base, notes, extra = '') {
  const text = [notes, extra].filter(Boolean).join('\n\n');
  const m = structuredClone(base);
  m.version = { ...(m.version || {}), ...(text ? { release_notes: { ru: text, 'en-US': text } } : {}) };
  return m;
}

function main() {
  const [version, out = 'amo-metadata.gen.json'] = process.argv.slice(2);
  if (!version) { console.error('usage: amo-metadata.mjs <version> [out]'); process.exit(2); }
  const base = JSON.parse(readFileSync('store/amo-metadata.json', 'utf8'));
  const notes = changelogNotes(readFileSync('CHANGELOG.md', 'utf8'), version);
  const link = `Подробности и скриншоты: [релиз ${version} на GitHub](https://github.com/ascorblack/legion-3d/releases/tag/v${version})`;
  writeFileSync(out, JSON.stringify(amoMetadata(base, notes, link), null, 2) + '\n');
  console.log(`${out}: ${notes.split('\n').length} note line(s)`);
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
