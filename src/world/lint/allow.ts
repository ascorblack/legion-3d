/**
 * Geometry lint allowlist: findings that are intentional. Every entry needs a reason (`why`): the test fails on an
 * entry without one. `match` is tested against `<where> <tag> <kind> <what>` of the finding (see lintKey()).
 * Keep it short — a real bug gets fixed, not listed here.
 */
import type { LintClass } from './types';

export interface AllowEntry { cls: LintClass | '*'; match: RegExp; why: string }

export const LINT_ALLOW: readonly AllowEntry[] = [
  // ---- sky / far dressing: hangs in the air on purpose
  { cls: 'float', match: /\b(sky|stars|moon|cloud|bird|bat|ghost|firefl|mote|kite|balloon|lantern-sky)/i, why: 'sky dressing floats by design' },
  { cls: 'float', match: /\bbackdrop\b/, why: 'far backdrop silhouettes stand on hidden ground outside the town' },
  { cls: 'float', match: /role:(smoke|hang|sky)\b/, why: 'pieces the builder marked as floating by design (k.b.role: chimney smoke, hanging decor)' },
  { cls: 'float', match: /\bprop:reeds\b/, why: 'reeds stand in the pond water (the water surface is not a support triangle: too large)' },
  // ---- foundations, roots and posts dug in
  { cls: 'sunk', match: /role:found\b/, why: 'pieces the builder marked as a foundation (k.b.role = \'found\')' },
  { cls: 'sunk', match: /\binst:fc:(pine|blossom|tree|apple)|\binst:(tree|bush|pine)/, why: 'tree trunks are planted: their root flare goes into the ground on slopes' },
  { cls: 'sunk', match: /\binst:(fence|fc:fence)|\bprop:fence/, why: 'fence posts are dug in (only the post, the rails stay above)' },
];
