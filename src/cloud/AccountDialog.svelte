<script>
  // 帳號設定（spec_new §3.4）
  import { onMount } from 'svelte';
  import Modal from '../components/Modal.svelte';
  import { api } from './api.js';
  import { auth, refreshMe, dropSession } from './auth.svelte.js';
  import { syncState } from './sync.svelte.js';
  import { exportAllProjects, afterAccountDeleted } from './flows.js';
  import { confirmDialog, promptDialog, toast } from '../lib/dialog.svelte.js';
  import { formatBytes } from '../lib/paths.js';

  let { onclose } = $props();
  let displayName = $state(auth.user?.displayName ?? '');
  let oldPw = $state('');
  let newPw = $state('');
  let newPw2 = $state('');
  let pwError = $state('');
  let nameError = $state('');
  let busy = $state(false);
  let exporting = $state(false);

  const used = $derived(syncState.usedBytes ?? auth.user?.usedBytes ?? 0);
  const quota = $derived(syncState.quotaBytes ?? auth.user?.quotaBytes ?? 0);
  const pct = $derived(quota ? Math.min(100, Math.round((used / quota) * 100)) : 0);

  onMount(() => { refreshMe().then((u) => { syncState.usedBytes = u.usedBytes; syncState.quotaBytes = u.quotaBytes; }).catch(() => {}); });

  async function saveName() {
    nameError = '';
    if (displayName.trim().length > 32) { nameError = '顯示名稱最多 32 個字元'; return; }
    try {
      await api('/me', { method: 'PATCH', body: { displayName: displayName.trim() || null } });
      await refreshMe();
      toast('已更新顯示名稱');
    } catch (e) { nameError = e.message; }
  }

  async function changePassword(e) {
    e.preventDefault();
    pwError = '';
    if (newPw.length < 8) { pwError = '新密碼至少需要 8 個字元'; return; }
    if (newPw !== newPw2) { pwError = '兩次輸入的新密碼不同'; return; }
    busy = true;
    try {
      await api('/me/password', { method: 'POST', body: { oldPassword: oldPw, newPassword: newPw } });
      toast('已修改密碼，請重新登入', 4000);
      onclose();
      dropSession('password');
    } catch (err) { pwError = err.message; } finally { busy = false; }
  }

  async function logoutAll() {
    const ok = await confirmDialog({ title: '登出所有裝置', message: '所有裝置（包含這台）都會被登出，需要重新登入。這台裝置上的專案會保留，重新登入後繼續同步。', confirmLabel: '登出所有裝置' });
    if (!ok) return;
    try {
      await api('/auth/logout-all', { method: 'POST' });
      onclose();
      dropSession('logout-all');
      toast('已登出所有裝置');
    } catch (e) { toast(e.message); }
  }

  async function doExport() {
    exporting = true;
    try { await exportAllProjects(); } finally { exporting = false; }
  }

  async function deleteAccount() {
    const user = auth.user;
    const pw = await promptDialog({
      title: '刪除帳號',
      message: `帳號「${user.username}」的所有雲端專案與分享連結都會被刪除，此動作無法復原。\n建議先「下載所有專案」備份。\n\n請輸入密碼確認：`,
      label: '密碼',
      confirmLabel: '刪除帳號',
      validate: (v) => (v ? null : '請輸入密碼'),
    });
    if (!pw) return;
    try {
      await api('/me', { method: 'DELETE', body: { password: pw } });
      onclose();
      await afterAccountDeleted(user.id);
      toast('帳號已刪除');
    } catch (e) { toast(e.message, 4000); }
  }
</script>

<Modal title="帳號設定" {onclose}>
  {#if auth.user}
    <section>
      <div class="row"><span class="k">使用者名稱</span><span>{auth.user.username}</span></div>
      <label class="k" for="dn">顯示名稱</label>
      <div class="inline">
        <input id="dn" bind:value={displayName} maxlength="32" placeholder={auth.user.username} />
        <button onclick={saveName} disabled={(displayName.trim() || null) === (auth.user.displayName ?? null)}>儲存</button>
      </div>
      {#if nameError}<p class="error">{nameError}</p>{/if}
    </section>

    <section>
      <h3>雲端用量</h3>
      <div class="bar" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100"><span style:width="{pct}%" class:full={pct >= 90}></span></div>
      <p class="muted">{formatBytes(used)} / {formatBytes(quota)}（{pct}%）・只計算雲端上的程式檔與分享</p>
      <button onclick={doExport} disabled={exporting}>{exporting ? '準備中…' : '下載所有專案（zip）'}</button>
    </section>

    <section>
      <h3>修改密碼</h3>
      <form class="pw" onsubmit={changePassword}>
        <input type="password" placeholder="目前的密碼" bind:value={oldPw} autocomplete="current-password" aria-label="目前的密碼" />
        <input type="password" placeholder="新密碼（至少 8 個字元）" bind:value={newPw} autocomplete="new-password" aria-label="新密碼" />
        <input type="password" placeholder="再輸入一次新密碼" bind:value={newPw2} autocomplete="new-password" aria-label="再輸入一次新密碼" />
        {#if pwError}<p class="error">{pwError}</p>{/if}
        <button type="submit" disabled={busy || !oldPw || !newPw}>修改密碼</button>
      </form>
      <p class="muted">修改密碼後所有裝置都需要重新登入。</p>
    </section>

    <section>
      <h3>其他</h3>
      <div class="acts">
        <button onclick={logoutAll}>登出所有裝置</button>
        {#if auth.user.canDeleteSelf}<button class="danger" onclick={deleteAccount}>刪除帳號</button>{/if}
      </div>
      {#if !auth.user.canDeleteSelf}
        <p class="muted">{auth.user.isInitialAdmin ? '初始管理員帳號不可刪除。' : '此帳號由管理員建立，如需刪除請聯絡管理員。'}</p>
      {/if}
    </section>
  {/if}
  {#snippet footer()}<button class="primary" onclick={onclose}>完成</button>{/snippet}
</Modal>

<style>
  section { padding: 10px 0; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  section:last-child { border-bottom: none; }
  h3 { margin: 0; font-size: 14px; }
  .row { display: flex; gap: 10px; font-size: 14px; }
  .k { color: var(--muted); font-size: 13px; }
  .inline { display: flex; gap: 6px; width: 100%; }
  .inline input { flex: 1; min-width: 0; }
  input { font-size: 14px; padding: 6px 8px; }
  .pw { display: flex; flex-direction: column; gap: 6px; width: 100%; }
  .bar { width: 100%; height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden; border: 1px solid var(--border); }
  .bar span { display: block; height: 100%; background: var(--accent); }
  .bar span.full { background: var(--warning); }
  .muted { color: var(--muted); font-size: 12px; margin: 0; }
  .error { color: var(--danger); font-size: 13px; margin: 0; }
  .acts { display: flex; gap: 6px; flex-wrap: wrap; }
</style>
