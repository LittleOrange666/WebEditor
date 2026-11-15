// 管理執行使用者程式的 Web Worker：編譯快取、串流輸出、逾時、停止、終端機輸入（spec §6）
import { CPP_COMPILE_FLAGS, CPP_LINK_FLAGS, CPP_COMPILE_TIMEOUT_MS, CLANG_VERSION, MAX_OUTPUT_BYTES, resolveClangBase } from './config.js';
import { cacheKey, getCached, putCached } from './compileCache.js';
import { langOf } from './paths.js';

export const INTERACTIVE_SUPPORTED = typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true;

const STDIN_CAP = 64 * 1024;

function createWorker(kind) {
  switch (kind) {
    case 'py': return new Worker(new URL('../workers/py.worker.js', import.meta.url), { type: 'module' });
    case 'cppc': return new Worker(new URL('../workers/cppc.worker.js', import.meta.url), { type: 'module' });
    case 'cppx': return new Worker(new URL('../workers/cppx.worker.js', import.meta.url), { type: 'module' });
    default: return new Worker(new URL('../workers/js.worker.js', import.meta.url), { type: 'module' });
  }
}

/** 編譯時需要的檔案：原始檔與可能被 include 的檔案（排除其他程式檔與常見資料檔） */
function compileInputs(path, files) {
  return files.filter((f) => f.path === path || (!langOf(f.path) && !/\.(in|out|ans|txt|md|json|csv)$/i.test(f.path)) || langOf(f.path) === 'h');
}

export class Runner {
  /** onStatus({ kind, pct?, file? })：kind 為 idle / loading-python / loading-cpp / preparing-cpp / compiling / running */
  constructor({ onStatus } = {}) {
    this.entries = {};
    this.onStatus = onStatus ?? (() => {});
    this.cppCache = new Map();
    this.compileReqs = new Map();
    this.nextId = 1;
    this.active = null; // 目前執行中的程式
    this.clangSource = 'cdn';
  }

  // ---------- Worker 管理 ----------

  _entry(kind) {
    if (this.entries[kind]) return this.entries[kind];
    const w = createWorker(kind);
    const entry = { w, kind, isReady: false, sentKeys: new Set(), handler: null };
    entry.ready = new Promise((resolve, reject) => { entry.resolveReady = resolve; entry.rejectReady = reject; });
    entry.ready.catch(() => {});
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') entry.resolveReady();
      else if (m.type === 'init-error') { entry.rejectReady(new Error(m.error)); this._drop(entry); }
      else if (m.type === 'progress') {
        if (m.done >= m.total) this.onStatus({ kind: 'preparing-cpp' });
        else this.onStatus({ kind: 'loading-cpp', pct: m.total ? Math.floor((m.done / m.total) * 100) : 0 });
      } else if (m.type === 'compiling') this.onStatus({ kind: 'compiling', file: this.compilingFile });
      else if (m.type === 'result') {
        const p = this.compileReqs.get(m.id);
        if (p) { this.compileReqs.delete(m.id); p.resolve(m.result); }
      } else entry.handler?.(m);
    };
    w.onerror = (e) => {
      e.preventDefault?.();
      const message = e.message || 'Worker 發生錯誤';
      entry.rejectReady(new Error(message));
      entry.handler?.({ type: 'crash', message });
      for (const [id, p] of this.compileReqs) {
        if (p.entry === entry) { this.compileReqs.delete(id); p.resolve({ ok: false, error: `編譯器發生錯誤：${message}`, internal: true }); }
      }
      this._drop(entry);
    };
    w.postMessage(kind === 'cppc' ? { type: 'init', clangBase: resolveClangBase(document.baseURI, this.clangSource) } : { type: 'init' });
    this.entries[kind] = entry;
    return entry;
  }

  _drop(entry) {
    if (this.entries[entry.kind] === entry) this.entries[entry.kind] = null;
    entry.w.terminate();
  }

  async _ready(kind) {
    const entry = this._entry(kind);
    if (entry.isReady) return entry;
    if (kind === 'py') this.onStatus({ kind: 'loading-python' });
    if (kind === 'cppc') this.onStatus({ kind: 'loading-cpp', pct: 0 });
    try {
      await entry.ready;
      entry.isReady = true;
    } finally {
      if (kind === 'py' || kind === 'cppc') this.onStatus({ kind: 'idle' });
    }
    return entry;
  }

  setClangSource(src) {
    if (src === this.clangSource) return;
    this.clangSource = src;
    if (this.entries.cppc) this._drop(this.entries.cppc);
  }

  // ---------- C++ 編譯（spec §6.2.1） ----------

  /** 回傳 { ok, key, wasm, warnings } 或 { ok: false, error, stopped? } */
  compileCpp(path, files) {
    const inputs = compileInputs(path, files).map((f) => ({ path: f.path, content: f.content }));
    inputs.sort((a, b) => a.path.localeCompare(b.path));
    const text = [CLANG_VERSION, CPP_COMPILE_FLAGS.join(' '), CPP_LINK_FLAGS.join(' '), path,
      ...inputs.map((f) => `${f.path}\u0000${f.content}`)].join('\u0001');
    if (!this.cppCache.has(text)) {
      const p = (async () => {
        const key = await cacheKey(text);
        const cached = await getCached(key);
        if (cached) return { ok: true, key, wasm: cached, fromCache: true };
        const r = await this._compile(path, inputs);
        if (!r.ok) return r;
        putCached(key, r.wasm);
        return { ...r, key };
      })().then((r) => {
        if (r.stopped || r.internal) this.cppCache.delete(text);
        return r;
      });
      // 記憶體快取只保留最近幾個
      if (this.cppCache.size > 20) this.cppCache.delete(this.cppCache.keys().next().value);
      this.cppCache.set(text, p);
    }
    return this.cppCache.get(text);
  }

  async _compile(path, files) {
    let entry;
    try {
      entry = await this._ready('cppc');
    } catch (e) {
      if (e.stopped) return { ok: false, error: '已停止', stopped: true, internal: true };
      return { ok: false, error: `C++ 編譯器載入失敗：${e.message}`, internal: true };
    }
    this.compilingFile = path;
    const id = this.nextId++;
    try {
      return await new Promise((resolve) => {
        const timer = setTimeout(() => {
          this.compileReqs.delete(id);
          this._drop(entry);
          resolve({ ok: false, error: `編譯超過 ${CPP_COMPILE_TIMEOUT_MS / 1000} 秒`, internal: true });
        }, CPP_COMPILE_TIMEOUT_MS);
        this.compileReqs.set(id, { entry, resolve: (r) => { clearTimeout(timer); resolve(r); } });
        entry.w.postMessage({ type: 'compile', id, req: { path, files, compileFlags: CPP_COMPILE_FLAGS, linkFlags: CPP_LINK_FLAGS } });
      });
    } finally {
      this.onStatus({ kind: 'idle' });
    }
  }

  // ---------- 執行 ----------

  /**
   * opts：{ path, files: [{ path, content }], stdin, interactive, timeLimitMs, onOutput(chunks), onStdinWait(), onStarted() }
   * 回傳 { status: 'ok' | 'error' | 'tle' | 'stopped' | 'ce' | 'ole', exitCode?, message?, time?, warnings? }
   */
  async run(opts) {
    if (this.active) throw new Error('已有程式在執行中');
    const lang = langOf(opts.path);
    const token = { stopped: false };
    this.active = { token, resolve: null, entry: null };
    try {
      let kind = lang;
      let wasm = null;
      let key = null;
      let warnings = '';
      if (lang === 'cpp') {
        const c = await this.compileCpp(opts.path, opts.files);
        if (token.stopped) return { status: 'stopped' };
        if (!c.ok) return c.stopped ? { status: 'stopped' } : { status: 'ce', message: c.error, internal: c.internal };
        kind = 'cppx';
        key = c.key;
        wasm = c.wasm;
        warnings = c.warnings || '';
      }
      let entry;
      try {
        entry = await this._ready(kind);
      } catch (e) {
        if (token.stopped || e.stopped) return { status: 'stopped' };
        return { status: 'error', message: `執行環境載入失敗：${e.message}` };
      }
      if (token.stopped) return { status: 'stopped' };
      const res = await this._exec(entry, opts, token, key, wasm);
      if (res.missingModule) return this._exec(entry, opts, token, key, wasm, true);
      if (warnings) res.warnings = warnings;
      return res;
    } finally {
      this.active = null;
      this.onStatus({ kind: 'idle' });
    }
  }

  _exec(entry, opts, token, key, wasm, forceWasm = false) {
    return new Promise((resolve) => {
      const req = {
        path: opts.path,
        code: opts.files.find((f) => f.path === opts.path)?.content ?? '',
        files: opts.files,
        stdin: opts.interactive ? null : (opts.stdin ?? ''),
        interactive: !!opts.interactive,
        outputLimit: MAX_OUTPUT_BYTES,
      };
      if (entry.kind === 'cppx') {
        req.key = key;
        if (forceWasm || !entry.sentKeys.has(key)) { req.wasm = wasm; entry.sentKeys.add(key); }
      }
      let stdinState = null;
      if (opts.interactive) {
        const sab = { ctrl: new SharedArrayBuffer(8), data: new SharedArrayBuffer(STDIN_CAP) };
        req.sab = sab;
        stdinState = { ctrl: new Int32Array(sab.ctrl), data: new Uint8Array(sab.data), queue: [], eof: false, waiting: false };
      }
      let timer = null;
      let total = 0;
      let t0 = 0;
      const finish = (r) => {
        clearTimeout(timer);
        entry.handler = null;
        this.active.stdin = null;
        this.active.resolve = null;
        resolve(r);
      };
      this.active.entry = entry;
      this.active.stdin = stdinState;
      this.active.resolve = (r) => { this._drop(entry); finish(r); };
      entry.handler = (m) => {
        if (m.type === 'started') {
          t0 = performance.now();
          this.onStatus({ kind: 'running' });
          opts.onStarted?.();
          if (opts.timeLimitMs) {
            timer = setTimeout(() => {
              this._drop(entry);
              finish({ status: 'tle', time: opts.timeLimitMs, message: `執行超過 ${opts.timeLimitMs / 1000} 秒` });
            }, opts.timeLimitMs);
          }
        } else if (m.type === 'out') {
          for (const c of m.chunks) total += c[1].length;
          opts.onOutput?.(m.chunks);
        } else if (m.type === 'output-limit') {
          this._drop(entry);
          finish({ status: 'ole', time: performance.now() - t0, message: `輸出超過 ${MAX_OUTPUT_BYTES / 1024 / 1024} MB，已強制停止` });
        } else if (m.type === 'stdin-wait') {
          if (stdinState) { stdinState.waiting = true; this._deliver(); }
          opts.onStdinWait?.();
        } else if (m.type === 'done') {
          const r = m.result;
          if (r.missingModule) { entry.sentKeys.delete(key); finish(r); return; }
          if (r.fatal) this._drop(entry);
          finish({ ...r, time: r.time ?? performance.now() - t0 });
        } else if (m.type === 'crash') {
          finish({ status: 'error', message: `程式當掉：${m.message}`, time: performance.now() - t0 });
        }
      };
      if (token.stopped) { finish({ status: 'stopped' }); return; }
      entry.w.postMessage({ type: 'run', req });
    });
  }

  /** 終端機模式：把資料交給正在等待輸入的程式 */
  _deliver() {
    const s = this.active?.stdin;
    if (!s || !s.waiting) return;
    if (s.queue.length) {
      let chunk = s.queue[0];
      if (chunk.length > STDIN_CAP) { s.queue[0] = chunk.subarray(STDIN_CAP); chunk = chunk.subarray(0, STDIN_CAP); }
      else s.queue.shift();
      s.data.set(chunk);
      s.ctrl[1] = chunk.length;
      s.waiting = false;
      Atomics.store(s.ctrl, 0, 1);
      Atomics.notify(s.ctrl, 0);
    } else if (s.eof) {
      s.waiting = false;
      Atomics.store(s.ctrl, 0, 2);
      Atomics.notify(s.ctrl, 0);
    }
  }

  sendInput(text) {
    const s = this.active?.stdin;
    if (!s) return;
    s.queue.push(new TextEncoder().encode(text));
    this._deliver();
  }

  sendEOF() {
    const s = this.active?.stdin;
    if (!s) return;
    s.eof = true;
    this._deliver();
  }

  get running() { return !!this.active; }

  /** 停止目前的程式（含編譯中） */
  stop() {
    const a = this.active;
    if (a) {
      a.token.stopped = true;
      if (a.resolve) a.resolve({ status: 'stopped' });
    }
    // 編譯或載入中：終止對應的 Worker
    for (const kind of ['cppc', 'py']) {
      const e = this.entries[kind];
      if (e && (!e.isReady || (kind === 'cppc' && this.compileReqs.size))) {
        const err = new Error('已停止');
        err.stopped = true;
        e.rejectReady(err);
        for (const [id, p] of this.compileReqs) {
          if (p.entry === e) { this.compileReqs.delete(id); p.resolve({ ok: false, error: '已停止', stopped: true }); }
        }
        this._drop(e);
      }
    }
    this.onStatus({ kind: 'idle' });
  }
}

export const runner = new Runner();
