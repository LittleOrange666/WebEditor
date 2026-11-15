// 後端 API（spec_new §7.3）：fetch 包裝、Bearer token、統一錯誤
import { API_BASE } from '../lib/config.js';

const AUTH_KEY = 'webeditor.auth.v1';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** 登入資訊存在 localStorage（跨分頁共用）：{ token, user } */
export function loadAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch { return null; }
}

export function saveAuth(value) {
  try {
    if (value) localStorage.setItem(AUTH_KEY, JSON.stringify(value));
    else localStorage.removeItem(AUTH_KEY);
  } catch { /* 略過 */ }
}

export const AUTH_STORAGE_KEY = AUTH_KEY;

let unauthorizedHandler = () => {};
export function onUnauthorized(fn) { unauthorizedHandler = fn; }

export async function api(path, { method = 'GET', body, auth = true, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = auth ? loadAuth()?.token : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${API_BASE}api/v1${path}`, {
      method, headers, signal, credentials: 'omit', mode: 'cors',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new ApiError(0, 'network', '無法連線到伺服器，請稍後再試');
  }
  let data = null;
  try { data = await res.json(); } catch { /* 沒有內容 */ }
  if (!res.ok) {
    const e = data?.error;
    const err = new ApiError(res.status, e?.code ?? 'error', e?.message ?? `伺服器錯誤（${res.status}）`);
    if (token && (res.status === 401 || e?.code === 'account_disabled')) unauthorizedHandler(err);
    throw err;
  }
  return data;
}

/** 前端網址中的分享連結：<前端網址>#/s/<id> */
export function shareUrl(id) {
  return `${location.origin}${location.pathname}#/s/${id}`;
}

/** 從分享連結或 id 取出 id */
export function parseShareId(input) {
  const s = (input || '').trim();
  const m = s.match(/#\/s\/([0-9A-Za-z]{6,16})/) ?? s.match(/^([0-9A-Za-z]{6,16})$/);
  return m ? m[1] : null;
}
