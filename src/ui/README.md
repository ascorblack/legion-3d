# src/ui — game HUD, chat, menus

`mountUi(root, host)` (src/ui/index.ts) attaches `<div class="l3d-ui">` (position:fixed, z-index 150, pointer-events none)
to `root` with an open Shadow DOM. Returns `GameUi` = contract `Ui` + `settings` + `setHudVisible(on)` + the v2 API below.

## v2 API (features)
- `ui.addTab(id, def: MenuTabDef)` → unregister fn; `ui.removeTab(id)`. Every tab, built-ins included, is an entry of
  `TabRegistry` (src/ui/tabs.ts). Groups: `character` → «Герой» ribbon, `world` → «Мир» ribbon, `system` → not in the
  ribbon, opened by hotkey / `ui.open(id)` / the Pause menu. Built-in orders: gear 10, bag 20, stats 30, skills 40,
  ach 50, log 60, look 70 · legion 110, news 120, map 130; without `order` a tab goes last in its group. Reserved or
  taken hotkeys are dropped (warning). Adding a built-in id replaces its page; `removeTab` restores the built-in.
  `render(el, ctx)` runs once per opening (the UI never wipes `el` on hero updates — the feature re-renders itself);
  its returned function runs when the tab closes, switches or is removed. `ctx` = the GameContext set with
  `ui.setGameContext(ctx)` (before that: a stand-in with store, actions, input, ui.toast/open, layout()).
  `l3d:menu` → `detail.orbit` is the tab's `orbit` flag.
- `ui.prompt(text | null)` — the crosshair prompt line, driven by the interact system. `[X]` → keycap,
  `[ЛКМ]`/`[ПКМ]` (or LMB/RMB) → mouse keycap, `·` separates actions, a leading `!` = muted (disabled target).
  Example: `«[E] Войти: Кузня»`, `«[ЛКМ] Купить: Коготок — 4 серебра · [ПКМ] Осмотреть»`. The first call switches the
  HUD from polling `host.focusTarget()` (legacy, still supported) to the driven prompt.

## Карта (src/ui/map.ts, src/ui/mapdata.ts)
Base picture: host extra `mapImage?(): Promise<{url,width,height,x0,z0,x1,z1}>` (metres, the world's top-down render),
requested once per layout on first use; until it arrives or if it fails — a vector plan from `store.layout` at the true
metre aspect (streets from `layout.free`, building blocks, ledge + stairs, canal + bridges, props). Overlay: building pins
(icon + title, greedy collision-free labels; crowded ones show on hover), street lettering, «you» + facing arrow,
`store.walkers` as dots (~6 Hz). Drag = pan, wheel = zoom (+/−, ⤢ whole city, ◎ where am I). Pin → popover →
«Идти сюда» → host extra `walkTo?(x, y)` (px, the building's door) and the map closes; double-click on a street walks
there. Without `walkTo` the popover says so. Optional round HUD minimap (setting `l3d.minimap`, off by default):
player-centred, rotates with `host.yaw()`, same base picture, click → map.

## Item cards (hover tooltips)
Shown on hover over a bag/gear/fit cell; hidden when the pointer leaves the item, on any pointerdown (click elsewhere,
orbit drag), wheel, Esc, window blur, pointer-lock change, tab hidden, menu tab switch/close. After a hide the same item
stays muted until the pointer leaves it; after a page switch no card shows until the pointer really moves.

## Menu signalling
On every change of the open menu:
- `host.menuChanged?.(id | null)` (optional host extra);
- `window` event `l3d:menu` `{ detail: { open: id | null, orbit: boolean } }` — `orbit` is true for `gear`, `bag`, `look`
  (character is framed in the left ~45 % of the screen, x≈29–31 %, feet y≈85 %). That area has no veil and no
  pointer-catching element (drag/wheel reach the canvas → the rig orbits/zooms); only edge vignettes, a warm floor glow
  under the feet and the hint pill «Тяни мышью — повернуть · колесо — приблизить». All orbit panels (gear, bag, Облик)
  start right of x = 44 %.
Opening a menu: `host.input.setGameplay(false)` + `document.exitPointerLock()`. Closing: `setGameplay(true)` (unless chat typing).
Menu ids: `gear bag stats skills ach log look legion news map pause settings help`; aliases `character` (last char tab),
`journal`→log, `rating`→legion, `world`→map; `quest` → `actions.openSitePanel('quest')`.

## Keys
Gameplay (via `host.input.onKey`): Esc→pause, Enter/T→chat, `/`→chat with "/", Tab→character, C I B P K Y J O M R N (+ feature tab hotkeys) → tabs,
F1/H help, F2 hide HUD, F3 perf. Not bound: V, E, WASD, Space, Shift (engine/main own them).
Inside menus (own `window` keydown listener, because Input forwards only Escape/Enter when gameplay is off):
Q/E or [/] prev/next tab, same hotkey or Tab closes, other hotkey switches, arrows move selection (bag grid, gear slots,
pause list), Enter = primary action, Shift = compare with equipped, Esc closes (settings/help → back to pause).
Pointer lock lost while playing (not by us) → pause menu (set `host.pauseOnUnlock = false` to disable).

## HUD (minimal by default)
Medal + name + HP line (XP is a 4 px hairline), money chip; bare compass strip; «● N онлайн»; chat shows the last 5 lines
(each fades after 10 s), the input bar appears only while typing (Enter/T/`/`); key hints bottom-right fade after 20 s
(shown again after a menu closes and on F1). «Кликни, чтобы вернуться в игру» appears only when pointer lock is supported,
the user has interacted, the lock was held at least once and is now lost while gameplay is on (0.35 s grace); while it
shows, the door prompt and crosshair are hidden. UI auto scale: min(w/1366, h/768) clamped to 0.8–1.15, × `l3d.uiScale`.

## Settings (localStorage)
| key | type | default |
|---|---|---|
| `l3d.sens` | number 0.2–3 | 1 |
| `l3d.invertY` | '1'/'0' | 0 |
| `l3d.fov` | number 60–90 | 75 |
| `l3d.cam` | 'fp' / 'tp' | tp |
| `l3d.quality` | 'auto' / 0–3 | auto |
| `l3d.names` | 'all' / 'near' / 'off' | all |
| `l3d.bubbles` | '1'/'0' | 1 |
| `l3d.uiScale` | number 0.9–1.25 | 1 |
| `l3d.minimap` | '1'/'0' | 0 |
| `l3d.settings` | JSON mirror of all of the above | — |
| `l3d.menuTab` | last Character tab | gear |
Change → `window` event `l3d:settings` `{ detail: { key, value, settings } }`. Camera/quality changes also call
`host.setCameraMode` / `host.setQuality` directly. Chat focus → `window` event `l3d:chat` `{ detail: { focus } }`.

## Runtime site hooks (optional, all with fallbacks)
`window.MDDoodle.part('hero'|'coins'|'scenes')` — style stat labels, coin words/SVG, level-up title;
`window.LGInventory.art(it)` — site item art (else procedural SVG icons, src/ui/icons.ts); site skin CSS vars
(`--surface`, `--accent`, `--rc-*`, `--hd`, `--tx` …) are adopted when the skin is dark.

## Dev
`npm run build` → open `dist-dev/ui.html` (fake store from test/fixtures/me.json, fake chat, fake actions). `window.__ui`,
`window.__dev` (hero, emit, damage, money, setYaw, setCam, prompt, demoTab). `?mapimg=1` fakes `host.mapImage`;
the dev host has `walkTo` (teleports). Tests: `npx vitest run test/ui-money.test.ts test/ui-map.test.ts test/ui-tabs.test.ts`.

## Chat
The live site's city chat (`#tab-city .cy-chat`) is docked over the game by `chat.ts` (styled by `SITE_CHAT_CSS`),
so tabs, DMs, moderation and future site changes come for free. Our own panel is only a fallback (offline demo,
or when the site's chat element is missing).
In the 3D mine both get a «⛏ Шахта» tab (`attachMineChat`, state in `MineChatTab`): its own list and field are inserted
next to the site's (`.l3d-mine-l` / `.l3d-mine-f`, shown via `.l3d-mine-on` on the chat box) and re-attached by the
0.5 s scan if the site rebuilt its DOM.

### Moderation (`chat-mod.ts`)
Parity with the site's chat module («22.10: модерация»): for a moderator of a chat (role `own` / `mod` from the enter's
chat state, the addressed `chatMe`, the answer of `GET <base>/mod`) — «⋯» on other people's lines (delete, mute
5 мин…7 дней, ban, make / unmake moderator for `own`), «⚙» → moderation window (restrict by nick, mutes / bans with
«Снять», moderators with «×» + add form for `own`), role icons 👑/🛡, the muted field («Мут ещё N мин») and the
commands /help /mods /mod /unmod /mute /ban /unban (never sent to the feed). One request per action, exactly the site's:
`POST <base>/mod<q> {op, id, login, min}`, `GET <base>/mod<q>`; base `/api/city/chat` or `/api/mine/chat` + `?c=<mine>`.
- Docked City chat: the site's own «⋯» opens our menu whose items press the site's own `[data-cact]` buttons (its chatAct
  does the request / status / list); its ⚙ window and commands are the site's.
- «⛏ Шахта» tab (dock and fallback) and the fallback City panel: `Moderator` (requests) + `ModUi` (menu / window in a
  Shadow DOM host `#l3d-chatmod`: keyboard, Esc / click outside close, input modal `chat:mod` = pointer free, gameplay off).
- Tests: `test/chat-mod.test.ts`; parity against the real site module: `.local/chatmod/parity.mjs` (needs a saved site copy).
