# Extending Legion 3D

The site changes several times a day. Everything that mirrors site content is a **registry entry** or a **feature**,
never a branch inside the game loop. Adding a building, room, item model, menu tab, key or mechanic is one new file
plus one line in an index. When the site sends an id we have no entry for, the game uses a generic fallback and
reports the id once as **drift**.

Contracts: `src/contracts/ext.ts`. Core: `src/core/*`. Built-in features: `src/features/*`.

## Map

| what | where | registered in |
|---|---|---|
| registries (buildings, rooms, itemModels, menus, keys) | `src/core/registry.ts`, `src/core/registries.ts` | `ctx.registries.*` |
| features (mechanics) | `src/features/<name>.ts` | `src/features/index.ts` (`FEATURES`) |
| interactables (crosshair + E) | `src/core/interact.ts` | `ctx.interact.add()` |
| rooms (interiors, the mine) | `src/rooms/*`, `src/core/rooms.ts` | `ctx.registries.rooms`, `ctx.rooms.enter(id)` |
| drift (unknown ids at runtime) | `src/core/drift.ts` | `ctx.drift(kind, id)`, `window.__l3dDrift`, F3 |
| drift (site update, offline) | `scripts/drift.mjs` | `npm run drift` |
| what we support | `src/data/supported.json` | edited with the change that adds support |

## A feature (a mechanic)

A feature is one file with a default export, plus one line in `src/features/index.ts`:

```ts
// src/features/fishing.ts
import type { Feature } from '../contracts/ext';

const fishing: Feature = {
  id: 'fishing',
  order: 55,                         // lower runs first; ctx.onFrame hooks run in this order too
  setup(ctx) {
    const off = ctx.onFrame((dt, t) => { /* after the player moved, before render; no allocations */ });
    return () => off();              // optional disposer
  },
};
export default fishing;
```

`setup` may be `async`. A feature that throws is logged and skipped: the game still starts. Use only `GameContext`
(`ctx.store`, `ctx.actions`, `ctx.scene`, `ctx.camera`, `ctx.input`, `ctx.interact`, `ctx.rooms`, `ctx.registries`,
`ctx.ui.toast/open/prompt`, `ctx.player`, `ctx.onFrame`, `ctx.drift`). Built-in features type their argument as
`CoreContext` (`src/core/context.ts`) for game internals (avatars, labels, world); new mechanics should not need it.

Frame order (src/content/game.ts): look → player controller → site tick → own avatar → camera → **feature hooks** →
world or room update → interact target + HUD prompt → UI. Settings live in `src/core/settings.ts` (`SET`).

## A key binding

```ts
ctx.registries.keys.register('emote.wave', {
  code: 'KeyG', label: 'Помахать',
  when: 'gameplay',                  // default: skipped while a menu is open or gameplay is off; 'always' = every time
  run: (ctx, e) => { /* … */ return true; },   // true = handled (the UI does not see the key)
});
```

Bindings run before the UI's own keys, in registration order. Keys taken by the UI: Tab, Enter, T, /, Esc (pause),
F1–F3, C I B P K Y J O M R N. Built-in bindings: V (camera), E (use), F (secondary action),
Esc (leave a room / the site's building screen), F3 (drift list). Space (jump) is read by the player controller
from `input.consumeJump()`.

## An interactable (something to use)

```ts
const off = ctx.interact.add({
  id: 'well', label: 'Набрать воды', icon: '🪣',
  hit: someMesh,                     // invisible mesh or a THREE.Box3 in world metres
  reach: 2.5,                        // default 3 m from the eye (crosshair), 2.2 m from the feet (E)
  proximity: true,                   // false = only by aiming (shelf goods)
  use(how) { /* how: 'key' (E); clicks never interact — 'click' is kept for compatibility and never sent */ },
  alt: { label: 'Осмотреть', use() { /* F */ } },
  enabled: () => true,
});
```

The crosshair ray picks the nearest volume within reach; if nothing is aimed, E uses the nearest volume within
proximity reach. **The mouse never interacts with the world** (like in games): LMB swings / attacks, RMB blocks; E uses, F is the secondary action. The HUD prompt is
built from the target: `[E] <label>` (plus `· [F] <alt.label>`); `soon: true` on the object shows it muted.
`ctx.ui.prompt(text)` overrides the prompt (null returns control to the interact system).

## A building model

Street models are built by `src/world/buildings.ts`: add a builder to `BUILDERS` keyed by the site's building id
(`(k, b, x0, x1, zf, h) => void`, see the existing ones). Unknown ids get a generic house with the title on a sign.
Then:

1. add the id to `src/data/supported.json` → `buildings.models`;
2. say how it opens in `src/core/registries.ts` → `DEFAULT_BUILDINGS` (`room: 'shop3d' | 'hybrid' | 'mine3d' | 'site'
   | 'none'`, optional `scene` to reuse another room variant) and mirror it in `supported.json` → `buildings.rooms`
   (test/core-supported.test.ts checks they match).

A module can also register it at runtime: `ctx.registries.buildings.register('zoo', { room: 'hybrid', scene: 'plain' })`.
Doors come from `world.interactables()` when the world provides them, otherwise from `world.doors` with a generated
box (`src/features/doors.ts`).

## A room

A room kind is a `RoomDef` registered under its kind; the variant is `BuildingDef.scene` or the building id.

```ts
import type { RoomDef, Registry } from '../../contracts/ext';
export const zooRoom: RoomDef = {
  title: 'Зоопарк',                    // loading veil
  async create(ctx) {                  // ctx: RoomContext (GameContext + building, exit, showSitePanel, hideSitePanel)
    const root = new THREE.Group();    // bring your own lights: the city (sun, sky) is hidden inside rooms
    ctx.interact.add({ id: 'room:exit', label: 'Выйти на улицу', hit: doorMesh, use: () => ctx.exit() });
    return {
      root, spawn: { x: 0, z: -1, face: 0 },          // room-local metres; face 0 looks towards −Z
      free: (x, z) => /* walkable */ true,
      groundAt: () => 0,
      solidTop: (x, z) => -Infinity,                   // counters/crates to jump on; Infinity = wall
      colliders: [wallMesh],                           // TP camera
      update(dt, t, camera) {},
      dispose() { /* geometries, materials, textures */ },
    };
  },
};
export const registerZoo = (rooms: Registry<RoomDef>) => rooms.register('zoo3d', zooRoom);
```

Hook it up with one line in a feature (`src/features/content-rooms.ts` holds the room modules):
`registerZoo(ctx.registries.rooms)`, and map buildings to the kind (`DEFAULT_BUILDINGS`, `supported.json` →
`roomKinds`).

What the room manager does (`src/core/rooms.ts`): on enter it hides the city world, the other players and their
labels, adds `root`, switches the player controller to the room's floor (`free/groundAt/solidTop`, metres), sets the
TP camera colliders and spawns the player. Interactables and `ctx.onFrame` hooks registered through the room's
context are removed on exit automatically. `exit()` disposes the scene and puts the player on the street at the
building door, facing the street. Esc leaves a room.

Fallbacks: no factory for the kind, a factory that throws, or `room: 'site'` → the site's own 2D screen
(`actions.openBuilding(id)`).

**Hybrid rooms** (`room: 'hybrid'`): after the scene is up the manager opens the site's own panel for the building
over the 3D room (`html.l3d-room3d` makes the site's room layer transparent and click-through except its header
and panel; the canvas keeps rendering). `ctx.showSitePanel()` is idempotent. Leaving through the site's «Выйти»
leaves the 3D room; leaving the 3D room closes the site panel. The pointer is free while the panel is shown; a click
on the 3D view grabs it again.

Try the system without the room modules: `dist-dev/game.html?room=board:debug` maps the board to the built-in
`debug` room (`src/core/debugRoom.ts`, the smallest complete RoomDef).

## An item model

3D models for item looks are factories in `ctx.registries.itemModels`, keyed `'<slot>:<look>'` with a `'*'`
fallback, e.g. `'weapon:sword'`, `'shield:round'`, `'hat:wizard'`, `'armor:robe'`, `'slot:food'`:

```ts
ctx.registries.itemModels.register('weapon:trident', (look, { rarity, slot, id }) => buildTrident(rarity));
```

`resolve()` returns the fallback and reports the unknown key as drift. Character gear on avatars is built by
`src/avatar` (`gear.ts`, `hats.ts`); when you add a look there, add its id to `supported.json` → `looks.*`.

## A menu tab

```ts
ctx.registries.menus.register('pets', {
  title: 'Питомцы', group: 'character', hotkey: 'KeyU', order: 45, orbit: false,
  render(el, ctx) { el.textContent = '…'; return () => { /* cleanup */ }; },
});
```

The `menus` feature mirrors the registry into the UI (`ui.addTab`); unregistering removes the tab (a replaced
built-in page comes back).

## A quest phase card

The expedition HUD (`src/quest/index.ts`) maps the site's quest kinds (`KIND_RU`: battle, trap, treasure, …) to a
title and icon and renders the phase card from the SSE quest view. A new kind: add it to `KIND_RU` (and the card
branch if it needs its own buttons), then to `supported.json` → `questKinds`. Unknown kinds show as «Поход».

## After a site update: drift

```bash
npm run drift                         # download the channel page + scripts, compare
npm run drift -- --local=.local/site-new   # use scripts you already downloaded
npm run drift -- --json               # machine-readable
npm run drift -- --write              # accept the current site as the snapshot (after updating the code)
```

It reads building ids (citymap.js), room ids (city.js `ROOM`), the look catalog (doodle.js `CATALOG` + event
looks), game data lists (game-data.js: classes, resources, extra stats), every `/api/...` path and the quest kinds,
and prints:

- **Changed since the snapshot** (`src/data/site-snapshot.json`): new and removed ids per list;
- **Site ids without support**: ids missing from `src/data/supported.json` (they get a generic fallback in the game);
- **API paths we call that the site no longer mentions**: endpoints used in `src/` that disappeared (likely breakage).

The contract (`src/data/site-contract.json`) is checked twice: statically by drift (`kind: 'keys'` = real top-level keys
of the `window.<obj> = {` literal, comments ignored; `'global'` = the module's exports in node:vm; otherwise a regex) and
at runtime (`src/net/contract.ts`): the extension's boot guard stops on a missing `break` item («Сайт обновился…», the
list in the console) and reports `degrade` ones as drift; `L3D_COOKIES=… node e2e/contract.mjs` runs the same check on
the live page read-only (exit 3 = break).

Workflow: run drift → add support for what matters (model, room mapping, look) → update `supported.json` → `npm test`
→ `npm run drift -- --write` → commit the code with the new snapshot. At runtime the same unknown ids show in the F3
panel and `window.__l3dDrift`.
