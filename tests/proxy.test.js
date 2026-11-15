// 代理的路由與 CORS 檢查（不會連到上游，只測不需轉送的情況）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { isAllowedOrigin } from '../proxy/worker.js';

const env = { ALLOWED_ORIGINS: 'https://ok.example' };
const call = (path, init = {}) => worker.fetch(new Request(`https://proxy.test${path}`, init), env);

test('來源檢查', () => {
  assert.equal(isAllowedOrigin('https://ok.example', env.ALLOWED_ORIGINS), true);
  assert.equal(isAllowedOrigin('https://evil.example', env.ALLOWED_ORIGINS), false);
  assert.equal(isAllowedOrigin('', env.ALLOWED_ORIGINS), false);
});

test('未知路徑回 404', async () => {
  const r = await call('/admin', { headers: { Origin: 'https://ok.example' } });
  assert.equal(r.status, 404);
});

test('預檢請求', async () => {
  const ok = await call('/api/code', { method: 'OPTIONS', headers: { Origin: 'https://ok.example' } });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://ok.example');
  const bad = await call('/api/code', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('不允許的來源、錯誤的方法與格式', async () => {
  assert.equal((await call('/api/code/abc', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('/api/code', { headers: { Origin: 'https://ok.example' } })).status, 405);
  assert.equal((await call('/api/code', { method: 'POST', body: 'x', headers: { Origin: 'https://ok.example', 'Content-Type': 'text/plain' } })).status, 415);
  const big = JSON.stringify({ code: 'x'.repeat(300 * 1024) });
  assert.equal((await call('/api/code', { method: 'POST', body: big, headers: { Origin: 'https://ok.example', 'Content-Type': 'application/json' } })).status, 413);
});
