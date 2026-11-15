<script>
  // 登入／註冊（spec_new §3.1、§3.2）
  import { onMount } from 'svelte';
  import Modal from '../components/Modal.svelte';
  import { auth, login, register, loadSiteConfig } from './auth.svelte.js';
  import { toast } from '../lib/dialog.svelte.js';

  let { onclose } = $props();
  let tab = $state('login');
  let username = $state('');
  let password = $state('');
  let password2 = $state('');
  let displayName = $state('');
  let busy = $state(false);
  let error = $state('');

  const canRegister = $derived(!!auth.config?.allowRegistration);

  onMount(() => { if (!auth.config) loadSiteConfig(); });

  function validate() {
    if (tab === 'register') {
      if (!/^[A-Za-z0-9_-]{3,32}$/.test(username)) return '使用者名稱需為 3–32 個字元，只能使用英數字、_、-';
      if (displayName.trim().length > 32) return '顯示名稱最多 32 個字元';
      if (password.length < 8) return '密碼至少需要 8 個字元';
      if (password !== password2) return '兩次輸入的密碼不同';
    } else if (!username || !password) {
      return '請輸入帳號與密碼';
    }
    return '';
  }

  async function submit(e) {
    e.preventDefault();
    error = validate();
    if (error) return;
    busy = true;
    try {
      const u = tab === 'login' ? await login(username.trim(), password) : await register(username.trim(), password, displayName.trim());
      toast(`歡迎，${u.displayName || u.username}`);
      onclose();
    } catch (err) {
      error = err.message;
    } finally {
      busy = false;
    }
  }
</script>

<Modal title={tab === 'login' ? '登入' : '註冊'} {onclose}>
  {#if canRegister}
    <div class="tabs" role="tablist">
      <button role="tab" type="button" aria-selected={tab === 'login'} class:on={tab === 'login'} onclick={() => { tab = 'login'; error = ''; }}>登入</button>
      <button role="tab" type="button" aria-selected={tab === 'register'} class:on={tab === 'register'} onclick={() => { tab = 'register'; error = ''; }}>註冊</button>
    </div>
  {/if}
  <form id="login-form" class="form" onsubmit={submit}>
    <label>使用者名稱<input bind:value={username} autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="32" autofocus /></label>
    {#if tab === 'register'}
      <label>顯示名稱（選填）<input bind:value={displayName} maxlength="32" /></label>
    {/if}
    <label>密碼<input type="password" bind:value={password} autocomplete={tab === 'login' ? 'current-password' : 'new-password'} /></label>
    {#if tab === 'register'}
      <label>再輸入一次密碼<input type="password" bind:value={password2} autocomplete="new-password" /></label>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if tab === 'login'}
      <p class="hint">{canRegister ? '' : '目前未開放自行註冊，需要帳號請聯絡管理員。'}忘記密碼請聯絡管理員重設。</p>
    {/if}
  </form>
  {#snippet footer()}
    <button type="button" onclick={onclose}>取消</button>
    <button class="primary" type="submit" form="login-form" disabled={busy}>{busy ? '處理中…' : tab === 'login' ? '登入' : '註冊'}</button>
  {/snippet}
</Modal>

<style>
  .tabs { display: flex; gap: 4px; margin-bottom: 10px; border-bottom: 1px solid var(--border); }
  .tabs button { border: none; border-bottom: 2px solid transparent; border-radius: 0; background: none; padding: 6px 12px; }
  .tabs button.on { border-bottom-color: var(--accent); color: var(--accent); font-weight: 600; }
  .form { display: flex; flex-direction: column; gap: 10px; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
  input { font-size: 14px; padding: 7px 8px; }
  .error { color: var(--danger); font-size: 13px; margin: 0; }
  .hint { color: var(--muted); font-size: 12px; margin: 0; }
</style>
