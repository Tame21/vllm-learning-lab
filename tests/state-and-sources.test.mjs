import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lessons } from '../src/content.mjs';
import { defaults } from '../src/simulations.mjs';
import {
  decodeRoute,
  encodeRoute,
  emptyStudy,
  loadStudy,
  saveStudy,
  storageKey,
} from '../src/study-state.mjs';
import { locateSource } from '../scripts/source-locator.mjs';
import { sourceKey } from '../src/source-map.mjs';

const ids = lessons.map((l) => l.id);
const memory = () => {
  const values = new Map();
  return { getItem: (k) => values.get(k) || null, setItem: (k, v) => values.set(k, v) };
};
test('实验链接完整恢复自定义请求、参数、步骤和源码页签', () => {
  const options = {
    ...defaults,
    budget: 16,
    requests: [{ id: 'D', prompt: 7, max: 6, arrival: 2 }],
  };
  const route = decodeRoute(encodeRoute('scheduler', options, 3, 'source'), ids);
  assert.deepEqual(route.options, options);
  assert.equal(route.index, 3);
  assert.equal(route.tab, 'source');
  assert.throws(() => decodeRoute('#scheduler?step=-1', ids));
  assert.throws(() => decodeRoute('#scheduler?p=' + encodeURIComponent('{"budget":1000}'), ids));
});
test('已读、答题、收藏和断点保存独立，损坏或禁用存储不阻止学习', () => {
  const storage = memory(),
    study = emptyStudy();
  study.completed = ['prefix'];
  study.bookmarks = ['runner'];
  study.quiz.prefix = { answer: 1, passed: false, attempts: 2 };
  study.sessions.prefix = { options: { ...defaults, prefix: 7 }, index: 3, tab: 'quiz' };
  assert.equal(saveStudy(storage, study), true);
  assert.deepEqual(loadStudy(storage, ids), study);
  storage.setItem(storageKey, '{broken');
  assert.deepEqual(loadStudy(storage, ids), emptyStudy());
  assert.equal(
    saveStudy(
      {
        setItem: () => {
          throw Error('disabled');
        },
      },
      study,
    ),
    false,
  );
});
test('旧的已读进度迁移不会变成理解题通过', () => {
  const storage = memory();
  storage.setItem('vllm-lab-completed', '["prefix","invalid"]');
  const study = loadStudy(storage, ids);
  assert.deepEqual(study.completed, ['prefix']);
  assert.deepEqual(study.quiz, {});
});
test('源码定位处理同名类方法及多行签名，不落到文件第一个函数', () => {
  const code =
    'def irrelevant():\n    pass\n\nclass A:\n    def run(\n        self, value\n    ):\n        result = value + 1\n        return result\n\nclass B:\n    def run(self):\n        pass\n';
  const ref = locateSource(code, { path: 'demo.py', symbol: 'A.run', needle: 'result =' });
  assert.equal(ref.line, 8);
  assert.equal(ref.rangeStart, 5);
  assert.ok(ref.rangeEnd >= 9);
  assert.match(ref.code, /return result/);
  assert.throws(() => locateSource(code, { path: 'demo.py', symbol: 'missing' }));
});
test('所有教学步骤都有显式符号或文档章节，Runner V1 与 V2 均指向执行入口', () => {
  const data = JSON.parse(
    fs.readFileSync(new URL('../dist/source-index.json', import.meta.url), 'utf8'),
  );
  for (const lesson of lessons)
    for (const step of lesson.steps) {
      assert.ok(step.source.symbol || step.source.heading, lesson.id + '/' + step.title);
      const ref = data.refs[sourceKey(step.source)];
      assert.ok(ref);
      assert.notEqual(ref.kind, 'reference');
    }
  const runner = lessons.find((l) => l.id === 'runner').steps[0];
  assert.equal(runner.source.symbol, 'GPUModelRunner.execute_model');
  assert.equal(runner.alternateSource.symbol, 'GPUModelRunner.execute_model');
  assert.notEqual(runner.source.path, runner.alternateSource.path);
  assert.ok(
    lessons.every((l) => !l.question.includes('接下来要做什么') && l.reason && l.misconception),
  );
});
