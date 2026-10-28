# Legion 3D — Game Design Spec

Status: v1 (2026-10-26). Audience: module owners (`engine`, `world`, `avatar`, `ui`, `quest`, `net`, leader).
Sources: `.local/site/app.js`, `city.js`, `quest.js`, `citymap.js`, `game-data.js`, `site-ui.js`, `doodle.js`, `style.css`,
`test/fixtures/me.json`. Facts marked **[site]** were read in the code; **[assume]** = our decision or a guess, verify when wiring.
UI strings are Russian; everything else English. "MVP" = first playable release; "Later" = after MVP.

---

## 0. Pillars

1. **The world comes first.** On load you stand in the 3D city at the fair gate. Every site feature is a place, a hotkey
   or a menu tab — never "go back to the website".
2. **The site stays in charge.** All rules, prices, rolls and timers belong to the server and the site's own JS. We render
   and send the same requests the site sends; we never invent game rules or automate players (see §6.6 "fair play").
3. **Native when cheap, classic frame when not.** Each feature is either *native* (our own UI from the hero JSON) or *classic*
   (the original site section shown inside an in-game frame, §2.3). Classic is the fallback for everything, so nothing is
   ever unreachable, even if the site changed yesterday.
4. **Cute fantasy, not grimdark.** Dark-Souls/Skyrim *structure* (full-screen menus, item cards, orbit camera), the site's
   *mood* (round shapes, warm honey and plum, soft shadows, emoji icons, cat words in the cats style).

---

## 1. Feature map

Legend for "Reach": 🏛 world object (walk up + `E`), ⌨ hotkey, 📋 menu tab, 🖼 classic frame, 🧭 HUD widget.
"Impl": N = native UI, C = classic frame (site DOM), S = the site's own interior (`LGCity.panel(id)`, `.cy-room` over the canvas).

### 1.1 «Персонаж» tab (app.js `renderHero`, views `data-view=gear|look|skills|ach|log`) [site]

| Site feature | Hero fields | Reach in game | Impl | MVP |
|---|---|---|---|---|
| Doll: worn gear by slot | `items[].on`, `items[].slot`, `gear`, `gearPen` | ⌨ `C` / 📋 Снаряжение | N | MVP |
| Bag grid, filters (Всё/slots/Материалы/Особое/Расходники), class filter | `items[]` (`on:false`), `sg{cap,used,bs}` | ⌨ `I` / 📋 Сумка | N | MVP |
| Item card: stats, compare, effect, aura, enchant, durability, lore | item fields, `ench`, `xs` | tooltip + detail pane | N | MVP |
| Equip / Replace / Unequip | `POST /api/equip {uid}`, `/api/unequip {slot}` | button, double-click, drag to doll | N | MVP |
| Eat / Drink (cooldown) | `POST /api/use {uid}`, `eatUntil`, `scrollUntil` | button, quick-use | N | MVP |
| Repair one / all | `POST /api/repair {uid}` / `{all:true}` | item card / Снаряжение footer | N | Later (C in MVP) |
| Enchant (Заточка) window | `/api/enchant {uid,way,seal?}`, `/api/craft {lvl}`, `/api/buymat {mat}`, `ef` flag | 🏛 Заточка (anvil) | S | MVP via S |
| Bag sort / custom order | `/api/stSort {box:'b'}`, `/api/stOrder {uids}` | Сумка "⇅ Разложить" | N (sort), Later (drag order) | MVP sort |
| Stats HP/XP/level/atk/mag/def | `level, xp, next, prevXp, xpInLevel, xpToNext, hpNow, stats` | HUD + 📋 Характеристики | N | MVP |
| Second-row stats (crit…) | `xs{crit,critDmg,dodge,pierce,healPow,luck,resist,critX}` | 📋 Характеристики | N | MVP |
| Money, debt | `money`, `debt` | HUD + Характеристики | N | MVP |
| Social rating chip → rating | `soc{score,rank,rankName,icon,place,total,bad}` | HUD chip + 📋 Характеристики → 📋 Рейтинг | N | MVP |
| Ghost note, revive countdown | `ghost`, `deadUntil` | HUD banner + Характеристики | N | MVP |
| "Battle on stream — no re-dress" | `busy` | lock icon on doll, disabled buttons | N | MVP |
| Pending (streamer's game offline) | `pending` | toast after 6 s (as site) | N | MVP |
| Облик (wardrobe) | `wardrobe{cur,own}`, `POST /api/wear {field,value}` | ⌨ `O` / 📋 Облик | N | Later (C in MVP) |
| Навыки (skill trees) | `sk` (`md,c,m,t,rp,rs,lv`) — rendered by `window.LGSkills` | ⌨ `K` / 📋 Навыки, 🏛 Тренер | C (MVP), N later | MVP via C |
| Достижения | `ac` (null = closed) — `window.LGAch` | ⌨ `Y` / 📋 Достижения | C (MVP), N later | MVP via C |
| Журнал (full) | `GET /api/journal?tab=<all|fight|shop|find|coins|ach>` → `{ok,list[{id,at,k,t,r,c,x}],next,items}`; live SSE `j` | ⌨ `J` / 📋 Журнал | N | MVP |
| Viewer badges (awards) | `aw[{id,n,d,i,t}]` | nameplate badge + Характеристики | N | Later |

### 1.2 «Город» (city.js, citymap.js buildings) [site]

All buildings: walk to `door`, prompt `E — <title>`, `E` → `actions.openBuilding(id)` → `LGCity.panel(id)` (site interior `S`).
Also reachable from the **Map** (⌨ `M`, "Город" sub-tab) via "Идти" = auto-walk (`PlayerController.walkTo(door)`).

| id | Title / sub | What inside (site) | MVP |
|---|---|---|---|
| `hall` | Ратуша · оборона города | city treasury, `/api/mine/hall` | S, MVP |
| `auction` | Аукцион · торговля между игроками | `LGAuction` (flag `au`) | S, MVP |
| `trainer` | Тренер · дерево навыков | `LGSkills` tree | S, MVP |
| `board` | Доска объявлений · новости игры | `/api/news` | S, MVP |
| `mine` | Шахта · промысел города | own location `LGMine` (`/api/mine/*`) | S (2D mine full-screen), MVP; 3D mine = Later |
| `mineboard` | Итоги шахты | overlay | S, MVP |
| `storage` | Склад · хранение вещей | `/api/stPut|stTake|stPutAll|stTakeAll|stSort|stExpand` (flag `sg`) | S, MVP |
| `anvil` | Заточка · наковальня у Кузни | enchant scene | S, MVP |
| `forge` | Кузня · лавка кузнеца | shop, repair | S, MVP |
| `gate` | Ворота · в поход — только на стриме | text; during expedition → opens Quest HUD | S + 🧭, MVP |
| `tent` | Шатёр · облик | wardrobe shop (`/api/tentShop`) | S, MVP |
| `shop` | Лавка · еда, зелья, материалы | `/api/cityBuy` | S, MVP |
| `magic` | Лавка звездочёта (`ms` = local name, e.g. «Мурчародейня») | staffs, robes, amulets | S, MVP |
| `soon:true` buildings | "строится" | prompt shows «Скоро откроется», no `E` | MVP |

Other city features:

| Feature | Reach | Impl | MVP |
|---|---|---|---|
| City chat (tabs, DMs, ignore, mod menu) | ⌨ `Enter`/`T`, HUD chat box | N (send/read) + "⋯" → C (site chat panel for moderation, DMs) | MVP |
| Chat bubbles over heads | world | N | MVP |
| Other players, online count `n`/`max` | world + HUD counter | N | MVP |
| Player card (look at player + `E`): name, level, class, badges; "Написать лично", "Обмен" | 🏛 player | N card; actions → C (site chat/trade `LGTrade.menu`) | Later |
| Trade between players (`tr…` events, `LGTrade`) | player card / incoming toast | S/C | Later |
| District towns (`GET /api/city/towns`, `LGCity.town(id)`, flag `tw`) | 📋 Карта → «Города» list, 🏛 gate sign-post | N list → reload layout | Later (C in MVP) |

### 1.3 Other site tabs

| Tab | Content [site] | Reach | Impl | MVP |
|---|---|---|---|---|
| `quest` Поход | expedition view (`q` SSE) | 🧭 Quest HUD (auto), ⌨ `Q` expand, 🏛 Ворота | N (HUD) + C (full tab) | MVP |
| `legion` Легион (рейтинг) → «Состав» | `GET /api/legion` → `{ok,total{heroes,avgLevel,ghosts},groups,roster,roles,ranks,top,me,near,at}` | ⌨ `R` / 📋 Рейтинг | C (MVP), N later | MVP via C |
| `legion` → «Соц. рейтинг» | `GET /api/soc` | 📋 Рейтинг → sub-tab | C (MVP) | MVP via C |
| `news` Новости | `window.LGNews.open()` | ⌨ `N` / 📋 Новости, 🏛 Доска | C | MVP |
| `world` Карта мира (flag `wt`) | `window.LGWorld.open(el, WX)` | ⌨ `M` / 📋 Карта мира | C | MVP |
| `streamer` | streamer console | **excluded** — use classic site (`F8`) | — | — |
| Login / user menu / channel switcher | `LG_LOGIN`, `/api/channels` | Pause menu | N (login), C (channel switch) | MVP login |
| "Отправить баг" (site bug form) | site | Pause menu → C | Later |

---

## 2. Screens, modes and layering

### 2.1 Game states

| State | Gameplay input | Camera | Pointer lock |
|---|---|---|---|
| `play` | on | FP or TP | locked (after first click) |
| `chat` (typing) | off (only Enter/Esc) | unchanged, player stops | released |
| `menu:<tab>` (Character / world screens) | off | `orbit` for Снаряжение/Облик/Сумка, frozen for others | released |
| `room` (site interior `.cy-room` open) | off | frozen, world paused at 15 fps (keep-alive) | released |
| `classic-frame` (site tab in frame) | off | frozen, render paused | released |
| `pause` (Esc menu) | off | slow idle drift | released |
| `classic-site` (`F8`) | 3D engine paused (`engine.pause(true)`) | — | — |

Z-order (bottom→top): canvas → world labels → HUD → Quest HUD → menus/frames → site `.cy-room` (z 200, keep above our menus by
giving our menu layer z 150) → toasts (z 300) → modal confirm (z 310).

### 2.2 Transitions
- Menu open: fade-in 160 ms; camera to orbit 450 ms ease-out (`cubic-bezier(.2,.8,.2,1)`, the site's `--ease`).
- Menu close: camera returns to the previous mode (FP/TP) with the previous yaw; pointer lock is requested again on the next
  click on the canvas (browsers forbid re-locking without a gesture; show hint «Кликни, чтобы вернуться в игру»).
- Room (`E` on a door): the player auto-faces the door, a 250 ms vignette, then `LGCity.panel(id)`. Closing the room (site
  «Выйти» button or `Esc`) → back to `play`, the player is placed 1 m in front of the door, facing away from it.

### 2.3 Classic frame (fallback for everything)
A centred panel (`min(1180px, 94vw) × min(860px, 90vh)`) with our ornamental frame, title bar «<Section> · классический вид»,
close `✕` (Esc). The site's own `#tab-<id>` section is re-parented visually (CSS only: the leader/net module switches the site
tab with `.tabs button[data-tab=<id>]` click and positions `#tab-<id>` into the frame rectangle; we never clone DOM).
For views inside «Персонаж» (skills/ach/look) the adapter also clicks `[data-view=<view>]` in `#tab-hero`.
`actions.openSitePanel(tab)` accepts: `hero`, `hero:gear`, `hero:look`, `hero:skills`, `hero:ach`, `hero:log`, `legion`,
`legion:soc`, `news`, `world`, `quest`. **[assume]** — `openSitePanel` takes `tab:view`; leader to confirm in contracts.

---

## 3. Controls

### 3.1 Key map (gameplay state). Bind by `KeyboardEvent.code` (layout-independent: works on ЙЦУКЕН).

| Key | Action | Notes |
|---|---|---|
| `W A S D` / arrows | move / strafe | arrows also work for players who prefer them |
| Mouse | look (pointer lock) | click canvas to lock; sensitivity in Settings |
| `Shift` (hold) | run (×1.6 local speed) | **[assume]** the server accepts any target via `go` (it animates others at `SPEED=230 px/s`); we run locally, `net` still sends `go` ≤ 1 per 300 ms. Others see us walk — acceptable. If the server rejects run-speed hops, `net` clamps and run becomes walk |
| `Space` | small hop (cosmetic, local only) | others don't see it; no server call |
| `V` | toggle FP ⇄ TP | TP = behind, right shoulder (+0.45 m right, +0.35 m up, 3.2 m back) |
| Wheel | TP: zoom 1.6–7 m; FP: wheel-down (zoom out) → switches to TP at 1.6 m; TP at min + wheel-up → FP | |
| `RMB` (hold) | TP free-look orbit around the character (character keeps heading) | release → camera eases back behind |
| `LMB` | FP: swing held item (cosmetic `ViewModel.swing()`, combat); never opens doors, goods, stones or NPCs — that is `E` only | |
| `E` | interact: door / player card / sign | prompt shows what; nothing near → nothing |
| `Tab` | Character screen (last opened tab, default Снаряжение) | `preventDefault` only in `play` |
| `C` | Снаряжение | |
| `I` / `B` | Сумка | |
| `P` | Характеристики | |
| `K` | Навыки | |
| `Y` | Достижения | hidden when `hero.ac == null` |
| `J` | Журнал | |
| `O` | Облик | |
| `M` | Карта (Карта мира + Город + Города округов) | |
| `R` | Рейтинг Легиона | |
| `N` | Новости | |
| `Q` | Поход: expand/collapse Quest HUD; in TP/FP shows full quest panel | only when `quest.on` |
| `1`–`9` | during an active quest vote (and `party==='in'`): cast vote N (`/api/qvote`) — needs confirm-free single press, highlights choice | outside votes: unused (later: quick-use belt) |
| `Enter` / `T` | focus chat input | `/` focuses chat with `/` prefilled (site chat commands like `/mute`) |
| `Alt` (hold) | show cursor (temporary unlock) to click HUD buttons; release → relock if still in `play` | |
| `F` | emote «помахать» (local only) | Later |
| `F1` / `H` | help overlay (this key table) | |
| `F2` | hide/show HUD (screenshots) | |
| `F3` | perf overlay (`engine.stats()`) | |
| `F8` | toggle classic site ⇄ 3D | also a floating button on the site in classic mode «🎮 3D» |
| `Esc` | close topmost (tooltip → confirm → menu/frame/room → chat blur); nothing open → Pause menu | |

### 3.2 Inside menus
| Key | Action |
|---|---|
| `Q` / `E` or `[` / `]` | previous / next tab |
| Same hotkey as the open tab (`C` in Снаряжение) or `Tab` | close menu |
| Another tab hotkey | switch tab |
| Arrows | move selection in grids; `Enter` = primary action (Надеть/Снять/Съесть); `Delete` — none (no selling here) |
| `Shift` (hold) on hover | show comparison with equipped item even if no item is equipped in that slot (empty column) |
| Mouse drag in the 3D area (left/right of the panel) | rotate orbit camera; wheel = orbit distance |

### 3.3 Chat / typing safety rules (all modules)
- A key handler must first check `isTyping()`: active element is `INPUT|TEXTAREA|SELECT` or `isContentEditable` — **then no game
  key fires** (including inputs inside site interiors `.cy-room`, the site chat, quest command line). Only `Esc` (blur) and
  `Enter` (send, handled by the input itself) pass.
- While `room` / `classic-frame` is open only `Esc` and `F8` are global.
- Never bind `Ctrl/Cmd+…` (browser shortcuts), `F5`, `F11`, `F12`. `Tab` is swallowed only in `play`.
- Pointer-lock Esc: browsers consume the Esc that exits pointer lock. Rule: `pointerlockchange` → unlocked while state is `play`
  and the unlock was not ours → open Pause menu.
- Chat send = `actions.say(text)` (`/api/city/say`, `maxlength 200` like the site). Input clears on success, keeps text on error.

### 3.4 Mouse/gamepad
Gamepad: Later (left stick move, right stick look, A interact, Y character, Start pause). Touch/mobile: non-goal (§7).

---

## 4. Menu system

### 4.1 Structure
One full-screen **Game Menu** with two tab groups in the header ribbon:

```
 ┌─────────────────────────────────────────────────────────────────────────────────────────┐
 │ ❮Q  [Снаряжение] Сумка  Характеристики  Навыки  Достижения  Журнал  Облик │ Рейтинг  Новости  Карта  │ E❯ │
 └─────────────────────────────────────────────────────────────────────────────────────────┘
```
- **Персонаж** group: `gear` Снаряжение (C), `bag` Сумка (I), `stats` Характеристики (P), `skills` Навыки (K),
  `ach` Достижения (Y, only if `hero.ac`), `log` Журнал (J), `look` Облик (O).
- **Мир** group: `legion` Рейтинг Легиона (R), `news` Новости (N), `map` Карта (M).
- **Pause menu** (Esc) is separate: «Продолжить», «Персонаж», «Карта», «Поход» (if on), «Настройки», «Управление (F1)»,
  «Классический сайт (F8)», «Сменить канал» (C), «Выйти из аккаунта»? — no (site-owned; link to classic).
- **Settings** lives in the Pause menu (not a ribbon tab).
- Menu ids for `GameEvents['menu:open']`: `gear bag stats skills ach log look legion news map settings pause help quest`.
- Last tab is remembered in `localStorage['l3d.menuTab']`.

### 4.2 Снаряжение (gear) — orbit camera, character on the LEFT
```
 ┌──────────────── (3D world, orbit cam, character left third) ──────┬────────────────────────────┐
 │                                                                   │  Player1   Ур. 6           │
 │        [Шлем]                     ( 3D hero turning slowly )      │  Рогаточник · ⚠ −15% урон   │
 │ [Оружие]      [Щит]                                               │ ─────────────────────────── │
 │        [Доспех]                                                   │  Selected slot / item card │
 │        [Амулет]                                                   │  (see 4.10)                │
 │  slot ring floats over the 3D view, anchored to the body          │  [ Снять ]  [ Починить ]    │
 │                                                                   │ ─────────────────────────── │
 │                                                                   │  Fits this slot (from bag):│
 │                                                                   │  ▢▢▢▢▢▢ (filter = slot)    │
 └───────────────────────────────────────────────────────────────────┴────────────────────────────┘
   bottom bar:  💗 71/71  🐾 18  ✨ 3  🧶 11   ·  🟡 0 ⚪ 17 🟤 8   ·  ⇧ сравнить   Q/E вкладки   Esc закрыть
```
- Slots = `LGGameData.WEAR_SLOTS` order: `weapon` Оружие, `armor` Доспех, `shield` Щит, `helmet` Шлем, `trinket` Амулет [site].
  Equipped item = `items.find(x => x.on && x.slot === slot)`. Empty slot shows the slot silhouette + «пусто».
- Slot badge: rarity border colour, `+en`, durability badge (`dur`%, red ⚠ when `dur <= ench.rep.low` or `it.low`).
- Click a slot → right pane shows the item card + list of bag items with `slot === slot`, sorted by `deltas().score` desc,
  better ones marked with green ▲.
- Actions: «Снять» → `POST /api/unequip {slot}`; bag item «Надеть» (or «Заменить» when slot occupied) → `POST /api/equip {uid}`.
  Drag bag item onto slot = equip; drag slot item to the bag list = unequip.
- **Re-dress**: on success use `r.hero` (or next `me` SSE) → store `hero` → `Appearance.gear` from `hero.gear` → avatar
  `setAppearance` + `play('equip')` (0.6 s spin + sparkle) and the view-model updates. No optimistic re-dress: wait for `r.ok`
  (button shows «Секунду…», like the site).
- Locks: `ghost` → all buttons disabled, note «Призрак не переодевается — дождись воскрешения.»; `busy` → note «⚔ Идёт бой на
  стриме — снаряжение менять нельзя. Снять и надеть можно после боя» [site strings].
- `gearPen` (wrong armour class): red strip «⚠ Надеты вещи другого класса — дебафф −{pct}% {statName}» + parts list.
- Kit toggle «В бою / В мирное время» (site `kit` battle|peace): Later.
- Orbit: `setOrbitFraming({side:'left', distance: 2.6})`, auto-rotate 8°/s, stops while the user drags.

### 4.3 Сумка (bag) — orbit camera, character on the LEFT (smaller), grid on the right
```
 ┌───────── 3D hero ─────────┬──────────────────────────────────────────────┬─────────────────────┐
 │                           │ Сумка  23 / 40      [⇅ Разложить]            │  Item card (4.10)   │
 │                           │ [Всё][Оружие][Доспех][Щит][Шлем][Амулет]     │                     │
 │                           │ [Зелье][Еда][Свиток][Материалы][Особое]      │  [ Надеть ]         │
 │                           │ [Все классы][Рогаточник (ты)][Легионер]…     │  [ Съесть ] 2:41 ⏳ │
 │                           │ ▣▣▣▣▣▣▣▣                                     │                     │
 │                           │ ▣▣▣▣▣▣▢▢   (▢ = free cells up to sg.cap)     │  «На стриме: съесть 7»│
 └───────────────────────────┴──────────────────────────────────────────────┴─────────────────────┘
```
- Items: `items.filter(x => !x.on)`; stack identical non-wearables (same `id`, not wearable) as `×n` like site `bagList`.
- Cell: art (site item art if obtainable at runtime, else our icon per `slot`/`look`), rarity bottom bar, `no` (bag number —
  «Номер в сумке — для команд в чате»), `+en`, `dur`, cooldown clock if `eatUntil > now` (food/potion) or `scrollUntil` (revive
  scroll). Better-than-equipped wearable → green ▲.
- Filters: categories present only (site `catOf`: wearable → slot; `material` → Материалы; `relic` → Особое; else Расходники);
  class filter only when some wearable has a class (`role`/`gear`).
- Free cells: `sg.cap - sg.used` (max 60) dim cells when filter = Всё. Full bag → amber strip «Сумка полна (used / cap)…».
- Actions per item: wearable → «Надеть/Заменить» `/api/equip {uid}`; edible (food/potion with `effect` and not `effect.revive`)
  → «Съесть»/«Выпить» (`slot==='potion' || drink`) `/api/use {uid}`, disabled during cooldown with `m:ss`; revive scroll / other
  consumables → hint «На стриме напиши в чат: **свиток (или свиток @ник)**» (site `useCmd`); `relic` → «✦ Использовать пока нельзя
  — печать хранится в сумке.»; `material` → hint «Материал заточки… точить 3 сфера» + button «К наковальне» (walk to `anvil`).
- Sort: «⇅ Разложить» → `/api/stSort {box:'b'}` (only when `sg && !ghost && !busy`).
- Right-click on a cell → context menu: Надеть/Заменить/Снять, Съесть/Выпить, Починить (`dur`), Заточка (→ anvil), Подробнее.

### 4.4 Характеристики (stats) — no orbit (portrait 3D hero small, idle)
```
 ┌─────────────────────────────────────────────────────────────────────────────────┐
 │  [portrait]  Player1 ✦✦   «Рогаточник» · Ур. 6           🗡️ Боец · 213 · #50/16 753 │
 │  Опыт      ███████░░░░░░  307 / 540                                               │
 │  Здоровье  ██████████████ 71 / 71                                                 │
 │ ┌──────────────┬──────────────┬──────────────┬──────────────┐                    │
 │ │ 💗 Мур-ХП 71 │ 🐾 Царапки 18│ ✨ Мяу-магия 3│ 🧶 Пушистость 11│  (style labels)  │
 │ └──────────────┴──────────────┴──────────────┴──────────────┘                    │
 │  Шанс крита 9% · Сила крита ×1,5 · Уклонение 0% · Пробивание 0% · Сила лечения 0% │
 │  Удача 0 · Сопротивление 5                                                       │
 │  Монеты: 17 серебряных рыбок 8 чешуек        Долг: — (if debt>0, red)            │
 │  Последнее в журнале: 3 lines → «Весь журнал (J)»                                │
 └─────────────────────────────────────────────────────────────────────────────────┘
```
- XP within level [site]: if `xpInLevel != null` → `xin = xpInLevel`, `xneed = xpToNext` (null = «максимум»); else
  `xin = xp - prevXp`, `xneed = next - prevXp`. Bar % = xin/xneed.
- HP: `hpNow ?? stats.hp` of `stats.hp`. Low (<30 %) → bar pulses red.
- Stat labels: style labels from `MDDoodle.part('hero').stats[k].label` (cats: «💗 Мур-ХП», «🐾 Царапки», «✨ Мяу-магия»,
  «🧶 Пушистость»); fallback `Макс. здоровье / Физ. урон / Магия / Броня`. Hover a stat → help text (site `ST_HELP`/`XS_HELP`).
- `xs` row: labels from `LGGameData.xstats.label`; percent for `crit, critDmg, dodge, pierce, healPow`; decimal comma (`9,5%`).
  Show `xs` only if `hero.xs` exists.
- `gearPen`: strike-through full value + penalised value on the affected stat (site does `<s>full</s> now`).
- Social rating chip → opens Рейтинг tab on «Соц. рейтинг». `soc.bad` → red chip.
- Ghost: banner «Пал в Походе» + countdown `deadUntil` (`д hh:mm:ss`) «до воскрешения».

### 4.5 Навыки (skills)
MVP: classic frame `openSitePanel('hero:skills')` (the site's `LGSkills` tree, which already handles learning/reset).
Later native: tree per class from `sk.t`, points `sk.rp`, resets `sk.rs`, class mastery `sk.m[class] = [level, xp, need]`.
Hidden when `!hero.sk`. The Тренер building opens the same tree inside the site room.

### 4.6 Достижения (ach)
MVP: classic frame `hero:ach`. Tab hidden when `hero.ac == null` (closed for this hero). Later: native grid of medals.

### 4.7 Журнал (log) — native
```
 ┌──────────────────────────────────────────────────────────┐
 │ Журнал · 124 записи                                       │
 │ [Все][Бой][Покупки][Находки][Монеты][Достижения]          │
 │ 5 побед · 2 поражения · монеты 1 серебряная рыбка · +40 опыта │
 │ ── Сегодня ──────────────────────────────────────────    │
 │ 18:42  Бой      Победа над волками    победа  12 чешуек +8 опыта │
 │ …                                    [ Показать ещё ]     │
 └──────────────────────────────────────────────────────────┘
```
- `GET /api/journal?tab=<all|fight|shop|find|coins|ach>` → `{ok, list:[{id, at, k, t, r, c, x}], next, items}` [site]
  (`k` kind, `t` text, `r` win|lose|tie, `c` coins delta, `x` xp). Live: SSE `j` → prepend (dedupe by `id`, cap 300).
- Group by day; summary row as site (wins/losses for Бой, удачи/неудачи otherwise; coin sum; xp sum).
- Empty: «Журнал пуст. Сюда попадут бои, находки, новые вещи, покупки…». Error: «Журнал пока не загрузился. Обнови страницу чуть позже.»
- "Показать ещё" uses `next` (cursor) — **[assume]** pass `&at=<next>` as site `moreLog` does; verify.

### 4.8 Облик (look) — orbit camera, character CENTER-LEFT, close-up 1.8 m
MVP: classic frame `hero:look`. Later native: rows from site `LOOK_FIELDS`: `shape` Форма, `color` Цвет, `color2` Второй цвет,
`eyes` Глаза, `mouth` Рот, `blush` Румянец, `hat` Шапка, `aura` Аура, `acc` Аксессуары, `accColor`, `capeColor`.
Options = «по нику» (value `null`, defaults from `MDDoodle.defaultsFor(login)`) + owned `wardrobe.own[field]`. Click →
`POST /api/wear {field, value}` (acc: value = full new array). Live 3D preview on hover (local only), commit on click.
Disabled when `busy`. Footer: «Новое покупается в Шатре на Ярмарке; надевать можно в любой момент, кроме боя.»

### 4.9 World tabs
- **Рейтинг Легиона** (R): MVP classic `legion` / `legion:soc` with our sub-tab switch «Состав | Соц. рейтинг». Later native:
  `/api/legion` top + near-me rows; `/api/soc`.
- **Новости** (N): classic `news`. Later native list.
- **Карта** (M): sub-tabs «Город» (native MVP: top-down 2D plan from `CityLayout` — buildings with icons, me arrow, players dots;
  click building → «Идти» auto-walk / «Войти» if at door), «Карта мира» (classic `world`, only if `hero.wt`), «Города» (Later:
  `GET /api/city/towns`, «Перейти» → `LGCity.town(id)` + rebuild world; hidden during expedition except the party's town).
- **Settings** (Pause → Настройки): Качество (Авто/Низкое/Среднее/Высокое = QualityLevel 'auto'|1|2|3; 0 «Картошка» hidden
  under «ещё»), Чувствительность мыши, Инвертировать Y, Поле зрения (60–90°, default 75), Камера по умолчанию (1-е / 3-е лицо),
  Плечо камеры (право/лево), Пузыри чата (вкл/выкл, длительность), Имена над головами (все/рядом/выкл), Показывать других
  игроков (макс. N: 20/40/80), Интерфейс: размер 90–125 %, Начинать в 3D при открытии сайта (вкл). Stored in
  `localStorage['l3d.settings']` (JSON).

### 4.10 Item card (tooltip on hover, full card in the detail pane)
Order (site `itemBody` tip mode — "main info first"):
1. Header: name (`name`, already style-renamed by the site; append ` +en`), colour = rarity; qty `×n`.
2. Sub-row: rarity name, slot name (`SLOT_LIST` names), «✓ надето» if `on`.
3. Stats list: every key of `stats` ∪ equipped item's stats (only `xs` keys if `hero.xs`), icon + label + value (`+3`, `+9%`
   for percent keys). **Comparison column** vs the equipped item in the same slot: `+Δ` green ▲ / `−Δ` red ▼ / `=` grey.
   Verdict line «Сравнение с надетым: **Name** — в целом **лучше/слабее**» using site weights
   `STW {hp:.35, atk:1, mag:1, def:1.2}` and `XSTW {crit:.8, critDmg:.25, dodge:.8, pierce:.2, healPow:.4, luck:.2, resist:.6}`.
4. Effect (`effect.heal` «лечит N здоровья», `effect.revive` «воскрешает павшего героя», `effect.buff` «<stat> +add на min мин»).
5. Aura (`aura{icon,name,text}`) «Аура на весь отряд в бою, пока владелец жив».
6. Enchant `en`: «Заточка +N: характеристики +b%» (b from `ench.bonus[en]`).
7. Muted block: lore/desc, class line («С этим оружием станешь: **<class>**» when weapon `role !== hero.role`), gear type
   (`gear` heavy|light|cloth → тяжёлое/лёгкое/ткань + who may wear), durability line, «Куплено за баллы канала» (`pts`).
8. Footer hint (detail pane only): chat command, e.g. «Или на стриме: **съесть 7**» (`no`).

Rarity colours (`LGGameData.RARITY_LIST`) [site]:

| id | name | colour |
|---|---|---|
| common | Обычное | `#c9ccd6` |
| uncommon | Необычное | `#4cc95a` |
| rare | Редкое | `#4aa3ff` |
| epic | Эпическое | `#b06bff` |
| legendary | Легендарное | `#ffb83d` |

Use them for the name text, a 3 px cell border-bottom and a soft inner glow (`box-shadow: inset 0 0 18px <c>33`); epic and
legendary get an animated slow shimmer (CSS `background-position` 6 s loop, off with `prefers-reduced-motion`).

### 4.11 Money formatting (exact site rule, `LGSiteUi.moneyParts`) [site]
- `money` is an integer in the smallest unit (bronze). **1 gold = 100 silver = 10 000 bronze.**
- `g = floor(n/10000)`, `s = floor(n/100) % 100`, `b = n % 100`; print non-zero parts, largest first, separated by a space:
  «10 серебряных рыбок 5 чешуек». Zero → «0 <unit>» where unit = `MUNIT(ref)` (`ref ≥ 10000 → g`, `≥ 100 → s`, else `b`), `ref`
  = the price compared against (so «0 серебряных рыбок», not «0 чешуек»).
- Unit words: style coins `MDDoodle.part('coins')[g|s|b].forms` with Russian plural (`LGSiteUi.plural(n, one, few, many)`);
  fallback «зол. / сер. / мед.». Cats style: `b` чешуйка/чешуйки/чешуек `#c07a44`, `s` серебряная рыбка/…/серебряных рыбок
  `#c8ccd8`, `g` золотая рыбка/…/золотых рыбок `#f2c14e`; coin SVG via `coins.svg(k, size)`.
- Fixture `money: 1708` → «17 серебряных рыбок 8 чешуек». HUD compact form: coin icons + numbers only (`🟡0` hidden): `⚪17 🟤8`.
- Prefer calling `window.LGSiteUi.moneyText(n, ref, coins)` at runtime; keep a pure re-implementation in `src/ui` for tests.

---

## 5. Visual style guide

### 5.1 Palette (derive from the page at runtime)
The site sets `html[data-skin]` per style (`SKIN = {legion:'forge', cats:'den', monkeys:'rage', ugabugi:'rage'}`) and exposes CSS
variables. **Read them from `getComputedStyle(document.documentElement)`** and map into our `--l3d-*` variables, so every channel
style is automatic. Defaults (the cats skin «Лежанка»/`den`) [site]:

| our var | site var | den value | use |
|---|---|---|---|
| `--l3d-bg` | `--bg` | `#1d1620` | menu backdrop (with 78 % alpha + blur 10px) |
| `--l3d-panel` | `--surface` | `#2a2030` | panels |
| `--l3d-panel-2` | `--surface2` | `#221a28` | inset wells, cells |
| `--l3d-ink` | `--ink` | `#f7eadf` | text |
| `--l3d-mute` | `--mute` | `#bfaab7` | secondary text |
| `--l3d-accent` | `--accent` | `#ff8fa3` | selected tab, primary button |
| `--l3d-gold` | `--accent-2` | `#ffcf6a` | ornaments, focus ring, XP |
| `--l3d-up` / `--l3d-dn` | `--up` / `--dn` | `#8fe39a` / `#ff8f8f` | comparison |
| `--l3d-hp` | — | `#ff6b81` → `#ff9aa8` gradient | HP bar |
| `--l3d-xp` | — | `#ffcf6a` → `#ffe9a8` | XP bar |
| rarity | `--rc-*` | skin-tuned rarity colours | prefer skin `--rc-*`; fallback table 4.10 |

### 5.2 Fonts (already loaded by the page; never load our own)
- Headings / tab ribbon / big numbers: skin `--hd` (cats: **Comfortaa** 700; legion: **Forum**; others vary).
- Body: skin `--tx` (cats: **Nunito**; legion: **Golos Text**).
- Damage / level numerals, toasts headline: **Dela Gothic One** (loaded on index) — fallback `--hd`.
- 3D labels (canvas): **Russo One** (city font `russo-one.woff`, loaded by the city) for nameplates; Nunito 800 for bubbles.
  Wait for `document.fonts.ready` before rasterising labels.

### 5.3 Panels and ornaments (pure CSS)
- Panel: `border-radius: 22px`; double border = `box-shadow: 0 0 0 2px var(--l3d-gold), 0 0 0 6px var(--l3d-panel), 0 0 0 7px
  color-mix(in srgb, var(--l3d-gold) 40%, transparent), 0 18px 40px rgba(0,0,0,.45)`.
- Corner ornaments: four `::before/::after` + one extra span with a radial "paw/flourish" made of `radial-gradient` dots
  (cats: a paw = 1 big + 3 small circles; legion: a laurel = two rotated ellipses). Size 22 px, colour `--l3d-gold`.
- Title bar: centred title on a ribbon (`clip-path: polygon` banner with notched ends), subtle stitched line
  (`border-top: 2px dashed` in 30 % gold) under it — the "cushion/sewn" feel of the den skin.
- Slots/cells: round-ish "bowls" (`border-radius: 18px`), inset shadow, rarity stripe at the bottom (site book/den idiom).
- Buttons: pill (`999px`), primary = accent fill + 0 3px 0 darker shadow ("pressable"), ghost = 2px border.
- Focus: 3px `--l3d-gold` ring, visible for keyboard.
- Backdrop for menus: blur(6px) of the 3D frame + vignette `radial-gradient(transparent 55%, rgba(0,0,0,.55))`.

### 5.4 Motion
- Menu in: panel `translateY(12px) scale(.98) → 0/1`, opacity, 180 ms `--ease`. Tab switch: 120 ms cross-fade.
- Cells: hover lift `translateY(-2px)` 120 ms. Equip success: slot pops (`scale 1.12 → 1`, 240 ms) + gold sparkle (CSS).
- Bars: width transitions 400 ms; HP loss shows a white "ghost" chunk that drains after 600 ms.
- Toasts: slide up 200 ms, stay 2.8 s (site default), fade 300 ms.
- Respect `prefers-reduced-motion`: no shimmer, no auto-rotate, instant camera cuts.
- **Sounds: none** (no audio in v1).

---

## 6. HUD

### 6.1 Layout (1920×1080 reference; scale with `--l3d-ui-scale`)
```
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│ [portrait] Player1  Ур.6       🧭 ───N──Ратуша──|──Кузня───   ┌────────────┐  👥 37 онлайн  │
│ ❤ ███████████ 71/71                                            │  minimap   │  ⚪17 🟤8       │
│ ✦ ██████░░░░ 307/540                                           │ (Later)    │  🗡️ Боец 213   │
│                                                                └────────────┘               │
│                                                    ┌─ QUEST HUD (§7) ─────────────────────┐ │
│                                                    │ (only while quest.on)                │ │
│                              +  (crosshair, FP)    └──────────────────────────────────────┘ │
│                                                                                           │
│                        ┌──────────────────────┐                                           │
│                        │ E  Войти · 🔨 Кузня   │  ← interaction prompt (centre-low)        │
│                        └──────────────────────┘                                           │
│ ┌chat (bottom-left, 420×220)─────────┐                            toasts (bottom-centre ↑) │
│ │ Ник: сообщение…  (fades after 12 s)│                                                     │
│ │ [ Написать в чат… (Enter) ]        │                Tab Персонаж · M Карта · F1 Помощь   │
│ └────────────────────────────────────┘                                                     │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```
| Widget | Data | Behaviour | MVP |
|---|---|---|---|
| Portrait + name + level | `name`, `level`, `roleName` | click → Снаряжение | MVP |
| HP bar | `hpNow` / `stats.hp` | red pulse < 30 %; ghost → grey bar «👻 призрак · 3:12:45» | MVP |
| XP bar | rule §4.4 | level-up (`level` increases) → big centred «🐾 УРОВЕНЬ 7» (style `scenes.level.title`) 2 s | MVP |
| Compass strip | camera yaw; building door bearings within 60 m | shows building icons + titles; quest target? none | MVP |
| Minimap | `CityLayout` | Later (Map tab covers MVP) | Later |
| Online | store `online` (`n`, of `max`) | «👥 37» tooltip «в городе сейчас» | MVP |
| Money | `money` compact | animates delta («+12 🟤» floats up) | MVP |
| Social chip | `soc` | click → Рейтинг | MVP |
| Crosshair | — | FP only: 4 px dot; turns gold over interactable | MVP |
| Interaction prompt | nearest door within 2.5 m & in view cone 50°, or player within 3 m | `E Войти · <icon> <title>`; `soon` → «🚧 <title> — скоро» | MVP |
| Chat box | store `chat` | last 8 lines, each fades after 12 s; full opacity while typing; DM lines pink, `ev`/`sys` italic gold; name coloured by class group (`--g-phys/mage/heal`) | MVP |
| Toasts | `GameEvents.toast` + API errors | max 3 stacked; `bad` = red | MVP |
| Key hints | — | bottom-right, hide after 30 s of play, F1 brings back | MVP |
| "Click to play" | pointer not locked in `play` | centred card «Кликни, чтобы играть» | MVP |

Chat bubbles in the world: each new city chat line (`kind` g/tr) → `Labels.bubble(login, text, 6000 + 40 ms × chars, max 12 s)`.
Own messages show over own head in TP (and in FP as a small line above the chat box). Deleted messages (`chatDel`) → remove bubble.

---

## 7. Expedition («Поход») HUD

### 7.1 When
- The site's quest view arrives as SSE `q` (also when the Quest tab is closed) → store `quest`. Shown only when
  `hero.qt` (quest tab allowed) and `quest.on === true`.
- **City lock** [site]: `cityLocked = quest.on && party === 'in' && !townEntry`. Then the 3D city is *locked*: we keep the world
  rendered (no new `go`, presence left to the site), show a full-width soft banner «Вы сейчас в походе — в город после похода»,
  and the Quest HUD opens **expanded**. Players NOT in the party (`party !== 'in'`) keep walking; Quest HUD is a compact card.
- Town entry: `quest.town {id,name}` + hero `cy && tw` → button «🏘 Войти в город «Name»» → `LGCity.town(id)` and our world
  rebuilds for that town (Later; MVP: classic frame `quest`).

### 7.2 Stream delay (must replicate) [site]
The site shows each view only when `(q.at || receivedAt) + delayS*1000 <= now`, `delayS = max(0, q.dl + adj)`, `adj` from
`localStorage['lgQDelay']` (−10…30, user-adjustable «как на стриме · N с ±»). Own state (vote `my`, turn `turn`/`tg`, `acted`,
`tele.ok`, event `my/used/said`, loot `my`) is merged from the *newest* view immediately (site `view()`). Timers `until/end`
are server ms; seconds left = `ceil((until + delayS*1000 - now)/1000)`. The `quest` module implements the same buffer
(keep last 80 views) — reading `adj` from the same key keeps the site and the HUD in sync.

### 7.3 Data shape of `q` (QuestView) — from quest.js reads [site], field meanings partly **[assume]**
```ts
interface QuestView {
  on: boolean; dl?: number /*stream delay s*/; now?: number; at?: number /*snapshot ms*/;
  late?: [at: number, what: string, sLate: number][];   // "you were N s late" → toast (site text «Опоздал на N с…»)
  k?: 'battle'|'trap'|'treasure'|'lair'|'rest'|'shop'|'event'|'map'|'travel'|'town'|'gather'|'boss'|'dungeon'|'bossgen';
  t?: string; ter?: string /*terrain*/; n?: number /*party size*/; roll?: { by: string; n: number };
  party?: 'in'|'q'|'ghost'|string /*else = not in party*/; cm?: boolean /*false → join = queue*/;
  gather?: { until: number }; dg?: string /*danger note*/; lw?: [name: string, dur: number][] /*my worn items ≤30%*/;
  town?: { id: string; name: string };
  b?: {            // regular battle
    id: string; title?: string; round: number; maxR?: number;
    st: 'intro'|'party'|'tele'|'mech'|'end'; until: number;
    hp: number|null /*my hp 0..1; null = not in battle; 0 dead; <0 fled*/;
    me: number /*index in form, -1 = off-screen*/; form: [login, role, side?, _, shield?, def?][]; mf?: [role, side];
    fighters?: number; two?: boolean; cr?: { fr: ('L'|'R'|'F')[] };
    foes: [side, type, isLeader, hp, name][];           // [assume] order from usage f[0] side, f[2] leader, f[3] hp, f[4] name
    low?: [login, name, hp01][];                         // wounded allies (heal targets)
    sk?: [word: string, cd: number, kind: string][];     // my skills: chat word, cooldown in turns
    turn?: string; tg?: [target, side];                  // my accepted move this round
    tele?: { word: string; text?: string; ok?: boolean; got: number; need: number };  // enemy turn: type the word
    gb?: { forbid?: boolean } ; mine?: { k: string; r: number; me: {...} } /*my last result*/;
  };
  bg?: { name; title?; ph; phs; hp /*boss 0..1*/; st: 'party'|'boss'; acted?; in?: boolean; my?: number /*my hp*/;
         mech?: { id; name; fam?; how?; word?; tip?; fake?: boolean; me?: boolean; until?: number } };  // generated boss
  lair?: { is?: { pick?: {until; my}; doom?: {until}; at?: {my} }; hp?; st?; phase?; round? };      // Закхуэль, islands 1–4
  tr?: { name; icon?; type: 'react'|'ropes'|'ceiling'|'bait'|'share'|'code'|'plates'|'greed'|string;
         st: 'intro'|'act'|'wait'|'done'; until?; word?; gas?: boolean; how?; intro?; acted?: boolean;
         actedN?; total?; n? /*ropes*/; len?; max? /*code*/; best?; taker?; tre?: boolean /*treasury*/;
         res?: { me?: { dmg? }; text? } };
  ev?: { look: 'traveler'|'dice'|'well'|'priest'|string; name; icon?; st?: 'vote'|'done'; until?;
         my?: 'help'|'rob'|string; cmds?: [word, desc][]; res?: { text }; votes?: { help; rob };
         purse?; thrown?; need?; pool?; used?; said?: { text }; last? };
  vote?: { id: number; title: string; end: number; done?: boolean; my?: number;
           opts: [n: number, label: string, desc?: string, votes: number, back?: boolean][] };
  dgn?: { vote?: { id; title; end; done?; mode?: 'ring'|string; my?; opts: [n, label, desc, ...][] } }; // dungeon passages
  loot?: { name: string; until: number; n: number; my?: boolean };       // split loot vote
  sh?: { name?; icon?; items: { id; name; rarity; price; qty; curio?; slot?; stats? }[] };  // travelling shop
  pb?: { b: { t: string /*line to send*/; l: string /*label*/; c?: 'main'|'warn'; g?: ''|'tg'|'act'|'esc'; x?: { role?: string } }[] };
}
```
Priority of what the HUD shows (same order as site `bannerHtml`): `b` (unless `b.gb && bg`) → `lair.is` → `bg` → `tr` → `ev` →
`dgn.vote` (not done, mode≠ring) → `vote` (not done) → `loot` → generic (`k`, `t`, party status).

### 7.4 Commands players type (Twitch chat) [site]
- Join: «поход» during gather. Base class move = `LGGameData.baseCmd(role)`: melee «удар», ranged «выстрел», magic «магия»,
  heal «лечить» (recruit = melee). With two fronts: «удар лево / право / вдали» (`SIDE_CMD`), healers no side.
- Skills: the word in `b.sk[i][0]` when `cd === 0`. Enemy turn: type `b.tele.word`. Votes: the option number. Events:
  «помочь» / «обобрать», words from `ev.cmds`. Loot: number or nick, or «случайно». Shop: «купить N». Food: «съесть N» /
  «выпить N» (`no`), scroll «свиток (или свиток @ник)». Islands: «1–4».
- Silence rules: trap `gas` → «Не пиши в чат!»; boss `mech.fake` → «ФИНТ — не пиши!»; `fam==='silence'` → «Тишина: молчи».

### 7.5 Buttons and APIs [site]
- `POST /api/qvote {vid, n}` — vote by click (allowed when `party==='in'`) for `vote` and `dgn.vote`.
- `POST /api/qact {k, a?, …}` — **only if `hero.qa`** (tester flag; else hide buttons, show chat text only). Payloads used by the site:
  `{k:'join'}`, `{k:'leave'}`; battle `{k:'b', a:'base', t?, s?}`, `{k:'b', a:'melee'}` (priest), `{k:'b', a:'sk', w, t?, s?}`,
  block during `tele` is by typing the word (no button); trap `{k:'tr', a:'rope', n}`, `{a:'hold'}`, `{a:'take'}`, `{a:'eq'}`,
  `{a:'me'}`, `{a:'code'|'path', s:'<digits>'}`; event `{k:'ev', a:'help'|'rob'|'bet'(n)|'coin'|'donate'(n)|'bless'|'cleanse'|'heal'|'revive'}`.
  Response `{ok, id}`; the game's verdict arrives later in the `me` SSE `results[]` with `x.op==='qact'` → toast on failure,
  «✓ принято» line on success. One pending action at a time (9 s timeout), like the site.
- `POST /api/qsay {line}` — «Команда в поход» line (qa only), max 100 chars, Enter sends, ↑/↓ history (8). **Paste and drop
  are blocked**; if the screen asks for silence, the first Enter only warns («экран просит молчать — нажми Enter ещё раз»).
- Eat from the HUD: `/api/use {uid}` (same as bag).

### 7.6 In-game Quest HUD spec
Placement: right side, top 140 px, width 400 px (compact) / 520 px (expanded, `Q`). Never covers the crosshair.
```
┌ ⚔ Бой · Волчья стая · раунд 2/5 ─────────── ход отряда · 12 с ┐   header: icon + KIND_RU[k] + title, timer (red < 5 s)
│ ● в отряде  · ты на экране · правое крыло                      │   party chip: green in / amber q / grey ghost / red out
│ ❤ █████████░░ 82%                                              │   my hp (b.hp) — or hero hp outside battle
│ ┌ ЧТО ДЕЛАТЬ ────────────────────────────────────────────────┐ │
│ │  Пиши в чат:  [ выстрел право ]        ← big, gold, pulsing │ │   urgent line (see table)
│ │  [🏹 выстрел] [👁 Меткий глаз · готово] [✨ … через 2 хода]  │ │   qa buttons (if hero.qa)
│ │  Цель: (рядовые) (вожак)   Сторона: (своя) (⬅ слева)        │ │
│ └────────────────────────────────────────────────────────────┘ │
│ Итог раунда 1: Выстрел → Волк −12 · крит                        │   lastLine(b)
│ [ Команда в поход ……………………… ⏎ ]  (qa only)                     │
│ как на стриме · 6 с [−][+]          [Открыть Поход полностью ↗] │   delay adj; classic frame 'quest'
└────────────────────────────────────────────────────────────────┘
```
"What to do" line per phase (Russian, mirrors site):

| Phase | Condition | Line | Buttons (qa) |
|---|---|---|---|
| gather | `gather`, `party` not in | «Пиши «поход» в чат — идёт сбор · N с» | «Вступить в поход» / «Встать в очередь» (`cm===false`) |
| in party, idle/travel | `party==='in'` | «Твой герой в отряде.» | «Покинуть отряд» (warn) |
| battle, party turn | `b.st==='party'`, me on/reserve, no `turn` | «Пиши «<cmdFor>»» or «пиши «<ready skill>» — готово» | main move, skills (cd), heal target, leader, side |
| battle, turn done | `b.turn` | «✓ ход сделан: <turn>» | — |
| battle, enemy turn | `b.tele` | «Пиши: <word>» (word rendered on canvas, not copyable) / «✓ слово принято» | none (must type) |
| battle, out | `hp` 0 / <0 / null | «твой герой пал» / «ты сбежал из боя» / «ты не в этом бою» | — |
| generated boss | `bg.mech` | `fake` → «ФИНТ — не пиши!»; `me` → «Цель — ты! <how>»; else «<mech.name>: пиши <how|word>»; `st==='party'` → base cmd | as battle |
| islands | `lair.is.pick` | «Пиши номер острова: 1–4» / «ты на острове N» | Later |
| trap | `tr.st==='act'` | gas → «Не пиши в чат!»; word → «Пиши: <word>»; else `how` | ropes ✂1..n, «🙌 Держу!», «🧰 Взять», «🤝 Поровну / 💰 Себе», keypad for code/plates |
| event | `ev` | traveler vote «Пиши «помочь» или «обобрать»»; else first `cmds` word | help/rob/bet/coin/donate/bless/cleanse/heal/revive |
| vote / dungeon | `vote` / `dgn.vote` | «Пиши номер в чат» + options with bars (`votes`) | click option = `/api/qvote`; keys `1–9` |
| loot | `loot` | «Голосуй в чате, кому отдать вещь (номер или ник) или «случайно»» | — |
| shop | `sh.items` | «Прилавок · <name>: купить N» | item grid (rarity, price via money(), `qty`), «Купить» with double-confirm → qsay «купить N» |
| place buttons | `pb.b` | — | grouped rows («Помочь своим», «Уйти из боя»), `warn` need a second press within 4 s |

Extras: `lw` → amber line «⚠ <item> — прочность N%: …почини у кузнеца»; `late` → toast «Опоздал на N с — …включи в плеере
Twitch «Низкую задержку»»; `dg` → red note. 3D: when `quest.on && party==='in'`, our avatar gets a small ⚔ banner over the
nameplate (others too if their login is in `b.form`) — Later.

### 7.7 Fair play (hard rules)
- Never auto-send chat, votes or actions. Every request is a direct user click/keypress.
- The "reaction word" (`tele.word`, `tr.word`, `mech.how/word`) is drawn on a canvas, not as DOM text; no copy, no drag, no
  autofill, no paste in our command line — the streamer's explicit decision [site comments 26.10].
- Respect silence phases (warn on first Enter).

---

## 8. Edge cases

| Case | Detection | Behaviour |
|---|---|---|
| Not logged in | `/api/me` → no `user` (or `connectSite` → `no_login`) | Title card over a slow fly-through of the empty city: «Войди через Twitch — увидишь своего героя…»; button «Войти через Twitch» → `location.href = window.LG_LOGIN` (e.g. `/auth/twitch/login?next=%2Fc%2F<ch>%2F`; fallback `/auth/login`). Rating/News/Map still open (classic). |
| Hero not created | `user` but `hero` null (`creating` → «Герой собирается в путь…») | Same card: «Героя пока нет — он появится, когда ты напишешь в чат на стриме.» Spectator mode: free walk as a translucent default doodle, no presence calls. |
| City not open for hero | `!hero.cy` | Spectator fly-through + «Город пока закрыт»; menus work. |
| City locked (in expedition party) | `cityLocked()` / `connectSite → city_locked` | §7.1: no walking; Quest HUD expanded; menus open; equip still blocked server-side when `busy`. |
| Ghost hero | `ghost:true`, `deadUntil` | Avatar translucent (`Appearance.ghost`), HUD hp grey with countdown, equip disabled, revive hint «Раньше — свиток воскрешения». |
| Busy (battle on stream) | `busy:true` | Equip/look buttons disabled with site note. |
| Pending (streamer's game offline) | `pending > 0` | Toast after 6 s «Сохранено — применится, когда игра стримера будет в сети». |
| Bag full | `sg.used >= sg.cap` | Amber strip in Сумка + HUD toast once per session. |
| Debt | `debt > 0` | Red line in stats «Долг: −money…», shop buttons still site-controlled. |
| SSE disconnect | no `me`/`city` events 70 s or EventSource error | HUD chip «⚠ Нет связи — переподключаемся…»; freeze other walkers (fade to 50 %); retry is the site's; on recovery re-sync via `/api/city/state`. |
| API error | `{ok:false,error}` or fetch timeout (20 s, site text «нет связи с сайтом») | Toast `error` (site wording), restore the button. |
| Rate limit | server «быстро/часто» | Silent: `net` backs off; never toast for movement. |
| Site changed (globals missing) | `site_changed` | Toast «Сайт обновился — часть 3D недоступна», degrade to solo mode, classic frames still work; `F8` always works. |
| Site page outdated (`LG_VER.old()`) | site reloads itself before opening rooms | Allow; our boot restores 3D mode from `l3d.mode` in localStorage. |
| WebGL unavailable / very slow | context fails or quality 0 still < 20 fps for 10 s | Offer «Классический сайт» automatically, remember choice. |
| Mobile / touch / narrow (< 900 px or `(pointer: coarse)`) | `LGSiteUi.is('touch')` | **Non-goal**: stay on the classic site, show a small «3D — только на компьютере» note once. |
| Tab hidden | `visibilitychange` | `engine.pause(true)`; site handles `/api/city/leave`. |
| Streamer dock (`LG_DOCK`) / streamer tab | `window.LG_DOCK` | Do not boot 3D at all. |

---

## 9. MVP cut (summary)
MVP = 3D city + FP/TP + others + bubbles + HUD + chat + building interiors (site rooms) + native Снаряжение / Сумка /
Характеристики / Журнал with orbit camera and real re-dress + classic frames for Навыки, Достижения, Облик, Рейтинг, Новости,
Карта мира, full Поход + compact native Quest HUD (phase, timer, what to type, votes by click/keys, qa buttons) + login /
no-hero / ghost / locked states + F8 toggle.
Later = native Облик/Навыки/Достижения/Рейтинг/Новости, minimap, player cards & trade, district towns in 3D, 3D mine,
gamepad, emotes, quick-use belt, quest banners over heads.
