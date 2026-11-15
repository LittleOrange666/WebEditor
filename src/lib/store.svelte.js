// 應用程式狀態：專案、檔案、編輯分頁、測資、設定，並負責寫入 IndexedDB 與跨分頁同步（spec §3、§4）
import * as db from './db.js';
import { LockManager, LOCKS_SUPPORTED } from './locks.js';
import { basename, dirname, joinPath, validateName, uniqueName, isRunnable } from './paths.js';
import { DEFAULT_TIME_LIMIT_S, DEFAULT_CODENOTER_PROXY } from './config.js';
import { toast } from './dialog.svelte.js';
import { DEFAULT_PROJECT } from '../examples/index.js';

export const DEFAULT_SETTINGS = {
  theme: 'system', // system | light | dark
  fontSize: 14,
  tabSize: 4,
  timeLimit: DEFAULT_TIME_LIMIT_S,
  stderrMode: 'merge', // merge | split
  clearTerminal: true,
  clangSource: 'cdn', // cdn | self
  codenoterProxy: DEFAULT_CODENOTER_PROXY,
  runMode: 'tests', // tests | terminal
};

export const app = $state({
  loading: true,
  loadError: '',
  saveError: '',
  projects: [],
  projectId: null,
  files: [], // 目前專案的所有項目（含內容）
  openTabs: [], // fileId[]
  activeTab: null,
  selectedDir: '', // 檔案樹中目前選取的資料夾（上傳、新增的目的地）
  locks: {}, // fileId -> 'held' | 'waiting' | 'none'
  tests: {}, // fileId -> 測資紀錄
  settings: { ...DEFAULT_SETTINGS },
});

const SESSION_KEY = 'webeditor.session.v1';
const LAST_PROJECT_KEY = 'webeditor.lastProject';
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('webeditor') : null;

const locks = new LockManager((id, state) => { app.locks[id] = state; });
// 開發時模組熱更新會留下舊的鎖，先釋放
import.meta.hot?.dispose(() => { locks.releaseAll(); channel?.close(); });

// ---------- 小工具 ----------

export const currentProject = () => app.projects.find((p) => p.id === app.projectId) ?? null;
export const fileById = (id) => app.files.find((f) => f.id === id) ?? null;
export const fileByPath = (path) => app.files.find((f) => f.path.toLowerCase() === path.toLowerCase()) ?? null;
export const activeFile = () => (app.activeTab ? fileById(app.activeTab) : null);
export const canEdit = (id) => !LOCKS_SUPPORTED || app.locks[id] === 'held';

function post(msg) {
  try { channel?.postMessage(msg); } catch { /* 略過 */ }
}

function sortProjects(list) {
  return list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
}

function saveSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      projectId: app.projectId, openTabs: app.openTabs, activeTab: app.activeTab,
    }));
    if (app.projectId) localStorage.setItem(LAST_PROJECT_KEY, app.projectId);
  } catch { /* 略過 */ }
}

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}

function reportSaveError(e) {
  app.saveError = `寫入失敗：${e?.message || e}。建議下載專案 zip 備份。`;
}

async function write(ops) {
  try {
    await db.batch(ops);
    app.saveError = '';
  } catch (e) {
    reportSaveError(e);
    throw e;
  }
}

// ---------- 延遲寫入檔案內容（spec §3.3） ----------

const pending = new Map(); // fileId -> timer

function scheduleSave(id) {
  clearTimeout(pending.get(id));
  pending.set(id, setTimeout(() => flushFile(id), 400));
}

async function flushFile(id) {
  clearTimeout(pending.get(id));
  if (!pending.has(id)) return;
  pending.delete(id);
  const f = fileById(id);
  if (!f) return;
  const rec = $state.snapshot(f);
  try {
    await write([{ store: 'files', put: rec }]);
    post({ t: 'content', projectId: f.projectId, id });
  } catch { /* 已提示 */ }
}

export async function flushAll() {
  await Promise.all([...pending.keys()].map(flushFile));
}

// ---------- 初始化 ----------

export async function init() {
  try {
    const [projects, settings] = await Promise.all([db.getAll('projects'), db.get('settings', 'global')]);
    if (settings) Object.assign(app.settings, settings.value);
    app.projects = sortProjects(projects);
    try { await navigator.storage?.persist?.(); } catch { /* 瀏覽器不一定同意 */ }

    if (!app.projects.length) {
      await createProjectFrom(DEFAULT_PROJECT.name, DEFAULT_PROJECT.files, DEFAULT_PROJECT.tests, { open: false });
    }
    const session = readSession();
    let last = null;
    try { last = localStorage.getItem(LAST_PROJECT_KEY); } catch { /* 略過 */ }
    const pick = [session?.projectId, last].find((id) => id && app.projects.some((p) => p.id === id)) ?? app.projects[0].id;
    await openProject(pick, session?.projectId === pick ? session : null);
  } catch (e) {
    app.loadError = `無法載入資料：${e?.message || e}`;
  } finally {
    app.loading = false;
  }

  channel?.addEventListener('message', (e) => onMessage(e.data));
  window.addEventListener('pagehide', () => { flushAll(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushAll(); });
}

// ---------- 專案 ----------

export async function openProject(id, session = null) {
  await flushAll();
  locks.releaseAll();
  app.locks = {};
  const [files, tests] = await Promise.all([
    db.getAllByIndex('files', 'projectId', id),
    db.getAllByIndex('tests', 'projectId', id),
  ]);
  app.projectId = id;
  app.files = files;
  app.tests = Object.fromEntries(tests.map((t) => [t.fileId, t]));
  app.selectedDir = '';
  const ids = new Set(files.filter((f) => f.kind === 'file').map((f) => f.id));
  app.openTabs = (session?.openTabs ?? []).filter((t) => ids.has(t));
  app.activeTab = app.openTabs.includes(session?.activeTab) ? session.activeTab : (app.openTabs[0] ?? null);
  if (!app.openTabs.length) {
    // 預設開啟第一個可執行檔
    // 預設開啟：有測資的程式檔 → main.* → 第一個可執行檔 → 第一個檔案
    const list = files.filter((f) => f.kind === 'file').sort((a, b) => a.path.localeCompare(b.path));
    const first = list.find((f) => isRunnable(f.path) && app.tests[f.id]?.cases?.length)
      ?? list.find((f) => isRunnable(f.path) && /^main\./i.test(basename(f.path)))
      ?? list.find((f) => isRunnable(f.path))
      ?? list[0];
    if (first) { app.openTabs = [first.id]; app.activeTab = first.id; }
  }
  for (const t of app.openTabs) locks.acquire(t);
  saveSession();
}

export function validateProjectName(name, exceptId = null) {
  if (!name.trim()) return '名稱不可空白';
  if (app.projects.some((p) => p.id !== exceptId && p.name === name.trim())) return '已有同名的專案';
  return null;
}

export function uniqueProjectName(name) {
  let n = name || '未命名專案';
  if (!app.projects.some((p) => p.name === n)) return n;
  for (let i = 2; ; i++) {
    const c = `${name} (${i})`;
    if (!app.projects.some((p) => p.name === c)) return c;
  }
}

/**
 * 建立專案。files：[{ path, content?: string, binary?: ArrayBuffer }]（資料夾以結尾 / 表示）
 * tests：{ [path]: { cases, timeLimit?, compare? } }
 */
export async function createProjectFrom(name, files = [], tests = {}, { open = true } = {}) {
  const now = Date.now();
  const project = { id: db.newId(), name: uniqueProjectName(name), createdAt: now, updatedAt: now };
  const entries = buildEntries(project.id, files);
  const ops = [{ store: 'projects', put: project }, ...entries.map((e) => ({ store: 'files', put: e }))];
  for (const [path, t] of Object.entries(tests)) {
    const f = entries.find((e) => e.path === path && e.kind === 'file');
    if (f) ops.push({ store: 'tests', put: normalizeTests({ ...t, fileId: f.id, projectId: project.id }) });
  }
  await write(ops);
  app.projects = sortProjects([...app.projects, project]);
  post({ t: 'projects' });
  if (open) await openProject(project.id);
  return project;
}

/** 把路徑清單轉成檔案紀錄，並自動補上所需的資料夾 */
function buildEntries(projectId, files, existing = []) {
  const now = Date.now();
  const out = [];
  const seen = new Set(existing.map((e) => e.path.toLowerCase()));
  const addDir = (path) => {
    if (!path || seen.has(path.toLowerCase())) return;
    addDir(dirname(path));
    seen.add(path.toLowerCase());
    out.push({ id: db.newId(), projectId, path, kind: 'dir', updatedAt: now });
  };
  for (const f of files) {
    if (f.path.endsWith('/')) { addDir(f.path.slice(0, -1)); continue; }
    addDir(dirname(f.path));
    seen.add(f.path.toLowerCase());
    const rec = { id: db.newId(), projectId, path: f.path, kind: 'file', updatedAt: now };
    if (f.binary) rec.binary = f.binary;
    else rec.content = f.content ?? '';
    out.push(rec);
  }
  return out;
}

export async function renameProject(id, name) {
  const p = app.projects.find((x) => x.id === id);
  if (!p) return;
  const rec = { ...$state.snapshot(p), name: name.trim(), updatedAt: Date.now() };
  await write([{ store: 'projects', put: rec }]);
  Object.assign(p, rec);
  sortProjects(app.projects);
  post({ t: 'projects' });
}

export async function duplicateProject(id) {
  await flushAll();
  const src = app.projects.find((x) => x.id === id);
  const [files, tests] = await Promise.all([
    db.getAllByIndex('files', 'projectId', id),
    db.getAllByIndex('tests', 'projectId', id),
  ]);
  const testMap = {};
  for (const t of tests) {
    const f = files.find((x) => x.id === t.fileId);
    if (f) testMap[f.path] = t;
  }
  const list = files.map((f) => (f.kind === 'dir' ? { path: f.path + '/' } : { path: f.path, content: f.content, binary: f.binary }));
  return createProjectFrom(`${src.name} 的副本`, list, testMap);
}

export async function deleteProject(id) {
  const [files, tests] = await Promise.all([
    db.getAllByIndex('files', 'projectId', id),
    db.getAllByIndex('tests', 'projectId', id),
  ]);
  await write([
    { store: 'projects', del: id },
    ...files.map((f) => ({ store: 'files', del: f.id })),
    ...tests.map((t) => ({ store: 'tests', del: t.fileId })),
  ]);
  app.projects = app.projects.filter((p) => p.id !== id);
  post({ t: 'projects', deleted: id });
  if (app.projectId === id) {
    if (!app.projects.length) await createProjectFrom(DEFAULT_PROJECT.name, DEFAULT_PROJECT.files, DEFAULT_PROJECT.tests);
    else await openProject(app.projects[0].id);
  }
}

// ---------- 檔案 ----------

const takenSet = () => new Set(app.files.map((f) => f.path.toLowerCase()));

export function validateNewName(dir, name, exceptId = null) {
  const err = validateName(name);
  if (err) return err;
  const path = joinPath(dir, name).toLowerCase();
  if (app.files.some((f) => f.id !== exceptId && f.path.toLowerCase() === path)) return '同一資料夾中已有同名的項目';
  return null;
}

async function touchProject() {
  const p = currentProject();
  if (!p) return;
  p.updatedAt = Date.now();
  try { await db.put('projects', $state.snapshot(p)); } catch { /* 略過 */ }
}

function announceFiles() {
  post({ t: 'files', projectId: app.projectId });
  touchProject();
}

export async function createFile(dir, name, content = '', { open = true } = {}) {
  const entries = buildEntries(app.projectId, [{ path: joinPath(dir, name), content }], app.files);
  await write(entries.map((e) => ({ store: 'files', put: e })));
  app.files.push(...entries);
  announceFiles();
  const file = entries.find((e) => e.kind === 'file');
  if (open && file) openTab(file.id);
  return file;
}

export async function createFolder(dir, name) {
  const entries = buildEntries(app.projectId, [{ path: joinPath(dir, name) + '/' }], app.files);
  await write(entries.map((e) => ({ store: 'files', put: e })));
  app.files.push(...entries);
  announceFiles();
}

/** 把項目（及其子項目）移到新路徑；用於重新命名與移動 */
async function relocate(entry, newPath) {
  const old = entry.path;
  const affected = app.files.filter((f) => f.path === old || f.path.startsWith(old + '/'));
  const ops = [];
  const extra = buildEntries(app.projectId, dirname(newPath) ? [{ path: dirname(newPath) + '/' }] : [], app.files);
  for (const f of affected) {
    f.path = newPath + f.path.slice(old.length);
    f.updatedAt = Date.now();
    ops.push({ store: 'files', put: $state.snapshot(f) });
  }
  ops.push(...extra.map((e) => ({ store: 'files', put: e })));
  app.files.push(...extra);
  await write(ops);
  announceFiles();
}

export async function renameEntry(entry, name) {
  await relocate(entry, joinPath(dirname(entry.path), name));
}

export function validateMove(entry, destDir) {
  if (entry.kind === 'dir' && (destDir === entry.path || destDir.startsWith(entry.path + '/'))) return '不能移到自己或子資料夾中';
  if (dirname(entry.path) === destDir) return '已經在這個資料夾中';
  const target = joinPath(destDir, basename(entry.path)).toLowerCase();
  if (app.files.some((f) => f.path.toLowerCase() === target)) return '目的資料夾中已有同名的項目';
  return null;
}

export async function moveEntry(entry, destDir) {
  await relocate(entry, joinPath(destDir, basename(entry.path)));
}

export async function deleteEntry(entry) {
  const affected = app.files.filter((f) => f.path === entry.path || f.path.startsWith(entry.path + '/'));
  const ids = new Set(affected.map((f) => f.id));
  const ops = [];
  for (const f of affected) {
    ops.push({ store: 'files', del: f.id });
    if (app.tests[f.id]) ops.push({ store: 'tests', del: f.id });
    clearTimeout(pending.get(f.id));
    pending.delete(f.id);
  }
  await write(ops);
  app.files = app.files.filter((f) => !ids.has(f.id));
  for (const id of ids) {
    delete app.tests[id];
    if (app.openTabs.includes(id)) closeTab(id);
  }
  announceFiles();
}

export function updateContent(id, content) {
  const f = fileById(id);
  if (!f || !canEdit(id)) return;
  f.content = content;
  f.updatedAt = Date.now();
  scheduleSave(id);
}

/**
 * 匯入多個檔案到目前專案。items：[{ path, content?, binary? }]（path 相對於 destDir）
 * resolveConflict(path) → 'replace' | 'keep' | 'skip'（可回傳 Promise）
 * 回傳匯入的檔案數
 */
export async function importFiles(destDir, items, resolveConflict) {
  const ops = [];
  const newEntries = [];
  let count = 0;
  const taken = takenSet();
  for (const it of items) {
    let path = joinPath(destDir, it.path);
    const existing = fileByPath(path);
    if (existing) {
      if (existing.kind === 'dir') continue;
      const choice = await resolveConflict(path);
      if (choice === 'skip') continue;
      if (choice === 'replace') {
        if (!canEdit(existing.id) && app.openTabs.includes(existing.id)) {
          toast(`${path} 正在其他分頁編輯中，已略過`);
          continue;
        }
        delete existing.binary;
        delete existing.content;
        if (it.binary) existing.binary = it.binary;
        else existing.content = it.content ?? '';
        existing.updatedAt = Date.now();
        ops.push({ store: 'files', put: $state.snapshot(existing) });
        post({ t: 'content', projectId: app.projectId, id: existing.id });
        count++;
        continue;
      }
      path = joinPath(dirname(path), uniqueName(dirname(path), basename(path), taken));
    }
    const entries = buildEntries(app.projectId, [{ path, content: it.content, binary: it.binary }], [...app.files, ...newEntries]);
    for (const e of entries) taken.add(e.path.toLowerCase());
    newEntries.push(...entries);
    count++;
  }
  // 空資料夾
  ops.push(...newEntries.map((e) => ({ store: 'files', put: e })));
  await write(ops);
  app.files.push(...newEntries);
  announceFiles();
  return count;
}

export async function ensureFolders(destDir, dirs) {
  const entries = buildEntries(app.projectId, dirs.map((d) => ({ path: joinPath(destDir, d) + '/' })), app.files);
  if (!entries.length) return;
  await write(entries.map((e) => ({ store: 'files', put: e })));
  app.files.push(...entries);
  announceFiles();
}

// ---------- 編輯分頁 ----------

export function openTab(id) {
  if (!app.openTabs.includes(id)) {
    const i = app.openTabs.indexOf(app.activeTab);
    app.openTabs.splice(i + 1, 0, id);
    locks.acquire(id);
  }
  app.activeTab = id;
  saveSession();
}

export function closeTab(id) {
  const i = app.openTabs.indexOf(id);
  if (i < 0) return;
  flushFile(id);
  app.openTabs.splice(i, 1);
  locks.release(id);
  delete app.locks[id];
  if (app.activeTab === id) app.activeTab = app.openTabs[Math.min(i, app.openTabs.length - 1)] ?? null;
  saveSession();
}

export function activateTab(id) {
  app.activeTab = id;
  saveSession();
}

export function moveTab(from, to) {
  const [t] = app.openTabs.splice(from, 1);
  app.openTabs.splice(to, 0, t);
  saveSession();
}

/** 請持有鎖的分頁交出編輯權（spec §4.3） */
export function takeOver(id) {
  post({ t: 'yield', id });
}

// ---------- 測資（spec §6.3） ----------

export function normalizeTests(t) {
  return {
    fileId: t.fileId,
    projectId: t.projectId,
    cases: (t.cases ?? []).map((c, i) => ({
      id: c.id ?? db.newId(),
      name: c.name ?? `測資 ${i + 1}`,
      input: c.input ?? '',
      expected: c.expected ?? '',
      enabled: c.enabled !== false,
    })),
    timeLimit: t.timeLimit ?? null,
    compare: t.compare ?? 'tokens',
  };
}

export function testsOf(fileId) {
  return app.tests[fileId] ?? null;
}

/** 修改某檔案的測資：mutate(record) 直接修改後寫入 */
const testTimers = new Map();
export function updateTests(fileId, mutate, { immediate = false } = {}) {
  if (!app.tests[fileId]) app.tests[fileId] = normalizeTests({ fileId, projectId: app.projectId, cases: [] });
  mutate(app.tests[fileId]);
  clearTimeout(testTimers.get(fileId));
  const save = async () => {
    testTimers.delete(fileId);
    const t = app.tests[fileId];
    if (!t) return;
    try {
      await write([{ store: 'tests', put: $state.snapshot(t) }]);
      post({ t: 'tests', projectId: app.projectId, fileId });
    } catch { /* 已提示 */ }
  };
  if (immediate) save();
  else testTimers.set(fileId, setTimeout(save, 400));
}

export async function replaceTests(fileId, record) {
  app.tests[fileId] = normalizeTests({ ...record, fileId, projectId: app.projectId });
  await write([{ store: 'tests', put: $state.snapshot(app.tests[fileId]) }]);
  post({ t: 'tests', projectId: app.projectId, fileId });
}

// ---------- 設定（spec §5） ----------

export async function updateSettings(patch) {
  Object.assign(app.settings, patch);
  try {
    await db.put('settings', { key: 'global', value: $state.snapshot(app.settings) });
    post({ t: 'settings' });
  } catch (e) { reportSaveError(e); }
}

// ---------- 跨分頁同步（spec §4.2） ----------

async function onMessage(m) {
  try {
    if (m.t === 'projects') {
      const projects = await db.getAll('projects');
      app.projects = sortProjects(projects);
      if (m.deleted && m.deleted === app.projectId) {
        toast('目前的專案已在其他分頁被刪除');
        if (app.projects.length) await openProject(app.projects[0].id);
      }
    } else if (m.t === 'files' && m.projectId === app.projectId) {
      const files = await db.getAllByIndex('files', 'projectId', app.projectId);
      // 自己正在編輯（尚未寫入）的內容保留
      for (const f of files) {
        if (pending.has(f.id)) {
          const mine = fileById(f.id);
          if (mine) f.content = mine.content;
        }
      }
      const ids = new Set(files.map((f) => f.id));
      const removed = app.openTabs.filter((t) => !ids.has(t));
      app.files = files;
      if (removed.length) {
        for (const t of removed) closeTab(t);
        toast('有開啟中的檔案已在其他分頁被刪除');
      }
    } else if (m.t === 'content' && m.projectId === app.projectId) {
      if (pending.has(m.id) && canEdit(m.id)) return;
      const rec = await db.get('files', m.id);
      const f = fileById(m.id);
      if (rec && f) { f.content = rec.content; f.binary = rec.binary; f.updatedAt = rec.updatedAt; }
    } else if (m.t === 'tests' && m.projectId === app.projectId) {
      const rec = await db.get('tests', m.fileId);
      if (rec) app.tests[m.fileId] = rec;
      else delete app.tests[m.fileId];
    } else if (m.t === 'settings') {
      const s = await db.get('settings', 'global');
      if (s) Object.assign(app.settings, s.value);
    } else if (m.t === 'yield') {
      if (locks.state(m.id) === 'held') {
        await flushFile(m.id);
        locks.yieldLock(m.id);
      }
    }
  } catch (e) {
    console.error('同步失敗', e);
  }
}
