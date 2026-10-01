import test from 'node:test';
import assert from 'node:assert/strict';
import { prefillTrace, samplingTrace, integerQuantTrace, contextParallelTrace, expertLayoutTrace, mixedLoraTrace, mediaAlignmentTrace } from '../src/engines/roadmap-core.mjs';
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} ≈ ${b}`);

test('Prefill/Decode 按 prompt + sampled − 1 计算，最后输出未写 KV，EOS 不继续前向', () => {
  for (const prefillPrompt of [2, 8]) for (const prefillOutput of [1, 5]) for (const prefillEos of [0, 1, 3, 5]) {
    const trace = prefillTrace({ prefillPrompt, prefillOutput, prefillEos }), f = trace.at(-1);
    const n = prefillEos ? Math.min(prefillEos, prefillOutput) : prefillOutput;
    assert.equal(f.cache.length, prefillPrompt + n - 1);
    assert.equal(f.output.length, n);
    assert.equal(f.output.at(-1).kvWritten, false);
    assert.ok(f.output.slice(0, -1).every((x) => x.kvWritten));
    for (const frame of trace) for (const q of frame.queries) {
      assert.ok(q.visible.every((position) => position <= q.position));
      assert.equal(q.visible.length, q.position + 1);
      assert.ok(frame.cache.some((k) => k.token === q.token && k.position === q.position));
    }
    assert.equal(trace[0].cache.length, 0);
  }
});
test('采样阶段概率守恒，Top-p 覆盖阈值；指数竞赛可复现，贪心不产生随机值', () => {
  for (const temperature of [0, 0.1, 1, 2]) for (const topP of [0.1, 0.5, 1]) {
    const f = samplingTrace({ temperature, topP, seed: 17 }).at(-1);
    close(f.normalized.reduce((a, b) => a + b, 0), 1);
    assert.ok(f.kept.includes(f.selected));
    assert.deepEqual(f, samplingTrace({ temperature, topP, seed: 17 }).at(-1));
    if (!temperature) { assert.equal(f.selected, 0); assert.equal(f.races.length, 0); }
    else {
      assert.ok(f.kept.reduce((a, i) => a + f.probabilities[i], 0) >= topP - 1e-12);
      assert.equal(f.races.find((x) => x.i === f.selected).score, Math.max(...f.races.map((x) => x.score)));
      assert.ok(f.kept.slice(0, -1).reduce((a, i) => a + f.probabilities[i], 0) < topP);
    }
  }
});
test('INT4 / INT8 字节往返保持有符号整数，位打包不额外引入误差', () => {
  for (const bits of [4, 8]) {
    const f = integerQuantTrace({ bits }).at(-1);
    assert.equal(f.bytes.length, bits);
    for (const x of f.restored) {
      assert.equal(x.integer, f.integers[x.i].integer);
      assert.ok(x.error <= f.scale / 2 + 1e-12);
    }
    assert.ok(f.bytes.every((x) => x.byte >= 0 && x.byte <= 255));
  }
});
test('PCP Gather 与 DCP LSE 合并都等于全量因果 Attention，局部未就绪前不合并', () => {
  for (const cpRanks of [2, 3, 4]) for (const cpPrefill of [false, true]) for (let cpQuery = 0; cpQuery < 8; cpQuery++) {
    const trace = contextParallelTrace({ cpRanks, cpPrefill, cpQuery }), f = trace.at(-1);
    f.output.forEach((v, i) => close(v, f.reference[i]));
    close(f.factors.reduce((a, b) => a + b, 0), 1);
    assert.equal(new Set(f.shards.flatMap((x) => x.positions)).size, 8);
    assert.equal(f.shards.flatMap((x) => x.positions).length, 8);
    for (const frame of trace) if (frame.gathered) assert.ok(frame.shards.every((x) => x.ready));
  }
});
test('EPLB 目标权重未确认不启用新映射，专家身份与总负载守恒', () => {
  for (const eplbSkew of [1, 12]) for (const eplbReplicas of [0, 1, 4]) {
    const trace = expertLayoutTrace({ eplbSkew, eplbReplicas }), f = trace.at(-1);
    assert.equal(f.target.filter((x) => x.logical !== null).length, 4 + eplbReplicas);
    assert.deepEqual(f.active, f.target);
    close(f.target.reduce((sum, x) => sum + (x.load ?? 0), 0), f.loads.reduce((a, b) => a + b, 0));
    for (const frame of trace) {
      if (frame.mapVersion === 2) assert.ok(frame.targetReady && frame.valid.every(Boolean) && frame.weightVersion === 2);
      else assert.deepEqual(frame.active, frame.old);
      if (frame.pending) assert.ok(!frame.valid[frame.pending.index]);
    }
  }
});
test('混合 LoRA 按请求身份映射，行重排不改变结果，base 与零比例没有增量', () => {
  for (const loraRank of [1, 2]) for (const loraScale of [0, 1, 2]) for (const loraDisableB of [false, true]) {
    const f = mixedLoraTrace({ loraRank, loraScale, loraDisableB }).at(-1);
    const reverse = mixedLoraTrace({ loraRank, loraScale, loraDisableB, loraReverse: true }).at(-1);
    for (const row of f.results) {
      assert.deepEqual(row, reverse.results.find((x) => x.id === row.id));
      row.output.forEach((v, i) => assert.equal(v, row.base[i] + row.delta[i]));
      if (!row.adapter || !loraScale) assert.deepEqual(row.output, row.base);
    }
    assert.notDeepEqual(mixedLoraTrace().at(-1).results[0].output, mixedLoraTrace().at(-1).results[2].output);
  }
});
test('媒体占位逐行对应，重复键复用特征；数量不匹配不能标记完整输入就绪', () => {
  for (const mmType of [0, 1, 2]) for (const mmItems of [1, 3]) for (const mmRepeat of [false, true]) for (const mmMismatch of [false, true]) {
    const trace = mediaAlignmentTrace({ mmType, mmItems, mmRepeat, mmMismatch }), f = trace.at(-1), size = [2, 4, 3][mmType];
    assert.equal(f.encoded, (mmRepeat ? 1 : mmItems) * size);
    assert.equal(f.hits, mmRepeat ? mmItems - 1 : 0);
    assert.equal(f.valid, !mmMismatch);
    assert.equal(f.failed, mmMismatch);
    for (const row of f.rows) if (row.kind === 'media' && row.ready) assert.deepEqual(row.vector, f.items.find((x) => x.id === row.item).features[row.feature]);
    for (const frame of trace) if (frame.valid) assert.ok(frame.rows.every((x) => x.ready && x.vector));
  }
});
