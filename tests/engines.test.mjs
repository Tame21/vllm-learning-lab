import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleTrace, scheduleMetrics, validateRequests } from '../src/engines/scheduler.mjs';
import { cacheTrace, grammarTrace } from '../src/engines/cache.mjs';
import { rejectionDecision, speculativeTrace } from '../src/engines/speculative.mjs';
import { tensorParallelTrace, pipelineTrace, moeTrace } from '../src/engines/parallel.mjs';
import { buildTrace, createTraceCache } from '../src/engine.mjs';
import { defaults } from '../src/simulations.mjs';
import { lessons } from '../src/content.mjs';
import { scene } from '../src/renderers.mjs';

test('4 块显存抢占场景恢复 B 时，4 个历史位置为 R，1 个新位置为 D', () => {
  const frames = scheduleTrace({ capacity: 4 });
  const resumed = frames.flatMap((f) => f.allocations).find((a) => a.id === 'B' && a.recompute);
  assert.equal(resumed.recompute, 4);
  assert.equal(resumed.decode, 1);
  assert.equal(resumed.prefill, 0);
  assert.equal(scheduleMetrics(frames).recomputed, 4);
  const html = scene(
    lessons.find((l) => l.id === 'scheduler'),
    4,
    { ...defaults, capacity: 4 },
    frames,
  );
  assert.match(html, /R4/);
});
test('自定义请求延迟到达时不会提前结束，计算量为 prompt + output - 1', () => {
  const requests = [{ id: 'F', prompt: 3, max: 2, arrival: 5 }];
  const frames = scheduleTrace({ requests });
  assert.equal(frames[4].used, 0);
  assert.equal(frames.at(-1).requests[0].output, 2);
  assert.equal(scheduleMetrics(frames).computed, 4);
  assert.deepEqual(requests, [{ id: 'F', prompt: 3, max: 2, arrival: 5 }]);
  assert.throws(() => validateRequests([...requests, ...requests]));
});
test('前缀缓存的最终逻辑块、物理块和引用计数一致，没有尾部待计算', () => {
  for (const prefix of [0, 7, 8, 12])
    for (const salt of [false, true])
      for (const prefixEnabled of [false, true]) {
        const trace = cacheTrace(true, { prefix, salt, prefixEnabled }),
          last = trace.at(-1);
        assert.equal(last.remaining, 0);
        assert.equal(last.requests[1].computed, 12);
        for (const p of last.physical) {
          assert.equal(p.refs, last.requests.filter((r) => r.blocks.includes(p.id)).length);
          if (p.refs) assert.equal(p.state, '已就绪');
        }
        const html = scene(
          lessons.find((l) => l.id === 'prefix'),
          4,
          { ...defaults, prefix, salt, prefixEnabled },
          trace,
        );
        assert.doesNotMatch(html, /待计算|待写入/);
      }
});
test('分页缓存最后一步释放全部引用，而前缀共享只在绑定后增加引用', () => {
  assert.ok(
    cacheTrace(false)
      .at(-1)
      .physical.every((p) => p.refs === 0),
  );
  const prefix = cacheTrace(true);
  assert.equal(prefix[2].physical[2].refs, 1);
  assert.equal(prefix[3].physical[2].refs, 2);
});
test('结构化输出每个前缀只允许对应语法状态的词法单元', () => {
  const trace = grammarTrace();
  assert.deepEqual(trace[2].allowed, ['"name"']);
  assert.deepEqual(trace[3].allowed, [':']);
  assert.deepEqual(trace[4].allowed, ['"vLLM"', '"模型"']);
  assert.deepEqual(trace[5].allowed, ['}']);
  assert.deepEqual(JSON.parse(trace.at(-1).prefix), { name: 'vLLM' });
  assert.equal(trace.at(-1).schema.additionalProperties, false);
});
test('拒绝采样使用 p/q 接受阈值和正残差分布，拒绝后不再提交后缀', () => {
  const p = [0.1, 0.6, 0.3],
    q = [0.5, 0.3, 0.2];
  assert.equal(rejectionDecision(p, q, 0, 0.19).accepted, true);
  const rejected = rejectionDecision(p, q, 0, 0.21);
  assert.equal(rejected.accepted, false);
  assert.ok(Math.abs(rejected.residual[1] - 0.75) < 1e-10);
  assert.equal(rejected.residual[0], 0);
  const f = speculativeTrace({ quality: 0, seed: 42 }).at(-1);
  assert.equal(f.committed.length, f.accepted + 1);
  if (f.rejected >= 0)
    assert.ok(f.candidates.slice(f.rejected + 1).every((c) => c.state === '丢弃'));
});
test('随机种子可复现，p=q 时全部接受并追加一个 bonus', () => {
  assert.deepEqual(speculativeTrace({ seed: 51 }), speculativeTrace({ seed: 51 }));
  assert.notDeepEqual(speculativeTrace({ seed: 51 }), speculativeTrace({ seed: 52 }));
  const f = speculativeTrace({ quality: 100, drafts: 6 }).at(-1);
  assert.equal(f.accepted, 6);
  assert.equal(f.committed.length, 7);
  assert.equal(f.rejected, -1);
});
test('行并行分片的局部结果求和等于未切分线性层', () => {
  for (const ranks of [2, 3, 4]) {
    const f = tensorParallelTrace(ranks).at(-1);
    const reference = f.weights.map((row) => row.reduce((sum, w, i) => sum + w * f.x[i], 0));
    assert.deepEqual(f.output, reference);
    assert.equal(f.shards.flatMap((s) => s.input).length, 12);
  }
});
test('流水线必须遵循相邻阶段依赖，结束时完成全部 microbatch', () => {
  for (const ranks of [2, 3, 4])
    for (const batches of [1, 3, 6]) {
      const trace = pipelineTrace(ranks, batches);
      assert.equal(trace.length, ranks + batches - 1);
      assert.equal(trace.at(-1).completed, batches);
      trace.forEach((f, t) =>
        f.stages.forEach((s, r) => {
          if (r > 0 && s.batch !== null) assert.equal(trace[t - 1].stages[r - 1].batch, s.batch);
        }),
      );
    }
});
test('专家分发与合并保持 token 身份，路由权重归一化', () => {
  for (const ranks of [2, 3, 4])
    for (const token of moeTrace(ranks).at(-1).tokens) {
      assert.equal(token.routes.length, 2);
      assert.ok(Math.abs(token.routes.reduce((sum, r) => sum + r.weight, 0) - 1) < 1e-10);
      assert.ok(token.routes.every((r) => r.rank === r.expert % ranks));
      assert.ok(
        Math.abs(
          token.output -
            token.routes.reduce((sum, r) => sum + r.weight * (r.expert + 1) * token.input, 0),
        ) < 1e-10,
      );
    }
});
test('回放同一参数复用执行记录；改变工作负载后重新推演', () => {
  const lesson = lessons.find((l) => l.id === 'scheduler'),
    cache = createTraceCache();
  const first = cache(lesson, defaults),
    second = cache(lesson, { ...defaults });
  assert.equal(first.trace, second.trace);
  assert.notEqual(first.trace, cache(lesson, { ...defaults, budget: 16 }).trace);
  assert.equal(first.comparison[0].blocked, true);
  assert.equal(first.comparison[1].blocked, false);
});
