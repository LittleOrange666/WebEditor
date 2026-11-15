// 帳號相關的流程（spec_new §3.2、§4.2、§4.6）：登出、第一次登入時上傳本地專案、下載所有專案、專案改為僅本地／上傳
import * as db from '../lib/db.js';
import { app, flushAll, refreshProjects, setProjectFields } from '../lib/store.svelte.js';
import { choiceDialog, confirmDialog, toast } from '../lib/dialog.svelte.js';
import { openModal } from '../lib/ui.svelte.js';
import { buildMultiZip, downloadBlob } from '../lib/zip.js';
import { auth, logout } from './auth.svelte.js';
import {
  syncState, syncAndWait, stopSync, ownedProjects, pendingCount, releaseAccountData, markProjectForUpload, detachProject,
} from './sync.svelte.js';

/** 登出：先同步，再詢問要移除或保留這台裝置上的雲端專案 */
export async function logoutFlow() {
  const user = auth.user;
  if (!user) return;
  await flushAll();
  if (syncState.leader) await syncAndWait();
  const projects = await ownedProjects(user.id);
  let keep = false;
  if (projects.length) {
    const pending = await pendingCount(user.id);
    let message = `要從這台裝置移除此帳號的 ${projects.length} 個雲端專案嗎？雲端上的資料不受影響。`;
    if (pending) message += `\n\n⚠️ 有 ${pending} 個項目尚未上傳到雲端，選擇「移除」將會遺失這些修改。`;
    const r = await choiceDialog({
      title: '登出',
      message,
      choices: [
        { value: 'remove', label: '移除', primary: !pending, danger: !!pending },
        { value: 'keep', label: '保留為僅本地專案' },
      ],
    });
    if (!r.value) return;
    keep = r.value === 'keep';
  }
  stopSync();
  await logout();
  await releaseAccountData(user.id, { keep });
  toast('已登出');
}

/** 第一次在這台裝置登入時，詢問要把哪些本地專案上傳到雲端 */
export async function linkLocalProjects(uid) {
  const key = `linked:${uid}`;
  if (await db.get('meta', key)) return;
  const local = (await db.getAll('projects')).filter((p) => p.sync !== 'cloud');
  let chosen = [];
  if (local.length) {
    chosen = await new Promise((resolve) => openModal({ kind: 'linkProjects', projects: local, resolve }));
  }
  for (const id of chosen) await uploadProject(id, uid);
  await db.put('meta', { key, at: Date.now() });
}

export async function uploadProject(id, uid = auth.user?.id) {
  if (!uid) return;
  await setProjectFields(id, { sync: 'cloud', ownerId: uid });
  await markProjectForUpload(id);
}

/** 改為僅本地：詢問是否同時刪除雲端上的副本 */
export async function makeLocal(project) {
  const r = await choiceDialog({
    title: '改為僅本地',
    message: `專案「${project.name}」之後不會再同步。\n要同時刪除雲端上的副本嗎？不刪除的話，雲端那份仍會出現在其他裝置。`,
    choices: [
      { value: 'keep', label: '保留雲端副本', primary: true },
      { value: 'delete', label: '刪除雲端副本', danger: true },
    ],
  });
  if (!r.value) return;
  await detachProject(project.id, { deleteRemote: r.value === 'delete' });
  await setProjectFields(project.id, { sync: 'local', ownerId: null });
  toast('已改為僅本地專案');
}

/** 下載此帳號的所有雲端專案（spec_new §4.6） */
export async function exportAllProjects() {
  const user = auth.user;
  if (!user) return;
  await flushAll();
  let ok = true;
  if (syncState.leader) ok = await syncAndWait();
  else ok = syncState.status === 'idle';
  if (!ok) {
    const go = await confirmDialog({ title: '同步失敗', message: '無法取得雲端上最新的內容。要以這台裝置上現有的內容下載嗎？', confirmLabel: '下載' });
    if (!go) return;
  }
  const projects = await ownedProjects(user.id);
  if (!projects.length) { toast('沒有雲端專案'); return; }
  const list = [];
  for (const p of projects.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))) {
    const [entries, tests] = await Promise.all([db.getAllByIndex('files', 'projectId', p.id), db.getAllByIndex('tests', 'projectId', p.id)]);
    list.push({ name: p.name, entries, tests: Object.fromEntries(tests.map((t) => [t.fileId, t])) });
  }
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  downloadBlob(await buildMultiZip(list), `webeditor-${user.username}-${stamp}.zip`);
}

/** 帳號被刪除後：清除本機資料並回到未登入狀態 */
export async function afterAccountDeleted(uid) {
  stopSync();
  await logout();
  await releaseAccountData(uid, { keep: false });
  await refreshProjects();
  if (!app.projects.length) await refreshProjects();
}
