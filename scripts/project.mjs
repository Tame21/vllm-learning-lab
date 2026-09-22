import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function resolveSourcePath(env = process.env, root = projectRoot) {
  return env.VLLM_SOURCE_DIR
    ? path.resolve(env.VLLM_SOURCE_DIR)
    : path.join(root, '.cache', 'vllm');
}

export function validateSourceTree(directory) {
  const markers = ['vllm/config/speculative.py', 'docs/features', 'LICENSE'];
  if (!markers.every((file) => fs.existsSync(path.join(directory, file))))
    throw Error('参考源码不完整：需要包含 vllm/config、docs/features 和 LICENSE 的 vLLM 仓库。');
}

export function assertInside(directory, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(directory));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw Error('拒绝操作项目缓存以外的目录。');
}

export function publicError(error) {
  if (error.code && /^(?:EACCES|EPERM|EBUSY|ENOENT|ENOTEMPTY|ENOSPC)$/.test(error.code))
    return `文件操作失败（${error.code}）。请检查文件占用、权限和磁盘空间后重试；未输出本机路径。`;
  let message = String(error.message || error);
  for (const local of [projectRoot, process.env.USERPROFILE, process.env.HOME].filter(Boolean))
    message = message.split(local).join('<local>');
  return message;
}
