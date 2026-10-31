// Run manually on the local read-only capture (main channel, 2026-10-31); never publish the raw capture.
//   node test/fixtures/quest-live-1031-sanitize.mjs  →  test/fixtures/quest-live-3.json
// Keeps a few q views per 31.10 terrain (pumpkin field, graveyard, ruins, mill, dead tree, abandoned village) plus the votes,
// the place buttons and the loot vote; every identity (chat logins / names, the battle form, rolls, loot, prophecies, place
// buttons) becomes playerN, also inside prose; feeds, the low-HP list and test flags are dropped, big lists are cut.
import fs from 'node:fs';
const src = new URL('../../e2e/.artifacts/quest/main-1031/events.jsonl', import.meta.url);
const events = fs.readFileSync(src, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
// protocol words a nickname may happen to equal ('archer', 'party', 'right'…): never rewritten, or the payload would break
const PROTO = new Set();
const KEYS = new Set(['k', 'st', 'look', 'type', 'rar', 'party', 'kind', 'g', 'c', 'tier', 'turn', 'tk', 'gk', 'how']);
const walk = (v, key) => { if (typeof v === 'string') { if (KEYS.has(key)) PROTO.add(v.toLowerCase()); } else if (Array.isArray(v)) v.forEach((x) => walk(x, key)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k); };
for (const e of events) if (e.kind === 'q') { walk(e.data, ''); for (const x of String(e.data.ev?.my || '').split(',')) if (x) PROTO.add(x.toLowerCase()); for (const p of e.data.b?.form || []) if (typeof p[1] === 'string') PROTO.add(p[1].toLowerCase()); }
const names = new Map();
const add = (n) => { if (typeof n !== 'string') return; n = n.trim().replace(/^@/, ''); const l = n.toLowerCase(); if ((n.length >= 3 || (n.length >= 1 && /^[a-z0-9_]+$/i.test(n))) && !PROTO.has(l) && !names.has(l)) names.set(l, `player${names.size + 1}`); };
for (const e of events) {
  const d = e.data || {};
  if (e.kind === 'cityChat') for (const m of d.chat || []) { add(m.l); add(m.n); }
  if (e.kind !== 'q') continue;
  add(d.roll?.by);
  for (const p of d.b?.form || []) add(p[0]);
  for (const p of d.b?.low || []) { add(p[0]); add(p[1]); }
  if (d.loot?.my && d.loot.my !== '*') add(d.loot.my);
  for (const p of d.loot?.top || []) { add(p[0]); add(p[1]); }
  add(d.ev?.pr?.by);
  for (const x of d.ev?.solved || []) if (Array.isArray(x)) add(x[1]);
  for (const x of d.tr?.best || []) if (Array.isArray(x)) add(x[2]);
  for (const b of d.pb?.b || []) { const m = /@(\S+)/.exec(b.t || ''); if (m) add(m[1]); const g = /^🎁 (.+?) ·/.exec(b.l || ''); if (g) add(g[1]); const f = /Освободить (.+?) ·/.exec(b.l || ''); if (f) add(f[1]); }
  if (typeof d.tr?.taker === 'string') add(d.tr.taker);
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const list = [...names].sort((a, b) => b[0].length - a[0].length);
const res = list.map(([n, demo]) => [new RegExp(`(?<![\\p{L}\\p{N}_])${esc(n)}(?![\\p{L}\\p{N}_])`, 'giu'), demo]);
// prose (strings with spaces): a Latin nickname the lists above missed («kp4xx сунул руку…») becomes playerN as well
const LATIN = /(?<![\p{L}\p{N}_])(?=[\w]*[A-Za-z])[A-Za-z0-9_]{3,}(?![\p{L}\p{N}_])/gu, KEEP = new Set(['d20', 'xp', 'hp']);
const latin = (t) => t.replace(LATIN, (w) => (KEEP.has(w.toLowerCase()) || /^player\d+$/.test(w) ? w : (add(w), names.get(w.toLowerCase()) || w)));
const clean = (v) => {
  if (typeof v === 'string') { for (const [re, demo] of res) v = v.replace(re, demo); return / /.test(v) ? latin(v) : v; }
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !['fd', 'test', 'low'].includes(k)).map(([k, x]) => [k, clean(x)]));
  return v;
};
const cut = (q) => {
  const o = structuredClone(q);
  if (o.b?.form) { const me = o.b.me; const keep = o.b.form.slice(0, 12); if (me >= 12 && o.b.form[me]) keep.push(o.b.form[me]); o.b.me = me >= 12 ? keep.length - 1 : me; o.b.form = keep; }
  if (o.pb?.b) o.pb.b = o.pb.b.slice(0, 4);
  return o;
};
const qs = events.filter((e) => e.kind === 'q');
const TERS = ['Тыквенное поле', 'Кладбище', 'Руины', 'Мельница', 'Сухое дерево', 'Заброшенная деревня'];
const pick = new Set();
const sig = (d) => [d.k, d.b?.st, d.tr?.st, d.ev?.st, d.loot ? (d.loot.my === '*' ? 'L*' : d.loot.my ? 'Lme' : 'L') : '', d.pb?.k?.join('/') || ''].join('|');
for (const ter of TERS) {
  const seen = new Set();
  qs.forEach((e, i) => { if (e.data.ter === ter && !seen.has(sig(e.data)) && seen.size < 6) { seen.add(sig(e.data)); pick.add(i); } });
}
// the generated boss on the pumpkin field: the clock vote, the vines, the loot vote (none / random / a cat)
{ const seen = new Set(); qs.forEach((e, i) => { const d = e.data; if (d.k === 'bossgen' && (d.pb || d.loot) && !seen.has(sig(d)) && seen.size < 6) { seen.add(sig(d)); pick.add(i); } }); }
// the route votes (open + done) and the end of the expedition
let v = 0; qs.forEach((e, i) => { if (e.data.vote && v < 2 && (v === 0 ? !e.data.vote.done : e.data.vote.done)) { pick.add(i); v++; } });
const off = qs.findIndex((e) => e.data.on === false); if (off >= 0) pick.add(off);
const out = [...pick].sort((a, b) => a - b).map((i) => ({ t: qs[i].t, data: clean(cut(qs[i].data)) }));
// self-check: no identity of the capture survives (case-insensitive, whole words, ≥ 4 letters)
const text = JSON.stringify(out);
const prose = []; const walkP = (v) => { if (typeof v === 'string') { if (/ /.test(v)) prose.push(v); } else if (Array.isArray(v)) v.forEach(walkP); else if (v && typeof v === 'object') Object.values(v).forEach(walkP); };
out.forEach((e) => walkP(e.data));
const latinLeft = prose.flatMap((t) => t.match(LATIN) || []).filter((w) => !KEEP.has(w.toLowerCase()) && !/^player\d+$/.test(w));
if (latinLeft.length) throw new Error(`latin words left in prose: ${latinLeft.length}`);
const left = list.filter(([n]) => n.length >= 4 && new RegExp(`(?<![\\p{L}\\p{N}_])${esc(n)}(?![\\p{L}\\p{N}_])`, 'iu').test(text)).map(([, d]) => d);
if (left.length) throw new Error(`identities left: ${left.length} (${left.slice(0, 5).join(', ')})`);
fs.writeFileSync(new URL('quest-live-3.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`quest-live-3: ${out.length} q views, ${names.size} identities replaced`);
