# Legion 3D — explore the Legion game in 3D

**Short description:** Unofficial 3D mode for the Legion game: explore the city, meet players, enter shops and visit the mine.

## Full description

Walk through the Legion game's night-time city on play.multidonate.ru in first or third person. See other players and their in-game chat bubbles. Explore 3D shops and the mine; use equipment, bag, map and journal menus. Adaptive quality scales to your computer. Chat and game actions use the website's ordinary client.

Controls: WASD to move, Shift to run, Space to jump, mouse to look, V to switch camera, E to interact, Tab for menus, Enter for chat and F8 to return to the classic website. Open a game channel at `https://play.multidonate.ru/c/<channel>/` and sign in as usual; Chrome 111+.

**Disclaimer:** unofficial fan project, not affiliated with the Legion game's developers or MultiDonate. It runs only on game channel pages. No data collection or analytics; preferences remain local. The only other network request is made by installs from GitHub (never by store installs): once every 12 hours it reads the latest version number from api.github.com — anonymous, no cookies, nothing about you — and can be switched off in settings. [Privacy policy](https://github.com/ascorblack/legion-3d/blob/main/docs/PRIVACY.md).

- Suggested category: Fun.
- Single purpose: add an optional 3D game mode and interface to the Legion game website.
- Host match justification: `https://play.multidonate.ru/c/*` contains the game's City view. Two packaged content scripts render 3D and read the current page's game state for synchronization. No other websites are accessed.
- Remote code: no. All executable code and artwork ship with the extension.
- Data usage answers: no user data collected, sold or transferred; only preferences remain in the website's localStorage. Game data is processed locally on the page; the site's own client communicates with its game servers.
