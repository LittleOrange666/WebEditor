// 路徑、檔名與語言判斷（spec §3.2）

/** 可執行語言：cpp / py / js；標頭檔回傳 'h'；其他回傳 null */
export function langOf(path) {
  const p = path.toLowerCase();
  if (/\.(cpp|cc|cxx)$/.test(p)) return 'cpp';
  if (/\.(h|hpp|hh|hxx)$/.test(p)) return 'h';
  if (/\.py$/.test(p)) return 'py';
  if (/\.(js|mjs)$/.test(p)) return 'js';
  return null;
}

export const isRunnable = (path) => ['cpp', 'py', 'js'].includes(langOf(path));

/** 編輯器語法高亮用 */
export function editorLang(path) {
  const l = langOf(path);
  if (l === 'h') return 'cpp';
  return l;
}

export const LANG_LABELS = { cpp: 'C++', py: 'Python', js: 'JavaScript' };

export const basename = (p) => p.slice(p.lastIndexOf('/') + 1);
export const dirname = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const joinPath = (dir, name) => (dir ? `${dir}/${name}` : name);

export function splitExt(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
}

const BAD_CHARS = /[\\/:*?"<>|\u0000-\u001f]/;

/** 檢查單一檔名／資料夾名稱，回傳錯誤訊息或 null */
export function validateName(name) {
  if (!name) return '名稱不可空白';
  if (name === '.' || name === '..') return '名稱不可為 . 或 ..';
  if (BAD_CHARS.test(name)) return '名稱不可包含 / \\ : * ? " < > |';
  if (name.length > 200) return '名稱太長';
  if (name === '.webeditor') return '.webeditor 是保留名稱';
  return null;
}

/** 正規化相對路徑：去除開頭的 ./、/，處理 ..；不合法時回傳 null */
export function normalizePath(p) {
  const parts = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else {
      if (validateName(seg) && seg !== '.webeditor') return null;
      parts.push(seg);
    }
  }
  return parts.length ? parts.join('/') : null;
}

/** 在 taken（小寫路徑集合）中找一個不重複的名稱：name (1).cpp、name (2).cpp… */
export function uniqueName(dir, name, takenLower) {
  if (!takenLower.has(joinPath(dir, name).toLowerCase())) return name;
  const [stem, ext] = splitExt(name);
  for (let i = 1; ; i++) {
    const cand = `${stem} (${i})${ext}`;
    if (!takenLower.has(joinPath(dir, cand).toLowerCase())) return cand;
  }
}

/** 是否為 zip 中應忽略的系統檔 */
export function isJunkPath(p) {
  return /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i.test(p);
}

/** 嘗試以 UTF-8 解碼；失敗回傳 null（視為二進位檔） */
export function decodeText(bytes) {
  try {
    const s = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (s.includes('\u0000')) return null;
    return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
  } catch {
    return null;
  }
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function sanitizeFileName(s) {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 100);
}
