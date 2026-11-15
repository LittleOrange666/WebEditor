import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

// 開發伺服器直接送出跨來源隔離標頭（終端機模式需要 SharedArrayBuffer，spec §6.4.3）
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

// 版本（spec_new §1）：VITE_EDITION=static | cloud；--mode cloud 時預設為 cloud
// 版本專屬的程式透過 $edition 別名載入，另一個版本的程式不會被打包
export default defineConfig(({ mode, command }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...pick(process.env) };
  const edition = (env.VITE_EDITION || (mode === 'cloud' ? 'cloud' : 'static')) === 'cloud' ? 'cloud' : 'static';
  let apiBase = env.VITE_API_BASE || '';
  if (edition === 'cloud') {
    if (!apiBase && command === 'build') throw new Error('雲端版建置需要指定 VITE_API_BASE（後端網址）');
    apiBase ||= 'http://localhost:8000/';
    if (!apiBase.endsWith('/')) apiBase += '/';
  }
  return {
    // base: './' 讓建置輸出全部使用相對路徑，可部署在任意子路徑
    base: './',
    plugins: [svelte()],
    worker: { format: 'es' },
    build: { target: 'es2022', chunkSizeWarningLimit: 1500, outDir: edition === 'cloud' ? 'dist-cloud' : 'dist' },
    server: { headers: isolation },
    preview: { headers: isolation },
    define: {
      'import.meta.env.VITE_EDITION': JSON.stringify(edition),
      'import.meta.env.VITE_API_BASE': JSON.stringify(apiBase),
    },
    resolve: {
      alias: { $edition: fileURLToPath(new URL(`./src/edition/${edition}.js`, import.meta.url)) },
    },
  };
});

function pick(e) {
  const out = {};
  for (const k of ['VITE_EDITION', 'VITE_API_BASE']) if (e[k]) out[k] = e[k];
  return out;
}
