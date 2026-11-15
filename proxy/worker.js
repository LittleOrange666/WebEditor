// WebEditor 的 APCS Code Noter 代理（spec §8.4）
// coder.apcs.top 沒有回傳 CORS 標頭，瀏覽器中的 WebEditor 無法直接呼叫，因此由這個 Worker 轉送。
// 只轉送兩個端點：POST /api/code、GET /api/code/<ID>；其餘一律 404。
//
// 環境變數：
//   ALLOWED_ORIGINS  允許的來源，逗號分隔，例如 "https://you.github.io,http://localhost:5173"
//   UPSTREAM         （可選）上游網址，預設 https://coder.apcs.top

const MAX_BODY = 256 * 1024;

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    Vary: 'Origin',
  };
}

function json(status, data, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

export function isAllowedOrigin(origin, allowed) {
  if (!origin) return false;
  const list = (allowed || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.includes('*') || list.includes(origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowed = isAllowedOrigin(origin, env.ALLOWED_ORIGINS);
    const cors = allowed ? corsHeaders(origin) : { Vary: 'Origin' };
    const upstream = (env.UPSTREAM || 'https://coder.apcs.top').replace(/\/+$/, '');

    const isCreate = url.pathname === '/api/code';
    const getMatch = url.pathname.match(/^\/api\/code\/([A-Za-z0-9_-]{1,64})$/);
    if (!isCreate && !getMatch) return json(404, { success: false, error: 'Not found' }, cors);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    }
    if (!allowed) return json(403, { success: false, error: '不允許的來源' }, cors);

    let init;
    if (isCreate) {
      if (request.method !== 'POST') return json(405, { success: false, error: 'Method not allowed' }, cors);
      if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) {
        return json(415, { success: false, error: '只接受 application/json' }, cors);
      }
      const declared = Number(request.headers.get('Content-Length') || 0);
      if (declared > MAX_BODY) return json(413, { success: false, error: '程式碼太大' }, cors);
      const body = await request.arrayBuffer();
      if (body.byteLength > MAX_BODY) return json(413, { success: false, error: '程式碼太大' }, cors);
      init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body };
    } else {
      if (request.method !== 'GET') return json(405, { success: false, error: 'Method not allowed' }, cors);
      init = { method: 'GET' };
    }

    let res;
    try {
      res = await fetch(upstream + url.pathname, init);
    } catch {
      return json(502, { success: false, error: '無法連線到 Code Noter' }, cors);
    }
    // 原樣轉回狀態碼與內容，只加上 CORS 標頭（不記錄程式碼內容）
    const headers = new Headers({ 'Content-Type': res.headers.get('Content-Type') || 'application/json', ...cors });
    return new Response(res.body, { status: res.status, headers });
  },
};
