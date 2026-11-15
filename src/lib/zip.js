// 上傳／下載 zip 與檔案（spec §3.4、§6.3.4）
import JSZip from 'jszip';
import { isJunkPath, decodeText, normalizePath, basename, dirname, sanitizeFileName } from './paths.js';

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadText(text, filename) {
  downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), filename);
}

export function downloadFileEntry(f) {
  if (f.binary) downloadBlob(new Blob([f.binary]), basename(f.path));
  else downloadText(f.content ?? '', basename(f.path));
}

/** 讀取本機檔案為 { content } 或 { binary } */
export async function readLocalFile(file) {
  const buf = await file.arrayBuffer();
  const text = decodeText(new Uint8Array(buf));
  return text === null ? { binary: buf } : { content: text };
}

/**
 * 解開 zip：回傳 { files: [{ path, content? , binary? }], dirs: [path], meta }
 * meta 為 .webeditor/ 中的專案資料（project.json 與測資），沒有則為 null
 * 若 zip 只有一個頂層資料夾，自動去掉這一層（stripRoot 會回傳該資料夾名稱）
 */
export async function readZip(blob) {
  const zip = await JSZip.loadAsync(blob);
  const entries = [];
  zip.forEach((rel, entry) => { if (!isJunkPath(rel)) entries.push(entry); });
  // 去掉共同的頂層資料夾（例如 GitHub 下載的 repo-main/），但 .webeditor 在頂層時不去
  let root = null;
  const tops = new Set(entries.map((e) => e.name.split('/')[0]));
  if (tops.size === 1) {
    const only = [...tops][0];
    if (only !== '.webeditor' && entries.some((e) => e.name.startsWith(only + '/'))) root = only;
  }
  const strip = (name) => (root ? name.slice(root.length + 1) : name);

  const files = [];
  const dirs = [];
  const metaFiles = {};
  for (const e of entries) {
    const name = strip(e.name);
    if (!name) continue;
    if (name.startsWith('.webeditor/')) {
      if (!e.dir) metaFiles[name.slice('.webeditor/'.length)] = await e.async('string');
      continue;
    }
    const path = normalizePath(name);
    if (!path) continue;
    if (e.dir) { dirs.push(path); continue; }
    const bytes = await e.async('uint8array');
    const text = decodeText(bytes);
    files.push(text === null ? { path, binary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } : { path, content: text });
  }
  return { files, dirs, meta: parseMeta(metaFiles), root };
}

/** 從 .webeditor/ 的內容還原測資：{ project, tests: { [path]: { cases, timeLimit, compare } } } */
function parseMeta(metaFiles) {
  if (!Object.keys(metaFiles).length) return null;
  let project = {};
  try { project = JSON.parse(metaFiles['project.json'] || '{}'); } catch { /* 略過 */ }
  const tests = {};
  for (const [name, text] of Object.entries(metaFiles)) {
    const m = name.match(/^tests\/(.+)\/tests\.json$/);
    if (!m) continue;
    const path = m[1];
    let info = {};
    try { info = JSON.parse(text); } catch { continue; }
    const cases = (info.cases ?? []).map((c) => ({
      name: c.name,
      enabled: c.enabled,
      input: metaFiles[`tests/${path}/${c.file}.in`] ?? '',
      expected: metaFiles[`tests/${path}/${c.file}.out`] ?? '',
    }));
    const opt = project.files?.[path] ?? {};
    tests[path] = { cases, timeLimit: opt.timeLimit ?? null, compare: opt.compare ?? 'tokens' };
  }
  return { project, tests };
}

/**
 * 建立 zip。entries：專案項目（含資料夾）；prefix：只打包此資料夾（下載資料夾時）
 * tests：{ fileId: record }，有提供時寫入 .webeditor/
 */
export async function buildZip(entries, { prefix = '', tests = null, projectName = '' } = {}) {
  const zip = new JSZip();
  addProject(zip, entries, { prefix, tests, projectName });
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/**
 * 多個專案打包成一個 zip（spec_new §4.6）：每個專案一個資料夾，格式與單一專案相同
 * projects：[{ name, entries, tests }]
 */
export async function buildMultiZip(projects) {
  const zip = new JSZip();
  const used = new Set();
  for (const p of projects) {
    const base = sanitizeFileName(p.name || '') || 'project';
    let folder = base;
    for (let i = 1; used.has(folder.toLowerCase()); i++) folder = `${base} (${i})`;
    used.add(folder.toLowerCase());
    addProject(zip.folder(folder), p.entries, { tests: p.tests ?? {}, projectName: p.name });
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/**
 * 若 zip 是「多個專案」的格式（每個頂層資料夾都有 .webeditor/project.json），回傳 [{ name, files, dirs, meta }]；否則回傳 null
 */
export async function readMultiZip(blob) {
  const zip = await JSZip.loadAsync(blob);
  const tops = new Set();
  zip.forEach((rel) => { if (!isJunkPath(rel)) tops.add(rel.split('/')[0]); });
  if (tops.size < 2) return null;
  for (const t of tops) if (!zip.file(`${t}/.webeditor/project.json`)) return null;
  const out = [];
  for (const t of [...tops].sort()) {
    const sub = new JSZip();
    const jobs = [];
    zip.folder(t).forEach((rel, entry) => {
      if (entry.dir) sub.folder(rel);
      else jobs.push(entry.async('uint8array').then((data) => sub.file(rel, data)));
    });
    await Promise.all(jobs);
    const data = await readZip(await sub.generateAsync({ type: 'blob' }));
    out.push({ name: data.meta?.project?.name || t, ...data });
  }
  return out;
}

function addProject(zip, entries, { prefix = '', tests = null, projectName = '' } = {}) {
  const base = prefix ? prefix + '/' : '';
  for (const f of entries) {
    if (prefix && f.path !== prefix && !f.path.startsWith(base)) continue;
    const rel = f.path.slice(base.length);
    if (!rel) continue;
    if (f.kind === 'dir') zip.folder(rel);
    else zip.file(rel, f.binary ?? f.content ?? '');
  }
  if (tests) {
    const project = { format: 'webeditor', version: 1, name: projectName, files: {} };
    for (const t of Object.values(tests)) {
      const f = entries.find((e) => e.id === t.fileId);
      if (!f || !t.cases?.length && !t.timeLimit && t.compare === 'tokens') continue;
      project.files[f.path] = { timeLimit: t.timeLimit, compare: t.compare };
      const dir = `.webeditor/tests/${f.path}`;
      zip.file(`${dir}/tests.json`, JSON.stringify({
        cases: t.cases.map((c, i) => ({ name: c.name, enabled: c.enabled, file: String(i + 1) })),
      }, null, 2));
      t.cases.forEach((c, i) => {
        zip.file(`${dir}/${i + 1}.in`, c.input ?? '');
        if (c.expected) zip.file(`${dir}/${i + 1}.out`, c.expected);
      });
    }
    zip.file('.webeditor/project.json', JSON.stringify(project, null, 2));
  }
}

/**
 * 由多個本機檔案（含 webkitRelativePath）組出 [{ path, content|binary }]
 * keepDirs：保留資料夾結構（上傳資料夾時）
 */
export async function readLocalFiles(fileList, keepDirs) {
  const out = [];
  for (const file of fileList) {
    const rel = keepDirs && file.webkitRelativePath ? file.webkitRelativePath : file.name;
    if (isJunkPath(rel)) continue;
    const path = normalizePath(rel);
    if (!path) continue;
    out.push({ path, ...(await readLocalFile(file)) });
  }
  return out;
}

/** 拖放：遞迴讀取 DataTransferItem 中的資料夾 */
export async function readDataTransfer(dt) {
  const items = [...(dt.items ?? [])].map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
  if (!items.length) return { files: await readLocalFiles(dt.files, false), dirs: [] };
  const files = [];
  const dirs = [];
  async function walk(entry, prefix) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (isJunkPath(path)) return;
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      const p = normalizePath(path);
      if (p) files.push({ path: p, ...(await readLocalFile(file)), zip: /\.zip$/i.test(file.name) ? file : null });
    } else if (entry.isDirectory) {
      dirs.push(path);
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, path);
      }
    }
  }
  for (const e of items) await walk(e, '');
  return { files, dirs };
}

export { dirname };
