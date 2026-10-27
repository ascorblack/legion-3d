# src/world — the 3D city

```ts
import { buildCity, createSvgArt, groundSpec, makeGroundAt, SUPPORTED_BUILDINGS, BUILDING_MODELS } from './world';
const world = await buildCity(layout, { quality, renderer, onDoor?: (id) => … });   // World3D & World3DExt
scene.add(world.root);  // world.update(dt, t, camera) every frame; world.setQuality(q); world.dispose()
world.solidTop(x, y)        // px → top (world Y, m) of what stands there: finite (bench, crate, rim…), Infinity (wall, lamp,
                            //   building, water, outside the area), -Infinity (nothing: open street, the ledge gap)
world.interactables()       // door Interactables: Box3 over each door opening, «Войти: <title>» / «<title> — скоро»,
                            //   use() → world.onDoor?.(id) (settable any time; features/doors.ts overrides use())
await world.mapImage(renderer, { pxPerMetre: 12 })   // top-down map → { url (webp data URL), width, height, x0, z0, x1, z1 (m) }, cached
```

### Adding a building
One builder `(k, b, x0, x1, zf, h) => void` in `buildings.ts` (or `lowstreet.ts` for the lower street) + one line in
`BUILDING_MODELS` (+ the id in `supported.ts` and `src/data/supported.json` → `buildings.models`; test/world-solid.test.ts
checks they agree). Unknown ids still appear: a plastered house (upper street) or a plank barn (lower street) with the
site's title on the sign, door interactable included. Builders push solids for jumping into `k.solids`
(`x0 x1 z0 z1 top`) and extra light pools into `k.pools`.

Everything is real 3D geometry built from the `CityLayout`; the site's 2D art is only a reference.
`opts.art` / `createSvgArt()` (SVG → raster ArtProvider from `layout.art`) exist but are not used for facades.

| file | what |
|---|---|
| `index.ts` | `buildCity`: materials, batching, props, garlands, glows, sky, lights, colliders, quality, update, dispose |
| `ground.ts` | analytic `groundAt` (upper street 0 m, lower street −1.4 m, stair ramps, bridge humps, canal water) |
| `terrain.ts` | paving, retaining wall + stairs + railing, lower street, canal + bridges, city walls, backdrop houses, hills |
| `buildings.ts` | `BUILDING_MODELS`: one builder per building id (hall, auction, trainer, board, anvil, forge, gate, tent, shop, magic, mine, mineboard, storage), generic fallbacks, `house()` fillers, scaffolding for `soon`, `entranceZ()` |
| `lowstreet.ts` | lower-street models in the retaining wall: mine (`rockShell`: one closed rock mass from the ledge to the portal plane with the adit mouth cut out exactly, so the tunnel is visible only through the mouth (`mineAdit()`, test/world-enclosure.test.ts); displaced-icosphere boulders as dressing, timbered adit, gradient tunnel, rails, cart with ore, lantern, «ШАХТА»), mine results board, storage barn |
| `camp.ts` | start camp «Перепутье» (layout id `camp`, `layout.camp` from `LGCampMap`): grass + soil trails, palisades, campfire (flames, cauldron, log benches), ridge tents with lanterns, camp props, string lights only above head height; `static.ts` uses it instead of the street terrain/fillers. Off the fair, `fitFronts` moves building models back so every walkable grid cell stays walkable (test/world-camp.test.ts) |
| `static.ts` | `buildStatic()`: terrain + backdrop + buildings + fillers + props into a Ctx (no DOM: tests build the city in node) |
| `solid.ts` | `SolidMap` (boxes/discs in a 1 m grid), `collectSolids()` (builder solids + prop footprints + coping/cheeks/bridge rails + water), `makeSolidTop()` |
| `worldExt.ts` | door interactables, `renderMapImage()` (orthographic, sky/fog/glows hidden, bright neutral light, render target → flipped → data URL) |
| `zfight.ts` | dev/test z-fight detector: coplanar overlapping faces of different pieces (with burial + identical-look filters) |
| `supported.ts` | plain list of ids with a street model (drift script) |
| `kit.ts` | architectural helpers (box, gable roofs, windows, doors, signs, timber, awnings, wall lamps, flags) |
| `batch.ts` | static batcher: world-space box UVs, vertex colours, merged per material and 14 m x-chunk |
| `place.ts` | props from obstacles + LOW (fountain, well, dummy, signpost, lamps, benches, beds, decor, statue, masts, garland spans) |
| `protoProps.ts` | cheap instanced kinds for repeated props (lamp, bench, crate, barrel, bed, tree, bush, fence, mast) |
| `sky.ts` | gradient dome from `layout.sky` + lighter horizon band (`userData.horizon` = fog colour), twinkling stars, additive glow points shader |
| `lightPools.ts` | `PoolLights`: onBeforeCompile patch of the standard materials (city + prop kit) — warm pools from the 16 nearest lamps/windows (uniform arrays, re-picked every 0.2 s, no allocations), fake AO at wall bases and along the facade line / retaining-wall foot, 2-octave macro tint variation, cool moon rim, `dim` (ambient-only albedo) for darker gaps between pools |
| `textures.ts` | sign atlas (Russo One / Dela Gothic One), glow/dot/moon textures |
| `palette.ts` | per-style colours (cats, legion, monkeys, veggies) |
| `svgArt.ts` | `createSvgArt(layout)` ArtProvider |

Hero props (fountain, well, statue, dummy, signpost, cart) come from `props/` (the prop kit); textures from `tex/`.
Camera colliders: one invisible mesh `world:colliders` with `userData.cameraCollider = true` (coarse boxes).

## No z-fighting (bug #3)
`test/world-zfight.test.ts` builds the whole static city in node, records every Batch piece (`batch.recorder`) and fails on
any two pieces whose faces share a plane (< 4 mm), face the same way (either way for double-sided materials), overlap
by > 2 cm² and are visible (not buried in another convex piece / under the ground) and not identically shaded. Facade
attachments follow the depth table `FACADE_LAYERS` in `kit.ts` (reveal .010 · glass .020 · timber .030/.038 · arch slab
.046 · leaf .062 · frame .072 · posts .080 · sign plate .100 / face .108 · sill .140 m in front of the wall). Only the
contact-shadow blobs use polygonOffset (true decals).
Dev page: `npm run build`, open `dist-dev/world.html` (`?cam=x,y&yaw=deg&pitch=deg&tp=1&q=0..3&still=1`).

## Look (lighting pass)
- Texture world scale is set in `batch.ts` `MAT_UV` (cobble ≈ 11 cm with the 1024-px 16-row paving tile, brick ≈ 25 × 8 cm,
  roof rows ≈ 11 cm, ashlar ≈ 12 cm courses); pieces of brick/plaster/wood/roof/stone get a ±7 % tint jitter.
- Lights: hemisphere `#8f9cff`/`#4a2c30` 1.15, ambient 0.3, moon 1.7; fog = sky horizon band (34 → 260 m).
  Real PointLights (q ≥ 2) are at intensity ~1.5 — the shader pools carry the main lamp light at every quality.
- Light pools (bug #9): windowed falloff `a²(0.4+0.6a)` with peak 1 (was 2.2), lamp gain 1.1 × paving 1.2, and a soft cap
  (knee 0.8 → asymptote 1.25× albedo) on the summed pools. Lamp glass ≈ luminance 1.45 linear (just over the engine's
  bloom threshold 1.35 → soft glow), windows ≈ 0.9 (no bloom), glow halos intensity 0.55.
- Contact blob shadows: one InstancedMesh `world:blobs` (radial texture, multiply-dark) under every placed prop.
- Screenshots of the spawn: `sh .local/w2-shots.sh <tag>` → `.local/shots/w2/<tag>-{fp0,fpL,fpR,tp}.png`;
  world-only budget: `node .local/w2-budget.mjs`.

## No see-through (round 2 audit)
- `test/world-enclosure.test.ts`: ~280k sight lines from every reachable spot near the mine (FP eye on what you stand on,
  camera heights 3 m / 6 m) — the first surface hit must never be a mine surface seen from behind.
- Roofs (`kit.ts`): the dark underside layer faces down (`GEO2.gableUnder`), eave boards close the slot between slope and
  underside, gable walls are pentagons up to the soffit (`gableWalls`), walls rise to the soffit along the eaves; open
  structures (notice boards) pass `open = true` (inner gable faces). Anvil shed: eave + rake boards.
- Upper buildings: the Infinity solid (and the camera collider) reaches the facade attachments at body height (signs,
  turrets, lamps; ≤ +0.3 m) so the FP eye never enters them; camera colliders go up to the roof (h + 2.5 m).
- Dev audits (not shipped, in `.local/`): `w4-sweep.mjs` (reachable viewpoints → contact sheets, `BF=1` paints back faces
  red), `w4-bfaudit.ts` (CPU ray audit of back-face first hits by piece tag; `EYE=0.1` = near-plane clearance).
