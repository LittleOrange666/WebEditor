<script>
  // 從分享連結匯入（spec_new §5.4）
  import { onMount } from 'svelte';
  import Modal from '../components/Modal.svelte';
  import { app, createProjectFrom, importFiles, fileByPath, openTab, validateNewName } from '../lib/store.svelte.js';
  import { joinPath, splitExt, basename } from '../lib/paths.js';
  import { choiceDialog, toast } from '../lib/dialog.svelte.js';
  import { api, parseShareId } from './api.js';

  let { initial = '', share: preloaded = null, onclose, ondone = null } = $props();

  let input = $state(initial);
  let busy = $state(false);
  let error = $state('');
  let share = $state(preloaded);
  let target = $state('current');
  let filename = $state(preloaded?.kind === 'file' ? basename(preloaded.files[0].path) : '');
  const nameError = $derived(share?.kind === 'file' ? validateNewName(target === 'current' ? app.selectedDir : '', filename) : null);
  const blocking = $derived(nameError && !nameError.includes('同名'));
  const files = $derived(share?.files?.filter((f) => f.kind === 'file') ?? []);

  async function load() {
    error = '';
    const id = parseShareId(input);
    if (!id) { error = '請輸入分享連結（…#/s/…）或分享 ID'; return; }
    busy = true;
    try {
      share = await api(`/s/${id}`, { auth: false });
      if (share.kind === 'file') filename = basename(share.files[0].path);
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
    }
  }

  async function doImport() {
    if (app.loading) { toast('編輯器尚在載入中，請稍候'); return; }
    const done = ondone; // 關閉對話框後 props 就讀不到了
    if (share.kind === 'project') {
      const list = share.files.map((f) => (f.kind === 'dir' ? { path: f.path + '/' } : { path: f.path, content: f.content }));
      await createProjectFrom(share.title || '分享的專案', list);
      toast('已建立新專案');
    } else if (target === 'new') {
      await createProjectFrom(share.title || splitExt(filename)[0], [{ path: filename, content: files[0].content }]);
      toast('已建立新專案');
    } else {
      const dir = app.selectedDir;
      await importFiles(dir, [{ path: filename, content: files[0].content }], async (path) => {
        const r = await choiceDialog({
          title: '已有同名檔案', message: `「${path}」已經存在，要怎麼處理？`,
          choices: [{ value: 'keep', label: '保留兩者', primary: true }, { value: 'replace', label: '取代', danger: true }],
        });
        return r.value ?? 'skip';
      });
      const created = fileByPath(joinPath(dir, filename));
      if (created) openTab(created.id);
      toast('已匯入');
    }
    onclose();
    done?.();
  }

  onMount(() => { if (initial && !preloaded) load(); });
</script>

<Modal title="從分享連結匯入" {onclose}>
  {#if !preloaded}
    <form class="row" onsubmit={(e) => { e.preventDefault(); load(); }}>
      <input bind:value={input} placeholder="分享連結或 ID" aria-label="分享連結或 ID" autofocus />
      <button type="submit" disabled={busy}>{busy ? '讀取中…' : '讀取'}</button>
    </form>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {/if}

  {#if share}
    <div class="preview-box">
      <div class="meta"><strong>{share.title}</strong> <span class="tag">{share.kind === 'project' ? `專案・${files.length} 個檔案` : '檔案'}</span></div>
      <small class="muted">{share.author.displayName || share.author.username} 分享</small>
      {#if share.description}<p class="desc">{share.description}</p>{/if}
      {#if share.kind === 'file'}
        <pre>{files[0].content.split('\n').slice(0, 12).join('\n')}{files[0].content.split('\n').length > 12 ? '\n…' : ''}</pre>
      {:else}
        <ul class="flist">{#each files.slice(0, 12) as f}<li>{f.path}</li>{/each}{#if files.length > 12}<li>…</li>{/if}</ul>
      {/if}
    </div>
    {#if share.kind === 'file'}
      <fieldset>
        <legend>匯入到</legend>
        <label><input type="radio" bind:group={target} value="current" /> 目前專案（{app.selectedDir ? app.selectedDir + '/' : '根目錄'}）</label>
        <label><input type="radio" bind:group={target} value="new" /> 建立為新專案</label>
      </fieldset>
      <label class="fname">檔名<input bind:value={filename} aria-invalid={blocking ? 'true' : undefined} /></label>
      {#if blocking}<p class="error">{nameError}</p>{/if}
      {#if nameError && !blocking}<p class="hint">已有同名檔案，匯入時會詢問處理方式</p>{/if}
    {:else}
      <p class="hint">會建立為新專案（名稱「{share.title}」）。匯入的是複本，與分享者的專案無關。</p>
    {/if}
  {/if}

  {#snippet footer()}
    <button onclick={onclose}>取消</button>
    <button class="primary" disabled={!share || blocking} onclick={doImport}>匯入</button>
  {/snippet}
</Modal>

<style>
  .row { display: flex; gap: 6px; }
  .row input { flex: 1; font-size: 14px; padding: 6px 8px; min-width: 0; }
  .error { color: var(--danger); font-size: 13px; margin: 6px 0 0; }
  .hint { color: var(--muted); font-size: 12px; margin: 8px 0 0; }
  .muted { color: var(--muted); font-size: 12px; }
  .preview-box { margin-top: 12px; border: 1px solid var(--border); border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 2px; }
  .meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .tag { font-size: 12px; color: var(--muted); background: var(--surface-2); padding: 1px 6px; border-radius: 8px; }
  .desc { font-size: 13px; color: var(--muted); margin: 4px 0; white-space: pre-wrap; }
  pre { margin: 6px 0 0; font-family: var(--mono); font-size: 12px; background: var(--surface-2); padding: 6px; border-radius: 6px; max-height: 200px; overflow: auto; }
  .flist { margin: 6px 0 0; padding-left: 18px; font-family: var(--mono); font-size: 12px; max-height: 200px; overflow: auto; }
  fieldset { border: none; padding: 0; margin: 12px 0 0; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
  legend { color: var(--muted); font-size: 13px; margin-bottom: 4px; }
  .fname { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; font-size: 13px; color: var(--muted); }
  .fname input { font-family: var(--mono); font-size: 14px; padding: 6px 8px; }
</style>
