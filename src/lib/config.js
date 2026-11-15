// 集中設定：外部資源版本、執行參數、Code Noter 代理

// Pyodide 由 CDN 載入，固定版本
export const PYODIDE_VERSION = '0.27.2';
export const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

// C++ 編譯器（@yowasp/clang），固定版本；自行託管時以 VITE_CLANG_BASE 指定（結尾要有 /）
export const CLANG_VERSION = '22.0.0-git20542-10';
const CLANG_CDN = `https://cdn.jsdelivr.net/npm/@yowasp/clang@${CLANG_VERSION}/gen/`;
export function resolveClangBase(pageUrl, source = 'cdn') {
  const override = import.meta.env?.VITE_CLANG_BASE;
  if (source === 'self') return new URL(override || './clang/', pageUrl).href;
  return override ? new URL(override, pageUrl).href : CLANG_CDN;
}

export const CPP_COMPILE_FLAGS = ['-std=c++20', '-O2', '-fno-exceptions'];
export const CPP_LINK_FLAGS = ['-O2', '-fno-exceptions', '-Wl,-z,stack-size=67108864'];
export const CPP_COMPILE_TIMEOUT_MS = 600_000;

// 執行
export const DEFAULT_TIME_LIMIT_S = 5;
export const MAX_OUTPUT_BYTES = 16 * 1024 * 1024; // stdout + stderr 合計上限（spec §6.2.4）
export const PREVIEW_CHARS = 100_000; // 結果區最多顯示的字元數

// Code Noter（spec §8）：前端一律經由代理呼叫；可在設定中覆寫
// 建置時可用 VITE_CODENOTER_PROXY 指定預設值
export const DEFAULT_CODENOTER_PROXY = import.meta.env?.VITE_CODENOTER_PROXY ?? '';
export const CODENOTER_ORIGIN = 'https://coder.apcs.top';

export const LARGE_FILE_BYTES = 5 * 1024 * 1024;

// 版本（spec_new §1）：建置時由 vite.config.js 決定
export const EDITION = import.meta.env?.VITE_EDITION === 'cloud' ? 'cloud' : 'static';
export const IS_CLOUD = EDITION === 'cloud';
export const API_BASE = import.meta.env?.VITE_API_BASE ?? '';
