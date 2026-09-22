import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureSource } from '../scripts/setup-source.mjs';
import { resolveSourcePath, assertInside } from '../scripts/project.mjs';
import { inspectReleaseFile, checkRelease } from '../scripts/check-release.mjs';

function fixture(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, 'vllm-lab-test-'));
  t.after(() => {
    assertInside(root, parent);
    assert.ok(path.basename(root).startsWith('vllm-lab-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
}
function tree(root) {
  fs.mkdirSync(path.join(root, 'vllm/config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs/features'), { recursive: true });
  fs.writeFileSync(path.join(root, 'vllm/config/speculative.py'), '# fixture\n');
  fs.writeFileSync(path.join(root, 'docs/features/README.md'), '# fixture\n');
  fs.writeFileSync(path.join(root, 'LICENSE'), 'Fixture only\n');
}
function repository(root) {
  tree(root);
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'core.autocrlf', 'false');
  git(root, 'add', '.');
  git(root, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture');
  return git(root, 'rev-parse', 'HEAD');
}

test('源码位置默认在项目缓存，显式外部路径只读且不依赖同级目录', (t) => {
  const root = fixture(t),
    external = path.join(root, 'external');
  tree(external);
  assert.equal(resolveSourcePath({}, root), path.join(root, '.cache/vllm'));
  assert.equal(ensureSource({ root, env: { VLLM_SOURCE_DIR: external }, log: () => {} }), external);
  assert.equal(fs.existsSync(path.join(root, '.cache')), false);
  assert.equal(fs.existsSync(path.join(external, '.git')), false);
  assert.throws(
    () => ensureSource({ root, env: { VLLM_SOURCE_DIR: root }, log: () => {} }),
    /不完整/,
  );
  assert.throws(() => assertInside(root, root));
  assert.throws(() => assertInside(path.join(root, '..'), root));
});

test('首次准备固定 commit，复用离线缓存并拒绝覆盖本地修改', (t) => {
  const root = fixture(t),
    upstream = path.join(root, 'upstream'),
    app = path.join(root, 'app');
  fs.mkdirSync(upstream);
  fs.mkdirSync(app);
  const revision = repository(upstream);
  const options = { root: app, env: {}, repository: upstream, revision, log: () => {} };
  const cache = ensureSource(options);
  assert.equal(git(cache, 'rev-parse', 'HEAD'), revision);
  // A bogus upstream demonstrates that a valid cache does not perform a fetch.
  assert.equal(ensureSource({ ...options, repository: path.join(root, 'absent') }), cache);
  const source = path.join(cache, 'vllm/config/speculative.py');
  fs.writeFileSync(source, '# local edit\n');
  assert.throws(() => ensureSource(options), /本地改动/);
  assert.equal(fs.readFileSync(source, 'utf8'), '# local edit\n');
});

test('下载失败清理本次新建缓存与锁，错误版本与已有目录不会被重置', (t) => {
  const root = fixture(t),
    upstream = path.join(root, 'upstream'),
    app = path.join(root, 'app');
  fs.mkdirSync(upstream);
  fs.mkdirSync(app);
  const revision = repository(upstream);
  const options = { root: app, env: {}, repository: upstream, revision, log: () => {} };
  assert.throws(
    () => ensureSource({ ...options, repository: path.join(root, 'missing') }),
    /Git fetch/,
  );
  assert.deepEqual(fs.readdirSync(path.join(app, '.cache')), []);
  const cache = ensureSource(options);
  assert.throws(() => ensureSource({ ...options, revision: '1'.repeat(40) }), /版本与讲解基准不同/);
  assert.equal(git(cache, 'rev-parse', 'HEAD'), revision);
});

test('发布检查识别私人路径、令牌与生成物，保留合法相对源码路径', () => {
  const personal = ['C:', 'Users', 'example-user', 'project'].join('\\');
  const credential = 'ghp_' + 'X'.repeat(36);
  assert.ok(inspectReleaseFile('README.md', personal).length);
  assert.ok(inspectReleaseFile('config.mjs', credential).length);
  assert.ok(inspectReleaseFile('.env', 'PORT=4173').length);
  assert.ok(inspectReleaseFile('dist/app.mjs', 'code').length);
  assert.deepEqual(inspectReleaseFile('src/app.mjs', 'vllm/v1/engine/core.py'), []);
  assert.deepEqual(inspectReleaseFile('.env.example', 'PORT=4173'), []);
});

test('源码准备锁阻止并发读取半成品，保留已有锁与缓存', (t) => {
  const root = fixture(t);
  const cache = path.join(root, '.cache');
  const source = path.join(cache, 'vllm');
  tree(source);
  const lock = path.join(cache, 'vllm.setup.lock');
  fs.writeFileSync(lock, '');
  assert.throws(() => ensureSource({ root, env: {}, log: () => {} }), /正在准备/);
  assert.ok(fs.existsSync(lock));
  assert.ok(fs.existsSync(path.join(source, 'LICENSE')));
});

test('发布检查读取暂存内容，不被工作区内未暂存的脱敏修改绕过', (t) => {
  const root = fixture(t);
  repository(root);
  const file = path.join(root, 'settings.txt');
  fs.writeFileSync(file, 'ghp_' + 'X'.repeat(36));
  git(root, 'add', 'settings.txt');
  fs.writeFileSync(file, 'redacted');
  assert.throws(() => checkRelease(root), /GitHub 令牌/);
  git(root, 'add', 'settings.txt');
  assert.doesNotThrow(() => checkRelease(root));
});
