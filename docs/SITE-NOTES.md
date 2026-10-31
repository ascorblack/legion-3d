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
  `EventSource` is replaced by the bridge (the live feed has no other source without a second connection); the telemetry does not look at it.
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
- **Single chat (30.10).** app.js `oneIsOn = hero.c1 && (hero.cc || hero.mc) && LGChatOne`: then LGDm never shows its own window; its
  `open()` asks the single chat to show «Личные» (and waits for it) only while nobody listens on LGDm — our DM bridge does not listen then.
- **Camp (30.10 E2).** campmap.js moved to the «Пролог» module (same URL, same API). city.js `homePick(hm) = {id: hm.id}`: the server
  puts `'camp'` into `hm.id` for a channel in the Prologue; `hm.camp` no longer keeps fair/camp open next to a district `hm.id`.

## Auth / user
- Cookie `lsid` (httpOnly). `GET /api/me` → `{ ok, user:{login,name}, hero, roles, classes, ench, ql, now, … }`.
- `hero`: `login, name, level, xp, next, prevXp, xpInLevel, xpToNext, money (bronze), hpNow, stats{hp,atk,mag,def},
  xs{crit,critDmg,dodge,…}, role, roleName, ghost, deadUntil, items[], gear{w,wr,s,sr,a,ar,am,h,hr,t,tr}, look,
  wardrobe{cur,own}, soc{score,rank,rankName,icon,place,total}, sk (skills), ac (achievements), mn (mines),
  cy (city open), cc (city chat), qt (quest tab), tw (towns), ms (magic shop name), sg (storage)…`
- Item: `{ uid, id, name, slot: weapon|armor|shield|helmet|trinket|potion|food|scroll|relic|material, rarity,
  stats{}, role, gear: heavy|light|cloth, look{weapon|armor|shield|hat|charm}, effect, on (equipped), wearable,
  en (enchant level), dur? }`.

## Live channel (SSE)
`GET /api/live` (EventSource opened by app.js). Named events:
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
