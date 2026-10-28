# Expedition («Поход») — data contract, UI logic, 3D plan

Status: v2 reader + live replay audit (2026-10-28); see §11 for evidence and remaining unknowns. Audience: whoever builds the 3D expedition and whoever records a live one.
Types: `src/quest/model.ts`. Fake: `src/quest/fake.ts`. Tests: `test/quest-model.test.ts`.

**Sources** (read-only, kept out of git in `.local/`):

| file | what it gives |
|---|---|
| `.local/site-new/quest.js` (`window.LGQuest`, 1360 lines) | the only reader of the `q` view on the site: tab, top banner, delay buffer, buttons |
| `.local/site-new/app.js` | `QX` bridge (L1955), SSE wiring (L2305), `/api/qact` results (L2272), loader `questFiles()` (L1944) |
| `.local/site-q/battlecrowd.js`, `crowdcam.js`, `shelf.js`, `battle.js`, `artkit.js` | the overlay helpers `quest.js` loads from `/site/q/…` — fetched once as public static files (2026-10-27) because they are not in `site-new/`. `QBattleCrowd`, `QCrowdCam`, `QShelf`, `QBattle` |
| `.local/site-new/game-data.js` | classes, `baseCmd(role)`; **no enemies or bosses** (grep: 0 hits) |
| `.local/site-new/towngen.js` | biomes of district towns (`NATURE`) |

`world.js`, `lore.js`, `site-ui.js`, `townart.js` have nothing expedition-specific (world.js = walk maps and rng, lore.js =
item descriptions, site-ui = `plural`/`esc`). Not available at all: the server (`src/site/questlive.ts` — named in the
quest.js header), the overlay scene `QScene` (`/site/q/scene.js` → 404), `questfoes.js`, `styles/<style>/enemies*.js`,
`client/battleui.js`, `quest/client/trap.js|rest.js|event.js|shop.js`.

Notation: **[code]** = read directly in the named function; **[guess]** = inferred, needs a live capture; `L123` = line in
the named file (quest.js lines are long; search the function name instead).

---

## 1. Transport and who gets what

- SSE `/api/live`, named event **`q`** (app.js L2305): `ES.addEventListener('q', e => questData(JSON.parse(e.data), d.now))`.
  `d.now` (server ms) re-syncs the page clock `clock(t)` **[code]**. The extension's bridge already tees it to the bus as
  **`sse:q`** and `src/net/site.ts:285` stores it as `store.quest`.
- The tab is gated: `questOk() = ME.hero.qt` (testers' flag, app.js L1945); without it `questData` drops the view and the
  site sends `{on:false}` to LGQuest **[code]**. Buttons/command line are a second flag `hero.qa` (`qaOn()` in quest.js).
  The view files load only when the first `on:true` view arrives (`questFiles()`).
- **Per viewer** **[code: quest.js header]** «Данные — вид похода для этого зрителя (src/site/questlive.ts)». The server builds
  one view per viewer. Fields that are clearly personal (read as «мой/твой» by the site):

  | personal | global (same for everyone) **[guess for the split]** |
  |---|---|
  | `party`, `late`, `lw`, `b.hp`, `b.me`, `b.mf`, `b.sk`, `b.turn`, `b.tg`, `b.tele.ok`, `b.mine`, `vote.my`, `dgn.vote.my`, `loot.my`, `ev.my/used/said/gm`, `tr.acted`, `tr.res.me`, `bg.acted/in/my/area`, `lair.hp/acted`, `lair.is.pick.my`, `lair.is.at.my`, `bg.mech.me` | `on, k, t, ter, n, roll, dl, gather, b.id/round/st/until/form/foes/fighters/cr/two/fd/res`, `vote.opts`, `bg.*` rest, `tr.*` rest, `ev.*` rest, `sh`, `pb`, `town`, `dg` |

  `b.low` (wounded allies for heal targeting) is probably global. `dl` is per channel.
- **Viewer actions** (QX, app.js L1995–1997): `/api/qvote {vid, n}` (click vote), `/api/qact {k, a, …}` (buttons; reply
  arrives later in the `me` event as `results[]` with `x.op === 'qact'`, L2272), `/api/qsay {line}` (the tester command line:
  «same path as a Twitch chat message from you», reply in `results` with `x.k === 'say'`). The extension never calls these
  automatically (fair play: only on the player's click).

## 2. Lifecycle

```
{on:false} ──► gather ──► map + vote «Куда идём?» ──► travel ──► place (stage) ──► map/vote ──► … ──► boss ──► loot ──► {on:false}
                (поход)      (number / click)                    battle | trap | treasure | event | rest | shop | town | dungeon | lair
```

- `k` is the place kind; titles from `KIND_RU` **[code]**: battle Бой, trap Ловушка, treasure Сокровищница, lair Логово,
  rest Привал, shop Лавка, event Событие, map Карта, travel В пути, town Город, gather Сбор отряда, boss Босс,
  dungeon Данж, bossgen «Главный враг» (generated district boss, 22.10).
- **gather**: `gather.until`; people join by typing **«поход»** (`layHint`: «напиши «поход»») or the button `{k:'join'}`.
- **joining while moving**: `cm === false` ⇒ join = queue: `party:'q'` «вступишь на остановке» (`qaSquad`, `layTop`).
  Leave = `{k:'leave'}`, only when `cm !== false`.
- **map/vote**: `vote {id,title:'Куда идём?',end,opts,my,done}`; chat a number or click (`castVote → X.vote(vid,n)`).
  `opts[i][4]` true = «назад» (going back) **[code voteHtml]**.
- **stops**: a stage block appears (`b`, `tr`, `ev`, `sh`, `dgn`, `lair`, `bg`, `loot`) while `k` names the place.
- **town**: `town {id,name}` on ★1–2 district stops; button «🏘 Войти в город» calls `X.openTown(id)` (needs hero `cy && tw`).
- **end**: `{on:false}` — the site clears the buffer at once (`data()`: `if (!q.on) { RAW.length = 0; … }`).
- What happens between boss end and `{on:false}` (results screen? `loot`?) is **[guess]** — the fake uses `b.res` + `loot`.

## 3. Stream delay (must replicate exactly)

`quest.js data()/tick()/view()/sec()` **[code]**:
- every view gets `_rx = now()`; the buffer keeps 80 (`RAW`). Shown view = the newest with
  `(q.at || q._rx) + delayS(q)*1000 <= now`; nothing ripe and nothing shown → `RAW[0]`.
- `delayS(q) = max(0, (q.dl || 0) + adj)`; `adj` = `localStorage['lgQDelay']`, clamped −10…30, buttons «− / + / как у стримера» (adj=0).
- timers: `sec(until) = max(0, ceil((until + delayS*1000 - now)/1000))`, refreshed every 250 ms for `[data-until]`.
- **own state immediately** (`view()`): from the newest view merge `b.turn`, `b.tg` (same battle and round), `b.tele.ok`
  (same word), `tr.acted` (same trap, no result yet), `bg.acted` (same round), `lair.is.pick.my`, `lair.is.at.my`,
  `vote.my`, `dgn.vote.my`, `loot.my`, `ev.my/used/said`, plus a clicked vote for 15 s (`PV`).
- `late: [[serverMs, what, sLate]]` → toast «Опоздал на N с» once per `at:what`, ignored after 30 s (`lates()`).
- Implemented as `DelayBuffer` + `mergeOwn` in model.ts (and already in `src/quest/index.ts`).

## 4. Top-level fields (`QuestPayload`)

| field | type | meaning | where read |
|---|---|---|---|
| `on` | boolean | expedition running | `data()`, every renderer |
| `dl` | number s | stream delay (channel) | `delayS` |
| `now` | ms | server clock at send | app.js `questData(d, d.now)` |
| `at` | ms | snapshot time (delay base) | `tick()` `(q.at \|\| q._rx)` |
| `late` | `[ms, what, s][]` | my commands that missed the window | `lates()` |
| `k` | QuestKind | place kind | `KIND_RU[v.k]`, `layHint` (`rest`/`travel`/`town`/`gather`) |
| `t` | string | place title («Перекрёсток») | `layTitle`, banner |
| `ter` | string | terrain name (stream backdrop) | `layTop` subtitle; battle.js `foeTerrain(terrain)` |
| `n` | number | party size («Всего в отряде: N») | `layTop`, `skParty` |
| `roll` | `{by, n}` | entry roll: who and the number | `layTop` «бросок by: n»; crowdcam `frontsFor(roll)` |
| `party` | `'in'\|'q'\|'ghost'\|other` | me: in party / queued / ghost / out | `partyOf`, banner |
| `cm` | boolean | `false` = party moving, join → queue, no «покинуть» | `qaSquad`, `layTop` |
| `gather` | `{until}` | gathering window | `layHint`, `tabHtml` |
| `dg` | string | danger note (★3+: losses on death) | banner «⚠» |
| `lw` | `[name, pct][]` | my worn items ≤30% durability | `lwHtml` |
| `town` | `{id, name}` | district town at this stop | `tabHtml`, `layAct` |
| `b` `bg` `lair` `tr` `ev` `vote` `dgn` `loot` `sh` `pb` | objects | stage blocks (below) | |

Precedence when several blocks coexist (tab, `layAct`) **[code]**: `b&&b.gb&&bg` → `b` → `bg` → `dgn` → `lair.is` → `lair` →
`tr` → `ev` → `vote` (not done) → `loot` → `sh` (non-empty) → hint by `k`. The banner (`bannerHtml`) differs: `b` (unless
`b.gb&&bg`) → `lair.is` → `bg` → `tr` → `ev` → `dgn.vote` (open, `mode!=='ring'`) → `vote` → `loot` → generic. `stageOf()` in
model.ts follows the tab order.

## 5. Battle (`v.b`)

Fields **[code: meIn, battleHtml, qaBattle, squad, lastLine, castHtml, resHtml, fdHtml, view]**:

| field | type | meaning |
|---|---|---|
| `id` | string\|number | battle id (keys `view()` merges) |
| `title` | string | «Бой · title» (falls back to `v.t`) |
| `round`, `maxR` | number | «раунд r из maxR» (`maxR` absent for gb) |
| `st` | `intro\|party\|hit\|tele\|mech\|trans\|end` | stage: «Бой начинается…», «Ход отряда», «Удары!», «Ход врага», «Механика босса», «Новая фаза босса», «Бой окончен» |
| `until` | ms | end of `party`/`tele` window |
| `hp` | number\|null | **my** hp 0..1; `null` = not in this battle; `0` dead; `<0` fled |
| `me` | number | my index in `form`; `-1` = not drawn |
| `mf` | `[role, side]` | I am in formation but beyond the drawn places («дальше схемы (420)») |
| `form` | `[login, role, side?, ?, shield?, rank?][]` | drawn heroes. `p[3]` never read **[unknown]**; `def = 5 - (p[5] \|\| 2)` |
| `fighters` | number | all fighters incl. reserve («на экране N из fighters») |
| `foes` | `[side, type, lead, hp01, name][]` | enemies: `f[0]` side, `f[1]` art type, `f[2]` leader/boss (drawn ×1.25), `f[3]` hp 0..1, `f[4]` name |
| `low` | `[login, name, hp01][]` | wounded allies (heal target buttons, first 6) |
| `sk` | `[word, cd, kind][]` | my skills: chat word, cooldown in turns, `kind==='heal'` targets allies |
| `turn` | string | my accepted move: `melee ranged magic heal guard pull auto` or a skill key (`turnRu`) |
| `tg` | `[target, side]` | target of my move: login / `'lead'` (leader) / `''`; side L/R/F |
| `tele` | `{word, text, ok, got, need}` | enemy telegraph: type `word`; `got/need` how many typed it; `ok` = mine accepted |
| `mine` | `{k:'tele'\|'party', r, ok?, me}` | my last result (see below) |
| `res` | `{how, xp, coins}` | `how`: `win` Победа, `away` Враги сбежали / Босс ушёл, `lose` Отряд разбит, `retreat` Отступление |
| `fd` | string[] | battle feed; site hides it during `tele` («в нём может быть слово»); mass death comes as «💀 Пало N игроков» |
| `cr` | `{fr: Side[], cam?, chaos?}` | fronts (≥2 = surrounded), camera, «врасплох» (roll 1: party unformed then `reform`) |
| `two` | boolean | two-front gate battle («Врата башни», battle.js) |
| `gb` | `{name,title,phase,phases,hp,mech{icon,name,text},forbid}` | generated boss inside a battle; `forbid` = «Босс запретил прямые слова — пиши синонимом» |

`mine.me` (lastLine): party turn `n` hits, `m` misses (`m===n` → «мимо»), `d` damage, `c` crit, `e` enemy name, `k`
melee/ranged/magic, `sk` skill key, `heal`, `healed` (I got healed), `dead`; enemy turn `hurt`, `by`, `dead`, with
`mine.ok` = the party blocked (★2–★5: «Отбили… но N прорвался к тебе»).

**Me** (`meIn`): `out` (hp null) / `dead` (0) / `fled` (<0) / `on` (index ≥0 or `mf`) / `reserve` (in battle, off-frame).
Side = `form[me][2] || 'R'`.

**Round flow [code stage labels; order and durations are guesses]**: `intro` → `party` (we type, `until`) → `hit` (blows
animate; `castHtml` plays my skill FX when `st==='hit' && mine.k==='party'`) → `tele` (enemy telegraph, type the word,
`until`) → `hit` (enemy blows: `mine.k==='tele'`) → next round … → `end` + `res`.

**Fronts** (crowdcam.js `frontsFor`) **[code]**: roll 1 → `L,R,F` (and `chaos`), 2–9 → `L,R`, ≥10 → `R`. `multi(b) = cr.fr.length>1 || two`.

**Formation** (battlecrowd.js) **[code]**: zones `legionary/paladin 0` (shields) → `rogue/recruit 1` → `archer/mage/
necromancer 2` → `priest 3`; inside a zone shield first, then better armour (`def`), then login. Single front: columns from
the front line backwards, depth rows fill middle-out. Surrounded (`ringLayout`): the party in the field centre, each hero's
wing from the server (`side`) or round-robin; shields on the outermost slots, priests inside. Camera `camFor(fighters)`:
≤50 → 1, 100 → 0.77, 200 → 0.6, floor 0.45; cave/mine/dungeon (`Пещера`,`Шахта`,`Данж`) halve the cap. Foes on screen
`foesFor(cam)` = 6…20. Ported (simplified) as `arenaFormation()` / `arenaFoes()`.

**Skills** (`QBattleCrowd.SK`) **[code]**: grad 🏹 Град, pricel 🎯 Прицел, vspyshka ✨ Вспышка, oznob ❄️ Озноб, natisk ⚔️ Натиск,
stoyka 🛡 Стойка, svet ☀️ Свет, aura 💛 Аура, dlan 🤲 Длань, dlan_light ☀️ Свет длани, siyanie 🌟 Сияние, obereg 🔰 Оберег,
yad 🧪 Яд, vspinu 🗡 Вспину, proklyat 💀 Проклясть, vytyanut 🩸 Вытянуть, podnyat 🦴 Поднять, obchistit 💰 Обчистить,
skel ☠️ Скелеты. Ally skills: dlan, obereg, siyanie. FX per skill (`fxSvg`): arrows on an arc, bolts, rings, heal «+N❤».
The overlay gets a per-turn event `B.ev {hits[{by,sk,e}], heals[{by,sk,to,d}], acts[{by,sk,to}]}` (`skillList`) — **that is
the overlay's battle state; whether any of it reaches the site view is [unknown]** (quest.js reads only `b.mine` for me).

**Enemy attack kinds** (battle.js) **[code, overlay]**: `shield` (frontal), `duck` (from above), `scatter` (area); moves
`lunge charge leap swoop throw spit wave burst`; per pack: wolf, skeleton, bandit, boar, drowner, spider, bat. Whether the
site view tells the kind as `tele.kind` (**[live]**, shield observed in fixture 1); the word (`tele.word`) is what counts for the player.

## 6. Generated boss (`v.bg`, with or without `v.b.gb`)

**[code: bgHtml, qaBoss, zonesHtml, bannerHtml, sayHush]** `bg {name, title, danger(★), ph, phs, hp 0..1, adds:[name,count,hp01][],
st:'party'|'boss'|'trans'|'end', acted, in, my(hp 0..1), limit, round, form(string, boss form), rage, zn, area, mech}`.
- adds: «пиши «удар <имя> N»: пока живы, урон по боссу вдвое меньше».
- `mech {id, name, icon, fam, text, word, words[], opts[], zones[], any, how, tip, fake, me, until, need, got}`:
  `fake` = feint: **do not type**; `fam:'silence'` = silence (except ids M94, M55); `fam:'position'` + `zn` = arena platforms;
  `me` = «Цель — ты!»; `how` = exact chat line; `word`/`words` = words to type; `opts` = numbered choices; `need/got` counter.
  `M32` inverts zones (listed zones survive).
- `zn {a: [n, neighbours[], polygon[[x,y]]][], gone[]}`, `area` = my platform; jump: «прыжок N» to a neighbour (any if `mech.any`).
- `b.gb` present together with `bg` = newer combined form (25.10): banner shows boss, tab shows `bgHtml` with the battle
  action panel. `b.st` for gb: `tele` means «Ход босса», `mech` «Механика босса», `trans` «Новая фаза».

## 7. Other stage blocks

- **Lair of Закхуэль** `lair {hp, st, phase, round, acted, tele{word,got,need,ok}, spell{words[],until}, mass{words[]}, deal,
  is}`; islands `is {pick{until,my,cnt[4]}, doom{until,opts,cnt{n,none}}, at{my,cnt}, gone[], nb{n:[…]}, sil{n}}`. Chat: island
  number 1–4, «прыгнуть N» (neighbour), spell phrase, «сделка» (half hp for coins). **[code islesHtml, lairWords, lairHtml]**
- **Trap / treasure** `tr {name, icon, type, st:'intro'|'act'|'wait'|done, until, word, gas, how, intro, acted, actedN, total,
  n, len, max, best[[guess, marks, name]], taker, tre, res{me{dmg|'dead', gain, xp, it[], st}, text, sv, win}}`. Types
  **[code qaTrap, skTrap]**: `react` (type `word`), `gas` (**silence**), `ropes` (cut rope 1..n), `ceiling` («держу»),
  `bait` (one takes: «взять»), `greed` (grab and run), `code` (len distinct digits 1..max; `best` with g/y/r marks),
  `plates` (path of plate digits 1–9), `share` («поровну»/«себе», final). Names hint visuals: «брев/маятн» log pendulum,
  «стрел» arrows, «валун» boulder. `res.me.st`: `dead|hurt|ok|pass|by`, suffix `~` = counted inactive.
- **Event** `ev {look, name, icon, st:'vote'|'on'|'done', until, my, used, said{text}, cmds[[word,desc]], last, res{text},
  votes{help,rob}, purse, gm[[me,him,r,n]], thrown, need, filled, pool, prices{heal,cleanse,bless,revive}, done{…}, cursed,
  ghosts[[login,name]]}`. Looks **[code qaEvent]**: `traveler` (vote «помочь»/«обобрать»), `dice` (d20 vs vagrant, «ставка N»
  5…200, 3 games), `well` (throw a coin, 3 max), `priest` (donate to the bowl; heal/cleanse/bless/revive rituals).
- **Shop** `sh {name, icon, items[{id,name,rarity,price,qty,curio,slot,stats}]}`; shelves of 3 (`QShelf.rows`, numbers left→right,
  top→bottom = «купить N»); «продать N» (bag number), «украсть N».
- **Dungeon** `dgn {name, at, room{floor,seed,…}, fl, rn, esc, vote{id,title,end,done,win,my,mode,opts[[n,exitKey,label,icon,votes,back]]}}`.
  Rooms are drawn by `MDDoodle.location('dungeon',{room})` (`questdungeon.js`); exits `.dg-ex[data-k]` match `opts[i][1]`.
  `esc` = collapsing: «бежать». `mode:'ring'` votes are not shown on the site.
- **Loot** `loot {name, until, n(votes), my}`: chat a number, a nick or «случайно».
- **Place buttons** `pb {b:[{t (line sent as is), l (label), c:'main'|'warn', g:''|'tg'|'act'|'esc', x{k:'flee'|'pay', pct, role}}]}`:
  the streamer's `siteBtns`; `warn` needs a second press; `esc`/`tg` only for those in the battle; `x.role` limits classes.

## 8. Chat commands (what the viewer types)

| when | command | source |
|---|---|---|
| gather / any time out of party | **поход** | `layHint`, `tabHtml` |
| party turn | class base: **удар** (legionary, paladin, rogue, recruit), **выстрел** (archer), **магия** (mage, necromancer), **лечить** (priest) — `LGGameData.baseCmd` | `cmdFor` |
| party turn, surrounded | base + side: **удар лево / право / вдали** (healers never) | `cmdFor`, `SIDE_CMD` |
| party turn | skill word from `b.sk[i][0]` when `cd===0` (e.g. «град») | `battleHtml` |
| enemy turn | `b.tele.word` (drawn on canvas, not copyable — streamer's rule 26.10) | `qaBattle`, `ncWord` |
| vote «Куда идём?», dungeon | number of the option | `voteHtml`, `dgHtml` |
| loot | number / nick / **случайно** | `lootHtml` |
| event traveler | **помочь** / **обобрать** | `evHtml` |
| event others | `ev.cmds[i][0]`; dice **ставка N** **[code pbWarn/qaEvent labels]** | `qaEvent` |
| shop | **купить N**, **продать N**, **украсть N** | `shopHtml` |
| trap | `tr.word`; gas — silence; others via `_l` labels **[guess: labels = chat lines]**: «резать N», «держу», «взять», «поровну», «себе», «код 123», «путь 123» | `qaTrap` |
| boss | `mech.how` / `mech.word(s)` (lower-case); **прыжок N**; adds **удар <имя> N**; feint/silence — nothing | `bgHtml`, `zonesHtml` |
| lair | **1–4**, **прыгнуть N**, spell words, **сделка** | `islesHtml`, `lairWords` |
| dungeon collapse | **бежать** | `dgHtml` |

Buttons (`/api/qact` payloads, testers only): `{k:'b', a:'base'|'melee'|'sk', w?, t?, s?}`, `{k:'join'}`, `{k:'leave'}`,
`{k:'ev', a:'help'|'rob'|'bet'|'coin'|'donate'|'heal'|'cleanse'|'bless'|'revive', n?, t?}`, `{k:'tr', a:'rope'|'hold'|'take'|'eq'|'me'|'code'|'path', n?, s?}`.
The 3D client must not send any of these by itself.

## 9. Art selection

- **Foes**: `QBattle.foe(type, …)` — art from the active channel style `styles/<style>/enemies.js` (fallback «Легион», then
  built-ins `wolf`, `skeleton`, `bandit`, then a dark «?» silhouette). Known keys: `wolf skeleton bandit boar drowner spider bat`,
  `hw_*` (Изнанка / Hollow — Halloween), `dg_*` (dungeon packs), `dgb_*` (dungeon bosses). `f[2]` = leader → ×1.25 + crown,
  `flip` for the left front. **[code battle.js]**
- **Terrain / backdrop**: `v.ter` (Russian name) → overlay `QScene.draw({terrain, seed, time, cam})`; `QScene.ICON[ter]==='river'`
  puts foes on the near bank; `QScene.walk(ter).lowFoes` for mounds/gorges; special-cased: `Река, Брод, Водопад, Старый мост`
  (river), `Курган, Ущелье` (low foes), `Шахта` (props), `Пещера, Шахта, Данж` (tight: half crowd, depth 0.78), `Врата башни`
  (two fronts). Full terrain list is **[unknown]** (scene.js not public).
- **Boss**: the site draws only a silhouette (`bossArt`); real boss art on stream is **[unknown]**.
- **Biome**: not in the `q` view as far as quest.js reads. District towns have `biome` (`meadow forest taiga ice mount swamp
  ash desert coast blight ruin`, towngen.js `NATURE`) — reachable via `v.town.id` → world data **[guess]**.
- **Heroes**: the site's doodle of each login (`X.doodle(login, hero, mood, 'battle')`); in 3D we use our own avatar system.

---

## 10. 3D design note

One feature (`src/features/expedition.ts`, later) owns a separate scene (not the city); it reads `store.quest` through
`DelayBuffer` → `stageOf()` and swaps a scene module per stage. The party = `form` (battle) or `n` placeholder cats
(elsewhere; the view has no party list outside battles **[code: skParty draws `n` figures]**).

| stage | 3D | driven by |
|---|---|---|
| gather | gate square, cats run in and line up; counter on a banner | `gather.until`, `n`, `party` |
| map / vote | **crossroads with signposts**: one post per `opts` (number + label + live vote count as a flag height); «назад» post points back; the winner post lights up when `done`; click = `X.vote` (only on the player's click, only `party==='in'`) | `vote.*` |
| travel | path through a biome (terrain → palette/props), party walks in a column, camera follows; length ~ stage time | `k:'travel'`, `t`, `ter`, `n` |
| battle | arena from `ter`; party via `arenaFormation` (zones coloured like the site: щиты #c9a36a, ближний #d07a5a, стрелки/маги #6f9fd8, жрецы #79c98f), foes via `arenaFoes` with hp bars from `f[3]`; `party` = glow on my cat + command plate; `hit` = lunges + skill FX on my cat (`mine.me`), damage numbers; `tele` = enemy wind-up + the word drawn on a canvas sign (no DOM text); `end` = victory pose + `res` | `normBattle()` |
| surrounded | ring formation, foes on L/R/F, camera higher | `cr.fr`, `cr.chaos` (start scattered, then regroup 1.4 s) |
| boss (bg) | big boss model in the arena, phase colour/rage aura, adds; `position` mech = numbered platforms from `zn` (polygons → floor tiles, `gone` sink, `zones` glow red/green, my `area` marked); feint/silence = red «МОЛЧИ» banner | `bg.*`, `b.gb` |
| trap | per `type`: gas cloud, ropes over a pit, falling ceiling, plates grid, rune door with digits, bait chest, greed collapse, share chest; timer as a sand-glass | `tr.*` |
| treasure | rune door / vault (`tre`), chest opens on `res` | `tr.tre`, `tr.res` |
| rest | campfire circle (like `skRest`), cats sit around, ambient night | `k:'rest'`, `n` |
| shop | awning stall with shelves of 3 numbered items (`QShelf` order), merchant cat | `sh.items` |
| event | traveller cart / dice table / wishing well / priest altar | `ev.look` |
| town | load our existing district-town world (towngen) | `town.id` |
| dungeon | room with exits as doors, number + votes above each | `dgn.vote.opts` |
| loot | item on a pedestal, vote count | `loot` |

All time-dependent animation keys off the **delayed** view and `secondsLeft(until, delayS, now)`; own confirmations
(`turn`, `tele.ok`, `my`) show at once. Budget: one shared instanced cat mesh for ≤ 50 cats + impostors beyond; foes
instanced per type; ≤ 15 draw calls is realistic only with instancing — battle at 200 fighters needs the crowd camera rule.

### Risks / unknowns a live recorder must target

Record raw `sse:q` frames with receive time (JSON lines) for one whole expedition, ideally twice: once in the party, once as a
spectator (and a tester account with `qa`). Then answer:

1. `k` values actually sent per stage, and whether `k` stays `battle` during `b` / `bossgen` during `bg`; is `boss` (non-generated) ever sent and with which block?
2. Exact `b.st` sequence and durations (`intro → party → hit → tele → hit …`?), `until` values per stage, is `until` present in `hit`/`intro`?
3. `form[i][3]` meaning (name? hp? reserve flag?) and `form[i][5]` scale (rank 0–3?).
4. Does the view ever carry the overlay's per-turn battle event (`ev.hits/heals/acts`) or other heroes' hp? (only `low` known.)
5. `foes[i][3]` scale (0..1 assumed from the bar width) and whether dead foes stay in the list; foe count vs `foesFor(cam)` cap.
6. `tele` extra fields (attack kind `shield/duck/scatter`, `k`, `sig`)? `b.mine` shape for both turn kinds; `mine.r`.
7. `vote.opts[i][2]` meaning (description? terrain?); `vote.win` after `done`; how long a done vote stays.
8. What arrives after the boss: `res`, `loot`, a summary block? Is there a final view before `{on:false}`?
9. Frame rate of `q` events (on change only, or periodic?) and size — decides the 3D update strategy.
10. `at` present on every frame? `now` on every frame? Typical `dl` value.
11. Terrain list (`ter` values) and whether any biome/season field exists (`v.bio`?) for travel scenes.
12. Party list outside battles: is there any (`v.p`?) or only `n`?
13. `bg` vs `b.gb` timing; `bg.st` values; `mech.fam` values seen; `zn` coordinate space (stream px 1920×1080 assumed).
14. `travel` duration and whether progress along the route is sent (map position, `v.map`?).
15. `lair`, `dgn`, `ev.dice/well/priest`, trap types `ropes/plates/greed` — shapes are code-derived only; capture each once.
16. `party` values beyond `in|q|ghost` (e.g. `out`, `''`), `cm` in each stage.
17. `late` format confirmation (`[ms, what, s]`).

## 11. Live evidence audit (2026-10-28)

Sources: sanitized `test/fixtures/quest-live-1.json` (**111 q frames**, spectator) and `quest-live-2.json` (**83 q frames**, queue snapshot; source may still grow). The first raw file's 178 lines are **all transport events**, not 178 expedition payloads. Sanitizer keeps only q envelopes, substitutes every known identity with playerN (also inside result prose), drops chat/feed and test/debug blocks. No account action was taken. Regression: `test/quest-live-replay.test.ts` replays every saved q through guard, buffer, card and adapter.

### Each former recorder unknown (§10) revisited

| # | Status and evidence (fixture 1 unless stated) |
|---|---|
| 1 | **Observed:** k=battle (27), map (20), treasure (11), lair (5), rest (4), travel (1), then 43 off frames. b belongs to battle; no bg/boss/dgn in either fixture. General boss routing remains code-derived. |
| 2 | **Resolved for captured battle:** party → hit → tele → tele2 → party, eventually end; another battle intro occurs later. until is present in intro/hit/tele2/end and may be the **old action window**, not a transition deadline. Never infer animations or fight end from until alone. |
| 3 | **Partial:** every form tuple has index 3 = 0 and index 5 = 2 here. Meaning/range still unknown; do not infer HP from index 3. |
| 4 | **Observed absence:** no ev.hits/heals/acts nor full other-hero HP block in recorded b. No overlay-level information can be reconstructed from absent data. |
| 5 | **Resolved:** foes HP spans 0..1; dead foes remain in array; largest observed group = 6. Greater population caps remain code-derived. |
| 6 | **Resolved discriminator:** tele keys word/kind/text/need/got/ok; kind=shield observed. mine keys r/k/at/tk/ok/me; spectator me is null. Own successful action subshape and other tele kinds still need an in-party recording. |
| 7 | **Partial:** opts=[n,label,'',votes,extra] (5 slots); index 2 is empty here. Done votes carry win=0, so **do not reinterpret zero as option 1** or claim a chosen winner. Meaning of extra / nonempty index 2 unresolved. |
| 8 | **Important negative evidence:** b.res={how:'away',xp:8,coins:0}, four frames; tr.res has win/text/okN/me/sv, including numeric sv=1. No top-level res, no loot, no post-boss summary in either fixture. The spectator stream later goes off, but this is NOT proof of a completed boss kill or reward path. Fake boss/loot remains synthetic demonstration only. |
| 9 | **Observed:** irregular updates (fixture 1 receipt gaps 169..53602 ms); queue fixture also sends repeated unchanged map views. Do not assume a fixed SSE frame rate, nor treat receipt gaps as exact server stage durations. |
| 10 | **Resolved:** dl=4 throughout both fixtures; now present on every frame; at present on all on frames, omitted on off. Buffer retains receive-time fallback. |
| 11 | **Observed:** Мельница, Пещера, Врата башни, Чёрная башня, and empty ter. No bio/season/progress field. This is not an exhaustive terrain list. |
| 12 | **Resolved within captures:** only n outside b; form is battle-only. Roster reuses known cats and fills anonymous silhouettes, never claims unknown cats are identified. |
| 13 | **Unresolved:** no bg/b.gb/zn frames. Existing coordinate interpretation remains explicitly code-derived/inferred. |
| 14 | **Partial:** exactly one travel q, with ordinary on/k/t/ter/dl/at/n/roll/party/late/cm/now fields; no route progress. Duration cannot be recovered from a single transition sample. |
| 15 | **Resolved lair basic shape:** phase/st/round/hp/acted plus optional rt. st intro→party→hits→boss; hp=null means spectator's own HP, **not boss HP**. No islands block in this encounter. dgn, ordinary events and other trap families remain uncaptured. |
| 16 | **Resolved:** spectator party=null (or absent on off), queued participant party='q' throughout fixture 2 (83 map frames); cm can be false/true. Queue is not membership, and no late-join transition was captured. |
| 17 | **Unresolved:** every late=[]; tuple format is still code-derived. Do not equate party='q' with a late-command notice. |

Additional live fields formerly lost: roll.tier is a **string** (bad/mid/good observed; n=7/bad and n=8/mid prove tier cannot simply be inferred from the two-front n≤9 threshold); b.ambush/more/press/drop retained in SceneState.battle; tele.kind retained. q.tr may omit name entirely; type=code identifies the treasure. Actual rune code has len=4/max=6/per=3, **duplicates allowed**; rd2 contains door/dbl/ep/ang/ph/vote/left/my. tr stages intro→act→fire→done, best rows are [code,colour pattern,playerN], result prose also has playerN. The fake now uses four runes with repeats allowed and tele2 enemy-resolution stages. Battle feed is intentionally excluded from sanitized fixtures because it is player/chat-derived prose; live runtime still supports the feed.

### Exact current reader: puzzles, Halloween and goblin fair

Authoritative source now: `.local/site-1028-1307/quest.js`, functions pzHtml/qaPz/hwEvHtml/hwView/gobHtml/gobView. No Halloween/goblin/puzzle q occurs in these recordings, so the following are **[code], not live-confirmed**.

- Puzzle kinds are riddle/count/runes/cups/changed/letter/scales. «Загадка старого камня»=riddle; «Равенство рун»=runes; «Кубики с надписями»=cups; «Пропавший предмет»=changed; «Весы отряда»=scales. Titles are server-provided, never discriminators. heal/gone are not additional pz kinds in this reader. Do not invent a healing puzzle.
- «Повтори последовательность» belongs to ev.look=skeldance (Halloween), not a missing pz kind. ev.hw identifies Halloween; look=trick/fortune/cauldron/lostghost/skeldance. Public stages vote/on/pay/ingr/brew/riddle/pause/show/input/done are reflected as instructions, not buttons that send account actions. ev.bt is [label,chat line,optional style], **unlike ordinary ev.cmds**. how/q/price/pool/picked and public counters are displayed.
- Dance sq entries are [l|r|j|c, shownAt]. Reveal each additional step only at shownAt + stream delay; steps already present in the delayed view stay visible. Latest own my merges immediately for the same event id; seq is only displayed on done. Input is one message chain, using words влево/вправо/прыг/хлоп (abbreviations л/п/в/х). Never show a solved chain during input.
- Goblin fair is ev.gob + look=goblin, game gk=shell/coin/hilo, stages ask/bet/shuffle/guess/reveal/next/done. me tuple=[vote,bet,answer,result,delta,total,played]. Only own vote and same-game bet/answer merge immediately; payout/result stays delayed. Betting instruction is ставка N with server min/cap; guesses use ev.bt exact lines. Shell cups animate only while shuffle; hilo first card appears only in guess. rv public result appears only reveal/next. Fair participation requires party=in (Halloween also allows ghost per reader).
- Test/debug demos: pz-* (all seven), hw-trick/fortune/cauldron/lostghost/skeldance-show/skeldance-input, gob-shell/coin/hilo plus gob-ask/bet/shuffle/reveal/next/done. All are synthetic source-contract examples, not fabricated live captures.

Rune door 2 own-state overlay is now merged like the reader: only rd2.left/my update immediately, public door/anger/vote/result remain delayed. Acted does not lock further rune attempts; exhausted attempts show a waiting notice. Public rd2.ph=vote shows «забрать / дальше» and the shared-attempt ×2 risk. SceneState retains rd2/per. `pb.b` place-action descriptors (including warning flee/pay commands) are retained as `placeActions` metadata but intentionally not promoted to primary command chips: 3D does not execute dangerous actions or emulate the site's double-confirmation UI.
