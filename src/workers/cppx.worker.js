// 執行編譯好的 C++（WASI）程式（spec §6.2.1）
import { WASI, File, Directory, PreopenDirectory, Fd, wasi as W } from '@bjorn3/browser_wasi_shim';
import { createIO } from '../runtime/io.js';

const moduleCache = new Map();
const enc = new TextEncoder();

/** stdout / stderr：寫入時串流回主執行緒；終端機模式回報為字元裝置，讓 libc 逐行送出 */
class OutFd extends Fd {
  constructor(io, fd, tty) { super(); this.io = io; this.fd = fd; this.tty = tty; }
  fd_write(data) { this.io.write(this.fd, data); return { ret: 0, nwritten: data.byteLength }; }
  fd_fdstat_get() {
    const st = new W.Fdstat(this.tty ? W.FILETYPE_CHARACTER_DEVICE : W.FILETYPE_REGULAR_FILE, 0);
    st.fs_rights_base = BigInt(W.RIGHTS_FD_WRITE);
    return { ret: 0, fdstat: st };
  }
  fd_filestat_get() { return { ret: 0, filestat: new W.Filestat(0n, W.FILETYPE_CHARACTER_DEVICE, 0n) }; }
  fd_seek() { return { ret: W.ERRNO_SPIPE, offset: 0n }; }
  fd_tell() { return { ret: W.ERRNO_SPIPE, offset: 0n }; }
}

class InFd extends Fd {
  constructor(io, tty) { super(); this.io = io; this.tty = tty; }
  fd_read(size) { return { ret: 0, data: this.io.read(size) }; }
  fd_fdstat_get() {
    const st = new W.Fdstat(this.tty ? W.FILETYPE_CHARACTER_DEVICE : W.FILETYPE_REGULAR_FILE, 0);
    st.fs_rights_base = BigInt(W.RIGHTS_FD_READ);
    return { ret: 0, fdstat: st };
  }
  fd_filestat_get() { return { ret: 0, filestat: new W.Filestat(0n, W.FILETYPE_CHARACTER_DEVICE, 0n) }; }
  fd_seek() { return { ret: W.ERRNO_SPIPE, offset: 0n }; }
  fd_tell() { return { ret: W.ERRNO_SPIPE, offset: 0n }; }
}

/** 把專案檔（以 baseDir 為根）建成 WASI 目錄樹，讓程式能以相對路徑讀取 */
function buildTree(files, baseDir) {
  const root = new Map();
  const prefix = baseDir ? baseDir + '/' : '';
  for (const f of files) {
    if (prefix && !f.path.startsWith(prefix)) continue;
    const parts = f.path.slice(prefix.length).split('/');
    let dir = root;
    for (const seg of parts.slice(0, -1)) {
      let d = dir.get(seg);
      if (!(d instanceof Directory)) { d = new Directory(new Map()); dir.set(seg, d); }
      dir = d.contents;
    }
    dir.set(parts[parts.length - 1], new File(enc.encode(f.content)));
  }
  return root;
}

function describeTrap(e) {
  const msg = String(e?.message || e);
  if (/call stack|stack overflow|too much recursion/i.test(msg)) {
    return `程式當掉：${msg}\n可能是遞迴太深（瀏覽器中約只能遞迴 5,000 層），在評測機上可能正常。`;
  }
  if (/unreachable/i.test(msg)) return `程式當掉（runtime error）：${msg}\n可能是 abort()、assert 失敗、或使用了 C++ 例外。`;
  return `程式當掉（runtime error）：${msg}`;
}

async function run(req) {
  let mod = moduleCache.get(req.key);
  if (!mod) {
    if (!req.wasm) return { status: 'error', missingModule: true, message: '缺少程式' };
    mod = await WebAssembly.compile(req.wasm);
    moduleCache.clear(); // 只保留最近一個，避免占用太多記憶體
    moduleCache.set(req.key, mod);
  }
  const io = createIO(req);
  const tty = !!req.interactive;
  const dir = req.path.includes('/') ? req.path.slice(0, req.path.lastIndexOf('/')) : '';
  const fds = [new InFd(io, tty), new OutFd(io, 1, tty), new OutFd(io, 2, tty), new PreopenDirectory('/', buildTree(req.files ?? [], dir))];
  const wasi = new WASI([req.path.split('/').pop()], [], fds);
  self.postMessage({ type: 'started' });
  const t0 = performance.now();
  let code = 0;
  let trap = null;
  try {
    const inst = await WebAssembly.instantiate(mod, { wasi_snapshot_preview1: wasi.wasiImport });
    code = wasi.start(inst);
  } catch (e) {
    trap = e;
  }
  const time = performance.now() - t0;
  io.flush();
  if (trap) return { status: 'error', exitCode: 134, message: describeTrap(trap), time };
  if (code !== 0) return { status: 'error', exitCode: code, message: `程式以結束碼 ${code} 結束`, time };
  return { status: 'ok', exitCode: 0, time };
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'init') self.postMessage({ type: 'ready' });
  else if (msg.type === 'run') {
    let result;
    try {
      result = await run(msg.req);
    } catch (err) {
      result = { status: 'error', exitCode: 1, message: String(err?.message || err) };
    }
    self.postMessage({ type: 'done', result });
  }
};
