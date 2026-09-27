import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSourcePath } from './scripts/project.mjs';
import { resolvePublicFile, assertEditorRequest, editorTarget } from './scripts/source-files.mjs';
const root = path.dirname(fileURLToPath(import.meta.url)),
  pub = path.join(root, 'dist');
const repo = fs.realpathSync(resolveSourcePath());
const port = process.env.PORT === undefined ? 4173 : Number(process.env.PORT);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw Error('PORT 必须是 0–65535 的整数。');
const server = http.createServer((req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end();
    }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/editor-link') {
      assertEditorRequest(req, server.address().port);
      const target = editorTarget(repo, url.searchParams);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
      });
      return res.end(req.method === 'HEAD' ? undefined : JSON.stringify(target));
    }
    const isSource = url.pathname.startsWith('/source/');
    const base = isSource ? repo : pub;
    const rel =
      decodeURIComponent(isSource ? url.pathname.slice(8) : url.pathname.slice(1)) || 'index.html';
    const { file, type } = resolvePublicFile(base, rel);
    res.writeHead(200, {
      'Content-Type': `${type}; charset=utf-8`,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch (error) {
    const status = [400, 403, 404].includes(error.status) ? error.status : 400;
    res.writeHead(status, { 'Cache-Control': 'no-store' });
    res.end(status === 403 ? 'Forbidden' : status === 404 ? 'Not found' : 'Bad request');
  }
});
server.on('error', (e) => {
  console.error(`无法启动：${e.message}`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () =>
  console.log(`vLLM 学习实验室：http://127.0.0.1:${server.address().port}`),
);
