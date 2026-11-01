# Riot Developer Portal 註冊草稿

在 developer.riotgames.com 選 **Register Product → Production API Key**。註冊前要先勾選同意 General Policies 和 Tournament Policies。Tournament Policies 只約束使用錦標賽 API 的產品，本程式沒有用到。

送出前要準備：

- **Product URL**：repo 目前是私人的，審核人員看不到，要先準備一個公開網址（見下方「Product URL」）。
- **截圖**（如果之後被要求提供）：覆蓋層預設不會被截圖拍到。截圖前先到「設定 → 截圖/錄影時隱藏覆蓋層」取消勾選，拍完再勾回去。建議拍這三張：
  - 選角面板
  - 局內按 F7 後的海克斯徽章
  - 按住 Tab 的出裝和攻略面板

---

## Product Name*

```
ARAM Helper
```

## Product Description*

這一欄有字數限制。下面兩個版本選放得下的那個，把 `<Product URL>` 換成 `https://mreast1203.github.io/lol-aram-helper`（大約多 30 個字元）。被刪掉的細節放在產品網址的 README，以及送出後的 App Note 裡。

**版本 A（約 915 字元）**

```
ARAM Helper is a free, noncommercial Windows companion app for League of Legends ARAM: Mayhem. It shows static, pre-game statistics: champion tiers, summoner spells and builds in champ select; on the augment selection screen, when the player presses a hotkey, each offered augment's tier and champion-specific rank (never augment win rates); and, while holding Tab, the recommended build and the player's own build guides.

Tools used: League Client API (gameflow, champ select session, own match history; the only write sets the player's own summoner spells when they click "Apply"), Live Client Data API (active champion), Data Dragon, and Windows OCR of the augment screen, only on the player's request. No Riot Web API calls and no Riot API key. Statistics come from the third-party aramgg.com API.

No memory reading, injection, game file changes or input to the game. Free, no ads. Full details: <Product URL>
```

**版本 B（約 435 字元，A 放不下時用）**

```
Free Windows companion app for LoL ARAM: Mayhem showing static pre-game stats: champion tiers and builds in champ select, and augment tiers/ranks (no win rates) when the player presses a hotkey on the augment screen. Uses the League Client API, Live Client Data API, Data Dragon and Windows OCR of the screen; no Riot Web API, no API key. Stats from aramgg.com. No memory reading, injection or input to the game. Details: <Product URL>
```

## Product Group*

選 **Default Group**。之後如果有其他開發者一起維護，再另外建立群組並把產品移過去。

## Product URL*

```
https://mreast1203.github.io/lol-aram-helper
```

Riot 會要求 `<Product URL>/riot.txt` 這個網址能讀到驗證碼。`github.com/...` 的 repo 網址做不到，因為 GitHub 不會用這種網址直接提供檔案，所以改用 GitHub Pages 發布這個 repo。驗證檔就是 repo 根目錄的 `riot.txt`，內容只有 Riot 給的那串驗證碼。

## Product Game Focus*

```
League of Legends
```

## Are you organizing tournaments?*

```
No
```

## App Note（申請送出後貼上）

General Policies 寫明，灰色地帶要在申請裡用 App Note 提問。申請送出後，把下面這段貼成一則 App Note。如果找不到 App Note 的地方，就把它接在 Product Description 最後面。

```
Before we make the project public, we'd like your feedback on a few points that may be gray areas:

1. Augment detection by screen OCR. The Live Client Data API has no augment fields, so when the player presses a hotkey (F7) or clicks our button on the augment selection screen, the app captures that area of the screen and reads the augment names with the built-in Windows OCR. It runs only on the player's request, reads only what the player is already looking at, and doesn't touch the game process. Is this acceptable? If not, we'll replace it with manual input: the player picks the offered augments in our panel.

2. League Client API endpoints. We read /lol-gameflow/v1/gameflow-phase, /lol-gameflow/v1/session, /lol-champ-select/v1/session, /lol-end-of-game/v1/eog-stats-block and /lol-match-history/v1/products/lol/current-summoner/matches (the current player's own history). The only write is PATCH /lol-champ-select/v1/session/my-selection, to set the player's own summoner spells when they click "Apply". Are these acceptable for a public product?

3. Third-party statistics. Aggregated ARAM: Mayhem statistics come from the aramgg.com Data API, and each user supplies their own aramgg key. Is using a third-party statistics provider acceptable, and does it have to meet any requirements, such as being a registered product itself?

4. Reading game.cfg. The app reads the WindowMode value from Config/game.cfg (read-only, never modified), to warn the player that the overlay needs Borderless mode. Is this acceptable, or should we detect the window mode another way?

5. Visual style. The app has its own name, icon and color theme (charcoal and rose, not the League client's gold and teal) and uses no Riot logos. Please let us know if any part of the UI still looks too close to official League of Legends branding.
```

## 審核可能會問的問題，以及建議的回答方式

- **為什麼用 OCR 讀螢幕？** 遊戲中沒有任何 Riot 支援的介面提供海克斯選項，Live Client Data API 沒有海克斯欄位。OCR 只讀玩家眼前的畫面，只在玩家按鍵時執行，也不碰遊戲程序。如果 Riot 不接受，可以改成「不自動辨識，讓玩家自己在面板上選海克斯」的版本。
- **為什麼會寫入 LCU？** 只有在玩家按下「套用」時，設定玩家自己的召喚師技能，其他都是唯讀。
- **資料是哪裡來的？** 統計來自第三方 aramgg.com，不是 Riot 的 API。

## 附錄：完整產品說明

如果審核人員要求更詳細的說明，或你想放在產品網頁上，就用這份完整版（約 4306 字元）。App Note 如果也有字數限制，可以把下面這份和上面的 App Note 拆成幾則分開貼。

```
ARAM Helper is a free, noncommercial Windows desktop companion app for League of Legends ARAM: Mayhem (queue 2400). It shows static statistics that are available before the game, to help players learn which champions, augments and builds work well.

APIs and developer tools we use: the League Client API (local), the Live Client Data API (local) and Data Dragon. We do not call any Riot Games Web API endpoints, and the app contains no Riot API key. We are registering so that the product is reviewed and audited before we distribute it publicly.

Features:

1. Champ select: a side panel next to the client with the player's champion tier, rank, win rate and pick rate; the tiers of bench and teammate champions (to help with swaps); recommended summoner spells (the player can click "Apply" to set them); recommended item builds; and the champion's augments ranked by tier.

2. Augment selection (in game): when the player presses a hotkey (F7) or clicks an on-screen button, the app reads the names of the offered augments from the screen and shows each augment's tier and champion-specific rank (e.g. "T1 #10/121") above its card. It never shows augment win rates. The top-ranked offer is highlighted, but the player always makes the choice. Nothing is scanned automatically.

3. Holding Tab (in game): a panel with the recommended build for the player's champion (the player can switch between builds), and the player's own custom build guides, e.g. "with Armor Shock, buy Cloth Armor first".

Players can also write their own guides in the app, and after each game the app records which augments they picked, from their own match history.

How we use each source:
- League Client API (local): reads the gameflow phase, the champ select session, the game session, end-of-game stats and the current player's own match history. Its only write is setting the player's own summoner spells in champ select, and only when the player clicks "Apply".
- Live Client Data API (local, 127.0.0.1:2999): reads the active player's champion, level and game time, to know which champion is being played.
- Data Dragon: item icons.
- Screen reading: on the hotkey or button only, the app captures the augment selection area of the screen and reads the augment names with the built-in Windows OCR. It reads only what the player is already looking at. The Live Client Data API has no augment fields, so this is the only way to know the offered augments without touching the game.
- Statistics: aggregated ARAM: Mayhem statistics come from the third-party aramgg.com Data API. Each user uses their own aramgg API key, and data is cached locally.

Game integrity:
- It never reads or writes game memory, never injects into the game process, never modifies game files, and never intercepts network traffic.
- It sends no keyboard or mouse input to the game. A global keyboard hook only listens for Tab and the app's hotkeys.
- The overlay is a separate transparent always-on-top window (borderless mode required). It passes mouse clicks through to the game, except while the cursor is over one of its own panels or buttons.
- It shows only static, pre-game statistics. It shows no information about the current game session that the player could not already see: no enemy information, no cooldown or spawn timers, no hidden players, and no MMR or ELO estimates.
- It does not display win rates for augments.
- It does not make decisions for the player. It highlights recommendations; the player picks augments, items and spells.

Distribution and monetization:
- Free, with no ads, no paid features and no in-app purchases. Licensed under the PolyForm Noncommercial License 1.0.0.
- Distributed as a portable Windows executable through GitHub Releases, with the source code available.

Privacy:
- No accounts and no telemetry. The only network requests go to the aramgg Data API (with the user's own key) and to icon CDNs. Settings, guides, scan captures (last 10) and logs stay on the user's computer.

Legal:
- The Riot Games legal boilerplate is shown at the bottom of the main window and on the app's About page. The app uses its own name, icon and color theme, and no Riot logos.

We have a few gray-area questions (OCR, the League Client endpoints we use, third-party statistics), which we will post as an App Note.
```
