/** Mine display switches (settings group «Шахта», rows registered in afk.ts). No DOM besides localStorage. */
export const PREF_ECON = 'l3d.mine.econ';
export const PREF_LAYERS = 'l3d.mine.layers';
/** A mine display switch stored as 'on' / 'off' (older builds wrote '1' / '0'); on when unset. */
export function mineSwitch(key: string): boolean {
  let v: string | null = null;
  try { v = typeof localStorage === 'undefined' ? null : localStorage.getItem(key); } catch { /* private mode */ }
  return v !== '0' && v !== 'off';
}
