<script>
  // 建立分享（spec_new §5.1）：目前檔案或整個專案的快照
  import QRCode from 'qrcode';
  import Modal from '../components/Modal.svelte';
  import { app, flushAll, currentProject } from '../lib/store.svelte.js';
  import { basename, formatBytes } from '../lib/paths.js';
  import { toast } from '../lib/dialog.svelte.js';
  import { downloadBlob } from '../lib/zip.js';
  import { openModal } from '../lib/ui.svelte.js';
  import { api, shareUrl } from './api.js';
  import { auth } from './auth.svelte.js';
  import { isSyncableEntry, byteLength } from './syncLogic.js';

  let { file, onclose } = $props();

  const project = currentProject();
  const fileOk = !!file && file.kind === 'file' && isSyncableEntry(file);
  let what = $state(fileOk ? 'file' : 'project');
  let title = $state(fileOk ? basename(file.path) : project?.name ?? '');
  let titleTouched = false;
  let description = $state('');
  let expires = $state('');
  let busy = $state(false);
  let error = $state('');
  let result = $state(null);
  let qr = $state('');

  const projectFiles = $derived(app.files.filter((f) => f.kind === 'file' && isSyncableEntry(f)));
  const skipped = $derived(app.files.filter((f) => f.kind === 'file' && !isSyncableEntry(f)));
  const totalBytes = $derived(what === 'file' ? byteLength(file?.content) : projectFiles.reduce((n, f) => n + byteLength(f.content), 0));
  const url = $derived(result ? shareUrl(result.id) : '');

  function setWhat(v) {
    what = v;
    if (!titleTouched) title = v === 'file' ? basename(file.path) : project?.name ?? '';
  }

  function payload() {
    if (what === 'file') return [{ path: basename(file.path), kind: 'file', content: file.content ?? '' }];
    const dirs = app.files.filter((f) => f.kind === 'dir').map((f) => ({ path: f.path, kind: 'dir' }));
    return [...dirs, ...projectFiles.map((f) => ({ path: f.path, kind: 'file', content: f.content ?? '' }))];
  }

  async function submit() {
    error = '';
    await flushAll();
    const files = payload();
    if (!files.some((f) => f.kind === 'file' && f.content.trim())) { error = what === 'file' ? '檔案是空的，無法分享' : '專案中沒有可分享的程式檔'; return; }
    busy = true;
    try {
      result = await api('/shares', {
        method: 'POST',
        body: { kind: what, title: title.trim(), description: description.trim(), expiresInDays: expires ? Number(expires) : null, files },
      });
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
    }
  }

  async function makeQr() {
    qr = await QRCode.toDataURL(url, { width: 280, margin: 2, errorCorrectionLevel: 'M' });
  }

  async function downloadQr() {
    downloadBlob(await (await fetch(qr)).blob(), `${title || 'share'}-qrcode.png`);
  }

  function copy() {
    navigator.clipboard?.writeText(url).then(() => toast('已複製連結'), () => toast('無法複製，請手動選取'));
  }
</script>

<Modal title="分享" {onclose} dirty={!result && description !== ''}>
  {#if !auth.user}
    <p>建立分享連結需要登入。</p>
    <button class="primary" onclick={() => openModal({ kind: 'login' })}>登入</button>
  {:else if !result}
    <div class="form">
      <fieldset>
        <legend>要分享</legend>
        <label class="radio" class:disabled={!fileOk}>
          <input type="radio" name="what" value="file" checked={what === 'file'} disabled={!fileOk} onchange={() => setWhat('file')} />
          目前檔案{file ? `（${file.path}）` : ''}
          {#if file && !fileOk}<small>— 只能分享程式檔（.cpp .h .py .js …）</small>{/if}
        </label>
        <label class="radio">
          <input type="radio" name="what" value="project" checked={what === 'project'} onchange={() => setWhat('project')} />
          整個專案（{project?.name}）
        </label>
      </fieldset>
      {#if what === 'project'}
        <p class="info">會包含 {projectFiles.length} 個程式檔（{formatBytes(totalBytes)}）與資料夾結構。{#if skipped.length}略過 {skipped.length} 個其他檔案（{skipped.slice(0, 3).map((f) => basename(f.path)).join('、')}{skipped.length > 3 ? '…' : ''}）。{/if}不包含測資。</p>
      {/if}
      <label>標題<input bind:value={title} maxlength="200" oninput={() => (titleTouched = true)} /></label>
      <label>說明（選填）<textarea bind:value={description} rows="2" maxlength="1000"></textarea></label>
      <label>到期
        <select bind:value={expires}>
          <option value="">永不過期</option>
          <option value="1">1 天</option>
          <option value="7">7 天</option>
          <option value="30">30 天</option>
        </select>
      </label>
      <p class="note">⚠️ 任何拿到連結的人都能看到內容。分享的是現在的快照，之後的修改不會影響分享內容。</p>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </div>
  {:else}
    <div class="done">
      <p>已建立分享連結：</p>
      <div class="url"><a href={url} target="_blank" rel="noopener noreferrer">{url}</a></div>
      <div class="acts">
        <button class="primary" onclick={copy}>複製連結</button>
        {#if !qr}<button onclick={makeQr}>產生 QR Code</button>{/if}
      </div>
      {#if qr}
        <img class="qr" src={qr} alt="分享連結的 QR Code" />
        <button onclick={downloadQr}>下載 QR Code（PNG）</button>
      {/if}
      <p class="muted">可以在帳號選單的「我的分享」中管理或撤銷。</p>
    </div>
  {/if}
  {#snippet footer()}
    {#if auth.user && !result}
      <button onclick={onclose}>取消</button>
      <button class="primary" disabled={busy} onclick={submit}>{busy ? '建立中…' : '建立分享連結'}</button>
    {:else}
      <button class="primary" onclick={onclose}>完成</button>
    {/if}
  {/snippet}
</Modal>

<style>
  .form { display: flex; flex-direction: column; gap: 10px; }
  fieldset { border: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
  legend { color: var(--muted); font-size: 13px; margin-bottom: 4px; }
  .radio { flex-direction: row; align-items: center; gap: 6px; color: var(--text); font-size: 14px; flex-wrap: wrap; }
  .radio.disabled { color: var(--muted); }
  .radio small { color: var(--muted); }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
  input:not([type='radio']), textarea, select { font-size: 14px; padding: 6px 8px; }
  textarea { font: inherit; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text); resize: vertical; }
  .info { font-size: 13px; margin: 0; background: var(--surface-2); padding: 6px 8px; border-radius: 6px; }
  .note { font-size: 12px; color: var(--warning); margin: 0; }
  .error { color: var(--danger); font-size: 13px; margin: 0; }
  .muted { color: var(--muted); font-size: 12px; margin: 0; }
  .done { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
  .done p { margin: 0; }
  .url { font-family: var(--mono); font-size: 13px; word-break: break-all; background: var(--surface-2); padding: 6px 8px; border-radius: 6px; width: 100%; box-sizing: border-box; }
  .acts { display: flex; gap: 6px; flex-wrap: wrap; }
  .qr { width: 100%; max-width: 280px; height: auto; image-rendering: pixelated; align-self: center; background: #fff; border-radius: 8px; }
</style>
