# The mine (Шахта) — site model, API, rules, and our 3D room

Source of truth: the site's own client `mine.js` (+ `craftworld.js`, `mine-art.js`, `world.js` = `LGWorldLib`), read
from `.local/site-new/` (26.10), and a read-only capture of the live mine (`e2e/live.mjs --allow-mine`, sanitized into
`test/fixtures/mine-*.json`). Code: `src/rooms/mine/` (`geo.ts`, `state.ts`, `net.ts`, `scene.ts`, `art.ts`, `hud.ts`,
`fake.ts`, `index.ts`). Dev page: `dist-dev/mine.html`. Tests: `test/mine-geo.test.ts`, `test/mine-net.test.ts`.

## 1. What the mine is

A "craft" location of every city: the fair city has the channel's home mine (`c = 'home'`), each district town its own
(`c = <town id>`); the hero sees which ones are open in `hero.mn` (`{ [c]: MineMe }`). The city portal `mine` calls
`X.openMine(c)` → `LGMine.open(X, c)`; `c = layout.id === 'fair' ? 'home' : layout.id`.

A floor is a hall of **7 × 12 cells** (128 px) of stones; row 11 is next to the entrance, row 0 next to the way down.
Below the hall is the entrance area: lift «В город», minecart on rails, board «Поручения», stall «Скупка» with
«Скупщик Гром», the lamp post of «Фонарщик» / «Снабженец Кремень». At the top: the cage «Спуск» to the next floor —
it opens by itself when every stone of the floor is dug (by everyone together). Floors are shared by the whole channel;
the mine resets weekly (`st.reset`). Digging runs **on the server**: you pick a stone, your hero digs it until it is
done, even with the site closed; earnings (coins) go to the wallet after each stone, ore goes into the hero's bag
(items with `qty`), the buyer turns ore into coins (ore → town treasury).

## 2. Space (px) — `LGWorldLib.mine`, ported 1:1 in `geo.ts`

| const | value | meaning |
|---|---|---|
| `GW × GH`, `CW = RH` | 7 × 12, 128 | hall grid, cell size |
| `SIDE`, `W` | 64, 1024 | rock strip at each side, world width |
| `TOP = Y0`, `GRID_H`, `BOT`, `H` | 420, 1536, 520, 2476 | top area, hall height, entrance area, world height |
| `YB` | 1956 | bottom of the hall = top of the entrance area |
| `REACH` | 200 | max distance (px) from a stone centre to dig it (page `atRock` + server `mineDig`/`mineGo`) |
| `SPEED` | 260 | walk speed px/s (others' moves are animated at it) |

Cells: `i = gy·7 + gx`; virtual cells 84…90 = columns of the entrance area (always walkable).
`cellXY(i)` → `{x, y: top+0.78·RH, cx, cy}`; `centerOf(i)` = where one stands in a cell (`cy + 34`; entrance: `YB + 56`).
`FOOT` (entrance objects): `r` = floor under the object (not walkable), `s` = where not to stand, `z` = base line,
`at` = where to walk to use it (`board` [502, 2440], `buyer` [770, 2434], `lamp` [490, 2176]). `ZONE = [56, 1976, 968, 2440]`.
Functions: `walkable(dug,i)`, `cellOfPt`, `nbrs` (4-neighbours; row 11 ↔ virtual row), `pathTo` (BFS), `digSpot`
(cleared neighbour: below, left, right, above), `free` (nearest free entrance point), `route` (shortest path around
`FOOT.r` via rectangle corners), `walkPt` (where a point may be drawn: a cleared cell, else snapped to the entrance).
`test/mine-geo.test.ts` checks our port against the site's `world.js` on 400 random inputs when `.local/site-new` exists.

## 3. Data model (payloads)

### `MineView` (`st`, «вид шахты») — in enter / state / SSE `mine`
```
{ v, at,                      // version (monotonic), server time of the view (ms) — progress is extrapolated from it
  craft:'mine', biome, danger(★1-5), gem, id, name, dist, n (floor), seed, entryX, gen, week, reset (ms), rec (record floor),
  dug: '0010…' (84 chars, '1' = cleared; voids and the entry start cleared),
  front: [i…],                // stones that can be dug now («с жёлтым кругом») = not dug, not wall/void/entry, a walkable neighbour
  bl: { i: [left, w, rate/min, diggers] },   // stones being dug: work left / total, speed, how many dig it
  dg: { i: [login ×≤4] },     // first 4 diggers per stone (others = "+N")
  dl: [[i, n, res, {login: pieces}, {login: shards}?, {login: {res: shards}}?]…],   // loot of recently dug stones (16)
  log: [{t, at}], top: [[login, units]], gv: [[login, n]], hist: [], working (diggers now),
  lampFrom, darkFrom (floor from which it is dark without a helmet, 5), lampPrice, bp: {res: coins per piece},
  fl?: { exit (column of the way down), entry (cell), special ('vein'|'flood'|'den'|null), c: [[t, lv, r, a] ×84] } }
```
`fl.c` cell tuple: `t` ∈ `rock | hard | ore | rare | wall | void | entry` (+ `chest` in the texts), `lv` = stone level
(bigger = larger, longer to dig; size ×(1 + 0.1·(lv − n))), `r` = rock kind for `rock`/`hard` (`limestone`, `basalt`,
`frost_stone`, `sandstone`, `rubble`, `stone`) or the resource for `ore`/`rare` (`coal iron copper silver gold crystal sulfur …`
and the nature gems `topaz emerald ruby sapphire …`), `a` = amount class. **`fl` is sent only when asked** (`state` without
`&f=`) — views of the same floor (`seed.n`) reuse the layout; a new floor without `fl` → ask for the full view.

### `MineMe` (`me`, also `hero.mn[c]`)
`{ i (stone I dig, −1), day / cap (minutes worked today / daily cap; cap 0 = no cap), bag: {c, cx (coins earned, with
fractions), r: {res: pieces}, p: {res: shards}} (ore waiting in the mine when bags are full), mx: {lv, xp, need}
(mastery «Горное дело»), wk (week contribution), pw, pk (pickaxe), lamp, q: {d: [Quest], w: [Quest]}, nm, dist, bi, dg, gem,
fx: {m2 (mine 2.0), b (buyer window), pk (supplier), sh (shard art), q (queue)}, pkx: {lv, ob, obP, obL, obC, t: [[name,
power, mastery, price, {res: shards}, {res: [replaces, ratio]}]]}, qq: [queued stones], news? }`.
Quest: `{id, t, p, g, c (reward), done, cl (claimed), h? (where)}`.

### Presence (as in the city)
`a: [{l, n, lv, lk, g, gh, aw, x, y, tx, ty, dt}]` full records (walking from x,y to tx,ty, `dt` ms already walked),
`m: [[l, x, y, tx, ty, dt]]` moves, `g: [l]` gone, `n` count, `here` / `hw` / `hm` (in the mine during the last hm
minutes / digging now). `lk: {login: {n, lv, lk, g, gh}}` looks of diggers asked with `&lk=`.

### Chat (room `mine`)
`mchat: {chat: [{id, s, l, n, t, at, c (class), cn}], c}`; SSE `mine` with `{chatRoom: 'mine', chat: […], c}`.

## 4. API (exact requests of mine.js; `q()` = `?c=<id>`)

| when | request | body / query | answer |
|---|---|---|---|
| open | `POST /api/mine/enter?c=` | `{x, y}` (spawn: in front of the cart, `spawnPt(login)`) | `{ok, sid, me, st (with fl), a, n, max, c, here, hw, hm, town, crafts, open, mchat}` |
| every 3 s (live SSE: every 10th tick unless looks wanted; hidden tab: no) | `GET /api/mine/state?c=` | `&v=<st.v>&f=<seed.n>` (omit both for the full view), `&sid=`, `&lk=a,b` (≤60 unknown diggers), `&mc=<chat seq>` (chat without SSE) | `{ok, n?, c, here, hw, hm, same, me, crafts, open, st? (only if v changed), lk?, m?, mchat?, other?}` — `n` missing = the server forgot us → enter again; `other` = mine open in another tab |
| every 60 s (visible) | `POST /api/mine/ping?c=` | `{}` | `{ok}` |
| walk (one per click-walk) | `POST /api/mine/go?c=` | `{x, y, fx, fy}` (target, from) | `{ok}` |
| dig | `POST /api/mineDig` | `{i, c, sid, x, y, k: 1, vh: 0/1, pt?: [x, y]}` (x, y = where the hero stands, ≤ REACH; pt = click point; queue: `+ q: [i…]` with `i` = current stone) | `{ok}` / `{ok: false, error, other?}` |
| stop / walked away | `POST /api/mineStop` | `{c, sid}` | `{ok}` |
| buyer window (`fx.b`) | `POST /api/mineBuy` | `{c, lines: [[uid, shards]…], price}` (price = ⌊Σ shards·bp[res]/100⌋) | `{ok, id}`; result later in the hero snapshot `results[] {id, ok, error?, x: {op:'mineBuy', c (coins), t (thanks text with {coins})}}` |
| old buyer | `POST /api/mineSell` | `{c}` | `{ok}` |
| helmet | `POST /api/mineLamp` | `{c}` | `{ok}` (item `miner_helmet` arrives in the bag; equip via `/api/equip {uid}`) |
| quests | `POST /api/mineClaim` | `{c}` | `{ok}` |
| supplier: pickaxe | `POST /api/minePick` | `{c, to, use: [discount res]}` | `{ok, id}` + result `x: {op:'minePick', to}` |
| supplier: ore bag | `POST /api/mineOreBag` | `{c}` | `{ok, id}` + result `x: {op:'mineOreBag'}` |
| news read | `POST /api/mineSeen` | `{c}` | `{ok}` |
| chat | `POST /api/mine/chat/say?c=` | `{text}` | `{ok}` |
| close | `POST /api/mine/leave?c=` | `{}` | `{ok}` |

SSE (`/api/live`, named event `mine`; teed by `src/bridge` as bus `sse:mine`): `{c, st}` new view (no `fl`), `{m, n, c}` /
`{a, g, …}` presence, `{c, here, hw, hm}` counters, `{chatRoom:'mine', chat, c}` chat. Action results come with the hero
snapshot (bus `sse:me`, `results[]`, `x.op` starts with `mine`).

## 5. Rules (what the page enforces; the server checks again)
- Dig only a stone in `st.front` (adjacent to cleared floor), not a `wall`, standing within `REACH` of its centre.
- Not when `me.cap > 0 && me.day ≥ me.cap` («На сегодня хватит…, новые сутки в 05:00»).
- Dark: `st.n ≥ st.darkFrom (5)` and no helmet worn (`miner_helmet` on, or `me.lamp`) → you cannot see stones, cannot dig,
  others are hidden; buy the helmet at the lamp post, put it on.
- One stone at a time; walking away from it (another cell / farther than REACH) = `mineStop` («Герой отошёл от камня и
  отложил кирку»). The game also stops you on a far `go`.
- Own choice protection: the picked stone counts as "mine" for 15 s even if late views disagree (`want`); after stopping,
  a late view saying "digging" is ignored and the stop re-sent every 30 s (`left`).
- Late views never roll back (`st.v` smaller within 500 of the current, same week).
- Progress: `left_now = left − rate·(now − st.at)/60000`; bar = remaining (full → empty), colour green → yellow → red.
- Loot: `dl` tells who got what (shards; 100 = 1 piece) → «+2 железо и 37 осколков»; others' ore → «досталась другим копавшим».
- Buyer window (`fx.b`, mine 2.0): ore from the hero's bag (items `qty && q > 0`) on the counter; price by `st.bp`.
- Supplier (`fx.pk`): pickaxe ladder `pkx.t` (mastery, coins, ore; discounts by other ores `pickPay`), ore bag (`obL`, `obP`), helmet.
- NPC window closes when you walk more than 2.5 cells (320 px) away from the NPC's `at`.
- Other diggers: max 4 drawn per stone, walkers ≤ 30 nearest (server `max`); silent walkers disappear after 165 s.

## 6. Client decision: our own client, not `LGMine`
`window.LGMine` exposes only `{open, close, onEvent, board, host, result, on}`; its state (`S`) is a closure and every
action is bound to its SVG/DOM (`click` → `worldPt` → `clickRock`). Driving it would need DOM scraping and synthetic
clicks on an invisible SVG — fragile and more code. The mine protocol is small and documented above, so
`src/rooms/mine/net.ts` (`MineClient`) mirrors mine.js **exactly**: same paths, payloads, `sid`, poll cadence
(3 s / every 10th with SSE / not when hidden), ping 60 s, `lk` and `mc` parameters, re-enter when forgotten, late-view and
`want`/`left` logic (`state.ts`, pure, unit-tested). Differences, all on the safe side:
- movement is WASD instead of click-walks, so `go {x, y, fx, fy}` is sent at most every `GO_MS` = 800 ms while walking and
  once when you stop (mine.js: once per click);
- digging requires standing next to the stone (no auto-walk); the dig point `x, y` is the real feet position.
The site's mine must not run at the same time (one presence per tab): the room calls `LGMine.close()` if it is open.

## 7. The 3D room (`kind: 'mine3d'`)

- **Scene** (`scene.ts`, `art.ts`): the floor grid becomes a cave — soil floor, rock walls with strata and cracks,
  stones/ore veins as rocks with glowing crystals by ore type, biome mushrooms, timber supports, lanterns, rails, the
  lift «В ГОРОД», the buyer stall «СКУПКА», the supplier and the quest desk «ПОРУЧЕНИЯ».
- **Lighting:** cool ambient + warm lantern light patches (the city's `world/lightPools` shader, no extra real lights);
  ore stones glow and light the ground; 1–4 real lights follow the player to the nearest lanterns by quality.
- **Diggable stones** (adjacent to cleared floor, like the site's yellow ring) are brighter, with a gold floor halo and
  a level badge; others are dimmed. Aim + E digs (clicks never dig) (you must stand within reach); walking away stops digging.
- **Other miners** are avatars with helmets, pulled to the face of their stone; idle ones are spread ≥ 1.3 m off the
  player and fade near the camera. In third person, rock right in front of the camera dissolves (never the ceiling).
- **HUD** (`hud.ts`): a compact top-right card (floor, nature, counts, «Сейчас» + progress + «Стоп», income with
  «Скупщик», today/mastery meters, «Поручения»), collapsible (`l3d.mineHudMin`). **L** opens the journal drawer (hero
  stats + mine log; it points to the chat). Esc closes cards/drawer first.
- **Mine chat:** the «⛏ Шахта» tab of the bottom-left chat dock (`src/ui/chat.ts`, `attachMineChat`, called by the room):
  appears on entering the mine and is selected, disappears on exit (the previous tab stays as it was), unread badge on
  the tab while another one is shown, own input «Написать в чат шахты…»; posts only when the player presses Enter / send.
- **Lift and board** are used by aiming only (E at the spawn never leaves the mine by accident).
- **Pickaxe:** head in the swing plane, long point forward; first person strikes point-first toward the crosshair.
- **Offline:** `dev/game.ts` plugs `FakeMine` (fixture `test/fixtures/mine-enter.json`) so the whole-game demo opens
  the 3D mine; `dist-dev/mine.html` is the standalone mine demo.

## 8. Capturing a live state (read-only)
```bash
L3D_COOKIES=cookies.txt CHROMIUM=/usr/bin/google-chrome node e2e/live.mjs --allow-mine --steps=.local/mine-capture.json
node .local/mine-sanitize.mjs     # → test/fixtures/mine-{enter,state,sse,fresh}.json, logins → playerN, chat → made-up lines
```
`--allow-mine` lets through only `/api/mine/(enter|leave|ping|state)` — what the site's own mine does when it is merely open;
`mineDig`, `mineSell`, `mineBuy`, `mineLamp`, chat etc. stay blocked. Digging, selling, buying and the lamp are tested
only offline (`src/rooms/mine/fake.ts`, dev page, unit tests).

## 9. Dev page
`npm run build` → `dist-dev/mine.html` (fake game from the captured floor): `?f=fresh` (new floor), `?cam=fp`, `?dark=1`,
`?dig=<seconds per stone>`, `?bots=0`, `?q=0..3`, `?at=X,Z`, `?yaw=`, `?pitch=`. `window.__mine`: `step(n)`, `tp(x, z)`,
`look(yaw, pitch)`, `mode('fp'|'tp')`, `use()`, `target()`, `card('buyer'|'quests')`, `cam(x,y,z, tx,ty,tz)` (free camera).
