import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// 開發伺服器直接送出跨來源隔離標頭（終端機模式需要 SharedArrayBuffer，spec §6.4.3）
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

// base: './' 讓建置輸出全部使用相對路徑，可部署在任意子路徑
export default defineConfig({
  base: './',
  plugins: [svelte()],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: { headers: isolation },
  preview: { headers: isolation },
});
