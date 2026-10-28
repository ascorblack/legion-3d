#!/usr/bin/env node
// Release notes for GitHub: .github/RELEASE_NOTES.md with screenshots.
// Screenshots of a version live in docs/releases/<version>/ (full-quality JPEG ≤ 5 MB, 2560×1440 q3, no real nicknames) and are written
// in the notes as relative links: ![Лагерь](docs/releases/0.4.3/camp.jpg). A release body cannot resolve relative paths,
// so they are rewritten to raw.githubusercontent.com at the release TAG (the files are frozen with the tag).
//   node scripts/release-notes.mjs <owner/repo> <tag> [in] [out]
//   node scripts/release-notes.mjs --check [in]        # every linked image exists and is ≤ 5 MB (before tagging)
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const IMG = /(!\[[^\]]*\]\()(docs\/releases\/[\w.\-/]+\.(?:jpe?g|png|webp|gif))(\))/g;

/** Relative screenshot links -> absolute raw URLs at the tag. */
export function absolutize(md, repo, tag) {
  return md.replace(IMG, (_, a, path, b) => `${a}https://raw.githubusercontent.com/${repo}/${tag}/${path}${b}`);
}
/** Relative screenshot paths linked from the notes. */
export function linked(md) { return [...md.matchAll(IMG)].map((m) => m[2]); }

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const pos = args.filter((a) => !a.startsWith('--'));
  const src = check ? (pos[0] || '.github/RELEASE_NOTES.md') : (pos[2] || '.github/RELEASE_NOTES.md');
  const md = readFileSync(src, 'utf8');
  const missing = linked(md).filter((p) => !existsSync(p));
  const big = linked(md).filter((p) => existsSync(p) && statSync(p).size > 5_000_000);
  if (missing.length) { console.error('missing screenshots: ' + missing.join(', ')); process.exit(1); }
  if (big.length) { console.error('screenshots over 5 MB (JPEG -q:v 2): ' + big.join(', ')); process.exit(1); }
  if (check) { console.log(`ok: ${linked(md).length} screenshot(s)`); return; }
  const [repo, tag] = pos; const out = pos[3] || 'release-notes.md';
  if (!repo || !tag) { console.error('usage: release-notes.mjs <owner/repo> <tag> [in] [out]'); process.exit(2); }
  writeFileSync(out, absolutize(md, repo, tag));
  console.log(`${out}: ${linked(md).length} screenshot(s)`);
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
