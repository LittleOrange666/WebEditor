<script>
  import { onMount, tick } from 'svelte';
  import {
    app, init, activeFile, canEdit, updateContent, closeTab, activateTab, moveTab, takeOver, currentProject,
    updateSettings, testsOf, updateTests, fileById,
  } from './lib/store.svelte.js';
  import { LOCKS_SUPPORTED } from './lib/locks.js';
  import { run, runTests, stopRun, statusText } from './lib/runState.svelte.js';
  import { basename, editorLang, isRunnable, langOf, LANG_LABELS, formatBytes } from './lib/paths.js';
  import { dialogState, toast } from './lib/dialog.svelte.js';
  import { IS_MOBILE } from './lib/env.js';
  import { newId } from './lib/db.js';
  import { downloadFileEntry } from './lib/zip.js';
  import Dialogs from './components/Dialogs.svelte';
  import FileTree from './components/FileTree.svelte';
  import CodeEditor from './components/CodeEditor.svelte';
  import TestPanel from './components/TestPanel.svelte';
  import TerminalPanel from './components/TerminalPanel.svelte';
  import * as edition from '$edition';
  import { ui, openModal, closeModal } from './lib/ui.svelte.js';
  import SettingsDialog from './components/SettingsDialog.svelte';
  import ProjectsDialog from './components/ProjectsDialog.svelte';
  import Docs from './components/Docs.svelte';

  let route = $state(location.hash);
  let treeOpen = $state(false);
  let panelOpen = $state(true);
  let panelHeight = $state(loadPanelHeight());
  let editorApi = $state(null);
  let termApi = $state(null);
  let mobile = $state(window.matchMedia('(max-width: 768px)').matches);
  let systemDark = $state(window.matchMedia('(prefers-color-scheme: dark)').matches);
  let dragTab = null;

  const file = $derived(activeFile());
  const project = $derived(currentProject());
  const dark = $derived(app.settings.theme === 'dark' || (app.settings.theme === 'system' && systemDark));
  const mode = $derived(app.settings.runMode);
  const runnable = $derived(file && isRunnable(file.path));
  const statusMsg = $derived(statusText(run.status));
  const readOnly = $derived(file ? !canEdit(file.id) : false);

  function loadPanelHeight() {
    let saved = 0;
    try { saved = Number(localStorage.getItem('webeditor.panelHeight')) || 0; } catch { /* 略過 */ }
    return Math.max(160, saved || Math.round(window.innerHeight * 0.38));
  }

  const Page = $derived(edition.PageFor(route));

  onMount(() => {
    edition.setup();
    init().then(() => { edition.afterInit(); checkImportRoute(); });
    const mq = window.matchMedia('(max-width: 768px)');
    const md = window.matchMedia('(prefers-color-scheme: dark)');
    const onMq = () => { mobile = mq.matches; };
    const onMd = () => { systemDark = md.matches; };
    mq.addEventListener('change', onMq);
    md.addEventListener('change', onMd);
    const onHash = () => { route = location.hash; checkImportRoute(); };
    window.addEventListener('hashchange', onHash);
    return () => {
      mq.removeEventListener('change', onMq);
      md.removeEventListener('change', onMd);
      window.removeEventListener('hashchange', onHash);
    };
  });

  // 版本專屬的直接連結（例如純前端版的 #/import/<ID>，spec §8.3）
  function checkImportRoute() {
    if (app.loading) return;
    if (edition.handleRoute(location.hash, openModal)) {
      history.replaceState(null, '', location.pathname + location.search + '#/');
      route = '#/';
    }
  }

  $effect(() => {
    const t = app.settings.theme;
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  });

  $effect(() => {
    document.title = project ? `${project.name} - WebEditor` : 'WebEditor 程式編輯器';
  });

  // 跳到錯誤位置
  $effect(() => {
    const g = run.goto;
    if (!g) return;
    tick().then(() => {
      if (app.activeTab === g.fileId) editorApi?.gotoLine(g.line, g.col);
      run.goto = null;
    });
  });

  let mobileCppWarned = false;
  async function doRun() {
    if (!file || run.running) return;
    if (!runnable) {
      toast(langOf(file.path) === 'h' ? '標頭檔不能直接執行，請切換到 .cpp 檔' : '只能執行 .cpp / .py / .js 檔案');
      return;
    }
    if (IS_MOBILE && langOf(file.path) === 'cpp' && !mobileCppWarned) {
      mobileCppWarned = true;
      toast('手機上編譯 C++ 需要大量記憶體與時間，可能失敗', 4000);
    }
    panelOpen = true;
    if (mode === 'terminal') {
      await tick();
      termApi?.start();
      return;
    }
    const t = testsOf(file.id);
    if (!t?.cases?.length) {
      updateTests(file.id, (rec) => rec.cases.push({ id: newId(), name: '測資 1', input: '', expected: '', enabled: true }), { immediate: true });
      toast('已新增一組空白測資；請填入輸入後再執行，或改用終端機模式');
      return;
    }
    if (!t.cases.some((c) => c.enabled)) { toast('沒有勾選要執行的測資'); return; }
    runTests(file.id);
  }

  function onKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.defaultPrevented && !dialogState.current && !ui.modal && !Page) {
      e.preventDefault();
      doRun();
    }
  }

  // 標籤名稱：同名檔案附上所在資料夾
  function tabLabel(id) {
    const f = fileById(id);
    if (!f) return '';
    const name = basename(f.path);
    const dup = app.openTabs.filter((t) => t !== id && basename(fileById(t)?.path ?? '') === name).length;
    return dup ? `${name} — ${f.path.slice(0, -name.length - 1) || '/'}` : name;
  }

  function startResize(e) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = panelHeight;
    const move = (ev) => {
      const h = Math.min(window.innerHeight - 140, Math.max(120, startH - (ev.clientY - startY)));
      panelHeight = h;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try { localStorage.setItem('webeditor.panelHeight', String(panelHeight)); } catch { /* 略過 */ }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function setMode(m) {
    if (run.running) return;
    updateSettings({ runMode: m });
    panelOpen = true;
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if Page}
  {#key route}<Page {route} {dark} />{/key}
{:else if route.startsWith('#/docs')}
  <div class="docs-page">
    <header class="top"><a class="brand" href="#/">WebEditor</a><span class="sp"></span><a href="#/">回到編輯器</a></header>
    <Docs />
  </div>
{:else}
<div class="app">
  <header class="top">
    {#if mobile}<button class="icon-btn" aria-label="檔案" onclick={() => (treeOpen = !treeOpen)}>☰</button>{/if}
    <span class="brand">WebEditor</span>
    <button class="project-btn" onclick={() => openModal({ kind: 'projects' })} title="切換或管理專案">📁 {project?.name ?? '…'} ▾</button>
    <span class="sp"></span>
    <div class="seg" role="radiogroup" aria-label="執行模式">
      <button role="radio" aria-checked={mode === 'tests'} class:on={mode === 'tests'} disabled={run.running} onclick={() => setMode('tests')}>測資</button>
      <button role="radio" aria-checked={mode === 'terminal'} class:on={mode === 'terminal'} disabled={run.running} onclick={() => setMode('terminal')}>終端機</button>
    </div>
    {#if run.running}
      <button class="danger run-btn" onclick={stopRun}>■ 停止</button>
    {:else}
      <button class="primary run-btn" disabled={!runnable} title={runnable ? `執行 ${file.path}（Ctrl+Enter）` : '請開啟 .cpp / .py / .js 檔案'} onclick={doRun}>▶ 執行</button>
    {/if}
    <edition.TopBar {file} />
    <button class="icon-btn" aria-label="設定" title="設定" onclick={() => openModal({ kind: 'settings' })}>⚙</button>
    <a class="icon-btn help" href="#/docs" title="使用說明" aria-label="使用說明">?</a>
  </header>

  {#if app.saveError}
    <div class="banner error">{app.saveError} <button class="link" onclick={() => (app.saveError = '')}>關閉</button></div>
  {/if}

  {#if app.loading}
    <div class="center-msg">載入中…</div>
  {:else if app.loadError}
    <div class="center-msg error">{app.loadError}</div>
  {:else}
  <div class="main">
    {#if mobile && treeOpen}<div class="scrim" role="presentation" onclick={() => (treeOpen = false)}></div>{/if}
    <aside class="side" class:drawer={mobile} class:open={treeOpen}>
      <FileTree onopen={() => { if (mobile) treeOpen = false; }} />
    </aside>

    <section class="center">
      <div class="tabs" role="tablist">
        {#each app.openTabs as id, i (id)}
          <div
            class="tab"
            class:active={id === app.activeTab}
            role="tab"
            tabindex="0"
            aria-selected={id === app.activeTab}
            draggable="true"
            ondragstart={() => (dragTab = i)}
            ondragover={(e) => e.preventDefault()}
            ondrop={() => { if (dragTab !== null && dragTab !== i) moveTab(dragTab, i); dragTab = null; }}
            onclick={() => activateTab(id)}
            onkeydown={(e) => { if (e.key === 'Enter') activateTab(id); }}
            onauxclick={(e) => { if (e.button === 1) closeTab(id); }}
            title={fileById(id)?.path}
          >
            {#if app.locks[id] === 'waiting'}<span title="唯讀：正在其他分頁編輯">🔒</span>{/if}
            <span class="tab-name">{tabLabel(id)}</span>
            <button class="x" aria-label="關閉 {tabLabel(id)}" onclick={(e) => { e.stopPropagation(); closeTab(id); }}>×</button>
          </div>
        {/each}
      </div>

      <div class="editor-area">
        {#if file}
          {#if LOCKS_SUPPORTED && app.locks[file.id] === 'waiting'}
            <div class="banner warn">此檔案正在其他分頁編輯中（唯讀）。<button onclick={() => takeOver(file.id)}>在這裡編輯</button></div>
          {/if}
          {#if file.binary}
            <div class="center-msg">
              <p>無法預覽此檔案（不是 UTF-8 文字檔，{formatBytes(file.binary.byteLength)}）。</p>
              <button onclick={() => downloadFileEntry(file)}>下載</button>
            </div>
          {:else}
            <div class="editor-host">
              <CodeEditor
                fileId={file.id}
                value={file.content ?? ''}
                lang={editorLang(file.path)}
                {readOnly}
                {dark}
                fontSize={app.settings.fontSize}
                tabSize={app.settings.tabSize}
                onchange={(v) => updateContent(file.id, v)}
                onrun={doRun}
                bind:api={editorApi}
              />
            </div>
          {/if}
        {:else}
          <div class="center-msg">
            <p>從左側檔案樹開啟檔案，或新增一個檔案開始寫程式。</p>
            {#if mobile}<button onclick={() => (treeOpen = true)}>開啟檔案樹</button>{/if}
          </div>
        {/if}
      </div>

      {#if panelOpen}
        <div class="resizer" role="separator" aria-orientation="horizontal" aria-label="調整執行面板高度" onpointerdown={startResize}></div>
      {/if}
      <div class="run-panel" class:collapsed={!panelOpen} style:height={panelOpen ? `${panelHeight}px` : 'auto'}>
        <div class="panel-head">
          <strong>{mode === 'terminal' ? '終端機' : '測資'}</strong>
          {#if file && runnable}<span class="muted">{file.path}・{LANG_LABELS[langOf(file.path)]}</span>{/if}
          {#if statusMsg}<span class="status"><span class="spinner"></span>{statusMsg}</span>{/if}
          <span class="sp"></span>
          <button class="icon-btn" aria-label={panelOpen ? '收合執行面板' : '展開執行面板'} onclick={() => (panelOpen = !panelOpen)}>{panelOpen ? '▾' : '▴'}</button>
        </div>
        <div class="panel-body" hidden={!panelOpen}>
          <div class="pane" hidden={mode !== 'tests'}>
            {#if file && runnable}
              <TestPanel fileId={file.id} />
            {:else}
              <p class="muted pad">開啟 .cpp / .py / .js 檔案後，可以在這裡管理與執行測資。</p>
            {/if}
          </div>
          <div class="pane" hidden={mode !== 'terminal'}>
            <TerminalPanel fileId={file?.id} {dark} bind:api={termApi} />
          </div>
        </div>
      </div>
    </section>
  </div>
  {/if}
</div>
{/if}

{#if ui.modal?.kind === 'settings'}
  <SettingsDialog onclose={closeModal} />
{:else if ui.modal?.kind === 'projects'}
  <ProjectsDialog onclose={closeModal} />
{:else}
  <edition.Modals {file} />
{/if}

<Dialogs />

<style>
  .app, .docs-page { height: 100dvh; display: flex; flex-direction: column; }
  .docs-page { overflow: hidden; }
  .top {
    display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-bottom: 1px solid var(--border);
    background: var(--surface); flex-wrap: wrap; flex-shrink: 0;
  }
  .brand { font-weight: 700; color: var(--accent); text-decoration: none; margin-right: 4px; }
  .project-btn { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sp { flex: 1; }
  .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  .seg button { border: none; border-radius: 0; padding: 5px 10px; }
  .seg button.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .run-btn { min-width: 76px; }
  .icon-btn { padding: 4px 9px; }
  .help { text-decoration: none; border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px; }
  .banner { padding: 6px 12px; font-size: 13px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .banner.error { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); }
  .banner.warn { background: var(--warning-soft); color: var(--text); border-bottom: 1px solid var(--warning); }
  .link { border: none; background: none; color: inherit; text-decoration: underline; padding: 0; }
  .center-msg { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--muted); padding: 20px; text-align: center; }
  .center-msg.error { color: var(--danger); }
  .main { flex: 1; display: flex; min-height: 0; position: relative; }
  .side { width: 250px; flex-shrink: 0; border-right: 1px solid var(--border); background: var(--surface); min-height: 0; }
  .side.drawer { position: absolute; z-index: 50; top: 0; bottom: 0; left: 0; width: min(300px, 85vw); transform: translateX(-100%); transition: transform 0.18s; box-shadow: 4px 0 20px rgba(0, 0, 0, 0.2); }
  .side.drawer.open { transform: none; }
  .scrim { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.3); z-index: 49; }
  .center { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .tabs { display: flex; overflow-x: auto; background: var(--surface-2); border-bottom: 1px solid var(--border); flex-shrink: 0; scrollbar-width: thin; }
  .tab { display: flex; align-items: center; gap: 4px; padding: 0 4px 0 12px; height: 34px; border-right: 1px solid var(--border); cursor: pointer; font-size: 13px; white-space: nowrap; color: var(--muted); user-select: none; }
  .tab.active { background: var(--surface); color: var(--text); box-shadow: inset 0 2px 0 var(--accent); }
  .tab-name { max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
  .x { border: none; background: none; padding: 2px 7px; font-size: 15px; line-height: 1; color: var(--muted); }
  .editor-area { flex: 1; display: flex; flex-direction: column; min-height: 80px; }
  .editor-host { flex: 1; min-height: 0; }
  .resizer { height: 6px; cursor: row-resize; background: var(--border); flex-shrink: 0; touch-action: none; }
  .resizer:hover { background: var(--accent); }
  .run-panel { display: flex; flex-direction: column; flex-shrink: 0; background: var(--bg); min-height: 0; }
  .run-panel.collapsed { border-top: 1px solid var(--border); }
  .panel-head { display: flex; align-items: center; gap: 8px; padding: 4px 10px; border-bottom: 1px solid var(--border); background: var(--surface); font-size: 13px; flex-wrap: wrap; }
  .muted { color: var(--muted); font-size: 12px; }
  .pad { padding: 10px; }
  .status { font-size: 12px; color: var(--accent); display: flex; align-items: center; gap: 6px; }
  .spinner { width: 10px; height: 10px; border: 2px solid var(--accent); border-right-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .panel-body { flex: 1; min-height: 0; position: relative; }
  .pane { position: absolute; inset: 0; }
  .pane[hidden], .panel-body[hidden] { display: none; }
  @media (max-width: 768px) {
    .brand { display: none; }
    .project-btn { max-width: 40vw; }
    .top { gap: 4px; padding: 6px; }
    .top button, .help { padding: 6px 8px; }
  }
</style>
