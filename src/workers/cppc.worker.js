// C++ 編譯 Worker（spec §6.2.1）：載入 WASM 版 clang 並重複使用
// 專案檔掛載到虛擬檔案系統，可 #include 專案中的標頭檔（先找目前檔案的資料夾，再找專案根目錄）
import stdcppH from '../runtime/cpp/bits/stdc++.h?raw';

let clangPromise = null;
let clangBase = null;
let resourcesPromise = null;

const SYS_DIR = '__webeditor_include__';

function loadClang() {
  if (!clangPromise) {
    clangPromise = import(/* @vite-ignore */ clangBase + 'bundle.js').catch((e) => {
      clangPromise = null;
      throw e;
    });
  }
  return clangPromise;
}

// 先自行觸發一次下載，才能回報進度（runClang 內部的 clang -### 不會傳下 fetchProgress）
function loadResources() {
  if (!resourcesPromise) {
    resourcesPromise = (async () => {
      const { runClang } = await loadClang();
      let lastPct = -1;
      await runClang(null, {}, {
        fetchProgress: ({ doneLength, totalLength }) => {
          const pct = totalLength ? Math.floor((doneLength / totalLength) * 100) : 0;
          if (pct !== lastPct) {
            lastPct = pct;
            self.postMessage({ type: 'progress', done: doneLength, total: totalLength });
          }
        },
      });
    })().catch((e) => {
      resourcesPromise = null;
      throw e;
    });
  }
  return resourcesPromise;
}

function concat(chunks) {
  const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** [{ path, content }] → runClang 使用的巢狀物件 */
function toTree(files) {
  const root = { [SYS_DIR]: { bits: { 'stdc++.h': stdcppH } } };
  for (const f of files) {
    const parts = f.path.split('/');
    let dir = root;
    for (const seg of parts.slice(0, -1)) {
      if (typeof dir[seg] !== 'object' || dir[seg] instanceof Uint8Array) dir[seg] = {};
      dir = dir[seg];
    }
    dir[parts[parts.length - 1]] = f.content;
  }
  return root;
}

async function compile({ path, files, compileFlags, linkFlags }) {
  const { runClang } = await loadClang();
  await loadResources();
  self.postMessage({ type: 'compiling' });
  const dec = new TextDecoder();
  let stderr = '';
  const onErr = (b) => { if (b) stderr += dec.decode(b, { stream: true }); };
  const chunks = [];
  try {
    await runClang(
      ['clang++', ...compileFlags, '-fdiagnostics-color=never', '-I.', '-isystem', SYS_DIR, '-c', path, '-o', '-'],
      toTree(files),
      { stdout: (b) => { if (b) chunks.push(b.slice()); }, stderr: onErr },
    );
  } catch (e) {
    if (e?.code === undefined && !stderr) throw e;
    return { ok: false, error: stderr.trim() || e.message };
  }
  const warnings = stderr.trim();
  stderr = '';
  try {
    const out = await runClang(['clang++', ...linkFlags, 'main.o', '-o', 'a.wasm'], { 'main.o': concat(chunks) }, { stderr: onErr });
    return { ok: true, wasm: out['a.wasm'], warnings };
  } catch (e) {
    return { ok: false, error: stderr.trim() || e.message };
  }
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    clangBase = msg.clangBase;
    try {
      await loadClang();
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'init-error', error: String(err?.message || err) });
    }
  } else if (msg.type === 'compile') {
    let result;
    try {
      result = await compile(msg.req);
    } catch (err) {
      result = { ok: false, error: `編譯器執行失敗：${err?.message || err}`, internal: true };
    }
    self.postMessage({ type: 'result', id: msg.id, result }, result.wasm ? [result.wasm.buffer] : []);
  }
};
