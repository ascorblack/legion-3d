/**
 * Geometry lint — shared types (see src/world/lint/index.ts for the classes and their tolerances).
 */
import type { LintMark } from '../kit';
export type { LintMark };

/** The lint classes (one per bug family the operator reported; docs/TESTING.md «Geometry lint»). */
export type LintClass =
  | 'float'     // an object / a group of touching parts with nothing under or beside it (> 0.08 m above the ground)
  | 'loose'     // a thin plane (< 3 cm) touching nothing — a «float» of one flat piece
  | 'sunk'      // a prop part more than 0.25 m below the ground (foundations excepted)
  | 'overlap'   // solid parts of different objects inside each other (a crate in an anvil base)
  | 'door'      // two door openings within 1 m at one facade / a building door without one
  | 'stairs'    // steps under the bank, a flight that is not monotonic, steps off the walk surface, cheek walls off the flight
  | 'rails'     // rails / ramp planks off the ground (> 0.1 m) or buried in the terrain
  | 'onramp'    // a prop standing on a stair / ramp footprint
  | 'zfight'    // coplanar overlapping faces of different pieces (src/world/zfight.ts)
  | 'uv'        // texel density far from the material median / strongly anisotropic texture mapping
  | 'plane'     // one flat face larger than 16 m² (or a leaning slab > 6 m²) that is not ground / water
  | 'ledge'     // a box part crossing a round body mid-height (a square ledge through a round tower)
  | 'lamp'      // a lamp head not attached to its post / a bare emissive box with no frame
  | 'outline';  // the hover outline of a door is not the drawn door

export interface LintFinding {
  cls: LintClass;
  /** the town / scene ('fair', 'fairc', 'room:forge', …) */
  where: string;
  /** k.b.tag of the object (building id, 'prop:<kind>', 'terrain:stairs', 'inst:<kind>#i') */
  tag: string;
  /** material or instanced kind */
  kind: string;
  /** world position (m) */
  at: [number, number, number];
  /** human-readable */
  what: string;
  /** the measured value (gap, depth, ratio, area …) */
  v: number;
  /** Batch.role of the piece ('' = none) */
  role?: string;
}

/** One closed piece of geometry in world space (a Batch.add piece, a connected part of an instance / mesh). */
export interface LintPiece {
  i: number;
  /** object id (pieces of one object never overlap / float relative to each other) */
  obj: number;
  tag: string;
  /** material key */
  mat: string;
  /** instanced kind ('' for batch pieces) */
  kind: string;
  src: 'batch' | 'inst' | 'mesh';
  /** world-space triangle soup (non-indexed, xyz per vertex) */
  pos: Float32Array;
  /** final UVs (batch pieces) or null */
  uv: Float32Array | null;
  /** the piece kept its own UVs (no box projection) */
  keep: boolean;
  /** shading signature (z-fight detector) */
  look: string;
  /** Batch.role at add time ('smoke', 'hang', 'found', …) */
  role: string;
  /** AABB x0 y0 z0 x1 y1 z1 */
  b: Float64Array;
}

export interface LintSource {
  where: string;
  pieces: LintPiece[];
  /** world (x, z) → walk height (m); absent = no ground checks */
  groundAt?: (x: number, z: number) => number;
  marks?: readonly LintMark[];
  /** door hit boxes (World3DExt.interactables: id 'door:<id>' and a Box3-like hit) */
  doors?: readonly { id: string; hit: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }; outlineBox?: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } }[];
}

export interface LintOpts {
  /** classes to run (default: all) */
  only?: LintClass[];
  /** tags that are ground / terrain surfaces (support, never checked themselves) */
  groundTags?: RegExp;
  /** extra allow entries (beside src/world/lint/allow.ts) */
  allow?: readonly { cls: LintClass | '*'; match: RegExp; why: string }[];
  /** tolerances (m / ratios), see TOL in index.ts */
  tol?: Partial<Record<string, number>>;
}
