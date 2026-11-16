# Requirements (from the product owner, translated from Russian)

Target: the game site **legiongame.gg** (formerly play.multidonate.ru) ("Легион" / "Поход Легиона", a Twitch-stream idle RPG;
per-channel URL `/c/<channel>/`). The site has tabs: Персонаж (hero: equipment, inventory, skills,
achievements, journal, stats, money, social rating), Город (2D side-scroll city where hero
walkers move, shops, mine), Поход (quest/expedition while the stream runs), Легион (rating),
Новости, Карта мира. Other towns become available during an expedition.

## Vision
A browser extension that **turns the whole site into a real first-person 3D game when no expedition
is running** ("offline mode"). Not just the City tab: the whole site is re-presented as a game.
On load you land in the city (spawn at the fair gate area).

## Must have
1. **First-person walking** through the city with a quality, fully-fledged, **optimized** 3D render
   of everything: buildings, props, ground, sky, lights, **other players' characters** (built from
   their look + gear) and **your own body and the item in your hand** (view-model).
2. **Chat bubbles over heads**: whenever someone writes in the city chat, the text appears above
   that character's head in 3D.
3. **Third-person camera** (GTA-5 style: behind and slightly to the right/above the player), switchable
   with a key, for easier movement and looking at the map.
4. **Game-style menus** (Dark-Souls/Skyrim-like, tasteful, in the game's fantasy style): everything
   from the "Персонаж" tab must be reachable at any time with a hotkey, without leaving the world:
   equipment (what is worn), inventory/bag, skills, achievements, journal, stats (HP, XP, level,
   attack…), money, social rating. You can **equip/unequip items and the 3D character really changes
   clothes**.
5. **Equipment screen camera**: when the equipment menu opens, the camera smoothly pulls out from
   first person to an orbit view around your character so you can see how you look; closing it returns
   to the previous camera.
6. **Whole site as a game**: while an expedition ("Поход") is running, the extension provides the
   needed HUD: you're in the party, what's happening (events, battle), what to type in chat and when,
   buttons/commands. Basically every part of the site should be reachable from inside the game UI
   (city buildings = entry points to shop/forge/tent/trainer/board/mine/...; world map; rating; news).
7. High performance: no lag. Adaptive quality, instancing, merged geometry, baked/cheap lighting,
   pooled textures, frustum culling, LOD for crowds, low GC. Target 60 fps on an integrated GPU,
   graceful degradation on weak machines.
8. **Open-source ready** (GitHub): clean repo, MIT license, README, docs, tests, CI, no proprietary
   assets copied into the repo (assets/art come from procedural generation or are fetched at runtime
   from the site itself), no personal data (no real player nicknames, no cookies/tokens) in fixtures.

## Constraints
- Chrome MV3 extension (also should work in Chromium-based browsers; Firefox is a non-goal for now).
- Must not break the site: a one-key/one-click toggle "Classic site" ⇄ "3D game"; original page JS
  keeps running underneath (it owns auth, the SSE stream `/api/live`, state).
- Be a polite client: do not spam the API; respect the same rate limits as the original city client.
- UI language: Russian (i18n-ready strings in one place), code/comments/docs in English.
