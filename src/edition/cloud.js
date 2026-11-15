// 雲端版（spec_new.md）：帳號、雲端同步、自家分享、管理頁
import TopBar from '../cloud/CloudTopBar.svelte';
import Modals from '../cloud/CloudModals.svelte';
import SharePage from '../cloud/SharePage.svelte';
import AdminPage from '../cloud/AdminPage.svelte';
import { hooks, currentProject, refreshProjects } from '../lib/store.svelte.js';
import { auth, ownerId, onAuthChange, loadSiteConfig, refreshMe } from '../cloud/auth.svelte.js';
import { augmentOps, settingsChanged, startSync, stopSync, syncState, refreshStatus } from '../cloud/sync.svelte.js';
import { isSyncableEntry, REJECT_MESSAGES } from '../cloud/syncLogic.js';
import { linkLocalProjects, makeLocal, uploadProject } from '../cloud/flows.js';

export { TopBar, Modals };

export function PageFor(route) {
  if (/^#\/s\/[^/]+/.test(route)) return SharePage;
  if (route.startsWith('#/admin')) return AdminPage;
  return null;
}

export function handleRoute() {
  return false;
}

export function setup() {
  hooks.projectDefaults = () => {
    const uid = ownerId();
    return uid ? { sync: 'cloud', ownerId: uid } : { sync: 'local' };
  };
  hooks.visible = (p) => p.sync !== 'cloud' || p.ownerId === ownerId();
  hooks.augment = augmentOps;
  hooks.settingsChanged = settingsChanged;
  hooks.entryBadge = (e) => {
    if (currentProject()?.sync !== 'cloud') return null;
    if (e.kind === 'file' && !isSyncableEntry(e)) return { icon: '💻', title: '僅本地：此類檔案不會上傳到雲端' };
    const err = syncState.errors[e.id];
    if (err) return { icon: '💻', title: `僅本地：${REJECT_MESSAGES[err] ?? err}` };
    return null;
  };
  hooks.projectBadge = (p) => {
    if (p.sync !== 'cloud') return ownerId() ? { icon: '💻', title: '僅本地' } : null;
    if (syncState.errorProjects[p.id]) return { icon: '⚠️', title: '部分檔案無法上傳（同步錯誤）' };
    if (syncState.dirtyProjects[p.id]) return { icon: '⏳', title: syncState.status === 'syncing' ? '同步中' : '有未上傳的修改' };
    return { icon: '☁️', title: '已同步' };
  };
  hooks.projectActions = (p) => {
    if (!auth.user) return [];
    return p.sync === 'cloud'
      ? [{ label: '改為僅本地', run: () => makeLocal(p) }]
      : [{ label: '上傳到雲端', run: () => uploadProject(p.id) }];
  };
  loadSiteConfig();
  onAuthChange(onAuth);
}

export async function afterInit() {
  refreshStatus();
  if (!auth.user) return;
  refreshMe().catch(() => { /* 離線或已失效 */ });
  await linkLocalProjects(auth.user.id);
  startSync();
}

async function onAuth(user, { reason }) {
  await refreshProjects();
  if (user) {
    if (reason === 'login') await linkLocalProjects(user.id);
    startSync();
  } else {
    stopSync();
  }
  refreshStatus();
}
