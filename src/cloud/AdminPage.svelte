<script>
  // 管理頁 #/admin（spec_new §6）：使用者、分享連結、站台設定；權限由後端檢查
  import { onMount } from 'svelte';
  import { api, shareUrl } from './api.js';
  import { auth, refreshMe } from './auth.svelte.js';
  import { openModal } from '../lib/ui.svelte.js';
  import { confirmDialog, promptDialog, toast } from '../lib/dialog.svelte.js';
  import { formatBytes } from '../lib/paths.js';
  import Modal from '../components/Modal.svelte';
  import ReadonlyProject from './ReadonlyProject.svelte';

  let { dark } = $props();
  let tab = $state('users');
  let denied = $state(false);

  // 使用者
  let users = $state([]);
  let userTotal = $state(0);
  let userQ = $state('');
  let userPage = $state(1);
  let viewing = $state(null); // { user, projects }
  let projectView = $state(null); // { project, entries }
  // 分享
  let shares = $state([]);
  let shareTotal = $state(0);
  let shareQ = $state('');
  let sharePage = $state(1);
  // 站台設定
  let site = $state(null);
  let siteForm = $state(null);
  const PER = 50;

  const fmt = (t) => (t ? new Date(t).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const originLabel = (u) => (u.isInitialAdmin ? '初始管理員' : u.origin === 'admin' ? '管理員建立' : '自行註冊');

  async function guard(fn) {
    try { return await fn(); } catch (e) {
      if (e.status === 403 || e.status === 401) denied = true;
      else toast(e.message, 4000);
      return null;
    }
  }

  async function loadUsers() {
    const r = await guard(() => api(`/admin/users?q=${encodeURIComponent(userQ)}&page=${userPage}&per_page=${PER}`));
    if (r) { users = r.users; userTotal = r.total; }
  }
  async function loadShares() {
    const r = await guard(() => api(`/admin/shares?q=${encodeURIComponent(shareQ)}&page=${sharePage}&per_page=${PER}`));
    if (r) { shares = r.shares; shareTotal = r.total; }
  }
  async function loadSite() {
    const r = await guard(() => api('/admin/settings'));
    if (r) { site = r; siteForm = toForm(r); }
  }

  function toForm(s) {
    const l = s.limits;
    return {
      allowRegistration: s.allowRegistration,
      file_kb: Math.round(l.file_bytes / 1024),
      project_mb: +(l.project_bytes / 1048576).toFixed(2),
      quota_mb: +(l.quota_bytes / 1048576).toFixed(2),
      max_projects: l.max_projects,
      request_mb: +(l.request_bytes / 1048576).toFixed(2),
    };
  }

  onMount(() => {
    if (!auth.user) { denied = true; return; }
    loadUsers();
  });

  function switchTab(t) {
    tab = t;
    if (t === 'users') loadUsers();
    else if (t === 'shares') loadShares();
    else loadSite();
  }

  async function createUser() {
    const username = await promptDialog({
      title: '建立帳號', label: '使用者名稱（3–32 個字元，英數字、_、-）',
      validate: (v) => (/^[A-Za-z0-9_-]{3,32}$/.test(v) ? null : '格式不正確'),
    });
    if (!username) return;
    const password = await promptDialog({
      title: '建立帳號', message: `帳號：${username}`, label: '初始密碼（至少 8 個字元）', value: randomPassword(),
      validate: (v) => (v.length >= 8 ? null : '密碼至少需要 8 個字元'),
    });
    if (!password) return;
    const r = await guard(() => api('/admin/users', { method: 'POST', body: { username, password } }));
    if (r) { toast(`已建立帳號 ${username}`); loadUsers(); }
  }

  function randomPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const a = crypto.getRandomValues(new Uint32Array(12));
    return [...a].map((n) => chars[n % chars.length]).join('');
  }

  async function patchUser(u, body, msg) {
    const r = await guard(() => api(`/admin/users/${u.id}`, { method: 'PATCH', body }));
    if (r) {
      Object.assign(u, r);
      if (msg) toast(msg);
      if (u.id === auth.user?.id) refreshMe().catch(() => {});
    }
  }

  async function resetPassword(u) {
    const password = await promptDialog({
      title: `重設 ${u.username} 的密碼`, message: '該帳號所有裝置都會被登出。', label: '新密碼（至少 8 個字元）', value: randomPassword(),
      confirmLabel: '重設', validate: (v) => (v.length >= 8 ? null : '密碼至少需要 8 個字元'),
    });
    if (password) patchUser(u, { password }, '已重設密碼');
  }

  async function toggleDisabled(u) {
    if (!u.isDisabled) {
      const ok = await confirmDialog({ title: '停用帳號', message: `停用「${u.username}」後，該帳號會被登出且無法登入，其分享連結也會失效（啟用後恢復）。`, confirmLabel: '停用', danger: true });
      if (!ok) return;
    }
    patchUser(u, { isDisabled: !u.isDisabled }, u.isDisabled ? '已啟用' : '已停用');
  }

  async function toggleAdmin(u) {
    const ok = await confirmDialog({ title: u.isAdmin ? '取消管理員' : '設為管理員', message: `${u.isAdmin ? '取消' : '設定'}「${u.username}」的管理員身分？`, confirmLabel: '確定' });
    if (ok) patchUser(u, { isAdmin: !u.isAdmin });
  }

  async function setQuota(u) {
    const v = await promptDialog({
      title: `${u.username} 的配額`, message: `目前：${formatBytes(u.quotaBytes)}${u.quotaOverride == null ? '（預設）' : ''}。留空表示使用站台預設值。`,
      label: '配額（MB）', value: u.quotaOverride == null ? '' : String(+(u.quotaOverride / 1048576).toFixed(2)),
      validate: (x) => (x === '' || (+x >= 0 && Number.isFinite(+x)) ? null : '請輸入數字'),
    });
    if (v === null) return;
    patchUser(u, v === '' ? { clearQuota: true } : { quotaBytes: Math.round(+v * 1048576) }, '已更新配額');
  }

  async function deleteUser(u) {
    const confirm = await promptDialog({
      title: '刪除帳號', message: `帳號「${u.username}」及其所有專案與分享都會被刪除，此動作無法復原。\n請輸入使用者名稱確認：`,
      label: '使用者名稱', confirmLabel: '刪除帳號', validate: (v) => (v === u.username ? null : '請輸入正確的使用者名稱'),
    });
    if (!confirm) return;
    const r = await guard(() => api(`/admin/users/${u.id}`, { method: 'DELETE', body: { confirm } }));
    if (r) { toast('已刪除帳號'); loadUsers(); }
  }

  async function openProjects(u) {
    const r = await guard(() => api(`/admin/users/${u.id}/projects`));
    if (r) viewing = { user: u, projects: r.projects };
  }

  async function openProject(p) {
    const r = await guard(() => api(`/admin/projects/${p.id}`));
    if (r) projectView = { project: r, entries: r.entries.map((e) => ({ path: e.path, kind: e.kind, content: e.content })) };
  }

  async function deleteProject(p) {
    const ok = await confirmDialog({ title: '刪除專案', message: `「${p.name}」會從雲端刪除，使用者的裝置下次同步時也會刪除本地副本。此動作無法復原。`, confirmLabel: '刪除專案', danger: true });
    if (!ok) return;
    const r = await guard(() => api(`/admin/projects/${p.id}`, { method: 'DELETE' }));
    if (r) {
      viewing.projects = viewing.projects.filter((x) => x.id !== p.id);
      toast('已刪除專案');
    }
  }

  async function revokeShare(s) {
    const ok = await confirmDialog({ title: '撤銷分享', message: `「${s.title}」（${s.author.username}）的連結會立即失效。`, confirmLabel: '撤銷', danger: true });
    if (!ok) return;
    const r = await guard(() => api(`/admin/shares/${s.id}`, { method: 'DELETE' }));
    if (r) { shares = shares.filter((x) => x.id !== s.id); shareTotal--; toast('已撤銷'); }
  }

  async function saveSite(e) {
    e.preventDefault();
    const f = siteForm;
    const body = {
      allowRegistration: f.allowRegistration,
      file_bytes: Math.round(f.file_kb * 1024),
      project_bytes: Math.round(f.project_mb * 1048576),
      quota_bytes: Math.round(f.quota_mb * 1048576),
      max_projects: Math.round(f.max_projects),
      request_bytes: Math.round(f.request_mb * 1048576),
    };
    const r = await guard(() => api('/admin/settings', { method: 'PATCH', body }));
    if (r) { site = r; siteForm = toForm(r); auth.config = r; toast('已儲存站台設定'); }
  }
</script>

<div class="page">
  <header class="top">
    <a class="brand" href="#/">WebEditor</a>
    <strong>管理頁</strong>
    <span class="sp"></span>
    <a href="#/">回到編輯器</a>
  </header>

  {#if denied}
    <div class="center">
      <p>沒有權限。{auth.user ? '此帳號不是管理員。' : '請先以管理員帳號登入。'}</p>
      {#if !auth.user}<button class="primary" onclick={() => openModal({ kind: 'login' })}>登入</button>{/if}
    </div>
  {:else}
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'users'} class:on={tab === 'users'} onclick={() => switchTab('users')}>使用者</button>
      <button role="tab" aria-selected={tab === 'shares'} class:on={tab === 'shares'} onclick={() => switchTab('shares')}>分享連結</button>
      <button role="tab" aria-selected={tab === 'site'} class:on={tab === 'site'} onclick={() => switchTab('site')}>站台設定</button>
    </div>
    <main class="content">
      {#if tab === 'users'}
        <div class="bar">
          <form onsubmit={(e) => { e.preventDefault(); userPage = 1; loadUsers(); }}>
            <input type="search" placeholder="搜尋使用者名稱或顯示名稱" bind:value={userQ} aria-label="搜尋使用者" />
          </form>
          <span class="sp"></span>
          <button class="primary" onclick={createUser}>＋ 建立帳號</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>使用者</th><th>來源</th><th>狀態</th><th>用量 / 配額</th><th>專案</th><th>建立</th><th>最後登入</th><th>動作</th></tr></thead>
            <tbody>
              {#each users as u (u.id)}
                <tr class:disabled={u.isDisabled}>
                  <td><strong>{u.username}</strong>{#if u.displayName}<br /><small>{u.displayName}</small>{/if}</td>
                  <td>{originLabel(u)}</td>
                  <td>{u.isAdmin ? '管理員' : '一般'}{u.isDisabled ? '・已停用' : ''}</td>
                  <td>{formatBytes(u.usedBytes)} / {formatBytes(u.quotaBytes)}{u.quotaOverride != null ? '＊' : ''}</td>
                  <td><button class="link" onclick={() => openProjects(u)}>{u.projectCount} 個</button></td>
                  <td>{fmt(u.createdAt)}</td>
                  <td>{fmt(u.lastLoginAt)}</td>
                  <td class="acts">
                    <button onclick={() => resetPassword(u)}>重設密碼</button>
                    {#if !u.isInitialAdmin && u.id !== auth.user?.id}
                      <button onclick={() => toggleDisabled(u)}>{u.isDisabled ? '啟用' : '停用'}</button>
                      <button onclick={() => toggleAdmin(u)}>{u.isAdmin ? '取消管理員' : '設為管理員'}</button>
                    {/if}
                    <button onclick={() => setQuota(u)}>配額</button>
                    {#if !u.isInitialAdmin && u.id !== auth.user?.id}<button class="danger" onclick={() => deleteUser(u)}>刪除</button>{/if}
                  </td>
                </tr>
              {:else}
                <tr><td colspan="8" class="muted">沒有使用者</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="pager">
          共 {userTotal} 位{#if userTotal > PER}・
            <button disabled={userPage <= 1} onclick={() => { userPage--; loadUsers(); }}>上一頁</button>
            第 {userPage} 頁
            <button disabled={userPage * PER >= userTotal} onclick={() => { userPage++; loadUsers(); }}>下一頁</button>{/if}
          ・＊ 表示個別配額
        </div>
      {:else if tab === 'shares'}
        <div class="bar">
          <form onsubmit={(e) => { e.preventDefault(); sharePage = 1; loadShares(); }}>
            <input type="search" placeholder="搜尋標題、作者或分享 ID" bind:value={shareQ} aria-label="搜尋分享" />
          </form>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>標題</th><th>作者</th><th>類型</th><th>大小</th><th>瀏覽</th><th>建立</th><th>到期</th><th>動作</th></tr></thead>
            <tbody>
              {#each shares as s (s.id)}
                <tr class:disabled={s.authorDisabled}>
                  <td><a href={shareUrl(s.id)} target="_blank" rel="noopener noreferrer">{s.title}</a><br /><small class="mono">{s.id}</small></td>
                  <td>{s.author.username}{s.authorDisabled ? '（已停用）' : ''}</td>
                  <td>{s.kind === 'project' ? '專案' : '檔案'}</td>
                  <td>{formatBytes(s.size)}</td>
                  <td>{s.viewCount}</td>
                  <td>{fmt(s.createdAt)}</td>
                  <td>{s.expiresAt ? fmt(s.expiresAt) : '永不過期'}</td>
                  <td class="acts"><button class="danger" onclick={() => revokeShare(s)}>撤銷</button></td>
                </tr>
              {:else}
                <tr><td colspan="8" class="muted">沒有分享連結</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="pager">
          共 {shareTotal} 個{#if shareTotal > PER}・
            <button disabled={sharePage <= 1} onclick={() => { sharePage--; loadShares(); }}>上一頁</button>
            第 {sharePage} 頁
            <button disabled={sharePage * PER >= shareTotal} onclick={() => { sharePage++; loadShares(); }}>下一頁</button>{/if}
        </div>
      {:else if siteForm}
        <form class="site" onsubmit={saveSite}>
          <label class="check"><input type="checkbox" bind:checked={siteForm.allowRegistration} /> 開放自行註冊</label>
          <label>單一檔案上限（KB）<input type="number" min="1" step="1" bind:value={siteForm.file_kb} /></label>
          <label>單一專案上限（MB）<input type="number" min="0.01" step="any" bind:value={siteForm.project_mb} /></label>
          <label>每個帳號預設配額（MB）<input type="number" min="0" step="any" bind:value={siteForm.quota_mb} /></label>
          <label>每個帳號專案數上限<input type="number" min="1" step="1" bind:value={siteForm.max_projects} /></label>
          <label>單次上傳請求上限（MB）<input type="number" min="0.0625" step="any" bind:value={siteForm.request_mb} /></label>
          <p class="muted">修改後立即生效。已存在雲端的資料不會因為調降上限而被刪除。</p>
          <div><button class="primary" type="submit">儲存</button></div>
        </form>
      {:else}
        <p class="muted">載入中…</p>
      {/if}
    </main>
  {/if}
</div>

{#if viewing}
  <Modal title={`${viewing.user.username} 的專案`} onclose={() => (viewing = null)} wide>
    {#if !viewing.projects.length}
      <p class="muted">沒有雲端專案</p>
    {:else}
      <ul class="plist">
        {#each viewing.projects as p (p.id)}
          <li>
            <div class="pmain"><strong>{p.name}</strong><small>{p.fileCount} 個檔案・{formatBytes(p.size)}・更新於 {fmt(p.updatedAt)}</small></div>
            <span class="acts"><button onclick={() => openProject(p)}>檢視</button><button class="danger" onclick={() => deleteProject(p)}>刪除</button></span>
          </li>
        {/each}
      </ul>
    {/if}
    {#snippet footer()}<button class="primary" onclick={() => (viewing = null)}>關閉</button>{/snippet}
  </Modal>
{/if}

{#if projectView}
  <div class="pv" role="dialog" aria-modal="true" aria-label={projectView.project.name}>
    <header class="top">
      <strong>{projectView.project.name}</strong><span class="muted">・{projectView.project.owner.username}・唯讀</span>
      <span class="sp"></span>
      <button onclick={() => (projectView = null)}>關閉</button>
    </header>
    <div class="pv-body"><ReadonlyProject entries={projectView.entries} {dark} /></div>
  </div>
{/if}

<style>
  .page { height: 100dvh; display: flex; flex-direction: column; }
  .top { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--surface); flex-wrap: wrap; }
  .brand { font-weight: 700; color: var(--accent); text-decoration: none; }
  .sp { flex: 1; }
  .center { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 16px; text-align: center; }
  .tabs { display: flex; gap: 4px; padding: 0 12px; border-bottom: 1px solid var(--border); background: var(--surface); }
  .tabs button { border: none; border-bottom: 2px solid transparent; border-radius: 0; background: none; padding: 8px 12px; }
  .tabs button.on { border-bottom-color: var(--accent); color: var(--accent); font-weight: 600; }
  .content { flex: 1; overflow: auto; padding: 12px 16px 24px; }
  .bar { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
  .bar input { font-size: 14px; padding: 6px 8px; width: min(320px, 100%); }
  .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: top; white-space: nowrap; }
  th { background: var(--surface-2); font-weight: 600; }
  tr.disabled td { color: var(--muted); }
  td small { color: var(--muted); }
  .mono { font-family: var(--mono); }
  .acts { display: flex; gap: 4px; flex-wrap: wrap; }
  .acts button { padding: 3px 8px; font-size: 12px; }
  .link { border: none; background: none; color: var(--accent); text-decoration: underline; padding: 0; }
  .pager { margin-top: 8px; font-size: 13px; color: var(--muted); display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .muted { color: var(--muted); font-size: 13px; }
  .site { display: flex; flex-direction: column; gap: 12px; max-width: 420px; }
  .site label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
  .site label.check { flex-direction: row; align-items: center; gap: 8px; color: var(--text); font-size: 14px; }
  .site input[type='number'] { font-size: 14px; padding: 6px 8px; }
  .plist { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
  .plist li { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 8px; padding: 8px; flex-wrap: wrap; }
  .pmain { flex: 1; display: flex; flex-direction: column; min-width: 160px; }
  .pmain small { color: var(--muted); font-size: 12px; }
  .pv { position: fixed; inset: 0; z-index: 95; background: var(--bg); display: flex; flex-direction: column; }
  .pv-body { flex: 1; min-height: 0; display: flex; padding: 12px; }
</style>
