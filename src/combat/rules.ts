/**
 * Combat rules without three.js (unit-tested): which attack a character has, its timings and numbers, cooldowns and
 * the input gate (when LMB is an attack at all).
 */
import { weaponFamily } from '../avatar/viewmodel';

export type AttackKind = 'slash' | 'smash' | 'thrust' | 'bow' | 'orb' | 'summon' | 'holy' | 'slap';

export interface AttackSpec {
  /** Seconds between two attacks (≥ the view-model's own swing cooldown, so FP and the hit stay in sync). */
  cooldown: number;
  /** Seconds from the click to the moment the effect happens (the strike frame of the swing / the cast). */
  strikeAt: number;
  /** Melee: reach from the hero's feet (m) and half-angle of the cone (rad); hits up to `maxHits` cats. */
  reach: number; cone: number; maxHits: number;
  /** Knock-back speed (m/s) along the strike and upwards. */
  push: number; up: number;
  /** Hit-stop (s) and camera shake (rad) on a hit. */
  stop: number; shake: number;
  /** Swing trail window (s since the click; [0, 0] = no trail): from the end of the anticipation hold to the end of
   *  the follow-through of the TP/FP track (src/avatar/attacks.ts). */
  trail: readonly [number, number];
}

export const SPECS: Record<AttackKind, AttackSpec> = {
  slash: { cooldown: 0.57, strikeAt: 0.255, reach: 1.8, cone: 0.9, maxHits: 2, push: 4.6, up: 4.0, stop: 0.06, shake: 0.012, trail: [0.198, 0.37] },
  smash: { cooldown: 0.72, strikeAt: 0.29, reach: 1.8, cone: 0.75, maxHits: 3, push: 3.4, up: 4.4, stop: 0.07, shake: 0.024, trail: [0.21, 0.33] },
  thrust: { cooldown: 0.5, strikeAt: 0.245, reach: 2.1, cone: 0.5, maxHits: 1, push: 5.6, up: 3.4, stop: 0.05, shake: 0.01, trail: [0.2, 0.32] },
  slap: { cooldown: 0.45, strikeAt: 0.215, reach: 1.4, cone: 0.8, maxHits: 1, push: 3.4, up: 3.2, stop: 0.045, shake: 0.007, trail: [0.17, 0.29] },
  bow: { cooldown: 0.35, strikeAt: 0, reach: 0, cone: 0, maxHits: 1, push: 4.6, up: 3.0, stop: 0.04, shake: 0.006, trail: [0, 0] },
  orb: { cooldown: 0.8, strikeAt: 0.26, reach: 0, cone: 0, maxHits: 1, push: 4.4, up: 4.2, stop: 0.04, shake: 0.008, trail: [0, 0] },
  summon: { cooldown: 6, strikeAt: 0.3, reach: 0, cone: 0, maxHits: 0, push: 3.0, up: 3.6, stop: 0, shake: 0.006, trail: [0, 0] },
  holy: { cooldown: 2.5, strikeAt: 0.26, reach: 4.2, cone: Math.PI, maxHits: 6, push: 2.8, up: 3.4, stop: 0, shake: 0.006, trail: [0, 0] },
};

/** Bow: seconds to a full draw, minimum draw that still shoots, arrow speed range (m/s). */
export const BOW = { full: 0.75, min: 0.18, vMin: 13, vMax: 30 };

/** The attack of a character: by the weapon look first, the site role refines the magic ones. */
export function attackKind(weapon: string | undefined | null, role?: string | null): AttackKind {
  const fam = weaponFamily(weapon);
  if (weapon === 'censer') return 'holy';
  switch (fam) {
    case 'blade': return 'slash';
    case 'heavy': return 'smash';
    case 'spear': return 'thrust';
    case 'bow': return 'bow';
    case 'none': return 'slap';
    default: break;   // pole / book: magic
  }
  if (role === 'necromancer') return 'summon';
  if (role === 'priest') return 'holy';
  if (role === 'mage') return 'orb';
  return weapon === 'skullstaff' || weapon === 'grimoire' ? 'summon' : 'orb';
}
/** Holy flavour: a light puff on every hit (holymace / priests / paladins). */
export const isHoly = (weapon: string | undefined | null, role?: string | null) => weapon === 'holymace' || weapon === 'censer' || role === 'paladin' || role === 'priest';

/** Per-kind cooldowns on a caller-supplied clock (seconds). */
export class Cooldowns {
  private until = new Map<string, number>();
  ready(kind: AttackKind, now: number): boolean { return now >= (this.until.get(kind) ?? -Infinity); }
  /** Start the cooldown; false (and nothing changes) when not ready. */
  use(kind: AttackKind, now: number, scale = 1): boolean {
    if (!this.ready(kind, now)) return false;
    this.until.set(kind, now + SPECS[kind].cooldown * scale);
    return true;
  }
  /** Seconds left (0 = ready). */
  left(kind: AttackKind, now: number): number { return Math.max(0, (this.until.get(kind) ?? 0) - now); }
  reset() { this.until.clear(); }
}

/** Everything the input gate looks at. */
export interface GateInput {
  /** The setting «Драки с котиками». */
  enabled: boolean;
  /** Pointer locked (FP/TP gameplay); the first click only grabs the pointer. */
  locked: boolean;
  /** ctx.gameplay(): no menu, no blocking overlay, not the classic site. */
  gameplay: boolean;
  /** A menu or a DOM modal (input.modals) is open. */
  menu: boolean; modals: number;
  photo: boolean;
  typing: boolean;
  /** Scene mode (hybrid rooms: rooms.stage) or a room still loading. */
  stage: boolean; busy: boolean;
  /** Room kind (null on the street). */
  room: string | null;
  /** The crosshair is on an interactable. Ignored since clicks never interact (E / F only): LMB swings anyway. */
  aimed?: boolean;
}
/**
 * Rooms where attacks are allowed (the street is always allowed): the 3D shops (forge, «Лавка», magic, tent) and the
 * mine — pointer-locked rooms with a crosshair (goods / stones / doors are used with E only, LMB always swings).
 * Hybrid interiors are not: they run in scene mode (free cursor, the site's panel docked).
 */
export const COMBAT_ROOMS = new Set(['shop3d', 'mine3d']);

/** Why LMB is NOT an attack right now, or null when it is. */
export function gate(g: GateInput): string | null {
  if (!g.enabled) return 'off';
  if (g.typing) return 'typing';
  if (g.photo) return 'photo';
  if (g.menu || g.modals > 0) return 'menu';
  if (!g.locked) return 'unlocked';
  if (!g.gameplay) return 'paused';
  if (g.stage) return 'scene';
  if (g.busy) return 'loading';
  if (g.room && !COMBAT_ROOMS.has(g.room)) return 'room';
  return null;
}
