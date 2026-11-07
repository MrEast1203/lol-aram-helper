# ARAM Helper

**中文** | [English](README.en.md)

英雄聯盟「海克斯大亂鬥（ARAM: Mayhem）」覆蓋層工具。資料來源：[aramgg.com](https://aramgg.com) Data API（data.dtodo.cn）。

> 非官方的個人工具，與 Riot Games、aramgg 無關。請先閱讀下方的[規範說明](#規範說明)與[免責聲明](#免責聲明)。

## 功能

1. **選角面板**：選角時在客戶端旁邊顯示。最上面是目前英雄的 Tier、總排名、勝率／選取率，接著是板凳／隊友英雄的 Tier（方便換英雄），然後是推薦召喚師技能（可一鍵套用）、出裝（可選流派），最後是此英雄的推薦海克斯。
2. **局內海克斯**：在海克斯選擇畫面按 **F7**，每張卡上方會顯示此英雄專屬的 Tier 和排名（#3/121），最推薦的標 ★，有自訂攻略的海克斯會顯示 📘。重抽後再按 F7 更新，按 **F8** 隱藏。（依 Riot 政策不顯示海克斯勝率，見[規範說明](#規範說明)。）
3. **按住 Tab**：一邊顯示推薦出裝（召喚師、出門、核心、後續、情境、技能點法），可用上方的下拉選單切換流派（每隻英雄會記住你的選擇，選角面板也通用）；另一邊一直顯示適用這隻英雄的**自訂攻略**。按住 Tab 時可以直接用滑鼠點選單；拖曳面板頂端的「⠿ 拖曳移動」可移動面板，位置會記住，雙擊它回到預設位置。
   - 出門裝依場次排序；場次太少（少於 30 場）時顯示「樣本不足」，因為 aramgg 的出門裝資料大多只有零星樣本。
4. **自訂攻略**：在「自訂攻略」頁面設定，例如「裝甲衝擊 → 布甲 › 鎖子甲 › 荊棘之甲」。可以指定英雄、匯入／匯出 JSON。畫面上出現攻略相關的海克斯時，該攻略會被標亮。
5. **賽後紀錄**：每場結束後，從比賽紀錄同步實際選了哪些海克斯和勝負。

## 安裝

1. 從 [Releases](../../releases) 下載 `ARAM-Helper-x.y.z-portable.exe`，直接執行即可（免安裝）。
   - 執行檔沒有程式碼簽章，第一次執行時 Windows SmartScreen 可能會攔下來：按「其他資訊 → 仍要執行」。
2. 需求：
   - Windows 10／11（64 位元）。
   - Windows 已安裝「中文（繁體，台灣）」語言（含 OCR 元件）：**設定 → 時間與語言 → 語言與地區 → 新增語言**。
   - 遊戲語言與資料語言一致（預設 zh-TW），海克斯名稱才能被 OCR 對上。
3. 到 [data.dtodo.cn/developer.html](https://data.dtodo.cn/developer.html) 申請**自己的** aramgg API Key，貼到程式的「設定」頁。

## 使用前必做

- 遊戲內：**設定 → 視訊 → 視窗模式 → 無邊框**。全螢幕獨佔模式下，任何不注入遊戲的覆蓋層都無法顯示。
- 關閉主視窗會**完全結束程式**。遊戲中要保留覆蓋層，請把主視窗最小化（或在設定開啟「關閉視窗時縮到系統匣」）。
- 更新版本：直接開新版的 exe，新版會自動讓舊版結束並接手。

## 安全性（Vanguard）

- 不讀寫遊戲記憶體、不注入遊戲程序、不修改任何遊戲檔案（lockfile、game.cfg 只讀）。
- 只用遊戲在本機提供的介面：LCU（客戶端 API）和 Live Client Data API（`127.0.0.1:2999`）。
- 覆蓋層是獨立的透明置頂視窗。海克斯卡片用 Windows 內建 OCR 讀取螢幕畫面（跟錄影軟體擷取畫面是同一層級）。
- 全域鍵盤 hook 只「聽」Tab 和快捷鍵，不會送任何輸入給遊戲。覆蓋層平時讓滑鼠穿透，只有游標停在面板或按鈕上時才接收點擊（靠讀取游標位置判斷）。

以上是設計原則，不代表 Riot 的認可或保證，見[免責聲明](#免責聲明)。

## 規範說明

### Riot Games

- Riot 的英雄聯盟政策規定，任何網站、應用程式或覆蓋層都**不得顯示海克斯（Augments）的勝率**。本程式只顯示海克斯的 Tier、排名與選取率；英雄和出裝的勝率不在此限。
- 政策也要求產品「不得取代玩家的決定，但可以標示重要的決定」。本程式只標示推薦，選擇由玩家自己做。
- LCU（客戶端 API）**不是** Riot 正式支援給第三方使用的服務，隨時可能改變或失效。
- 海克斯辨識是讀取螢幕畫面（OCR），不是 Riot 提供的資料服務；Riot 對這種做法沒有明確表態。
- Riot 要求服務玩家的產品在 [Riot Developer Portal](https://developer.riotgames.com) 註冊。本專案已註冊（App ID 900373），正在等待 Riot 審核。
- 依 Riot 要求，程式內（主視窗底部與「設定 → 關於與免責聲明」）會顯示下方的法律聲明。

### aramgg Data API

- 每位使用者都要用**自己的** API Key，請勿分享 Key，也不要把 `.env` 或設定檔提交到版本庫。Key 只存在本機的 `%APPDATA%\ARAM Helper\settings.json`。
- 免費方案每日 200 credits，UTC 00:00（台灣時間 08:00）重置；每分鐘最多 60 次請求。
- 依官方文件建議，先讀免費的 `config.json` 比對 `dataVersion` 再決定是否更新，並在本機快取（詳見下方「資料快取」）。
- 資料跟隨 aramgg.com 主站刷新，不保證即時。資料版權歸資料來源所有；本專案不包含、也不重新散布任何 aramgg 資料，快取只存在使用者自己的電腦。

## 局內海克斯怎麼偵測

- 在海克斯選擇畫面按 **F7**，或點畫面左側的「🔍 掃描海克斯」按鈕（點擊不會搶走遊戲焦點）。畫面上方會有進度條。
- 結果會一直顯示，直到下一次 F7（例如重抽後）取代它，或按 **F8** 隱藏。快捷鍵可在設定改。
- 不會自動掃描，也不會追蹤你選了哪一個海克斯。
- 程式啟動時就先載入 OCR，所以第一次按 F7 跟之後一樣快。
- 每次掃描的截圖和辨識結果，會存在 `%APPDATA%\ARAM Helper\scans\`（保留 10 筆），可從「總覽 → 掃描紀錄」開啟。程式日誌在同一層的 `app.log`。

### 為什麼用 OCR

已確認遊戲進行中沒有任何可用的資料來源：

- GameLogs（r3dlog／netlog）完全沒有海克斯資料。
- LCU 日誌只有**賽後**的 `playerAugment1~6`。遊戲進行中，LCU 沒有任何海克斯相關的請求。
- Live Client Data API 也沒有海克斯欄位（已用 KIWI 對局的實際回應確認）。程式仍會把原始回應存到 `live-snapshots\`；萬一 Riot 之後加上海克斯欄位，程式會自動改用它。
- 讀記憶體或攔截封包會違反 Vanguard／Riot 規範，所以不採用。

### OCR 做法

Windows OCR 直接辨識整個遊戲畫面時，會被華麗的卡片外框干擾，幾乎讀不到字；但切成水平長條逐條辨識就很準。所以做法是：

1. 第一次掃描時，用重疊的水平長條掃過畫面中段，找到卡片標題列，並記住它的高度。
2. 之後只掃標題那一條（實戰約 0.05–0.1 秒）。
3. 同一個畫面的三張卡稀有度相同，所以只要對上一張，其他 OCR 有錯字的標題，就只在同稀有度裡用比較寬鬆的條件比對。這類結果會在徽章上標「推測」。

## 資料快取與 credits

- `config.json`（免費）：啟動時和每 30 分鐘檢查一次 `dataVersion`，也可以在總覽按「檢查更新」。同時讀取 Riot Data Dragon 的最新遊戲版本：遊戲已改版但 aramgg 還沒發布新版統計時，總覽會說明。
- 英雄／海克斯／裝備／召喚師列表（各 1 credit）：只在 `dataVersion` 改變時重新下載。
- 英雄詳情（每位 2 credits）：選角或進遊戲時按需下載，**整個遊戲版本（例如 16.21.x）內都有效**。資料小更新（16.21.4 → 16.21.5）不會丟掉已快取的英雄，只會在背景用剩餘額度慢慢更新。
- 背景預載：先補沒有快取的英雄，再更新舊的，依選取率排序，每次請求間隔 2.5 秒，預設保留 80 credits 給即時查詢（可在「設定 → 資料」修改）。全部預載需要 4 + 173×2 = 350 credits，超過單日額度，所以不在啟動時一次全抓。
- 快取檔案不會因為改版被刪除；下載失敗時會改用舊版本快取。快取位置：`%APPDATA%\ARAM Helper\aram-data\`。
- 每次花 credits 的請求（時間、項目、原因、花費、剩餘）都會記在總覽的「Credits 使用紀錄」，保留最近 300 筆（`aram-data\credit-log.json`），也會寫進 `app.log`。

## 免責聲明

- 本程式是非官方的個人工具，與 Riot Games、aramgg.com／data.dtodo.cn 沒有任何關係，也未獲其認可或贊助。
- 本程式「按現狀」提供，不提供任何明示或默示的保證。作者不保證本程式符合 Riot 現行或未來的政策，也不保證不會被反作弊系統誤判。
- 使用本程式的一切風險（包括但不限於帳號被警告、限制或停權）由使用者自行承擔。作者對因使用本程式造成的任何損失概不負責。
- 顯示的統計資料來自第三方資料來源，可能有誤或過時，僅供參考。

ARAM Helper isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

（中譯：ARAM Helper 未獲 Riot Games 認可，也不代表 Riot Games 或任何正式參與製作、管理 Riot Games 資產人士的觀點或意見。Riot Games 及所有相關資產皆為 Riot Games, Inc. 的商標或註冊商標。）

## 授權

本專案採用 [PolyForm Noncommercial License 1.0.0](LICENSE)：

- 可以免費用於個人、學習、研究、興趣等**非商業用途**，也可以修改和分享（分享時須附上授權條款）。
- **不可用於商業用途**（例如販售、付費服務、營利公司內部使用）。商業使用請先取得作者書面同意。
- 這不是 OSI 定義的「開放原始碼」授權。

## 開發

```bash
npm install
npm start          # 開發模式執行
npm test           # 單元測試（OCR 比對、選擇偵測、攻略比對）
npm run dist       # 打包 dist/ARAM-Helper-x.y.z-portable.exe
```

開發時程式會自動讀取專案的 `.env`（`ARAMGG_API_KEY=...`，見 `.env.example`）。開發用環境變數：

- `ARAM_SIM=<截圖.png>`：模擬一場遊戲，用截圖代替螢幕
- `ARAM_SIM_TAB=1`：模擬時一直按住 Tab
- `ARAM_SIM_CS=1`：模擬選角畫面
- `ARAM_SHOTS=<資料夾>`：自動擷取主視窗各分頁的截圖（`ARAM_SHOTS_QUIT=1` 拍完自動結束）
- `ARAM_DEBUG_MOUSE=1`：在 `app.log` 記錄覆蓋層的可點擊範圍與切換

如果打包時 electron-builder 解壓 `winCodeSign` 失敗（建立 symlink 權限不足），請把壓縮檔手動解壓到 `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`，並排除 `darwin` 資料夾。
