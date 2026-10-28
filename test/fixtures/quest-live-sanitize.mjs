// Run manually on local read-only captures; never publish the raw captures.
import fs from 'node:fs';
const captures = ['2026-10-28T14-11-51', '2026-10-28T14-11-25'];
const root = new URL('../../e2e/.artifacts/quest/', import.meta.url);
const names = new Map();
const add = (name) => { if (typeof name === 'string' && name.length >= 3 && !names.has(name)) names.set(name, `player${names.size + 1}`); };
const streams = captures.map((id) => fs.readFileSync(new URL(`${id}/events.jsonl`, root), 'utf8').trim().split('\n').map(JSON.parse).filter((e) => e.kind === 'q'));
for (const stream of streams) for (const {data: q} of stream) {
  add(q.roll?.by);
  for (const p of q.b?.form || []) add(p[0]);
  for (const p of q.b?.low || []) { add(p[0]); add(p[1]); }
  for (const p of q.tr?.best || []) add(p[2]);
  if (typeof q.tr?.taker === 'string') add(q.tr.taker);
}
const entries = [...names].sort((a,b) => b[0].length - a[0].length);
const sanitize = (v) => {
  if (typeof v === 'string') { for (const [name, demo] of entries) v = v.replaceAll(name, demo); return v; }
  if (Array.isArray(v)) return v.map(sanitize);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([key]) => !['fd', 'test'].includes(key)).map(([key, value]) => [key, sanitize(value)]));
  return v;
};
streams.forEach((stream, i) => {
  const out = stream.map(({t, data}) => ({t, data: sanitize(data)}));
  fs.writeFileSync(new URL(`quest-live-${i+1}.json`, import.meta.url), JSON.stringify(out, null, 2) + '\n');
  console.log(`quest-live-${i+1}: ${out.length} q snapshots`);
});
