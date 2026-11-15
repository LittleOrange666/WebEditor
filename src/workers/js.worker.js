// 執行 JavaScript（spec §6.2.3）：只執行目前檔案，提供同步的 readline() / readAll()
import { createIO } from '../runtime/io.js';

class ExitSignal {
  constructor(code) { this.code = code; }
}

function fmt(x) {
  if (typeof x === 'string') return x;
  if (x === undefined) return 'undefined';
  if (typeof x === 'object' && x !== null && !Array.isArray(x)) {
    try { return JSON.stringify(x); } catch { return String(x); }
  }
  return String(x);
}

function formatError(e, filename) {
  if (!(e instanceof Error)) return `Uncaught ${fmt(e)}`;
  const head = `${e.name}: ${e.message}`;
  const stack = String(e.stack || '').split('\n').filter((l) => l.includes(filename)).map((l) => l.trim()).slice(0, 6);
  return stack.length ? `${head}\n${stack.join('\n')}` : head;
}

async function run(req) {
  const io = createIO(req);
  const filename = req.path || 'main.js';
  const out = (fd) => (...a) => io.write(fd, a.map(fmt).join(' ') + '\n');
  const fakeConsole = { log: out(1), info: out(1), debug: out(1), warn: out(2), error: out(2), table: out(1), dir: out(1) };

  // 模擬 Node.js 常見的讀寫方式
  const lineHandlers = { line: [], close: [] };
  const fs = {
    readFileSync(fileOrFd, opts) {
      if (fileOrFd === 0 || fileOrFd === '/dev/stdin') {
        const s = io.readAll();
        return opts ? s : { toString: () => s };
      }
      const f = req.files?.find((x) => x.path === fileOrFd || x.path === String(fileOrFd).replace(/^\.\//, ''));
      if (f) return opts ? f.content : { toString: () => f.content };
      throw new Error(`ENOENT: no such file or directory, open '${fileOrFd}'`);
    },
  };
  const readlineModule = {
    createInterface() {
      const rl = {
        on(ev, cb) { (lineHandlers[ev] ??= []).push(cb); return rl; },
        close() {},
        question(q, cb) { io.write(1, String(q)); const l = io.readLine(); cb(l ?? ''); },
        [Symbol.asyncIterator]: async function* () { for (let l; (l = io.readLine()) !== null;) yield l; },
      };
      return rl;
    },
  };
  const proc = {
    stdout: { write: (s) => { io.write(1, String(s)); return true; } },
    stderr: { write: (s) => { io.write(2, String(s)); return true; } },
    stdin: { fd: 0 },
    argv: ['node', filename],
    env: {},
    exit: (code = 0) => { throw new ExitSignal(code); },
    hrtime: { bigint: () => BigInt(Math.round(performance.now() * 1e6)) },
  };
  const modules = { fs, readline: readlineModule, process: proc };
  const env = {
    console: fakeConsole,
    print: out(1),
    write: (...a) => io.write(1, a.map(fmt).join('')),
    readline: () => io.readLine(),
    readAll: () => io.readAll(),
    prompt: (q = '') => { io.write(1, String(q)); return io.readLine(); },
    process: proc,
    require: (name) => {
      const m = modules[String(name).replace(/^node:/, '')];
      if (!m) throw new Error(`不支援的模組：${name}`);
      return m;
    },
    exit: proc.exit,
  };

  const t0 = performance.now();
  const res = { status: 'ok', exitCode: 0 };
  try {
    const names = Object.keys(env);
    // eslint-disable-next-line no-new-func
    const fn = new Function(...names, `return (async function () {\n${req.code}\n})();\n//# sourceURL=${filename}`);
    // 用 async 包裝讓頂層 await 可以使用；同步程式碼仍會同步執行
    await fn(...names.map((k) => env[k]));
    if (lineHandlers.line.length || lineHandlers.close.length) {
      for (let l; (l = io.readLine()) !== null;) for (const cb of lineHandlers.line) await cb(l);
      for (const cb of lineHandlers.close) await cb();
    }
    await new Promise((r) => setTimeout(r, 0));
  } catch (e) {
    if (e instanceof ExitSignal) {
      res.exitCode = Number(e.code) || 0;
      if (res.exitCode !== 0) { res.status = 'error'; res.message = `程式以結束碼 ${res.exitCode} 結束`; }
    } else {
      res.status = 'error';
      res.exitCode = 1;
      res.message = formatError(e, filename);
    }
  }
  res.time = performance.now() - t0;
  io.flush();
  return res;
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'init') self.postMessage({ type: 'ready' });
  else if (msg.type === 'run') {
    self.postMessage({ type: 'started' });
    const result = await run(msg.req);
    self.postMessage({ type: 'done', result });
  }
};
