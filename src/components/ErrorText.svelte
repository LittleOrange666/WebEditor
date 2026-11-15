<script>
  // 顯示錯誤訊息，其中的「檔名:行:列」或 Python 的 File "x.py", line N 可點擊跳到該位置
  import { gotoLocation } from '../lib/runState.svelte.js';

  let { text = '', cls = '' } = $props();

  const RE = /((?:[\w.\-一-鿿]+\/)*[\w.\-一-鿿]+\.(?:cpp|cc|cxx|h|hpp|py|js)):(\d+)(?::(\d+))?|File "([^"]+)", line (\d+)/g;

  let parts = $derived.by(() => {
    const out = [];
    let last = 0;
    for (const m of text.matchAll(RE)) {
      if (m.index > last) out.push({ t: text.slice(last, m.index) });
      if (m[1]) out.push({ t: m[0], path: m[1], line: +m[2], col: m[3] ? +m[3] : 1 });
      else out.push({ t: m[0], path: m[4], line: +m[5], col: 1 });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ t: text.slice(last) });
    return out;
  });
</script>

<pre class="err {cls}">{#each parts as p}{#if p.path}<button class="loc" onclick={() => gotoLocation(p.path, p.line, p.col)}>{p.t}</button>{:else}{p.t}{/if}{/each}</pre>

<style>
  .err { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: var(--mono); font-size: 12px; }
  .loc { border: none; background: none; padding: 0; font: inherit; color: var(--accent); text-decoration: underline; cursor: pointer; }
</style>
