import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lessons } from '../src/content.mjs';
import { specMethods, specCommand } from '../src/spec-methods.mjs';
import { specMethodsView, specMethodScene, specLessonContext } from '../src/spec-method-view.mjs';
import { analyzeCommand } from '../src/command-flow.mjs';
import { emptyStudy } from '../src/study-state.mjs';
import { coverageFor } from '../src/coverage.mjs';
import { locateSource } from '../scripts/source-locator.mjs';
import { sourceKey } from '../src/source-map.mjs';

const method = (id) => specMethods.find((m) => m.id === id);
const lesson = (id) => lessons.find((l) => l.id === id);
test('方法章各有独立身份、问题和显式源码，策略与采集模式不混作算法', () => {
  assert.equal(new Set(lessons.map((l) => l.id)).size, lessons.length);
  assert.equal(specMethods.length, 12);
  assert.equal(lessons.filter((l) => l.kind === 'spec-method').length, 12);
  for (const m of specMethods) {
    assert.equal(lesson(m.id).group, 'spec');
    assert.ok(lesson(m.id).question && lesson(m.id).reason);
    assert.equal(m.steps.length, 4);
  }
  for (const id of ['dynamic-spec', 'adaptive-spec', 'speculators', 'speculative'])
    assert.equal(method(id), undefined);
  const specIds = lessons.filter((l) => l.group === 'spec').map((l) => l.id);
  assert.equal(specIds[0], 'speculative');
  assert.deepEqual(specIds.slice(-3), ['dynamic-spec', 'adaptive-spec', 'speculators']);
});

test('PARD 配置是普通草稿方法的并行分支，MLP 不输出伪可运行命令', () => {
  const pard = method('parallel-draft');
  assert.equal(pard.config.method, 'draft_model');
  assert.equal(pard.config.parallel_drafting, true);
  assert.equal(method('draft-model').config.parallel_drafting, undefined);
  assert.equal(specCommand(method('mlp-spec')), null);
  assert.doesNotMatch(specLessonContext(lesson('mlp-spec')), /data-spec-command/);
  assert.match(specLessonContext(lesson('mlp-spec')), /注册项被注释/);
  for (const m of specMethods.filter((m) => m.config)) {
    const analysis = analyzeCommand(specCommand(m));
    assert.deepEqual(analysis.errors, [], m.id);
    assert.deepEqual(analysis.options['speculative-config'], m.config, m.id);
    assert.ok(analysis.request.length, m.id);
    assert.equal(
      analysis.scenario.runner,
      ['eagle3', 'mtp', 'dflash', 'dspark'].includes(m.id) ? 'v2' : 'v1',
    );
  }
});

test('CPU / GPU 历史查找、融合特征、多头与半自回归图解呈现不同的数据依赖', () => {
  const scene = (id, i = 2) => specMethodScene(lesson(id), i);
  assert.match(scene('ngram'), /spec-history/);
  assert.match(scene('ngram-gpu'), /valid = 0/);
  assert.match(scene('suffix'), /spec-tree/);
  assert.match(scene('eagle3'), /combine_hidden_states/);
  assert.match(scene('medusa'), /head₁/);
  assert.match(scene('dflash'), /mask₃/);
  assert.match(scene('dspark'), /bias\(d₂\)/);
  assert.doesNotMatch(scene('dflash'), /bias\(d₂\)/);
  for (const m of specMethods) {
    assert.notEqual(scene(m.id, 0), scene(m.id, 3), m.id);
    assert.match(scene(m.id, 3), /aria-current="step"/);
    assert.match(scene(m.id, 0), /未运行模型/);
  }
});

test('地图筛选与对照保留具体方法边界，包含通往共同实验和策略的入口', () => {
  const html = specMethodsView({ family: 'parallel', compare: ['dflash', 'dspark'] }, emptyStudy());
  assert.equal((html.match(/data-method-card=/g) || []).length, 3);
  assert.match(html, /data-method-card="parallel-draft"/);
  assert.doesNotMatch(html, /data-method-card="ngram"/);
  assert.match(html, /DFlash 与 DSpark/);
  assert.match(html, /Markov/);
  assert.match(html, /data-lesson="speculative"/);
  assert.match(html, /data-lesson="adaptive-spec"/);
});

test('拆分后的文档入口指向各自方法，MLP 文档标注当前接入边界', () => {
  for (const [doc, id] of [
    ['draft_model', 'draft-model'],
    ['suffix', 'suffix'],
    ['mtp', 'mtp'],
  ])
    assert.equal(coverageFor(`docs/features/speculative_decoding/${doc}.md`).lesson, id);
  assert.equal(coverageFor('docs/features/speculative_decoding/mlp.md').level, '机制参考');
});

test('注册表锚点限定在命名映射内，能精确高亮被注释的注册项', () => {
  const code =
    '# DEMO is not a definition\nREGISTRY = {\n    # disabled_model\n}\nOTHER = {\n    # disabled_model\n}\n';
  const ref = locateSource(code, {
    path: 'registry.py',
    symbol: 'REGISTRY',
    needle: 'disabled_model',
  });
  assert.equal(ref.line, 3);
  assert.equal(ref.rangeStart, 2);
  assert.equal(ref.rangeEnd, 4);
  assert.throws(() => locateSource(code, { path: 'registry.py', symbol: 'MISSING' }));
  const data = JSON.parse(fs.readFileSync(new URL('../dist/source-index.json', import.meta.url)));
  const mlpRef = data.refs[sourceKey(method('mlp-spec').steps[2].source)];
  assert.match(mlpRef.code, /# "MLPSpeculatorPreTrainedModel"/);
  assert.equal(mlpRef.kind, 'implementation');
});
