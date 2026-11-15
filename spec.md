# WebEditor

一個**純靜態網頁**的程式編輯器：在瀏覽器中撰寫、執行 C++ / Python / JavaScript 程式，不需要後端伺服器（唯一例外是串接 APCS Code Noter 用的小型代理，見 §8）。

- 介面語言：繁體中文
- 部署：任何靜態主機皆可（例如 GitHub Pages），可放在任意子路徑
- 主要使用情境：APCS / 競技程式練習——寫程式、用多組測資驗證、分享程式碼

---

## 1. 技術選型與架構

沿用 [WebTaskMaker_spec.md](WebTaskMaker_spec.md) 的架構，以下列出沿用與新增的部分。

| 項目 | 選擇 | 備註 |
| --- | --- | --- |
| 前端框架 | Svelte + Vite | 建置輸出純靜態檔案 |
| 程式編輯器 | CodeMirror 6 | 語法高亮：C++ / Python / JS / 純文字 |
| Python 執行 | Pyodide（WASM），在 Web Worker 中執行 | 首次執行 Python 時才下載 |
| JavaScript 執行 | 直接在 Web Worker 中執行 | |
| C++ 編譯 | `@yowasp/clang`（固定版本），在專用 Web Worker 中執行 | 沿用 WebTaskMaker §14 的設計與限制 |
| C++ 程式執行 | `@bjorn3/browser_wasi_shim` | |
| 終端機介面 | xterm.js | 互動模式（§6.4） |
| zip 處理 | JSZip | |
| QR Code | `qrcode`（npm） | 在瀏覽器端產生 |
| 跨分頁協調 | BroadcastChannel + Web Locks API | §4 |
| 跨來源隔離 | `coi-serviceworker`（或主機設定的 COOP/COEP 標頭） | 互動模式需要 `SharedArrayBuffer`，見 §6.4.3 |
| Code Noter 代理 | Cloudflare Worker（放在本 repo 的 `proxy/`） | §8.4 |

部署與路徑規則完全沿用 WebTaskMaker §13（相對路徑、`base: './'`、hash 路由、子路徑測試）。

---

## 2. 介面配置

```
┌──────────────────────────────────────────────────────────┐
│ 專案選單 ▾ │ ▶ 執行 ■ 停止 │ 模式：測資/終端機 │ 分享 │ ⚙ │
├────────────┬─────────────────────────────────────────────┤
│ 檔案樹     │ [main.cpp] [util.h] [a.py ×]                │
│ ▸ src      │                                             │
│   main.cpp │            程式碼編輯器                       │
│   util.h   │                                             │
│ a.py       ├─────────────────────────────────────────────┤
│            │ 執行面板：測資（§6.3）／終端機（§6.4）        │
└────────────┴─────────────────────────────────────────────┘
```

- **檔案樹**（左）：目前專案的資料夾結構，可收合
- **編輯區**（中）：多個編輯分頁，可切換、關閉、拖曳排序；分頁標題顯示檔名，同名檔案時附上所在資料夾以區分
- **執行面板**（下）：可調整高度、可收合；依目前模式顯示測資面板或終端機
- 頂端列：專案切換、執行／停止、模式切換、分享（Code Noter）、設定、使用說明
- 手機：檔案樹改為抽屜式側欄，執行面板改為可切換的全螢幕面板；按鈕需容易點按
- 支援深色模式（跟隨系統，可在設定中覆寫）

---

## 3. 專案與檔案

### 3.1 專案

- 可建立多個專案，在專案選單中切換、新增、重新命名、複製、刪除（刪除需確認，危險色按鈕）
- 每個專案是一棵檔案樹，可有任意層子資料夾
- 第一次開啟網頁時自動建立一個預設專案，內含 `main.cpp` 範例
- 每個瀏覽器分頁各自記得目前開啟的專案與編輯分頁（存在 `sessionStorage`；新分頁則沿用 localStorage 中「最近使用的專案」）

### 3.2 檔案操作

- 新增檔案、新增資料夾、重新命名、移動（拖曳到資料夾，或用「移動到…」選單）、刪除（需確認）
- 檔名規則：不可包含 `/ \ : * ? " < > |`，同一資料夾內不可重名（不分大小寫）
- 語言由副檔名決定：
  - C++：`.cpp` `.cc` `.cxx`（可執行）、`.h` `.hpp`（標頭，只能被 include）
  - Python：`.py`
  - JavaScript：`.js`
  - 其他副檔名（`.txt`、`.in`、`.md` …）：純文字，可編輯但不可執行
- 只支援 UTF-8 文字檔。上傳的檔案若無法以 UTF-8 解碼（例如圖片），仍會保存並包含在 zip 中，但編輯器顯示「無法預覽此檔案」
- 單一檔案超過 5 MB 時提示可能影響效能，仍允許上傳

### 3.3 編輯器

- 自動儲存：停止輸入 0.4 秒後寫入（同 WebTaskMaker §10.1），因此沒有「未儲存」狀態
- 基本功能：行號、括號配對、自動縮排、搜尋取代、復原／重做、Tab 寬度設定
- 不提供語意自動完成、語法檢查（LSP）

### 3.4 上傳與下載

| 動作 | 說明 |
| --- | --- |
| 上傳檔案 | 選擇一或多個檔案，放進目前選取的資料夾 |
| 上傳資料夾 | 以 `<input webkitdirectory>` 選擇本機資料夾，保留結構放進目前資料夾 |
| 上傳 zip | 選擇「解壓到目前資料夾」或「建立為新專案」（專案名稱預設為 zip 檔名） |
| 拖放 | 把檔案／資料夾／zip 拖到檔案樹上，等同上傳 |
| 下載檔案 | 以原檔名存到本機 |
| 下載資料夾 | 打包成 `<資料夾名>.zip` |
| 下載專案 | 打包成 `<專案名>.zip`，包含 `.webeditor/`（§6.3.4） |

- 上傳時遇到同名檔案：詢問「取代」「保留兩者（自動改名為 `name (1).cpp`）」「略過」，並可勾選「套用到全部」
- zip 中的隱藏系統檔（`__MACOSX/`、`.DS_Store`、`Thumbs.db`）自動忽略

---

## 4. 儲存與跨分頁共用

### 4.1 IndexedDB

- 所有專案、檔案、測資、設定都存在 IndexedDB；寫入方式沿用 WebTaskMaker §10.1（逐檔寫入、延遲合併、讀取完成前顯示「載入中」、寫入失敗提示下載 zip 備份）
- 資料結構（建議）：
  - `projects`：`{ id, name, createdAt, updatedAt }`
  - `files`：`{ id, projectId, path, content (string | Blob), updatedAt }`，以 `[projectId, path]` 建立唯一索引
  - `tests`：測資（§6.3.4）
  - `settings`：全域設定
- 開啟網頁時申請持久儲存（`navigator.storage.persist()`），使用說明提醒重要專案請下載 zip 備份（同 WebTaskMaker §10.2）
- C++ 編譯快取存在另一個 IndexedDB 資料庫（同 WebTaskMaker §14.2）

### 4.2 跨分頁同步

- 任何分頁寫入 IndexedDB 後，經由 BroadcastChannel 通知其他分頁（檔案新增／刪除／改名／移動／內容變更、專案變更、測資變更）
- 其他分頁收到通知後更新檔案樹、專案清單與唯讀中的編輯器內容
- 若目前開啟的專案或檔案在其他分頁被刪除：關閉對應的編輯分頁，並以提示列告知

### 4.3 編輯鎖（一次只能一個分頁編輯同一檔案）

- 開啟檔案進行編輯時，以 Web Locks API 取得該檔案的鎖（鎖名稱例如 `webeditor-file-<fileId>`）
- 若鎖已被其他分頁持有：
  - 此分頁的編輯器為**唯讀**，頂端顯示「此檔案正在其他分頁編輯中」與「在這裡編輯」按鈕
  - 唯讀時內容會隨持有鎖的分頁即時更新
  - 按「在這裡編輯」：經由 BroadcastChannel 請持有者交出鎖；持有者先寫入尚未儲存的內容，切換為唯讀並釋放鎖，此分頁取得鎖後變為可編輯
- 持有鎖的分頁關閉或當掉時，瀏覽器會自動釋放鎖，等待中的分頁自動取得
- 唯讀分頁仍可執行程式、瀏覽、下載
- 不支援 Web Locks API 的瀏覽器：退化為「最後寫入者為準」，並顯示一次性提示

---

## 5. 設定

全域設定（存在 IndexedDB，跨分頁共用）：

- 主題（跟隨系統／淺色／深色）、字型大小、Tab 寬度
- 測資模式預設時限（§6.3.2）
- 終端機 stderr 顯示方式（§6.4.2）
- C++ 編譯器來源（jsDelivr／自行託管，同 WebTaskMaker §14.1）
- Code Noter 代理網址（§8.4）

---

## 6. 執行程式

### 6.1 執行對象

- 按「執行」時執行**目前編輯分頁**的檔案；若目前檔案不可執行（例如 `.h`、`.txt`），按鈕停用並顯示原因
- 快捷鍵：`Ctrl+Enter`（Mac 為 `Cmd+Enter`）
- 執行前自動寫入所有尚未儲存的修改
- 每個瀏覽器分頁同時只能執行一個程式；執行中再按「執行」會先詢問是否停止目前的程式

### 6.2 各語言的執行方式

#### 6.2.1 C++

- 只編譯目前這一個 `.cpp`（不連結專案中其他 `.cpp`）
- 專案的檔案樹會掛載到編譯器的虛擬檔案系統，因此可以 `#include "util.h"`、`#include "../lib/x.h"`；搜尋順序為：目前檔案所在資料夾 → 專案根目錄
- 編譯參數、兩段式編譯、內建 `bits/stdc++.h`、已知限制（不能用例外、遞迴深度約 5,000 層、32 位元 `long`、手機警告）沿用 WebTaskMaker §14.2、§14.4
- 編譯快取的雜湊需包含**所有被 include 的專案檔內容**，避免改了標頭檔卻沿用舊結果
- 編譯錯誤：在執行面板顯示編譯器訊息，狀態標為 CE；訊息中的 `檔名:行:列` 可點擊跳到對應位置

#### 6.2.2 Python

- 以 Pyodide 執行；專案的檔案樹會寫入 Pyodide 的虛擬檔案系統，工作目錄為目前檔案所在資料夾，並加入 `sys.path`，因此可以 `import` 同專案的其他 `.py`
- 每次執行前清除上一次的使用者模組（`sys.modules` 中的專案模組）與全域狀態
- stdout / stderr 不緩衝（等同 `python -u`），確保互動模式下 `input()` 前的提示文字會先顯示
- 不支援安裝第三方套件（Pyodide 內建套件如 numpy 是否開放列為待確認）

#### 6.2.3 JavaScript

- 在 Web Worker 中以一般腳本執行，只執行目前檔案，不支援 `import` 其他專案檔
- 提供與 WebTaskMaker §5.2 相同的 I/O 介面：`readline()`、`readAll()`、`print()`、`write()`；`console.log` 輸出到 stdout、`console.error` 輸出到 stderr

#### 6.2.4 共通

- 程式可以讀取專案中的檔案（相對於工作目錄），但寫入的檔案不會存回專案
- 不提供命令列參數（`argv` 為空）
- 輸出上限：stdout + stderr 合計超過 16 MB 時強制停止，狀態標為「輸出過大」
- 結束狀態：正常結束（結束碼 0）／執行錯誤 RE（附結束碼或例外訊息）／逾時 TLE（僅測資模式）／使用者停止／編譯錯誤 CE
- 執行時間僅供參考（瀏覽器 / WASM 與正式評測環境差異大）

### 6.3 模式一：測資模式

事先準備好多組輸入（及可選的預期輸出），一次執行並比對結果。

#### 6.3.1 測資管理

- 測資**屬於某個可執行檔案**：每個程式檔有自己的一組測資，切換編輯分頁時測資面板跟著切換
- 每組測資包含：名稱（預設「測資 1」「測資 2」…）、輸入、預期輸出（可留空）
- 操作：新增、刪除、複製、拖曳排序、重新命名、勾選要執行的測資
- 輸入與預期輸出可直接在文字框中編輯，也可各自上傳檔案或下載為檔案
- 批次上傳：一次選擇多個檔案，依檔名配對 `xxx.in` / `xxx.out`（也接受 `.ans`、`.txt` 中帶 `in` / `out` 的命名），配對不到預期輸出的視為只有輸入
- 也可以上傳測資 zip，規則同上
- 「把實際輸出設為預期輸出」按鈕：方便用正確解產生答案

#### 6.3.2 執行

- 「全部執行」：依序執行所有勾選的測資；每組測資旁也有「只執行這組」按鈕
- **時限**：每組測資各自計時，預設 5 秒，可在測資面板中調整（1–60 秒），並記住在該程式檔上；逾時強制終止 Worker 並重建，該組標為 TLE
- C++ 只在第一組前編譯一次；編譯時間不算進時限
- 「停止」按鈕：立即終止目前測資，剩下的測資標為「未執行」

#### 6.3.3 結果

- 每組測資顯示狀態與執行時間：
  - 有預期輸出：AC / WA / TLE / RE
  - 沒有預期輸出：完成 / TLE / RE
- 上方彙總：例如「AC 7 / 10，最長 0.83 秒」
- 點選某組可展開：stdout、stderr、預期輸出；WA 時以左右對照或逐行差異標示第一個不同處
- 比對方式（每個程式檔可設定）：
  - **忽略空白差異（預設）**：忽略行尾空白與檔尾空行，逐 token 比對（同 WebTaskMaker §7.3）
  - **完全相同**：逐位元組比對（只把 `\r\n` 視為 `\n`）
- 過大的輸出只顯示開頭部分並附大小（同 WebTaskMaker §7.5）
- 結果不保存，重新整理後清除

#### 6.3.4 測資的儲存與匯出

- 測資存在 IndexedDB 的 `tests` 中，以「專案 id + 程式檔 id」索引；程式檔改名或移動時測資跟著走，刪除程式檔時一併刪除（刪除確認中註明）
- 下載專案 zip 時，測資與設定放在 `.webeditor/` 資料夾：

```
.webeditor/
  project.json            # 專案名稱、格式版本、各程式檔的時限與比對方式
  tests/
    src/main.cpp/
      tests.json          # 測資名稱與順序
      1.in
      1.out
      2.in
```

- 上傳含 `.webeditor/` 的 zip 時還原測資；`.webeditor/` 本身不顯示在檔案樹中
- 下載單一檔案或資料夾時不包含測資

### 6.4 模式二：終端機模式

以類似 terminal 的互動介面執行程式，可以邊看輸出邊輸入。

#### 6.4.1 互動

- 使用 xterm.js 顯示；程式開始執行時清空終端機（可在設定中關閉自動清空）
- 輸入採**行緩衝**：使用者打字時本地回顯，可用退格、左右鍵編輯，按 Enter 後整行（含換行）送給程式的 stdin
- 程式尚未讀取時先輸入的內容會排隊，等程式讀取時再送出
- `Ctrl+D`：送出 EOF；`Ctrl+C`：停止程式（若有選取文字則為複製）
- 支援貼上多行文字
- 不設時限，提供「停止」按鈕
- 程式結束時在終端機最後顯示一行狀態，例如 `[程式結束，結束碼 0，耗時 3.2 秒]`

#### 6.4.2 stderr 顯示

可在執行面板切換：

- **合併到終端機（預設）**：stderr 與 stdout 依實際寫入順序顯示在同一個終端機，stderr 以紅色顯示
- **分開顯示**：終端機只顯示 stdout；stderr 顯示在旁邊（窄螢幕時在下方）的獨立唯讀區塊，可清除、複製

#### 6.4.3 技術需求：同步 stdin

- 程式在 Worker 中呼叫 `input()` / `cin` / `readline()` 時必須同步等待使用者輸入，需要 `SharedArrayBuffer` + `Atomics.wait`，因此頁面必須是**跨來源隔離**（`crossOriginIsolated === true`）
- 做法：
  - 主機可設定標頭時：`Cross-Origin-Opener-Policy: same-origin`、`Cross-Origin-Embedder-Policy: credentialless`（或 `require-corp`）
  - GitHub Pages 等無法設定標頭的主機：使用 `coi-serviceworker` 由 Service Worker 補上標頭（第一次開啟會自動重新整理一次）
- 開啟隔離後，所有跨來源資源（jsDelivr 上的 Pyodide / 編譯器、Code Noter 代理）都必須允許 CORS 或帶 `Cross-Origin-Resource-Policy`，部署前需實測
- 若無法啟用隔離（例如瀏覽器不支援）：終端機模式停用並說明原因，測資模式仍可正常使用（測資模式的 stdin 事先備妥，不需要同步等待）

---

## 7. 使用說明與範例

- 內建使用說明頁（hash 路由 `#/docs`）：介面介紹、多檔案 include / import 規則、測資模式、終端機模式、C++ 限制（沿用 WebTaskMaker §14.4 的提醒）、Code Noter 分享、資料備份提醒
- 提供可一鍵建立的範例專案：
  - C++：A+B（含兩組測資）、使用自訂標頭檔的多檔案範例
  - Python：A+B、使用 `import` 的多檔案範例、互動式猜數字（示範終端機模式）
  - JavaScript：A+B

---

## 8. APCS Code Noter 串接

串接 <https://coder.apcs.top/>：把程式碼上傳產生 `https://coder.apcs.top/code/<ID>` 分享連結，或從分享連結把程式碼載入 WebEditor。

### 8.1 API（實測於 2026-11-15）

由於 coder.apcs.top 沒有回傳 CORS 標頭，前端一律**經由代理**（§8.4）呼叫，代理再轉送到下列 API。

**建立**

```
POST /api/code
Content-Type: application/json

{ "code": "...", "language": "cpp", "title": "...", "description": "..." }
```

- 成功：`{ "success": true, "url": "https://coder.apcs.top/code/<ID>" }`
- 失敗：`{ "success": false, "error": "錯誤訊息" }`
- `language` 可用值（取自官方前端）：`javascript` `typescript` `python` `java` `cpp` `csharp` `php` `ruby` `go` `rust` `swift` `kotlin` `html` `css` `sql` `json` `xml` `yaml` `markdown` `bash` `plaintext`

**讀取**

```
GET /api/code/<ID>
```

- 成功：`{ "success": true, "snippet": { "code", "language", "title", "description", ... } }`
- ID 格式錯誤：HTTP 400 `{ "error": "無效的 ID 格式" }`；找不到時回傳 `error`

### 8.2 上傳（分享）

- 頂端「分享」按鈕：上傳**目前編輯分頁**的單一檔案
- 對話框欄位：
  - 標題：預設為檔名（例如 `main.cpp`），可修改
  - 說明：可留空
  - 語言：依副檔名自動決定（C++ → `cpp`、`.py` → `python`、`.js` → `javascript`、`.h/.hpp` → `cpp`、`.md` → `markdown`、`.json` → `json`、其他 → `plaintext`），可在下拉選單中改
  - 預覽前幾行程式碼，提醒「上傳後任何拿到連結的人都能看到」
- 空檔案不可上傳
- 成功後顯示：
  - 分享連結（可點擊開啟、「複製」按鈕）
  - 「產生 QR Code」按鈕：在對話框中顯示指向該連結的 QR Code，可下載為 PNG；手機上 QR Code 寬度不超出螢幕
- 失敗時顯示伺服器回傳的錯誤訊息，或「網路錯誤，請稍後再試」

### 8.3 下載（匯入）

- 「從 Code Noter 匯入」：輸入分享連結或 ID（自動從 `https://coder.apcs.top/code/<ID>` 中取出 ID）
- 讀取成功後顯示預覽（標題、說明、語言、程式碼前幾行），並選擇：
  - **加入目前專案**：存到目前選取的資料夾
  - **建立為新專案**：專案名稱預設為標題
- 檔名：由標題產生（移除不合法字元）；若標題本身沒有合適的副檔名，依 `language` 補上（`cpp` → `.cpp`、`python` → `.py`、`javascript` → `.js`、其他 → `.txt`）；可在對話框中修改，同名時沿用 §3.4 的處理方式
- 直接連結匯入：開啟 `…/#/import/<ID>` 時自動跳出上述匯入對話框，方便老師提供「一鍵載入到 WebEditor」的連結

### 8.4 代理伺服器（Cloudflare Worker）

- 原始碼放在本 repo 的 `proxy/`，以 Wrangler 部署；部署步驟寫在 `proxy/README.md`
- 只轉送兩個端點，其餘一律回 404：
  - `POST /api/code` → `https://coder.apcs.top/api/code`
  - `GET /api/code/<ID>` → `https://coder.apcs.top/api/code/<ID>`
- 回應原樣轉回（狀態碼與 JSON 內容），並加上 CORS 標頭：
  - `Access-Control-Allow-Origin`：只允許環境變數 `ALLOWED_ORIGINS`（逗號分隔）中的來源，開發時可加入 `http://localhost:5173`
  - 處理 `OPTIONS` 預檢請求
  - 加上 `Cross-Origin-Resource-Policy: cross-origin`，配合 §6.4.3 的跨來源隔離
- 限制：請求本文上限 256 KB（超過回 413）、只接受 `Content-Type: application/json`
- 不記錄程式碼內容；速率限制使用 Cloudflare 的設定，不寫在程式中
- 前端的代理網址預設寫在 `src/lib/config.js`，使用者可在設定中覆寫；未設定或連不上時，分享與匯入按鈕停用並顯示原因

---

## 9. 介面通則

沿用 WebTaskMaker §16：

- 不使用瀏覽器內建的 `alert()` / `confirm()` / `prompt()`，改用自訂對話框（Promise 介面、焦點管理、`Esc` / `Enter`、無障礙屬性、深色模式、手機寬度）
- 刪除等無法復原的動作，主要按鈕以危險色顯示並寫明動作
- 不需要回應的通知使用提示列或 toast

---

## 10. 不在範圍內（目前）

- 多人即時協作、雲端同步、帳號系統
- Git 整合
- 語意自動完成、即時語法檢查（LSP）、除錯器（中斷點、逐行執行）
- 連結多個 `.cpp` 一起編譯、自訂編譯參數
- C++ / Python / JavaScript 以外的語言
- 精確的執行時間 / 記憶體限制判定
- 自訂 checker（測資模式只提供 §6.3.3 的兩種比對方式）
- 上傳整個專案到 Code Noter（API 一次只接受一段程式碼）

---

## 11. 待確認

- **Code Noter**
  - 是否已取得站方同意透過代理使用 API（代理會讓請求來源集中在 Cloudflare 的 IP，可能觸發站方的限制）
  - 程式碼大小上限、ID 格式、速率限制
  - 讀取 API 回應中 `snippet` 的完整欄位
- **跨來源隔離**：`coi-serviceworker` 在桌面 Safari / iOS Safari 上的表現（Safari 不支援 `credentialless`，需改用 `require-corp`，要確認 jsDelivr 與代理的回應標頭都符合）
- **Python 套件**：是否開放 Pyodide 內建的科學套件（numpy 等，下載量大）
- C++ 相關的待確認事項同 WebTaskMaker §14.6
