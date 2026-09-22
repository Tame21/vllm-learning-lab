import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { lessons } from '../src/content.mjs';
import { coverageFor } from '../src/coverage.mjs';
import { reviewedCommit, sourceKey } from '../src/source-map.mjs';
import { locateSource } from './source-locator.mjs';
import { commandSources } from '../src/command-sources.mjs';
import { resolveSourcePath } from './project.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repo = resolveSourcePath();
const read = (p) => fs.readFileSync(path.join(repo, p), 'utf8');
export function walk(dir) {
  return fs
    .readdirSync(path.join(repo, dir), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
}

let commit = 'unknown',
  changed = null;
try {
  commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  changed = new Set(
    execFileSync('git', ['-C', repo, 'diff', '--name-only', reviewedCommit, '--'], {
      encoding: 'utf8',
    })
      .trim()
      .split(/\r?\n/),
  );
} catch {
  /* Exported checkouts can still be read without Git metadata. */
}
const refs = {},
  errors = [];
for (const lesson of [
  ...lessons,
  { id: 'command', refs: Object.values(commandSources), steps: [] },
]) {
  const all = [
    ...lesson.refs,
    ...lesson.steps.flatMap((s) => [s.source, s.alternateSource].filter(Boolean)),
  ];
  for (const ref of all) {
    const key = sourceKey(ref);
    if (refs[key]) continue;
    try {
      refs[key] = {
        ...locateSource(read(ref.path), ref),
        review: changed === null ? 'unknown' : changed.has(ref.path) ? 'stale' : 'baseline',
      };
    } catch (error) {
      errors.push(`${lesson.id}: ${error.message}`);
    }
  }
}
if (errors.length) throw Error(`源码锚点校验失败；请修订 source-map.mjs：\n${errors.join('\n')}`);
const docs = walk('docs/features')
  .filter((p) => p.endsWith('.md'))
  .map((p) => ({
    path: p,
    title: read(p).match(/^#\s+(.+)$/m)?.[1] || p,
    ...coverageFor(p),
  }));
for (const doc of docs) {
  if (!lessons.some((l) => l.id === doc.lesson)) throw Error(`特性文档未映射到专题：${doc.path}`);
}
const inventories = [
  ['模型实现文件', 'vllm/model_executor/models'],
  ['另一模型目录', 'vllm/models'],
  ['Attention 后端', 'vllm/v1/attention/backends'],
  ['量化实现文件', 'vllm/model_executor/layers/quantization'],
  ['KV Connector', 'vllm/distributed/kv_transfer/kv_connector'],
].map(([title, dir]) => ({
  title,
  dir,
  files: walk(dir)
    .filter((p) => p.endsWith('.py') && !p.endsWith('/__init__.py'))
    .map((p) => ({ path: p, name: p.slice(dir.length + 1) })),
}));
const data = {
  commit,
  reviewedCommit,
  generated: new Date().toISOString(),
  refs,
  docs,
  inventories,
  lessonCount: lessons.length,
  stepCount: lessons.reduce((n, l) => n + l.steps.length, 0),
};
fs.writeFileSync(path.join(root, 'dist/source-index.json'), JSON.stringify(data));
console.log(
  `源码索引：${data.lessonCount} 个专题，${data.stepCount} 个步骤显式定位，${docs.length} 篇文档；讲解基准 ${reviewedCommit.slice(0, 10)}`,
);
