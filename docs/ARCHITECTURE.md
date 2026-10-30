# Architecture

```
Chrome MV3 extension, two content scripts in the page's MAIN world (no extension permissions for the game itself; the update notice below adds `storage` + one host):

  bridge.js   document_start  tees EventSource events into a bus (window.__L3D_BUS); owns the fetch tee but leaves window.fetch alone until 3D asks (see «fetch tee» in docs/SITE-NOTES.md)
  game.js     document_idle   the game: store, engine, world, avatars, UI; boots when the user enters 3D mode
  notify.js   document_idle   ISOLATED world: relays the update worker's answer to the page (postMessage, data only)
  background.js  service worker (Firefox: event page): the update check, below
```

**Update notice** (`src/update/`): a background worker `background.js` (the only code that touches the network: one GET of GitHub's releases/latest, ≤ 1 per 12 h, skipped when the installed manifest has `update_url` = store install) and an isolated-world relay `notify.js` that postMessages `{current, store, latest, url}` as plain data to `src/features/update.ts` (toast, pause-menu row, setting «Проверять обновления (GitHub)»). Permissions: `storage` + host `https://api.github.com/repos/ascorblack/legion-3d/releases/latest`.


## Why MAIN world + "hybrid" netcode
The site already owns auth (httpOnly cookie), the live SSE channel and a careful city client (presence
`enter/ping/leave`, throttled `go`, chat state, trade, building interiors, mine, quests). Re-implementing it
would be slow and impolite to the server. So:

- The site's own City tab stays **open underneath** (shrunk to a tiny viewport, other players hidden there with
  `LGCity.hideOthers(true)`, lowest quality) — it keeps us *present* in the city and handles interiors.
- **We move** by calling `LGCity.go(x, y)` (the site throttles and sends `/api/city/go`).
- **We read** others and chat by teeing the SSE `city` events and, in 3D mode only, the `/api/city/enter` response (bridge; the fetch tee is on while 3D runs and off in the classic site),
  then simulate walkers with the site's own `LGCityMap.follow/stepAlong` (identical motion to the 2D city).
- **Buildings**: walking to a door and pressing `E` calls `LGCity.panel(id)`; the site's interior (`.cy-room`,
  `position:fixed`) is shown above the 3D canvas; closing it returns to the game.
- **Hero actions** (equip, unequip, use, wear) are plain `POST /api/...`; the fresh hero arrives via the `me`
  SSE event or the response itself.

If any site global is missing (site changed), the game degrades: e.g. no `LGCity` → solo mode with a notice.

## Coordinates
2D city is a side-scroller: `x` = horizontal px, `y` = depth px (800 = back street in front of buildings, 1900 =
front). 3D world: metres, `X = x * SX`, `Z = (y - Y0) * SZ`, `Y` = up. Constants live in `src/world/coords.ts`
(`SX = 0.01`, `SZ = 0.02`, `Y0 = 800`). Buildings stand at `Z < 0` (behind the walkable area), their 2D `hit`
rectangle gives width (`x0..x1`) and height (`(Y0 - hit.y0) * SX`). Collision uses the site's walk grid
(`LGCityMap.make(...).free(x, y)`) so we never stand where the server would refuse.

## Modules (src/)
| dir | owns | key exports |
|---|---|---|
| `contracts/` | shared types (no code) | `Look, Gear, Appearance, Hero, Item, CityLayout, ChatMsg, Store` |
| `bridge/` | document_start tee | `bridge.ts` |
| `net/` | site adapter: bus, SiteCity driver, api() | `site.ts`, `api.ts` |
| `store/` | reactive game state (hero, walkers, chat, quest) | `store.ts` |
| `engine/` | renderer, loop, adaptive quality, input, camera rig (FP / TP / orbit) | `engine.ts`, `camera.ts`, `input.ts`, `quality.ts` |
| `world/` | 3D city from a `CityLayout` (terrain, levels, buildings, props, sky, lights) | `buildCity()` |
| `avatar/` | procedural characters from `Appearance`, nameplates, chat bubbles, first-person view-model | `createAvatar()`, `createViewModel()`, `Labels` |
| `ui/` | game HUD and Dark-Souls-like menus (equipment, bag, stats, skills, achievements, journal, rating, news, map, settings), chat panel | `mountUi()` |
| `quest/` | expedition HUD (party, phase, what to type, vote/act buttons) | `mountQuestHud()` |
| `content/` | entry points: `main.ts` (boot, mode toggle, wiring) | — |

Performance rules: one renderer, no per-frame allocations, shared geometries/materials (cache by key),
merged static geometry for the city, instancing for repeated props, sprites for labels via one canvas atlas
per label, dynamic resolution scaling to hold frame time, distance LOD and a cap on drawn avatars, at most a few
real-time lights (lamps are emissive + fake glow sprites), shadows only on "high".
