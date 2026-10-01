import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeE4M3, decodeE4M3, quantizeE4M3 } from '../src/engines/fp8.mjs';
import { compileTrace, kvQuantTrace, onlineQuantTrace } from '../src/engines/precision-mechanisms.mjs';
import { dboTrace, dpScore, dataParallelTrace, disaggregatedTrace } from '../src/engines/distributed-mechanisms.mjs';

test('E4M3 有限编码全量往返，含次正规数、nearest-even、负零与饱和', () => {
  for (let code = 0; code < 256; code++) {
    if ((code & 127) === 127) assert.ok(Number.isNaN(decodeE4M3(code)));
    else assert.equal(encodeE4M3(decodeE4M3(code)), code);
  }
  assert.equal(decodeE4M3(1), 2 ** -9);
  assert.equal(decodeE4M3(126), 448);
  assert.equal(encodeE4M3(1.0625), 56);
  assert.equal(encodeE4M3(1.1875), 58);
  assert.equal(encodeE4M3(1000), 126);
  assert.equal(encodeE4M3(-1000), 254);
  assert.equal(encodeE4M3(Infinity), 126);
  assert.ok(quantizeE4M3(1, 0.002).clipped);
  assert.equal(quantizeE4M3(1, 0.002).restored, 0.896);
  assert.throws(() => quantizeE4M3(1, 0));
});

test('融合保持教学输出，移除中间物化；形状变更只新增一项缓存并复用旧项', () => {
  for (const compileRows of [1, 3, 6]) for (const compileChangeShape of [false, true]) {
    const fused = compileTrace({ compileRows, compileChangeShape }).at(-1);
    const separate = compileTrace({ compileRows, compileChangeShape, compileFusion: false }).at(-1);
    assert.deepEqual(fused.calls.map((x) => x.output), separate.calls.map((x) => x.output));
    assert.equal(fused.cache.length, compileChangeShape ? 2 : 1);
    assert.equal(fused.calls.at(-1).hit, true);
    assert.equal(fused.launches, 3);
    assert.equal(separate.launches, 6);
    assert.equal(fused.intermediateElements, 0);
    assert.equal(separate.intermediateElements, 2 * (3 * compileRows + (compileChangeShape ? 1 : 0)));
  }
});

test('KV 编码、读取、scale 与 Attention 对照共享数据；每次读取均已有缓存', () => {
  for (const kvQuantTokens of [1, 4, 8]) for (const kvQuantScale of [0.002, 0.01, 0.03]) for (const kvQuantCalibrate of [false, true]) {
    const trace = kvQuantTrace({ kvQuantTokens, kvQuantScale, kvQuantCalibrate }), f = trace.at(-1);
    assert.equal(f.cache.length, kvQuantTokens);
    assert.equal(f.read.length, kvQuantTokens);
    assert.ok(f.result.output.every(Number.isFinite));
    assert.ok(Math.abs(f.result.probabilities.reduce((a, b) => a + b, 0) - 1) < 1e-12);
    if (kvQuantCalibrate) assert.equal(f.clipped, 0);
    for (const frame of trace) for (const read of frame.read) {
      const cache = frame.cache.find((x) => x.i === read.i);
      assert.deepEqual(read.k, cache.k.map((x) => decodeE4M3(x.code) * frame.scaleK));
      assert.deepEqual(read.v, cache.v.map((x) => decodeE4M3(x.code) * frame.scaleV));
    }
    assert.equal(trace[0].cache.length, 0);
  }
  assert.ok(kvQuantTrace({ kvQuantScale: 0.002 }).at(-1).clipped > 0);
});

test('在线量化权重随加载转换，激活幅度仅改变运行时 scale，输出从编码恢复值计算', () => {
  for (const quantRows of [1, 6]) for (const quantOutlier of [1, 16]) {
    const f = onlineQuantTrace({ quantRows, quantOutlier }).at(-1);
    const larger = onlineQuantTrace({ quantRows, quantOutlier, quantActivation: 4 }).at(-1);
    assert.deepEqual(f.weights, larger.weights);
    assert.equal(larger.activationScale, f.activationScale * 4);
    assert.deepEqual(f.quantActivation.map((x) => x.code), larger.quantActivation.map((x) => x.code));
    assert.equal(f.weights.length, quantRows);
    f.output.forEach((value, i) => assert.equal(value, f.weights[i].reduce((sum, x, d) => sum + x.restored * f.quantActivation[d].restored, 0)));
    const trace = onlineQuantTrace({ quantRows, quantOutlier });
    trace.forEach((frame) => { if (frame.weights.length) assert.ok(frame.loaded); if (frame.quantActivation.length) assert.ok(frame.ready && frame.weights.length === quantRows); });
    assert.equal(trace[0].loaded, false);
  }
});

test('DBO 不跨依赖消费通信结果，同一资源无重叠；允许重叠时完成时隙不超过串行', () => {
  for (let dboCompute = 1; dboCompute <= 6; dboCompute++) for (let dboComm = 1; dboComm <= 6; dboComm++) for (const dboOverlap of [false, true]) {
    const trace = dboTrace({ dboCompute, dboComm, dboOverlap }), f = trace.at(-1);
    for (const batch of ['A', 'B']) {
      const jobs = f.jobs.filter((j) => j.batch === batch).sort((a, b) => a.phase - b.phase);
      for (let i = 1; i < jobs.length; i++) assert.ok(jobs[i].start >= jobs[i - 1].end);
    }
    for (const lane of ['compute', 'comm']) {
      const jobs = f.jobs.filter((j) => j.lane === lane).sort((a, b) => a.start - b.start);
      for (let i = 1; i < jobs.length; i++) assert.ok(jobs[i].start >= jobs[i - 1].end);
    }
    trace.forEach((frame, i) => { if (i) assert.ok(frame.time >= trace[i - 1].time); });
    assert.deepEqual(f.done.toSorted(), ['A', 'B']);
    assert.ok(f.total <= f.serialTotal);
    if (!dboOverlap) assert.equal(f.total, f.serialTotal);
  }
});

test('DP 分数包括 in-flight floor 与 KV 压力，同分轮转，显式路由保留归属并准确归还', () => {
  assert.equal(dpScore({ inflight: 4, waiting: 1, running: 1, usage: 0.5 }), 4);
  assert.equal(dpScore({ inflight: 0, waiting: 2, running: 1, usage: 1 }), 9);
  for (const dpRanks of [1, 2, 3, 4]) {
    const trace = dataParallelTrace({ dpRanks, dpBacklog: 0, dpKvPressure: 30 }), f = trace.at(-1);
    assert.deepEqual(f.routes.map((x) => x.rank), Array.from({ length: 6 }, (_, i) => i % dpRanks));
    assert.equal(f.returned.length, 6);
    assert.ok(f.engines.every((e) => e.inflight === 0 && !e.requests.length));
    for (const route of f.routes) assert.equal(route.scores[route.rank], Math.min(...route.scores));
    assert.ok(dataParallelTrace({ dpRanks, dpPinned: true }).at(-1).routes.every((x) => x.rank === 0));
  }
  assert.equal(dataParallelTrace().find((f) => f.routes.length).selected, 1);
});

test('Prefill/Decode 分离须在全部 KV 与完成确认有效后解码，失败保留缺失，部分块位置守恒', () => {
  for (const disaggTokens of [4, 5, 8, 16]) for (const disaggChunk of [1, 2, 4]) for (const disaggDelay of [1, 4]) for (const disaggFail of [false, true]) {
    const trace = disaggregatedTrace({ disaggTokens, disaggChunk, disaggDelay, disaggFail }), f = trace.at(-1);
    assert.equal(f.producedTokens, disaggTokens);
    assert.equal(f.blocks.reduce((sum, b) => sum + b.tokens, 0), disaggTokens);
    assert.equal(f.output.length, disaggFail ? 0 : 1);
    assert.equal(f.ack, !disaggFail);
    assert.equal(f.time, Math.ceil(Math.ceil(disaggTokens / 4) / disaggChunk) * disaggDelay);
    for (const frame of trace) {
      assert.equal(frame.receivedTokens, frame.blocks.filter((b) => b.valid).reduce((sum, b) => sum + b.tokens, 0));
      if (frame.pending) assert.ok(frame.pending.ids.every((id) => !frame.blocks[id].valid));
      if (frame.output.length) assert.ok(frame.ack && frame.blocks.every((b) => b.valid) && !frame.pending && !frame.failed);
    }
  }
});
