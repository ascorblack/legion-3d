/**
 * Expedition arena layout (pure): where every cat and every foe stands, in arena metres. The enemy is at +x (single
 * front) or around the party (surrounded). Formation rules after battlecrowd.js: zones front → back = shields (0),
 * melee (1), archers/mages (2), priests (3); inside a zone shields first, then better armour (rank), then login.
 * Surrounded: the party in the centre, every wing faces its side, shields on the outer rows, priests inside.
 * `face` is the yaw of three.js `rotation.y` (0 looks to −Z, Walker.face convention): +x = −π/2.
 */
import type { Side } from '../quest/model';
import type { Member, FoeState } from './adapter';

export interface Spot { x: number; z: number; face: number }
export const FACE_PX = -Math.PI / 2, FACE_NX = Math.PI / 2, FACE_NZ = 0, FACE_PZ = Math.PI;
const WING_FACE: Record<Side, number> = { R: FACE_PX, L: FACE_NX, F: FACE_NZ };

const order = (list: readonly Member[], idx: number[]) => idx.sort((a, b) => list[a].zone - list[b].zone || +list[b].shield - +list[a].shield || list[b].rank - list[a].rank || (list[a].login < list[b].login ? -1 : 1));
const middleOut = (r: number) => (r % 2 ? 1 : -1) * Math.ceil(r / 2);

/** Party spots in battle. Deterministic; one array allocated per call (call on layout change only). */
export function partySpots(party: readonly Member[], fronts: readonly Side[], sp = 1.32): Spot[] {
  const out: Spot[] = new Array(party.length);
  if (!party.length) return out;
  if (fronts.length <= 1) {
    const idx = order(party, party.map((_, i) => i));
    const rows = Math.max(3, Math.min(10, Math.ceil(Math.sqrt(party.length * 0.8))));
    let col = 0, prevZone = -1, inZone = 0;
    for (const i of idx) {
      const z = party[i].zone;
      if (z !== prevZone) { if (prevZone >= 0) col += Math.ceil(inZone / rows) + 0.8; prevZone = z; inZone = 0; }
      const c = col + Math.floor(inZone / rows), r = inZone % rows;
      out[i] = { x: -c * sp, z: middleOut(r) * sp * 1.2 + (Math.floor(inZone / rows) % 2 ? sp * 0.45 : 0), face: FACE_PX };
      inZone++;
    }
    return out;
  }
  const hasF = fronts.includes('F');
  const wings = new Map<Side, number[]>();
  party.forEach((m, i) => { const w = fronts.includes(m.side) ? m.side : fronts[i % fronts.length]; let l = wings.get(w); if (!l) wings.set(w, l = []); l.push(i); });
  for (const [w, idx0] of wings) {
    const idx = order(party, idx0);
    const per = Math.max(3, Math.min(9, Math.ceil(Math.sqrt(idx.length * 1.6))));
    const D = Math.ceil(idx.length / per);
    idx.forEach((i, j) => {
      const d = Math.floor(j / per), lane = middleOut(j % per) * sp * 1.15;
      const r = 0.9 + (D - 1 - d) * sp;
      if (w === 'R') out[i] = { x: r, z: lane + (hasF ? sp : 0), face: WING_FACE.R };
      else if (w === 'L') out[i] = { x: -r, z: lane + (hasF ? sp : 0), face: WING_FACE.L };
      else out[i] = { x: lane, z: -r - (hasF ? 0.4 : 0), face: WING_FACE.F };
    });
  }
  return out;
}

/** Outer edge of the party per side (where the foes stop), from the spots. */
export function frontLine(spots: readonly Spot[]): { R: number; L: number; F: number } {
  let R = 0.5, L = -0.5, F = -0.5;
  for (const s of spots) { if (!s) continue; R = Math.max(R, s.x); L = Math.min(L, s.x); F = Math.min(F, s.z); }
  return { R, L, F };
}

/** Foe spots: per side three lanes in columns going away from the party; leaders a step back in the middle. */
/**
 * Foe spots beyond the front line, per side: the pack leader first (front centre), then staggered rows of three
 * facing the party. Spacing follows the foes' size (`size(art)` → [length along the facing, width]): rows at least
 * 1.3 × the body length apart and lanes 1.5 × the width, so long beasts (wolves) never melt into one mass.
 */
export function foeSpots(foes: readonly FoeState[], line: { R: number; L: number; F: number }, sp = 2.1, gap = 3.6,
  size: (art: FoeState['art']) => [number, number] = () => [1, 1]): Spot[] {
  const order = foes.map((_, i) => i).sort((a, b) => (foes[b].lead ? 1 : 0) - (foes[a].lead ? 1 : 0) || a - b);
  const n: Record<Side, number> = { L: 0, R: 0, F: 0 }, out: Spot[] = new Array(foes.length);
  const big: Record<Side, [number, number]> = { L: [1, 1], R: [1, 1], F: [1, 1] };
  const lead: Record<Side, boolean> = { L: false, R: false, F: false };
  for (const f of foes) { const [l, w] = size(f.art); big[f.side] = [Math.max(big[f.side][0], l), Math.max(big[f.side][1], w)]; if (f.lead) lead[f.side] = true; }
  for (const i of order) {
    const f = foes[i], [len, wid] = big[f.side];
    const lsp = Math.max(sp, wid * 1.5, len * 1.3), dsp = Math.max(sp * 0.9, len * 1.3);
    // the leader stands alone in front of its pack; the pack fills staggered rows of three behind it
    let d: number, lane: number;
    if (f.lead && lead[f.side]) { lead[f.side] = false; d = gap + len * 0.3; lane = 0; }
    else {
      const k = n[f.side]++, col = Math.floor(k / 3), front = foes.some((g) => g.lead && g.side === f.side) ? 1 : 0;
      lane = (middleOut(k % 3) + ((col + front) % 2 ? 0.5 : 0)) * lsp;
      d = gap + len * 0.3 + (col + front * 0.85) * dsp + (k % 3) * len * 0.4;   // echelon: lanes also step back, so a pitched camera never stacks them
    }
    if (f.side === 'L') out[i] = { x: line.L - d, z: lane, face: FACE_PX };
    else if (f.side === 'F') out[i] = { x: lane, z: line.F - d, face: FACE_PZ };
    else out[i] = { x: line.R + d, z: lane, face: FACE_NX };
  }
  return out;
}

/** Spots on a circle (camp / rest / loot): cats around a centre facing it. */
export function circleSpots(n: number, r0 = 2.2, cx = 0, cz = 0, sp = 1.45): Spot[] {
  const out: Spot[] = [];
  let ring = 0, placed = 0;
  while (placed < n) {
    const r = r0 + ring * sp * 1.05, cap = Math.max(5, Math.floor((2 * Math.PI * r) / sp));
    const k = Math.min(cap, n - placed);
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2 + ring * 0.37;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      out.push({ x, z, face: Math.atan2(x - cx, z - cz) });   // rotation.y that looks at the centre
    }
    placed += k; ring++;
  }
  return out;
}

/** Marching column along +x (travel): pairs/threes behind each other, the front at x = 0. */
export function columnSpots(n: number, sp = 1.3): Spot[] {
  const per = n > 24 ? 3 : 2, out: Spot[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / per), lane = (i % per) - (per - 1) / 2;
    out.push({ x: -row * sp * 1.1, z: lane * sp * 0.9 + (row % 2 ? 0.15 : -0.15), face: FACE_PX });
  }
  return out;
}

/** Half-extent of the action (party + foes) for the camera distance. */
export function extent(spots: readonly Spot[], cx: number, cz: number): number {
  let r = 2;
  for (const s of spots) if (s) r = Math.max(r, Math.hypot(s.x - cx, s.z - cz));
  return r;
}
