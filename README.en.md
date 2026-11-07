# ARAM Helper

[中文](README.md) | **English**

An overlay for League of Legends **ARAM: Mayhem**. Data source: the [aramgg.com](https://aramgg.com) Data API (data.dtodo.cn).

> An unofficial personal tool, not affiliated with Riot Games or aramgg. Please read the [policy notes](#policy-notes) and the [disclaimer](#disclaimer) first.

The interface is available in English and Traditional Chinese (Settings → 介面語言 / Language; by default it follows the Windows language). Augment detection expects a zh-TW game client by default: augment names are matched in the data language, which has to match the game.

## Features

1. **Champ select panel**: shown next to the client during champ select. Your champion's tier, overall rank, win/pick rate; then the tiers of bench and teammate champions (for swaps); recommended summoner spells (one-click apply); builds (with a build picker); and finally the champion's recommended augments.
2. **In-game augments**: press **F7** on the augment selection screen and each card gets a badge with its champion-specific tier and rank (#3/121). The top pick is marked ★, and augments that have a custom guide show 📘. Press F7 again after a reroll, **F8** to hide. (Augment win rates are not shown, per Riot policy; see [policy notes](#policy-notes).)
3. **Hold Tab**: one side shows the recommended build (spells, starting items, core, later items, situational items, skill order) with a dropdown to switch builds (remembered per champion, shared with the champ select panel); the other side always shows your **custom guides** for that champion. While holding Tab you can click the dropdown with the mouse, and drag a panel by its "⠿ Drag" bar to move it (the position is remembered; double-click the bar to reset).
   - Starting items are sorted by games; sets with fewer than 30 games show "Too few games", since aramgg's starting-item data is mostly sparse.
4. **Custom guides**: e.g. "Armor Shock → Cloth Armor › Chain Vest › Thornmail". Can be limited to champions, imported/exported as JSON. A guide is highlighted when one of its augments is on screen.
5. **Match history**: after each game, the augments you actually picked and the result are synced from match history.

## Install

1. Download `ARAM-Helper-x.y.z-portable.exe` from [Releases](https://github.com/MrEast1203/lol-aram-helper/releases) and run it (no installation).
   - The executable is not code-signed, so Windows SmartScreen may block it the first time: click "More info → Run anyway".
2. Requirements:
   - Windows 10/11 (64-bit).
   - The Windows "Chinese (Traditional, Taiwan)" language with its OCR component: **Settings → Time & language → Language & region → Add a language**.
   - The game language must match the data language (zh-TW by default) so augment names can be matched by OCR.
3. Get **your own** aramgg API key at [data.dtodo.cn/developer.html](https://data.dtodo.cn/developer.html) and paste it on the app's Settings page.

## Before you play

- In game: **Settings → Video → Window Mode → Borderless**. In exclusive fullscreen no overlay can be shown without injecting into the game.
- Closing the main window **quits the app**. Minimize it during games to keep the overlay (or enable "minimize to tray on close" in Settings).
- Updating: just run the new exe; it makes the old version quit and takes over.

## Safety (Vanguard)

- Never reads or writes game memory, never injects into the game process, never modifies game files (the lockfile and game.cfg are read-only).
- Only uses the game's local interfaces: the LCU (League Client API) and the Live Client Data API (`127.0.0.1:2999`).
- The overlay is a separate transparent always-on-top window. Augment cards are read from the screen with the built-in Windows OCR (the same level as screen recording software).
- The global keyboard hook only listens for Tab and the hotkeys and never sends input to the game. The overlay lets the mouse pass through, except while the cursor is over one of its panels or buttons (decided by reading the cursor position).

These are design principles, not an endorsement or guarantee by Riot; see the [disclaimer](#disclaimer).

## Policy notes

### Riot Games

- Riot's League of Legends policy says that no website, application or overlay may **display win rates for Augments**. This app shows only augment tiers, ranks and pick rates. Champion and item build win rates are not affected.
- The policy also says products should not remove game decisions, but may highlight important ones. This app only highlights recommendations; the player makes the choice.
- The LCU (League Client API) is **not** officially supported by Riot for third-party applications and may change or break at any time.
- Augment detection reads the screen (OCR); it is not a data service provided by Riot, and Riot has not stated a position on this approach.
- Riot requires products that serve players to be registered on the [Riot Developer Portal](https://developer.riotgames.com). This project is registered (App ID 900373) and waiting for Riot's review.
- As Riot requires, the legal notice below is shown in the app (at the bottom of the main window and under Settings → About and disclaimer).

### aramgg Data API

- Every user must use **their own** API key. Do not share keys, and never commit `.env` or the settings file. The key is only stored locally in `%APPDATA%\ARAM Helper\settings.json`.
- Free plan: 200 credits per day, reset at 00:00 UTC; at most 60 requests per minute.
- As the API documentation recommends, the app reads the free `config.json` to compare `dataVersion` before refreshing, and caches data locally (see "Data cache" below).
- Data follows the aramgg.com refresh schedule and is not real-time. The data belongs to its source; this project contains and redistributes no aramgg data, and the cache only lives on the user's own computer.

## How in-game augment detection works

- Press **F7** on the augment selection screen, or click the "🔍 Scan augments" button on the left of the screen (clicking it doesn't take focus from the game). A progress bar appears at the top.
- The results stay until the next F7 (e.g. after a reroll) replaces them, or **F8** hides them. Hotkeys can be changed in Settings.
- There is no automatic scanning, and the app doesn't track which augment you picked.
- OCR is loaded when the app starts, so the first F7 is as fast as later ones.
- Each scan's capture and results are saved in `%APPDATA%\ARAM Helper\scans\` (last 10), openable from Overview → Scan history. The app log is `app.log` in the same folder.

### Why OCR

Verified that nothing usable exists during a game:

- GameLogs (r3dlog / netlog) contain no augment data.
- LCU logs only have the **post-game** `playerAugment1..6`. During a game the LCU makes no augment-related requests.
- The Live Client Data API has no augment fields either (confirmed with a real KIWI game response). The app still saves raw responses to `live-snapshots\`; if Riot ever adds augment fields, the app switches to them automatically.
- Reading memory or intercepting packets would violate Vanguard/Riot rules, so they are not used.

### OCR approach

Windows OCR reads almost nothing on the full game screen because the ornate card frames confuse it, but it reads text reliably in horizontal strips. So:

1. The first scan sweeps overlapping horizontal strips over the middle of the screen, finds the card title row, and remembers its height.
2. Later scans read only that strip (about 0.05–0.1 s in real games).
3. All three cards on one screen share a rarity, so once one title matches, other titles with OCR typos are matched more loosely within that rarity. Such results are marked "Inferred" on the badge.

## Data cache and credits

- `config.json` (free): checked at startup and every 30 minutes for `dataVersion`, or with "Check for updates" on the overview. The app also reads the latest game patch from Riot's Data Dragon; when the game has a new patch that aramgg hasn't published statistics for yet, the overview says so.
- Champion / augment / item / summoner spell lists (1 credit each): downloaded again only when `dataVersion` changes.
- Champion details (2 credits each): downloaded on demand in champ select or in game, and **valid for the whole game patch (e.g. 16.21.x)**. Minor data updates (16.21.4 → 16.21.5) don't drop cached champions; they are refreshed in the background with leftover credits.
- Background prefetch: missing champions first, then outdated ones, by pick rate, 2.5 s between requests, keeping 80 credits in reserve by default (Settings → Data). Prefetching everything would need 4 + 173×2 = 350 credits, more than a day's quota, so it is not done all at once at startup.
- Cache files are never deleted on a data update; if a download fails, the older cache is used. Cache folder: `%APPDATA%\ARAM Helper\aram-data\`.
- Every request that spends credits (time, item, reason, cost, credits left) is listed under "Credit log" on the overview, keeping the last 300 (`aram-data\credit-log.json`), and written to `app.log`.

## Disclaimer

- This is an unofficial personal tool. It is not affiliated with, endorsed or sponsored by Riot Games or aramgg.com / data.dtodo.cn.
- It is provided "as is", without warranty of any kind, express or implied. The author does not guarantee that it complies with Riot's current or future policies, or that it will not be flagged by anti-cheat systems.
- You use it entirely at your own risk, including any risk to your account (warnings, restrictions or bans). The author is not liable for any loss arising from its use.
- The statistics come from a third-party data source and may be wrong or out of date; they are for reference only.

ARAM Helper isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

## License

Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE):

- Free for personal, educational, research, hobby and other **noncommercial** use, including modifying and sharing (include the license terms when sharing).
- **No commercial use** (e.g. selling it, paid services, internal use at a for-profit company) without the author's written permission.
- This is not an "open source" license as defined by the OSI.

## Development

```bash
npm install
npm start          # run in development
npm test           # unit tests (OCR matching, offer detection, guides)
npm run dist       # build dist/ARAM-Helper-x.y.z-portable.exe
```

In development the app reads the project's `.env` (`ARAMGG_API_KEY=...`, see `.env.example`). Development environment variables:

- `ARAM_SIM=<screenshot.png>`: simulate a game, using the screenshot instead of the screen
- `ARAM_SIM_TAB=1`: keep Tab held during the simulation
- `ARAM_SIM_CS=1`: simulate champ select
- `ARAM_SHOTS=<folder>`: capture each dashboard tab automatically (`ARAM_SHOTS_QUIT=1` quits afterwards)
- `ARAM_DEBUG_MOUSE=1`: log the overlay's clickable areas and switches to `app.log`

If electron-builder fails to extract `winCodeSign` when packaging (no privilege to create symlinks), extract the archive manually to `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`, skipping the `darwin` folder.
