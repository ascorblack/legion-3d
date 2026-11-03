// The site's own bot-telemetry probe (mine.js tlPi), run against a page. Shared by test/fetch-telemetry.test.ts (node vm)
// and e2e/fetch-tee.mjs / e2e/live.mjs (real browser). `probeSource()` is JS text that defines `__l3dPi()` returning the
// same bit mask the site sends with a dig: 1 = window.fetch is neither native nor the site's own wrapper over a native
// one, 2 = requestAnimationFrame is not native, 4 = LGMine / LGMineBiome functions replaced. 0 = nothing detected.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURE = new URL('../test/fixtures/site-telemetry.js', import.meta.url);

export function probeSource() {
  return `(function () { function open() {} function onEvent() {}\n${readFileSync(FIXTURE, 'utf8')}\nwindow.__l3dPi = tlPi; })();`;
}

/** The newest site dump in .local that contains tlPi: does the fixture still match the site's code? ({ ok, dump } or null without a dump). */
export function fixtureDrift(root = new URL('../.local/', import.meta.url).pathname) {
  if (!existsSync(root)) return null;
  const dumps = readdirSync(root).filter((d) => /^site-\d/.test(d) && existsSync(join(root, d, 'mine.js'))).sort();
  for (let i = dumps.length - 1; i >= 0; i--) {
    const txt = readFileSync(join(root, dumps[i], 'mine.js'), 'utf8');
    if (!txt.includes('function tlPi()')) continue;
    // since 01.11 the site strips its comments: compare code only (comments and whitespace removed on both sides)
    const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
    const norm = (l) => l.replace(/\s+/g, '');
    const site = norm(code(txt));
    const fx = code(readFileSync(FIXTURE, 'utf8')).split('\n').map(norm).filter(Boolean);
    const missing = fx.filter((l) => !site.includes(l));
    return { dump: dumps[i], ok: missing.length === 0, missing };
  }
  return null;
}
