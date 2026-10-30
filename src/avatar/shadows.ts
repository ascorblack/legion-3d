/**
 * Contact shadows of the characters: a soft dark disc under every avatar's feet, ONE instanced quad per scene (one draw
 * call for the whole crowd), multiplicative (it darkens whatever paving is under it, never tints it).
 *
 * Avatars stamp their spot from Avatar.update() (`stamp`), so a character that is not updated (culled, removed, in
 * another room) drops out on its own; the batch compacts the fresh stamps right before it is drawn.
 */
import * as THREE from 'three';

const CAP = 160;
/** A stamp older than this (ms) is not drawn: the avatar was not updated (culled / hidden / gone). */
const STALE_MS = 150;

let quad: THREE.PlaneGeometry | null = null;
let mat: THREE.MeshBasicMaterial | null = null;
function material(): THREE.MeshBasicMaterial {
  if (mat) return mat;
  // out = dst · (1 − src.rgb): src.rgb = darkness (instanceColor carries the per-avatar strength)
  mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, fog: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcColorFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
  mat.dithering = false;
  mat.name = 'avatar-contact-shadow';
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vQ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvQ = position.xz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vQ;')
      .replace('#include <opaque_fragment>', `
        float d = length( vQ );
        float k = 0.78 * pow( 1.0 - smoothstep( 0.32, 1.0, d ), 1.2 ) + 0.2 * ( 1.0 - smoothstep( 0.0, 0.45, d ) );
        if ( d >= 1.0 || k < 0.004 ) discard; // nothing of the quad outside the disc, whatever the later chunks do
        gl_FragColor = vec4( min( vec3( 0.9 ), diffuseColor.rgb * k * 1.7 ), 1.0 );`)
      .replace('#include <colorspace_fragment>', '').replace('#include <premultiplied_alpha_fragment>', '').replace('#include <dithering_fragment>', '');
  };
  mat.customProgramCacheKey = () => 'avatar-contact-shadow';
  return mat;
}

class Batch {
  readonly mesh: THREE.InstancedMesh;
  private x = new Float32Array(CAP); private y = new Float32Array(CAP); private z = new Float32Array(CAP);
  private r = new Float32Array(CAP); private a = new Float32Array(CAP); private t = new Float64Array(CAP);
  private used = new Uint8Array(CAP);
  private m = new THREE.Matrix4();
  users = 0;
  constructor(readonly scene: THREE.Object3D) {
    quad ||= new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(quad, material(), CAP);
    mesh.name = 'avatar:shadows'; mesh.frustumCulled = false; mesh.count = 0; mesh.renderOrder = -1;
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.setColorAt(0, new THREE.Color(0, 0, 0));
    mesh.onBeforeRender = () => this.compact();
    this.mesh = mesh;
    scene.add(mesh);
  }
  acquire(): number {
    for (let i = 0; i < CAP; i++) if (!this.used[i]) { this.used[i] = 1; this.t[i] = 0; this.users++; return i; }
    return -1;
  }
  release(i: number): void { if (i >= 0 && this.used[i]) { this.used[i] = 0; this.t[i] = 0; this.users--; } }
  set(i: number, x: number, y: number, z: number, r: number, a: number): void {
    this.x[i] = x; this.y[i] = y; this.z[i] = z; this.r[i] = r; this.a[i] = a; this.t[i] = performance.now();
  }
  private compact(): void {
    const now = performance.now(), mesh = this.mesh, col = mesh.instanceColor!.array as Float32Array;
    let n = 0;
    for (let i = 0; i < CAP; i++) {
      if (!this.used[i] || now - this.t[i] > STALE_MS || this.a[i] <= 0.01) continue;
      const r = this.r[i];
      this.m.makeScale(r, 1, r).setPosition(this.x[i], this.y[i], this.z[i]);
      mesh.setMatrixAt(n, this.m);
      col[n * 3] = col[n * 3 + 1] = col[n * 3 + 2] = this.a[i];
      n++;
    }
    mesh.count = n;
    if (n) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor!.needsUpdate = true; }
  }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.dispose(); }
}

const batches = new Map<THREE.Object3D, Batch>();
const _v = new THREE.Vector3();

/** One avatar's handle on the contact-shadow batch of whatever scene it stands in. */
export class ContactShadow {
  private batch: Batch | null = null;
  private slot = -1;
  /** Stamp this frame's shadow: `root` = the avatar root (feet at its origin), r = disc radius (m), a = strength 0…1. */
  stamp(root: THREE.Object3D, r: number, a: number): void {
    let s: THREE.Object3D = root;
    while (s.parent) s = s.parent;
    if (s === root || !root.visible) return;
    if (!this.batch || this.batch.scene !== s) {
      this.release();
      let b = batches.get(s);
      if (!b) { b = new Batch(s); batches.set(s, b); }
      this.slot = b.acquire();
      if (this.slot < 0) return;
      this.batch = b;
    }
    _v.copy(root.position);
    if (root.parent) _v.applyMatrix4(root.parent.matrixWorld);
    this.batch.set(this.slot, _v.x, _v.y + 0.014, _v.z, r, a);
  }
  release(): void {
    const b = this.batch;
    if (!b) return;
    b.release(this.slot); this.batch = null; this.slot = -1;
    if (b.users <= 0) { b.dispose(); batches.delete(b.scene); }
  }
}

/** Test / debug: the live batches (scene → mesh). */
export function shadowBatches(): THREE.InstancedMesh[] { return [...batches.values()].map((b) => b.mesh); }
