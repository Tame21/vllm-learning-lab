import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scheduleTrace,
  defaults,
  prefixResult,
  sampleDistribution,
  quantize,
  validateParameters,
} from '../src/simulations.mjs';
import { lessons } from '../src/content.mjs';
import { scene, controls } from '../src/renderers.mjs';
import { buildTrace } from '../src/engine.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSourcePath } from '../scripts/project.mjs';

test('连续批处理允许未完成请求继续执行，默认场景全部结束并归还缓存', () => {
  const frames = scheduleTrace(),
    last = frames.at(-1);
  assert.ok(
    frames.some(
      (f) =>
        f.allocations.some((a) => a.phase === 'prefill') &&
        f.allocations.some((a) => a.phase === 'decode'),
    ),
  );
  assert.ok(last.requests.every((r) => r.status === '已完成' && r.output === r.max));
  assert.equal(last.free.length, defaults.capacity);
  assert.equal(frames[0].requests[0].output, 1, '完整 prefill 本轮就可生成首 token');
  assert.equal(frames[0].requests[0].computed, 8, '首个输出 token 的 KV 此时尚未计算');
});

test('所有可选预算与缓存容量下，调度不超预算、物理块不重叠、输出不倒退', () => {
  for (const budget of [4, 8, 12, 16])
    for (const capacity of [4, 6, 8, 10, 12, 14, 16, 18, 20]) {
      const frames = scheduleTrace({ budget, capacity });
      let previous = [0, 0, 0];
      for (const f of frames) {
        assert.ok(f.used <= budget && f.used >= 0);
        assert.equal(
          f.used,
          f.allocations.reduce((sum, a) => sum + a.count, 0),
        );
        const during = f.blocksDuring.flatMap((r) => r.blocks);
        assert.equal(new Set(during).size, during.length, '执行期间同一块不能被两个未共享请求占用');
        assert.ok(during.every((n) => n >= 0 && n < capacity));
        const after = [...f.free, ...f.requests.flatMap((r) => r.blocks)];
        assert.equal(new Set(after).size, capacity);
        assert.equal(after.length, capacity, '执行后空闲与占用块构成完整块池');
        f.requests.forEach((r, n) => {
          assert.ok(r.output >= previous[n]);
          assert.ok(r.output <= r.max);
          previous[n] = r.output;
        });
      }
      assert.ok(frames.at(-1).requests.every((r) => r.status === '已完成'));
    }
});

test('低容量触发抢占而不删除已生成文本；恢复后仍完成', () => {
  const frames = scheduleTrace({ capacity: 4 });
  assert.ok(frames.some((f) => f.events.some((e) => e.includes('抢占'))));
  assert.ok(frames.at(-1).requests.some((r) => r.preemptions > 0));
  assert.ok(frames.at(-1).requests.every((r) => r.output === r.max));
});

test('关闭切块且整段 prompt 放不进预算时显式显示停滞', () => {
  const frames = scheduleTrace({ chunked: false, budget: 8 });
  assert.equal(frames.at(-1).blocked, true);
  assert.equal(frames.at(-1).requests.find((r) => r.id === 'C').output, 0);
  assert.ok(!scheduleTrace({ chunked: false, budget: 16 }).at(-1).blocked);
});

test('前缀命中按整块对齐，salt 隔离，并保留用于 logits 的末尾', () => {
  assert.deepEqual(prefixResult(7, false), { hit: 4, computed: 8, blocks: 1 });
  assert.deepEqual(prefixResult(12, false), { hit: 8, computed: 4, blocks: 2 });
  assert.equal(prefixResult(8, true).hit, 0);
});

test('采样分布归一化，top-p 包含越过阈值的 token，零温度为贪心', () => {
  for (const t of [0, 0.1, 0.7, 1, 2])
    for (const p of [0.1, 0.5, 0.9, 1]) {
      const values = sampleDistribution(t, p);
      assert.ok(Math.abs(values.reduce((a, v) => a + v.prob, 0) - 1) < 1e-10);
      if (t > 0) {
        const kept = values.filter((v) => v.kept);
        assert.ok(kept.reduce((a, v) => a + v.raw, 0) >= p - 1e-10);
        assert.ok(kept.slice(0, -1).reduce((a, v) => a + v.raw, 0) < p);
      }
    }
  assert.equal(sampleDistribution(0, 1)[0].prob, 1);
  assert.ok(sampleDistribution(0.5, 1)[0].prob > sampleDistribution(2, 1)[0].prob);
});

test('对称量化重建误差不超过半个尺度，4 bit 精度更粗', () => {
  for (const bits of [4, 8]) {
    const q = quantize(bits);
    assert.ok(q.values.every((v) => v.error <= q.scale / 2 + 1e-10));
  }
  assert.ok(quantize(4).scale > quantize(8).scale);
});

test('参数修改校验拒绝无效值，不破坏已有状态', () => {
  const original = { ...defaults };
  for (const bad of [
    { budget: 0 },
    { capacity: 3 },
    { accepted: 6 },
    { salt: 'false' },
    { bits: 6 },
    { unknown: 1 },
    { temperature: NaN },
  ])
    assert.throws(() => validateParameters(bad, original));
  assert.deepEqual(original, defaults);
  assert.equal(validateParameters({ drafts: 1 }).drafts, 1);
});

test('每个专题的每个步骤及其控制器都可渲染', () => {
  const ids = new Set();
  for (const l of lessons) {
    assert.ok(!ids.has(l.id));
    ids.add(l.id);
    assert.ok(l.steps.length >= 4 && l.refs.length > 0 && l.question && l.choices[l.answer]);
    const frames = buildTrace(l, defaults);
    assert.ok(controls(l, defaults).length > 0);
    for (let i = 0; i < frames.length; i++) {
      const html = scene(l, i, defaults, frames);
      assert.ok(html.length > 100);
      assert.ok(!html.includes('NaN'));
    }
  }
});

test('特性文档没有未映射项，源码片段与当前文件逐行一致', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const repo = resolveSourcePath();
  const data = JSON.parse(fs.readFileSync(path.join(root, 'dist/source-index.json'), 'utf8'));
  assert.equal(data.lessonCount, lessons.length);
  assert.ok(data.docs.every((d) => lessons.some((l) => l.id === d.lesson)));
  for (const ref of Object.values(data.refs)) {
    const lines = fs.readFileSync(path.join(repo, ref.path), 'utf8').split(/\r?\n/);
    assert.equal(lines.slice(ref.start - 1, ref.end).join('\n'), ref.code);
    assert.ok(ref.line >= ref.start && ref.line <= ref.end);
  }
});
