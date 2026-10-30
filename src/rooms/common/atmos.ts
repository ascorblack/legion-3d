/**
 * Interior atmosphere, ONE draw call (shafts and motes share a mesh and a shader):
 *  - light shafts: soft additive volumes from the windows (cool moonlight slanting down onto the floor), drawn as the four
 *    sides of a prism with a shader that fades along the beam and towards its silhouette edges (no hard quad borders);
 *  - dust motes: slow drifting specks over the floor plan, warm in the room, brighter and cooler inside the shafts
 *    (the classic «dust in the beam»). Positions live in a box; the drift is in the vertex shader (no CPU per frame
 *    besides one uniform).
 * Quality: q0 — nothing; q1 — shafts + 70 motes; q2+ — shafts + 200 motes. prefers-reduced-motion → still motes.
 */
import * as THREE from 'three';

export interface Shaft {
  /** window centre, size, the unit direction the light travels in (into the room, downwards), colour, strength */
  cx: number; cy: number; cz: number; w: number; h: number;
  /** axis along the window's width (unit, horizontal) */
  ax: number; az: number;
  dx: number; dy: number; dz: number;
  color: string; k: number;
}

export interface Atmos { group: THREE.Group; update(t: number): void; dispose(): void }

const rand = (s: { v: number }) => ((s.v = (s.v * 16807) % 2147483647) / 2147483647);

export function buildAtmos(o: {
  quality: number; box: { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }; shafts: Shaft[];
  /** discs where motes may not spawn (tent: outside the circle) */ circle?: { x: number; z: number; r: number } | null;
  /** mote colour (room light) */ warm?: string; motes?: number; size?: number; seed?: number;
  /** extra glints hovering in the beams of these points (lamps): x, y, z, r */ pools?: number[];
}): Atmos | null {
  const q = o.quality;
  if (q <= 0) return null;
  const group = new THREE.Group(); group.name = 'room:atmos';
  const owned: { dispose(): void }[] = [];
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const uTime = { value: 0 };
  // ONE mesh, one draw call (round-2 CPU fix: the shafts and the motes were two transparent draws): the shafts' prism
  // sides and the motes as camera-facing quads share a geometry; aKind (0 shaft, 1 mote) picks the path in the shader
  const pos: number[] = [], uvA: number[] = [], col: number[] = [], nor: number[] = [], kind: number[] = [], ph: number[] = [], br: number[] = [], idx: number[] = [];
  const vert = (x: number, y: number, z: number, u: number, v: number, c: THREE.Color, n: [number, number, number], k: number, p = 0, b = 0) => {
    pos.push(x, y, z); uvA.push(u, v); col.push(c.r, c.g, c.b); nor.push(n[0], n[1], n[2]); kind.push(k); ph.push(p); br.push(b);
    return pos.length / 3 - 1;
  };

  /* ------------------------------------------------ shafts */
  {
    const c = new THREE.Color(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();
    for (const s of o.shafts) {
      c.set(s.color).multiplyScalar(s.k);
      // window rect corners (u across the width, v up)
      const corner = (u: number, v: number): [number, number, number] => [s.cx + s.ax * u * s.w / 2, s.cy + v * s.h / 2, s.cz + s.az * u * s.w / 2];
      // the beam runs until it meets the floor (y = 0.02): length from the lowest edge, the top edge travels as far
      const L = Math.min(9, (s.cy + s.h / 2) / Math.max(0.15, -s.dy));
      const quads: [number, number, number, number][] = [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]];
      for (const [u0, v0, u1, v1] of quads) {
        const P: [number, number, number][] = [], U: [number, number][] = [];
        for (const [u, v] of [[u0, v0], [u1, v1]] as const) {
          const p = corner(u, v);
          // near end (at the window, pulled a touch into the room) and far end (on the floor)
          const lNear = 0.04, lFar = Math.min(L, Math.max(0.3, (p[1] - 0.02) / Math.max(0.15, -s.dy)));
          P.push([p[0] + s.dx * lNear, p[1] + s.dy * lNear, p[2] + s.dz * lNear]); U.push([0, u === u0 && v === v0 ? 0 : 1]);
          P.push([p[0] + s.dx * lFar, p[1] + s.dy * lFar, p[2] + s.dz * lFar]); U.push([1, u === u0 && v === v0 ? 0 : 1]);
        }
        // flat normal of the side (the shader fades the sides seen edge-on)
        _a.set(P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]); _b.set(P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]);
        _n.crossVectors(_a, _b).normalize();
        const n: [number, number, number] = [_n.x, _n.y, _n.z];
        const b = P.map((p, i) => vert(p[0], p[1], p[2], U[i][0], U[i][1], c, n, 0));
        idx.push(b[0], b[1], b[3], b[0], b[3], b[2]);
      }
    }
  }

  /* ------------------------------------------------ motes */
  const N = q >= 2 ? (o.motes ?? 110) : Math.round((o.motes ?? 110) * 0.4);
  if (N > 0) {
    const B = o.box, s = { v: o.seed ?? 4711 };
    const warm = new THREE.Color(o.warm || '#ffd9a0'), tmp = new THREE.Color();
    const inShaft = Math.min(N * 0.45, o.shafts.length * 40);
    for (let i = 0; i < N; i++) {
      let x = 0, y = 0, z = 0, bright = 0.5, cc = warm;
      if (i < inShaft && o.shafts.length) {
        const sh = o.shafts[i % o.shafts.length];
        const L = (sh.cy) / Math.max(0.15, -sh.dy) * (0.1 + rand(s) * 0.75);
        const u = (rand(s) - 0.5) * sh.w * 0.9, v = (rand(s) - 0.5) * sh.h * 0.9;
        x = sh.cx + sh.ax * u + sh.dx * L; y = sh.cy + v + sh.dy * L; z = sh.cz + sh.az * u + sh.dz * L;
        bright = 0.8 + rand(s) * 0.4; cc = tmp.set(sh.color).lerp(warm, 0.35);
      } else {
        for (let k = 0; k < 6; k++) {
          x = B.x0 + rand(s) * (B.x1 - B.x0); z = B.z0 + rand(s) * (B.z1 - B.z0);
          if (!o.circle || Math.hypot(x - o.circle.x, z - o.circle.z) < o.circle.r) break;
        }
        y = B.y0 + Math.pow(rand(s), 0.8) * (B.y1 - B.y0); bright = 0.18 + rand(s) * 0.22;
      }
      const p0 = rand(s) * 6.283;
      // a quad round the mote's centre: uv = the corner (−1 … 1), expanded in view space by the shader
      const b = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => vert(x, y, z, u, v, cc, [0, 1, 0], 1, p0, bright));
      idx.push(b[0], b[1], b[2], b[0], b[2], b[3]);
    }
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  g.setAttribute('aPh', new THREE.Float32BufferAttribute(ph, 1));
  g.setAttribute('aBr', new THREE.Float32BufferAttribute(br, 1));
  g.setIndex(idx); g.computeBoundingSphere();
  const B = o.box;
  // the motes drift: keep the whole box (+ drift) in the bounds
  g.boundingSphere = g.boundingSphere!.union(new THREE.Sphere(new THREE.Vector3((B.x0 + B.x1) / 2, (B.y0 + B.y1) / 2, (B.z0 + B.z1) / 2), Math.hypot(B.x1 - B.x0, B.y1 - B.y0, B.z1 - B.z0) / 2 + 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime, uAmp: { value: reduced ? 0 : 1 }, uSize: { value: o.size ?? 0.026 } },
    vertexShader: /* glsl */`
      uniform float uTime; uniform float uAmp; uniform float uSize;
      attribute vec3 color; attribute float aKind; attribute float aPh; attribute float aBr;
      varying vec3 vC; varying vec2 vUv; varying float vF; varying float vKind;
      void main() {
        vC = color; vUv = uv; vKind = aKind;
        if (aKind < 0.5) {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vec3 n = normalize(normalMatrix * normal);
          // sides seen edge-on fade out: the prism reads as a soft volume, never as four flat panes
          vF = pow(abs(dot(n, normalize(-mv.xyz))), 1.6) * smoothstep(1.0, 3.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        } else {
          vec3 p = position; float t = uTime * uAmp;
          p.x += sin(t * 0.21 + aPh) * 0.25 + sin(t * 0.07 + aPh * 2.0) * 0.4;
          p.y += sin(t * 0.17 + aPh * 1.7) * 0.18 - 0.06 * sin(t * 0.05 + aPh);
          p.z += cos(t * 0.19 + aPh * 1.3) * 0.25;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          vF = aBr * smoothstep(0.35, 1.4, d) * (1.0 - smoothstep(9.0, 15.0, d)) * (0.6 + 0.4 * sin(uTime * 1.3 + aPh * 4.0));
          // a speck uSize m across (the old point sprite's size on a ~400 px-high drawing buffer), in world units
          mv.xy += uv * uSize * 1.05;
          gl_Position = projectionMatrix * mv;
        }
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; varying vec3 vC; varying vec2 vUv; varying float vF; varying float vKind;
      void main() {
        if (vKind < 0.5) {
          float along = vUv.x;
          float a = smoothstep(0.0, 0.12, along) * (1.0 - smoothstep(0.3, 0.8, along));
          float across = sin(vUv.y * 3.14159);
          a *= across * across * vF;
          a *= 0.85 + 0.15 * sin(uTime * 0.6 + vUv.y * 5.0 + along * 3.0);
          gl_FragColor = vec4(vC * a * 0.16, 1.0);
        } else {
          float r = dot(vUv, vUv);
          float a = (1.0 - r); a = a * a * vF;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vC * a, a);
        }
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
  const mesh = new THREE.Mesh(g, m); mesh.name = 'room:atmos'; mesh.renderOrder = 3; mesh.raycast = () => { /* not a target */ };
  group.add(mesh); owned.push(g, m);
  return {
    group,
    update(t: number) { uTime.value = t; },
    dispose() { for (const x of owned) x.dispose(); group.removeFromParent(); },
  };
}
