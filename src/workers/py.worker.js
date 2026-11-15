// 執行 Python（spec §6.2.2）：Pyodide 在 Worker 內載入一次並重複使用
import bootstrapPy from '../runtime/bootstrap.py?raw';
import { PYODIDE_BASE } from '../lib/config.js';
import { createIO } from '../runtime/io.js';

let pyodidePromise = null;
let io = null; // 目前這次執行的輸入輸出

function loadPy() {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      const { loadPyodide } = await import(/* @vite-ignore */ PYODIDE_BASE + 'pyodide.mjs');
      const py = await loadPyodide({ indexURL: PYODIDE_BASE });
      py.registerJsModule('_wed', {
        read: (n) => io.read(n),
        write: (fd, text) => io.write(fd, text),
      });
      py.runPython(bootstrapPy);
      return py;
    })();
  }
  return pyodidePromise;
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      await loadPy();
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'init-error', error: String(err?.message || err) });
    }
  } else if (msg.type === 'run') {
    const py = await loadPy();
    const req = msg.req;
    io = createIO(req);
    self.postMessage({ type: 'started' });
    const t0 = performance.now();
    let result;
    try {
      const fn = py.globals.get('_wed_run');
      const files = py.toPy(req.files);
      const ret = fn(req.path, files, !!req.interactive);
      const [code, message] = ret.toJs();
      ret.destroy?.();
      files.destroy?.();
      fn.destroy?.();
      result = { status: code === 0 && !message ? 'ok' : 'error', exitCode: code, message: message || (code ? `程式以結束碼 ${code} 結束` : '') };
    } catch (err) {
      // Pyodide 本身當掉（例如 JS 堆疊溢位），需要重建 Worker
      result = { status: 'error', exitCode: 1, message: `Python 執行環境錯誤：${err?.message || err}`, fatal: true };
    }
    result.time = performance.now() - t0;
    io.flush();
    self.postMessage({ type: 'done', result });
  }
};
