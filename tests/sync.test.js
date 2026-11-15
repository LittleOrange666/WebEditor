// 雲端版同步邏輯與多專案 zip（spec_new §4、§4.6）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChanges, conflictCopyName, isSyncablePath, isSyncableEntry, sameEntry } from '../src/cloud/syncLogic.js';
import { parseShareId } from '../src/cloud/api.js';
import { buildMultiZip, readMultiZip, readZip, buildZip } from '../src/lib/zip.js';

const limits = { file_bytes: 1000 };
const d = (type, id, projectId, extra = {}) => ({ key: `${type[0]}:${id}`, type, id, projectId, at: 1, ...extra });

test('可同步的檔案類型', () => {
  for (const p of ['a.cpp', 'b/C.HPP', 'x.py', 'y.js', 'z.cc', 'w.cxx', 'h.h']) assert.ok(isSyncablePath(p), p);
  for (const p of ['a.txt', 'a.in', 'readme.md', 'a.cpp.bak']) assert.ok(!isSyncablePath(p), p);
  assert.ok(isSyncableEntry({ kind: 'dir', path: 'src' }));
  assert.ok(!isSyncableEntry({ kind: 'file', path: 'a.cpp', binary: new ArrayBuffer(1) }));
});

test('衝突副本檔名', () => {
  const t = new Date(2026, 10, 15, 14, 5);
  assert.equal(conflictCopyName('src/main.cpp', t), 'src/main (衝突副本 2026-11-15 1405).cpp');
  assert.equal(conflictCopyName('Makefile', t), 'Makefile (衝突副本 2026-11-15 1405)');
  const taken = new Set(['main (衝突副本 2026-11-15 1405).cpp']);
  assert.equal(conflictCopyName('main.cpp', t, taken), 'main (衝突副本 2026-11-15 1405 2).cpp');
});

test('buildChanges：排序、略過、刪除', () => {
  const projects = new Map([['p', { id: 'p', name: 'P', sync: 'cloud' }], ['q', { id: 'q', name: 'Q', sync: 'local' }]]);
  const files = new Map([
    ['f1', { id: 'f1', projectId: 'p', path: 'src/a/main.cpp', kind: 'file', content: 'x', updatedAt: 5 }],
    ['d2', { id: 'd2', projectId: 'p', path: 'src/a', kind: 'dir' }],
    ['d1', { id: 'd1', projectId: 'p', path: 'src', kind: 'dir' }],
    ['t', { id: 't', projectId: 'p', path: 'notes.txt', kind: 'file', content: 'hi' }],
    ['big', { id: 'big', projectId: 'p', path: 'big.py', kind: 'file', content: 'y'.repeat(1001) }],
    ['bad', { id: 'bad', projectId: 'p', path: 'bad.js', kind: 'file', content: 'z', updatedAt: 9 }],
  ]);
  const revs = new Map([['gone', 7], ['p', 3], ['old', 2]]);
  const dirty = [
    d('entry', 'f1', 'p'), d('entry', 'd2', 'p'), d('project', 'p', 'p'), d('entry', 'd1', 'p'),
    d('entry', 't', 'p'), d('entry', 'big', 'p'), d('entry', 'gone', 'p'), d('entry', 'never', 'p'),
    d('entry', 'bad', 'p', { error: 'quota_exceeded', errorAt: 9 }),
    d('project', 'old', 'old'), d('entry', 'inold', 'old'),
  ];
  const { changes, skipped } = buildChanges({ dirty, files, projects, revs, limits });
  assert.deepEqual(changes.map((c) => `${c.type}:${c.op}:${c.id}`), [
    'project:put:p', 'entry:put:d1', 'entry:put:d2', 'entry:put:f1', 'entry:delete:gone', 'project:delete:old',
  ]);
  assert.equal(changes[0].baseRev, 3);
  assert.equal(changes[4].baseRev, 7);
  const reasons = Object.fromEntries(skipped.map((s) => [s.dirty.id, s.reason]));
  assert.deepEqual(reasons, { t: 'not_syncable', big: 'too_large', never: 'noop', bad: 'retry_later', inold: 'noop' });
});

test('buildChanges：被拒的檔案修改後重試、改成非程式檔時刪除雲端副本', () => {
  const projects = new Map([['p', { id: 'p', name: 'P', sync: 'cloud' }]]);
  const files = new Map([
    ['a', { id: 'a', projectId: 'p', path: 'a.js', kind: 'file', content: 'new', updatedAt: 10 }],
    ['b', { id: 'b', projectId: 'p', path: 'b.txt', kind: 'file', content: 'x' }],
  ]);
  const revs = new Map([['b', 4]]);
  const dirty = [d('entry', 'a', 'p', { error: 'quota_exceeded', errorAt: 9 }), d('entry', 'b', 'p')];
  const { changes } = buildChanges({ dirty, files, projects, revs, limits });
  assert.deepEqual(changes.map((c) => `${c.op}:${c.id}`), ['put:a', 'delete:b']);
});

test('buildChanges：分批', () => {
  const projects = new Map([['p', { id: 'p', name: 'P', sync: 'cloud' }]]);
  const files = new Map();
  const dirty = [];
  for (let i = 0; i < 10; i++) {
    files.set(`f${i}`, { id: `f${i}`, projectId: 'p', path: `f${i}.js`, kind: 'file', content: 'x'.repeat(300) });
    dirty.push(d('entry', `f${i}`, 'p'));
  }
  const r = buildChanges({ dirty, files, projects, revs: new Map(), limits, maxBytes: 1200 });
  assert.equal(r.changes.length, 2);
  assert.equal(r.sent.length, 2);
  assert.ok(r.more);
});

test('sameEntry 與分享 ID', () => {
  assert.ok(sameEntry({ path: 'a', kind: 'file', content: 'x' }, { path: 'a', kind: 'file', content: 'x' }));
  assert.ok(!sameEntry({ path: 'a', kind: 'file', content: 'x' }, { path: 'b', kind: 'file', content: 'x' }));
  assert.ok(sameEntry({ path: 'd', kind: 'dir' }, { path: 'd', kind: 'dir' }));
  assert.equal(parseShareId('https://x.example/app/#/s/AbC123xyZ0'), 'AbC123xyZ0');
  assert.equal(parseShareId('https://x.example/#/s/AbC123xyZ0/import'), 'AbC123xyZ0');
  assert.equal(parseShareId(' AbC123xyZ0 '), 'AbC123xyZ0');
  assert.equal(parseShareId('nope!'), null);
});

test('多專案 zip 往返', async () => {
  const p1 = {
    name: '作業',
    entries: [{ id: '1', path: 'src', kind: 'dir' }, { id: '2', path: 'src/main.cpp', kind: 'file', content: 'int main(){}' }],
    tests: { 2: { fileId: '2', cases: [{ name: 'a', input: '1', expected: '2', enabled: true }], timeLimit: 3, compare: 'tokens' } },
  };
  const p2 = { name: '作業', entries: [{ id: '3', path: 'a.py', kind: 'file', content: 'print(1)' }], tests: {} };
  const multi = await readMultiZip(await buildMultiZip([p1, p2]));
  assert.equal(multi.length, 2);
  const one = multi.find((m) => m.files.some((f) => f.path === 'src/main.cpp'));
  assert.equal(one.meta.tests['src/main.cpp'].cases[0].expected, '2');
  assert.equal(one.meta.tests['src/main.cpp'].timeLimit, 3);
  // 單一專案的 zip 不是多專案格式
  const single = await buildZip(p1.entries, { tests: p1.tests, projectName: 'x' });
  assert.equal(await readMultiZip(single), null);
  assert.equal((await readZip(single)).files[0].path, 'src/main.cpp');
});
