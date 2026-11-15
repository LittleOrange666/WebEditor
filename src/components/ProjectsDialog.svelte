<script>
  // 專案管理與範例（spec §3.1、§7）
  import Modal from './Modal.svelte';
  import {
    app, openProject, createProjectFrom, renameProject, duplicateProject, deleteProject, validateProjectName, hooks,
  } from '../lib/store.svelte.js';
  import { promptDialog, confirmDialog, toast } from '../lib/dialog.svelte.js';
  import { EXAMPLES } from '../examples/index.js';

  let { onclose, tab: initialTab = 'projects' } = $props();
  let tab = $state(initialTab);

  async function create() {
    const name = await promptDialog({ title: '新增專案', label: '專案名稱', value: '新專案', validate: (v) => validateProjectName(v) });
    if (!name) return;
    await createProjectFrom(name, []);
    onclose();
  }

  async function rename(p) {
    const name = await promptDialog({ title: '重新命名專案', value: p.name, confirmLabel: '重新命名', validate: (v) => validateProjectName(v, p.id) });
    if (name && name !== p.name) await renameProject(p.id, name);
  }

  async function dup(p) {
    await duplicateProject(p.id);
    toast('已複製專案');
    onclose();
  }

  async function del(p) {
    const ok = await confirmDialog({
      title: '刪除專案',
      message: `專案「${p.name}」及其中所有檔案與測資都會被刪除，此動作無法復原。\n建議先下載專案 zip 備份。`,
      confirmLabel: '刪除專案',
      danger: true,
    });
    if (ok) await deleteProject(p.id);
  }

  async function open(p) {
    if (p.id !== app.projectId) await openProject(p.id);
    onclose();
  }

  async function loadExample(ex) {
    await createProjectFrom(ex.name, ex.files, ex.tests);
    toast(`已建立範例專案「${ex.name}」`);
    onclose();
  }

  const fmt = (t) => new Date(t).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' });
</script>

<Modal title="專案" {onclose} wide>
  <div class="tabs" role="tablist">
    <button role="tab" aria-selected={tab === 'projects'} class:on={tab === 'projects'} onclick={() => (tab = 'projects')}>我的專案</button>
    <button role="tab" aria-selected={tab === 'examples'} class:on={tab === 'examples'} onclick={() => (tab = 'examples')}>範例</button>
  </div>
  {#if tab === 'projects'}
    <ul class="list">
      {#each app.projects as p (p.id)}
        <li class:current={p.id === app.projectId}>
          <button class="main" onclick={() => open(p)}>
            <strong>{p.name}{#if hooks.projectBadge(p)}{@const badge = hooks.projectBadge(p)} <span class="badge" title={badge.title}>{badge.icon}</span>{/if}</strong>
            <small>{p.id === app.projectId ? '目前開啟・' : ''}更新於 {fmt(p.updatedAt)}</small>
          </button>
          <span class="acts">
            {#each hooks.projectActions(p) as a (a.label)}
              <button class:danger={a.danger} onclick={() => a.run()}>{a.label}</button>
            {/each}
            <button onclick={() => rename(p)}>重新命名</button>
            <button onclick={() => dup(p)}>複製</button>
            <button class="danger" onclick={() => del(p)}>刪除</button>
          </span>
        </li>
      {/each}
    </ul>
    <p class="tip">💾 專案存在瀏覽器中，清除網站資料或長時間未開啟（例如 Safari 7 天）可能會被刪除。重要的專案請下載 zip 備份。</p>
  {:else}
    <ul class="list">
      {#each EXAMPLES as ex (ex.id)}
        <li>
          <div class="main static"><strong>{ex.name}</strong><small>{ex.description}</small></div>
          <span class="acts"><button class="primary" onclick={() => loadExample(ex)}>建立</button></span>
        </li>
      {/each}
    </ul>
    <p class="tip">範例會建立成新的專案，不會影響目前的專案。</p>
  {/if}
  {#snippet footer()}
    {#if tab === 'projects'}<button class="primary" onclick={create}>＋ 新增專案</button>{/if}
    <button onclick={onclose}>關閉</button>
  {/snippet}
</Modal>

<style>
  .tabs { display: flex; gap: 4px; margin-bottom: 10px; border-bottom: 1px solid var(--border); }
  .tabs button { border: none; border-bottom: 2px solid transparent; border-radius: 0; background: none; padding: 6px 12px; }
  .tabs button.on { border-bottom-color: var(--accent); color: var(--accent); font-weight: 600; }
  .list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
  .list li { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 8px; padding: 6px 8px; flex-wrap: wrap; }
  .list li.current { border-color: var(--accent); background: var(--accent-soft); }
  .main { flex: 1; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; border: none; background: none; text-align: left; padding: 4px; min-width: 160px; }
  .main small { color: var(--muted); font-size: 12px; }
  .acts { display: flex; gap: 4px; flex-wrap: wrap; }
  .tip { font-size: 12px; color: var(--muted); margin: 12px 0 0; }
  .badge { font-weight: normal; font-size: 12px; }
</style>
