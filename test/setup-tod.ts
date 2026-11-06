/**
 * Every test runs at a pinned time of day (vitest setupFiles): the day / night cycle (src/world/daynight.ts) follows the
 * user's local clock, and what an outdoor scene builds depends on it — the expedition terrain is a night build after dusk
 * (expedition/terrain.ts clockNight: fireflies, night halos), the towns take their night look — so lint counts, budgets
 * and z-fight checks would change with the hour and the time zone the suite runs in (CI: UTC).
 * `L3D_TOD=HH:MM` picks the time (default 12:00): `L3D_TOD=23:00 npx vitest run` runs the whole suite at night.
 * test/daynight.test.ts resets the cycle (resetDayNight) around its own tests.
 */
import { setTodForce, parseTod } from '../src/world/daynight';

/** Pin the clock for the day / night cycle; returns the minutes. */
export function pinTod(): number {
  const m = parseTod(process.env.L3D_TOD || '12:00') ?? 720;
  setTodForce(m);
  return m;
}
pinTod();
