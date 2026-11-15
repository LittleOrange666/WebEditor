// 批次上傳測資時依檔名配對輸入與預期輸出（spec §6.3.1）

function classify(path) {
  const name = path.split('/').pop();
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot > 0 ? lower.slice(dot + 1) : '';
  const stemRaw = dot > 0 ? name.slice(0, dot) : name;
  if (ext === 'in') return { kind: 'in', key: stemRaw };
  if (ext === 'out' || ext === 'ans' || ext === 'ok') return { kind: 'out', key: stemRaw };
  // input1.txt / output1.txt、1_in.txt / 1_out.txt、sample.in.txt
  const m = stemRaw.match(/^(.*?)[._-]?(input|output|in|out|ans|answer)[._-]?(.*)$/i);
  if (m) {
    const kind = /^(in|input)$/i.test(m[2]) ? 'in' : 'out';
    return { kind, key: `${m[1]}${m[3] ? '#' + m[3] : ''}` || '#' };
  }
  return { kind: 'in', key: stemRaw };
}

/** items：[{ path, content }] → [{ name, input, expected }]，依名稱自然排序 */
export function pairTestFiles(items) {
  const map = new Map();
  for (const it of items) {
    if (typeof it.content !== 'string') continue;
    const { kind, key } = classify(it.path);
    if (!map.has(key)) map.set(key, { name: key.replace(/^#/, '') || '測資', input: null, expected: '' });
    const rec = map.get(key);
    if (kind === 'in') rec.input = it.content;
    else rec.expected = it.content;
  }
  return [...map.values()]
    .filter((r) => r.input !== null)
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
}
