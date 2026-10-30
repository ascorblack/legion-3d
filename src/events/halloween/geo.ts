/** Halloween geometry (unit-sized, built once, shared by instancing): pumpkin, bat, ghost cat, hanging string. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const col = (g: THREE.BufferGeometry, r: number, gg: number, b: number, fn?: (x: number, y: number, z: number) => number) => {
  const p = g.getAttribute('position'), c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const k = fn ? fn(p.getX(i), p.getY(i), p.getZ(i)) : 1; c[i * 3] = r * k; c[i * 3 + 1] = gg * k; c[i * 3 + 2] = b * k; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
};
const strip = (g: THREE.BufferGeometry, keep: string[]) => {
  for (const n of Object.keys(g.attributes)) if (!keep.includes(n)) g.deleteAttribute(n);
  return g;
};

const _wn = new THREE.Vector3();
/**
 * A squat ribbed pumpkin of radius 1 (6 ribs, 0.7 high below the centre, flat dimpled base), a curved, tapering
 * five-sided stalk with ridges. Indexed, ≈ 270 triangles (lod 1, the far set: ≈ 85) (the base is a flat fan: it sits
 * on the ground or on another pumpkin; the old sphere's hidden bottom rows are gone).
 * Vertex colours: warm orange with darker rib valleys and a paler crest; stalk green-brown. UVs: the sphere's
 * (u = .25 → +Z, u = .75 → −Z) so the carved face map lands there; the stalk sits at uv (0,0), the black corner.
 */
export function pumpkinGeometry(lod: 0 | 1 = 0): THREE.BufferGeometry {
  const S = lod ? 12 : 18, pos: number[] = [], uv: number[] = [], colr: number[] = [], idx: number[] = [];
  // body profile: polar angle rows from the top dimple to the base ring (θ in [0, π]); the base is flattened
  const TH = lod ? [0.0, 0.95, 1.85, 2.7] : [0.0, 0.55, 1.15, 1.75, 2.3, 2.7];
  const prof = (th: number): [number, number] => {
    let y = Math.cos(th), h = Math.sin(th);
    if (th < 0.01) y = 0.78 - 0.12;                                 // top dimple centre (sunken)
    else y = y * 0.76 - (th < 0.6 ? 0.07 : 0);
    if (th > 2.5) { y = -0.7; h *= 1.05; }                          // flat base ring
    return [h, y];
  };
  const v0 = 0;
  for (let j = 0; j < TH.length; j++) {
    const [h, y] = prof(TH[j]);
    for (let i = 0; i <= S; i++) {
      const u = i / S, ph = u * Math.PI * 2;
      // 6 lobes with creased valleys: |sin 3φ|^0.4 is round on the lobe and pinched in the valley; the faces (φ = 90°, 270°)
      // sit on a lobe's crest
      const lobe = Math.pow(Math.abs(Math.sin(ph * 3)), 0.4), rib = lobe * 2 - 1;   // valleys ON the vertex columns (every 60°)
      const k = 1 + 0.2 * (lobe - 0.75) * Math.min(1, h * 1.3);
      const x = -Math.cos(ph) * h * k, z = Math.sin(ph) * h * k;
      pos.push(x, y, z); uv.push(u, 1 - TH[j] / Math.PI);
      const shade = 0.84 + 0.16 * rib * Math.min(1, h * 1.4) - 0.18 * Math.max(0, -y - 0.35) + 0.07 * Math.max(0, y - 0.4);
      const valley = Math.max(0, -rib) * Math.min(1, h * 1.4);      // valleys: deeper, a touch greener-brown
      colr.push(1.0 * shade * (1 - 0.3 * valley), (0.36 + 0.05 * rib - 0.08 * valley) * shade, (0.035 + 0.02 * valley) * shade);
    }
  }
  for (let j = 0; j + 1 < TH.length; j++) for (let i = 0; i < S; i++) {
    const a = v0 + j * (S + 1) + i, b = a + S + 1;
    if (j > 0) idx.push(a, b, a + 1);
    idx.push(a + 1, b, b + 1);
  }
  const base = pos.length / 3;                                       // base fan centre (slightly domed up: a dimple)
  pos.push(0, -0.66, 0); uv.push(0.5, 0); colr.push(0.55, 0.22, 0.04);
  const ring = (TH.length - 1) * (S + 1);
  for (let i = 0; i < S; i++) idx.push(base, ring + i + 1, ring + i);
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); body.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  body.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3)); body.setIndex(idx);
  body.computeVertexNormals();
  // the top pole column shares one position per u: average its normals to straight up (no pinched shading)
  { const n = body.getAttribute('normal') as THREE.BufferAttribute; for (let i = 0; i <= S; i++) n.setXYZ(i, 0, 1, 0);
    for (let j = 1; j < TH.length; j++) {   // weld the u = 0 / u = 1 seam
      const a = j * (S + 1), b = a + S;
      _wn.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
      n.setXYZ(a, _wn.x, _wn.y, _wn.z); n.setXYZ(b, _wn.x, _wn.y, _wn.z);
    } }
  // stalk: 5 sides × 3 rings, tapering and curling over, ridged (alternate dark / light sides), flat cut top
  const sp: number[] = [], sc: number[] = [], si: number[] = [], SN = 5, RINGS = lod ? [[0, 0.14], [0.4, 0.075]] : [[0, 0.14], [0.15, 0.1], [0.29, 0.085], [0.4, 0.075]];
  RINGS.forEach(([t, r], j) => {
    const bend = t * t * 2.0, cx = bend * 0.5, cy = 0.6 + t * (1 - t * 0.5);
    for (let i = 0; i < SN; i++) {
      const a = (i / SN) * Math.PI * 2 + j * 0.25, rr = r * (i % 2 ? 0.82 : 1);
      sp.push(cx + Math.cos(a) * rr, cy, Math.sin(a) * rr);
      const k = (0.62 + 0.38 * (j / (RINGS.length - 1))) * (i % 2 ? 0.8 : 1.05);
      sc.push(0.36 * k, 0.4 * k, 0.16 * k);
    }
  });
  for (let j = 0; j + 1 < RINGS.length; j++) for (let i = 0; i < SN; i++) {
    const a = j * SN + i, b = j * SN + (i + 1) % SN, c = a + SN, d = b + SN;
    si.push(a, c, b, b, c, d);
  }
  const top = sp.length / 3 - SN; for (let i = 1; i + 1 < SN; i++) si.push(top, top + i + 1, top + i);
  const stalk = new THREE.BufferGeometry();
  stalk.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); stalk.setAttribute('color', new THREE.Float32BufferAttribute(sc.map((v, i) => (Math.floor(i / 3) >= top ? v * 1.25 : v)), 3));
  stalk.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((sp.length / 3) * 2), 2)); stalk.setIndex(si); stalk.computeVertexNormals();
  const parts = [body, stalk].map((g) => strip(g, ['position', 'normal', 'uv', 'color']));
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

/**
 * A small bat, wing-span ≈ 0.6 m, flying along −Z. Flat double-sided wings (the flap is done in the vertex shader
 * from |x|), a tiny body with ears. All at y = 0.
 */
export function batGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  for (const s of [1, -1]) {
    const R = [s * 0.04, 0, 0.01], A = [s * 0.07, 0, -0.09], B = [s * 0.34, 0.02, -0.07], C = [s * 0.25, 0, 0.05], D = [s * 0.17, 0, 0.0], E = [s * 0.12, 0, 0.1], F = [s * 0.05, 0, 0.08];
    if (s > 0) { tri(R, A, B); tri(R, B, C); tri(R, C, D); tri(R, D, E); tri(R, E, F); }
    else { tri(R, B, A); tri(R, C, B); tri(R, D, C); tri(R, E, D); tri(R, F, E); }
  }
  const wings = new THREE.BufferGeometry(); wings.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const body = new THREE.SphereGeometry(0.055, 6, 4); body.scale(1, 0.9, 1.5); body.translate(0, 0.0, 0.03);
  const head = new THREE.SphereGeometry(0.04, 5, 3); head.translate(0, 0.012, -0.075);
  const ears = [-1, 1].map((s) => { const e = new THREE.ConeGeometry(0.018, 0.06, 3, 1, true); e.translate(s * 0.026, 0.07, -0.082); return e; });
  const wp = wings.getAttribute('position'), wc = new Float32Array(wp.count * 3);
  for (let i = 0; i < wp.count; i++) { const e = Math.min(1, Math.abs(wp.getX(i)) / 0.34); wc[i * 3] = 0.5 + 0.4 * e; wc[i * 3 + 1] = 0.3 + 0.22 * e; wc[i * 3 + 2] = 0.8 + 0.15 * e; }   // lilac, lighter at the tips
  wings.setAttribute('color', new THREE.BufferAttribute(wc, 3));
  col(body, 0.34, 0.22, 0.52); col(head, 0.38, 0.25, 0.58); for (const e of ears) col(e, 0.9, 0.55, 0.8);
  const parts = [wings, body, head, ...ears].map((g) => strip(g.index ? g.toNonIndexed() : g, ['position', 'color']));
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

/**
 * A ghost cat lantern ≈ 0.62 m tall: lathe body with a wavy hem, two pointed ears, big dark eyes, pink cheeks and a
 * nose, facing +Z. Vertex colours + normals (the material adds a soft rim / translucency), ≈ 400 triangles.
 */
export function ghostGeometry(): THREE.BufferGeometry {
  const prof: THREE.Vector2[] = [];
  const H = 0.62;
  for (let i = 0; i <= 6; i++) {             // dome: from the top pole down to the widest point
    const a = (i / 6) * (Math.PI / 2);
    prof.push(new THREE.Vector2(Math.max(0.001, Math.sin(a) * 0.27), H - 0.27 + Math.cos(a) * 0.27));
  }
  prof.push(new THREE.Vector2(0.27, 0.2), new THREE.Vector2(0.3, 0.0));
  prof.reverse();                            // lathe wants bottom → top for outward normals
  const body = new THREE.LatheGeometry(prof, 12);
  const p = body.getAttribute('position');
  for (let i = 0; i < p.count; i++) {        // wavy hem
    const y = p.getY(i);
    if (y < 0.12) { const th = Math.atan2(p.getZ(i), p.getX(i)); p.setY(i, y + (0.05 * (Math.cos(th * 4) * 0.5 + 0.5)) * (1 - y / 0.12)); }
  }
  body.computeVertexNormals();
  col(body, 0.93, 0.92, 1.0, (_x, y) => 0.8 + 0.2 * Math.min(1, y / H));
  const ear = (s: number) => { const e = new THREE.ConeGeometry(0.095, 0.22, 4, 1, true); e.rotateY(Math.PI / 4); e.rotateZ(-s * 0.3); e.translate(s * 0.16, H - 0.005, 0.0); return col(e, 0.97, 0.9, 1.0); };
  const earIn = (s: number) => { const e = new THREE.ConeGeometry(0.058, 0.15, 3, 1, true); e.rotateZ(-s * 0.3); e.translate(s * 0.16 + s * 0.004, H - 0.015, 0.05); return col(e, 1.0, 0.62, 0.8); };
  const eye = (s: number) => { const e = new THREE.SphereGeometry(0.036, 7, 4); e.scale(0.85, 1.25, 0.5); e.translate(s * 0.095, 0.4, 0.255); return col(e, 0.08, 0.05, 0.16, (_x, y) => (y > 0.425 ? 2.6 : 1)); };
  const cheek = (s: number) => { const e = new THREE.SphereGeometry(0.04, 6, 3); e.scale(1.2, 0.7, 0.4); e.translate(s * 0.17, 0.32, 0.225); return col(e, 1.0, 0.55, 0.7); };
  const nose = new THREE.SphereGeometry(0.018, 5, 3); nose.scale(1.2, 0.8, 0.6); nose.translate(0, 0.345, 0.27); col(nose, 1.0, 0.5, 0.65);
  const mouthL = new THREE.TorusGeometry(0.024, 0.006, 3, 6, Math.PI); mouthL.rotateZ(Math.PI); mouthL.translate(-0.026, 0.31, 0.262); col(mouthL, 0.1, 0.06, 0.18);
  const mouthR = mouthL.clone(); mouthR.translate(0.052, 0, 0);
  // whiskers: thin flat quads (2 triangles each) instead of boxes
  const whisker = (s: number, k: number) => { const e = new THREE.PlaneGeometry(0.15, 0.007); e.rotateZ(s * k * 0.18); e.translate(s * 0.265, 0.325 + k * 0.025, 0.2); e.rotateY(-s * 0.35); return col(e, 0.55, 0.5, 0.75); };
  const parts = [body, ear(-1), ear(1), earIn(-1), earIn(1), eye(-1), eye(1), cheek(-1), cheek(1), nose, mouthL, mouthR, whisker(-1, -1), whisker(-1, 1), whisker(1, -1), whisker(1, 1)].map((g) => strip(g.index ? g.toNonIndexed() : g, ['position', 'normal', 'color']));
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

/** Unit quad lying on the ground (y = 0), facing up. */
export const groundQuad = () => new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);

/** Unit quad in the XY plane facing +Z, origin at the bottom-left corner (cobweb: hangs from its top-left). */
export const cornerQuad = () => { const g = new THREE.PlaneGeometry(1, 1); g.translate(0.5, -0.5, 0); return g; };

/**
 * Bunting along the garland cables: small shapes hanging from the cable points — orange pumpkins, white ghosts and
 * purple / orange pennants, in turn. `cable` = flat x,y,z,x,y,z… segment list (LineSegments positions).
 * Even-numbered shapes come first, so a prefix of the draw range is an evenly spaced part (`userData.cum[k]` = vertex
 * count of the first k shapes). Attributes: position, color, aHang (0 at the cable, 1 at the tip: sways in the shader).
 * `strings` > 0 reserves that many thin cords at the START of the buffer (12 vertices each: two crossed ribbons, not
 * swaying), placed later with `setCord` — the lanterns' strings and wall brackets share the bunting's draw call;
 * `userData.cum` then counts them in (cum[0] = strings · 12).
 */
export function buntingGeometry(cable: ArrayLike<number>, step = 0.8, max = 260, strings = 0): THREE.BufferGeometry {
  const pts: { x: number; y: number; z: number; tx: number; tz: number }[] = [];
  let acc = 0, px = NaN, py = NaN, pz = NaN;
  for (let i = 0; i + 5 < cable.length; i += 6) {
    const ax = cable[i], ay = cable[i + 1], az = cable[i + 2], bx = cable[i + 3], by = cable[i + 4], bz = cable[i + 5];
    if (Math.hypot(ax - px, ay - py, az - pz) > 1e-3) acc = step * 0.5;               // a new span starts
    const len = Math.hypot(bx - ax, by - ay, bz - az) || 1;
    let d = step - acc;
    while (d <= len) { const t = d / len; pts.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t, z: az + (bz - az) * t, tx: (bx - ax) / len, tz: (bz - az) / len }); d += step; }
    acc = len - (d - step); px = bx; py = by; pz = bz;
  }
  const order = [...pts.keys()].filter((i) => i % 2 === 0).concat([...pts.keys()].filter((i) => i % 2 === 1)).slice(0, max);
  // shapes in (u along the cable, v down) metres, as triangle lists with a colour each
  type Tri = [number, number, number, number, number, number];
  const hexagon = (cx: number, cy: number, ru: number, rv: number): Tri[] => Array.from({ length: 6 }, (_, k) => { const a0 = (k / 6) * 6.2832, a1 = ((k + 1) / 6) * 6.2832; return [cx, cy, cx + Math.cos(a0) * ru, cy + Math.sin(a0) * rv, cx + Math.cos(a1) * ru, cy + Math.sin(a1) * rv] as Tri; });
  const SHAPES: { tris: Tri[]; col: number[] }[] = [
    { tris: hexagon(0, -0.17, 0.16, 0.14), col: [1, 0.5, 0.1] },                                                   // pumpkin
    { tris: [[-0.14, 0, 0.14, 0, 0, -0.4]], col: [0.6, 0.32, 0.95] },                                              // purple pennant
    { tris: [[-0.12, 0, 0.12, 0, 0, -0.14], [-0.12, 0, -0.12, -0.3, 0, -0.14], [0.12, 0, 0.12, -0.3, 0, -0.14], [-0.12, -0.3, -0.06, -0.23, 0, -0.14], [0.12, -0.3, 0.06, -0.23, 0, -0.14], [-0.06, -0.23, 0, -0.3, 0, -0.14], [0.06, -0.23, 0, -0.3, 0, -0.14]], col: [1, 0.96, 1] },   // ghost
    { tris: [[-0.14, 0, 0.14, 0, 0, -0.4]], col: [1, 0.5, 0.1] },                                                  // orange pennant
  ];
  const pos: number[] = [], colr: number[] = [], hang: number[] = [];
  for (let i = 0; i < strings * CORD_V; i++) { pos.push(0, 0, 0); colr.push(0.14, 0.1, 0.22); hang.push(0); }
  const cum: number[] = [pos.length / 3];
  for (const pi of order) {
    const p = pts[pi], sh = SHAPES[pi % SHAPES.length], k0 = 0.8;
    for (const t of sh.tris) for (let v = 0; v < 3; v++) {
      const u = t[v * 2], dv = t[v * 2 + 1];
      pos.push(p.x + p.tx * u, p.y + dv, p.z + p.tz * u);
      const k = k0 + 0.25 * Math.min(1, -dv / 0.3); colr.push(sh.col[0] * k, sh.col[1] * k, sh.col[2] * k);
      hang.push(Math.min(1, -dv / 0.3));
    }
    cum.push(pos.length / 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3)); g.setAttribute('aHang', new THREE.Float32BufferAttribute(hang, 1));
  g.userData.cum = cum; g.userData.cords = strings;
  g.computeBoundingSphere();
  return g;
}

/** Vertices per cord in `buntingGeometry(…, strings)`. */
export const CORD_V = 12;
const _ca = new THREE.Vector3(), _cb = new THREE.Vector3(), _cd = new THREE.Vector3(), _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();
/**
 * Place cord `i` from (ax, ay, az) to (bx, by, bz), `w` metres thick (two crossed ribbons); w = 0 collapses it.
 * Writes positions only (call `needsUpdate` once after a batch).
 */
export function setCord(g: THREE.BufferGeometry, i: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number): void {
  const a = g.getAttribute('position') as THREE.BufferAttribute, o = i * CORD_V;
  _ca.set(ax, ay, az); _cb.set(bx, by, bz); _cd.subVectors(_cb, _ca);
  const len = _cd.length();
  if (!(len > 1e-5) || !(w > 0)) { for (let k = 0; k < CORD_V; k++) a.setXYZ(o + k, ax, ay, az); return; }
  _cd.multiplyScalar(1 / len);
  _c1.set(0, 1, 0); if (Math.abs(_cd.y) > 0.9) _c1.set(1, 0, 0);
  _c1.cross(_cd).normalize(); _c2.crossVectors(_cd, _c1).normalize();
  let k = o;
  for (const s of [_c1, _c2]) {
    const hx = s.x * w * 0.5, hy = s.y * w * 0.5, hz = s.z * w * 0.5;
    a.setXYZ(k++, ax - hx, ay - hy, az - hz); a.setXYZ(k++, ax + hx, ay + hy, az + hz); a.setXYZ(k++, bx + hx, by + hy, bz + hz);
    a.setXYZ(k++, ax - hx, ay - hy, az - hz); a.setXYZ(k++, bx + hx, by + hy, bz + hz); a.setXYZ(k++, bx - hx, by - hy, bz - hz);
  }
}
