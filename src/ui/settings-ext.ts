/**
 * Extra rows for the Settings page, registered by features (sound volumes, seasonal events, photo mode…) without
 * touching menus.ts. A row stores its value in localStorage under `key` and fires 'l3d:settings' on change.
 *
 *   registerSettingRow({ key: 'l3d.vol.master', label: 'Громкость', kind: 'range', min: 0, max: 1, step: 0.05,
 *                        def: 0.5, fmt: (v) => Math.round(v * 100) + '%', group: 'Звук', order: 10 });
 */
export interface SettingRowBase { key: string; label: string; sub?: string; group?: string; order?: number }
export interface RangeRow extends SettingRowBase { kind: 'range'; min: number; max: number; step: number; def: number; fmt?: (v: number) => string }
export interface SegRow extends SettingRowBase { kind: 'seg'; options: [string, string][]; def: string }
/** Read-only text row (explanations); `text` is re-evaluated on every render. */
export interface InfoRow extends SettingRowBase { kind: 'info'; text: () => string }
export type SettingRow = RangeRow | SegRow | InfoRow;

const ROWS = new Map<string, SettingRow>();

/** What is wrong with a row's default ('' = fine): a seg `def` must be one of its option values, a range `def` inside [min, max]. */
export function rowProblem(r: SettingRow): string {
  if (r.kind === 'seg') return r.options.some(([v]) => v === r.def) ? '' : `def «${r.def}» is not one of its options (${r.options.map(([v]) => v).join(', ')})`;
  if (r.kind === 'range') return Number.isFinite(r.def) && r.def >= r.min && r.def <= r.max ? '' : `def ${r.def} outside [${r.min}, ${r.max}]`;
  return '';
}
/** Add (or replace) a row; returns an unregister function. */
export function registerSettingRow(r: SettingRow): () => void {
  const bad = rowProblem(r); if (bad) console.warn('[l3d] setting row', r.key, bad);
  ROWS.set(r.key, r);
  return () => { if (ROWS.get(r.key) === r) ROWS.delete(r.key); };
}
/** Rows sorted by group, then order. */
export function settingRows(): SettingRow[] {
  return [...ROWS.values()].sort((a, b) => (a.group || '').localeCompare(b.group || '') || (a.order ?? 0) - (b.order ?? 0));
}
export function settingRow(key: string): SettingRow | undefined { return ROWS.get(key); }

export function readRow(r: SettingRow): number | string {
  if (r.kind === 'info') return '';
  let raw: string | null = null;
  try { raw = localStorage.getItem(r.key); } catch { /* private mode */ }
  if (r.kind === 'range') { const v = raw == null ? NaN : parseFloat(raw); return Number.isFinite(v) ? Math.min(r.max, Math.max(r.min, v)) : r.def; }
  return raw != null && r.options.some(([v]) => v === raw) ? raw : r.def;
}
export function writeRow(r: SettingRow, v: number | string): void {
  try { localStorage.setItem(r.key, String(v)); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent('l3d:settings', { detail: { key: r.key, value: v } }));
}
/** Value of a registered row (or a fallback for an unregistered key). */
export function settingValue<T extends number | string>(key: string, fallback: T): T {
  const r = ROWS.get(key); return r ? (readRow(r) as T) : fallback;
}

/* ------------------------------------------------------------------ pause menu items */
/** An extra pause-menu entry (photo mode, …): shown before «Настройки»; `run` is called after the menu closes. */
export interface PauseItem { id: string; label: string; key?: string; order?: number; enabled?: () => boolean; run: () => void }
const PAUSE = new Map<string, PauseItem>();
export function registerPauseItem(p: PauseItem): () => void {
  PAUSE.set(p.id, p);
  return () => { if (PAUSE.get(p.id) === p) PAUSE.delete(p.id); };
}
export function pauseItems(): PauseItem[] {
  return [...PAUSE.values()].filter((p) => !p.enabled || p.enabled()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
export function pauseItem(id: string): PauseItem | undefined { return PAUSE.get(id); }
