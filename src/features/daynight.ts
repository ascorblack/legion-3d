/**
 * «Время суток» — the user-clock day / night cycle of the outdoor places (src/world/daynight.ts does the work inside the
 * city builder and the expedition terrain). This feature owns the controls:
 *   - Settings → Графика → «Время суток»: По часам (default) / День / Закат / Ночь, stored in localStorage `l3d.tod`;
 *   - `?tod=HH:MM` (or `?tod=day|sunset|night|clock`) on a page forces a time — dev pages / screenshots / tests;
 *   - dev handle `__l3dGame.daynight` { set('18:30' | null), mode(m), state() } (the F10 panel's slider uses setTodForce).
 * Interiors and the mine are not touched (they keep their own lights).
 */
import { registerSettingRow, settingValue } from '../ui/settings-ext';
import { DN, TOD_KEY, parseTod, parseTodMode, setTodForce, setTodMode, todSource, type TodMode } from '../world/daynight';
import { coreFeature } from './types';

/** `?tod=` of a location.search: minutes, a mode, or null. */
export function todFromSearch(search: string): { minutes: number | null; mode: TodMode | null } {
  let v: string | null = null;
  try { v = new URLSearchParams(search).get('tod'); } catch { v = null; }
  if (!v) return { minutes: null, mode: null };
  const m = parseTod(v);
  if (m != null) return { minutes: m, mode: null };
  const md = parseTodMode(v);
  return { minutes: null, mode: md === v ? md : null };
}

export default coreFeature({
  id: 'daynight',
  order: 5,
  setup(ctx) {
    const offRow = registerSettingRow({
      key: TOD_KEY, label: 'Время суток', sub: 'Солнце и луна идут по часам компьютера; или всегда день, закат или ночь. В праздничные ночи (Хэллоуин) — всегда ночь',
      group: 'Графика', order: 10, kind: 'seg', options: [['clock', 'По часам'], ['day', 'День'], ['sunset', 'Закат'], ['night', 'Ночь']], def: 'clock',
    });
    const sync = () => setTodMode(parseTodMode(settingValue<string>(TOD_KEY, 'clock')));
    sync();
    const q = todFromSearch(typeof location !== 'undefined' ? location.search : '');
    if (q.minutes != null) setTodForce(q.minutes);
    else if (q.mode) setTodMode(q.mode);
    const urlMode = q.mode;
    const onSettings = (e: Event) => { const k = (e as CustomEvent).detail?.key; if (k === TOD_KEY && !urlMode) sync(); };
    window.addEventListener('l3d:settings', onSettings);
    ctx.dev.daynight = {
      set: (v: string | number | null) => setTodForce(typeof v === 'number' ? v : parseTod(v ?? null)),
      mode: (m: string) => setTodMode(parseTodMode(m)),
      state: () => ({ source: todSource(), sunAlt: DN.sunAlt, night: DN.night, tw: DN.tw, day: DN.day, lit: DN.lit, version: DN.version }),
    };
    return () => {
      offRow(); window.removeEventListener('l3d:settings', onSettings);
      setTodForce(null); setTodMode('clock');
    };
  },
});
