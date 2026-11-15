<script>
  // 設定（spec §5）
  import Modal from './Modal.svelte';
  import { app, updateSettings } from '../lib/store.svelte.js';
  import { INTERACTIVE_SUPPORTED } from '../lib/runner.js';

  let { onclose } = $props();
  let proxy = $state(app.settings.codenoterProxy);
  let proxyError = $state('');

  function saveProxy() {
    const v = proxy.trim();
    if (v && !/^https?:\/\/[^\s]+$/i.test(v)) { proxyError = '請輸入以 http:// 或 https:// 開頭的網址'; return; }
    proxyError = '';
    updateSettings({ codenoterProxy: v.replace(/\/+$/, '') });
  }
</script>

<Modal title="設定" {onclose}>
  <div class="grid">
    <label>主題
      <select value={app.settings.theme} onchange={(e) => updateSettings({ theme: e.target.value })}>
        <option value="system">跟隨系統</option>
        <option value="light">淺色</option>
        <option value="dark">深色</option>
      </select>
    </label>
    <label>字型大小
      <input type="number" min="10" max="28" value={app.settings.fontSize} onchange={(e) => updateSettings({ fontSize: Math.min(28, Math.max(10, +e.target.value || 14)) })} />
    </label>
    <label>Tab 寬度
      <select value={app.settings.tabSize} onchange={(e) => updateSettings({ tabSize: +e.target.value })}>
        <option value={2}>2</option><option value={4}>4</option><option value={8}>8</option>
      </select>
    </label>
    <label>測資模式預設時限（秒）
      <input type="number" min="1" max="60" value={app.settings.timeLimit} onchange={(e) => updateSettings({ timeLimit: Math.min(60, Math.max(1, +e.target.value || 5)) })} />
    </label>
    <label>終端機 stderr
      <select value={app.settings.stderrMode} onchange={(e) => updateSettings({ stderrMode: e.target.value })}>
        <option value="merge">合併到終端機（紅色）</option>
        <option value="split">分開顯示</option>
      </select>
    </label>
    <label>C++ 編譯器來源
      <select value={app.settings.clangSource} onchange={(e) => updateSettings({ clangSource: e.target.value })}>
        <option value="cdn">jsDelivr CDN（預設）</option>
        <option value="self">自行託管（./clang/）</option>
      </select>
    </label>
    <label class="full">Code Noter 代理網址
      <input type="url" bind:value={proxy} placeholder="https://xxx.workers.dev" onchange={saveProxy} aria-invalid={proxyError ? 'true' : undefined} />
      {#if proxyError}<span class="error">{proxyError}</span>{/if}
      <span class="hint">coder.apcs.top 不允許跨網域呼叫，需經由代理（見 proxy/README.md）。</span>
    </label>
  </div>
  <p class="status">終端機模式：{INTERACTIVE_SUPPORTED ? '✅ 可使用' : '❌ 無法使用（此頁面未啟用跨來源隔離）'}</p>
  {#snippet footer()}<button class="primary" onclick={() => { saveProxy(); if (!proxyError) onclose(); }}>完成</button>{/snippet}
</Modal>

<style>
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 520px) { .grid { grid-template-columns: 1fr; } }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
  .full { grid-column: 1 / -1; }
  input, select { font-size: 14px; padding: 5px 8px; color: var(--text); }
  .hint { font-size: 12px; }
  .error { color: var(--danger); font-size: 12px; }
  .status { font-size: 13px; margin: 14px 0 0; }
</style>
