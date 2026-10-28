/**
 * «Ночь Тыквенной Луны», portal open: every cat in the City is drawn as a ghost (site: walker v.gh = 1, «понарошку» —
 * only the look). We use the avatars' own ghost appearance (Appearance.ghost → the translucent ghost variant) and, in
 * first person, translucent ghost paws (the view-model's materials are swapped, never edited).
 * Re-applied when the crowd replaces an appearance; at most `perFrame` rebuilds a frame (no hitch with a big crowd).
 */
import * as THREE from 'three';
import type { Appearance } from '../../contracts';

export interface GhostAvatar { setAppearance(app: Appearance): void }
/** The crowd's entry (src/features/crowd.ts `ctx.dev.avatars` values): the avatar, its last appearance and its key. */
export interface CrowdEntry { av: GhostAvatar; app: unknown; key: string }

export class GhostCrowd {
  /** avatar → crowd key it was ghosted at (the crowd re-applies a plain look when its key changes) */
  private done = new Map<GhostAvatar, string>();
  private meApp: Appearance | null = null;
  private vmSwapped = new Map<THREE.Mesh, THREE.Material>();
  private vmMats = new Map<THREE.Material, THREE.Material>();
  on = false;

  constructor(private perFrame = 3) {}

  /**
   * Bring the crowd (and me) to the wanted state. Returns how many avatars were rebuilt.
   * `me`: the own avatar with its current (plain) appearance; `vm`: the first-person view-model root.
   */
  sync(crowd: Iterable<CrowdEntry>, me: { av: GhostAvatar; app: Appearance } | null, vm: THREE.Object3D | null): number {
    let n = 0;
    const live = new Set<GhostAvatar>();
    for (const e of crowd) {
      live.add(e.av);
      const k = this.done.get(e.av);
      if (this.on) {
        if (k === e.key) continue;
        if (n >= this.perFrame) continue;
        e.av.setAppearance({ ...(e.app as Appearance), ghost: true }); this.done.set(e.av, e.key); n++;
      } else if (k !== undefined) {
        if (n >= this.perFrame) continue;
        e.av.setAppearance(e.app as Appearance); this.done.delete(e.av); n++;
      }
    }
    for (const av of this.done.keys()) if (!live.has(av)) this.done.delete(av);   // left the street (disposed by the crowd)
    if (me) {
      if (this.on && this.meApp !== me.app) { me.av.setAppearance({ ...me.app, ghost: true }); this.meApp = me.app; n++; }
      else if (!this.on && this.meApp) { me.av.setAppearance(me.app); this.meApp = null; n++; }
    }
    if (vm) this.syncVm(vm);
    return n;
  }

  /** Avatars currently shown as ghosts by us (tests / debug). */
  get count(): number { return this.done.size + (this.meApp ? 1 : 0); }
  get pending(): boolean { return false; }

  private ghostOf(m: THREE.Material): THREE.Material {
    let g = this.vmMats.get(m);
    if (!g) {
      g = m.clone();
      const t = g as THREE.MeshToonMaterial;
      if (t.color && (t as THREE.MeshToonMaterial).isMeshToonMaterial) { t.color.set('#bcd8ff'); t.emissive?.set('#3a5a8a'); }
      else if ((t as unknown as THREE.MeshBasicMaterial).color) (t as unknown as THREE.MeshBasicMaterial).color.set('#5b7fb8');
      g.transparent = true; g.opacity = (t as THREE.MeshToonMaterial).isMeshToonMaterial ? 0.55 : 0.4;
      this.vmMats.set(m, g);
    }
    return g;
  }

  private syncVm(root: THREE.Object3D): void {
    if (this.on) {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !o.name.startsWith('vm-') || this.vmSwapped.has(m)) return;
        const orig = m.material as THREE.Material;
        this.vmSwapped.set(m, orig); m.material = this.ghostOf(orig);
      });
      for (const m of this.vmSwapped.keys()) if (!m.parent) this.vmSwapped.delete(m);   // rebuilt view-model
    } else if (this.vmSwapped.size) {
      for (const [m, orig] of this.vmSwapped) m.material = orig;
      this.vmSwapped.clear();
    }
  }

  /** Is every listed avatar in the wanted state? */
  settled(crowd: Iterable<CrowdEntry>): boolean {
    for (const e of crowd) { const k = this.done.get(e.av); if (this.on ? k !== e.key : k !== undefined) return false; }
    return true;
  }

  /** Restore everything now (feature dispose). */
  dispose(crowd: Iterable<CrowdEntry>, me: { av: GhostAvatar; app: Appearance } | null, vm: THREE.Object3D | null): void {
    this.on = false; this.perFrame = 1e9;
    this.sync(crowd, me, vm);
    for (const g of this.vmMats.values()) g.dispose();
    this.vmMats.clear(); this.done.clear();
  }
}
