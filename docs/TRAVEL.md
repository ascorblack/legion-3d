# Путешествие (towns and channels from inside the 3D game)

`src/features/travel.ts` (feature `travel`), `src/ui/travel.ts` (the page), `src/net/town.ts` (`townsView`, `campName`),
`src/net/travel.ts` (search/list helpers). Tab «Дорога» in the «Мир» ribbon, hotkey **L**, pause-menu item «Путешествие»,
setting «Путешествие» (Прочее) switches it off.

| what | request | when |
|---|---|---|
| towns list | `GET /api/city/towns` (the site's own town picker read) | the page opens / «Обновить»; cached 30 s |
| own channel list | `GET /api/mylist` | «Каналы» opens |
| streamer search | `GET /api/find?q=` | only while typing: ≥ 2 chars, 450 ms debounce, older request aborted, 429 → message |
| channel picked from the search | `POST /api/mylist {act:'open'}` then navigation to `/c/<login>/` | after «Да, перейти» (exactly start.js) |
| channel picked from the own list | navigation to `/c/<login>/` | after «Да, перейти» |
| town click | `LGCity.town(id)` (the site's `townGo`, which makes its own `/api/city/enter` etc.) | click on a card |

Nothing is requested in the background. Town switch: veil «Дорога в …», `LGCity.town(id)`, the town detection
(`src/net/site.ts`) rebuilds the layout, `ctx.onWorld` puts the hero where the site has him (`LGCity.debug().me`) or at
the spawn. 12 s without a new layout → message. Greyed cards carry the reason (expedition, home district drawn).

Camp name: `campName(style, MDDoodle.names)` — the style's own `names.places.camp`, else «Кошачий привал» for `cats`,
else «Перепутье». Used by the page, the travel toast, the 3D name board on the camp's back palisade (`src/world/camp.ts`)
and the debug dimension portal.

Contract (`src/data/site-contract.json`): `LGCity.town (travel)`, `DOM .cy-town`, `DOM .cy-tp` (runtime, degrade),
`/api/find`, `/api/mylist` (static, start.js). Offline check: `dev/travel-shots.mjs` (needs `npm run build`).
