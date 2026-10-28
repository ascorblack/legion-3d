/**
 * Debug report (the «Скопировать отчёт» button) and the bus log masking. Built for bug reports that are pasted into a
 * public chat or issue: versions, browser, GPU, quality, our settings, the site contract and drift — and NO personal
 * data: no login / nickname, no cookies, no tokens, no URLs with query strings of the page, no chat lines.
 * Pure functions (inputs passed in) — test/debug-report.test.ts.
 */
import type { ContractFail } from '../net/contract';

/** Keys whose values are names / logins in the site's payloads (walkers `l`/`n`, chat `l`/`n`/`to`, quest `by`…). */
const NAME_KEYS = new Set(['l', 'n', 'login', 'name', 'nick', 'by', 'to', 'from', 'author', 'user', 'who', 'taker', 'hero', 'heroName', 'ln', 'ignore', 'ign', 'sid', 'token', 'cookie', 't', 'text']);
export const MASK = '•••';

/** A copy of `v` with every name-like field (and any string containing one of `secrets`) replaced by •••. */
export function maskPayload(v: unknown, secrets: readonly string[] = [], depth = 0): unknown {
  if (depth > 6) return '…';
  if (typeof v === 'string') { const lo = v.toLowerCase(); return secrets.some((s) => s && lo.includes(s.toLowerCase())) ? MASK : v; }
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => maskPayload(x, secrets, depth + 1));
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    let n = 0;
    for (const k of Object.keys(v as object)) {
      if (n++ > 40) { o['…'] = '…'; break; }
      const x = (v as Record<string, unknown>)[k];
      o[k] = NAME_KEYS.has(k) && (typeof x === 'string' || typeof x === 'object') && x !== null ? MASK : maskPayload(x, secrets, depth + 1);
    }
    return o;
  }
  return v;
}
/** One-line preview of a payload (masked, ≤ max chars). */
export function preview(v: unknown, secrets: readonly string[] = [], max = 180): string {
  let s = '';
  try { s = JSON.stringify(maskPayload(v, secrets)) ?? String(v); } catch { s = String(v); }
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export interface ReportInput {
  version: string; dev: boolean;
  ua: string; platform: string; lang: string;
  screen: string; dpr: number;
  gpu: string; webgl2: boolean;
  quality: { setting: string; level: number; scale?: number; pixelRatio?: number; post?: boolean; shadows?: boolean };
  perf: { fps: number; ms: number; calls: number; tris: number; cpuMs?: number };
  memory?: { geometries: number; textures: number; heapMB?: number };
  town?: string; space?: string;
  settings: Record<string, string>;
  contract: { phase: string; fails: ContractFail[]; checked: number };
  drift: { kind: string; id: string }[];
  scripts: string[];
  /** Strings that must never appear (own login, display name) — masked anywhere. */
  secrets: string[];
}

/** Settings worth reporting: our own `l3d.*` keys, without per-account keys (they carry the login) and big blobs. */
export function pickSettings(storage: { length: number; key(i: number): string | null; getItem(k: string): string | null }, secrets: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const sec = secrets.filter(Boolean).map((s) => s.toLowerCase());
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i); if (!k || !k.startsWith('l3d')) continue;
    const kl = k.toLowerCase();
    if (sec.some((s) => kl.includes(s) || kl.includes(encodeURIComponent(s)))) continue;
    if (/login|nick|token|cookie|sid|seen\.|showcase\.|journal|chat/i.test(k)) continue;
    const v = storage.getItem(k) ?? '';
    if (v.length > 60) continue;
    if (sec.some((s) => v.toLowerCase().includes(s))) continue;
    out[k] = v;
  }
  return out;
}

/** Site script names + their cache-busting version (`/site/city.js?v=123` → `city.js v=123`): what build of the site this is. */
export function siteScripts(srcs: readonly string[], origin: string): string[] {
  const out: string[] = [];
  for (const s of srcs) {
    try {
      const u = new URL(s, origin);
      if (u.origin !== origin) continue;
      const name = u.pathname.split('/').filter(Boolean).slice(-2).join('/');
      const v = u.searchParams.get('v') || u.searchParams.get('ver') || '';
      out.push(v ? `${name} v=${v.slice(0, 16)}` : name);
    } catch { /* */ }
  }
  return out.slice(0, 40);
}

/** The text that goes to the clipboard (Markdown, Russian headings). */
export function buildReport(r: ReportInput): string {
  const L: string[] = [];
  L.push('### Legion 3D — отчёт для разработчиков');
  L.push(`- Версия: ${r.version}${r.dev ? ' (dev-сборка)' : ''}`);
  L.push(`- Браузер: ${r.ua}`);
  L.push(`- Платформа: ${r.platform} · язык ${r.lang} · экран ${r.screen} @${r.dpr}`);
  L.push(`- GPU: ${r.gpu}${r.webgl2 ? ' · WebGL2' : ' · WebGL1'}`);
  L.push(`- Качество: ${r.quality.setting} → q${r.quality.level}${r.quality.scale != null ? ' · масштаб ' + r.quality.scale : ''}${r.quality.pixelRatio != null ? ' · DPR ' + r.quality.pixelRatio : ''}${r.quality.post != null ? ' · пост ' + (r.quality.post ? 'вкл' : 'выкл') : ''}${r.quality.shadows != null ? ' · тени ' + (r.quality.shadows ? 'вкл' : 'выкл') : ''}`);
  L.push(`- Кадр: ${r.perf.fps} fps · ${r.perf.ms} мс${r.perf.cpuMs != null ? ' (CPU ' + r.perf.cpuMs + ' мс)' : ''} · ${r.perf.calls} вызовов · ${r.perf.tris} треуг.`);
  if (r.memory) L.push(`- Память GPU: ${r.memory.geometries} геометрий · ${r.memory.textures} текстур${r.memory.heapMB != null ? ' · JS ' + r.memory.heapMB + ' МБ' : ''}`);
  if (r.town || r.space) L.push(`- Где: город ${r.town || '?'}${r.space ? ' · ' + r.space : ''}`);
  const fails = r.contract.fails;
  L.push(`- Контракт сайта (${r.contract.phase}): ${fails.length ? fails.length + ' из ' + r.contract.checked + ' не прошли' : 'всё на месте (' + r.contract.checked + ')'}`);
  for (const f of fails) L.push(`  - ${f.severity === 'break' ? 'BREAK' : 'degrade'} ${f.id}: ${f.missing.join(', ')}`);
  L.push(`- Не поддерживается (drift): ${r.drift.length ? r.drift.map((d) => d.kind + ':' + d.id).join(', ') : 'нет'}`);
  if (r.scripts.length) L.push(`- Скрипты сайта: ${r.scripts.join(', ')}`);
  const keys = Object.keys(r.settings).sort();
  if (keys.length) L.push(`- Настройки: ${keys.map((k) => k.replace(/^l3d\./, '') + '=' + r.settings[k]).join(', ')}`);
  let text = L.join('\n');
  // last line of defence: whatever slipped through, the own login / name never leaves
  for (const s of r.secrets) if (s && s.length >= 2) text = text.split(s).join(MASK);
  return text;
}
