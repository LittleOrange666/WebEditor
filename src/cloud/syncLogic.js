// 同步引擎的純邏輯（spec_new §4），不碰 IndexedDB 與網路，方便測試
import { basename, dirname, joinPath, splitExt } from '../lib/paths.js';

/** 會上傳到雲端的程式檔（spec_new §4.1） */
export const SYNC_EXTS = ['.cpp', '.cc', '.cxx', '.h', '.hpp', '.py', '.js'];

export function isSyncablePath(path) {
  const p = path.toLowerCase();
  return SYNC_EXTS.some((e) => p.endsWith(e));
}

/** 項目是否會同步：資料夾一律同步；檔案需為程式檔且是 UTF-8 文字 */
export function isSyncableEntry(e) {
  if (!e) return false;
  if (e.kind === 'dir') return true;
  return !e.binary && isSyncablePath(e.path);
}

export const byteLength = (s) => new TextEncoder().encode(s ?? '').length;

const pad = (n) => String(n).padStart(2, '0');

/** 衝突副本檔名：main (衝突副本 2026-11-15 1430).cpp（spec_new §4.4） */
export function conflictCopyName(path, date = new Date(), takenLower = new Set()) {
  const dir = dirname(path);
  const [stem, ext] = splitExt(basename(path));
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}`;
  let name = `${stem} (衝突副本 ${stamp})${ext}`;
  for (let i = 2; takenLower.has(joinPath(dir, name).toLowerCase()); i++) name = `${stem} (衝突副本 ${stamp} ${i})${ext}`;
  return joinPath(dir, name);
}

/**
 * 由待同步紀錄組出要上傳的變更（spec_new §4.3）
 * dirty：dirty store 的紀錄；files / projects：id → 本地紀錄（不存在表示已刪除）
 * revs：id → 伺服器 rev；limits：伺服器的大小上限
 * 回傳 { changes, sent: dirty 紀錄（與 changes 對應）, skipped: [{ dirty, reason }] }
 */
export function buildChanges({ dirty, files, projects, revs, limits, maxBytes = 3_500_000, maxChanges = 300 }) {
  const projectPuts = [];
  const dirPuts = [];
  const filePuts = [];
  const entryDeletes = [];
  const projectDeletes = [];
  const skipped = [];
  const deletedProjects = new Set();

  for (const d of dirty) {
    if (d.type !== 'project') continue;
    const p = projects.get(d.id);
    if (!p || d.deleteRemote) {
      deletedProjects.add(d.id);
      if (revs.has(d.id)) projectDeletes.push([{ type: 'project', id: d.id, op: 'delete', baseRev: revs.get(d.id) }, d]);
      else skipped.push({ dirty: d, reason: 'noop' });
    } else if (p.sync === 'cloud') {
      projectPuts.push([{ type: 'project', id: d.id, op: 'put', baseRev: revs.get(d.id) ?? 0, data: { name: p.name } }, d]);
    } else {
      skipped.push({ dirty: d, reason: 'noop' });
    }
  }

  for (const d of dirty) {
    if (d.type !== 'entry') continue;
    const e = files.get(d.id);
    const p = e ? projects.get(e.projectId) : projects.get(d.projectId);
    const known = revs.has(d.id);
    if (deletedProjects.has(d.projectId) || (e && deletedProjects.has(e.projectId))) {
      skipped.push({ dirty: d, reason: 'noop' }); // 專案刪除時伺服器會一併刪除
      continue;
    }
    if (!e || !p || p.sync !== 'cloud' || !isSyncableEntry(e)) {
      if (known) entryDeletes.push([{ type: 'entry', id: d.id, op: 'delete', baseRev: revs.get(d.id) }, d]);
      else skipped.push({ dirty: d, reason: e && p?.sync === 'cloud' ? 'not_syncable' : 'noop' });
      continue;
    }
    if (d.error && d.errorAt === e.updatedAt) {
      skipped.push({ dirty: d, reason: 'retry_later' }); // 上次被拒且之後沒有修改
      continue;
    }
    const data = { projectId: e.projectId, path: e.path, kind: e.kind };
    if (e.kind === 'file') {
      data.content = e.content ?? '';
      if (limits && byteLength(data.content) > limits.file_bytes) {
        skipped.push({ dirty: d, reason: 'too_large' });
        continue;
      }
    }
    const change = { type: 'entry', id: d.id, op: 'put', baseRev: revs.get(d.id) ?? 0, data };
    (e.kind === 'dir' ? dirPuts : filePuts).push([change, d]);
  }

  // 依序：專案 → 資料夾（淺到深）→ 檔案 → 刪除檔案 → 刪除專案
  dirPuts.sort((a, b) => a[0].data.path.split('/').length - b[0].data.path.split('/').length);
  const ordered = [...projectPuts, ...dirPuts, ...filePuts, ...entryDeletes, ...projectDeletes];
  const changes = [];
  const sent = [];
  let bytes = 0;
  for (const [c, d] of ordered) {
    const size = byteLength(c.data?.content) + 200;
    if (changes.length && (changes.length >= maxChanges || bytes + size > maxBytes)) break;
    changes.push(c);
    sent.push(d);
    bytes += size;
  }
  return { changes, sent, skipped, more: changes.length < ordered.length };
}

/** 從同步結果的 rejected 原因取得提示文字 */
export const REJECT_MESSAGES = {
  too_large: '超過雲端單檔上限，只會存在這台裝置',
  not_syncable: '此類檔案不會上傳到雲端',
  project_too_large: '專案超過雲端上限，部分檔案只會存在這台裝置',
  quota_exceeded: '雲端空間已滿，新的修改只會存在這台裝置',
  too_many_projects: '雲端專案數已達上限，此專案只會存在這台裝置',
};

/** 本地紀錄與伺服器紀錄內容是否相同（相同就不必寫入） */
export function sameEntry(local, remote) {
  return !!local && local.path === remote.path && local.kind === remote.kind
    && (remote.kind === 'dir' || (local.content ?? '') === (remote.content ?? ''));
}
