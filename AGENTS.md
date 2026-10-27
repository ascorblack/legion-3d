# AGENTS.md — notes for contributors and coding agents

Legion 3D is a Chrome/Firefox MV3 extension that turns the game site play.multidonate.ru («Легион») into a 3D game with
first- and third-person cameras. Start with: [README](README.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/SITE-NOTES.md](docs/SITE-NOTES.md), [docs/GAME-DESIGN.md](docs/GAME-DESIGN.md), [docs/TESTING.md](docs/TESTING.md),
`src/contracts/index.ts`, `src/contracts/modules.ts`.

## Rules
- TypeScript, strict. The only runtime dependency is `three`.
- No proprietary assets in the repo: everything is procedural, or read at runtime from the page itself.
- No real player names, tokens or cookies in code, tests or docs (fixtures in `test/fixtures` are sanitized).
- Performance: no per-frame allocations in hot paths; shared geometries/materials; see ARCHITECTURE.md.
- UI text in Russian, code and comments in English.
- Changing `src/contracts/*` means updating every module that implements the contract.
- Live e2e only does what the site's own city client does (enter/go/ping/leave/state); `e2e/live.mjs` blocks
  every other POST. Never send chat, buy, equip or otherwise act for the account in automated tests.

## Commands
```bash
npm ci
npm run build          # dist/ = unpacked extension, dist-dev/ = demo pages (every dev/*.ts)
npm run build:firefox -- --prod  # dist-firefox/ = Firefox 128+ (unsigned)
npm run e2e:firefox    # actual Firefox extension + offline demo; see docs/TESTING.md
npm run typecheck
npm test               # vitest
npm run drift          # what changed on the site since src/data/site-snapshot.json
open dist-dev/game.html                     # whole game offline: fake site, bots, local equip
node scripts/shot.mjs dist-dev/world.html out.png --wait=6000
L3D_COOKIES=cookies.txt node e2e/live.mjs   # real site (see docs/TESTING.md)
```

## Module map
| module | dir | README |
|---|---|---|
| contracts (`ext.ts` = registries, features, interactables, rooms) | `src/contracts` | — |
| entry | `src/content` (`main.ts` launcher/splash/boot errors, `game.ts` bootstrap + GameContext + frame order) | — |
| core: registries, drift, interact system, room manager | `src/core` | [docs/EXTENDING.md](docs/EXTENDING.md) |
| features (camera modes, crowd, labels, doors, controls, rooms, overlays, classic, quest HUD, menus, debug) | `src/features` (`index.ts` = ordered list) | docs/EXTENDING.md |
| rooms: 3D shops, hybrid interiors, the mine | `src/rooms/shop`, `src/rooms/hybrid`, `src/rooms/mine` | headers of their `index.ts` |
| expedition 3D | `src/expedition` | 3D spectator view of the «поход»; header of `src/expedition/index.ts` |
| events | `src/events` | seasonal events (Halloween, New Year + snowballs, summer lanterns, April 1 hats); `src/events/README.md` |
| supported ids + site snapshot (drift) | `src/data`, `scripts/drift.mjs` (`npm run drift`) | docs/EXTENDING.md |
| site adapter | `src/bridge`, `src/net`, `src/store` | docs/SITE-NOTES.md |
| engine (renderer, quality, input, camera, player, crowd budget, post) | `src/engine` | header of `src/engine/index.ts` |
| 3D city (terrain, buildings, sky, props, textures) | `src/world` | `src/world/README.md`, `src/world/props/README.md` |
| characters, view-model, nameplates, chat bubbles | `src/avatar` | `src/avatar/README.md` |
| HUD, menus, chat | `src/ui` | `src/ui/README.md` |
| expedition HUD | `src/quest` | docs/GAME-DESIGN.md §7 |

## Known gaps / roadmap
- Towns: the current town (fair / start camp «Перепутье» `camp` / district id) is detected in `src/net/town.ts` (City DOM
  `.cy[data-town]`, picker, sessionStorage `lgCityTown`, hero `hm`/`cp`/`tw`) — `LGCity.where/towns` no longer exist.
  The camp is real 3D (`src/world/camp.ts`, layout from `window.LGCampMap`); district towns get their layout and walk grid
  from `LGTownGen` + GET `/api/city/towns` but are drawn with the generic street (no river/plazas art yet).
- Site contract: `src/data/site-contract.json` is checked statically (`npm run drift`) and at runtime (boot guard in
  `src/net/site.ts` via `src/net/contract.ts`; `node e2e/contract.mjs` against the live page).
- Buildings open through the room manager: 3D shops (`shop3d`), 3D interiors with the site's panel over them
  (`hybrid`) and the 3D mine (`mine3d`); a kind whose module is missing or fails falls back to the site's own screen.
- After a site update run `npm run drift` (docs/EXTENDING.md) — it lists new/removed ids and what we do not support.
- Skills, achievements, wardrobe, rating and news menus show a short native summary plus the site's own panel.
- If the site leaves the City tab by itself (an expedition starts), 3D mode does not react yet.
