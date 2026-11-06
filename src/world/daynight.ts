/**
 * Real-time day / night for the outdoor places (old fair, cats fair, Town Kit towns, camp, villages; the expedition reads
 * the same state). The sun follows the USER'S local clock (`new Date()`: time zone + date, nothing else): hour angle from
 * the clock (minus the daylight-saving shift), declination from the day of the year, a fixed latitude of 50°N. The moon is
 * the antisolar point (a full-moon path: it rises at dusk in the east, is high in the south at midnight, sets at dawn).
 *
 * World frame: north = +z, east = −x, up = +y — the old fair's facades face +z, so the noon sun and the night moon stand
 * over the rooftops in the view (−z = south), as the fixed moon did before.
 *
 * Phases (sun altitude a, degrees), continuous weights that always sum to 1:
 *   night = 1 − smoothstep(−12, −2, a)   twilight = 1 − night − day   day = smoothstep(3, 18, a)
 * twilight is split into dawn / dusk by the hour angle. Lamps (`lit`) come on below ~10°, stars below −3°.
 *
 * State: `DN` (a singleton) re-evaluated at most every 0.5 s by `tickDayNight(nowMs)`; `DN.version` bumps only when
 * something visible changed, so the per-frame cost is one comparison. Overrides, strongest first: a held night (seasonal
 * events that assume night: Halloween, the Pumpkin Moon) → a forced clock time (`?tod=HH:MM`, the F10 slider) → the
 * setting `l3d.tod` (clock / day / sunset / night). A place with its own fixed mood (the cherts quarter) is not cycled.
 *
 * Looks: a place hands `createDayNight` its night key (today's look, captured from what the city builder made) and a day
 * key; dawn / dusk keys are shared. `apply` blends them into the sky dome, fog, background, lights, water, pools, emit
 * colour and the shared uniforms of src/world/dnUniforms.ts. No allocations after creation.
 */
import * as THREE from 'three';
import { parseGradient } from './palette';
import { DN_U } from './dnUniforms';

export { DN_U };
export const TOD_KEY = 'l3d.tod';
export type TodMode = 'clock' | 'day' | 'sunset' | 'night';
export const TOD_MODES: readonly TodMode[] = ['clock', 'day', 'sunset', 'night'];
export const LATITUDE = 50;

const D2R = Math.PI / 180;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/* ------------------------------------------------------------------ astronomy */
// per-year cache (Jan 1 local midnight, the standard-time offset): the tick allocates no Date objects
let cY = NaN, cStart = 0, cStd = 0;
function yearOf(d: Date): void {
  const y = d.getFullYear();
  if (y === cY) return;
  const j = new Date(y, 0, 1);
  cY = y; cStart = j.getTime(); cStd = Math.max(j.getTimezoneOffset(), new Date(y, 6, 1).getTimezoneOffset());
}
/** Day of the year 0…365 (local date). */
export function dayOfYear(d: Date): number {
  yearOf(d);
  return Math.floor((d.getTime() - cStart) / 86400000 + 1e-6);
}
/** Local clock minutes of a date, without the daylight-saving shift (≈ local solar time of the time zone). */
export function solarMinutes(d: Date): number {
  yearOf(d);
  const dst = cStd - d.getTimezoneOffset();   // 60 in summer time, 0 otherwise
  return ((d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 - dst) % 1440 + 1440) % 1440;
}
/** Solar declination (radians) for a day of the year. */
export const declination = (doy: number) => -23.44 * D2R * Math.cos((2 * Math.PI / 365) * (doy + 10));

/**
 * Unit vector towards the sun in the world frame for local solar minutes + day of the year; returns the altitude (°).
 * East = −x, north = +z.
 */
export function sunVector(minutes: number, doy: number, out: THREE.Vector3, lat = LATITUDE): number {
  const H = ((minutes / 60) - 12) * 15 * D2R, d = declination(doy), f = lat * D2R;
  const east = -Math.cos(d) * Math.sin(H);
  const north = Math.cos(f) * Math.sin(d) - Math.sin(f) * Math.cos(d) * Math.cos(H);
  const up = Math.sin(f) * Math.sin(d) + Math.cos(f) * Math.cos(d) * Math.cos(H);
  out.set(-east, up, north);
  return Math.asin(Math.max(-1, Math.min(1, up))) / D2R;
}

/* ------------------------------------------------------------------ state */
export interface DnState {
  /** towards the sun / the moon (unit, world frame) */
  sun: THREE.Vector3; moon: THREE.Vector3;
  /** direction of the directional key light (sun by day, moon by night; elevation clamped for sane shadows) */
  key: THREE.Vector3;
  sunAlt: number;
  /** phase weights: night + tw + day = 1; am = share of the twilight that is dawn */
  night: number; tw: number; day: number; am: number;
  /** lamps / windows on, stars, moon disc, sun disc, fireflies (0…1) */
  lit: number; stars: number; moonVis: number; sunVis: number; flies: number;
  /** key light strength factors: sun part, moon part (never both > 0) */
  sunK: number; moonK: number;
  /** what is driving it now ('clock', 'day', 'sunset', 'night', 'force', 'hold', 'fixed') */
  source: string;
  /** local solar minutes in use (NaN for presets) */
  minutes: number;
  version: number;
}
const mk = (): DnState => ({ sun: new THREE.Vector3(), moon: new THREE.Vector3(), key: new THREE.Vector3(), sunAlt: 0, night: 1, tw: 0, day: 0, am: 0,
  lit: 1, stars: 1, moonVis: 1, sunVis: 0, flies: 1, sunK: 0, moonK: 1, source: 'night', minutes: NaN, version: 0 });
export const DN: DnState = mk();

/** The fixed moon of the old night (src/world/index.ts before the cycle): the 'night' preset puts the moon exactly there. */
export const OLD_MOON = new THREE.Vector3(-0.45, 0.55, -0.7).normalize();
const PRESET_SUN: Record<Exclude<TodMode, 'clock'>, [number, number, number]> = {
  day: [OLD_MOON.x, OLD_MOON.y, OLD_MOON.z],          // the direction the fixed daytime mood of the cats fair was tuned with
  sunset: [0.86, Math.sin(2.5 * D2R), -0.5],            // low in the west-south-west (+x, a little −z: in the view)
  night: [-OLD_MOON.x, -OLD_MOON.y, -OLD_MOON.z],       // antisolar = the old moon
};

/** Fill every derived field of `s` from its sun vector (unit) and the morning share. Pure, no allocations. */
export function derive(s: DnState, am: number): DnState {
  const a = Math.asin(Math.max(-1, Math.min(1, s.sun.y))) / D2R;
  s.sunAlt = a; s.am = am;
  s.moon.copy(s.sun).negate();
  s.night = 1 - smooth(-12, -2, a);
  s.day = smooth(3, 18, a);
  s.tw = Math.max(0, 1 - s.night - s.day);
  s.lit = 1 - smooth(0, 10, a);
  s.stars = 1 - smooth(-10, -3, a);
  s.flies = 1 - smooth(-6, 2, a);
  s.sunVis = smooth(-3, 1, a);
  s.moonVis = (1 - smooth(-8, 0, a)) * smooth(-2, 4, -a);
  s.sunK = smooth(-3, 4, a);
  s.moonK = 1 - smooth(-8, -3, a);
  // key light: the sun above −3°, else the moon; elevation clamped (12° sun, 28° moon) so shadows stay readable
  const src = a > -3 ? s.sun : s.moon, minEl = a > -3 ? 12 : 28;
  const el = Math.asin(Math.max(-1, Math.min(1, src.y))) / D2R;
  if (el >= minEl) s.key.copy(src);
  else {
    const h = Math.hypot(src.x, src.z) || 1, c = Math.cos(minEl * D2R);
    s.key.set((src.x / h) * c, Math.sin(minEl * D2R), (src.z / h) * c);
  }
  return s;
}

/** Evaluate the state for a local date (clock mode). */
export function stateAtDate(d: Date, out: DnState): DnState {
  return stateAtMinutes(solarMinutes(d), dayOfYear(d), out);
}
export function stateAtMinutes(minutes: number, doy: number, out: DnState): DnState {
  sunVector(minutes, doy, out.sun);
  out.minutes = minutes;
  // morning share by the hour angle: 1 before noon, 0 after (soft round noon / midnight where the twilight is 0 anyway)
  const H = ((minutes / 60) - 12) * 15 * D2R;
  return derive(out, smooth(-0.25, 0.25, -Math.sin(H)));
}
export function stateOfPreset(mode: Exclude<TodMode, 'clock'>, out: DnState): DnState {
  const p = PRESET_SUN[mode];
  out.sun.set(p[0], p[1], p[2]).normalize();
  out.minutes = NaN;
  return derive(out, 0);
}

/* ------------------------------------------------------------------ overrides + tick */
let mode: TodMode = 'clock';
let force: number | null = null;   // local clock minutes (dev ?tod=, F10 slider)
const holds = new Set<string>();
let lastEval = -1e12, dirty = true;
const listeners = new Set<() => void>();
const tmp = mk();
const _date = new Date();

export function parseTodMode(v: unknown): TodMode { return TOD_MODES.includes(v as TodMode) ? (v as TodMode) : 'clock'; }
/** «HH:MM» (or «H», «HH.5») → minutes, null when not a time. */
export function parseTod(v: string | null | undefined): number | null {
  if (!v) return null;
  const m = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(v.trim());
  if (!m) return null;
  const h = +m[1], mi = m[2] ? +m[2] : 0;
  return h <= 24 && mi < 60 ? (h * 60 + mi) % 1440 : null;
}
export function setTodMode(m: TodMode): void { if (m !== mode) { mode = m; dirty = true; tickDayNight(); } }
export const todMode = () => mode;
/** Force a local clock time (minutes) or release it (null). */
export function setTodForce(minutes: number | null): void { force = minutes == null ? null : ((minutes % 1440) + 1440) % 1440; dirty = true; tickDayNight(); }
export const todForce = () => force;
/**
 * Hold the night while a seasonal event that assumes it is on (Halloween, the Pumpkin Moon). Applies at once (the event
 * reads the scene right after); returns the release.
 */
export function holdNight(id: string): () => void {
  holds.add(id); dirty = true; tickDayNight();
  return () => { if (holds.delete(id)) { dirty = true; tickDayNight(); } };
}
export const nightHeld = () => holds.size > 0;
/** Called (synchronously) after every version bump — the live world applies the new state. */
export function onDayNight(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

function changed(a: DnState, b: DnState): boolean {
  const e = 1e-4;
  return Math.abs(a.night - b.night) > e || Math.abs(a.day - b.day) > e || Math.abs(a.am - b.am) > e || Math.abs(a.lit - b.lit) > e
    || Math.abs(a.sun.x - b.sun.x) > 2e-4 || Math.abs(a.sun.y - b.sun.y) > 2e-4 || Math.abs(a.sun.z - b.sun.z) > 2e-4 || a.source !== b.source;
}
function copyState(from: DnState, to: DnState): void {
  to.sun.copy(from.sun); to.moon.copy(from.moon); to.key.copy(from.key);
  to.sunAlt = from.sunAlt; to.night = from.night; to.tw = from.tw; to.day = from.day; to.am = from.am;
  to.lit = from.lit; to.stars = from.stars; to.moonVis = from.moonVis; to.sunVis = from.sunVis; to.flies = from.flies;
  to.sunK = from.sunK; to.moonK = from.moonK; to.source = from.source; to.minutes = from.minutes;
}

/** The source in charge now (for the debug panel / tests). */
export function todSource(): string { return holds.size ? 'hold' : force != null ? 'force' : mode; }

/**
 * Re-evaluate (at most every 0.5 s unless something changed); returns true when DN.version bumped.
 * `now` is a Date.now()-like clock (ms); the date for the clock mode is `new Date(now)`.
 */
export function tickDayNight(now: number = Date.now()): boolean {
  if (!dirty && now - lastEval < 500 && now >= lastEval) return false;
  dirty = false; lastEval = now;
  const src = todSource();
  if (src === 'hold') stateOfPreset('night', tmp);
  else if (src === 'force') { _date.setTime(now); stateAtMinutes(force!, dayOfYear(_date), tmp); }
  else if (src === 'clock') { _date.setTime(now); stateAtDate(_date, tmp); }
  else stateOfPreset(src as Exclude<TodMode, 'clock'>, tmp);
  tmp.source = src;
  if (DN.version > 0 && !changed(tmp, DN)) return false;
  copyState(tmp, DN);
  DN.version++;
  DN_U.lit.value = DN.lit; DN_U.stars.value = DN.stars; DN_U.night.value = DN.night;
  for (const fn of listeners) { try { fn(); } catch (e) { console.warn('[l3d] day/night listener', e); } }
  return true;
}
/** Tests: back to the initial state. */
export function resetDayNight(): void {
  mode = 'clock'; force = null; holds.clear(); listeners.clear(); dirty = true; lastEval = -1e12;
  copyState(stateOfPreset('night', mk()), DN); DN.version = 0; DN.source = 'night';
  DN_U.lit.value = 1; DN_U.stars.value = 1; DN_U.night.value = 1;
}

/* ------------------------------------------------------------------ looks */
export interface SkyKey { c: THREE.Color[]; p: THREE.Vector4; hz: THREE.Color }
export interface DnKey extends SkyKey {
  fog: THREE.Color;
  hemiSky: THREE.Color; hemiGround: THREE.Color; hemiI: number;
  amb: THREE.Color; ambI: number;
  key: THREE.Color; keyI: number;
  /** the pools' rim colour (cool moon rim at night) */
  rim: THREE.Color;
  /** strength of the paving's darkening between pools (1 = the night tuning) */
  dimK: number;
  /** scalar colour of the 'emit' material (lit windows, lamp cores, embers) */
  emit: number;
  /** soft daytime clouds in the dome (0…1) */
  cloud: number;
}

/** The 4 stops + horizon band of a CSS sky gradient, as the sky dome draws them (src/world/sky.ts skyDome). */
export function skyStops(css: string | undefined): SkyKey {
  const stops = parseGradient(css).slice(0, 4);
  while (stops.length < 4) stops.push({ ...stops[stops.length - 1], p: 1 });
  const c = stops.map((s) => new THREE.Color(s.c));
  const hz = c[3].clone().lerp(new THREE.Color('#d08cb0'), 0.3).multiplyScalar(1.25);
  return { c, p: new THREE.Vector4(stops[0].p, stops[1].p, stops[2].p, stops[3].p), hz };
}

export interface KeyInit {
  sky: string | SkyKey; fog?: THREE.Color | string;
  hemi: [string | THREE.Color, string | THREE.Color, number]; amb: [string | THREE.Color, number]; key: [string | THREE.Color, number];
  rim?: string | THREE.Color; dimK?: number; emit?: number; cloud?: number;
}
const col = (c: string | THREE.Color) => (typeof c === 'string' ? new THREE.Color(c) : c.clone());
export function makeKey(o: KeyInit): DnKey {
  const s = typeof o.sky === 'string' ? skyStops(o.sky) : { c: o.sky.c.map((x) => x.clone()), p: o.sky.p.clone(), hz: o.sky.hz.clone() };
  return {
    ...s, fog: o.fog ? col(o.fog) : s.hz.clone(),
    hemiSky: col(o.hemi[0]), hemiGround: col(o.hemi[1]), hemiI: o.hemi[2], amb: col(o.amb[0]), ambI: o.amb[1], key: col(o.key[0]), keyI: o.key[1],
    rim: col(o.rim ?? '#7f95ff'), dimK: o.dimK ?? 1, emit: o.emit ?? 1.3, cloud: o.cloud ?? 0,
  };
}

/** Shared twilight keys (dawn: pink / gold, dusk: orange / violet). */
export const DAWN = (): DnKey => makeKey({ sky: 'linear-gradient(#3c4f9e 0%, #8f7cc4 40%, #f2a4b0 75%, #ffd2a0 100%)',
  hemi: ['#f4c4c0', '#5a4058', 1.4], amb: ['#b498bc', 0.45], key: ['#ffb68a', 1.6], rim: '#ffb0a0', dimK: 1, emit: 1.15, cloud: 0.35 });
export const DUSK = (): DnKey => makeKey({ sky: 'linear-gradient(#262a70 0%, #6e4a98 38%, #e6807e 72%, #ffb070 100%)',
  hemi: ['#f0a890', '#4a3048', 1.3], amb: ['#a880a8', 0.4], key: ['#ff8c48', 1.7], rim: '#ff9a80', dimK: 1, emit: 1.2, cloud: 0.3 });

export interface DnTargets {
  sky?: THREE.ShaderMaterial | null;
  fog?: THREE.Fog | null;
  bg?: THREE.Color | null;
  hemi?: THREE.HemisphereLight | null;
  amb?: THREE.AmbientLight | null;
  key?: THREE.DirectionalLight | null;
  moon?: THREE.Sprite | null;
  /** pools' uniforms (src/world/lightPools.ts) */
  pools?: { uL3dRim: { value: THREE.Color }; uL3dLit: { value: number }; uL3dDimK: { value: number } } | null;
  /** water uniforms (src/world/water.ts) */
  water?: { uWZen: { value: THREE.Color }; uWHor: { value: THREE.Color }; uWMoon: { value: THREE.Vector3 } } | null;
  emit?: THREE.MeshBasicMaterial | null;
  /** motes brightness uniform + its base value + kind */
  motes?: { u: { value: number }; base: number; fireflies: boolean } | null;
}

export interface DayNight {
  /** current blended values (read by the world each frame for the light / moon placement) */
  readonly keyDir: THREE.Vector3; readonly moonDir: THREE.Vector3;
  /** apply DN if it changed since the last call (cheap: one comparison) — returns true when it applied */
  update(): boolean;
  /** apply unconditionally */
  apply(): void;
  readonly fixed: boolean;
  dispose(): void;
}

/**
 * Bind a place's looks to its scene objects. `fixed` = the place keeps its night mood (cherts): the state is then always
 * the 'night' preset for it (the targets are left at their build values).
 */
export function createDayNight(look: { night: DnKey; day: DnKey; dawn?: DnKey; dusk?: DnKey; fixed?: boolean }, T: DnTargets): DayNight {
  const N = look.night, Dd = look.day, Da = look.dawn ?? DAWN(), Du = look.dusk ?? DUSK();
  const keyDir = OLD_MOON.clone(), moonDir = OLD_MOON.clone();
  let seen = -1;
  const sk = T.sky?.uniforms;
  const tv = new THREE.Vector4();
  const fixed = !!look.fixed;
  // weights of the four keys
  let wn = 1, wa = 0, wu = 0, wd = 0;
  const mixC = (out: THREE.Color, a: THREE.Color, b: THREE.Color, c: THREE.Color, d: THREE.Color) =>
    out.setRGB(a.r * wn + b.r * wa + c.r * wu + d.r * wd, a.g * wn + b.g * wa + c.g * wu + d.g * wd, a.b * wn + b.b * wa + c.b * wu + d.b * wd);
  const mixN = (a: number, b: number, c: number, d: number) => a * wn + b * wa + c * wu + d * wd;

  function apply(): void {
    seen = DN.version;
    if (fixed) { DN_U.lit.value = 1; DN_U.stars.value = 1; DN_U.night.value = 1; return; }
    const s = DN;
    wn = s.night; wa = s.tw * s.am; wu = s.tw * (1 - s.am); wd = s.day;
    keyDir.copy(s.key); moonDir.copy(s.moon);
    if (sk) {
      for (let i = 0; i < 4; i++) mixC(sk['c' + i].value as THREE.Color, N.c[i], Da.c[i], Du.c[i], Dd.c[i]);
      tv.set(0, 0, 0, 0).addScaledVector(N.p, wn).addScaledVector(Da.p, wa).addScaledVector(Du.p, wu).addScaledVector(Dd.p, wd);
      (sk.p.value as THREE.Vector4).copy(tv);
      mixC(sk.hz.value as THREE.Color, N.hz, Da.hz, Du.hz, Dd.hz);
      if (sk.uMoon) (sk.uMoon.value as THREE.Vector3).copy(s.moon);
      if (sk.uMoonK) sk.uMoonK.value = s.moonVis;
      if (sk.uSun) (sk.uSun.value as THREE.Vector3).copy(s.sun);
      if (sk.uSunK) sk.uSunK.value = s.sunVis;
      if (sk.uSunCol) mixC(sk.uSunCol.value as THREE.Color, N.key, Da.key, Du.key, Dd.key);
      if (sk.uCloud) sk.uCloud.value = mixN(N.cloud, Da.cloud, Du.cloud, Dd.cloud);
    }
    if (T.fog) mixC(T.fog.color, N.fog, Da.fog, Du.fog, Dd.fog);
    if (T.bg) mixC(T.bg, N.c[0], Da.c[0], Du.c[0], Dd.c[0]);
    if (T.hemi) {
      mixC(T.hemi.color, N.hemiSky, Da.hemiSky, Du.hemiSky, Dd.hemiSky);
      mixC(T.hemi.groundColor, N.hemiGround, Da.hemiGround, Du.hemiGround, Dd.hemiGround);
      T.hemi.intensity = mixN(N.hemiI, Da.hemiI, Du.hemiI, Dd.hemiI);
    }
    if (T.amb) { mixC(T.amb.color, N.amb, Da.amb, Du.amb, Dd.amb); T.amb.intensity = mixN(N.ambI, Da.ambI, Du.ambI, Dd.ambI); }
    if (T.key) {
      // sun part: the twilight / day keys; moon part: the night key (never both at once)
      const sw = wa + wu + wd;
      if (s.sunK > 0 && sw > 1e-4) {
        T.key.color.setRGB((Da.key.r * wa + Du.key.r * wu + Dd.key.r * wd) / sw, (Da.key.g * wa + Du.key.g * wu + Dd.key.g * wd) / sw, (Da.key.b * wa + Du.key.b * wu + Dd.key.b * wd) / sw);
        T.key.intensity = s.sunK * (Da.keyI * wa + Du.keyI * wu + Dd.keyI * wd) / sw;
      } else { T.key.color.copy(N.key); T.key.intensity = s.moonK * N.keyI; }
    }
    if (T.moon) { const m = T.moon.material as THREE.SpriteMaterial; m.opacity = s.moonVis; T.moon.visible = s.moonVis > 0.01; }
    if (T.pools) {
      mixC(T.pools.uL3dRim.value, N.rim, Da.rim, Du.rim, Dd.rim);
      T.pools.uL3dLit.value = s.lit;
      T.pools.uL3dDimK.value = mixN(N.dimK, Da.dimK, Du.dimK, Dd.dimK);
    }
    if (T.water) {
      if (sk) { T.water.uWZen.value.copy(sk.c0.value as THREE.Color); T.water.uWHor.value.copy(sk.hz.value as THREE.Color); }
      T.water.uWMoon.value.copy(s.sunK > 0 ? s.sun : s.moon);
    }
    if (T.emit) T.emit.color.setScalar(mixN(N.emit, Da.emit, Du.emit, Dd.emit));
    if (T.motes) T.motes.u.value = T.motes.base * (T.motes.fireflies ? s.flies : 0.35 + 0.65 * s.lit);
  }
  const update = () => { if (DN.version === seen) return false; apply(); return true; };
  // applied at once (an event that reads / tints the scene right after the build sees the current look) and on every
  // change pushed synchronously (holdNight applies before the event tints the sky)
  tickDayNight(); apply();
  const off = onDayNight(update);
  return { keyDir, moonDir, fixed, update, apply, dispose() { off(); seen = -1; } };
}
