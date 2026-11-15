// IndexedDB 存取（spec §4.1）
// stores：
//   projects  { id, name, createdAt, updatedAt }
//   files     { id, projectId, path, kind: 'file' | 'dir', content?: string, binary?: ArrayBuffer, updatedAt }
//   tests     { fileId, projectId, cases: [{ id, name, input, expected }], timeLimit, compare }
//   settings  { key, value }

const DB_NAME = 'webeditor';
const VERSION = 1;

let dbPromise = null;

export function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('此瀏覽器不支援 IndexedDB')); return; }
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('projects', { keyPath: 'id' });
        const files = db.createObjectStore('files', { keyPath: 'id' });
        files.createIndex('projectId', 'projectId');
        const tests = db.createObjectStore('tests', { keyPath: 'fileId' });
        tests.createIndex('projectId', 'projectId');
        db.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const db = req.result;
        // 其他分頁升級資料庫版本時關閉連線，避免卡住
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('資料庫被其他分頁占用，請重新整理'));
    }).catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('交易中止'));
  });
}

export async function get(store, key) {
  const db = await openDb();
  return promisify(db.transaction(store).objectStore(store).get(key));
}

export async function getAll(store) {
  const db = await openDb();
  return promisify(db.transaction(store).objectStore(store).getAll());
}

export async function getAllByIndex(store, index, key) {
  const db = await openDb();
  return promisify(db.transaction(store).objectStore(store).index(index).getAll(key));
}

/** 一次寫入／刪除多筆：ops = [{ store, put: value } | { store, del: key }] */
export async function batch(ops) {
  if (!ops.length) return;
  const db = await openDb();
  const stores = [...new Set(ops.map((o) => o.store))];
  const tx = db.transaction(stores, 'readwrite');
  for (const o of ops) {
    const s = tx.objectStore(o.store);
    if ('put' in o) s.put(o.put);
    else s.delete(o.del);
  }
  await done(tx);
}

export const put = (store, value) => batch([{ store, put: value }]);
export const del = (store, key) => batch([{ store, del: key }]);

export function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
