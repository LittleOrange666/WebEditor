<script>
  // 分享到 APCS Code Noter（spec §8.2）
  import QRCode from 'qrcode';
  import Modal from './Modal.svelte';
  import { app, flushAll } from '../lib/store.svelte.js';
  import { uploadCode, languageForPath, CODENOTER_LANGUAGES } from '../lib/codenoter.js';
  import { basename } from '../lib/paths.js';
  import { toast } from '../lib/dialog.svelte.js';
  import { downloadBlob } from '../lib/zip.js';

  let { file, onclose } = $props();

  let title = $state(basename(file.path));
  let description = $state('');
  let language = $state(languageForPath(file.path));
  let busy = $state(false);
  let error = $state('');
  let url = $state('');
  let qr = $state('');

  const code = $derived(file.content ?? '');
  const preview = $derived(code.split('\n').slice(0, 8).join('\n'));
  const proxy = $derived(app.settings.codenoterProxy);

  async function submit() {
    error = '';
    if (!code.trim()) { error = '檔案是空的，無法上傳'; return; }
    busy = true;
    try {
      await flushAll();
      url = await uploadCode(proxy, { code, language, title: title.trim() || basename(file.path), description: description.trim() });
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
    const blob = await (await fetch(qr)).blob();
    downloadBlob(blob, `${basename(file.path)}-qrcode.png`);
  }

  function copy() {
    navigator.clipboard?.writeText(url).then(() => toast('已複製連結'), () => toast('無法複製，請手動選取'));
  }
</script>

<Modal title="分享到 APCS Code Noter" {onclose} dirty={!url && (description !== '' || title !== basename(file.path))}>
  {#if !proxy}
    <p class="warn">尚未設定 Code Noter 代理網址，無法上傳。請到「設定」中填寫。</p>
  {/if}
  {#if !url}
    <div class="form">
      <label>標題<input bind:value={title} maxlength="200" /></label>
      <label>說明（可留空）<textarea bind:value={description} rows="2" maxlength="1000"></textarea></label>
      <label>語言
        <select bind:value={language}>
          {#each CODENOTER_LANGUAGES as l}<option value={l}>{l}</option>{/each}
        </select>
      </label>
      <div>
        <div class="lbl">程式碼預覽（{file.path}）</div>
        <pre class="preview">{preview}{code.split('\n').length > 8 ? '\n…' : ''}</pre>
      </div>
      <p class="note">⚠️ 上傳後，任何拿到連結的人都能看到這段程式碼。</p>
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
    </div>
  {/if}
  {#snippet footer()}
    {#if !url}
      <button onclick={onclose}>取消</button>
      <button class="primary" disabled={busy || !proxy} onclick={submit}>{busy ? '上傳中…' : '上傳'}</button>
    {:else}
      <button class="primary" onclick={onclose}>完成</button>
    {/if}
  {/snippet}
</Modal>

<style>
  .form { display: flex; flex-direction: column; gap: 10px; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
  input, textarea, select { font-size: 14px; padding: 6px 8px; }
  textarea { font: inherit; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text); resize: vertical; }
  .lbl { font-size: 13px; color: var(--muted); margin-bottom: 4px; }
  .preview { margin: 0; font-family: var(--mono); font-size: 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; max-height: 160px; overflow: auto; }
  .note { font-size: 12px; color: var(--warning); margin: 0; }
  .warn { font-size: 13px; color: var(--warning); background: var(--warning-soft); padding: 6px 8px; border-radius: 6px; }
  .error { color: var(--danger); font-size: 13px; margin: 0; }
  .done { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
  .done p { margin: 0; }
  .url { font-family: var(--mono); font-size: 13px; word-break: break-all; background: var(--surface-2); padding: 6px 8px; border-radius: 6px; width: 100%; }
  .acts { display: flex; gap: 6px; flex-wrap: wrap; }
  .qr { width: 100%; max-width: 280px; height: auto; image-rendering: pixelated; align-self: center; background: #fff; border-radius: 8px; }
</style>
