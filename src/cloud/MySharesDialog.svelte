<script>
  // 我的分享（spec_new §5.5）
  import { onMount } from 'svelte';
  import Modal from '../components/Modal.svelte';
  import { api, shareUrl } from './api.js';
  import { confirmDialog, toast } from '../lib/dialog.svelte.js';
  import { formatBytes } from '../lib/paths.js';

  let { onclose } = $props();
  let shares = $state(null);
  let error = $state('');

  const fmt = (t) => (t ? new Date(t).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' }) : '永不過期');

  async function load() {
    try { shares = (await api('/shares')).shares; } catch (e) { error = e.message; }
  }
  onMount(load);

  function copy(s) {
    navigator.clipboard?.writeText(shareUrl(s.id)).then(() => toast('已複製連結'), () => toast('無法複製，請手動選取'));
  }

  async function revoke(s) {
    const ok = await confirmDialog({ title: '撤銷分享', message: `「${s.title}」的連結會立即失效，此動作無法復原。`, confirmLabel: '撤銷', danger: true });
    if (!ok) return;
    try {
      await api(`/shares/${s.id}`, { method: 'DELETE' });
      shares = shares.filter((x) => x.id !== s.id);
      toast('已撤銷');
    } catch (e) { toast(e.message); }
  }
</script>

<Modal title="我的分享" {onclose} wide>
  {#if error}
    <p class="error">{error}</p>
  {:else if !shares}
    <p class="muted">載入中…</p>
  {:else if !shares.length}
    <p class="muted">還沒有分享。按頂端的「分享」建立分享連結。</p>
  {:else}
    <ul class="list">
      {#each shares as s (s.id)}
        <li>
          <div class="main">
            <a href={shareUrl(s.id)} target="_blank" rel="noopener noreferrer"><strong>{s.title}</strong></a>
            <small>{s.kind === 'project' ? '專案' : '檔案'}・{formatBytes(s.size)}・建立於 {fmt(s.createdAt)}・到期：{fmt(s.expiresAt)}・瀏覽 {s.viewCount} 次</small>
          </div>
          <span class="acts">
            <button onclick={() => copy(s)}>複製連結</button>
            <button class="danger" onclick={() => revoke(s)}>撤銷</button>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
  {#snippet footer()}<button class="primary" onclick={onclose}>關閉</button>{/snippet}
</Modal>

<style>
  .list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
  .list li { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 8px; padding: 8px; flex-wrap: wrap; }
  .main { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 200px; }
  .main small { color: var(--muted); font-size: 12px; }
  .acts { display: flex; gap: 4px; }
  .muted { color: var(--muted); font-size: 13px; }
  .error { color: var(--danger); font-size: 13px; }
</style>
