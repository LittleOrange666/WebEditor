// APCS Code Noter 串接（spec §8）：一律經由代理呼叫
import { CODENOTER_ORIGIN } from './config.js';
import { langOf } from './paths.js';

export const CODENOTER_LANGUAGES = ['cpp', 'python', 'javascript', 'typescript', 'java', 'csharp', 'php', 'ruby', 'go', 'rust',
  'swift', 'kotlin', 'html', 'css', 'sql', 'json', 'xml', 'yaml', 'markdown', 'bash', 'plaintext'];

export function languageForPath(path) {
  const l = langOf(path);
  if (l === 'cpp' || l === 'h') return 'cpp';
  if (l === 'py') return 'python';
  if (l === 'js') return 'javascript';
  const ext = path.toLowerCase().split('.').pop();
  return { md: 'markdown', json: 'json', html: 'html', css: 'css', sql: 'sql', xml: 'xml', yml: 'yaml', yaml: 'yaml', sh: 'bash', java: 'java', ts: 'typescript', go: 'go', rs: 'rust' }[ext] ?? 'plaintext';
}

export function extForLanguage(lang) {
  return { cpp: '.cpp', python: '.py', javascript: '.js', typescript: '.ts', java: '.java', markdown: '.md', json: '.json', html: '.html', css: '.css', sql: '.sql', xml: '.xml', yaml: '.yaml', bash: '.sh', go: '.go', rust: '.rs', csharp: '.cs', php: '.php', ruby: '.rb', swift: '.swift', kotlin: '.kt' }[lang] ?? '.txt';
}

/** 從分享連結或 ID 取出 ID；無法辨識時回傳 null */
export function parseId(input) {
  const s = input.trim();
  if (!s) return null;
  const m = s.match(/\/code\/([^/?#\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  if (/^[\w-]+$/.test(s)) return s;
  return null;
}

export const shareUrl = (id) => `${CODENOTER_ORIGIN}/code/${encodeURIComponent(id)}`;

function base(proxy) {
  if (!proxy) throw new Error('尚未設定 Code Noter 代理網址（請到「設定」中填寫）');
  return proxy.replace(/\/+$/, '');
}

async function parse(res) {
  let data = null;
  try { data = await res.json(); } catch { /* 不是 JSON */ }
  return data;
}

/** 上傳程式碼；回傳分享連結 */
export async function uploadCode(proxy, { code, language, title, description }) {
  let res;
  try {
    res = await fetch(`${base(proxy)}/api/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, language, title, description }),
    });
  } catch {
    throw new Error('網路錯誤，請稍後再試（或檢查代理網址是否正確）');
  }
  const data = await parse(res);
  if (res.status === 413) throw new Error('程式碼太大，無法上傳');
  if (!data?.success || !data.url) throw new Error(data?.error || `建立失敗（HTTP ${res.status}）`);
  return data.url;
}

/** 讀取程式碼；回傳 { code, language, title, description } */
export async function fetchCode(proxy, id) {
  let res;
  try {
    res = await fetch(`${base(proxy)}/api/code/${encodeURIComponent(id)}`);
  } catch {
    throw new Error('網路錯誤，請稍後再試（或檢查代理網址是否正確）');
  }
  const data = await parse(res);
  if (!data?.success || !data.snippet) throw new Error(data?.error || `找不到程式碼片段（HTTP ${res.status}）`);
  return data.snippet;
}
