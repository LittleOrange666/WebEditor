// 使用者動作：上傳、下載、新增、刪除…（含對話框流程），供各元件共用
import {
  app, importFiles, ensureFolders, createProjectFrom, currentProject, fileById, replaceTests,
  createFile, createFolder, renameEntry, deleteEntry, validateNewName, validateMove, moveEntry, flushAll, fileByPath,
} from './store.svelte.js';
import { alertDialog, confirmDialog, promptDialog, choiceDialog, toast } from './dialog.svelte.js';
import { readZip, buildZip, readLocalFiles, downloadBlob, downloadFileEntry } from './zip.js';
import { basename, dirname, joinPath, formatBytes, normalizePath } from './paths.js';
import { LARGE_FILE_BYTES } from './config.js';

/** 依序詢問同名檔案的處理方式；可勾選「套用到全部」 */
function conflictResolver() {
  let all = null;
  return async (path) => {
    if (all) return all;
    const r = await choiceDialog({
      title: '已有同名檔案',
      message: `「${path}」已經存在，要怎麼處理？`,
      choices: [
        { value: 'replace', label: '取代', danger: true },
        { value: 'keep', label: '保留兩者' },
        { value: 'skip', label: '略過' },
      ],
      checkbox: '套用到全部',
    });
    const v = r.value ?? 'skip';
    if (r.checked) all = v;
    return v;
  };
}

function warnLarge(items) {
  const big = items.filter((i) => (i.content?.length ?? i.binary?.byteLength ?? 0) > LARGE_FILE_BYTES);
  if (big.length) toast(`${big.map((b) => b.path).join('、')} 超過 ${formatBytes(LARGE_FILE_BYTES)}，可能影響效能`, 4000);
}

/** 上傳本機檔案（keepDirs：上傳資料夾時保留結構） */
export async function uploadLocal(fileList, { keepDirs = false, destDir = app.selectedDir } = {}) {
  const list = [...fileList];
  if (!list.length) return;
  // 單獨上傳 zip 時詢問是否解壓
  if (!keepDirs && list.length === 1 && /\.zip$/i.test(list[0].name)) {
    await uploadZip(list[0], destDir);
    return;
  }
  const items = await readLocalFiles(list, keepDirs);
  warnLarge(items);
  const n = await importFiles(destDir, items, conflictResolver());
  if (n) toast(`已上傳 ${n} 個檔案`);
}

/** 上傳 zip：解壓到目前資料夾，或建立為新專案（spec §3.4） */
export async function uploadZip(file, destDir = app.selectedDir) {
  let data;
  try {
    data = await readZip(file);
  } catch (e) {
    await alertDialog({ title: '無法讀取 zip', message: String(e?.message || e) });
    return;
  }
  const r = await choiceDialog({
    title: `上傳 ${file.name}`,
    message: `共 ${data.files.length} 個檔案。要怎麼匯入？`,
    choices: [
      { value: 'new', label: '建立為新專案', primary: true },
      { value: 'extract', label: `解壓到「${destDir || '專案根目錄'}」` },
      { value: 'add', label: '當成一般檔案上傳' },
    ],
  });
  if (!r.value) return;
  if (r.value === 'add') {
    const n = await importFiles(destDir, [{ path: file.name, binary: await file.arrayBuffer() }], conflictResolver());
    if (n) toast('已上傳');
    return;
  }
  warnLarge(data.files);
  if (r.value === 'new') {
    const name = data.meta?.project?.name || file.name.replace(/\.zip$/i, '');
    await createProjectFrom(name, [...data.dirs.map((d) => ({ path: d + '/' })), ...data.files], data.meta?.tests ?? {});
    toast('已建立新專案');
    return;
  }
  await ensureFolders(destDir, data.dirs);
  const n = await importFiles(destDir, data.files, conflictResolver());
  // 還原測資（只還原對應到的檔案）
  if (data.meta?.tests) {
    for (const [path, t] of Object.entries(data.meta.tests)) {
      const f = fileByPath(joinPath(destDir, path));
      if (f) await replaceTests(f.id, t);
    }
  }
  toast(`已匯入 ${n} 個檔案`);
}

/** 拖放上傳（含資料夾與 zip） */
export async function uploadDropped({ files, dirs }, destDir) {
  if (files.length === 1 && files[0].zip && !dirs.length) {
    await uploadZip(files[0].zip, destDir);
    return;
  }
  await ensureFolders(destDir, dirs);
  const items = files.map(({ zip, ...rest }) => rest);
  warnLarge(items);
  const n = await importFiles(destDir, items, conflictResolver());
  if (n) toast(`已上傳 ${n} 個檔案`);
}

export async function downloadProject() {
  await flushAll();
  const p = currentProject();
  const blob = await buildZip(app.files, { tests: app.tests, projectName: p?.name });
  downloadBlob(blob, `${p?.name || 'project'}.zip`);
}

export async function downloadEntry(entry) {
  await flushAll();
  if (entry.kind === 'file') downloadFileEntry(entry);
  else downloadBlob(await buildZip(app.files, { prefix: entry.path }), `${basename(entry.path)}.zip`);
}

export async function newFile(dir = app.selectedDir) {
  const name = await promptDialog({
    title: '新增檔案',
    message: dir ? `位置：${dir}/` : '位置：專案根目錄',
    label: '檔名（例如 main.cpp、solve.py、input.txt）',
    value: 'main.cpp',
    validate: (v) => validateNewName(dir, v),
  });
  if (name) await createFile(dir, name, '');
}

export async function newFolder(dir = app.selectedDir) {
  const name = await promptDialog({
    title: '新增資料夾',
    message: dir ? `位置：${dir}/` : '位置：專案根目錄',
    label: '資料夾名稱',
    value: '新資料夾',
    validate: (v) => validateNewName(dir, v),
  });
  if (name) await createFolder(dir, name);
}

export async function rename(entry) {
  const dir = dirname(entry.path);
  const name = await promptDialog({
    title: entry.kind === 'dir' ? '重新命名資料夾' : '重新命名檔案',
    value: basename(entry.path),
    confirmLabel: '重新命名',
    validate: (v) => (v === basename(entry.path) ? null : validateNewName(dir, v, entry.id)),
  });
  if (name && name !== basename(entry.path)) await renameEntry(entry, name);
}

export async function moveTo(entry) {
  const dest = await promptDialog({
    title: `移動「${basename(entry.path)}」`,
    message: '輸入目的資料夾的路徑，例如 src/utils；留空表示專案根目錄。不存在的資料夾會自動建立。',
    label: '目的資料夾',
    value: dirname(entry.path),
    confirmLabel: '移動',
    validate: (v) => {
      const d = v ? normalizePath(v) : '';
      if (d === null) return '路徑不合法';
      const target = app.files.find((f) => f.path.toLowerCase() === d.toLowerCase());
      if (target && target.kind !== 'dir') return '目的地是檔案，不是資料夾';
      return validateMove(entry, d);
    },
  });
  if (dest === null) return;
  await moveEntry(entry, dest ? normalizePath(dest) : '');
}

export async function remove(entry) {
  const isDir = entry.kind === 'dir';
  const count = isDir ? app.files.filter((f) => f.path.startsWith(entry.path + '/') && f.kind === 'file').length : 0;
  const hasTests = app.files.some((f) => (f.id === entry.id || f.path.startsWith(entry.path + '/')) && app.tests[f.id]?.cases?.length);
  let msg = isDir ? `資料夾「${entry.path}」及其中的 ${count} 個檔案將被刪除。` : `檔案「${entry.path}」將被刪除。`;
  if (hasTests) msg += '\n相關的測資也會一併刪除。';
  msg += '\n此動作無法復原。';
  const ok = await confirmDialog({ title: isDir ? '刪除資料夾' : '刪除檔案', message: msg, confirmLabel: '刪除', danger: true });
  if (ok) await deleteEntry(entry);
}

export function fileLabel(id) {
  const f = fileById(id);
  return f ? f.path : '';
}
