// 輸出比對（spec §6.3.3）

/** 忽略空白差異：逐 token 比對 */
export function compareTokens(out, exp) {
  const a = out.split(/\s+/).filter(Boolean);
  const b = exp.split(/\s+/).filter(Boolean);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return { ok: false, detail: `第 ${i + 1} 個 token 不同：預期「${clip(b[i])}」，得到「${clip(a[i])}」` };
  }
  if (a.length !== b.length) {
    return { ok: false, detail: a.length < b.length ? `輸出太短：少了 ${b.length - a.length} 個 token（預期 ${b.length} 個）` : `輸出太長：多了 ${a.length - b.length} 個 token（預期 ${b.length} 個）` };
  }
  return { ok: true };
}

/** 完全相同（只把 \r\n 視為 \n） */
export function compareExact(out, exp) {
  const a = out.replace(/\r\n/g, '\n');
  const b = exp.replace(/\r\n/g, '\n');
  if (a === b) return { ok: true };
  const al = a.split('\n');
  const bl = b.split('\n');
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] !== bl[i]) {
      return { ok: false, detail: `第 ${i + 1} 行不同：預期「${clip(bl[i] ?? '（沒有這一行）')}」，得到「${clip(al[i] ?? '（沒有這一行）')}」` };
    }
  }
  return { ok: false, detail: '內容不同' };
}

export function compare(mode, out, exp) {
  return mode === 'exact' ? compareExact(out, exp) : compareTokens(out, exp);
}

/** 找出第一個不同的行號（1 起算），用於差異標示 */
export function firstDiffLine(out, exp, mode) {
  const norm = (s) => s.replace(/\r\n/g, '\n').split('\n').map((l) => (mode === 'exact' ? l : l.replace(/\s+$/, '')));
  const a = norm(out);
  const b = norm(exp);
  if (mode !== 'exact') {
    while (a.length && a[a.length - 1] === '') a.pop();
    while (b.length && b[b.length - 1] === '') b.pop();
  }
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i + 1;
  return 0;
}

function clip(s, n = 40) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
