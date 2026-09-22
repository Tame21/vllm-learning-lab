import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  projectRoot,
  resolveSourcePath,
  validateSourceTree,
  assertInside,
  publicError,
} from './project.mjs';
import { sourceRepository, reviewedCommit } from '../src/source-version.mjs';

function git(args, cwd) {
  const result = spawnSync(
    'git',
    [
      '-c',
      'credential.helper=',
      '-c',
      'gc.auto=0',
      '-c',
      'maintenance.auto=false',
      '-c',
      'core.fsmonitor=false',
      ...args,
    ],
    {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 300_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' },
    },
  );
  if (result.error?.code === 'ENOENT') throw Error('未找到 Git。请安装 Git 后重新运行 npm start。');
  if (result.status !== 0)
    throw Error(
      `Git ${args[0]} 未完成。请检查网络 / Git 代理，或通过 VLLM_SOURCE_DIR 指定已有源码后重试。`,
    );
  return result.stdout.trim();
}

// Options permit offline fixture repositories in tests. The CLI always uses
// the public upstream and exact commit from source-version.mjs.
export function ensureSource({
  root = projectRoot,
  env = process.env,
  repository = sourceRepository,
  revision = reviewedCommit,
  log = console.log,
} = {}) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw Error('参考源码版本必须是完整的 40 位 commit SHA。');
  const destination = resolveSourcePath(env, root);
  if (env.VLLM_SOURCE_DIR) {
    validateSourceTree(destination);
    log('使用 VLLM_SOURCE_DIR 指定的参考源码（只读，不修改其 Git 状态）。');
    return destination;
  }
  const cache = path.join(root, '.cache');
  const lockPath = path.join(cache, 'vllm.setup.lock');
  assertInside(destination, cache);
  const busy = () =>
    Error(
      '参考源码正在准备，或上次启动被中断。请等待；确认没有准备进程后，备份并移走 .cache/vllm 与 .cache/vllm.setup.lock 再重试。',
    );
  if (fs.existsSync(lockPath)) throw busy();
  const validateCache = () => {
    validateSourceTree(destination);
    if (git(['rev-parse', 'HEAD'], destination) !== revision)
      throw Error(
        '缓存源码版本与讲解基准不同。请备份后移走 .cache/vllm，或使用 VLLM_SOURCE_DIR；现有文件未修改。',
      );
    if (git(['status', '--porcelain'], destination))
      throw Error('缓存源码存在本地改动。请先备份；使用 VLLM_SOURCE_DIR 可显式选择自定义源码。');
  };
  if (fs.existsSync(destination)) {
    validateCache();
    log(`参考源码已就绪：vLLM ${revision.slice(0, 10)}（复用缓存，无需联网）。`);
    return destination;
  }
  git(['--version'], root);
  fs.mkdirSync(cache, { recursive: true });
  let lock;
  try {
    lock = fs.openSync(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw busy();
    throw error;
  }
  let owned = false,
    complete = false;
  try {
    // Serialize preparation without renaming a large Git checkout on Windows.
    // Never remove a pre-existing directory on a failure.
    if (fs.existsSync(destination)) {
      validateCache();
      return destination;
    }
    fs.mkdirSync(destination);
    owned = true;
    log(
      `首次启动：下载 vLLM ${revision.slice(0, 10)} 的参考源码，可能需要几分钟；不下载模型、不安装 Python 包。`,
    );
    git(['init', '--quiet'], destination);
    git(['config', 'core.autocrlf', 'false'], destination);
    git(['remote', 'add', 'origin', repository], destination);
    git(['fetch', '--quiet', '--depth=1', 'origin', revision], destination);
    git(['checkout', '--quiet', '--detach', 'FETCH_HEAD'], destination);
    validateCache();
    complete = true;
    log('参考源码准备完成，后续启动可以离线运行。');
    return destination;
  } finally {
    try {
      if (owned && !complete) {
        assertInside(destination, cache);
        fs.rmSync(destination, { recursive: true, maxRetries: 10, retryDelay: 200 });
      }
    } finally {
      fs.closeSync(lock);
      fs.unlinkSync(lockPath);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    ensureSource();
  } catch (error) {
    console.error(publicError(error));
    process.exitCode = 1;
  }
}
