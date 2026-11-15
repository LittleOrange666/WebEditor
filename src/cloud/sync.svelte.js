// 雲端同步引擎（spec_new §4.2–§4.5）
//
// - 本地一律先寫 IndexedDB；store 寫入時經由 hooks.augment 在 dirty store 標記待同步（augmentOps）
// - 每個帳號只有一個分頁負責同步（Web Locks 選出 leader），其他分頁的修改經由 IndexedDB 與 BroadcastChannel 交給它
// - 下載：GET /sync?since=<cursor>；上傳：POST /sync（逐筆附上 baseRev），依結果處理衝突（衝突副本）
import * as db from '../lib/db.js';
import { app, flushAll, refreshProjects } from '../lib/store.svelte.js';
import { toast } from '../lib/dialog.svelte.js';
import { api, ApiError } from './api.js';
import { auth, ownerId } from './auth.svelte.js';
import { buildChanges, conflictCopyName, isSyncableEntry, sameEntry, REJECT_MESSAGES } from './syncLogic.js';
import { uniqueName, dirname, basename, joinPath } from '../lib/paths.js';

/** 跨裝置同步的設定項目（spec_new §4.1） */
export const SYNCED_SETTINGS = ['theme', 'fontSize', 'tabSize', 'timeLimit', 'stderrMode', 'clearTerminal', 'clangSource'];

const PUSH_DELAY_MS = 2000;
const POLL_MS = 30_000;

export const syncState = $state({
  status: 'idle', // idle | syncing | offline | error | off
  error: '',
  lastSync: null,
  leader: false,
  pending: 0, // 待上傳的項目數
  errors: {}, // id → 被拒原因（顯示「僅本地」）
  dirtyProjects: {}, // projectId → 待上傳數
  errorProjects: {}, // projectId → 有被拒的項目
  usedBytes: null,
  quotaBytes: null,
});

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('webeditor') : null;
const post = (m) => { try { channel?.postMessage(m); } catch { /* 略過 */ } };

let session = null; // { userId, release, timers }
let busy = false;
let again = false;
let pushTimer = null;
let statusTimer = null;
const warned = new Set();
let seq = 0;

const metaKey = (uid) => `sync:${uid}`;
const nextAt = () => Date.now() * 1000 + (seq++ % 1000);

// ---------- 標記待同步（由 store 的 hooks.augment 呼叫） ----------

/** 在 store 的寫入操作後附加 dirty 紀錄（同一個交易，確保不會漏掉） */
export function augmentOps(ops) {
  const syncOf = new Map(app.projects.map((p) => [p.id, p.sync]));
  for (const o of ops) if (o.store === 'projects' && o.put) syncOf.set(o.put.id, o.put.sync);
  const at = nextAt();
  const extra = [];
  for (const o of ops) {
    if (o.store === 'projects') {
      const id = o.put ? o.put.id : o.del;
      if (syncOf.get(id) === 'cloud') extra.push({ store: 'dirty', put: { key: `p:${id}`, type: 'project', id, projectId: id, at } });
    } else if (o.store === 'files') {
      const id = o.put ? o.put.id : o.del;
      const pid = o.put ? o.put.projectId : app.files.find((f) => f.id === id)?.projectId;
      if (pid && syncOf.get(pid) === 'cloud') extra.push({ store: 'dirty', put: { key: `e:${id}`, type: 'entry', id, projectId: pid, at } });
    }
  }
  if (!extra.length) return ops;
  schedulePush();
  return [...ops, ...extra];
}

/** 設定被修改（由 store 的 hooks.settingsChanged 呼叫） */
export async function settingsChanged(keys) {
  const uid = ownerId();
  if (!uid || !keys.some((k) => SYNCED_SETTINGS.includes(k))) return;
  const meta = (await db.get('meta', metaKey(uid))) ?? { key: metaKey(uid), cursor: 0 };
  meta.settingsDirty = nextAt();
  await db.put('meta', meta);
  schedulePush();
}

/** 把專案（含所有項目）標記為要上傳 */
export async function markProjectForUpload(projectId) {
  const files = await db.getAllByIndex('files', 'projectId', projectId);
  const at = nextAt();
  await db.batch([
    { store: 'dirty', put: { key: `p:${projectId}`, type: 'project', id: projectId, projectId, at } },
    ...files.map((f) => ({ store: 'dirty', put: { key: `e:${f.id}`, type: 'entry', id: f.id, projectId, at } })),
  ]);
  schedulePush();
}

/** 改為僅本地：清除同步紀錄；deleteRemote 時排入刪除雲端副本 */
export async function detachProject(projectId, { deleteRemote = false } = {}) {
  const [dirty, revs] = await Promise.all([db.getAllByIndex('dirty', 'projectId', projectId), db.getAll('revs')]);
  const ops = dirty.map((d) => ({ store: 'dirty', del: d.key }));
  const projectRev = revs.find((r) => r.id === projectId);
  for (const r of revs) if (r.projectId === projectId && r.id !== projectId) ops.push({ store: 'revs', del: r.id });
  if (deleteRemote && projectRev) {
    ops.push({ store: 'dirty', put: { key: `p:${projectId}`, type: 'project', id: projectId, projectId, at: nextAt(), deleteRemote: true } });
  } else if (projectRev) {
    ops.push({ store: 'revs', del: projectId });
  }
  await db.batch(ops);
  schedulePush();
  refreshStatus();
}

// ---------- 啟動／停止 ----------

export function startSync() {
  const uid = auth.user?.id;
  if (!uid) { stopSync(); return; }
  if (session?.userId === uid) { schedulePush(0); return; }
  stopSync();
  const s = { userId: uid, release: null, controller: new AbortController(), poll: null };
  session = s;
  syncState.status = 'idle';
  const run = async () => {
    if (session !== s) return;
    syncState.leader = true;
    s.poll = setInterval(() => { if (!document.hidden) syncNow(); }, POLL_MS);
    syncNow();
    await new Promise((resolve) => { s.release = resolve; });
    clearInterval(s.poll);
    syncState.leader = false;
  };
  if (navigator.locks?.request) {
    navigator.locks.request(`webeditor-sync-${uid}`, { signal: s.controller.signal }, run).catch(() => { /* 已停止 */ });
  } else {
    run();
  }
  refreshStatus();
}

export function stopSync() {
  if (!session) return;
  session.controller.abort();
  session.release?.();
  clearInterval(session.poll);
  session = null;
  clearTimeout(pushTimer);
  syncState.leader = false;
  syncState.status = 'off';
}

export function schedulePush(delay = PUSH_DELAY_MS) {
  if (!session || !syncState.leader) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => syncNow(), delay);
}

/** 立刻同步一次（leader 才會真的執行）；回傳是否成功 */
export async function syncNow() {
  if (!session || !syncState.leader) return false;
  if (busy) { again = true; return false; }
  busy = true;
  clearTimeout(pushTimer);
  let ok = false;
  const s = session;
  try {
    syncState.status = 'syncing';
    broadcastStatus();
    await flushAll();
    await pull(s.userId);
    await pushAll(s.userId);
    if (session === s) {
      syncState.status = 'idle';
      syncState.error = '';
      syncState.lastSync = Date.now();
    }
    ok = true;
  } catch (e) {
    if (session === s) {
      if (e instanceof ApiError && e.code === 'network') syncState.status = 'offline';
      else if (e instanceof ApiError && e.status === 401) syncState.status = 'off';
      else { syncState.status = 'error'; syncState.error = e?.message || String(e); console.error('同步失敗', e); }
    }
  } finally {
    busy = false;
    refreshStatus();
    broadcastStatus();
    if (again) { again = false; schedulePush(500); }
  }
  return ok;
}

/** 等目前的同步結束後再同步一次（登出、下載所有專案前使用） */
export async function syncAndWait() {
  for (let i = 0; i < 50 && busy; i++) await new Promise((r) => setTimeout(r, 100));
  if (!syncState.leader) {
    // 不是 leader：無法在這個分頁同步，只能等 leader 處理
    return false;
  }
  return syncNow();
}

// ---------- 下載 ----------

async function pull(uid) {
  const meta = (await db.get('meta', metaKey(uid))) ?? { key: metaKey(uid), cursor: 0 };
  let since = meta.cursor || 0;
  let full = false;
  const seenP = new Set();
  const seenE = new Set();
  for (let page = 0; ; page++) {
    const r = await api(`/sync?since=${since}`);
    if (page === 0) full = r.full;
    if (session?.userId !== uid) return;
    await applyRemote(uid, r, seenP, seenE);
    since = r.cursor;
    if (!r.more) break;
  }
  if (full) await removeMissing(uid, seenP, seenE);
  const latest = (await db.get('meta', metaKey(uid))) ?? meta;
  await db.put('meta', { ...latest, cursor: since });
}

async function applyRemote(uid, r, seenP, seenE) {
  const ops = [];
  const msgs = [];
  const localProjects = new Map((await db.getAll('projects')).map((p) => [p.id, p]));
  const dirty = new Set((await db.getAll('dirty')).map((d) => d.key));
  let projectsChanged = false;

  // 設定（最後寫入為準；本地有未上傳的修改時以本地為準）
  if (r.settings) {
    const meta = await db.get('meta', metaKey(uid));
    if (!meta?.settingsDirty) {
      const cur = (await db.get('settings', 'global'))?.value ?? {};
      const next = { ...cur };
      for (const k of SYNCED_SETTINGS) if (k in r.settings.value) next[k] = r.settings.value[k];
      if (JSON.stringify(next) !== JSON.stringify(cur)) {
        ops.push({ store: 'settings', put: { key: 'global', value: next } });
        msgs.push({ t: 'settings' });
      }
    }
  }

  const mine = (p) => p && p.sync === 'cloud' && p.ownerId === uid;
  for (const p of r.projects) {
    const lp = localProjects.get(p.id);
    if (lp && !mine(lp)) continue; // 本地已改為僅本地（或屬於其他帳號）
    if (p.deleted) {
      if (lp) {
        await removeProjectLocal(p.id, { rehome: true });
        localProjects.delete(p.id);
        msgs.push({ t: 'projects', deleted: p.id, remote: true });
      }
      ops.push({ store: 'revs', del: p.id });
      continue;
    }
    seenP.add(p.id);
    if (!lp) {
      const rec = { id: p.id, name: p.name, createdAt: Date.parse(p.createdAt), updatedAt: Date.parse(p.updatedAt), sync: 'cloud', ownerId: uid };
      ops.push({ store: 'projects', put: rec });
      localProjects.set(p.id, rec);
      projectsChanged = true;
    } else if (!dirty.has(`p:${p.id}`) && lp.name !== p.name) {
      const rec = { ...lp, name: p.name, updatedAt: Date.parse(p.updatedAt) };
      ops.push({ store: 'projects', put: rec });
      localProjects.set(p.id, rec);
      projectsChanged = true;
    }
    if (!dirty.has(`p:${p.id}`)) ops.push({ store: 'revs', put: { id: p.id, rev: p.rev, projectId: p.id } });
  }

  // 依專案分組套用項目
  const byProject = new Map();
  for (const e of r.entries) {
    if (!byProject.has(e.projectId)) byProject.set(e.projectId, []);
    byProject.get(e.projectId).push(e);
  }
  for (const [pid, entries] of byProject) {
    const lp = localProjects.get(pid);
    if (!mine(lp)) continue;
    const local = await db.getAllByIndex('files', 'projectId', pid);
    const byId = new Map(local.map((f) => [f.id, f]));
    const pathOwner = new Map(local.map((f) => [f.path.toLowerCase(), f.id]));
    let structure = false;
    const contentIds = [];
    for (const e of entries) {
      if (!e.deleted) seenE.add(e.id);
      if (dirty.has(`e:${e.id}`)) continue; // 本地有未上傳的修改：上傳時再處理衝突
      const cur = byId.get(e.id);
      if (e.deleted) {
        if (cur) {
          ops.push({ store: 'files', del: e.id }, { store: 'tests', del: e.id });
          byId.delete(e.id);
          pathOwner.delete(cur.path.toLowerCase());
          structure = true;
        }
        ops.push({ store: 'revs', del: e.id });
        continue;
      }
      ops.push({ store: 'revs', put: { id: e.id, rev: e.rev, projectId: pid } });
      if (sameEntry(cur, e)) continue;
      // 同路徑已有其他本地項目
      const otherId = pathOwner.get(e.path.toLowerCase());
      if (otherId && otherId !== e.id) {
        const other = byId.get(otherId);
        if (other.kind === 'dir' && e.kind === 'dir') {
          ops.push({ store: 'files', del: other.id }, { store: 'dirty', del: `e:${other.id}` });
          byId.delete(other.id);
        } else {
          const taken = new Set(pathOwner.keys());
          const renamed = joinPath(dirname(other.path), uniqueName(dirname(other.path), basename(other.path), taken));
          const rec = { ...other, path: renamed, updatedAt: Date.now() };
          ops.push({ store: 'files', put: rec }, { store: 'dirty', put: { key: `e:${other.id}`, type: 'entry', id: other.id, projectId: pid, at: nextAt() } });
          byId.set(other.id, rec);
          pathOwner.set(renamed.toLowerCase(), other.id);
        }
        structure = true;
      }
      const rec = { ...(cur ?? {}), id: e.id, projectId: pid, path: e.path, kind: e.kind, updatedAt: Date.now() };
      if (e.kind === 'file') { rec.content = e.content ?? ''; delete rec.binary; }
      ops.push({ store: 'files', put: rec });
      if (cur) pathOwner.delete(cur.path.toLowerCase());
      pathOwner.set(e.path.toLowerCase(), e.id);
      byId.set(e.id, rec);
      if (!cur || cur.path !== e.path) structure = true;
      else contentIds.push(e.id);
    }
    if (structure) msgs.push({ t: 'files', projectId: pid, remote: true });
    for (const id of contentIds) msgs.push({ t: 'content', projectId: pid, id, remote: true });
  }

  if (ops.length) await db.batch(ops);
  if (projectsChanged) msgs.unshift({ t: 'projects', remote: true });
  for (const m of msgs) post(m);
}

/** 完整同步後：刪除雲端已不存在、且本地沒有未上傳修改的項目 */
async function removeMissing(uid, seenP, seenE) {
  const [projects, revs, dirtyList] = await Promise.all([db.getAll('projects'), db.getAll('revs'), db.getAll('dirty')]);
  const known = new Set(revs.map((r) => r.id));
  const dirty = new Set(dirtyList.map((d) => d.key));
  for (const p of projects) {
    if (p.sync !== 'cloud' || p.ownerId !== uid) continue;
    if (!seenP.has(p.id)) {
      if (known.has(p.id)) {
        await removeProjectLocal(p.id, { rehome: true });
        post({ t: 'projects', deleted: p.id, remote: true });
      }
      continue;
    }
    const files = await db.getAllByIndex('files', 'projectId', p.id);
    const gone = files.filter((f) => known.has(f.id) && !seenE.has(f.id) && !dirty.has(`e:${f.id}`));
    if (gone.length) {
      await db.batch(gone.flatMap((f) => [{ store: 'files', del: f.id }, { store: 'tests', del: f.id }, { store: 'revs', del: f.id }]));
      post({ t: 'files', projectId: p.id, remote: true });
    }
  }
}

/**
 * 從本地移除專案。rehome：若有尚未上傳的修改，先把整個專案另存為新的雲端專案（spec_new §4.4）
 */
async function removeProjectLocal(projectId, { rehome = false } = {}) {
  const [project, files, tests, dirty] = await Promise.all([
    db.get('projects', projectId),
    db.getAllByIndex('files', 'projectId', projectId),
    db.getAllByIndex('tests', 'projectId', projectId),
    db.getAllByIndex('dirty', 'projectId', projectId),
  ]);
  if (!project) return null;
  const ops = [];
  let newProject = null;
  const hasLocalEdits = dirty.some((d) => d.type === 'entry' && files.some((f) => f.id === d.id && isSyncableEntry(f)));
  if (rehome && hasLocalEdits) {
    newProject = { ...project, id: db.newId(), name: `${project.name}（本地副本）`, updatedAt: Date.now() };
    ops.push({ store: 'projects', put: newProject });
    const at = nextAt();
    ops.push({ store: 'dirty', put: { key: `p:${newProject.id}`, type: 'project', id: newProject.id, projectId: newProject.id, at } });
    const idMap = new Map();
    for (const f of files) {
      const id = db.newId();
      idMap.set(f.id, id);
      ops.push({ store: 'files', put: { ...f, id, projectId: newProject.id } });
      ops.push({ store: 'dirty', put: { key: `e:${id}`, type: 'entry', id, projectId: newProject.id, at } });
    }
    for (const t of tests) if (idMap.has(t.fileId)) ops.push({ store: 'tests', put: { ...t, fileId: idMap.get(t.fileId), projectId: newProject.id } });
    toast(`專案「${project.name}」已在其他裝置被刪除；你尚未上傳的修改已另存為新專案`, 6000);
  }
  ops.push({ store: 'projects', del: projectId });
  for (const f of files) ops.push({ store: 'files', del: f.id }, { store: 'revs', del: f.id });
  for (const t of tests) ops.push({ store: 'tests', del: t.fileId });
  for (const d of dirty) ops.push({ store: 'dirty', del: d.key });
  ops.push({ store: 'revs', del: projectId });
  await db.batch(ops);
  if (newProject) post({ t: 'projects', remote: true });
  return newProject;
}

// ---------- 上傳 ----------

async function pushAll(uid) {
  for (let round = 0; round < 30; round++) {
    if (session?.userId !== uid) return;
    const [dirty, projectList, revList, meta, settings] = await Promise.all([
      db.getAll('dirty'), db.getAll('projects'), db.getAll('revs'), db.get('meta', metaKey(uid)), db.get('settings', 'global'),
    ]);
    const projects = new Map(projectList.filter((p) => p.ownerId === uid || p.sync !== 'cloud').map((p) => [p.id, p]));
    const relevant = dirty.filter((d) => {
      const p = projectList.find((x) => x.id === d.projectId);
      return !p || p.ownerId === uid || d.deleteRemote;
    });
    const files = new Map();
    for (const d of relevant) {
      if (d.type !== 'entry') continue;
      const f = await db.get('files', d.id);
      if (f) files.set(d.id, f);
    }
    const revs = new Map(revList.map((r) => [r.id, r.rev]));
    const { changes, sent, skipped, more } = buildChanges({ dirty: relevant, files, projects, revs, limits: auth.config?.limits });
    await handleSkipped(skipped, files);
    const settingsAt = meta?.settingsDirty;
    if (settingsAt) {
      const value = {};
      for (const k of SYNCED_SETTINGS) if (settings?.value && k in settings.value) value[k] = settings.value[k];
      changes.unshift({ type: 'settings', op: 'put', data: { value } });
      sent.unshift(null);
    }
    if (!changes.length) return;
    const r = await api('/sync', { method: 'POST', body: { changes } });
    syncState.usedBytes = r.usedBytes;
    syncState.quotaBytes = r.quotaBytes;
    await handleResults(uid, r.results, changes, sent, files, settingsAt);
    // 繼續下一輪：還有沒送完的、衝突副本、或上傳期間的新修改；被拒的項目會被略過，沒有變更時結束
    if (!more && !changes.some((c) => c.type !== 'settings')) return;
  }
}

async function handleSkipped(skipped, files) {
  const clear = [];
  const ops = [];
  for (const { dirty: d, reason } of skipped) {
    if (reason === 'noop' || reason === 'not_syncable') clear.push(d);
    else if (reason === 'too_large') {
      const f = files.get(d.id);
      if (d.error !== 'too_large' || d.errorAt !== f?.updatedAt) ops.push({ store: 'dirty', put: { ...d, error: 'too_large', errorAt: f?.updatedAt ?? 0 } });
      warnOnce('too_large', `${f ? basename(f.path) : '檔案'} ${REJECT_MESSAGES.too_large}`);
    }
  }
  if (ops.length) await db.batch(ops);
  await clearDirty(clear);
}

/** 只在 dirty 紀錄沒有被更新過時刪除（避免刪掉上傳期間的新修改） */
async function clearDirty(list) {
  const items = list.filter(Boolean);
  if (!items.length) return;
  await db.transact(['dirty'], async ({ dirty }, P) => {
    for (const d of items) {
      const cur = await P(dirty.get(d.key));
      if (cur && cur.at === d.at) dirty.delete(d.key);
    }
  });
}

function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  toast(message, 5000);
}

async function handleResults(uid, results, changes, sent, files, settingsAt) {
  const ops = [];
  const clear = [];
  const msgs = [];
  const touched = new Set();
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const c = changes[i];
    const d = sent[i];
    if (c.type === 'settings') {
      if (r.status === 'ok') {
        const meta = await db.get('meta', metaKey(uid));
        if (meta?.settingsDirty === settingsAt) await db.put('meta', { ...meta, settingsDirty: 0 });
      }
      continue;
    }
    if (r.status === 'ok') {
      if (c.op === 'delete') {
        ops.push({ store: 'revs', del: c.id });
        if (c.type === 'project') {
          const revs = await db.getAll('revs');
          for (const x of revs) if (x.projectId === c.id) ops.push({ store: 'revs', del: x.id });
        }
      } else {
        ops.push({ store: 'revs', put: { id: c.id, rev: r.rev, projectId: c.type === 'project' ? c.id : c.data.projectId } });
        if (c.type === 'entry' && r.path && r.path !== c.data.path) {
          // 伺服器因撞名而改名
          const f = await db.get('files', c.id);
          if (f && f.path === c.data.path) {
            ops.push({ store: 'files', put: { ...f, path: r.path } });
            touched.add(f.projectId);
            toast(`${c.data.path} 與雲端上的檔案同名，已改名為 ${basename(r.path)}`, 5000);
          }
        }
      }
      clear.push(d);
    } else if (r.status === 'merged') {
      // 資料夾與雲端上的同名資料夾合併
      const cur = r.current;
      ops.push({ store: 'files', del: c.id }, { store: 'revs', del: c.id });
      ops.push({ store: 'files', put: { id: cur.id, projectId: cur.projectId, path: cur.path, kind: 'dir', updatedAt: Date.now() } });
      ops.push({ store: 'revs', put: { id: cur.id, rev: cur.rev, projectId: cur.projectId } });
      ops.push({ store: 'dirty', del: d.key });
      touched.add(cur.projectId);
    } else if (r.status === 'conflict') {
      await resolveConflict(c, r.current, d, ops, msgs, touched);
    } else if (r.status === 'rejected') {
      const f = files.get(c.id);
      ops.push({ store: 'dirty', put: { ...d, error: r.reason, errorAt: f?.updatedAt ?? 0 } });
      if (REJECT_MESSAGES[r.reason]) {
        const name = f ? basename(f.path) : c.type === 'project' ? `專案「${c.data?.name ?? ''}」` : '';
        warnOnce(r.reason, `${name} ${REJECT_MESSAGES[r.reason]}`.trim());
      }
    }
  }
  if (ops.length) await db.batch(ops);
  await clearDirty(clear);
  for (const pid of touched) post({ t: 'files', projectId: pid, remote: true, quiet: true });
  for (const m of msgs) post(m);
}

async function resolveConflict(c, cur, d, ops, msgs, touched) {
  if (c.type === 'project') {
    // 雲端已刪除此專案，本地卻有修改：另存為新的雲端專案
    await removeProjectLocal(c.id, { rehome: true });
    msgs.push({ t: 'projects', deleted: c.id, remote: true });
    return;
  }
  const f = await db.get('files', c.id);
  if (c.op === 'delete') {
    // 本地刪除 vs 雲端修改：保留雲端版本
    ops.push({ store: 'files', put: { id: cur.id, projectId: cur.projectId, path: cur.path, kind: cur.kind, content: cur.content, updatedAt: Date.now() } });
    ops.push({ store: 'revs', put: { id: cur.id, rev: cur.rev, projectId: cur.projectId } }, { store: 'dirty', del: d.key });
    touched.add(cur.projectId);
    toast(`${basename(cur.path)} 在其他裝置被修改，已還原`, 5000);
    return;
  }
  if (!f) { ops.push({ store: 'dirty', del: d.key }); return; }
  const siblings = await db.getAllByIndex('files', 'projectId', f.projectId);
  const taken = new Set(siblings.map((x) => x.path.toLowerCase()));
  if (cur.deleted) {
    // 本地修改 vs 雲端刪除：以新 id 重新上傳
    const id = db.newId();
    ops.push({ store: 'files', put: { ...f, id } }, { store: 'files', del: f.id }, { store: 'revs', del: f.id }, { store: 'dirty', del: d.key });
    ops.push({ store: 'dirty', put: { key: `e:${id}`, type: 'entry', id, projectId: f.projectId, at: nextAt() } });
    const t = await db.get('tests', f.id);
    if (t) ops.push({ store: 'tests', put: { ...t, fileId: id } }, { store: 'tests', del: f.id });
    touched.add(f.projectId);
    toast(`${basename(f.path)} 已在其他裝置被刪除，已重新上傳你的版本`, 5000);
    return;
  }
  // 雙方都修改：雲端版本寫入原檔，本地版本另存為衝突副本
  const copyPath = conflictCopyName(f.path, new Date(), taken);
  const copyId = db.newId();
  ops.push({ store: 'files', put: { ...f, path: cur.path, content: cur.content, updatedAt: Date.now() } });
  ops.push({ store: 'revs', put: { id: f.id, rev: cur.rev, projectId: f.projectId } }, { store: 'dirty', del: d.key });
  ops.push({ store: 'files', put: { id: copyId, projectId: f.projectId, path: copyPath, kind: 'file', content: f.content ?? '', updatedAt: Date.now() } });
  ops.push({ store: 'dirty', put: { key: `e:${copyId}`, type: 'entry', id: copyId, projectId: f.projectId, at: nextAt() } });
  touched.add(f.projectId);
  msgs.push({ t: 'content', projectId: f.projectId, id: f.id, remote: true });
  toast(`${basename(f.path)} 在其他裝置也被修改，你的版本已另存為 ${basename(copyPath)}`, 7000);
}

// ---------- 狀態 ----------

/** 從 dirty store 重新計算待上傳數與被拒的項目（各分頁都會執行） */
export function refreshStatus() {
  clearTimeout(statusTimer);
  statusTimer = setTimeout(async () => {
    try {
      const dirty = await db.getAll('dirty');
      const errors = {};
      const dirtyProjects = {};
      const errorProjects = {};
      let pending = 0;
      for (const d of dirty) {
        if (d.error) {
          if (d.type === 'entry') errors[d.id] = d.error;
          errorProjects[d.projectId] = true;
        } else {
          pending++;
          dirtyProjects[d.projectId] = (dirtyProjects[d.projectId] ?? 0) + 1;
        }
      }
      syncState.errors = errors;
      syncState.dirtyProjects = dirtyProjects;
      syncState.errorProjects = errorProjects;
      syncState.pending = pending;
    } catch { /* 略過 */ }
  }, 150);
}

function broadcastStatus() {
  post({ t: 'syncstatus', status: syncState.status, error: syncState.error, lastSync: syncState.lastSync, usedBytes: syncState.usedBytes, quotaBytes: syncState.quotaBytes });
}

channel?.addEventListener('message', (e) => {
  const m = e.data;
  if (!m) return;
  if (m.t === 'syncstatus') {
    if (!syncState.leader) {
      syncState.status = m.status;
      syncState.error = m.error;
      syncState.lastSync = m.lastSync;
      if (m.usedBytes != null) { syncState.usedBytes = m.usedBytes; syncState.quotaBytes = m.quotaBytes; }
    }
    refreshStatus();
    return;
  }
  if (m.t === 'syncnow') { syncNow(); return; }
  // 其他分頁（或本分頁的 store）寫入了資料：leader 排程上傳
  if (!m.remote && ['files', 'content', 'projects', 'tests', 'settings'].includes(m.t)) {
    schedulePush();
    refreshStatus();
  }
});

/** 要求同步（不是 leader 時請 leader 執行） */
export function requestSync() {
  if (syncState.leader) return syncNow();
  post({ t: 'syncnow' });
  return Promise.resolve(false);
}

if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
  window.addEventListener('online', () => syncNow());
}

/** 帳號中所有雲端專案的本地資料（下載所有專案、登出時使用） */
export async function ownedProjects(uid) {
  return (await db.getAll('projects')).filter((p) => p.sync === 'cloud' && p.ownerId === uid);
}

/** 登出：移除本機上此帳號的雲端專案，或保留為僅本地專案（以新的 id，與帳號脫鉤） */
export async function releaseAccountData(uid, { keep }) {
  const projects = await ownedProjects(uid);
  const ops = [];
  for (const p of projects) {
    const [files, tests, dirty] = await Promise.all([
      db.getAllByIndex('files', 'projectId', p.id),
      db.getAllByIndex('tests', 'projectId', p.id),
      db.getAllByIndex('dirty', 'projectId', p.id),
    ]);
    for (const d of dirty) ops.push({ store: 'dirty', del: d.key });
    ops.push({ store: 'projects', del: p.id }, { store: 'revs', del: p.id });
    for (const f of files) ops.push({ store: 'files', del: f.id }, { store: 'revs', del: f.id });
    for (const t of tests) ops.push({ store: 'tests', del: t.fileId });
    if (keep) {
      const np = { ...p, id: db.newId(), sync: 'local', ownerId: null };
      ops.push({ store: 'projects', put: np });
      const idMap = new Map();
      for (const f of files) {
        const id = db.newId();
        idMap.set(f.id, id);
        ops.push({ store: 'files', put: { ...f, id, projectId: np.id } });
      }
      for (const t of tests) if (idMap.has(t.fileId)) ops.push({ store: 'tests', put: { ...t, fileId: idMap.get(t.fileId), projectId: np.id } });
    }
  }
  ops.push({ store: 'meta', del: metaKey(uid) });
  await db.batch(ops);
  post({ t: 'projects' });
  await refreshProjects();
  refreshStatus();
}

/** 這台裝置上，此帳號尚未上傳的項目數 */
export async function pendingCount(uid) {
  const projects = new Set((await ownedProjects(uid)).map((p) => p.id));
  return (await db.getAll('dirty')).filter((d) => projects.has(d.projectId)).length;
}
