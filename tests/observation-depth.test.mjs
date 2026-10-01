import test from 'node:test';
import assert from 'node:assert/strict';
import { observationTraces } from '../src/engines/observation-depth.mjs';
import { scheduleTrace } from '../src/engines/scheduler.mjs';
import { kvOffloadTrace } from '../src/engines/device-mechanisms.mjs';
import { disaggregatedTrace } from '../src/engines/distributed-mechanisms.mjs';
import { createTraceCache } from '../src/engine.mjs';
import { defaults } from '../src/simulations.mjs';
import { lessons } from '../src/content.mjs';
import { scene } from '../src/renderers.mjs';

test('调度微事件保留逐轮结果，分配先于写入、采样先于释放，长工作负载不超 URL 帧上限', () => {
  for (const capacity of [4, 16]) {
    const o = { ...defaults, capacity }, trace = observationTraces.scheduler(o), rounds = trace.filter((f) => f.roundEnd);
    assert.deepEqual(rounds.map((f) => f.requests), scheduleTrace(o).map((f) => f.requests));
    for (const f of trace.filter((f) => f.phase === 'allocate')) {
      const r = f.requests.find((r) => r.id === f.requestId), a = f.allocations.at(-1);
      assert.equal(r.computed, a.from);
      assert.ok(r.blocks.length >= Math.ceil(a.to / o.blockSize));
    }
    for (const f of trace.filter((f) => f.phase === 'sample')) {
      const r = f.requests.find((r) => r.id === f.requestId);
      assert.equal(r.computed, r.prompt + r.output - 1);
    }
  }
  const requests = [...'ABCDEF'].map((id, arrival) => ({ id, arrival, prompt: 32, max: 16 }));
  assert.ok(observationTraces.scheduler({ ...defaults, budget: 4, requests }).length <= 256);
});
test('切块开关共享工作负载和轮次坐标，完整 Prefill 超预算被保留为停滞', () => {
  const result = createTraceCache()(lessons.find((l) => l.id === 'chunked'), defaults).comparison;
  assert.ok(result[0].blocked);
  assert.equal(result[1].finished, 3);
  assert.deepEqual(result[0].roundsTrace[0].requests.map((r) => [r.id, r.prompt, r.max]), result[1].roundsTrace[0].requests.map((r) => [r.id, r.prompt, r.max]));
});
test('分页逐 token 读写覆盖全部位置，同一块表下 slot 映射相同，释放后零引用', () => {
  const trace = observationTraces.paged(defaults);
  const writes = trace.filter((f) => f.stepIndex === 2), reads = trace.filter((f) => f.stepIndex === 3);
  assert.equal(writes.length, 12);
  assert.deepEqual(writes.map((f) => f.address.slot), reads.map((f) => f.address.slot));
  for (const f of [...writes, ...reads]) assert.equal(f.address.slot, f.requests[0].blocks[Math.floor(f.address.position / 4)] * 4 + f.address.position % 4);
  assert.ok(trace.at(-1).physical.every((p) => !p.refs));
});
test('前缀逐块查询不增引用，绑定后共享，末尾 logits 必须执行', () => {
  for (const salt of [true, false]) {
    const trace = observationTraces.prefix({ ...defaults, prefix: 12, salt });
    const lookups = trace.filter((f) => f.stepIndex === 2);
    assert.equal(lookups.length, 3);
    assert.ok(lookups.every((f) => f.physical.every((p) => p.refs <= 1)));
    assert.equal(trace.at(-1).result.hit, salt ? 0 : 8);
    assert.equal(trace.at(-1).logitsReady, true);
    assert.ok(trace.filter((f) => f.stepIndex === 4).slice(0, -1).every((f) => !f.logitsReady));
    assert.equal(trace.at(-1).remaining, 0);
  }
});
test('随机验证首拒绝后停止逐位置检验，后缀丢弃，恢复分布归一且只在最终提交输出', () => {
  for (const quality of [0, 50, 100]) {
    const trace = observationTraces.speculative({ ...defaults, drafts: 6, quality }), last = trace.at(-1);
    assert.equal(trace.filter((f) => f.stepIndex === 2).length, last.rejected < 0 ? 6 : last.rejected + 1);
    assert.ok(trace.slice(0, -1).every((f) => !f.committed.length));
    assert.equal(last.committed.length, last.accepted + 1);
    assert.ok(Math.abs(last.recovery.reduce((a,b) => a+b, 0) - 1) < 1e-12);
    if (last.rejected >= 0) assert.ok(last.candidates.slice(last.rejected + 1).every((c) => c.state === '丢弃'));
  }
});
test('TP 部分和只包括已处理局部列，归并总和等于原矩阵乘积', () => {
  for (const ranks of [2,3,4]) {
    const trace = observationTraces.tp({ ...defaults, ranks });
    for (const f of trace) f.shards.forEach((s) => s.weights.forEach((row, i) => assert.equal(f.partialNow[s.rank][i], row.slice(0, f.progress[s.rank]).reduce((n, w, col) => n + w * s.input[col], 0))));
    assert.deepEqual(trace.at(-1).reduction, trace.at(-1).output);
  }
});
test('PP 交接来自上一时隙同一 microbatch，短流水线明确没有稳态', () => {
  for (const ranks of [2,3,4]) for (const microbatches of [1,3,6]) {
    const trace = observationTraces.pp({ ...defaults, ranks, microbatches });
    for (const f of trace) for (const h of f.handoffs) assert.equal(trace[h.completedAt].stages[h.from].batch, h.batch);
    assert.equal(trace[0].hasSteady, microbatches >= ranks);
    assert.equal(trace.at(-1).completed, microbatches);
  }
});
test('MoE 逐 token 保留起点、Top-2 路由与最终加权结果，未 combine 时不展示最终状态', () => {
  const trace = observationTraces.moe(defaults), final = trace.at(-1);
  assert.ok(final.routeProgress.every((p) => p.phase === 'combined'));
  assert.ok(trace.filter((f) => f.stepIndex < 3).every((f) => f.routeProgress.every((p) => p.phase !== 'combined')));
  for (const t of final.tokens) assert.equal(t.output, t.routes.reduce((n,r) => n + r.weight * r.value, 0));
});
test('语法状态允许集合与排除集合互补，参数只改变合法字符串值', () => {
  for (const grammarValue of [0,1]) {
    const trace = observationTraces.structured({ ...defaults, grammarValue });
    assert.deepEqual(JSON.parse(trace.at(-1).prefix), { name: grammarValue ? '模型' : 'vLLM' });
    assert.ok(trace.every((f) => f.allowed.length + f.excluded.length === 9 && f.allowed.every((x) => !f.excluded.includes(x))));
  }
});
test('三层缓存容量守恒，传输目标确认前无效，外部回载源不会被同时淘汰', () => {
  for (const offloadCpuCapacity of [1,3,6]) for (const offloadExternalCapacity of [0,1,3]) for (const offloadTarget of [0,1,3,5]) {
    const trace = kvOffloadTrace({ offloadCapacity: 1, offloadCpuCapacity, offloadExternalCapacity, offloadTarget, offloadHit: false, offloadExternalHit: true });
    let reads = 0;
    for (const f of trace) {
      assert.ok(f.cpu.filter((b) => b.valid).length <= offloadCpuCapacity);
      assert.ok(f.external.filter((b) => b.valid).length <= offloadExternalCapacity);
      if (f.pending?.to === 'CPU') assert.equal(f.cpu[f.pending.id].valid, false);
      if (f.pending?.to === '外部') assert.equal(f.external[f.pending.id].valid, false);
      if (f.pending?.direction === 'restore') assert.equal(f.external[f.pending.id].valid, true);
      if (f.reads.length > reads) { assert.equal(f.pending, null); assert.ok(f.gpu.some((b) => b.id === f.reads.at(-1))); }
      reads = f.reads.length;
    }
    assert.deepEqual(trace.at(-1).reads, [0,offloadTarget,1,offloadTarget,0]);
  }
  const external = kvOffloadTrace({ offloadCapacity: 1, offloadCpuCapacity: 1, offloadExternalCapacity: 1, offloadHit: false, offloadExternalHit: true });
  assert.ok(external.at(-1).restores > 0);
});
test('单实例对照消耗相同 Prompt，无跨实例传输；分离传输失败不阻塞单实例', () => {
  const trace = disaggregatedTrace({ disaggTokens: 13, disaggFail: true });
  assert.equal(trace.at(-1).single.computed, 13);
  assert.equal(trace.at(-1).single.output.length, 1);
  assert.equal(trace.at(-1).single.transfers, 0);
  assert.equal(trace.at(-1).output.length, 0);
});
test('深化后的全部观察帧均可渲染，保留事件和有效讲解索引', () => {
  for (const [id, build] of Object.entries(observationTraces)) {
    const lesson = lessons.find((l) => l.id === id), frames = build(defaults);
    frames.forEach((f, index) => {
      assert.ok(lesson.steps[f.stepIndex]);
      assert.doesNotMatch(scene(lesson, index, defaults, frames), /NaN|undefined/);
    });
  }
});
