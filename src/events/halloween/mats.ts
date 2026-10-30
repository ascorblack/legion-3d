/**
 * Halloween materials (shared by instancing; built once per event setup, disposed with it).
 *  - pumpkinMaterial: lit orange skin with a soft night self-light and a cool moon rim (form instead of a flat glowing
 *    blob); carved instances (instanced attribute aJack = 1) glow from inside: the cuts (emission map rgb, yellow core →
 *    orange cut walls), a warm glow through the thin skin around them (map alpha), each on its own flicker phase.
 *  - ghostMaterial: unlit translucent ghost cat, a little darker and denser face-on, brighter and more see-through at the
 *    silhouette (a lilac rim) — no flat overexposed white.
 */
import * as THREE from 'three';

export function pumpkinMaterial(face: THREE.Texture, time: { value: number }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.52, emissive: new THREE.Color(1, 1, 1), emissiveMap: face });
  m.name = 'halloween-pumpkin';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aJack; varying float vJack; varying float vPh;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vJack = aJack;
        #ifdef USE_INSTANCING
          vPh = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 2.3;
        #else
          vPh = 0.0;
        #endif`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime; varying float vJack; varying float vPh;')
      .replace('#include <emissivemap_fragment>', `
        vec4 faceT = texture2D( emissiveMap, vEmissiveMapUv );
        float flick = 1.0 + 0.16 * sin( uTime * 9.1 + vPh ) * sin( uTime * 2.7 + 1.0 + vPh * 1.3 ) + 0.05 * sin( uTime * 23.0 + vPh * 3.0 );
        vec3 skin = vColor.rgb;
        float ndv = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
        float rim = pow( 1.0 - ndv, 3.0 );
        totalEmissiveRadiance = skin * 0.1 + vec3( 0.36, 0.32, 0.62 ) * rim * 0.32 * ( 1.0 - 0.5 * vJack );
        totalEmissiveRadiance += vJack * flick * ( faceT.rgb * 2.8 + vec3( 1.0, 0.4, 0.07 ) * faceT.a * 0.7 + skin * vec3( 0.2, 0.12, 0.04 ) );`);
  };
  m.customProgramCacheKey = () => 'l3d-hw-pumpkin';
  return m;
}

export function ghostMaterial(): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.94 });
  m.name = 'halloween-ghost';
  m.color.setScalar(1.0);
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGN; varying vec3 vGV;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec3 gn = normal;
        #ifdef USE_INSTANCING
          gn = mat3( instanceMatrix ) * gn;
        #endif
        vGN = normalize( normalMatrix * gn ); vGV = normalize( -mvPosition.xyz );`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGN; varying vec3 vGV;')
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
        float gd = clamp( dot( normalize( vGN ), normalize( vGV ) ), 0.0, 1.0 ), gr = pow( 1.0 - gd, 2.0 );
        diffuseColor.rgb = diffuseColor.rgb * ( 0.66 + 0.3 * gd ) + vec3( 0.5, 0.44, 1.0 ) * gr * 0.45;
        diffuseColor.a *= mix( 0.9, 0.42, gr );`);
  };
  m.customProgramCacheKey = () => 'l3d-hw-ghost';
  return m;
}
