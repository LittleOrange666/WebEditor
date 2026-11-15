# WebEditor

純靜態網頁的程式編輯器：在瀏覽器中撰寫、執行 C++ / Python / JavaScript，支援多專案、測資比對、終端機互動模式，並可分享到 [APCS Code Noter](https://coder.apcs.top/)。規格見 [spec.md](spec.md)。

## 開發

```bash
npm install
npm run dev        # http://localhost:5173（開發伺服器已送出 COOP/COEP 標頭）
npm test           # 單元測試
npm run build      # 輸出到 dist/
npm run serve:subpath   # 在 http://localhost:4173/some/path/ 測試子路徑部署
```

## 部署

`dist/` 可放到任何靜態主機的任意子路徑（所有資源皆為相對路徑）。

- **終端機模式**需要跨來源隔離（`SharedArrayBuffer`）。主機能設定標頭時加上
  `Cross-Origin-Opener-Policy: same-origin` 與 `Cross-Origin-Embedder-Policy: credentialless`；
  不能設定（例如 GitHub Pages）時，內建的 `coi-serviceworker.js` 會自動補上（第一次開啟會重新整理一次）。
- **C++ 編譯器**預設從 jsDelivr 載入；自行託管時把 `@yowasp/clang` 的 `gen/` 放到 `dist/clang/`，並在設定中選「自行託管」，或建置時指定 `VITE_CLANG_BASE`。
- **Code Noter 分享**需要部署代理，見 [proxy/README.md](proxy/README.md)。建置時可用 `VITE_CODENOTER_PROXY` 指定預設代理網址；本機測試可執行 `node scripts/proxy-dev.mjs`。

## 結構

| 路徑 | 說明 |
| --- | --- |
| `src/lib/store.svelte.js` | 專案、檔案、測資、設定的狀態；IndexedDB 寫入與跨分頁同步 |
| `src/lib/locks.js` | 編輯鎖（Web Locks API） |
| `src/lib/runner.js` | 管理執行 Worker：編譯快取、串流輸出、逾時、終端機輸入 |
| `src/runtime/io.js` | Worker 端的 stdin / stdout（SharedArrayBuffer 同步輸入） |
| `src/workers/` | `js` / `py`（Pyodide）/ `cppc`（clang 編譯）/ `cppx`（WASI 執行） |
| `src/lib/runState.svelte.js` | 測資模式的執行流程 |
| `src/lib/zip.js` | zip 上傳下載（測資存在 `.webeditor/`） |
| `src/lib/codenoter.js` | Code Noter API |
| `proxy/` | Code Noter 代理（Cloudflare Worker） |
