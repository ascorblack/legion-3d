# src/rooms — shop3d and hybrid rooms

Owner's wish #10: walk inside shops and pick goods from the shelves; other buildings get a 3D interior with the
site's own panel docked over it.

```ts
import { registerShopRooms } from './rooms/shop';
import { registerHybridRooms } from './rooms/hybrid';
registerShopRooms(registries.rooms);     // kind 'shop3d': forge, magic, shop (rows), tent
registerHybridRooms(registries.rooms);   // kind 'hybrid': trainer, board, hall, auction, storage, gate, anvil, plain
// BuildingDef { room: 'shop3d' | 'hybrid', scene?: '<variant>' }  — variant defaults to the building id
```

Both `RoomDef.create(ctx)` build a `RoomScene` (room-local metres, entrance wall at z = +D/2, spawn just inside,
looking to −Z). Adding a scene = one function in `SHOP_SCENES` (shop/index.ts) or `HYBRID_SCENES` (hybrid/scenes.ts).

| file | what |
|---|---|
| `common/stock.ts` | `GET /api/city/stock` types + cache, `stockOf/goodsOf/standsOf`, the site's purchase rules (`offerOf`, `buyReq`, `sampleOffer`: coins only since 08.11 — «сейчас не купить» without `cs`, thief ×k, foreign town / «край» ×k and lock, quantity `n`, lv3 `shopView`, materials via /api/buymat, tent samples bought for coins as `look-<booth>-<id>` (`lookItem`), owned ones → /api/wear) |
| `common/kit.ts` | `RoomKit`: static batch (world `Batch`, ~10 draw calls), prop-kit parts baked in, shells (cutaway entrance wall + vestibule for the TP camera), windows, lanterns, signs, exit door (one-sided hit plane), collision solids (`free/groundAt/solidTop`), camera colliders, prioritised lights (`light(…, prio)`: the quality cap keeps the highest priorities), `splash()` fake light pools (one additive draw call) |
| `common/decor.ts` | set dressing baked into the batch: bunting, string lights, baskets, sacks, plants, candles, wall lamps (+ light pools), cloths, paintings, hanging herbs, stools, books, mugs, rugs, braziers, wall shelves |
| `common/items.ts` | item models: registry (`itemModels`) first for gear keys, local models otherwise (avatar weapon/shield/hat parts, armour mannequins, charms, potions, food by name, star/sphere); `bakeModels` merges all goods into one toon mesh + outline and keeps per-good vertex ranges |
| `common/tags.ts` | price tags: one canvas atlas + one mesh; coins drawn as coin discs (money rule of ui/money.ts), points, lock; `hot` = highlighted |
| `common/hits.ts` | `separateBoxes` (hit volumes never overlap), `pickBox` |
| `common/card.ts` | DOM buy card (Shadow DOM + ui CSS, `ui/card.ts` cardHtml: stats, comparison with equipped, desc, class) + price + «Купить…» → «Купить «X» за Y? Да / Нет» → `actions.post` exactly like the site; bound to its item |
| `common/npc.ts` | NPC avatar (src/avatar) with greeting/idle lines (speech bubble sprite), turns to the player, emotes |
| `common/base.ts` | `RoomBase` (goods, interactables, highlight, fog/background swap, lights) and `envFromCtx(ctx)` |
| `shop/*` | forge + magic (stands per class like the site), rows (food shelves, potions on the counter), tent (booths with mannequins wearing your look + the sample) |
| `hybrid/*` | interiors + NPC + `ctx.showSitePanel({side})` on entering and on the NPC/desk interactable |
| `hybrid/anvil.ts` | the smith is driven by the site's REAL enchant run: `hookSiteForge` wraps `window.LGCity.forgeStart/forgeFx/forgeCancel` while the anvil room is open (site first, then 3D; restored on dispose) → `AnvilFx`: item on the anvil, 2–5 blows like the site, sparks / flash / glow, result burst «+N», smoke «Сломалось», «Цела» / «−1» |

**Third person in small rooms.** The entrance wall is drawn one-sided (from inside only) and the room continues for
`VESTIBULE` m behind it (floor, side walls, ceiling, a lamp, a barrel and a plant). The TP spring arm may back out
through the entrance wall, so right after walking in (back to the door) the hero stays in frame instead of the camera
collapsing into first person. The exit's hit plane faces the room only (never aimed from the vestibule) and has no
generic highlight frame. The tent's canvas is one-sided too, with a lit lawn around it. Tests: `test/rooms-scenes.test.ts`.

Buying can never hit the wrong item: goods are aim-only (`proximity: false`), hit boxes are separated
(`separateBoxes`), exactly one good is highlighted (golden shell + rim over its own vertices, its tag lights up), the
prompt names it («Купить: X — price», alt «Осмотреть»), and the card sends the id/price of the item it was opened for.

Dev: `npm run build`, open `dist-dev/rooms.html?room=forge&stats=1` (`?aim=N&card=1[&inspect=1]`, `?cs=0`, `?ms=0`,
`?money=N`, `?fail=1`, `?q=0..3`, `?cam=x,y,z&look=x,y,z`, `?tp=1` third person with the game's arm, `?yaw=&pitch=&at=x,z`,
anvil: `?forge=up|broken|down|fail[&tg=N]` or `__rooms.fakeForge('up', 5)`, `?step=0.05` fixed time step + `__rooms.waitFrames(n)` /
`__rooms.pause(true)` for deterministic animation shots). Fake actions only — nothing reaches the site.
Tests: `npx vitest run test/rooms.test.ts test/rooms-scenes.test.ts test/rooms-anvil.test.ts`.
