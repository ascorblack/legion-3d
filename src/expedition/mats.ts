/**
 * Expedition materials. Owned by one ExpeditionScene (created in its constructor, disposed with it), except the shared
 * avatar outline material (src/avatar/materials outlineMat — cached for all avatars, never disposed here).
 */
import * as THREE from 'three';
import { toonMat, outlineMat } from '../avatar/materials';

/** Shared GLSL: periodic (in x, period P = 48 m) value noise — the terrain scrolls, the pattern must wrap seamlessly. */
const NOISE = /* glsl */`
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p, float nx) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = h21(vec2(mod(i.x, nx), i.y)), b = h21(vec2(mod(i.x + 1.0, nx), i.y));
  float c = h21(vec2(mod(i.x, nx), i.y + 1.0)), d = h21(vec2(mod(i.x + 1.0, nx), i.y + 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// scale s = cells per metre (48 * s must be an integer)
float pn(vec2 l, float s) { return vn(l * s, 48.0 * s); }
`;

/**
 * Cel material with vertex colours. On top of the plain toon look: a soft ground-contact darkening (object-space height,
 * every model stands at y = 0) and a rim light that lifts silhouettes off the background (`rim` colour, per biome).
 */
function makeTint(rim: { value: THREE.Color }): THREE.MeshToonMaterial {
  const base = toonMat('n');
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: base.gradientMap });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = rim;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTint;\nvarying float vOY;')
      .replace('#include <color_vertex>', `
        #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
          vColor = vec4( 1.0 );
        #endif
        #ifdef USE_COLOR
          vColor.rgb *= color.rgb;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, aTint );
        #endif
        vOY = position.y;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;\nvarying float vOY;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n  float gMx = max(max(diffuseColor.r, diffuseColor.g), max(diffuseColor.b, 1e-4)); vec3 gEx = diffuseColor.rgb / gMx * clamp(gMx - 1.0, 0.0, 3.0); diffuseColor.rgb /= max(gMx, 1.0);\n  diffuseColor.rgb *= mix(0.74, 1.0, smoothstep(0.0, 0.55, vOY));')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += gEx * 1.1;   // glow parts: vertex colours above 1 (runes, crystals) are emissive
        float rimF = pow( 1.0 - clamp( dot( normalize( normal ), normalize( vViewPosition ) ), 0.0, 1.0 ), 2.4 );
        totalEmissiveRadiance += uRim * rimF;`);
  };
  m.customProgramCacheKey = () => 'exp-tint3';
  m.name = 'exp-tint';
  return m;
}

/**
 * Ground: vertex colour (palette, path, bank) × procedural detail in the fragment shader — patches, grain, blades, pebbles,
 * ripples, tiles — by `uMode` (0 grass, 1 tiles, 2 sand, 3 snow, 4 rock, 5 mud). Local-space, periodic: scrolls with the terrain.
 */
function makeGround(time: { value: number }): { mat: THREE.MeshToonMaterial; u: { uArena: { value: number }; uCloudSh: { value: number }; uSpk: { value: THREE.Color }; uSpkAmt: { value: number }; uMode: { value: number }; uTA: { value: THREE.Color }; uTB: { value: THREE.Color }; uDetail: { value: number } } } {
  const base = toonMat('n');
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: base.gradientMap });
  const u = { uArena: { value: 0 }, uCloudSh: { value: 0 }, uSpk: { value: new THREE.Color(1, 1, 1) }, uSpkAmt: { value: 0 }, uMode: { value: 0 }, uTA: { value: new THREE.Color(1, 1, 1) }, uTB: { value: new THREE.Color(1, 1, 1) }, uDetail: { value: 1 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, { uTime: time });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aMask;\nvarying float vMask;\nvarying vec2 vLoc;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vMask = aMask; vLoc = position.xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uMode; uniform vec3 uTA; uniform vec3 uTB; uniform float uDetail; uniform float uTime; uniform vec3 uSpk; uniform float uSpkAmt; uniform float uCloudSh; uniform float uArena;
        varying float vMask; varying vec2 vLoc;
        ${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 gc = diffuseColor.rgb;
        vec2 L = vLoc;
        float pa = pn(L, 0.125), pb = pn(L + 17.0, 0.5), pg = pn(L, 2.0), pf = pn(L, 6.0);
        float blob = smoothstep(0.54, 0.6, pn(L + 31.0, 0.375)), blob2 = smoothstep(0.6, 0.66, pn(L + 7.0, 0.75));
        float path = smoothstep(0.38, 0.52, vMask + (pb - 0.5) * 0.55);
        float edge = smoothstep(0.08, 0.4, vMask) * (1.0 - smoothstep(0.4, 0.75, vMask));
        float D = uDetail;
        vec2 dc = floor(L * 5.0); float dh = h21(vec2(mod(dc.x, 240.0), dc.y)); vec2 df = fract(L * 5.0) - 0.5;
        float dd = smoothstep(0.24, 0.1, length(df + (vec2(h21(dc + 1.7), h21(dc + 5.3)) - 0.5) * 0.3));
        gc *= 1.0 - uCloudSh * smoothstep(0.5, 0.66, pn(L + vec2(uTime * 0.7, 3.0), 0.125));
        gc *= mix(uTA, uTB, pa) * (1.0 + D * (pn(L + 40.0, 0.0625) - 0.5) * 0.3);
        gc *= 1.0 + D * ((pb - 0.5) * 0.5 + (pg - 0.5) * 0.3 + blob * 0.2 - blob2 * 0.16);
        if (uMode < 0.5) {
                    gc = mix(gc, uSpk, step(0.88, dh) * dd * uSpkAmt * (1.0 - path));
          gc = mix(gc, gc * 1.3 + 0.03, step(0.8, pf) * path * 0.85);
          gc *= 1.0 - 0.24 * edge * D;
          gc *= 1.0 - 0.12 * path * smoothstep(0.45, 0.6, pb);
        } else if (uMode < 1.5) {
          vec2 tcell = L / 1.5; vec2 tf = abs(fract(tcell) - 0.5);
          float fw = max(fwidth(tcell.x), fwidth(tcell.y));              // cells per pixel: lines are anti-aliased and fade out when sub-pixel (no shimmer / moire)
          float ln = (1.0 - smoothstep(0.0, 0.03 + fw * 1.2, 0.5 - max(tf.x, tf.y))) * (1.0 - smoothstep(0.12, 0.4, fw));
          float tv = h21(vec2(mod(floor(tcell.x), 32.0), floor(tcell.y)));
          gc *= (0.88 + 0.22 * tv) * (1.0 - 0.4 * ln);
          float cr = abs(pn(L + 5.0, 0.75) - 0.5); gc *= 1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.03 + fwidth(cr) * 1.5, cr)) * (1.0 - smoothstep(0.1, 0.35, fw));
          gc = mix(gc, uSpk, step(0.93, dh) * dd * uSpkAmt * 0.6);
        } else if (uMode < 2.5) {
          float rip = sin(L.x * 1.3 + pb * 7.0 + L.y * 0.35) * 0.5 + 0.5;
          float dune = smoothstep(0.35, 0.65, sin(L.x * 0.22 + L.y * 0.12 + pa * 9.0) * 0.5 + 0.5);
          gc *= 1.0 + D * ((rip - 0.5) * 0.3 + (dune - 0.5) * 0.26);
          // wind-ripple crests: thin lit ridges with a dark lee side (aliasing-safe: they fade when sub-pixel)
          float ph = (L.y * 1.9 + L.x * 0.55 + (pb - 0.5) * 5.0 + (pg - 0.5) * 1.6) * 3.14159 * 1.4;
          float rs = fract(ph / 6.28318); float fwr = fwidth(ph / 6.28318);
          float crest = smoothstep(0.0, 0.1 + fwr, rs) * (1.0 - smoothstep(0.1 + fwr, 0.34 + fwr, rs));
          float lee = smoothstep(0.34, 0.5, rs) * (1.0 - smoothstep(0.5, 0.8, rs));
          float rk = (1.0 - smoothstep(0.1, 0.5, fwr)) * smoothstep(0.25, 0.5, pa + (pb - 0.5) * 0.5);
          gc *= 1.0 + D * rk * (crest * 0.3 - lee * 0.26);
          gc = mix(gc, uSpk, step(0.9, dh) * dd * uSpkAmt);
          gc = mix(gc, gc * vec3(1.04, 0.97, 0.88), path * 0.4);
          gc *= 1.0 - 0.18 * edge;
        } else if (uMode < 3.5) {
          gc *= 1.0 - 0.14 * path * (1.0 - step(0.8, pf)) - 0.14 * edge;
          gc = mix(gc, vec3(0.7, 0.78, 0.92), step(0.9, dh) * dd * 0.25);
        } else if (uMode < 4.5) {
          float cr = abs(pn(L + 5.0, 0.75) - 0.5); float crack = 1.0 - smoothstep(0.0, 0.04, cr);
          gc *= 1.0 - 0.4 * crack * D;
          gc = mix(gc, uSpk, step(0.86, dh) * dd * uSpkAmt);
          gc *= 1.0 - 0.14 * edge;
        } else {
          gc = mix(gc, gc * 0.55, smoothstep(0.62, 0.7, pn(L + 9.0, 0.375)) * 0.7);
          gc = mix(gc, uSpk, step(0.92, dh) * dd * uSpkAmt);
          gc *= 1.0 - 0.18 * edge;
        }
        // fine grain (sub-pixel → fades out): keeps the ground crisp up close
        float gr = pn(L, 4.0) * 0.55 + pn(L + 3.0, 8.0) * 0.45; float fwg = fwidth(L.x * 8.0);
        gc *= 1.0 + D * (gr - 0.5) * 0.55 * (1.0 - smoothstep(0.4, 1.2, fwg));
        float ar = length(vec2(L.x, L.y * 1.15));
        float arK = (uMode > 1.5 && uMode < 2.5) ? 0.2 : 0.36;   // sand: the arena floor is darker and redder than its surroundings, so pale cats stand out
        gc *= mix(1.0, 0.74 + arK * (1.0 - smoothstep(4.0, 12.5, ar)), uArena);
        if (uMode > 1.5 && uMode < 2.5) gc *= mix(vec3(1.0), vec3(0.98, 0.9, 0.86), uArena * (1.0 - smoothstep(3.0, 11.0, ar)));
        diffuseColor.rgb = gc;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uMode > 2.5 && uMode < 3.5) { float sp = step(0.986, h21(floor(vLoc * 14.0) + 3.0)); totalEmissiveRadiance += vec3(0.5, 0.6, 0.75) * sp * (0.5 + 0.5 * sin(uTime * 2.0 + h21(floor(vLoc * 14.0)) * 40.0)); }`);
  };
  m.customProgramCacheKey = () => 'exp-ground';
  m.name = 'exp-ground';
  return { mat: m, u };
}

const DECAL_VERT = /* glsl */`
attribute vec4 iCol;   // rgb, alpha
attribute vec2 iP;     // soft (0 = ring … 1 = filled disc), pulse speed
uniform float uTime;
varying vec2 vUv; varying vec4 vCol; varying vec2 vP;
void main() {
  vUv = uv; vCol = iCol; vP = iP;
  float pulse = iP.y > 0.0 ? 0.75 + 0.25 * sin(uTime * iP.y) : 1.0;
  vCol.a *= pulse;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const DECAL_FRAG = /* glsl */`
varying vec2 vUv; varying vec4 vCol; varying vec2 vP;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float ring = smoothstep(1.0, 0.86, r) * smoothstep(0.55, 0.82, r);
  float fill = smoothstep(1.0, 0.0, r) * 0.65;
  float a = mix(ring, max(ring * 0.9, fill), vP.x) * vCol.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol.rgb * a, a * 0.6);
}`;

const BAR_VERT = /* glsl */`
attribute vec4 iBar;   // hp 0..1, width (m), height (m), kind (0 foe red, 1 boss, 2 ally green)
varying vec2 vUv; varying vec4 vBar;
void main() {
  vUv = uv; vBar = iBar;
  vec4 c = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
  c.xy += vec2((uv.x - 0.5) * iBar.y, (uv.y - 0.5) * iBar.z);
  gl_Position = projectionMatrix * c;
}`;
const BAR_FRAG = /* glsl */`
varying vec2 vUv; varying vec4 vBar;
void main() {
  vec2 px = vec2(vBar.y, vBar.z) * 120.0;
  float bx = 2.0 / px.x, by = 2.0 / px.y;
  bool border = vUv.x < bx || vUv.x > 1.0 - bx || vUv.y < by || vUv.y > 1.0 - by;
  vec3 col;
  if (border) col = vec3(0.09, 0.06, 0.13);
  else if (vUv.x < vBar.x) {
    col = vBar.w > 1.5 ? vec3(0.36, 0.86, 0.42) : vBar.w > 0.5 ? vec3(0.78, 0.22, 0.86) : vec3(0.93, 0.28, 0.33);
    col = mix(col, vec3(1.0), smoothstep(0.55, 1.0, vUv.y) * 0.35);
  } else col = vec3(0.16, 0.12, 0.22);
  gl_FragColor = vec4(col, 0.95);
}`;

const SKY_VERT = /* glsl */`
varying vec3 vW;
void main() { vW = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAG = /* glsl */`
uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uLow; uniform float uStars; uniform float uTime;
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uSun; uniform float uCloud; uniform vec3 uCloudCol; uniform float uMoon;
varying vec3 vW;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vW);
  float y = d.y;
  vec3 c = y > 0.1 ? mix(uMid, uTop, smoothstep(0.1, 0.75, y)) : mix(uLow, uMid, smoothstep(-0.12, 0.1, y));
  float sd = max(dot(d, uSunDir), 0.0);
  c += uSunCol * (pow(sd, 5.0) * 0.20 + pow(sd, 40.0) * 0.35) * uSun;
  if (uCloud > 0.0 && y > 0.0) {
    vec2 p = d.xz / (y + 0.28) * 1.7 + vec2(uTime * 0.012, uTime * 0.004);
    float n = fbm(p);
    float th = 1.0 - uCloud;
    float body = smoothstep(th, th + 0.05, n) * smoothstep(0.0, 0.22, y);
    float lit = smoothstep(th + 0.07, th + 0.16, fbm(p + vec2(0.06, 0.1) * 1.0 + 0.02));
    vec3 cc = mix(uCloudCol * vec3(0.78, 0.8, 0.9), uCloudCol, lit);
    cc += uSunCol * pow(sd, 8.0) * 0.25 * uSun;
    c = mix(c, cc, body * 0.92);
  }
  if (uSun > 0.0) c = mix(c, uSunCol * 1.6, smoothstep(0.9988, 0.9994, sd) * uSun);
  if (uMoon > 0.0) { float md = dot(d, uSunDir); c = mix(c, vec3(0.96, 0.95, 0.85), smoothstep(0.9986, 0.9991, md) * uMoon); c += vec3(0.5, 0.55, 0.8) * pow(max(md, 0.0), 30.0) * 0.18 * uMoon; }
  if (uStars > 0.0 && y > 0.05) {
    vec2 g = vec2(atan(d.z, d.x) * 60.0, y * 60.0);
    vec2 id = floor(g), f = fract(g) - 0.5;
    float s = h(id);
    float tw = 0.6 + 0.4 * sin(uTime * (1.0 + s * 3.0) + s * 20.0);
    c += vec3(1.0, 0.95, 0.85) * step(0.955, s) * smoothstep(0.32, 0.0, length(f)) * uStars * tw * 2.2 * smoothstep(0.05, 0.3, y);
  }
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const WATER_VERT = /* glsl */`
#include <fog_pars_vertex>
varying vec3 vWp; varying vec2 vLoc; varying vec2 vUv2;
void main() {
  vUv2 = uv;
  vec4 lp = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    lp = instanceMatrix * lp;
  #endif
  vec4 wp = modelMatrix * lp;
  vWp = wp.xyz; vLoc = lp.xz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const WATER_FRAG = /* glsl */`
uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uSky; uniform vec3 uSunCol; uniform vec3 uSunDir;
uniform float uTime; uniform float uOpacity; uniform float uFoam; uniform float uFlow; uniform float uScum;
varying vec3 vWp; varying vec2 vLoc; varying vec2 vUv2;
#include <fog_pars_fragment>
${NOISE}
void main() {
  vec2 l = vLoc;
  float t = uTime;
  // two scrolling ripple layers → perturbed normal
  vec2 q1 = l + vec2(t * uFlow, t * 0.15), q2 = l * 1.0 + vec2(-t * uFlow * 0.6, -t * 0.22);
  float e = 0.35;
  float a0 = pn(q1, 1.5), a1 = pn(q1 + vec2(e, 0.0), 1.5), a2 = pn(q1 + vec2(0.0, e), 1.5);
  float b0 = pn(q2, 3.0), b1 = pn(q2 + vec2(e * 0.5, 0.0), 3.0), b2 = pn(q2 + vec2(0.0, e * 0.5), 3.0);
  vec3 n = normalize(vec3(((a1 - a0) + (b1 - b0) * 0.6) * 2.4, 1.0, ((a2 - a0) + (b2 - b0) * 0.6) * 2.4));
  vec3 V = normalize(cameraPosition - vWp);
  float fr = pow(1.0 - clamp(dot(V, n), 0.0, 1.0), 3.0);
  float depthN = pn(l + 3.0, 0.25);
  vec3 body = mix(uShallow, uDeep, clamp(depthN * 0.9 + (1.0 - abs(vUv2.y * 2.0 - 1.0)) * 0.35, 0.0, 1.0));
  vec3 c = mix(body, uSky, clamp(fr * 0.6 + 0.04, 0.0, 0.62));
  vec3 R = reflect(-uSunDir, n);
  float spec = pow(max(dot(R, V), 0.0), 90.0);
  c += uSunCol * spec * 1.6;
  // glints
  float gl = step(0.93, pn(q2 * 2.0 + 7.0, 3.0)) * (0.5 + 0.5 * sin(t * 3.0 + l.x * 4.0));
  c += uSunCol * gl * 0.25;
  float r1 = pn(q1 * 1.5 + 4.0, 1.5), r2 = pn(q2 * 1.2 + 9.0, 3.0);
  float lines = smoothstep(0.04, 0.0, abs(r1 - 0.5)) + smoothstep(0.035, 0.0, abs(r2 - 0.55));
  // foam at the banks (uv.y across the river) + drifting streaks
#ifdef RADIAL
  vec2 uc = vUv2 * 2.0 - 1.0;
  float rr = length(uc);
  float bank = smoothstep(0.74, 0.97, rr);
  float imp = smoothstep(0.42, 0.0, length(vUv2 - vec2(0.5, 0.81)));   // where the sheet lands
  float fm = max(bank * smoothstep(0.3, 0.6, pn(q1 * 2.0, 3.0)), imp * smoothstep(0.25, 0.55, pn(q2 * 2.5 + 3.0, 3.0))) * uFoam;
#else
  float bank = smoothstep(0.78, 0.98, abs(vUv2.y * 2.0 - 1.0));
  float fm = bank * smoothstep(0.35, 0.65, pn(q1 * 2.0, 3.0)) * uFoam;
#endif
  c = mix(c, vec3(0.92, 0.98, 1.0), clamp(lines, 0.0, 1.0) * 0.5 * (1.0 - fm));
  c = mix(c, vec3(0.95, 0.98, 1.0), fm * 0.85);
  // swamp scum / duckweed
  float sc = smoothstep(0.52, 0.62, pn(l + 11.0, 0.5)) * uScum;
  c = mix(c, vec3(0.30, 0.46, 0.18) * (0.8 + 0.4 * pn(l, 3.0)), sc * 0.8);
  float al = uOpacity;
#ifdef RADIAL
  al *= 1.0 - smoothstep(0.9, 1.0, rr) * 0.9;   // the pool melts into its bank, no hard polygon edge
  c = mix(c, c * vec3(0.75, 0.9, 0.95), smoothstep(0.5, 0.9, rr) * 0.0);
#endif
  gl_FragColor = vec4(c, al);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const FALL_FRAG = /* glsl */`
uniform float uTime;
varying vec2 vUv2;
#include <fog_pars_fragment>
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float x = vUv2.x, y = vUv2.y;
  // vertical streaks (tall, thin noise cells scrolling down) in three scales: dark water channels and bright foamy ribbons
  float s1 = vn(vec2(x * 9.0, y * 1.6 + uTime * 2.2)), s2 = vn(vec2(x * 21.0 + 5.0, y * 2.4 + uTime * 3.0)), s3 = vn(vec2(x * 40.0 + 9.0, y * 4.0 + uTime * 4.2));
  float streak = s1 * 0.45 + s2 * 0.35 + s3 * 0.2;
  float ribbon = smoothstep(0.6, 0.78, streak);
  float side = min(x, 1.0 - x);
  float edge = smoothstep(0.0, 0.035, side);
  float top = smoothstep(1.0, 0.95, y);
  vec3 deep = vec3(0.08, 0.30, 0.62), mid = vec3(0.18, 0.50, 0.84), foam = vec3(0.9, 0.97, 1.0);
  vec3 c = mix(deep, mid, smoothstep(0.25, 0.6, streak));
  c = mix(c, foam, ribbon * 0.85);
  c = mix(c, deep * 0.8, smoothstep(0.22, 0.0, side) * 0.55 * (1.0 - ribbon));   // wet dark rim of the sheet, so it reads against the pale rock
  c = mix(c, foam, smoothstep(0.26, 0.0, y) * (0.4 + 0.35 * s2));                  // spray at the foot
  c = mix(c, foam, smoothstep(0.92, 1.0, y) * 0.7);                                   // lip: water gathering over the edge
  float a = (0.9 + 0.1 * streak) * edge * top;
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
const BEAM_FRAG = /* glsl */`
uniform vec3 uCol; uniform float uTime;
varying vec2 vUv2;
void main() {
  float a = smoothstep(0.0, 0.45, vUv2.x) * smoothstep(1.0, 0.55, vUv2.x) * smoothstep(0.0, 0.18, vUv2.y) * smoothstep(1.0, 0.35, vUv2.y);
  a *= 0.8 + 0.2 * sin(uTime * 0.6 + vUv2.y * 3.0 + vUv2.x * 2.0);
  gl_FragColor = vec4(uCol * a, 1.0);
}`;
const PLAIN_VERT = /* glsl */`
#include <fog_pars_vertex>
varying vec2 vUv2;
void main() {
  vUv2 = uv;
  vec4 lp = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    lp = instanceMatrix * lp;
  #endif
  vec4 mvPosition = modelViewMatrix * lp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const HALO_VERT = /* glsl */`
attribute vec4 iCol;   // rgb × intensity, flicker amount
attribute vec2 iP;     // flicker speed, phase
uniform float uTime;
varying vec2 vUv; varying vec4 vCol;
void main() {
  vUv = uv * 2.0 - 1.0;
  float fl = 1.0 + iCol.a * (sin(uTime * iP.x + iP.y) * 0.5 + sin(uTime * iP.x * 2.3 + iP.y * 1.7) * 0.5);
  vCol = vec4(iCol.rgb * fl, 1.0);
  float sc = length(instanceMatrix[0].xyz);
  vec4 c = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
  c.xy += position.xy * sc * (0.94 + 0.06 * fl);
  gl_Position = projectionMatrix * c;
}`;
const HALO_FRAG = /* glsl */`
varying vec2 vUv; varying vec4 vCol;
void main() {
  float r = length(vUv);
  float a = pow(max(1.0 - r, 0.0), 2.2);
  float core = pow(max(1.0 - r * 2.2, 0.0), 2.0);
  gl_FragColor = vec4(vCol.rgb * (a * 0.55 + core * 0.9), 1.0);
}`;

export class ExpMats {
  readonly time = { value: 0 };
  /** rim light colour for the cel material (set per biome) */
  readonly rim = { value: new THREE.Color('#bcd4ff').multiplyScalar(0.3) };
  readonly tint = makeTint(this.rim);
  private readonly g = makeGround(this.time);
  readonly ground = this.g.mat;
  readonly groundU = this.g.u;
  readonly outline = outlineMat('n', 8, 0.014);
  readonly outlineBig = outlineMat('n', 8, 0.03);
  readonly glow = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false });
  readonly flat = new THREE.MeshBasicMaterial({ vertexColors: true });
  readonly lava = new THREE.MeshBasicMaterial({ color: '#2a1f3a' });
  /** far ridges / hills ring: baked colours, unfogged (the colours already carry the haze) */
  readonly ridge = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false, side: THREE.DoubleSide });
  readonly water = new THREE.ShaderMaterial({ vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uShallow: { value: new THREE.Color('#46c0e0') }, uDeep: { value: new THREE.Color('#1f6aaa') }, uSky: { value: new THREE.Color('#bfe4ff') },
      uSunCol: { value: new THREE.Color('#fff2dc') }, uSunDir: { value: new THREE.Vector3(-0.3, 0.5, -0.8).normalize() },
      uTime: this.time, uOpacity: { value: 0.88 }, uFoam: { value: 1 }, uFlow: { value: 0.35 }, uScum: { value: 0 },
    }]) });
  /** the falls pool: the same water (shared uniforms), radial bank foam + a soft rim */
  readonly pool = new THREE.ShaderMaterial({ vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true, depthWrite: false, fog: true, defines: { RADIAL: 1 }, uniforms: this.water.uniforms });
  readonly fall = new THREE.ShaderMaterial({ vertexShader: PLAIN_VERT, fragmentShader: FALL_FRAG, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: this.time }]) });
  readonly beam = new THREE.ShaderMaterial({ vertexShader: PLAIN_VERT.replace('#include <fog_pars_vertex>', '').replace('#include <fog_vertex>', ''), fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, toneMapped: false, uniforms: { uCol: { value: new THREE.Color(0.2, 0.18, 0.1) }, uTime: this.time } });
  readonly halo = new THREE.ShaderMaterial({ vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, uniforms: { uTime: this.time }, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false });
  readonly decal = new THREE.ShaderMaterial({ vertexShader: DECAL_VERT, fragmentShader: DECAL_FRAG, uniforms: { uTime: this.time }, transparent: true, depthWrite: false, blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  readonly bar = new THREE.ShaderMaterial({ vertexShader: BAR_VERT, fragmentShader: BAR_FRAG, transparent: true, depthTest: false, depthWrite: false });
  readonly sky = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uLow: { value: new THREE.Color() }, uStars: { value: 0 }, uTime: this.time,
      uSunDir: { value: new THREE.Vector3(-0.35, 0.3, -0.89).normalize() }, uSunCol: { value: new THREE.Color('#fff2dc') }, uSun: { value: 0 },
      uCloud: { value: 0 }, uCloudCol: { value: new THREE.Color('#ffffff') }, uMoon: { value: 0 } } });
  dispose(): void {
    for (const m of [this.tint, this.ground, this.glow, this.flat, this.water, this.pool, this.lava, this.decal, this.bar, this.sky, this.ridge, this.halo, this.fall, this.beam]) m.dispose();
  }
}
