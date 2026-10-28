# src/events — seasonal events

| id | event | window (local) | folder |
|---|---|---|---|
| `halloween` | Хэллоуин | Oct 24 – Nov 3 | `halloween/` |
| `newyear` | Новый год + «Снежки» (G) | Dec 20 – Jan 10 (wraps the year) | `newyear/` |
| `summer` | Летние фонарики | Jun 21 – Jul 7 | `summer/` |
| `aprilfools` | День нелепых шляп | Apr 1 | `aprilfools/` |

A holiday = one file / folder here (a `SeasonalEvent`) + one line in `EVENTS` (`index.ts`). The host feature
`src/features/seasonal.ts` does the rest: it picks the event, builds the context, sets it up and disposes it.

```ts
// src/events/maslenitsa.ts  (example)
import { inWindow, windowDistance } from './calendar';
import type { SeasonalEvent } from './types';
const MASLENITSA: SeasonalEvent = {
  id: 'maslenitsa', title: 'Масленица', short: 'Блины', greeting: '🥞 Масленица! … Отключить: Настройки → События',
  active: (d) => inWindow(d, [2, 20], [2, 26]),             // local time, a window may wrap the year (Dec 20 – Jan 10)
  distance: (d) => windowDistance(d, [2, 20], [2, 26]),      // used by «Всегда» to pick the nearest window
  setup(ctx) { /* add to ctx.group, hook ctx.onFrame / ctx.onQuality … */ return () => { /* undo everything */ }; },
};
export default MASLENITSA;   // then: `import maslenitsa from './maslenitsa'; export const EVENTS = [..., maslenitsa]`
```

## Which event runs
`pickEvent(EVENTS, now, mode, forced)` (`calendar.ts`):
- setting **«События → Праздничное оформление»** (`l3d.event.mode`): `auto` (default: only inside the date window),
  `on` («Всегда»: the open window, else the nearest one), `off`;
- setting **«Какое событие («Всегда»)»** (`l3d.event.pick`): `near` (default) or an event id — with «Всегда» that event
  runs whatever the date (options are built from `EVENTS`: `short ?? title`); ignored in «Авто» / «Выкл»;
- dev override `?event=<id>` (`?event=off` = none) — honoured only in dev builds (`__DEV__`), never in the extension;
- re-evaluated on `l3d:settings`, when the city world is rebuilt, and once a minute (midnight rolls the window).
The first time an event starts on a given day in `auto` mode a toast says so (`event.greeting`).

## Contract of `setup(ctx: EventContext)`
- everything you add goes under `ctx.group` (a sibling of the world root, hidden inside rooms) — or is reverted in the
  returned disposer; **dispose must leave the scene exactly as before** (test/events-halloween.test.ts checks scene,
  hooks, garland bulbs, sky, moon, fog colour, geometries);
- `ctx.onFrame(dt, t)` / `ctx.onQuality(q)` return unsubscribers (the host also releases them);
- respect the quality level (q0–1 fewer/cheaper), no per-frame allocations, ≤ 15 draw calls, ≤ 0.5 ms/frame at q2;
- `ctx.game` (optional — absent on the dev page and in tests): key bindings, `canAct()` (street gameplay live: pointer
  locked, no room / menu / modal / text field / photo mode, crosshair not on a door / goods / stone), the crowd's
  avatars (`forEachCat`, `me()`), a small combat knock-back (`knock`, only when «Драки» are on), `swing()`,
  `reducedMotion`. Never change an avatar — draw over it;
- shared helpers: `common.ts` (garland re-colouring, self-lit vertex colours, the city raster from the Halloween placement);
- place things with the city's own functions: `ctx.world.groundAt(px)`, `ctx.world.solidTop(px)`, `ctx.layout.free(px)`,
  `ctx.world.interactables()` (door boxes: keep ≥ 0.6 m away). Decals ≥ 6 mm above their surface.

## Halloween (`halloween/`)
| file | what |
|---|---|
| `index.ts` | the event: world hooks (re-colour garland bulbs orange/purple/lime, violet sky, bigger warm moon — all reverted), meshes, per-frame animation, quality budget |
| `placement.ts` | pure placement on a 0.125 m raster of the city: pumpkin clusters hug walls / door sides / stair ends / the ledge strip, ≥ 0.6 m from doors, flat open ground only; fog patches; ghost spots |
| `geo.ts` | pumpkin (6 ribs, dimpled, stalk), bat (flap in the vertex shader), ghost cat, quads |
| `tex.ts` | CPU-rasterised DataTextures: carved jack-o'-lantern faces (emission map), soft fog, cobweb, glow — no canvas, no assets |

Draw calls at q2: pumpkins, jack-o'-lanterns, light pools, contact shadows, hanging strings, halos, bats, ghosts, fog,
cobwebs = 10–11 (no real lights, no shadow casters). Counts per quality: `HALLOWEEN_BUDGET`.
Dev page: `dist-dev/events.html?event=halloween&q=2` (buttons switch the event / quality while it runs); in the game
`dist-dev/game.html?event=halloween` (`__l3dGame.seasonal.active()`).

### «Ночь Тыквенной Луны» (site 28.10, `hero.hwc`) — `src/features/hwcity.ts`
The site's Halloween night in the City (`hero.hwc = { look, portal, at }` from /api/me and SSE `me`; city.js hwNow / cityhw.js).
Only the Fair (layout id `fair`) transforms; the camp and district towns stay. Setting «События → Ночь Тыквенной Луны» (`l3d.hwcity`).
| file | what |
|---|---|
| `halloween/hwcity.ts` | pure: `parseHwc`, `hwcMode` (look → decoration + «dead» city, portal → portal + ghost cats), `portalSpot` (cityhw at(sc): centred on the gate door, bottom on its ground, flush on the facade; pushed back until no walkable cell — `layout.free` and not inside a solid — is covered), `planHwExtras` (cauldron, candles, witch circle, facade cobwebs) |
| `halloween/hwgeo.ts` | extras as ONE merged mesh (witch flown in the vertex shader via `aFly`), the portal's stone arch |
| `halloween/portal.ts` | the portal: frame + vortex shader quad + street glow (3 draws), `setOpen(0…1)` |
| `halloween/dead.ts` | `DeadGrade`: a shader tail on every world material (shared uniform), cold-grey world lights, street lights / lamp glows / garland bulbs / lamp pools off; `dispose()` restores everything |
| `halloween/ghosts.ts` | `GhostCrowd`: every crowd avatar and the own hero via `Appearance.ghost`, translucent FP paws (view-model materials swapped) |

`look` forces the Halloween event through `setEventOverride('halloween', 'hw', () => fair)` (src/features/seasonal.ts; honoured in «Авто»/«Всегда», never «Выкл»)
with `halloweenOpts.hw = true` (+1 draw: extras; +8 bats, +10 webs). Portal open: +3 draws → ≤ 15 at q2. Transitions are smooth
(grade 2.6 s, portal 1.8 s, ghosts ≤ 3 rebuilds/frame). Dev: `dist-dev/game.html?hwc=look|portal|p`, live `__demo.hwc('lp'|'look'|'off')`,
`__l3dGame.hwcity.state()`. Release shots: `node dev/hw-shots.mjs`.

## New Year (`newyear/`)
| file | what |
|---|---|
| `index.ts` | the event: garland bulbs warm multicolour, frosty paving tint (both reverted), snow caps, snow cover, drifts, the tree, snowfall, budget per quality (`NEWYEAR_BUDGET`) |
| `placement.ts` | pure: the tree on the most open flat spot near the spawn (clear of doors / spawn), drifts hugging wall feet (never floating over lower ground, not on stairs), the street snow cover (0.5 m cells of flat open ground) |
| `geo.ts` | fir tree (one merged vertex-coloured mesh: trunk, 4 snowy tiers, baubles, gifts), star, light spiral, **snow caps** = copies of every up-facing city face ≥ 0.35 m over the street, lifted 4 cm |
| `snowfall.ts` | one Points in a camera-wrapped box, all motion in the vertex shader (off with reduced motion, 250 flakes at q0) |
| `snowball.ts` | «Снежки» (idea #22): G throws (client-only); arc, sub-stepped collisions with cats / ground / solids / walls (one raycast at impact for the splat normal), «пух» puff, melting splats; cats get a puff + a tiny combat knock |
| `tex.ts` | drift / splat / snow-cover DataTextures |

Draw calls at q2: caps, cover, drifts, tree, star, lights, light pool, snowfall = 8 (+ balls, splats, puff while
snowballs fly = 11). No real lights.

## Summer lanterns (`summer/index.ts`)
Paper lanterns floating on the canal between the bridges (shrink in/out at the bridge ends), lanterns hovering over the
water, a festoon of small lanterns along the garland cables; additive glow streaks on the water that turn to the viewer
(fake reflection), halos, fireflies (q ≥ 1). q0 / reduced motion: still. 4–5 draw calls, no real lights.

## April 1 party hats (`aprilfools/index.ts`)
One InstancedMesh: a striped paper cone with a pompom on every visible cat within 24 m (16/32/64/96 by quality),
following the body bone the head is skinned to (`(P − rest[body]) · body.matrixWorld`, so emotes and ragdolls carry
it); cats whose head top is > 0.22 m above the head (tall helmets, big hats) are skipped; the own cat only in third
person. The avatars are never modified. Needs `ctx.game` (the game's crowd): on the dev page it shows nothing — use
`dist-dev/game.html?event=aprilfools`.

Dev overrides: `?event=halloween|newyear|summer|aprilfools|off` (dev builds only). Dev page keys: G throws a snowball.
