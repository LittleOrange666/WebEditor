# Code Noter 代理（Cloudflare Worker）

[coder.apcs.top](https://coder.apcs.top/) 的 API 沒有回傳 CORS 標頭，部署在其他網域的 WebEditor 無法在瀏覽器中直接呼叫，所以需要這個代理轉送請求。

代理只轉送兩個端點，其餘一律回 404：

| 代理 | 轉送到 |
| --- | --- |
| `POST /api/code` | `https://coder.apcs.top/api/code` |
| `GET /api/code/<ID>` | `https://coder.apcs.top/api/code/<ID>` |

- 只允許 `ALLOWED_ORIGINS` 中的網站呼叫
- 請求本文上限 256 KB，只接受 `application/json`
- 不記錄程式碼內容
- 回應會加上 `Cross-Origin-Resource-Policy: cross-origin`，配合 WebEditor 的跨來源隔離

## 部署

1. 安裝並登入 Wrangler：

   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. 修改 `wrangler.toml` 的 `ALLOWED_ORIGINS`，加入 WebEditor 的網址（只要「來源」，例如 `https://you.github.io`，不含路徑）。

3. 部署：

   ```bash
   cd proxy
   wrangler deploy
   ```

4. 把部署後得到的網址（例如 `https://webeditor-codenoter-proxy.<帳號>.workers.dev`）填到 WebEditor 的「設定 → Code Noter 代理網址」，或在建置時指定成預設值：

   ```bash
   VITE_CODENOTER_PROXY=https://webeditor-codenoter-proxy.xxx.workers.dev npm run build
   ```

## 速率限制

程式中不做速率限制，請在 Cloudflare 後台以 WAF / Rate limiting rules 設定（例如每個 IP 每分鐘 20 次）。

## 本機測試

```bash
cd proxy
wrangler dev
```

再把 WebEditor 的代理網址設為 `http://localhost:8787`。
