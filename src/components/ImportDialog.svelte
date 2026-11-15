<script>
  // 從 APCS Code Noter 匯入（spec §8.3）
  import { onMount } from 'svelte';
  import Modal from './Modal.svelte';
  import { app, createProjectFrom, importFiles, fileByPath, openTab, validateNewName } from '../lib/store.svelte.js';
  import { fetchCode, parseId, extForLanguage } from '../lib/codenoter.js';
  import { sanitizeFileName, splitExt, joinPath, langOf } from '../lib/paths.js';
  import { choiceDialog, toast } from '../lib/dialog.svelte.js';

  let { initialId = '', onclose } = $props();

  let input = $state(initialId);
  let busy = $state(false);
  let error = $state('');
  let snippet = $state(null);
  let filename = $state('');
  let target = $state('current');
  let nameError = $derived(snippet ? (target === 'current' ? validateNewName(app.selectedDir, filename) : validateNewName('', filename)) : null);
  const proxy = $derived(app.settings.codenoterProxy);

  function suggestName(s) {
    const t = sanitizeFileName(s.title || '');
    const ext = extForLanguage(s.language);
    if (t && langOf(t) && ext !== '.txt') return t; // 標題本身就像檔名
    if (t && /\.[a-z0-9]{1,5}$/i.test(t)) return t;
    return `${t || 'code'}${ext}`;
  }

  async function load() {
    error = '';
    const id = parseId(input);
    if (!id) { error = '請輸入分享連結（https://coder.apcs.top/code/…）或 ID'; return; }
    busy = true;
    try {
      snippet = await fetchCode(proxy, id);
      filename = suggestName(snippet);
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
    }
  }

  async function doImport() {
    const content = snippet.code ?? '';
    if (target === 'new') {
      await createProjectFrom(snippet.title || splitExt(filename)[0], [{ path: filename, content }]);
      toast('已建立新專案');
    } else {
      const dir = app.selectedDir;
      let created = null;
      await importFiles(dir, [{ path: filename, content }], async (path) => {
        const r = await choiceDialog({
          title: '已有同名檔案', message: `「${path}」已經存在，要怎麼處理？`,
          choices: [{ value: 'keep', label: '保留兩者', primary: true }, { value: 'replace', label: '取代', danger: true }],
        });
        return r.value ?? 'skip';
      });
      created = fileByPath(joinPath(dir, filename));
      if (created) openTab(created.id);
      toast('已匯入');
    }
    onclose();
  }

  onMount(() => { if (initialId && proxy) load(); });
</script>

<Modal title="從 APCS Code Noter 匯入" {onclose}>
  {#if !proxy}
    <p class="warn">尚未設定 Code Noter 代理網址，無法匯入。請到「設定」中填寫。</p>
  {/if}
  <form class="row" onsubmit={(e) => { e.preventDefault(); load(); }}>
    <input bind:value={input} placeholder="https://coder.apcs.top/code/… 或 ID" aria-label="分享連結或 ID" autofocus />
    <button type="submit" disabled={busy || !proxy}>{busy ? '讀取中…' : '讀取'}</button>
  </form>
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if snippet}
    <div class="preview-box">
      <div class="meta"><strong>{snippet.title || '（無標題）'}</strong> <span class="lang">{snippet.language}</span></div>
      {#if snippet.description}<p class="desc">{snippet.description}</p>{/if}
      <pre>{(snippet.code ?? '').split('\n').slice(0, 12).join('\n')}{(snippet.code ?? '').split('\n').length > 12 ? '\n…' : ''}</pre>
    </div>
    <fieldset>
      <legend>匯入到</legend>
      <label><input type="radio" bind:group={target} value="current" /> 目前專案（{app.selectedDir ? app.selectedDir + '/' : '根目錄'}）</label>
      <label><input type="radio" bind:group={target} value="new" /> 建立為新專案</label>
    </fieldset>
    <label class="fname">檔名<input bind:value={filename} aria-invalid={nameError && !nameError.includes('同名') ? 'true' : undefined} /></label>
    {#if nameError && !nameError.includes('同名')}<p class="error">{nameError}</p>{/if}
    {#if nameError?.includes('同名')}<p class="hint">已有同名檔案，匯入時會詢問處理方式</p>{/if}
  {/if}

  {#snippet footer()}
    <button onclick={onclose}>取消</button>
    <button class="primary" disabled={!snippet || (nameError && !nameError.includes('同名'))} onclick={doImport}>匯入</button>
  {/snippet}
</Modal>

<style>
  .row { display: flex; gap: 6px; }
  .row input { flex: 1; font-size: 14px; padding: 6px 8px; min-width: 0; }
  .error { color: var(--danger); font-size: 13px; margin: 6px 0 0; }
  .hint { color: var(--muted); font-size: 12px; margin: 4px 0 0; }
  .warn { font-size: 13px; color: var(--warning); background: var(--warning-soft); padding: 6px 8px; border-radius: 6px; }
  .preview-box { margin-top: 12px; border: 1px solid var(--border); border-radius: 8px; padding: 8px; }
  .meta { display: flex; gap: 8px; align-items: center; }
  .lang { font-size: 12px; color: var(--muted); background: var(--surface-2); padding: 1px 6px; border-radius: 8px; }
  .desc { font-size: 13px; color: var(--muted); margin: 4px 0; }
  pre { margin: 6px 0 0; font-family: var(--mono); font-size: 12px; background: var(--surface-2); padding: 6px; border-radius: 6px; max-height: 200px; overflow: auto; }
  fieldset { border: none; padding: 0; margin: 12px 0 0; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
  legend { color: var(--muted); font-size: 13px; margin-bottom: 4px; }
  .fname { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; font-size: 13px; color: var(--muted); }
  .fname input { font-family: var(--mono); font-size: 14px; padding: 6px 8px; }
</style>
