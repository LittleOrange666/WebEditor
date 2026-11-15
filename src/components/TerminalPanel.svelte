<script>
  // 終端機模式（spec §6.4）
  import { onMount, onDestroy } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { app, fileById, flushAll, updateSettings } from '../lib/store.svelte.js';
  import { run, runFiles } from '../lib/runState.svelte.js';
  import { runner, INTERACTIVE_SUPPORTED } from '../lib/runner.js';
  import { toast } from '../lib/dialog.svelte.js';
  import ErrorText from './ErrorText.svelte';

  let { fileId, dark = false, api = $bindable(null) } = $props();

  let host;
  let term;
  let fit;
  let ro;
  let stderrText = $state('');
  let compileError = $state('');
  let line = ''; // 尚未送出的輸入
  let cursor = 0;
  const split = $derived(app.settings.stderrMode === 'split');
  const runningHere = $derived(run.running && run.mode === 'terminal');

  const lightTheme = { background: '#ffffff', foreground: '#1d2330', cursor: '#2f6fde', selectionBackground: '#b9d1fa', black: '#1d2330', red: '#d03b3b', green: '#1e8e4e', yellow: '#c27a00', blue: '#2f6fde', brightBlack: '#687284' };
  const darkTheme = { background: '#1c2028', foreground: '#e3e7ee', cursor: '#6a9cf5', selectionBackground: '#3a4a66', red: '#f06b6b', green: '#4cc27f', yellow: '#e9a93a', blue: '#6a9cf5', brightBlack: '#96a0b2' };

  // 東亞全形字元占兩格
  const cw = (ch) => {
    const c = ch.codePointAt(0);
    return (c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd))) ? 2 : 1;
  };
  const width = (s) => [...s].reduce((a, ch) => a + cw(ch), 0);
  const left = (n) => (n > 0 ? `\x1b[${n}D` : '');
  const right = (n) => (n > 0 ? `\x1b[${n}C` : '');

  function submitLine(withNewline = true) {
    const text = line + (withNewline ? '\n' : '');
    line = '';
    cursor = 0;
    if (withNewline) term.write('\r\n');
    runner.sendInput(text);
  }

  function insert(text) {
    const chars = [...line];
    const before = chars.slice(0, cursor).join('');
    const after = chars.slice(cursor).join('');
    line = before + text + after;
    cursor += [...text].length;
    term.write(text + after + left(width(after)));
  }

  function onData(data) {
    if (!runningHere) return;
    // 貼上多行文字：逐行送出
    if (data.length > 1 && /[\r\n]/.test(data) && !data.startsWith('\x1b')) {
      const parts = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      parts.forEach((p, i) => {
        if (p) insert(p);
        if (i < parts.length - 1) submitLine(true);
      });
      return;
    }
    switch (data) {
      case '\r': submitLine(true); return;
      case '\x7f': case '\b': {
        if (cursor === 0) return;
        const chars = [...line];
        const ch = chars[cursor - 1];
        const after = chars.slice(cursor).join('');
        chars.splice(cursor - 1, 1);
        line = chars.join('');
        cursor--;
        const w = cw(ch);
        term.write(left(w) + after + ' '.repeat(w) + left(width(after) + w));
        return;
      }
      case '\x04': // Ctrl+D
        if (line) submitLine(false);
        else { runner.sendEOF(); term.write('\x1b[90m^D\x1b[0m\r\n'); }
        return;
      case '\x03': // Ctrl+C
        if (term.hasSelection()) { navigator.clipboard?.writeText(term.getSelection()); return; }
        term.write('^C\r\n');
        runner.stop();
        return;
      case '\x1b[D': if (cursor > 0) { term.write(left(cw([...line][cursor - 1]))); cursor--; } return;
      case '\x1b[C': if (cursor < [...line].length) { term.write(right(cw([...line][cursor]))); cursor++; } return;
      case '\x1b[H': case '\x1bOH': term.write(left(width([...line].slice(0, cursor).join('')))); cursor = 0; return;
      case '\x1b[F': case '\x1bOF': term.write(right(width([...line].slice(cursor).join('')))); cursor = [...line].length; return;
      default:
        if (data.startsWith('\x1b')) return; // 其他控制鍵忽略
        insert(data.replace(/[\x00-\x1f]/g, ''));
    }
  }

  function writeOut(chunks) {
    for (const [fd, text] of chunks) {
      if (fd === 2) {
        if (split) stderrText += text;
        else term.write(`\x1b[31m${text}\x1b[0m`);
      } else term.write(text);
    }
  }

  export async function start() {
    const file = fileById(fileId);
    if (!file || run.running) return;
    if (!INTERACTIVE_SUPPORTED) {
      toast('此瀏覽器無法啟用終端機模式，請改用測資模式');
      return;
    }
    await flushAll();
    runner.setClangSource(app.settings.clangSource);
    if (app.settings.clearTerminal) term.reset();
    stderrText = '';
    compileError = '';
    line = '';
    cursor = 0;
    run.running = true;
    run.mode = 'terminal';
    run.fileId = fileId;
    term.focus();
    let r;
    try {
      r = await runner.run({ path: file.path, files: runFiles(), interactive: true, onOutput: writeOut });
    } finally {
      run.running = false;
      run.mode = null;
    }
    if (r.status === 'ce') {
      compileError = r.message;
      term.write(`\x1b[31m${r.internal ? '執行環境錯誤' : '編譯錯誤'}（詳見下方）\x1b[0m\r\n`);
      return;
    }
    if (r.message && r.status !== 'stopped') {
      if (split && r.status === 'error') stderrText += (stderrText && !stderrText.endsWith('\n') ? '\n' : '') + r.message + '\n';
      else term.write(`\r\n\x1b[31m${r.message.replace(/\n/g, '\r\n')}\x1b[0m`);
    }
    const t = r.time !== undefined ? `，耗時 ${(r.time / 1000).toFixed(2)} 秒` : '';
    const msg = r.status === 'stopped' ? '[已停止]'
      : r.status === 'ole' ? '[輸出過大，已停止]'
      : `[程式結束，結束碼 ${r.exitCode ?? 0}${t}]`;
    term.write(`\r\n\x1b[90m${msg}\x1b[0m\r\n`);
  }

  onMount(() => {
    term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace',
      fontSize: 13,
      theme: dark ? darkTheme : lightTheme,
      scrollback: 5000,
    });
    fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    term.onData(onData);
    term.attachCustomKeyEventHandler((e) => {
      // Ctrl+V 交給瀏覽器貼上；Ctrl/Cmd+Enter 交給全域的執行快捷鍵
      if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'Enter')) return false;
      // 有選取文字時 Ctrl+C 交給瀏覽器複製
      if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && e.key === 'c' && term.hasSelection()) return false;
      return true;
    });
    if (!INTERACTIVE_SUPPORTED) {
      term.write('\x1b[33m此頁面沒有啟用跨來源隔離（crossOriginIsolated），無法使用終端機模式。\r\n請改用「測資」模式，或更換瀏覽器後重新整理。\x1b[0m\r\n');
    } else {
      term.write('\x1b[90m按「▶ 執行」（Ctrl+Enter）開始。輸入後按 Enter 送出，Ctrl+D 送出 EOF，Ctrl+C 停止。\x1b[0m\r\n');
    }
    ro = new ResizeObserver(() => { try { fit.fit(); } catch { /* 隱藏時略過 */ } });
    ro.observe(host);
    api = { start, focus: () => term.focus(), clear: () => term.reset() };
  });

  onDestroy(() => { ro?.disconnect(); term?.dispose(); });

  $effect(() => { if (term) term.options.theme = dark ? darkTheme : lightTheme; });
</script>

<div class="wrap">
  <div class="bar">
    <label class="opt">stderr
      <select value={app.settings.stderrMode} onchange={(e) => updateSettings({ stderrMode: e.target.value })}>
        <option value="merge">合併到終端機（紅色）</option>
        <option value="split">分開顯示</option>
      </select>
    </label>
    <label class="opt"><input type="checkbox" checked={app.settings.clearTerminal} onchange={(e) => updateSettings({ clearTerminal: e.target.checked })} /> 執行時清空</label>
    <button onclick={() => term.reset()}>清除</button>
    {#if runningHere}
      <button onclick={() => { runner.sendEOF(); term.write('\x1b[90m^D\x1b[0m\r\n'); term.focus(); }}>送出 EOF</button>
    {/if}
  </div>
  {#if compileError}
    <div class="ce"><ErrorText text={compileError} /></div>
  {/if}
  <div class="body" class:split>
    <div class="term" bind:this={host}></div>
    {#if split}
      <div class="stderr">
        <div class="sh"><span>stderr</span>
          <span>
            <button class="link" onclick={() => navigator.clipboard?.writeText(stderrText).then(() => toast('已複製'))}>複製</button>
            <button class="link" onclick={() => (stderrText = '')}>清除</button>
          </span>
        </div>
        <pre>{stderrText}</pre>
      </div>
    {/if}
  </div>
</div>

<style>
  .wrap { height: 100%; display: flex; flex-direction: column; min-height: 0; }
  .bar { display: flex; gap: 8px; align-items: center; padding: 6px 10px; flex-wrap: wrap; }
  .opt { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); }
  .ce { margin: 0 10px 6px; padding: 6px 8px; border: 1px solid var(--danger); border-radius: 6px; max-height: 30%; overflow: auto; background: color-mix(in srgb, var(--danger) 10%, transparent); }
  .body { flex: 1; min-height: 0; display: flex; gap: 6px; padding: 0 10px 8px; }
  .body.split { flex-direction: row; }
  @media (max-width: 700px) { .body.split { flex-direction: column; } }
  .term { flex: 2; min-width: 0; min-height: 60px; border: 1px solid var(--border); border-radius: 6px; padding: 4px; background: var(--surface); }
  .stderr { flex: 1; min-width: 0; min-height: 60px; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 6px; }
  .sh { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); padding: 3px 6px; border-bottom: 1px solid var(--border); }
  .stderr pre { flex: 1; overflow: auto; margin: 0; padding: 6px; font-family: var(--mono); font-size: 12px; color: var(--danger); white-space: pre-wrap; }
  .link { border: none; background: none; color: var(--accent); padding: 0 4px; font-size: 12px; }
  .term :global(.xterm) { height: 100%; }
</style>
