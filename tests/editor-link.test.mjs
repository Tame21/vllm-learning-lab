import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { projectRoot } from '../scripts/project.mjs';
import {
  resolvePublicFile,
  vscodeFileTarget,
  assertEditorRequest,
} from '../scripts/source-files.mjs';
import { requestEditorTarget } from '../src/source-editor.mjs';

test('VS Code URL 在 Windows / POSIX 路径中保留文件和行列，特殊字符不能改变 URL 语义', () => {
  for (const file of [
    'C:\\workspace\\源码 #1%\\model.py',
    '/work/源码 #1%/model.py',
    '/work/a?b&c/中文.py',
  ]) {
    const result = vscodeFileTarget(file, 127);
    const url = new URL(result.url);
    assert.equal(url.protocol, 'vscode:');
    assert.equal(url.host, 'file');
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
    const expected = file.replaceAll('\\', '/');
    assert.equal(
      decodeURIComponent(url.pathname),
      (expected.startsWith('/') ? '' : '/') + expected + ':127:1',
    );
    assert.equal(result.location, file + ':127:1');
  }
  for (const line of [0, -1, 1.5, 1_000_001, NaN, '17'])
    assert.throws(() => vscodeFileTarget('/work/a.py', line));
  assert.throws(() => vscodeFileTarget('relative.py', 1));
  assert.throws(() => vscodeFileTarget('/work/a\n.py', 1));
});

test('定位服务拒绝其他网站与非本机 Host 获取本机路径', () => {
  for (const host of ['127.0.0.1:4173', 'localhost:4173']) {
    assert.doesNotThrow(() => assertEditorRequest({ headers: { host } }, 4173));
    assert.doesNotThrow(() =>
      assertEditorRequest(
        { headers: { host, origin: 'http://' + host, 'sec-fetch-site': 'same-origin' } },
        4173,
      ),
    );
  }
  for (const headers of [
    { host: 'rebind.example:4173' },
    { host: '127.0.0.1:4174' },
    {},
    { host: '127.0.0.1:4173', origin: 'https://other.example' },
    { host: '127.0.0.1:4173', origin: 'null' },
    { host: '127.0.0.1:4173', 'sec-fetch-site': 'cross-site' },
    { host: '127.0.0.1:4173', 'sec-fetch-site': 'same-site' },
  ])
    assert.throws(
      () => assertEditorRequest({ headers }, 4173),
      (error) => error.status === 403,
    );
});

test('前端请求使用相对文件名；异常响应不能变成任意外部协议链接', async () => {
  const target = vscodeFileTarget('/work/中文 #1.py', 17);
  const result = await requestEditorTarget('vllm/中文 #1.py', 17, async (url, options) => {
    const request = new URL(url, 'http://127.0.0.1:4173');
    assert.equal(request.pathname, '/api/editor-link');
    assert.equal(request.searchParams.get('path'), 'vllm/中文 #1.py');
    assert.equal(request.searchParams.get('line'), '17');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'same-origin');
    return { ok: true, json: async () => target };
  });
  assert.deepEqual(result, target);
  await assert.rejects(
    requestEditorTarget('vllm/a.py', 17, async () => ({ ok: false })),
    /重启本地服务/,
  );
  for (const bad of [
    { ...target, url: 'https://example.test/a:17:1' },
    { ...target, url: 'vscode://extension/example:17:1' },
    { ...target, url: target.url + '?command=run' },
    { ...target, url: target.url + '#fragment' },
    { ...target, url: target.url.replace(':17:1', ':18:1') },
    { ...target, location: 'bad\nlocation:17:1' },
  ])
    await assert.rejects(
      requestEditorTarget('vllm/a.py', 17, async () => ({ ok: true, json: async () => bad })),
    );
});

test(
  '本机服务按当前 VLLM_SOURCE_DIR 定位，仅向同源返回允许的真实文件',
  { timeout: 20_000 },
  async (t) => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vllm-editor-'));
    const root = path.join(temporary, 'reference with spaces'),
      outside = path.join(temporary, 'outside');
    fs.mkdirSync(path.join(root, 'vllm'), { recursive: true });
    fs.mkdirSync(path.join(root, '.git'));
    fs.mkdirSync(outside);
    const relative = 'vllm/示例 #1%.py',
      file = path.join(root, relative);
    fs.writeFileSync(file, '# example\nvalue = 1\n');
    fs.writeFileSync(path.join(root, '.git', 'config.py'), 'private');
    fs.writeFileSync(path.join(root, 'secret.pem'), 'not a source type');
    fs.writeFileSync(path.join(outside, 'outside.py'), 'outside');
    fs.symlinkSync(
      outside,
      path.join(root, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    fs.symlinkSync(
      path.join(root, '.git'),
      path.join(root, 'hidden-alias'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const child = spawn(process.execPath, ['server.mjs'], {
      cwd: projectRoot,
      windowsHide: true,
      env: { ...process.env, PORT: '0', VLLM_SOURCE_DIR: root },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(async () => {
      if (child.exitCode === null) {
        const stopped = once(child, 'exit');
        child.kill();
        await stopped;
      }
      fs.rmSync(temporary, { recursive: true, force: true });
    });
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('测试服务启动超时')), 10_000);
      let text = '';
      child.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(Error('测试服务提前退出'));
      });
      child.stdout.on('data', (chunk) => {
        text += chunk;
        const match = text.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      });
    });
    const route = (file, line = '2') =>
      base + '/api/editor-link?' + new URLSearchParams({ path: file, line });
    const response = await fetch(route(relative), {
      headers: { Origin: base, 'Sec-Fetch-Site': 'same-origin' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.deepEqual(await response.json(), vscodeFileTarget(fs.realpathSync(file), 2));
    assert.equal(
      await (
        await fetch(base + '/source/' + relative.split('/').map(encodeURIComponent).join('/'))
      ).text(),
      '# example\nvalue = 1\n',
    );
    const head = await fetch(route(relative), { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    const normal = await fetch(base + '/source-index.json');
    assert.equal(normal.status, 200);
    assert.ok(!(await normal.text()).includes(root));
    for (const blocked of [
      '../outside/outside.py',
      '.git/config.py',
      'escape/outside.py',
      'hidden-alias/config.py',
      file,
      'secret.pem',
    ]) {
      const denied = await fetch(route(blocked));
      assert.equal(denied.status, 403, blocked);
      assert.ok(!(await denied.text()).includes(root));
    }
    assert.throws(
      () => resolvePublicFile(fs.realpathSync(root), 'escape/outside.py'),
      (e) => e.status === 403,
    );
    assert.equal((await fetch(route('missing.py'))).status, 404);
    for (const line of ['0', '-1', '1.5', 'NaN', '1000001', '1:2', ''])
      assert.equal((await fetch(route(relative, line))).status, 400);
    assert.equal((await fetch(route(relative) + '&path=other.py')).status, 400);
    assert.equal((await fetch(base + '/api/editor-link')).status, 400);
    assert.equal(
      (await fetch(route(relative), { headers: { Origin: 'https://other.example' } })).status,
      403,
    );
    assert.equal(
      (await fetch(route(relative), { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status,
      403,
    );
    assert.equal((await fetch(route(relative), { method: 'POST' })).status, 405);
  },
);
