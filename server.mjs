import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSourcePath } from './scripts/project.mjs';
const root = path.dirname(fileURLToPath(import.meta.url)),
  pub = path.join(root, 'dist');
const repo = fs.realpathSync(resolveSourcePath());
const port = process.env.PORT === undefined ? 4173 : Number(process.env.PORT);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw Error('PORT 必须是 0–65535 的整数。');
const types = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.md': 'text/plain',
  '.py': 'text/plain',
  '.rs': 'text/plain',
  '.cu': 'text/plain',
  '.h': 'text/plain',
  '.cuh': 'text/plain',
};
const server = http.createServer((req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end();
    }
    const url = new URL(req.url, 'http://localhost');
    const isSource = url.pathname.startsWith('/source/');
    const base = isSource ? repo : pub;
    const rel =
      decodeURIComponent(isSource ? url.pathname.slice(8) : url.pathname.slice(1)) || 'index.html';
    const full = path.resolve(base, rel);
    const relative = path.relative(base, full);
    if (
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      relative.split(/[\\/]/).some((v) => v.startsWith('.'))
    ) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const real = fs.realpathSync(full),
      inside = path.relative(base, real);
    if (inside.startsWith('..') || path.isAbsolute(inside) || !types[path.extname(full)]) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    res.writeHead(200, {
      'Content-Type': `${types[path.extname(full)]}; charset=utf-8`,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(full).pipe(res);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
  }
});
server.on('error', (e) => {
  console.error(`无法启动：${e.message}`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () =>
  console.log(`vLLM 学习实验室：http://127.0.0.1:${server.address().port}`),
);
