<script>
  // 分享的唯讀檢視頁：#/s/<id>、#/s/<id>/import（spec_new §5.2、§5.3）
  import { onMount } from 'svelte';
  import { api } from './api.js';
  import { app } from '../lib/store.svelte.js';
  import { openModal } from '../lib/ui.svelte.js';
  import { toast } from '../lib/dialog.svelte.js';
  import { buildZip, downloadText, downloadBlob } from '../lib/zip.js';
  import { basename } from '../lib/paths.js';
  import ReadonlyProject from './ReadonlyProject.svelte';

  let { route, dark } = $props();
  const m = route.match(/^#\/s\/([0-9A-Za-z]+)(\/import)?/);
  const id = m?.[1];
  const autoImport = !!m?.[2];

  let share = $state(null);
  let error = $state('');
  let selected = $state(null);

  const files = $derived(share?.files?.filter((f) => f.kind === 'file') ?? []);
  const current = $derived(files.find((f) => f.path === selected) ?? files[0]);
  const fmt = (t) => new Date(t).toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' });

  onMount(async () => {
    try {
      share = await api(`/s/${id}`, { auth: false });
      document.title = `${share.title} - WebEditor`;
      if (autoImport) openImport();
    } catch (e) {
      error = e.status === 404 ? '此分享連結不存在或已失效' : e.message;
    }
  });

  async function openImport() {
    // 等編輯器的資料載入完成
    for (let i = 0; i < 100 && app.loading; i++) await new Promise((r) => setTimeout(r, 100));
    openModal({ kind: 'shareImport', share, ondone: () => { location.hash = '#/'; } });
  }

  function copy() {
    navigator.clipboard?.writeText(current?.content ?? '').then(() => toast('已複製程式碼'), () => toast('無法複製'));
  }

  async function download() {
    if (share.kind === 'file') downloadText(files[0].content, basename(files[0].path));
    else downloadBlob(await buildZip(share.files.map((f) => ({ ...f }))), `${share.title || 'project'}.zip`);
  }
</script>

<div class="page">
  <header class="top">
    <a class="brand" href="#/">WebEditor</a>
    <span class="sp"></span>
    <a href="#/">回到編輯器</a>
  </header>
  {#if error}
    <div class="center"><p class="error">{error}</p><a href="#/">回到編輯器</a></div>
  {:else if !share}
    <div class="center"><p class="muted">載入中…</p></div>
  {:else}
    <div class="meta">
      <div class="head">
        <h1>{share.title}</h1>
        <span class="tag">{share.kind === 'project' ? `專案・${files.length} 個檔案` : '檔案'}・唯讀</span>
      </div>
      <p class="sub">
        {share.author.displayName || share.author.username}・{fmt(share.createdAt)}・瀏覽 {share.viewCount} 次{#if share.expiresAt}・{fmt(share.expiresAt)} 到期{/if}
      </p>
      {#if share.description}<p class="desc">{share.description}</p>{/if}
      <div class="acts">
        <button class="primary" onclick={openImport}>開啟編輯</button>
        <button onclick={copy}>複製程式碼</button>
        <button onclick={download}>{share.kind === 'file' ? '下載' : '下載 zip'}</button>
      </div>
    </div>
    <div class="body">
      <ReadonlyProject entries={share.files} {dark} bind:selected />
    </div>
  {/if}
</div>

<style>
  .page { height: 100dvh; display: flex; flex-direction: column; }
  .top { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--surface); }
  .brand { font-weight: 700; color: var(--accent); text-decoration: none; }
  .sp { flex: 1; }
  .center { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; }
  .error { color: var(--danger); }
  .muted { color: var(--muted); }
  .meta { padding: 12px 16px 8px; display: flex; flex-direction: column; gap: 4px; }
  .head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 20px; word-break: break-word; }
  .tag { font-size: 12px; color: var(--muted); background: var(--surface-2); padding: 1px 8px; border-radius: 8px; }
  .sub { margin: 0; color: var(--muted); font-size: 13px; }
  .desc { margin: 4px 0 0; font-size: 14px; white-space: pre-wrap; }
  .acts { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  .body { flex: 1; min-height: 0; display: flex; padding: 0 16px 16px; }
  @media (max-width: 768px) { .meta { padding: 10px 16px 6px; } }
</style>
