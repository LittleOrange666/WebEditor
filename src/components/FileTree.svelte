<script>
  // 檔案樹（spec §3.2、§3.4）
  import { app, openTab, moveEntry, validateMove, hooks } from '../lib/store.svelte.js';
  import { basename, dirname, langOf } from '../lib/paths.js';
  import { readDataTransfer } from '../lib/zip.js';
  import * as act from '../lib/actions.js';
  import { toast } from '../lib/dialog.svelte.js';

  let { onopen = () => {} } = $props();

  let expanded = $state(new Set());
  let menu = $state(null); // { entry, x, y }
  let dropTarget = $state(null); // 資料夾路徑（'' 為根目錄）
  let dragging = null;
  let fileInput, folderInput, zipInput;

  const EXP_KEY = 'webeditor.expanded.';
  $effect(() => {
    const id = app.projectId;
    try { expanded = new Set(JSON.parse(localStorage.getItem(EXP_KEY + id) || '[]')); } catch { expanded = new Set(); }
  });
  function saveExpanded() {
    try { localStorage.setItem(EXP_KEY + app.projectId, JSON.stringify([...expanded])); } catch { /* 略過 */ }
  }

  function toggle(path) {
    const s = new Set(expanded);
    if (s.has(path)) s.delete(path); else s.add(path);
    expanded = s;
    saveExpanded();
  }

  // 依資料夾排序後攤平成可見的列
  let rows = $derived.by(() => {
    const children = new Map();
    for (const f of app.files) {
      const d = dirname(f.path);
      if (!children.has(d)) children.set(d, []);
      children.get(d).push(f);
    }
    for (const list of children.values()) {
      list.sort((a, b) => (a.kind === b.kind ? basename(a.path).localeCompare(basename(b.path), 'en', { numeric: true }) : a.kind === 'dir' ? -1 : 1));
    }
    const out = [];
    const walk = (dir, depth) => {
      for (const f of children.get(dir) ?? []) {
        out.push({ entry: f, depth });
        if (f.kind === 'dir' && expanded.has(f.path)) walk(f.path, depth + 1);
      }
    };
    walk('', 0);
    return out;
  });

  // 開啟檔案時自動展開所在資料夾
  $effect(() => {
    const f = app.files.find((x) => x.id === app.activeTab);
    if (!f) return;
    let d = dirname(f.path);
    let changed = false;
    const s = new Set(expanded);
    while (d) { if (!s.has(d)) { s.add(d); changed = true; } d = dirname(d); }
    if (changed) { expanded = s; saveExpanded(); }
  });

  function clickRow(entry) {
    if (entry.kind === 'dir') {
      toggle(entry.path);
      app.selectedDir = entry.path;
    } else {
      app.selectedDir = dirname(entry.path);
      openTab(entry.id);
      onopen();
    }
  }

  function icon(entry) {
    if (entry.kind === 'dir') return expanded.has(entry.path) ? '📂' : '📁';
    const l = langOf(entry.path);
    return { cpp: '⚙️', h: '📎', py: '🐍', js: '📜' }[l] ?? '📄';
  }

  function openMenu(e, entry) {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    menu = { entry, x: Math.min(r.left, window.innerWidth - 190), y: Math.min(r.bottom + 2, window.innerHeight - 260) };
  }

  async function menuAction(fn) {
    const entry = menu.entry;
    menu = null;
    await fn(entry);
  }

  // ----- 拖放 -----
  function onDragStart(e, entry) {
    dragging = entry;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', entry.path);
  }
  function dirOf(entry) { return entry ? (entry.kind === 'dir' ? entry.path : dirname(entry.path)) : ''; }
  function onDragOver(e, entry) {
    e.preventDefault();
    e.stopPropagation();
    dropTarget = dirOf(entry);
    e.dataTransfer.dropEffect = dragging ? 'move' : 'copy';
  }
  async function onDrop(e, entry) {
    e.preventDefault();
    e.stopPropagation();
    const dest = dirOf(entry);
    dropTarget = null;
    if (dragging) {
      const src = dragging;
      dragging = null;
      const err = validateMove(src, dest);
      if (err) { if (dirname(src.path) !== dest) toast(err); return; }
      await moveEntry(src, dest);
      return;
    }
    if (e.dataTransfer?.files?.length || e.dataTransfer?.items?.length) {
      const data = await readDataTransfer(e.dataTransfer);
      await act.uploadDropped(data, dest);
    }
  }

  function pick(input) { input.value = ''; input.click(); }
</script>

<svelte:window onclick={() => (menu = null)} onkeydown={(e) => { if (e.key === 'Escape') menu = null; }} />

<div class="tree-wrap">
  <div class="toolbar">
    <button title="新增檔案" aria-label="新增檔案" onclick={() => act.newFile()}>＋📄</button>
    <button title="新增資料夾" aria-label="新增資料夾" onclick={() => act.newFolder()}>＋📁</button>
    <button title="上傳檔案" onclick={() => pick(fileInput)}>上傳</button>
    <button title="上傳資料夾" onclick={() => pick(folderInput)}>資料夾</button>
    <button title="上傳 zip" onclick={() => pick(zipInput)}>zip</button>
    <button title="下載整個專案（zip）" onclick={act.downloadProject}>⬇ 專案</button>
  </div>
  <div class="target" title="上傳與新增的位置">位置：<code>{app.selectedDir ? app.selectedDir + '/' : '/'}</code>
    {#if app.selectedDir}<button class="link" onclick={() => (app.selectedDir = '')}>回根目錄</button>{/if}
  </div>

  <input type="file" multiple hidden bind:this={fileInput} onchange={(e) => act.uploadLocal(e.target.files)} />
  <input type="file" hidden webkitdirectory bind:this={folderInput} onchange={(e) => act.uploadLocal(e.target.files, { keepDirs: true })} />
  <input type="file" accept=".zip,application/zip" hidden bind:this={zipInput} onchange={(e) => e.target.files[0] && act.uploadZip(e.target.files[0])} />

  <div
    class="tree"
    class:drop={dropTarget === ''}
    role="tree"
    tabindex="-1"
    ondragover={(e) => onDragOver(e, null)}
    ondragleave={(e) => { if (e.currentTarget === e.target) dropTarget = null; }}
    ondrop={(e) => onDrop(e, null)}
  >
    {#each rows as { entry, depth } (entry.id)}
      <div
        class="row"
        class:active={entry.id === app.activeTab}
        class:open={app.openTabs.includes(entry.id)}
        class:drop={entry.kind === 'dir' && dropTarget === entry.path}
        class:selected-dir={entry.kind === 'dir' && app.selectedDir === entry.path}
        style:padding-left="{8 + depth * 14}px"
        role="treeitem"
        aria-selected={entry.id === app.activeTab}
        aria-expanded={entry.kind === 'dir' ? expanded.has(entry.path) : undefined}
        tabindex="0"
        draggable="true"
        ondragstart={(e) => onDragStart(e, entry)}
        ondragend={() => { dragging = null; dropTarget = null; }}
        ondragover={(e) => onDragOver(e, entry)}
        ondrop={(e) => onDrop(e, entry)}
        onclick={() => clickRow(entry)}
        onkeydown={(e) => { if (e.key === 'Enter') clickRow(entry); else if (e.key === 'F2') act.rename(entry); else if (e.key === 'Delete') act.remove(entry); }}
        oncontextmenu={(e) => { e.preventDefault(); openMenu(e, entry); }}
      >
        <span class="icon">{icon(entry)}</span>
        <span class="name" title={entry.path}>{basename(entry.path)}</span>
        {#if hooks.entryBadge(entry)}{@const badge = hooks.entryBadge(entry)}<span class="badge" title={badge.title}>{badge.icon}</span>{/if}
        {#if app.locks[entry.id] === 'waiting'}<span class="badge" title="正在其他分頁編輯中">🔒</span>{/if}
        <button class="more" aria-label="更多動作" onclick={(e) => openMenu(e, entry)}>⋯</button>
      </div>
    {:else}
      <p class="empty">沒有檔案。按「＋📄」新增，或把檔案拖到這裡上傳。</p>
    {/each}
  </div>
</div>

{#if menu}
  <div class="menu" role="menu" tabindex="-1" style:left="{menu.x}px" style:top="{menu.y}px" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    {#if menu.entry.kind === 'dir'}
      <button role="menuitem" onclick={() => menuAction((e) => act.newFile(e.path))}>在此新增檔案</button>
      <button role="menuitem" onclick={() => menuAction((e) => act.newFolder(e.path))}>在此新增資料夾</button>
      <button role="menuitem" onclick={() => menuAction((e) => { app.selectedDir = e.path; })}>設為上傳位置</button>
    {/if}
    <button role="menuitem" onclick={() => menuAction(act.rename)}>重新命名</button>
    <button role="menuitem" onclick={() => menuAction(act.moveTo)}>移動到…</button>
    <button role="menuitem" onclick={() => menuAction(act.downloadEntry)}>{menu.entry.kind === 'dir' ? '下載資料夾（zip）' : '下載'}</button>
    <button role="menuitem" class="danger-item" onclick={() => menuAction(act.remove)}>刪除</button>
  </div>
{/if}

<style>
  .tree-wrap { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px; border-bottom: 1px solid var(--border); }
  .toolbar button { padding: 4px 7px; font-size: 12px; }
  .target { font-size: 12px; color: var(--muted); padding: 4px 8px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .target code { font-family: var(--mono); color: var(--text); }
  .link { border: none; background: none; color: var(--accent); padding: 0; font-size: 12px; }
  .tree { flex: 1; overflow: auto; padding: 2px 0 40px; outline: none; }
  .tree.drop { background: var(--accent-soft); }
  .row {
    display: flex; align-items: center; gap: 6px; padding: 3px 4px 3px 8px; cursor: pointer;
    font-size: 13px; user-select: none; min-height: 30px; border-left: 2px solid transparent;
  }
  .row:hover { background: var(--hover); }
  .row.open .name { font-weight: 500; }
  .row.active { background: var(--accent-soft); border-left-color: var(--accent); }
  .row.selected-dir .name { text-decoration: underline dotted; }
  .row.drop { background: var(--accent-soft); outline: 1px dashed var(--accent); }
  .icon { width: 18px; text-align: center; flex-shrink: 0; font-size: 13px; }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { font-size: 11px; }
  .more { border: none; background: none; padding: 2px 8px; opacity: 0.55; font-size: 15px; line-height: 1; }
  .row:hover .more, .row.active .more { opacity: 1; }
  .empty { color: var(--muted); font-size: 13px; padding: 12px; }
  .menu {
    position: fixed; z-index: 80; background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.2); padding: 4px; display: flex; flex-direction: column; min-width: 180px;
  }
  .menu button { border: none; background: none; text-align: left; padding: 8px 10px; border-radius: 6px; }
  .menu button:hover { background: var(--hover); }
  .danger-item { color: var(--danger) !important; }
</style>
