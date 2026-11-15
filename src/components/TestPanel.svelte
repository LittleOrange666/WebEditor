<script>
  // 測資模式（spec §6.3）
  import { app, testsOf, updateTests, fileById } from '../lib/store.svelte.js';
  import { run, runTests, stopRun, timeLimitOf, STATUS_LABELS } from '../lib/runState.svelte.js';
  import { firstDiffLine } from '../lib/compare.js';
  import { readLocalFiles, readZip, downloadText } from '../lib/zip.js';
  import { pairTestFiles } from '../lib/testFiles.js';
  import { confirmDialog, toast } from '../lib/dialog.svelte.js';
  import { newId } from '../lib/db.js';
  import { formatBytes } from '../lib/paths.js';
  import { PREVIEW_CHARS } from '../lib/config.js';
  import ErrorText from './ErrorText.svelte';

  let { fileId } = $props();

  let file = $derived(fileById(fileId));
  let tests = $derived(testsOf(fileId));
  let cases = $derived(tests?.cases ?? []);
  let results = $derived(run.results[fileId] ?? {});
  let compileInfo = $derived(run.compile[fileId]);
  let expandedId = $state(null);
  let batchInput;
  let dragIndex = null;
  const busy = $derived(run.running);
  const runningHere = $derived(run.running && run.fileId === fileId);

  let summary = $derived.by(() => {
    const rs = cases.map((c) => results[c.id]).filter((r) => r && ['AC', 'WA', 'TLE', 'RE', 'OLE', 'done'].includes(r.status));
    if (!rs.length) return '';
    const judged = rs.filter((r) => r.status !== 'done');
    const ac = rs.filter((r) => r.status === 'AC').length;
    const maxT = Math.max(...rs.map((r) => r.time ?? 0));
    const parts = [];
    if (judged.length) parts.push(`AC ${ac} / ${judged.length}`);
    if (rs.length > judged.length) parts.push(`完成 ${rs.length - judged.length}`);
    parts.push(`最長 ${(maxT / 1000).toFixed(2)} 秒`);
    return parts.join('，');
  });

  function edit(mutate, opts) { updateTests(fileId, mutate, opts); }

  function addCase() {
    const id = newId();
    edit((t) => t.cases.push({ id, name: `測資 ${t.cases.length + 1}`, input: '', expected: '', enabled: true }), { immediate: true });
    expandedId = id;
  }

  function dupCase(c) {
    const id = newId();
    edit((t) => {
      const i = t.cases.findIndex((x) => x.id === c.id);
      t.cases.splice(i + 1, 0, { ...$state.snapshot(c), id, name: `${c.name} 副本` });
    }, { immediate: true });
  }

  async function delCase(c) {
    if ((c.input || c.expected) && !(await confirmDialog({ title: '刪除測資', message: `確定刪除「${c.name}」？此動作無法復原。`, confirmLabel: '刪除', danger: true }))) return;
    edit((t) => { t.cases = t.cases.filter((x) => x.id !== c.id); }, { immediate: true });
  }

  async function clearAll() {
    if (!(await confirmDialog({ title: '刪除全部測資', message: `確定刪除這個檔案的 ${cases.length} 組測資？此動作無法復原。`, confirmLabel: '全部刪除', danger: true }))) return;
    edit((t) => { t.cases = []; }, { immediate: true });
  }

  function setField(c, key, value) {
    edit((t) => { const x = t.cases.find((y) => y.id === c.id); if (x) x[key] = value; });
  }

  async function uploadField(c, key, input) {
    const f = input.files?.[0];
    if (!f) return;
    const [item] = await readLocalFiles([f], false);
    if (typeof item?.content !== 'string') { toast('無法讀取：不是文字檔'); return; }
    setField(c, key, item.content);
    input.value = '';
  }

  async function batchUpload(e) {
    const list = [...e.target.files];
    e.target.value = '';
    let items = [];
    for (const f of list) {
      if (/\.zip$/i.test(f.name)) items.push(...(await readZip(f)).files);
      else items.push(...(await readLocalFiles([f], false)));
    }
    const pairs = pairTestFiles(items);
    if (!pairs.length) { toast('找不到可用的測資檔（需要 .in 檔或檔名含 in 的文字檔）'); return; }
    edit((t) => { for (const p of pairs) t.cases.push({ id: newId(), ...p, enabled: true }); }, { immediate: true });
    toast(`已加入 ${pairs.length} 組測資`);
  }

  function useOutput(c) {
    const r = results[c.id];
    if (r?.stdout !== undefined) setField(c, 'expected', r.stdout);
  }

  function setLimit(v) {
    const n = Math.min(60, Math.max(1, Number(v) || 0));
    edit((t) => { t.timeLimit = n; });
  }

  function onDrop(i) {
    if (dragIndex === null || dragIndex === i) return;
    const from = dragIndex;
    dragIndex = null;
    edit((t) => { const [x] = t.cases.splice(from, 1); t.cases.splice(i, 0, x); }, { immediate: true });
  }

  const clip = (s) => (s && s.length > PREVIEW_CHARS ? s.slice(0, PREVIEW_CHARS) : s ?? '');
  const statusClass = (s) => `st st-${s}`;
  const allEnabled = $derived(cases.length > 0 && cases.every((c) => c.enabled));
</script>

<div class="panel">
  <div class="bar">
    <button class="primary" disabled={busy || !cases.some((c) => c.enabled)} onclick={() => runTests(fileId)}>▶ 全部執行</button>
    {#if runningHere}<button class="danger" onclick={stopRun}>■ 停止</button>{/if}
    <button onclick={addCase} disabled={!file}>＋ 新增測資</button>
    <button onclick={() => { batchInput.value = ''; batchInput.click(); }}>批次上傳</button>
    <input type="file" multiple hidden accept=".in,.out,.ans,.txt,.zip" bind:this={batchInput} onchange={batchUpload} />
    <label class="opt">時限
      <input type="number" min="1" max="60" step="1" value={timeLimitOf(fileId)} onchange={(e) => setLimit(e.target.value)} /> 秒
    </label>
    <label class="opt">比對
      <select value={tests?.compare ?? 'tokens'} onchange={(e) => edit((t) => { t.compare = e.target.value; })}>
        <option value="tokens">忽略空白差異</option>
        <option value="exact">完全相同</option>
      </select>
    </label>
    {#if summary}<span class="summary">{summary}</span>{/if}
  </div>

  {#if compileInfo?.error}
    <div class="box error-box"><strong>{compileInfo.internal ? '執行環境錯誤' : '編譯錯誤'}</strong><ErrorText text={compileInfo.error} /></div>
  {:else if compileInfo?.warnings}
    <details class="box warn-box"><summary>編譯警告</summary><ErrorText text={compileInfo.warnings} /></details>
  {/if}

  {#if !cases.length}
    <p class="empty">這個檔案還沒有測資。按「＋ 新增測資」建立，或「批次上傳」.in / .out 檔案（也可以上傳 zip）。</p>
  {:else}
    <div class="list-head">
      <label><input type="checkbox" checked={allEnabled} onchange={(e) => edit((t) => t.cases.forEach((c) => (c.enabled = e.target.checked)))} /> 全選</label>
      <button class="link danger-link" onclick={clearAll}>全部刪除</button>
    </div>
    <ul class="cases">
      {#each cases as c, i (c.id)}
        {@const r = results[c.id]}
        <li
          class:expanded={expandedId === c.id}
          ondragover={(e) => e.preventDefault()}
          ondrop={() => onDrop(i)}
        >
          <div class="row">
            <span class="grip" draggable="true" role="button" tabindex="-1" aria-label="拖曳排序" title="拖曳排序" ondragstart={() => (dragIndex = i)}>⋮⋮</span>
            <input type="checkbox" checked={c.enabled} aria-label="執行這組測資" onchange={(e) => setField(c, 'enabled', e.target.checked)} />
            <button class="name" onclick={() => (expandedId = expandedId === c.id ? null : c.id)} aria-expanded={expandedId === c.id}>
              <span class="caret">{expandedId === c.id ? '▾' : '▸'}</span>{c.name}
            </button>
            {#if r}
              <span class={statusClass(r.status)}>{STATUS_LABELS[r.status] ?? r.status}</span>
              {#if r.time !== undefined}<span class="time">{(r.time / 1000).toFixed(2)}s</span>{/if}
            {/if}
            <button class="icon" title="只執行這組" aria-label="只執行這組" disabled={busy} onclick={() => runTests(fileId, [c.id])}>▶</button>
          </div>

          {#if expandedId === c.id}
            <div class="detail">
              <div class="name-edit">
                <label>名稱 <input value={c.name} onchange={(e) => setField(c, 'name', e.target.value.trim() || c.name)} /></label>
                <button onclick={() => dupCase(c)}>複製</button>
                <button class="danger" onclick={() => delCase(c)}>刪除</button>
              </div>
              <div class="io">
                <div class="field">
                  <div class="field-head">
                    <span>輸入（stdin）<small>{formatBytes(c.input.length)}</small></span>
                    <span class="acts">
                      <label class="upl">上傳<input type="file" hidden onchange={(e) => uploadField(c, 'input', e.target)} /></label>
                      <button class="link" onclick={() => downloadText(c.input, `${c.name}.in`)}>下載</button>
                    </span>
                  </div>
                  <textarea spellcheck="false" value={clip(c.input)} readonly={c.input.length > PREVIEW_CHARS} oninput={(e) => setField(c, 'input', e.target.value)}></textarea>
                  {#if c.input.length > PREVIEW_CHARS}<small class="muted">內容太大，只顯示開頭部分（唯讀）</small>{/if}
                </div>
                <div class="field">
                  <div class="field-head">
                    <span>預期輸出<small>{c.expected ? formatBytes(c.expected.length) : '（留空則不比對）'}</small></span>
                    <span class="acts">
                      <label class="upl">上傳<input type="file" hidden onchange={(e) => uploadField(c, 'expected', e.target)} /></label>
                      <button class="link" onclick={() => downloadText(c.expected, `${c.name}.out`)}>下載</button>
                    </span>
                  </div>
                  <textarea spellcheck="false" value={clip(c.expected)} readonly={c.expected.length > PREVIEW_CHARS} oninput={(e) => setField(c, 'expected', e.target.value)}></textarea>
                </div>
              </div>

              {#if r && r.stdout !== undefined}
                {@const diffLine = r.status === 'WA' ? firstDiffLine(r.stdout, c.expected, tests.compare) : 0}
                <div class="result">
                  {#if r.detail}<p class="detail-msg">{r.detail}</p>{/if}
                  {#if r.message}<div class="box error-box"><ErrorText text={r.message} /></div>{/if}
                  <div class="field">
                    <div class="field-head">
                      <span>實際輸出（stdout）<small>{formatBytes(r.stdout.length)}</small></span>
                      <span class="acts">
                        <button class="link" onclick={() => useOutput(c)}>設為預期輸出</button>
                        <button class="link" onclick={() => navigator.clipboard?.writeText(r.stdout).then(() => toast('已複製'))}>複製</button>
                        <button class="link" onclick={() => downloadText(r.stdout, `${c.name}.out`)}>下載</button>
                      </span>
                    </div>
                    {#if diffLine}
                      <div class="diff">
                        <div><div class="dh">實際</div><pre>{#each clip(r.stdout).split('\n') as line, li}<span class:bad={li + 1 === diffLine}>{line}{'\n'}</span>{/each}</pre></div>
                        <div><div class="dh">預期</div><pre>{#each clip(c.expected).split('\n') as line, li}<span class:bad={li + 1 === diffLine}>{line}{'\n'}</span>{/each}</pre></div>
                      </div>
                    {:else}
                      <pre class="out">{clip(r.stdout)}</pre>
                    {/if}
                    {#if r.stdout.length > PREVIEW_CHARS}<small class="muted">輸出太大，只顯示開頭部分；完整內容請下載</small>{/if}
                  </div>
                  {#if r.stderr}
                    <div class="field">
                      <div class="field-head"><span>錯誤輸出（stderr）</span></div>
                      <pre class="out stderr">{clip(r.stderr)}</pre>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .panel { height: 100%; overflow: auto; padding: 8px 10px 30px; }
  .bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; }
  .opt { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); }
  .opt input { width: 56px; }
  .summary { font-size: 13px; font-weight: 600; margin-left: auto; }
  .empty { color: var(--muted); font-size: 13px; }
  .list-head { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); padding: 0 4px 4px; }
  .link { border: none; background: none; color: var(--accent); padding: 0 4px; font-size: 12px; cursor: pointer; }
  .danger-link { color: var(--danger); }
  .cases { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .cases li { border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
  .row { display: flex; align-items: center; gap: 6px; padding: 4px 6px; }
  .grip { cursor: grab; color: var(--muted); font-size: 12px; padding: 0 2px; user-select: none; }
  .name { flex: 1; text-align: left; border: none; background: none; padding: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .caret { display: inline-block; width: 14px; color: var(--muted); }
  .icon { padding: 3px 9px; }
  .time { font-size: 12px; color: var(--muted); font-family: var(--mono); }
  .st { font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 10px; background: var(--surface-2); color: var(--muted); white-space: nowrap; }
  .st-AC { background: var(--success); color: #fff; }
  .st-WA, .st-ce { background: var(--danger); color: #fff; }
  .st-TLE, .st-OLE { background: var(--warning); color: #fff; }
  .st-RE, .st-error-env { background: var(--purple); color: #fff; }
  .st-running { background: var(--accent-soft); color: var(--accent); }
  .detail { padding: 6px 10px 10px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
  .name-edit { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 12px; color: var(--muted); }
  .name-edit input { width: 160px; }
  .io { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  @media (max-width: 700px) { .io { grid-template-columns: 1fr; } .diff { grid-template-columns: 1fr !important; } }
  .field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .field-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--muted); gap: 6px; flex-wrap: wrap; }
  .field-head small { margin-left: 6px; }
  .acts { display: flex; gap: 2px; }
  .upl { color: var(--accent); cursor: pointer; padding: 0 4px; }
  textarea, pre.out, .diff pre {
    font-family: var(--mono); font-size: 12px; border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface-2); color: var(--text); padding: 6px; margin: 0;
  }
  textarea { min-height: 80px; height: 110px; resize: vertical; width: 100%; }
  pre.out { max-height: 220px; overflow: auto; white-space: pre; }
  pre.stderr { color: var(--danger); }
  .diff { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .diff pre { max-height: 220px; overflow: auto; }
  .dh { font-size: 11px; color: var(--muted); }
  .bad { background: color-mix(in srgb, var(--danger) 25%, transparent); }
  .detail-msg { margin: 0; font-size: 13px; color: var(--danger); }
  .box { border-radius: 6px; padding: 6px 8px; margin-bottom: 8px; font-size: 13px; }
  .error-box { background: color-mix(in srgb, var(--danger) 10%, transparent); border: 1px solid var(--danger); color: var(--text); }
  .error-box strong { color: var(--danger); display: block; margin-bottom: 4px; }
  .warn-box { background: var(--warning-soft); border: 1px solid var(--warning); }
  .muted { color: var(--muted); font-size: 11px; }
</style>
