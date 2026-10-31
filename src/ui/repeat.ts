/**
 * Held keys (0.6.2): a key held down auto-repeats keydown. A toggle (open / close / switch a menu, a panel, a mode) must
 * act on the first press only — holding I opened the bag and closed it again, holding F10 closed the debug window.
 * The page's own navigation inside a menu (arrows, PageUp / PageDown…) may repeat.
 */
/** Menu keys that open, close or switch: never acted on while repeating. Tab keys of the registry are toggles too. */
export const TOGGLE_KEYS: ReadonlySet<string> = new Set(['Escape', 'F1', 'F2', 'F3', 'F9', 'F10', 'KeyH', 'KeyQ', 'KeyE', 'BracketLeft', 'BracketRight', 'Tab']);

/** What a menu does with a keydown: 'act' (first press, or a repeating navigation key) or 'swallow' (a repeating toggle). */
export function heldKey(code: string, repeat: boolean, isTabKey: boolean): 'act' | 'swallow' {
  if (!repeat) return 'act';
  return TOGGLE_KEYS.has(code) || isTabKey ? 'swallow' : 'act';
}
