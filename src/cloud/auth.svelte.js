// 登入狀態（spec_new §3）
import { api, loadAuth, saveAuth, onUnauthorized, AUTH_STORAGE_KEY } from './api.js';
import { toast } from '../lib/dialog.svelte.js';

const LAST_USER_KEY = 'webeditor.lastUserId';

export const auth = $state({
  user: loadAuth()?.user ?? null,
  config: null, // { allowRegistration, limits }
});

const listeners = new Set();
/** 登入／登出（含其他分頁）時呼叫：fn(user | null, { reason }) */
export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(reason) {
  for (const fn of listeners) {
    try { fn(auth.user, { reason }); } catch (e) { console.error(e); }
  }
}

function lastUserId() {
  try { return Number(localStorage.getItem(LAST_USER_KEY)) || null; } catch { return null; }
}
function setLastUser(id) {
  try {
    if (id) localStorage.setItem(LAST_USER_KEY, String(id));
    else localStorage.removeItem(LAST_USER_KEY);
  } catch { /* 略過 */ }
}

/**
 * 雲端專案屬於哪個帳號：已登入時為目前帳號；登入失效（但未主動登出）時沿用上一個帳號，
 * 讓專案仍然顯示、修改仍會在重新登入後上傳
 */
export function ownerId() {
  return auth.user?.id ?? lastUserId();
}

function setAuth(value, reason) {
  saveAuth(value);
  auth.user = value?.user ?? null;
  if (value?.user) setLastUser(value.user.id);
  emit(reason);
}

export async function login(username, password) {
  const r = await api('/auth/login', { method: 'POST', body: { username, password }, auth: false });
  setAuth({ token: r.token, user: r.user }, 'login');
  return r.user;
}

export async function register(username, password, displayName) {
  const r = await api('/auth/register', { method: 'POST', body: { username, password, displayName: displayName || null }, auth: false });
  setAuth({ token: r.token, user: r.user }, 'login');
  return r.user;
}

/** 主動登出：撤銷伺服器端 token，並忘記上一個帳號 */
export async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* 離線時直接登出 */ }
  setLastUser(null);
  setAuth(null, 'logout');
}

/** 伺服器已撤銷 token（例如修改密碼、登出所有裝置）：本地也登出，但保留上一個帳號 */
export function dropSession(reason = 'expired') {
  setAuth(null, reason);
}

export async function refreshMe() {
  const u = await api('/me');
  const a = loadAuth();
  if (a) saveAuth({ ...a, user: u });
  auth.user = u;
  return u;
}

export async function loadSiteConfig() {
  try {
    auth.config = await api('/config', { auth: false });
  } catch { /* 連不上時之後再試 */ }
  return auth.config;
}

onUnauthorized((err) => {
  if (!auth.user) return;
  toast(err.code === 'account_disabled' ? '此帳號已被停用' : '登入已失效，請重新登入', 4000);
  dropSession('expired');
});

// 其他分頁登入或登出
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== AUTH_STORAGE_KEY) return;
    const user = loadAuth()?.user ?? null;
    if ((user?.id ?? null) === (auth.user?.id ?? null)) {
      if (user) auth.user = user;
      return;
    }
    auth.user = user;
    emit(user ? 'login-other-tab' : 'logout-other-tab');
  });
}
