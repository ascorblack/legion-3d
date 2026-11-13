# How the site works (reverse-engineering notes)

All facts below were observed on `play.multidonate.ru` on 2026-10-26. The site is updated almost daily,
so the extension must treat every internal API as unstable and degrade gracefully.

## Page
- Per-channel SPA: `https://play.multidonate.ru/c/<channel>/`. `window.LG_BASE = "/c/<channel>"`.
  The page wraps `window.fetch` so that `fetch('/api/…')` is prefixed with `LG_BASE`.
- **Anti-bot telemetry (mine.js `tele()` → `tlPi()`, sent with every «Копать»; 30.10).** Bit 1 of `pi`: `window.fetch` is neither native
  (`Function.prototype.toString` ends with `[native code]`) nor the site's own wrapper — the `<head>` script publishes
  `window.LG_FETCH = {w: wrapper, n: was the function under it native}` and the check is `window.fetch === LG_FETCH.w && LG_FETCH.n`.
  Bit 2: `requestAnimationFrame` not native. Bit 4: `LGMine.open/onEvent`, `LGMineBiome.own()` replaced. The site says it only adds to the
  streamer's bot score (no penalty), but an honest player must not look like a bot, so: **the extension never sits on `window.fetch`
  in the classic site.** The fetch tee (bridge.ts `fetchTee`) is put on by main.ts when 3D boots, and taken out again — restoring
  exactly the site's wrapper — on F8 / classic, on a failed boot, and while the site's own mine screen (`.mn`) is open. It is never
  installed at document_start: the site's wrapper would capture it as «the function under it» and `LG_FETCH.n` would stay false for the
  whole page load. The 3D mine uses our own client and never runs `tele()`. We do not touch `requestAnimationFrame` or `LGMine`.
  `EventSource` and `WebSocket` are replaced by the bridge (the live feed has no other source without a second connection); the telemetry
  does not look at them (13.11 `tlPi` still checks `fetch` and `requestAnimationFrame` only).
  Test: `test/fetch-telemetry.test.ts`, `e2e/fetch-tee.mjs`; refresh `test/fixtures/site-telemetry.js` when `tlPi` changes.
- **F8 inside the mine (31.10, src/net/site-mine.ts, src/features/mine-hold.ts).** Opening the site's mine puts the City to sleep
  (`LGCity.sleep()`: city leave, `LGCity.debug()` = null); its «В город» (`LGMine.exit()`) leaves the mine and wakes the City (city
  enter); a City tab click while the mine is open wakes the City under it. One mine presence per page tab key: the client that entered
  last owns it, the other shows `.mn-other` «Шахта открыта в другой вкладке» / «Копать здесь». The site's mine can only be opened from
  the live City (`LGCity.panel('mine')`). So the extension keeps the site's mine open, hidden (`html.l3d-mnhold`, plus a hidden
  `.mn-board-w` sentinel so its Esc handler does not close it), while the 3D mine runs; F8 shows it again and presses its own «Копать
  здесь». Per switch: one mine enter (of whichever client takes over), no leave, no City request. The floor key the site's mine works
  on is read from resource timing entries of its `/api/mine/state?c=` polls. The fetch tee stays off while the site's mine is open at all.
- Strict CSP (`script-src 'self' 'nonce-…'`, `connect-src 'self'`). Extension content scripts are not
  subject to it; a MAIN-world content script declared in the manifest runs regardless.
- Tabs (`<nav class="tabs">`, `button[data-tab]`): `quest` (Поход), `hero` (Персонаж), `city` (Город),
  `legion` (rating), `news`, `world` (Карта мира), `streamer`. Sections: `#tab-<id>`.
- Scripts expose globals: `MDDoodle` (character art, styles, `CATALOG`, `defaultsFor(seed)`, `jDoodle`,
  `gearOf(items)`, `location('fair')`), `LGGameData` (classes, rarities, slots), `LGInventory`,
  `LGCityMap` (UMD, also loadable in Node), `LGCityArt`, `LGCity`, `LGChat`, `LGMine`, `LGQuest`,
  `LGTownGen` (district towns), `LGSiteUi`.
- City files are lazy-loaded on first open of the City tab (`cityfair.js`, `citymap.js`, `cityart.js`,
  `citygl.js` (Pixi), `itemgrid.js`, `site-chat.js`, `citystore.js`, the building windows, `city.js`).
- **Building windows (31.10).** The windows of the City's buildings are separate files: `/site/cityshop.js` (the shared shop code:
  `STOCK`, the buy card `buyAsk`, `stockOf / goodsOf / coinsFor / lockedHere`, `/api/city/stock`, `/api/cityBuy`, `/api/buymat` →
  `window.LGCityShop(C)`) and one `/site/b-<id>.js` per id of the page data `LG_CITYV.bl` (`forge tent shop magic hall board trainer`,
  version `LG_CITYV.bw`; `b-board.js` has the board reading overlay `.cy-read`, `b-hall.js` `/api/mine/hall` + `/api/mineHall`) →
  `window.LGCityBuildings[id](C, SH)`; `/site/citystore.js` is the Storage window. app.js builds the paths from the list, so
  `scripts/drift.mjs` reads `LG_CITYV` from the page (`cityModuleUrls`). Behaviour unchanged; `LGCity.panel(id)` still opens them.
- **Jail (30.10, flag legionary.jailPublic).** `/api/me` top level `jail = {reason, until, untilText}` (this hero is a prisoner) and
  `jl` (the jail is open for this viewer); `GET /api/jail` → `{ok, list:[{l,n,lv,lk,g,gh,aw,u}], n, staff?, why?}`, SSE `jail` (same).
  citymap.js `LOW.jail {x0,x1,top,base,c0,c1,ct,back,fy,door,seats[8],walk,move}` — 31.10 beyond the canal by the lower fence
  (30.10: against the retaining wall; no top/ct/back/walk then), `lowJail()` (31.10 moves decor only: the barrel from the cage's
  place right of the bridge, the crate at the house's corner left), `JAIL_OBST` (house and cage solid from `back` to the base),
  `jailWalk(x, y)` (nearest point of `walk`), building `{id:'jail', jail:true}` (not enterable; hit `[x0, c1, ct − 56, fy]`, door
  in front of the house by the fence). city.js: prisoners sit on the seats (own hero first),
  «+N» over the cage, `LGCity.jailOpen()` = the Jail window `.cy-jw` (list, terms; reason only for staff). A prisoner: only the City tab
  (app.js `tab()` forces it; `html.jailed` hides the rest), the `.jail-bar` status (reason, term), no buildings and no «E — войти»;
  31.10 he walks on the cage floor (`walk`: click → jailGo, WASD → kwStep) only on his own screen — the steps are not sent (the
  server answers 403 jailed; the others see him seated), reseated only when off that floor;
  always on the fair. 3D: src/world/jail.ts, src/net/jail.ts, src/features/jail.ts.
- **31.10 afternoon.** mine.js `take()` runs `follow3` before the floor is stored and drawn (entering from the City showed the
  deepest floor for a moment, then the hero's own floor) — ours: `followOnEnter` in src/rooms/mine/fund.ts right after the enter.
  mine3.js: the sack on the «СКУПКА» counter is smaller and the plaque moved right of it (our 3D buyer has its sign on the
  awning, no sack on it). app.js / inventory.js `feat/candy-tile`: the Halloween candies (`hero.hw.c`) are a «не вещь» tile after
  the items of the bag (`data.pins`; filter «Все»; no place taken, no actions, «9999+», hint on hover / tap) instead of the counter
  next to «Монеты» — ours: `candyCellHtml` in the bag (src/ui/card.ts).
- **07.11 afternoon.** `/site/guildhall.js` (soft script of the City tab, css `guildhall.css`): `LGGuildDistrict` (UMD: CAP 100 houses,
  TIER_MAX 5 = guild level, UNLOCK house izba/stone/tower · roof · street path/pave · banner, DECOR lamps 2 / flowers 3 / benches 3 / well 4 /
  flags 5, `layout({n, tier, opts, biome, seed, name})` → a Town Kit input T `guild-district` (rows of member houses on both sides of an avenue,
  «Главное здание» `ghall` + plaza on top, «Ворота» `gate` at the bottom), `LGGuildDistrictArt` (tk-art houses / hall / flags) and
  `LGGuildHall` (open/close/pick/index/debug). GET `/api/guildhall` (index: `{ok, mine, guilds}`; 409 `unavailable` «недоступен в этом сезоне»
  for us on 07.11) → a `.gd-entry` «🏰 Гильдейский район» button in the City HUD `.cy-hud`; open(gid) appends a full-screen `.gd-root` (Pixi,
  own WASD/E/Esc on window, `html.gd-full`), puts the City to sleep (`LGCity.sleep`, city leave) and wakes it on «В город». Presence:
  POST `/api/guildhall/act {op:'here', guild, x, y}` every 3 s (`leave`, `hall`, `house`, `myHouse`, `opt`, `moveStay/moveLeave`). Not a quarter
  of a town and not a hall interior: a place of its own. 3D: overlay 'district' (src/net/site.ts DISTRICT) + pause entry (src/features/site-places.ts).
  `/site/playerstart.js` (hero `ps`): «Старт игрока» goals box at the top of `#tab-hero` — no overlay, no keys. Tabs `war` (warcmd.js, ME.cw, SSE
  `war` / `wa` + a `.wa-bar` siege alert) and `season` (season.js, ME.ss) — 404 for us. city.js `.cy-fro` eye button (hero `fo`) = «Только друзей»
  (S.onlyFr, localStorage `lgCityFr`, LGFriends.friends()). quest.js: arena nets `M.nets`, wings `g.wings {z, need, got}` (HPG10), hunters (adds
  with count 0), the wolf's bite `g.bite`, `M.tgn`, `g.wc` (HPG1), dungeon summary `dgn.sum`; app.js `questFormFill`: `b.form` only when it changes
  (key `b.fk`). b-hall.js `r.hall.w`: a district town's own treasury (alliance contributions; Mayor, managing guild head, streamer), no hall store.
  app.js: «Выбросить» (hero `ht`, INV.trashAsk). Our follow-ups: .local/drift1107/FINDINGS.md.
- **Single chat (30.10).** app.js `oneIsOn = hero.c1 && (hero.cc || hero.mc) && LGChatOne`: then LGDm never shows its own window; its
  `open()` asks the single chat to show «Личные» (and waits for it) only while nobody listens on LGDm — our DM bridge does not listen then.
- **Camp (30.10 E2).** campmap.js moved to the «Пролог» module (same URL, same API). city.js `homePick(hm) = {id: hm.id}`: the server
  puts `'camp'` into `hm.id` for a channel in the Prologue; `hm.camp` no longer keeps fair/camp open next to a district `hm.id`.
- **Coins only, «Рябинень», one mine (08.11 afternoon).** cityshop.js: no more channel-points prices — a hero without `cs` sees
  «сейчас не купить · Покупки в «Городе» тебе пока закрыты» with the good's coin price (`+it.coins`, else «Пока не продаётся»);
  `can = !!h && (it.mat ? h.ef && c : csOn() && c > 0)` (looks included); «Да» sends `/api/cityBuy {item, price, n?, town?}` (`n` = the
  quantity, hero `bq`). b-tent.js: booth samples are bought for coins — `buyAsk({id: 'look-<booth>-<sample id without #>', name, coins:
  booth.price, look: true, pos})`; owned ones are still worn with `/api/wear`. `lockedHere` spares the squad's «край» (`homeHere`);
  `shopView` filters a lv3 district town's goods by building level (`LGTownGen.goodsOk`). city.js: `hm.none` = the channel has no city yet
  (homePick → null), `fairGone` → `homeAway`, `homeBack()` = where a closed town sends you (the channel city or the open camp); with nowhere
  to go the City is shut down: `#tab-city .cy-err.cy-shut` with `NO_CITY`. The old fair is called «Рябинень» («Ярмарочный Край»; picker row
  only when `T.fair`, reason `T.fw`). Every town's mine door opens the channel's one mine `home` (MINE_FROM brings you back to the town).
  quest.js `hero.q2`: «отступаем» in a corner block `.q-pbc`, say history ↑/↓ (localStorage `lgQSayH:<ch>`), the say box under `.ql-r1`,
  «ты примерно тут» for a hero in reserve. worldmap.js: squads of all channels (`d.sq`), the travel route (`d.route`). Our follow-ups:
  .local/drift1108b/FINDINGS.md.
- **09–10.11.** app.js «Игра» mode (hero `gu` && `cy`, not jailed; `window.LGGameUi {on, win, close, open}`): the City tab is the game
  screen (button «Игра»), app.js draws its HUD `#gu-hud` (fixed, z 5 — under our canvas) with «Герой / Гильдия / Арена / Почта / Поход»,
  a mini-map, «Рейтинг», «Задания дня»; the tabs `hero legion season war arena` (GU_WIN) open via `guTab` as WINDOWS over the live City
  (`#tab-<id>.on.gu-win`, role="dialog", aria-modal, z 28, bar `#gu-wbar`). 3D: actions.openSitePanel opens those through
  LGGameUi.win without the classic switch (src/net/gameui.ts); replayCityEnter never clicks one of them (no City leave/enter would follow).
  New lazy modules (every window is a site dialog — the 3D yields): mail.js (`window.LGMail` in app.js: `on()` from GET /api/mail/count,
  `unread()`, event `lgmail`, SSE `mail`; window `.ml-win`), dailies.js (hero `dl`, a `<dialog>` via showModal, a `.dl-bar` in `#tab-hero`;
  403 «пока недоступны» for us), arena.js (ME `ar`, tab `arena`, `/api/arena*`), minimap.js (`window.LegionMiniMap` in app.js, `.lmm` z 900:
  map / season / rating), guilds.js (`LGGuilds`, a `.cy-hud .gl-entry` button once GET /api/guilds is ok; 409 «недоступны в этом сезоне» for
  us) with guildraid.js / guildrun.js (dialogs `.grd` / `.gr`) and emblems.js (art), craft.js (`LGCraft.hub`, hero `cr`), fish2.js «Рыбалка»:
  hero `cr.fish.f2.on` (`window.LGFish2On / LGOpenFish2`), a 2D canvas mini-game `.f2` (role dialog, z 9000) over the sleeping City
  (`LGCity.sleep` / `wake`), reached in city.js by a click on the water (`fishWater`: the cats fair's POND off the PIER, the old fair's canal
  between the bridges ± 20 px; never camp / district / Town Kit / jail) and from the mine's «Ремёсла». POST `/api/craftF2 {k: 'fish', a: view |
  cast {force} | fight {castId, inputs, hookT} | cat | sell | fry | gift | chest | upgrade}`; the fight is simulated by the client (`LGFish2Sim`,
  UMD, deterministic) and its inputs are sent. 3D: E at that water (src/features/fishing.ts), overlay 'fish'. `.lg-maint` (alertdialog,
  aria-modal) «Технические работы». city.js: the position is also kept on the server (GET `/api/city/pos`, `[x, y, at]` in lgCityPos) — on wake /
  tab return it may move the hero or switch to the newer town (`srvGo`); a new Esc handler (`escPlan`: blur a field → close a site window →
  close the building panel) — our key shield / preventDefault keeps it off our keys; `LGCity.here / show / showSet`. Walkers carry a guild tag
  `gt` (labOf; citygl.js nameTex «[tag]», 5 chars) — ours: Appearance.guild on the nameplate. site-chat.js: guild chat tab `gl` (hero `gch`,
  `/api/guilds/chat|say`, no bubbles), mute appeals (`/api/appeal`); app.js jail appeal button in `.jail-bar`. «Лавка звездочёта» → «Лавка
  чародея», fair signposts «ЧАРОДЕЙ» / «ТРЕНЕР» (same drawing). b-hall.js «Взнос монетами» (hero `hc`). auction.js: no minimum price, «после
  первого похода» (hero `aq`). The tab scripts are served only with a session cookie now: `L3D_COOKIES=… npm run drift`.
  Our follow-ups: .local/drift1110/FINDINGS.md.
- **12.11 night.** guildhall.js rewritten: the 07.11 guild district (`LGGuildDistrict`, `LGGuildDistrictArt`, `.gd-entry`, `.gd-root`,
  `LGGuildHall.pick`) is gone. Now `LGGuildHallMap` (UMD: W 3840 × H 3240 interior — wall WALL_Y 420, dais DAIS_Y 1180 + steps
  STEP_Y 1360, carpet, 4 columns, OBJ desk «Стойка» / chest «Казна» / rgate «Ворота похода» / board «Доска заданий» / trophy …, decor by
  the guild tier, FLOOR, SPAWN, `spec(level)` → a Town Kit map), `LGGuildHallArt` (draw / colorOf / crest, Town Kit art + citygl.js) and
  `LGGuildHall` { on, enter, close, index, open (= enter), debug, obj, act, screen, cam, place, stats, busy }. GET `/api/guildhall`
  (index, cached 60 s, 10 min when closed / unavailable; 409 `{unavailable}` «Здания гильдий нет в этом сезоне» for us), POST
  `/api/guildhall/act`. Entered: (1) the cats fair's new building `guild` «Здание гильдий» (fc-map.js: sign ГИЛЬДИИ, roof plum, lv 1,
  drawn by tk-art.js guildHall lv 3; it replaced the blue house h3, path h3 → guild) — city.js goBuilding / openPanel('guild') →
  ghOpen() → LGGuildHall.enter(); soonB: «скоро» while ghOn() === false; (2) any town without that building: `.cy-hud .gh-entry`
  «🏰 Здание гильдии» (entryTick, LGCity.hasB). enter(): not ok → toast «Здание гильдий скоро откроется» (closed / unavailable); ok without
  a guild → `.gh-modal.gh-noguild` (role dialog) with «Гильдии альянса» → LGGuilds.pick(); else `.gh-root` (fixed z 900, html.gh-full,
  LGCity.sleep; own WASD / E / Esc). 3D: building model civic.ts buildGuild, E → LGCity.panel('guild'), overlay 'guildhall' / 'dialog',
  pause entry on `.gh-entry` (src/net/guildhall.ts). quest.js: boss scheme registry `window.LGQuestSchemes` (arena bad / safe / net,
  captions; g.bas basic moves) and «Курган-Сундук» `g.sk` (field 1–10, SK_SCHEMES) — src/quest/schemes.ts. app.js: announcements
  `me.an` / SSE `ann` in the «Игра» HUD (`.gu-an`, close → localStorage `lgAnnX`) — src/features/announce.ts; journal tab / kind
  «Гильдия»; email login (`me.el` / `me.em`). site-chat.js + site-ui.js: a mute asks a reason (`LGSiteUi.askReason`, `reason`
  in POST …/mod, «. Причина: …»). Our follow-ups: .local/drift1112/FINDINGS.md.
- **12.11 afternoon — «Монстры у стен» (citymon.js, soft module of the City tab).** `window.LGCityMonArt` { fig(id), IDS (28 art
  ids: boar / wolf / crow … e_boar / e_serpent, seven SVG families, `cm-ey` eyes / `cm-x` dead crosses) } and `window.LGCityMon`
  { tick, attackDlg, eliteDlg, fightDlg, lobbies, openCount, close, view }. Every 1.5 s tick(): only while `LGCity.wall()` answers
  ({ x, y = the gate door, own = the hero's own town, glade = fc-art GLADE on the cats fair, else null }) and the hero has `cm`
  (/api/me hero.cm {n, of, nx}). The view is the hero's OWN: GET `/api/citymon` (the site's own 60 s cache; reloaded when hero.cm.n
  changes or a pack is due back): `packs` [{ pid, tier 0–2, slot, idx, n, lvl, pack [{ mon, name, kind, hp, atk, def, lvl, hint }],
  power, reward }], `elites` [{ eid, epid, tier, slot, idx, n, lvl, name }], `soon` / `eSoon` [{ line, tier, at, slot, idx, n }],
  `daily` { n, max 10, left, next (05:00 МСК) }, `biome`, `hero` { level, busy, hp, max }, `myPower`, `respawnMin`, `now`. No SSE.
  draw(): placeAll() puts packs on the spots of their tier (sorted by distance from the glade centre; `idx` when the tier has as many
  spots as packs, else `slot`), elites on the 'e' spots, returning packs as paw trails «Вернутся через m:ss»; members at FORM offsets
  as `<button class="cmw" data-cm="pack" data-pid>` (elites `.cmw.el data-cm="elite" data-eid`) in `.cm-wall` inside the City camera,
  wandering in walkBox; `.cm-badge` «Монстры: N» in `.cy-hud` centres the camera on the nearest pack. A click → `.cm-dlg` (role dialog,
  aria-modal) «Напасть на монстров у стен?» → «Напасть» = POST `/api/citymon/act {op:'attack', pid}` → fightDlg: arena-field.js
  `LGArenaField.play()` (new, also the arena's field) inside the same dialog. Elites: guild groups (`op` ecreate / ejoin / estart /
  eleave / edisband / elist, GET `/api/citymon/fight?id=`). fc-map.js `GLADE` (x 2170–3590, y 3010…3420, poly, sign «В ПОХОД»
  (2742, 3112), 4 front trees) + `SPOTS` (13: t 0 ×2 at the gate in the glade, t 1 ×4 along the south wall, t 2 ×4 in the north
  forest, 'e' ×3 at the edges; each but the gate ones with its own clearing `poly`). The walk grid is unchanged: the glade is NOT
  walkable. 3D: src/net/citymon.ts (placeAll / FORM / walkBox ports, cityMonAct presses the site's `.cmw`), src/world/citymon-art.ts,
  src/features/citymon.ts, glade terrain src/world/faircats.ts fcGlade / gladeItems. tk-art.js guildHall lv 3 redrawn (tower + spire,
  portico) → civic.ts buildGuild. Our follow-ups: .local/drift1112b/FINDINGS.md.

## Auth / user
- Cookie `lsid` (httpOnly). `GET /api/me` → `{ ok, user:{login,name}, hero, roles, classes, ench, ql, now, … }`.
- `hero`: `login, name, level, xp, next, prevXp, xpInLevel, xpToNext, money (bronze), hpNow, stats{hp,atk,mag,def},
  xs{crit,critDmg,dodge,…}, role, roleName, ghost, deadUntil, items[], gear{w,wr,s,sr,a,ar,am,h,hr,t,tr}, look,
  wardrobe{cur,own}, soc{score,rank,rankName,icon,place,total}, sk (skills), ac (achievements), mn (mines),
  cy (city open), cc (city chat), qt (quest tab), tw (towns), ms (magic shop name), sg (storage)…`
- Item: `{ uid, id, name, slot: weapon|armor|shield|helmet|trinket|potion|food|scroll|relic|material, rarity,
  stats{}, role, gear: heavy|light|cloth, look{weapon|armor|shield|hat|charm}, effect, on (equipped), wearable,
  en (enchant level), dur? }`.

## Live channel (live link: WebSocket or SSE)
Since 13.11 app.js opens it through `/lib/site-live.js` `window.LGLiveLink.open({ sse, ws, onAuth, backoff, hold })`:
- **WebSocket first** — `ws()` gives `{ url: (wss|ws)://<host>/ws, ch: LG_CH.login, sm }` only when `hero.lw` is set, the hero is not
  in the cage and the page is not the streamer dock; otherwise SSE right away. Server `{op:'hello', user}` → the client sends
  `{op:'live', ch, sm?}` → `{op:'liveok'}`; then every event is ONE text frame `{"op":"ev","e":"<name>","d":<json>}` (same names and
  payloads as SSE). `liveerr` off / no_channel / forbidden → SSE for `T.noWsMs` (10 min); login_required / close 4001 → onAuth;
  `T.wsTries` (4) sockets that never open → SSE for 10 min.
- **SSE fallback** — `GET /api/live[?sm=1]`, named events; `T.sseErrs` (3) errors (or CLOSED) → reconnect with backoff
  (site-ui.js `LIVE_STEPS`, Retry-After `hold`).
- Polls (`/api/me`, `/api/city/state`, mine state, chats) run only when `window.LGPollOk()` (live link down for good: ≥ 3 failures or
  down > 20 s) and never during `LGSiteUi.hold.left()` (503 / 429), with `POLL_STEPS` 10 / 15 / 30 / 60 s backoff.
- The bridge taps both (src/bridge/bridge.ts): the bus gets `sse:<name>` either way and `live:kind` = 'ws' | 'sse'. For our account
  `hero.lw` is not set (13.11), so the site uses SSE. `node e2e/contract.mjs` prints `LIVE transport=… bus me=… city=…`.

Named events:
- `me` — full `{hero,…}` snapshot like `/api/me`.
- `city` — city batch: `a` (arrived: `[{l,n,lv,lk,g,aw,gh,x,y,tx,ty,dt}]`), `m` (moved: `[[l,fx,fy,tx,ty,dtMs]]`),
  `g` (gone: `[login]`), `n` (players count), `chat` (`[{id,s,l,n,t,at,c,cn,k?,ev?,to?}]`), `chatDel`, `c` (cursor),
  `tr…` (trade).
- `mine`, `j` (journal entry), `q` (quest view: `{on, dl (stream delay s), late[], now, …}`), `sm` (streamer).

## City API (POST JSON unless noted)
- `/api/city/enter {x,y,town}` → `{ok, me{x,y}, town, a[], n, max, chat[], c, tr}`
- `/api/city/go {x,y,fx,fy}` (client throttles to ≥300 ms; server answers "быстро/часто" when too fast)
- `/api/city/ping {}` every ~60 s, `/api/city/leave {}` (keepalive) on hide/close.
- `GET /api/city/state[?c=cursor]` — polling fallback without SSE.
- `/api/city/say {text, k?:'tr', to?}` — chat; `/api/city/chat/...` moderation.
- `GET /api/city/towns`, `GET /api/city/stock`, `/api/cityBuy`, storage `/api/stPut|stTake|…`.
- Hero: `/api/equip {uid}`, `/api/unequip {slot}`, `/api/use {uid}`, `/api/wear {field,value}`,
  `/api/enchant`, `/api/repair`, `GET /api/journal?tab=all`, `GET /api/legion`, `GET /api/news`, `GET /api/world`.
- Quest: `/api/qact`, `/api/qsay`, `/api/qvote`.

## City geometry (`LGCityMap`)
- Fair city: `W=5500, H=1980, QW=1800` (left quarter: Ратуша, Аукцион, Тренер, Доска; right: the channel-style fair
  3700 px: Заточка/Кузня/Ворота/Шатёр/Лавка звездочёта/Торговые ряды).
- Walkable area `AREA {x0:40,x1:5460,y0:800,y1:1900}`; y is *depth* (side-scroller). Upper strip y 800…1062 is the fair
  street in front of buildings; ledge `LOW.edge [1066,1124]` with stairs `LOW.stairs`; lower street down to 1900 with a
  canal `LOW.canal [1500,1594]` crossed by `LOW.bridges`; benches, flower beds, lamps, decor, a statue.
- Obstacles: `{e:[cx,cy,rx,ry]}` ellipse, `{b:[x0,y0,x1,y1]}` box, `{r:[x0,x1,y1]}` "from top of scene down to y1"
  (stalls), `water:true` for water. Walk grid 16 px with PAD 10.
- Buildings: `{id,title,sub,icon,hit:[x0,x1,y0,y1],door:{x,y},soon?,fair?,mine?,magic?}`.
- Movement speed `SPEED = 230` px/s; others are animated client-side along A* paths (`follow`, `stepAlong`).
- `LGCity` public API (used by the site's own tests): `open, close, sleep, wake, onEvent, go(x,y), goBuilding(id),
  panel(id), hideOthers(on), quality(lv), town(id), towns(), where(), debug(), peek()` (`peek().w` =
  `[[login,x,y,moving,cull,visible,alpha]]`).
- Building interiors are `.cy-room` (position:fixed, z-index 200) rendered by city.js `openPanel(id)`.
