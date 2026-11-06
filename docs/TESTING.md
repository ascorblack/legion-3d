# Testing

Three levels, from fast to real: unit tests (Node), the offline demo (the whole game in a browser with fake
site data), and the live end-to-end run against play.multidonate.ru with a real account.

All commands run from the repository root. On Node 18 the pinned versions are vitest 2.1.9 and playwright 1.48.2.

```bash
npm ci
npm run build        # dist/ = the extension, dist-dev/ = dev pages (every dev/*.ts → dist-dev/*.js, dev/*.html copied)
npm run typecheck    # tsc --noEmit
```

## 1. Unit tests

```bash
npm test                              # vitest run, all of test/*.test.ts
npx vitest run test/store.test.ts     # one file
```

They need no browser and no network. Fixtures are sanitized copies of real site data in `test/fixtures/`
(`fair-map.json`, `me.json`, `city-session.json`). What is covered:

| file | what |
|---|---|
| `store.test.ts` | reactive store: batching of events, chat de-duplication / order / cap, walkers |
| `bridge.test.ts` | the document_start tee: EventSource named events and (while the fetch tee is on) watched fetch() JSON reach `__L3D_BUS`, the page still gets its own data; `window.fetch` untouched until `fetchTee.on()`, restored exactly by `off()` |
| `fetch-telemetry.test.ts` | the site's real anti-bot probe (`test/fixtures/site-telemetry.js`, mine.js `tlPi`) against the real bridge bundle after the site's own fetch wrapper: `pi` is 0 in 2D, in every start mode, and after 3D → F8; 1 while the tee is on (proves the probe sees it). Also checks the fixture against the newest site dump in `.local` |
| `site-tee.test.ts` | `replayCityEnter`: City tab already open when 3D starts → another tab, then the City again, so the tee catches `enter` |
| `world`, `avatar`, `engine*`, `props`, `quest`, `ui-money` | the modules' own logic (layout → geometry, appearance mapping, camera and quality maths…) |

`CHROMIUM=/usr/bin/google-chrome node e2e/fetch-tee.mjs` runs the same probe in real Chromium (needs `npm run build`, no network).
Live: `node e2e/live.mjs --start=2d --steps='[{"wait":4000},{"pi":"2d"},{"press":"F8"},{"wait":30000},{"pi":"3d"},{"press":"F8"},{"wait":2000},{"pi":"classic"}]'` prints the site's `pi` per mode (0 = nothing detected; 3D on is 1 by design, classic back to 0).

### Geometry lint

`src/world/lint` checks the built world for crooked geometry and textures, so a class of bug found once does not come
back: `lintWorld(source, opts)` takes world-space pieces (every `Batch.add` piece through `LintCollector`, the instanced
props split into their connected parts, any scene graph), the door marks (`markDoor`, `doorZ`), the door hit boxes and
`groundAt`, and returns findings `{ cls, where, tag, kind, at: [x, y, z], what, v }`.

| class | finding | tolerance |
|---|---|---|
| `float` | a group of touching parts with nothing under or beside it | > 0.08 m over the ground; contact = AABB within 2 cm (12 cm inside one object: facade layers) or a face ≤ 8 cm below |
| `loose` | a float that is one thin plane | < 3 cm thick |
| `sunk` | a part below the ground | > 0.25 m and > 30 % of its height; walls / plinths ≥ 0.8 m of stone / brick / plaster / rock are foundations; `k.b.role = 'found'` |
| `overlap` | solid convex parts of different objects inside each other; a round part ≥ 25 % inside a box part of the same prop | > 0.05 m |
| `door` | two door / open-arch marks of one building on one facade | < 1 m apart |
| `stairs` | a step under the visible terrain, a non-monotonic flight, a step top off the walk height, a cheek wall (a stairs piece ≤ 0.5 m beside the flight) that does not cover the steps or floats | 0.04 m / — / 0.25 m / 0.1 m over the steps / 0.08 m |
| `rails` | rails and ramp planks off the walk height or buried in the terrain | > 0.1 m |
| `onramp` | a prop or instance on a stair / ramp footprint | any overlap (5 cm inset) |
| `zfight` | coplanar overlapping faces (`src/world/zfight.ts`) | < 4 mm apart, ≥ 2 cm² |
| `uv` | texel density vs the material median, texture stretch (textured materials) | outside 0.4–2.5 ×, anisotropy > 3 : 1 |
| `plane` | one flat plane, one bare box face, a slanted wall slab (vertical sides, inclined top); a small piece's face = its largest planar face, not its AABB | > 24 m², > 60 m², > 6 m² |
| `ledge` | a box part reaching into a round body mid-height (a board wholly in front of the wall is fine) | corners > 0.12 m outside it |
| `lamp` | a lamp head not attached to its post, a bare emissive box with no frame | — |
| `outline` | the door's hover-outline region vs the drawn door | > 0.15 m beyond it, < 60 % of it, no door mark |

Runs: `test/geom-lint.test.ts` (old fair, new cats fair, camp, villages cats + cherts, a Town Kit town) and
`test/geom-lint-scenes.test.ts` (12 rooms, mine geo1 / geo3, an expedition stage) — the whole suite in ≈ 10 s. `door`, `loose` and `lamp` are hard
zeros everywhere. Other counts
per place and class are a ratchet in `test/fixtures/lint-baseline.json`: a count may only go down
(`LINT_WRITE=1 npx vitest run test/geom-lint --no-file-parallelism` rewrites it — commit only lower numbers). `LINT_OUT=<dir>` writes every
finding as JSON, `LINT_MAX=<n>` prints more of them. Intentional cases go into `src/world/lint/allow.ts`, each with a
reason, or mark the pieces with `k.b.role` (`'smoke'`, `'hang'`, `'found'`). In the game: Settings → Отладка →
«Проверка геометрии» (or `dist-dev/game.html?lint=1`) logs the findings and puts red pins on them (magenta: doors /
outline, orange: stairs / rails); `window.__l3dLint` holds the last report.

Visual tour: `CHROMIUM=/usr/bin/google-chrome node dev/lint-tour.mjs [town…] [--lint]` — ≈ 12 fixed views per town
(overview, stairs / ramp, every door) at 960×540 SwiftShader into `.local/fcart/tour/<town>/` with `views.json`.

## 2. Offline demo

`dist-dev/game.html` runs the complete game (`src/content/game.ts`) on a fake `SiteSession` built from the
fixtures (`dev/game.ts`): 24 bots walk and chat, equip/unequip work locally, nothing talks to the site.
This is the place to test anything that would change the account (buying, equipping, chat).

```bash
npm run build
npx http-server dist-dev   # or open dist-dev/game.html directly from disk
```

Each module also has its own page: `dist-dev/{world,avatar,engine,ui,props}.html`.

Headless screenshots (software WebGL — slow; 5–15 fps is normal there):

```bash
node scripts/shot.mjs dist-dev/world.html .local/shots/world.png --wait=6000
```

In the dev build `window.__l3dGame` exposes `{engine, world, store, rig, player, site, ui, qhud, meAv, vm, labels}`
for scripted checks (e.g. `__l3dGame.player.teleport(x, y)`, `__l3dGame.engine.stats()`).

### Scripted offline checks (0.5.0)

All on the dev build (`npm run build`, not `--prod`: they need the `__DEV__` hooks), `CHROMIUM=/usr/bin/google-chrome`:

| script | checks | exit 0 = |
|---|---|---|
| `node dev/debug-check.mjs` | debug mode off by default (no F10, no panel), F10 / Esc open-close, test dimension enter → exit at the same point with no `go` sent, every expedition mock opens its 3D scene, auto-play, shop portal | `ALL OK` |
| `node e2e/expboot.mjs [out]` | expedition-only boot on `dist-dev/expboot.html` (City tab locked): 3D expedition starts without the city, no `/api/city/*`, end card, «Вернуться в город» → normal city boot | all assertions pass |
| `node dev/travel-shots.mjs [out]` | «Путешествие» (`L`): towns page, channel list / search (fake `/api/find`, debounce), camp names by style; screenshots | all assertions pass |
| `node dev/debug-shots.mjs`, `node dev/camp-shots.mjs`, `node dev/hw-shots.mjs` | screenshots only (debug panel, camps per style, Halloween) | — |
| `dist-dev/goods.html?style=cherts` | gallery of every consumable model per style (`window.__goods.tris`) | visual |
| `dist-dev/mine.html?econ=1` | stone signs with the economy estimates; `?dig=20` for the AFK signals (tab title, chime, guard) | visual |

Mine sprint checks (AFK signals, sign / queue / HUD cards, the city chip) are screenshot scripts kept out of the repo
(`.local/`, git-ignored); the logic behind them is unit-tested (`test/mine-*.test.ts`).

## 3. Live end-to-end (real site)

Needs a Netscape-format `cookies.txt` exported from a browser where you are logged in to the site (the `lsid`
cookie). **Never commit it, never paste its content anywhere.** The scripts read it from the path in `L3D_COOKIES`
and never print cookie values.

The scripts load the page in headless Chromium and inject `dist/bridge.js` at document_start and `dist/game.js`
after load, exactly like the extension's two MAIN-world content scripts.

```bash
npm run build
# quick smoke: boot, walk, camera, menus, screenshots
L3D_COOKIES=~/cookies.txt node e2e/run.mjs https://play.multidonate.ru/c/<channel>/
# scenario runner (see the steps format at the top of the file)
L3D_COOKIES=~/cookies.txt node e2e/live.mjs https://play.multidonate.ru/c/<channel>/ --steps=my-steps.json
# logged-out path (no cookies): the splash must offer «Войти через Twitch»
node e2e/live.mjs https://play.multidonate.ru/c/<channel>/
```

Screenshots and logs go to `e2e/.artifacts/` (git-ignored).

`e2e/live.mjs` steps are a JSON array of objects, run in order:

| step | does |
|---|---|
| `{"wait": ms}` | sleep |
| `{"frames": n}` | wait until the game rendered n more frames (use this, not fixed waits, on slow machines) |
| `{"walk": "KeyW", "px": 200, "max": 15000}` | hold a key until the player moved `px` (or `max` ms) |
| `{"key": "KeyW", "ms": 2000}` / `{"press": "KeyE"}` | hold / press a key |
| `{"click": "css selector"}` | click a page element (e.g. `.cy-room [data-cyexit]`, the interior's «Выйти») |
| `{"eval": "js", "label": "…"}` | evaluate in the page, print the JSON result |
| `{"shot": "name"}` | screenshot (pauses the engine while capturing; leaves it alone when an overlay or classic mode paused it) |
| `{"stats": 1}` / `{"watch": ms, "every": ms}` | game stats (fps, draw calls, walkers, our vs the site's hero position, overlay, JS heap) and the `go` request rate, once / periodically |

**Safety net.** `e2e/live.mjs` aborts every non-GET request to `/api/` except the presence and movement calls the
site's own city client makes (`/api/city/enter|go|ping|leave|state`) and prints `[BLOCKED]`. So a scenario can
walk, enter buildings, open the mine and switch modes, but can never buy, sell, equip, chat or otherwise act for
the account. Test those actions in the offline demo. (Opening the mine therefore shows the mine screen with an
error inside: its `/api/mine/enter` is blocked. That is enough to test the overlay handling.)

The final lines of every run are a compact summary: `final` (stats), `net` (POST counts per endpoint, `go` total /
last 10 s / smallest gap, blocked requests, any `go` answered with `ok:false` such as «быстро/часто»), `errors`.

What a live run should show (checklist used for releases):

- boot: splash → game, `errors 0`; header, tabs and the 2D city are not visible; `#l3d-host` is `z-index:100`.
- doors: teleport next to a door (`__l3dGame.store.layout.buildings[i].door`), press `E`: the site's interior
  (`.cy-room`) or the mine (`.mn`) is shown and the game is hidden and paused; «Выйти» / `Esc` brings the game back.
- moving: `siteMe` follows `me`; `go` ≤ ~3/s, `notOk` empty.
- F8 several times: classic mode shows the normal 2D city with other players; walking there moves the 3D hero
  after F8; switching to another tab in classic and back with F8 re-enters the city with others hidden.
- `{"watch": 120000}`: heap stays flat (± a few MB), walkers come and go, chat messages arrive.

Note: headless Chromium renders WebGL on the CPU (SwiftShader), so its fps says nothing about real performance and
the first frames may stall for seconds while shaders compile. Measure performance in a normal browser with the
in-game overlay (F3).

## 4. Firefox extension integration (offline)

The Firefox build requires Firefox 140+ (Android 142+): content scripts use `world: "MAIN"` (128+) and AMO wants `data_collection_permissions` (140 / Android 142).
Unlike the live runner, this check installs the actual extension into a disposable browser profile.
It serves a local HTTPS fixture under the matching game hostname (mapped to localhost only in that
profile), so no game account or live server requests are involved. It checks early MAIN-world injection
under strict CSP, no iframe injection, the launcher, fetch/SSE bridging, WebGL rendering, keyboard
movement, camera modes, equipment menus, pointer lock after a real click, and classic/resume using the offline demo.
It also checks that the package carries `background.js` + `notify.js`, and that the update relay works end to end in Firefox
(background event page → isolated `notify.js` → `window.postMessage` data to the page; the worker's one anonymous GET of GitHub's
releases/latest may fail offline, which is a valid answer). Unit tests for the notice: `test/update.test.ts` (mocked fetch and storage).

Install [geckodriver](https://github.com/mozilla/geckodriver/releases) on PATH, then:

```bash
npx playwright install --with-deps firefox
npm run build:firefox -- --prod
npm run pack:firefox
npm run build:firefox -- --only=dev  # expose dev inspection hooks in the offline demo only
npm run e2e:firefox
# Or test a specific installed Firefox and geckodriver:
FIREFOX=/absolute/path/to/firefox GECKODRIVER=/absolute/path/to/geckodriver npm run e2e:firefox
```

The runner also needs `openssl` and `unzip` on PATH to generate a short-lived local test certificate.
Logs, a screenshot and a JSON result are saved in `e2e/.artifacts/firefox/`.
CI runs the same check with Playwright's pinned Firefox build under `xvfb-run` and Mesa software GL.
On Linux without a display use `LIBGL_ALWAYS_SOFTWARE=1 xvfb-run -a npm run e2e:firefox`;
plain headless Firefox may fail to create WebGL without an X server. Manual release testing should also
exercise pointer lock (click, mouse look, Esc, re-lock), fullscreen and sound in a desktop Firefox;
headless rendering does not establish real GPU performance or browser-level shortcut behavior.

To validate and package for Firefox:

```bash
npm run build:firefox -- --prod --only=ext
npx --yes web-ext@10.8.0 lint --source-dir dist-firefox
npm run pack:firefox
```

`data_collection_permissions` needs desktop Firefox 140 / Android 142, so `strict_min_version` is 140.0 and
`gecko_android.strict_min_version` 142.0: lint reports no manifest compatibility warnings. The `none` declaration describes the
existing privacy policy (no developer-operated data collection). All UI markup goes through `setHtml()` (`src/core/html.ts`),
so lint reports no `innerHTML` assignments; passing lint is not an AMO approval.
The resulting ZIP is unsigned and can be loaded temporarily through `about:debugging`.
