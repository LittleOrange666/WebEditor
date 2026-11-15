<script>
  // 唯讀的檔案樹 + 程式碼檢視（分享頁、管理頁共用，spec_new §5.3）
  import CodeEditor from '../components/CodeEditor.svelte';
  import { app } from '../lib/store.svelte.js';
  import { basename, dirname, editorLang, langOf } from '../lib/paths.js';

  let { entries, dark = false, selected = $bindable(null) } = $props();

  const files = $derived(entries.filter((e) => e.kind === 'file'));
  const single = $derived(files.length === 1 && entries.length === 1);
  $effect(() => {
    if (!selected || !files.some((f) => f.path === selected)) {
      const main = files.find((f) => /^main\./i.test(basename(f.path))) ?? files[0];
      selected = main?.path ?? null;
    }
  });
  const current = $derived(files.find((f) => f.path === selected) ?? null);

  const rows = $derived.by(() => {
    const children = new Map();
    const all = [...entries];
    // 補上沒有明確列出的資料夾
    const dirs = new Set(entries.filter((e) => e.kind === 'dir').map((e) => e.path));
    for (const e of entries) {
      let d = dirname(e.path);
      while (d && !dirs.has(d)) { dirs.add(d); all.push({ path: d, kind: 'dir' }); d = dirname(d); }
    }
    for (const e of all) {
      const d = dirname(e.path);
      if (!children.has(d)) children.set(d, []);
      children.get(d).push(e);
    }
    for (const list of children.values()) {
      list.sort((a, b) => (a.kind === b.kind ? basename(a.path).localeCompare(basename(b.path), 'en', { numeric: true }) : a.kind === 'dir' ? -1 : 1));
    }
    const out = [];
    const walk = (dir, depth) => {
      for (const e of children.get(dir) ?? []) {
        out.push({ e, depth });
        if (e.kind === 'dir') walk(e.path, depth + 1);
      }
    };
    walk('', 0);
    return out;
  });

  function icon(e) {
    if (e.kind === 'dir') return '📁';
    return { cpp: '⚙️', h: '📎', py: '🐍', js: '📜' }[langOf(e.path)] ?? '📄';
  }
</script>

<div class="ro" class:single>
  {#if !single}
    <nav class="tree" aria-label="檔案">
      {#each rows as { e, depth } (e.path)}
        {#if e.kind === 'dir'}
          <div class="row dir" style:padding-left="{8 + depth * 14}px">{icon(e)} {basename(e.path)}</div>
        {:else}
          <button class="row" class:on={e.path === selected} style:padding-left="{8 + depth * 14}px" onclick={() => (selected = e.path)} title={e.path}>
            {icon(e)} {basename(e.path)}
          </button>
        {/if}
      {/each}
    </nav>
  {/if}
  <div class="view">
    {#if current}
      {#if !single}<div class="path">{current.path}</div>{/if}
      <div class="ed">
        <CodeEditor
          fileId={`ro:${current.path}`}
          value={current.content ?? ''}
          lang={editorLang(current.path)}
          readOnly={true}
          {dark}
          fontSize={app.settings.fontSize}
          tabSize={app.settings.tabSize}
          onchange={() => {}}
          onrun={() => {}}
        />
      </div>
    {:else}
      <p class="muted">沒有檔案</p>
    {/if}
  </div>
</div>

<style>
  .ro { display: flex; flex: 1; min-height: 0; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--surface); }
  .tree { width: 220px; flex-shrink: 0; border-right: 1px solid var(--border); overflow: auto; padding: 4px 0; background: var(--surface); }
  .row { display: block; width: 100%; text-align: left; border: none; background: none; border-radius: 0; padding: 4px 8px; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
  .row.dir { color: var(--muted); }
  button.row:hover { background: var(--hover); }
  button.row.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .view { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .path { font-family: var(--mono); font-size: 12px; color: var(--muted); padding: 4px 10px; border-bottom: 1px solid var(--border); }
  .ed { flex: 1; min-height: 0; }
  .muted { color: var(--muted); padding: 12px; }
  @media (max-width: 768px) {
    .ro { flex-direction: column; }
    .tree { width: auto; max-height: 30vh; border-right: none; border-bottom: 1px solid var(--border); }
  }
</style>
