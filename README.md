# ARAM Helper

英雄聯盟「海克斯大亂鬥（ARAM: Mayhem）」覆蓋層工具。資料來源：aramgg 資料 API（data.dtodo.cn）。

## 功能

1. **選角面板**：選角時在客戶端旁邊顯示目前英雄的 Tier、總排名、勝率／選取率、推薦召喚師技能（可一鍵套用）、此英雄的推薦海克斯，以及板凳／隊友英雄的 Tier（方便換英雄）。
2. **局內海克斯**：出現海克斯選擇畫面時，在每張卡上方顯示此英雄專屬的 Tier、排名（#3/121）和勝率，最推薦的標 ★。有自訂攻略的海克斯會顯示 📘。
3. **按住 Tab**：顯示推薦出裝（召喚師、出門、核心、後續、情境、技能點法），本局已選的海克斯，以及符合本局海克斯的**自訂攻略**。
4. **自訂攻略**：在「自訂攻略」頁面設定，例如「裝甲衝擊 → 布甲 › 鎖子甲 › 荊棘之甲」。選到觸發海克斯後，Tab 面板會優先顯示。可以指定英雄、匯入／匯出 JSON。
5. **賽後紀錄**：每場結束後，從比賽紀錄同步實際選了哪些海克斯和勝負。

## 使用前必做

- 遊戲內：**設定 → 視訊 → 視窗模式 → 無邊框**。全螢幕獨佔模式下，任何不注入遊戲的覆蓋層都無法顯示。
- 設定頁貼上 aramgg API Key（開發時會自動讀取專案的 `.env`）。

## 安全性（Vanguard）

- 不讀寫遊戲記憶體、不注入遊戲程序、不修改任何遊戲檔案（lockfile、game.cfg 只讀）。
- 只用 Riot 公開的本機 API：LCU（客戶端）和 Live Client Data API（`127.0.0.1:2999`）。
- 覆蓋層是獨立的透明置頂視窗。海克斯卡片用 Windows 內建 OCR 讀取螢幕畫面（跟錄影軟體擷取畫面是同一層級）。
- 全域鍵盤 hook 只「聽」Tab 鍵和滑鼠點擊，不會送任何輸入給遊戲。

## 為什麼用 OCR 讀海克斯

已確認遊戲進行中沒有任何可用的資料來源：

- GameLogs（r3dlog／netlog）完全沒有海克斯資料。
- LCU 日誌只有**賽後**的 `playerAugment1~6`。遊戲進行中，LCU 沒有任何海克斯相關的請求。
- Live Client Data API 沒有公開的海克斯欄位。程式每 30 秒會把原始回應存到 `%APPDATA%\ARAM Helper\live-snapshots\`，用來驗證。萬一 Riot 之後加上海克斯欄位，程式會自動改用它，不再用 OCR。
- 讀記憶體或攔截封包會違反 Vanguard／Riot 規範，所以不採用。

OCR 只在預期會出現選擇畫面時（到達 3／7／11／15 級）每秒掃一次，每次約 0.1–0.2 秒。要同一排至少對上 2 張卡名才算選擇畫面。選了哪張，是從畫面關閉前最後點擊的卡片欄位推斷。偵測錯誤時，可以在「總覽」手動修正。

## 資料快取與 credits（免費方案每日 200）

- `config.json`（免費）：啟動時和每 30 分鐘檢查一次 `dataVersion`。
- 英雄／海克斯／裝備／召喚師列表（各 1 credit）：只在 `dataVersion` 改變時重新下載。
- 英雄詳情（每位 2 credits）：選角或進遊戲時按需下載。版本更新後，會在背景用剩餘額度預載常用英雄，預設保留 60 credits 給即時查詢。全部預載需要 4 + 173×2 = 350 credits，超過單日額度，所以不在啟動時一次全抓。
- 下載失敗時，會改用舊版本快取。快取位置：`%APPDATA%\ARAM Helper\aram-data\`。

## 開發

```bash
npm install
npm start          # 開發模式執行
npm test           # 單元測試（OCR 比對、選擇偵測、攻略比對）
npm run dist       # 打包 dist/ARAM-Helper-x.y.z-portable.exe
```

開發用環境變數：

- `ARAM_SIM=<截圖.png>`：模擬一場遊戲，用截圖代替螢幕
- `ARAM_SIM_TAB=1`：模擬時一直按住 Tab
- `ARAM_SHOTS=<資料夾>`：自動擷取主視窗各分頁的截圖

如果打包時 electron-builder 解壓 `winCodeSign` 失敗（建立 symlink 權限不足），請把壓縮檔手動解壓到 `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`，並排除 `darwin` 資料夾。
