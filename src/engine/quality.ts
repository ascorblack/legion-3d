/**
 * Adaptive quality: fixed levels 0–3 plus an 'auto' governor that holds frame time with
 * dynamic resolution scaling and steps the level when scaling saturates.
 * Pure logic (no WebGL) — engine.ts applies the result to the renderer.
 */
import type { QualityLevel } from '../contracts';

export type QualitySetting = QualityLevel | 'auto';

export interface LevelPreset {
  /** Cap for the device pixel ratio at this level (the effective ratio is min(dpr, cap) × scale). */
  pixelRatioCap: number;
  /** Real-time shadow maps. */
  shadows: boolean;
  /** Lowest dynamic resolution scale the auto governor may use at this level. */
  minScale: number;
  /** Lowest scale when the level is fixed by the user (resolution still adapts, the level never changes). */
  fixedMinScale: number;
  /** Shadow map size ceiling (engine clamps every shadow-casting light to it). */
  shadowMapSize: number;
  /** Post-processing (bloom + grade + vignette, see post.ts). */
  post: boolean;
  /** Screen-space ambient occlusion strength in the post chain (0 = off; GTAO on the frame's depth, post.ts). */
  ao: number;
}

/**
 * Pixel cost dominates on integrated GPUs (MeshStandard + normal maps + point lights per pixel), so the caps are
 * conservative: "medium" (2) renders at most 1.25× CSS px — a 1536×864 laptop at DPR 1.5 draws 1920×1080, not 2304×1296
 * (−31% pixels). Dynamic resolution takes it lower when the frame budget is missed.
 */
export const PRESETS: Record<QualityLevel, LevelPreset> = {
  0: { pixelRatioCap: 0.75, shadows: false, minScale: 0.5, fixedMinScale: 0.6, shadowMapSize: 512, post: false, ao: 0 },
  1: { pixelRatioCap: 1.0, shadows: false, minScale: 0.5, fixedMinScale: 0.65, shadowMapSize: 512, post: false, ao: 0 },
  2: { pixelRatioCap: 1.25, shadows: false, minScale: 0.55, fixedMinScale: 0.7, shadowMapSize: 1024, post: true, ao: 0 },
  3: { pixelRatioCap: 2.0, shadows: true, minScale: 0.6, fixedMinScale: 0.75, shadowMapSize: 2048, post: true, ao: 0.85 },
};

export const LS_QUALITY = 'l3d.quality';

export function loadSetting(fallback: QualitySetting): QualitySetting {
  try {
    const v = localStorage.getItem(LS_QUALITY);
    if (v === 'auto') return 'auto';
    if (v === '0' || v === '1' || v === '2' || v === '3') return +v as QualityLevel;
  } catch { /* storage blocked */ }
  return fallback;
}

export function saveSetting(q: QualitySetting): void {
  try { localStorage.setItem(LS_QUALITY, String(q)); } catch { /* storage blocked */ }
}

/** Initial guess for 'auto' from coarse hardware hints (no GPU probing here; engine refines with the GL renderer string). */
export function guessLevel(): QualityLevel {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency || 4;
  const mem = nav.deviceMemory || 4;
  if (cores >= 8 && mem >= 8) return 3;
  if (cores >= 4 && mem >= 4) return 2;
  return 1;
}

/** Map a WebGL UNMASKED_RENDERER string to a level ceiling (software rasterisers → potato). */
export function levelCapForGpu(gpu: string): QualityLevel {
  const g = gpu.toLowerCase();
  if (/swiftshader|llvmpipe|softpipe|software|microsoft basic/.test(g)) return 0;
  // old / weak discrete GPUs and open drivers for them (Kepler/Fermi GK/GF chips, GT x10–x30, nouveau/NVK, old Radeon HD)
  if (/\bnvk\b|nouveau|\bg[kf]\d{3}|geforce gt \d|geforce \d{3}m?\b|radeon hd|radeon r[57]\b|mesa dri intel|intel\(r\) hd graphics( [2-5]\d{2,3})?\b|mali-[gt][0-7]\d\b|adreno [1-5]\d\d/.test(g)) return 1;
  if (/intel|mali|adreno|powervr|apple gpu/.test(g) && !/arc/.test(g)) return 2;
  return 3;
}

/**
 * Auto governor. Feed it every frame interval (ms); every ~1 s it decides.
 * Budget: holds ~60 fps (frame interval ≤ 19 ms ⇒ fine). Hysteresis: scale goes down fast (one bad window),
 * up slowly (two good windows in a row); the level steps down when the scale is at its floor and still slow,
 * and up only after a long streak of good windows at full scale (with a cool-down after any step down).
 */
export class AutoGovernor {
  level: QualityLevel;
  scale = 1;
  /** Highest level auto may climb to (GPU ceiling). */
  maxLevel: QualityLevel;
  private acc = 0;
  private n = 0;
  private winStart = 0;
  private good = 0;
  private coolUntil = 0;
  /** Time of the last scale/level step down: no step up for SCALE_UP_HOLD s after it (avoids down/up ping-pong). */
  private downAt = -1e9;
  private upAt = -1e9;
  scaleUpHold = 8;
  /** Fixed level (user choice): only the resolution scale adapts, with PRESETS[level].fixedMinScale as the floor. */
  locked = false;
  /** Thresholds in ms (exposed for tests/tuning). */
  slowMs = 19.5;
  fastMs = 17.6;
  windowS = 1.0;

  constructor(level: QualityLevel, maxLevel: QualityLevel = 3) {
    this.level = level;
    this.maxLevel = maxLevel;
  }

  reset(now: number): void { this.acc = 0; this.n = 0; this.winStart = now; }

  /**
   * @param frameMs frame interval in ms (spikes > 100 ms are ignored: tab switches, GC pauses, shader compiles)
   * @param now seconds
   * @returns 'scale' | 'level' when something changed, else null
   */
  sample(frameMs: number, now: number): 'scale' | 'level' | null {
    // Slow frames ARE the signal (a weak GPU renders at 3–10 fps): keep them, clamped, and only drop the
    // one-off stalls longer than a second (tab switch, shader compile, GC).
    if (frameMs > 0 && frameMs < 1000) { this.acc += Math.min(frameMs, 250); this.n++; }
    if (now - this.winStart < this.windowS) return null;
    const n = this.n;
    const avg = n ? this.acc / n : 0;
    this.reset(now);
    // too few frames for a verdict — unless they are few because they are slow
    if (n < 10 && !(n >= 2 && avg > this.slowMs * 2)) return null;
    const minScale = this.locked ? PRESETS[this.level].fixedMinScale : PRESETS[this.level].minScale;
    if (avg > this.slowMs * 2.5) {
      // far over budget: no gentle steps — drop a level at once (auto), else go straight to the resolution floor
      this.good = 0;
      if (this.level > 0 && !this.locked) {
        this.level = (this.level - 1) as QualityLevel;
        this.scale = Math.max(PRESETS[this.level].minScale, Math.min(0.85, this.scale));
        this.coolUntil = now + 30;
        return 'level';
      }
      if (this.scale > minScale + 1e-3) { this.scale = minScale; return 'scale'; }
      return null;
    }
    if (avg > this.slowMs) {
      this.good = 0;
      if (this.scale > minScale + 1e-3) {
        // proportional step: aim at the budget assuming cost ∝ pixels ∝ scale²
        const want = this.scale * Math.sqrt(this.fastMs / avg);
        this.scale = Math.max(minScale, Math.min(this.scale - 0.05, Math.round(want * 20) / 20));
        // a step up that failed within 10 s: wait twice as long before probing again (8 → 16 → … 120 s)
        if (now - this.upAt < 10) this.scaleUpHold = Math.min(120, this.scaleUpHold * 2);
        this.downAt = now;
        return 'scale';
      }
      if (this.level > 0 && !this.locked) {
        this.level = (this.level - 1) as QualityLevel;
        this.scale = 0.85;
        this.coolUntil = now + 30;
        return 'level';
      }
      return null;
    }
    if (avg < this.fastMs) {
      this.good++;
      if (this.scale < 1 && this.good >= 2 && now - this.downAt >= this.scaleUpHold) {
        this.scale = Math.min(1, this.scale + 0.05);
        this.good = 0;
        this.upAt = now;
        return 'scale';
      }
      if (!this.locked && this.scale >= 1 && this.good >= 6 && this.level < this.maxLevel && now > this.coolUntil) {
        this.level = (this.level + 1) as QualityLevel;
        this.scale = 0.85;
        this.good = 0;
        return 'level';
      }
    } else {
      this.good = 0;
    }
    return null;
  }
}
