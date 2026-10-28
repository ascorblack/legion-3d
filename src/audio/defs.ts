/**
 * The sound list: which recordings an id plays, on which bus, how loud (dB trim relative to the normalised file),
 * how much it varies per hit, cooldown and positional falloff. Levels were set by measurement (dev/sound.html →
 * «Прогулка 30 с»), see docs/ASSETS.md for the sources.
 */
export type Bus = 'amb' | 'sfx' | 'ui' | 'voice';

export interface SfxDef {
  /** Bank keys (variants) or a procedural buffer name ('@pop'). */
  files: string[];
  bus: Bus;
  /** Level trim (dB). */
  db: number;
  /** Random gain / playback-rate variation per hit (±fraction). */
  gainVar?: number;
  rateVar?: number;
  /** Base playback rate (pitch). */
  rate?: number;
  /** Minimum seconds between two plays of this id (per id; per-source limits live in the callers). */
  cooldown?: number;
  /** Positional: reference distance (full level) and the distance beyond which it is not played at all (m). */
  ref?: number;
  maxDist?: number;
  /** Optional low-pass (Hz) — distance / softness. */
  lp?: number;
}

const v = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}_${i}`);

export const SFX = {
  // footsteps (own: centred; others: positional and quieter via the caller's gain)
  'step.cobble': { files: v('step_cobble', 6), bus: 'sfx', db: -12, gainVar: 0.06, rateVar: 0.05, cooldown: 0.12, ref: 1.5, maxDist: 14 },
  'step.wood': { files: v('step_wood', 5), bus: 'sfx', db: -15, gainVar: 0.06, rateVar: 0.05, cooldown: 0.12, ref: 1.5, maxDist: 12, lp: 3800 },
  'step.soft': { files: v('step_soft', 6), bus: 'sfx', db: -11, gainVar: 0.06, rateVar: 0.05, cooldown: 0.12, ref: 1.5, maxDist: 12 },
  'step.dirt': { files: v('step_dirt', 6), bus: 'sfx', db: -13, gainVar: 0.06, rateVar: 0.05, cooldown: 0.12, ref: 1.5, maxDist: 14 },
  'jump': { files: v('cloth', 4), bus: 'sfx', db: -16, gainVar: 0.06, rateVar: 0.06, rate: 1.1, cooldown: 0.25 },
  'land': { files: v('land', 3), bus: 'sfx', db: -12, gainVar: 0.05, rateVar: 0.05, cooldown: 0.2, lp: 2500 },
  // rooms and things
  'door.open': { files: v('door_open', 2), bus: 'sfx', db: -12, gainVar: 0.04, rateVar: 0.03, cooldown: 0.4, lp: 5000 },
  'door.close': { files: v('door_close', 3), bus: 'sfx', db: -14, gainVar: 0.04, rateVar: 0.03, cooldown: 0.4, lp: 3500 },
  'tent.flap': { files: v('cloth', 4), bus: 'sfx', db: -12, gainVar: 0.05, rateVar: 0.04, rate: 0.85, cooldown: 0.4 },
  'shop.buy': { files: v('coins', 2), bus: 'ui', db: -10, gainVar: 0.04, rateVar: 0.03, cooldown: 0.5 },
  'mine.hit': { files: v('pick', 5), bus: 'sfx', db: -9, gainVar: 0.06, rateVar: 0.05, cooldown: 0.2, ref: 2, maxDist: 18, lp: 5000 },
  'mine.break': { files: v('rock_break', 3), bus: 'sfx', db: -8, gainVar: 0.05, rateVar: 0.04, cooldown: 0.3, ref: 2.5, maxDist: 22 },
  // the mine signal (src/rooms/mine/afk.ts): own stone finished — soft chimes on the ui bus, sent with { bg: true } so a
  // hidden tab can wake for them («Сигнал шахты в фоне»). Existing recordings only: a double chime for ore / rock,
  // the shimmer for a rare vein or a gem, coins for a petrified chest, a low falling chime when the daily cap is reached
  'mine.done': { files: ['chime_0'], bus: 'ui', db: -16, gainVar: 0.03, rateVar: 0.01, rate: 1.05, cooldown: 0.1 },
  'mine.rare': { files: v('shimmer', 2), bus: 'ui', db: -13, gainVar: 0.03, rateVar: 0.02, rate: 1.05, cooldown: 0.5 },
  'mine.chest': { files: v('coins', 2), bus: 'ui', db: -12, gainVar: 0.03, rateVar: 0.02, rate: 0.95, cooldown: 0.5 },
  'mine.cap': { files: ['chime_0'], bus: 'ui', db: -18, gainVar: 0.02, rateVar: 0.01, rate: 0.7, cooldown: 5, lp: 3000 },
  // interface
  'ui.tick': { files: v('tick', 3), bus: 'ui', db: -27, gainVar: 0.05, rateVar: 0.05, rate: 1.25, cooldown: 0.14, lp: 3000 },
  'ui.open': { files: v('paper', 3), bus: 'ui', db: -12, gainVar: 0.05, rateVar: 0.04, cooldown: 0.15, lp: 4500 },
  'ui.close': { files: v('cloth', 4), bus: 'ui', db: -17, gainVar: 0.05, rateVar: 0.04, rate: 1.15, cooldown: 0.15, lp: 4500 },
  'bubble': { files: ['@pop'], bus: 'voice', db: -15, gainVar: 0.06, rateVar: 0.06, cooldown: 0.12, ref: 2, maxDist: 14 },
  // ambient one-shots
  'amb.creak': { files: v('creak', 3), bus: 'amb', db: -10, gainVar: 0.08, rateVar: 0.06, cooldown: 8, ref: 3, maxDist: 30, lp: 3000 },
  // «Драки с котиками» (src/combat): soft and comic, never violent; positional, quieter than the hits of the mine
  'combat.swing': { files: v('whoosh', 3), bus: 'sfx', db: -15, gainVar: 0.08, rateVar: 0.06, cooldown: 0.1, ref: 2, maxDist: 14 },
  'combat.hit': { files: ['bonk_0'],   // the owner picked variant 1 of the cartoon bonk
    bus: 'sfx', db: -11, gainVar: 0.06, rateVar: 0.06, cooldown: 0.06, ref: 2.5, maxDist: 20, lp: 4500 },
  'combat.bow.draw': { files: ['creak_2'], bus: 'sfx', db: -20, gainVar: 0.05, rateVar: 0.05, rate: 1.35, cooldown: 0.2, ref: 2, maxDist: 10, lp: 3500 },
  'combat.bow.release': { files: v('twang', 2), bus: 'sfx', db: -13, gainVar: 0.05, rateVar: 0.05, rate: 0.8, cooldown: 0.08, ref: 2, maxDist: 14, lp: 4000 },
  'combat.arrow.hit': { files: v('land', 3), bus: 'sfx', db: -11, gainVar: 0.05, rateVar: 0.06, rate: 1.2, cooldown: 0.06, ref: 2.5, maxDist: 22, lp: 4000 },
  'combat.arrow.stick': { files: v('thunk', 3), bus: 'sfx', db: -13, gainVar: 0.06, rateVar: 0.05, cooldown: 0.05, ref: 2.5, maxDist: 24, lp: 5000 },
  'combat.cast': { files: v('shimmer', 2), bus: 'sfx', db: -15, gainVar: 0.05, rateVar: 0.04, cooldown: 0.2, ref: 2, maxDist: 18 },
  'combat.summon': { files: v('groan', 2), bus: 'sfx', db: -14, gainVar: 0.06, rateVar: 0.06, cooldown: 0.5, ref: 2.5, maxDist: 18, lp: 3000 },
  'combat.poof': { files: v('poof', 2), bus: 'sfx', db: -14, gainVar: 0.06, rateVar: 0.06, cooldown: 0.08, ref: 2.5, maxDist: 18 },
  'combat.holy': { files: ['chime_0'], bus: 'sfx', db: -14, gainVar: 0.04, rateVar: 0.04, cooldown: 0.4, ref: 3, maxDist: 22 },
  // «Забавы» (src/features/bench, cheer, cheers-fx): existing recordings only
  'social.sit': { files: v('cloth', 4), bus: 'sfx', db: -17, gainVar: 0.05, rateVar: 0.05, rate: 0.85, cooldown: 0.4, ref: 1.5, maxDist: 10, lp: 3500 },
  'social.cheer': { files: v('tick', 3), bus: 'sfx', db: -19, gainVar: 0.06, rateVar: 0.06, rate: 0.7, cooldown: 1.5, ref: 2.5, maxDist: 16, lp: 3200 },
  'social.chime': { files: ['chime_0'], bus: 'ui', db: -17, gainVar: 0.03, rateVar: 0.02, rate: 1.12, cooldown: 2 },
  // flight, the emote wheel, «!идея бум» (src/features/flight, emotes, boom): boom_0 / fuse_0 are synthesised
  // (gen-combat-sfx.mjs), the rest reuse the bank
  'fly.up': { files: v('whoosh', 3), bus: 'sfx', db: -16, gainVar: 0.05, rateVar: 0.05, rate: 0.72, cooldown: 0.4, lp: 3500 },
  'emote.pop': { files: ['@pop'], bus: 'voice', db: -13, gainVar: 0.05, rateVar: 0.05, rate: 1.1, cooldown: 0.3 },
  'emote.dance': { files: v('shimmer', 2), bus: 'sfx', db: -17, gainVar: 0.05, rateVar: 0.04, rate: 1.15, cooldown: 0.5 },
  'emote.laugh': { files: ['meow_0'], bus: 'voice', db: -13, gainVar: 0.05, rateVar: 0.04, rate: 1.3, cooldown: 0.5, lp: 4000 },
  'emote.purr': { files: ['meow_1'], bus: 'voice', db: -12, gainVar: 0.05, rateVar: 0.03, rate: 0.95, cooldown: 0.5, lp: 3500 },
  'emote.sad': { files: ['meow_0'], bus: 'voice', db: -14, gainVar: 0.05, rateVar: 0.03, rate: 0.78, cooldown: 0.5, lp: 3000 },
  'emote.huff': { files: v('poof', 2), bus: 'sfx', db: -14, gainVar: 0.05, rateVar: 0.05, rate: 1.35, cooldown: 0.3 },
  'fun.fuse': { files: ['fuse_0'], bus: 'sfx', db: -16, gainVar: 0.03, rateVar: 0.02, cooldown: 1 },
  'fun.boom': { files: ['boom_0'], bus: 'sfx', db: -7, gainVar: 0.03, rateVar: 0.03, cooldown: 2, lp: 5000 },
  'amb.meow': { files: v('meow', 2), bus: 'amb', db: -10, gainVar: 0.08, rateVar: 0.04, cooldown: 40, ref: 3, maxDist: 40, lp: 2600 },
} satisfies Record<string, SfxDef>;

export type SfxId = keyof typeof SFX;
export const sfxDef = (id: string): SfxDef | undefined => (SFX as Record<string, SfxDef>)[id];

/** Bed levels (linear, inside their groups) — the measured mix. */
export const BED = { crickets: 0.3, wind: 0.32, crowd: 0.5, roomtone: 0.05, fire: 0.5, cave: 1.4 };
/** Make-up gain (dB) after the master slider: puts the default 40 % at ≈ −26 LUFS, 100 % at ≈ −15 LUFS. */
export const MAKEUP_DB = 8;
/** Bus trims (linear) applied under the user's sliders. */
export const BUS_TRIM: Record<Bus, number> = { amb: 1, sfx: 1, ui: 0.9, voice: 1 };
