# src/world/tex — procedural materials

Everything is generated in the page (no shipped images, nothing downloaded). Public API (`index.ts`):

```ts
setTexQuality(q)                 // 0..3, before a scene requests its textures (buildCity does it)
setTexAnisotropy(a)              // buildCity: renderer max at q ≥ 2, 4 at q1, 2 at q0
getTexture(kind, { colors?, neutral?, seed?, size?, bump? })   // cached TexSet { map, normalMap, roughnessMap, emissiveMap?, ids, organic, size }
cloneTex(t)                      // own offset/repeat, follows the background upgrade (never `t.clone()` a cached texture)
whenTexturesReady()              // resolves when the background upgrades are done (shots, tests)
texStats()                       // { syncMs, asyncMs, maxSliceMs, maxStepMs, jobs, bytes, … }
disposeTextures()
surfaceDetail(material, opts)    // tex/surface.ts — the surface shader (below); configureSurface({ wallZ, lowH, dirt, moss, quality })
```

## Pipeline
1. A generator (`gen-built.ts` elements, `gen-organic.ts` continuous, `gen-fx.ts` water/lava) paints three canvases:
   colour `C` (S×S), height/detail `H` and element ids `I` (hs×hs: hs = S below 1024, S/2 from 1024).
   Element id = the element's centre (R = u, B = v) with G = 255 as mask; joints are black.
2. `post.ts` (pure typed arrays, node-testable): toroidal chamfer distance to the joints → rounded / chamfered bevels
   of any painted shape; cavity AO (blur − height) and joint AO baked into the albedo, then **mean-preserved** (AO adds
   contrast, the palette's value stays); worn light edges on bevel shoulders; per-element tone; grain. Normal map =
   Sobel of the final height (strength calibrated at 512 px, scaled with the size, so every quality looks alike).
   Roughness map: G = roughness (×`material.roughness`), and for element kinds R/B/A = centre + mask.
3. `index.ts`: DataTextures (sRGB map, linear normal/roughness, mipmaps, repeat, anisotropy). A texture larger than the
   256-px preview is first built small with fine decorations skipped (`lite`), then rebuilt at full size by a
   time-sliced background job (≤ 6 ms per tick, canvas flushes and read-backs split into strips) that swaps each
   texture's `source` in place (`dispose()` first: the GPU texture is reallocated at the new size).

## Kinds
cobble · brick · stone (ashlar) · wood (vertical planks) · planks (floorboards) · roofTiles · slate · iron (riveted
plates) · basalt (columns) — element kinds with ids; plaster · rock · grass · soil · path (trodden dirt) · moss ·
thatch · canvas · metal (hammered) · water · lava (emissive cracks) · glow. Layout counts per tile are fixed
(16/8 cobble rows, 8 brick courses × 4, 4 ashlar courses, 4 planks, 6 roof rows × 5, 7 slate rows × 6): with
`batch.ts` MAT_UV they set the world scale, so sizes can change per quality without moving a joint.

## Texel density targets (px per metre of surface)
Sizes: q0 ¼, q1 ½, q2 = base, q3 2× (cap 1024; 2048 for cobble / grass / path).

| family | world tile | q2 size | q2 px/m | q3 px/m | target |
|---|---|---|---|---|---|
| upper paving (cobble, camp/village grass) | 2.4 m / 1.35 ≈ 1.78 m | 1024 | ≈ 575 | ≈ 1150 | ground close to the camera: ≥ 500 (q2), ≥ 1000 (q3) |
| lower paving (cobble, village/camp path) | 1.6 m / 1.35 ≈ 1.19 m | 1024 | ≈ 860 | ≈ 1720 | same |
| brick | 1.0 × 0.65 m | 512 | ≈ 510 × 790 | ≈ 1020 × 1580 | walls: ≥ 500 |
| ashlar stone | 0.63 m | 512 | ≈ 820 | ≈ 1640 | walls: ≥ 500 |
| wood planks / plaster | ≈ 1 m | 512 | ≈ 510 | ≈ 1020 | walls, props: ≥ 500 |
| roof tiles / slate | 0.8 m | 512 | ≈ 640 | ≈ 1280 | roofs (seen from afar): ≥ 300 |
| rock / basalt | ≈ 1.6 m | 512 / 1024 | ≈ 320 / 640 | ≈ 640 / 640 | boulders, cliffs: ≥ 300 |
| metal, canvas | ≈ 1 m | 512 | ≈ 510 | ≈ 1020 | ≥ 300 |
| prop kit (per-face box UVs, ≈ 1 tile/m) | ≈ 1 m | 512 | ≈ 510 | ≈ 1020 | test/world-texmap.test.ts keeps density within 0.5–2× of the material median |

## Surface shader (`surface.ts`)
One fetch of a 256² world-space RGBA noise (R ≈ 6 m, G ≈ 1.5 m, B ≈ 0.5 m features, A = anti-tiling selector) per
fragment drives: macro brightness + warm/cool variation; grime rising from the street level on walls (dirt colour,
noise-broken edge, `dirtH`); moss on up-facing tops, the wall foot and (element kinds) in the joints; wet glossy patches
on floors (roughness → 0.16, flatter normal, darker albedo). Element kinds add a per-element **per-tile** tone from
the roughness map's ids (`texelFetch`, exact; fades out when minified) — the repeated tile stops reading as a pattern.
Organic kinds blend two offset fetches of map/normal/roughness (anti-tiling). q0: off; q1: noise effects only;
q2+: all. Chains with `lightPools.ts` (either order). Materials keep their style tints: vertex colours × neutral maps,
or the palette colours passed to the coloured kinds.
