// 執行狀態與測資模式的執行流程（spec §6.3）
import { app, flushAll, testsOf, fileById, openTab, fileByPath } from './store.svelte.js';
import { runner } from './runner.js';
import { compare } from './compare.js';
import { normalizePath } from './paths.js';

export const run = $state({
  status: { kind: 'idle' }, // runner 回報的狀態
  running: false,
  mode: null, // 'tests' | 'terminal'
  fileId: null,
  results: {}, // fileId -> { caseId -> result }
  compile: {}, // fileId -> { error?, warnings? }
  goto: null, // { fileId, line, col, n }：要求編輯器跳到指定位置
});

runner.onStatus = (s) => { run.status = s; };

/** 執行時提供給程式的專案檔（只含文字檔） */
export function runFiles() {
  return app.files
    .filter((f) => f.kind === 'file' && typeof f.content === 'string')
    .map((f) => ({ path: f.path, content: f.content }));
}

export function timeLimitOf(fileId) {
  return testsOf(fileId)?.timeLimit ?? app.settings.timeLimit;
}

let stopRequested = false;

export async function runTests(fileId, caseIds = null) {
  if (run.running) return;
  const file = fileById(fileId);
  const t = testsOf(fileId);
  if (!file || !t) return;
  await flushAll();
  const cases = t.cases.filter((c) => (caseIds ? caseIds.includes(c.id) : c.enabled));
  if (!cases.length) return;
  runner.setClangSource(app.settings.clangSource);
  stopRequested = false;
  run.running = true;
  run.mode = 'tests';
  run.fileId = fileId;
  run.compile[fileId] = null;
  if (!run.results[fileId]) run.results[fileId] = {};
  const res = run.results[fileId]; // 取回 $state 代理，修改才會更新畫面
  for (const c of cases) res[c.id] = { status: 'pending' };
  const files = runFiles();
  const limitMs = timeLimitOf(fileId) * 1000;
  try {
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      if (stopRequested) { res[c.id] = { status: 'skipped' }; continue; }
      res[c.id] = { status: 'running' };
      let stdout = '';
      let stderr = '';
      const r = await runner.run({
        path: file.path,
        files,
        stdin: c.input,
        timeLimitMs: limitMs,
        onOutput: (chunks) => {
          for (const [fd, text] of chunks) {
            if (fd === 1) stdout += text; else stderr += text;
          }
        },
      });
      if (r.warnings) run.compile[fileId] = { warnings: r.warnings };
      if (r.status === 'ce') {
        run.compile[fileId] = { error: r.message, internal: r.internal };
        for (const rest of cases.slice(i)) res[rest.id] = { status: r.internal ? 'error-env' : 'ce' };
        break;
      }
      if (r.status === 'stopped') {
        res[c.id] = { status: 'stopped', stdout, stderr };
        stopRequested = true;
        continue;
      }
      const out = { stdout, stderr, time: r.time, message: r.message, exitCode: r.exitCode };
      if (r.status === 'tle') out.status = 'TLE';
      else if (r.status === 'ole') out.status = 'OLE';
      else if (r.status === 'error') out.status = 'RE';
      else if (c.expected === '') out.status = 'done';
      else {
        const cmp = compare(t.compare, stdout, c.expected);
        out.status = cmp.ok ? 'AC' : 'WA';
        out.detail = cmp.detail;
      }
      res[c.id] = out;
    }
  } finally {
    run.running = false;
    run.mode = null;
  }
}

export function stopRun() {
  stopRequested = true;
  runner.stop();
}

/** 跳到錯誤訊息中的位置（spec §6.2.1） */
export function gotoLocation(rawPath, line, col = 1) {
  const path = normalizePath(rawPath) ?? rawPath;
  const f = fileByPath(path) ?? app.files.find((x) => x.kind === 'file' && x.path.endsWith('/' + path));
  if (!f) return false;
  openTab(f.id);
  run.goto = { fileId: f.id, line, col, n: Math.random() };
  return true;
}

export const STATUS_LABELS = {
  AC: 'AC', WA: 'WA', TLE: 'TLE', RE: 'RE', OLE: '輸出過大', ce: 'CE', 'error-env': '環境錯誤',
  done: '完成', pending: '等待中', running: '執行中', skipped: '未執行', stopped: '已停止',
};

export function statusText(s) {
  const k = s.kind;
  if (k === 'loading-python') return '正在載入 Python 執行環境…';
  if (k === 'loading-cpp') return `正在下載 C++ 編譯器… ${s.pct ?? 0}%`;
  if (k === 'preparing-cpp') return '正在準備 C++ 編譯器…';
  if (k === 'compiling') return `編譯中：${s.file ?? ''}`;
  if (k === 'running') return '執行中';
  return '';
}
