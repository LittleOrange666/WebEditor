<script>
  // 雲端版頂端列：分享、匯入分享連結、同步狀態、帳號選單（spec_new §3.2、§8）
  import { auth } from './auth.svelte.js';
  import { syncState, requestSync } from './sync.svelte.js';
  import { logoutFlow } from './flows.js';
  import { openModal } from '../lib/ui.svelte.js';
  import { currentProject } from '../lib/store.svelte.js';

  let { file } = $props();
  let menuOpen = $state(false);
  let menuEl = $state(null);

  const project = $derived(currentProject());
  const sync = $derived.by(() => {
    if (!auth.user) return { icon: '☁', label: '未登入，專案只存在這台裝置', cls: 'off' };
    const st = syncState.status;
    if (st === 'syncing') return { icon: '⟳', label: '同步中…', cls: 'busy' };
    if (st === 'offline') return { icon: '☁', label: `無法連線到伺服器，修改會先存在這台裝置${syncState.pending ? `（${syncState.pending} 個項目待上傳）` : ''}`, cls: 'warn' };
    if (st === 'error') return { icon: '⚠', label: `同步錯誤：${syncState.error}`, cls: 'err' };
    if (syncState.pending) return { icon: '☁', label: `${syncState.pending} 個項目待上傳`, cls: 'busy' };
    const t = syncState.lastSync ? `，上次同步 ${new Date(syncState.lastSync).toLocaleTimeString('zh-TW', { timeStyle: 'short' })}` : '';
    return { icon: '☁', label: `已同步${t}`, cls: 'ok' };
  });

  function onDocClick(e) {
    if (menuOpen && menuEl && !menuEl.contains(e.target)) menuOpen = false;
  }

  function pick(fn) {
    menuOpen = false;
    fn();
  }
</script>

<svelte:document onclick={onDocClick} />

<button disabled={!file && !project} onclick={() => openModal({ kind: 'share' })} title="建立分享連結">分享</button>
<button onclick={() => openModal({ kind: 'shareImport' })} title="從分享連結匯入">匯入</button>
{#if auth.user}
  <button class="icon-btn sync {sync.cls}" title={`${sync.label}（按一下立即同步）`} aria-label={sync.label} onclick={() => requestSync()}>
    <span class:spin={sync.cls === 'busy' && syncState.status === 'syncing'}>{sync.icon}</span>
  </button>
{/if}
<div class="acct" bind:this={menuEl}>
  {#if auth.user}
    <button class="user" aria-haspopup="menu" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)} title={auth.user.username}>
      👤 <span class="uname">{auth.user.displayName || auth.user.username}</span> ▾
    </button>
    {#if menuOpen}
      <div class="menu" role="menu">
        <div class="who">{auth.user.displayName ? `${auth.user.displayName}（${auth.user.username}）` : auth.user.username}</div>
        <button role="menuitem" onclick={() => pick(() => openModal({ kind: 'account' }))}>帳號設定</button>
        <button role="menuitem" onclick={() => pick(() => openModal({ kind: 'myshares' }))}>我的分享</button>
        {#if auth.user.isAdmin}<a role="menuitem" href="#/admin" onclick={() => (menuOpen = false)}>管理頁</a>{/if}
        <button role="menuitem" onclick={() => pick(logoutFlow)}>登出</button>
      </div>
    {/if}
  {:else}
    <button class="primary" onclick={() => openModal({ kind: 'login' })}>登入</button>
  {/if}
</div>

<style>
  .acct { position: relative; }
  .user { max-width: 180px; display: inline-flex; align-items: center; gap: 4px; }
  .uname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 110px; }
  .menu {
    position: absolute; right: 0; top: calc(100% + 4px); z-index: 80; min-width: 180px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    display: flex; flex-direction: column; padding: 4px;
  }
  .menu button, .menu a { border: none; background: none; text-align: left; padding: 8px 10px; border-radius: 6px; color: var(--text); text-decoration: none; font-size: 14px; }
  .menu button:hover, .menu a:hover { background: var(--hover); }
  .who { font-size: 12px; color: var(--muted); padding: 6px 10px; border-bottom: 1px solid var(--border); margin-bottom: 4px; word-break: break-all; }
  .sync { padding: 4px 9px; min-width: 34px; }
  .sync.ok { color: var(--accent); }
  .sync.busy { color: var(--accent); }
  .sync.warn { color: var(--warning); }
  .sync.err { color: var(--danger); }
  .spin { display: inline-block; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 768px) {
    .uname { display: none; }
  }
</style>
