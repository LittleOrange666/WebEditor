// 在本機以 Node 執行 proxy/worker.js（不需要 Wrangler），方便開發測試
// 用法：node scripts/proxy-dev.mjs [port] [allowedOrigins]
import http from 'node:http';
import worker from '../proxy/worker.js';

const port = Number(process.argv[2] ?? 8787);
const env = { ALLOWED_ORIGINS: process.argv[3] ?? 'http://localhost:5173,http://localhost:4173' };

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://localhost:${port}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : body,
  });
  const out = await worker.fetch(request, env);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(port, () => console.log(`proxy at http://localhost:${port}（允許 ${env.ALLOWED_ORIGINS}）`));
