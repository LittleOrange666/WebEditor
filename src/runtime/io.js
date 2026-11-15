// Worker 端的標準輸入輸出（spec §6.2.4、§6.4）
// - 輸出：累積後分批送回主執行緒（量大或超過 30ms 時送出），保留 stdout/stderr 的先後順序
// - 輸入：測資模式一次給完；終端機模式以 SharedArrayBuffer + Atomics.wait 同步等待使用者輸入
//
// SharedArrayBuffer 協定（ctrl 為 Int32Array(2)）：
//   ctrl[0]：0 = 等待中、1 = 有資料（長度在 ctrl[1]，內容在 data）、2 = EOF
//   Worker 送出 { type: 'stdin-wait' } 後 Atomics.wait(ctrl, 0, 0)；主執行緒寫入後 Atomics.notify

const FLUSH_BYTES = 32 * 1024;
const FLUSH_MS = 30;

export function createIO({ stdin = '', interactive = false, sab = null, outputLimit = Infinity }) {
  const enc = new TextEncoder();
  const decoders = { 1: new TextDecoder(), 2: new TextDecoder() };
  let chunks = [];
  let pendingBytes = 0;
  let total = 0;
  let lastFlush = performance.now();
  let overLimit = false;

  function flush() {
    if (chunks.length) {
      self.postMessage({ type: 'out', chunks });
      chunks = [];
      pendingBytes = 0;
    }
    lastFlush = performance.now();
  }

  /** 寫入輸出；data 為字串或 Uint8Array */
  function write(fd, data) {
    if (overLimit) return;
    const isText = typeof data === 'string';
    const size = isText ? data.length : data.byteLength;
    if (!size) return;
    total += size;
    if (total > outputLimit) {
      overLimit = true;
      flush();
      self.postMessage({ type: 'output-limit' });
      return;
    }
    const text = isText ? data : decoders[fd].decode(data, { stream: true });
    const last = chunks[chunks.length - 1];
    if (last && last[0] === fd) last[1] += text;
    else chunks.push([fd, text]);
    pendingBytes += size;
    if (pendingBytes >= FLUSH_BYTES || performance.now() - lastFlush >= FLUSH_MS) flush();
  }

  // ----- 輸入 -----
  let batchBytes = interactive ? null : enc.encode(stdin ?? '');
  let batchPos = 0;
  let eof = false;
  let carry = null; // 終端機模式中上一次讀取多出來的資料
  const ctrl = sab ? new Int32Array(sab.ctrl) : null;
  const data = sab ? new Uint8Array(sab.data) : null;

  /** 讀取最多 max 個位元組；回傳空陣列表示 EOF */
  function read(max) {
    if (!interactive) {
      const n = Math.min(max, batchBytes.length - batchPos);
      const out = batchBytes.subarray(batchPos, batchPos + n);
      batchPos += n;
      return out;
    }
    if (carry) {
      const out = carry.subarray(0, max);
      carry = carry.length > max ? carry.subarray(max) : null;
      return out;
    }
    if (eof || !ctrl) return new Uint8Array(0);
    flush();
    self.postMessage({ type: 'stdin-wait' });
    Atomics.wait(ctrl, 0, 0);
    const state = Atomics.load(ctrl, 0);
    let got = new Uint8Array(0);
    if (state === 1) got = data.slice(0, ctrl[1]);
    else eof = true;
    Atomics.store(ctrl, 0, 0);
    if (got.length > max) {
      carry = got.subarray(max);
      got = got.subarray(0, max);
    }
    return got;
  }

  /** 讀取一行（不含換行），EOF 時回傳 null；給 JavaScript 的 readline() 使用 */
  const lineDec = new TextDecoder();
  let lineBuf = '';
  let lineEof = false;
  function readLine() {
    for (;;) {
      const i = lineBuf.indexOf('\n');
      if (i >= 0) {
        let line = lineBuf.slice(0, i);
        lineBuf = lineBuf.slice(i + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        return line;
      }
      if (lineEof) {
        if (!lineBuf) return null;
        const line = lineBuf;
        lineBuf = '';
        return line;
      }
      const chunk = read(65536);
      if (!chunk.length) lineEof = true;
      else lineBuf += lineDec.decode(chunk, { stream: true });
    }
  }

  function readAll() {
    let s = lineBuf;
    lineBuf = '';
    if (!lineEof) {
      for (;;) {
        const chunk = read(1 << 20);
        if (!chunk.length) break;
        s += lineDec.decode(chunk, { stream: true });
      }
      lineEof = true;
    }
    return s;
  }

  return { write, flush, read, readLine, readAll, get overLimit() { return overLimit; } };
}

export function describeError(e) {
  return String(e?.message || e);
}
