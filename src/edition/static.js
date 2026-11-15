// 純前端版（spec.md）：Code Noter 分享與匯入
import TopBar from './StaticTopBar.svelte';
import Modals from './StaticModals.svelte';

export { TopBar, Modals };
export const PageFor = () => null;
export function setup() {}
export function afterInit() {}

/** 直接連結匯入：#/import/<ID>（spec §8.3）；回傳 true 表示已處理且要把網址改回 #/ */
export function handleRoute(hash, open) {
  const m = hash.match(/^#\/import\/(.+)$/);
  if (!m) return false;
  open({ kind: 'import', id: decodeURIComponent(m[1]) });
  return true;
}
