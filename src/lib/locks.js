// 編輯鎖（spec §4.3）：同一個檔案一次只能在一個分頁編輯
// 以 Web Locks API 實作；鎖被占用時排隊等待，持有者關閉分頁後自動取得

export const LOCKS_SUPPORTED = typeof navigator !== 'undefined' && !!navigator.locks?.request;

const lockName = (id) => `webeditor-file-${id}`;

export class LockManager {
  /** onChange(fileId, state)：state 為 'held' | 'waiting' | 'none' */
  constructor(onChange) {
    this.onChange = onChange;
    this.entries = new Map(); // fileId -> { state, release, abort }
  }

  state(id) {
    if (!LOCKS_SUPPORTED) return 'held';
    return this.entries.get(id)?.state ?? 'none';
  }

  _set(id, state) {
    const e = this.entries.get(id);
    if (e) e.state = state;
    this.onChange(id, state);
  }

  /** 開始持有（或排隊等待）某檔案的鎖 */
  acquire(id) {
    if (!LOCKS_SUPPORTED) { this.onChange(id, 'held'); return; }
    if (this.entries.has(id)) return;
    const abort = new AbortController();
    const entry = { state: 'waiting', release: null, abort };
    this.entries.set(id, entry);
    this.onChange(id, 'waiting');
    navigator.locks.request(lockName(id), { signal: abort.signal }, () => {
      if (this.entries.get(id) !== entry) return undefined; // 已經放棄
      this._set(id, 'held');
      return new Promise((resolve) => { entry.release = resolve; });
    }).catch(() => { /* 取消等待 */ });
  }

  /** 放棄鎖（關閉編輯分頁時） */
  release(id) {
    const e = this.entries.get(id);
    if (!e) return;
    this.entries.delete(id);
    if (e.release) e.release();
    else e.abort.abort();
    this.onChange(id, 'none');
  }

  /** 交出鎖並重新排隊（其他分頁要求「在這裡編輯」時） */
  yieldLock(id) {
    const e = this.entries.get(id);
    if (!e || e.state !== 'held') return;
    this.entries.delete(id);
    e.release?.();
    this.acquire(id);
  }

  releaseAll() {
    for (const id of [...this.entries.keys()]) this.release(id);
  }
}
