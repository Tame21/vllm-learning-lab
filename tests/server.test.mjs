import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { projectRoot } from '../scripts/project.mjs';

test('完整启动入口提供页面与相对源码，隐藏文件和目录越界被拦截', { timeout: 20_000 }, async (t) => {
  const child = spawn(process.execPath, ['scripts/start.mjs'], {
    cwd: projectRoot,
    windowsHide: true,
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  t.after(async () => {
    if (child.exitCode === null) {
      const stopped = once(child, 'exit');
      child.kill();
      await stopped;
    }
  });
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('启动超时')), 15_000);
    const clean = () => clearTimeout(timeout);
    child.once('error', (error) => {
      clean();
      reject(error);
    });
    child.once('exit', () => {
      clean();
      reject(Error('启动进程提前退出'));
    });
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clean();
        resolve(match[0]);
      }
    });
  });
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /vLLM Lab/);
  const index = await (await fetch(base + '/source-index.json')).text();
  assert.ok(!index.includes(projectRoot));
  const reference = await fetch(base + '/source/vllm/v1/engine/core.py');
  assert.equal(reference.status, 200);
  assert.match(await reference.text(), /class EngineCore/);
  assert.equal((await fetch(base + '/source/%2egit/config')).status, 403);
  assert.equal((await fetch(base + '/source/..%2fpackage.json')).status, 403);
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
});
