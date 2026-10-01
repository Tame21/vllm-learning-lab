import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  modelLoadingTrace, logitsProcessorTrace, contextUniforms, gammaSurvival,
  poolingMechanismTrace, normalizeVector, promptEmbedsTrace, sleepTrace,
  requestMetricsTrace, serviceTraces,
} from '../src/engines/service-mechanisms.mjs';
import { buildTrace } from '../src/engine.mjs';
import { lessons } from '../src/content.mjs';
import { sourceKey } from '../src/source-map.mjs';
import { defaults, validateParameters } from '../src/simulations.mjs';
import { encodeRoute, decodeRoute } from '../src/study-state.mjs';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} ≠ ${expected}`);

test('TP 切片完整覆盖张量且不重叠；复制张量每个 rank 完整持有，checkpoint 文件数不改变设备布局', () => {
  for (const loadRanks of [1, 2, 3, 4]) {
    const a = modelLoadingTrace({ loadRanks, loadShards: 1, loadLayers: 3 });
    const b = modelLoadingTrace({ loadRanks, loadShards: 4, loadLayers: 3 });
    assert.deepEqual(a[0].tensors.flatMap((t) => t.loaded), []);
    a.at(-1).tensors.forEach((t, i) => {
      assert.ok(t.ready);
      assert.equal(t.loaded.length, loadRanks);
      assert.deepEqual(t.loaded, b.at(-1).tensors[i].loaded);
      const cells = t.loaded.flatMap((part) => Array.from({ length: part.rows[1] - part.rows[0] }, (_, row) =>
        Array.from({ length: part.cols[1] - part.cols[0] }, (_, col) => `${row + part.rows[0]},${col + part.cols[0]}`)).flat());
      assert.equal(new Set(cells).size, t.rows * t.cols);
      assert.equal(cells.length, t.rows * t.cols * (t.layout === 'replicated' ? loadRanks : 1));
    });
  }
});

test('水印采样遵守屏蔽集合，按上下文复现随机数，去重后证据只统计首次出现的上下文', () => {
  for (const processorWatermark of [true, false])
    for (const processorBan of [true, false])
      for (const processorPenalty of [0, 1, 2]) {
        const trace = logitsProcessorTrace({ processorWatermark, processorBan, processorPenalty, processorTokens: 10, seed: 17 });
        const detections = trace.filter((f) => f.stepIndex === 3), seen = new Set();
        let score = 0;
        for (const f of detections) {
          close(f.probabilities.reduce((a, b) => a + b), 1);
          assert.ok(f.pValue >= 0 && f.pValue <= 1);
          if (processorBan) { assert.equal(f.probabilities[3], 0); assert.notEqual(f.selected, 3); }
          const key = f.context.join(',');
          assert.equal(f.duplicate, seen.has(key));
          if (!seen.has(key)) { seen.add(key); score -= Math.log1p(-f.uniforms[f.selected]); }
          assert.equal(f.scored, seen.size);
          close(f.score, score);
        }
        assert.equal(trace[0].output.length, 0);
        assert.equal(trace.at(-1).output.length, 10);
      }
  assert.deepEqual(contextUniforms([1, 2], 42), contextUniforms([1, 2], 42));
  assert.notDeepEqual(contextUniforms([1, 2], 42), contextUniforms([2, 1], 42));
  assert.deepEqual(logitsProcessorTrace({ seed: 21 }), logitsProcessorTrace({ seed: 21 }));
  close(gammaSurvival(2, 1), Math.exp(-2));
  close(gammaSurvival(2, 3), 5 * Math.exp(-2));
  assert.equal(gammaSurvival(0, 0), 1);
  assert.equal(gammaSurvival(2, -1), 1);
});

test('Pooling 首末位置和均值符合有效长度；L2 归一化保持方向且零向量不产生 NaN', () => {
  assert.deepEqual(normalizeVector([0, 0]), [0, 0]);
  assert.deepEqual(normalizeVector([3, 4]), [0.6, 0.8]);
  for (const poolTokens of [1, 4, 6])
    for (const poolMethod of [0, 1, 2])
      for (const poolNormalize of [true, false]) {
        const trace = poolingMechanismTrace({ poolTokens, poolMethod, poolNormalize, poolShift: -1 });
        const f = trace.at(-1);
        const expected = poolMethod === 0 ? [0, 1].map((d) => f.hidden.reduce((sum, row) => sum + row[d], 0) / poolTokens)
          : f.hidden[poolMethod === 1 ? 0 : poolTokens - 1];
        assert.deepEqual(f.pooled, expected);
        assert.deepEqual(f.result, poolNormalize ? normalizeVector(expected) : expected);
        assert.equal(f.consumed.length, poolMethod === 0 ? poolTokens : 1);
        if (poolNormalize && Math.hypot(...expected)) close(Math.hypot(...f.result), 1);
        assert.equal(trace[0].visible, 0);
        assert.equal(trace[0].result, null);
      }
});

test('预计算向量只跳过查表，两路径都对齐全部位置并完成前向；输入差异不冒充模型输出', () => {
  for (const embedTokens of [1, 4, 8])
    for (const embedWidth of [2, 3, 4]) {
      const direct = promptEmbedsTrace({ embedTokens, embedWidth, embedDirect: true, embedDelta: 1, embedPosition: 5 });
      const lookup = promptEmbedsTrace({ embedTokens, embedWidth, embedDirect: false, embedDelta: 1, embedPosition: 5 });
      assert.equal(direct.at(-1).lookups, 0);
      assert.equal(lookup.at(-1).lookups, embedTokens);
      assert.deepEqual(direct.at(-1).positions, Array.from({ length: embedTokens }, (_, i) => 5 + i));
      assert.deepEqual(direct.at(-1).computed, lookup.at(-1).computed);
      direct.at(-1).rows.forEach((row, i) => {
        assert.equal(row.length, embedWidth);
        close(row[0] - lookup.at(-1).rows[i][0], 1);
        assert.deepEqual(row.slice(1), lookup.at(-1).rows[i].slice(1));
      });
      assert.equal(direct[0].computed.length, 0);
      for (const f of direct) assert.ok(f.computed.length <= f.positions.length && f.positions.length <= f.rows.length);
    }
});

test('休眠丢弃 KV；Level 2 不备份权重，分配权重内存后仍暂停直到有效内容与 KV 容量恢复', () => {
  for (const sleepLevel of [1, 2])
    for (const sleepUpdate of [true, false]) {
      const trace = sleepTrace({ sleepLevel, sleepUpdate, sleepWeights: 12, sleepKv: 6 });
      const asleep = trace.find((f) => f.status === '休眠中');
      assert.equal(asleep.gpuWeights + asleep.gpuKv, 0);
      assert.equal(asleep.cpuWeights, sleepLevel === 1 ? 12 : 0);
      assert.equal(asleep.cpuBuffers, sleepLevel === 2 ? 1 : 0);
      const allocation = trace.find((f) => f.status === '只唤醒权重内存');
      assert.equal(allocation.gpuWeights, 12);
      assert.equal(allocation.weightsValid, false);
      assert.ok(allocation.paused);
      const last = trace.at(-1);
      assert.equal(last.version, sleepUpdate ? 2 : 1);
      assert.equal(last.gpuKv, 6);
      assert.equal(last.kvContent, 0);
      assert.equal(last.kvVersion, null);
      assert.equal(last.paused, false);
      trace.slice(trace.indexOf(asleep)).forEach((f) => {
        assert.equal(f.kvContent, 0);
        if (!f.paused) assert.ok(f.weightsValid && f.gpuKv === 6);
      });
    }
});

test('指标按真实事件时序回放，客户端传输可跨多次生成；TPOT 排除首 token，单 token 不除零', () => {
  for (const metricTokens of [1, 2, 8])
    for (const metricNetwork of [0, 10, 40])
      for (const metricStall of [0, 60]) {
        const trace = requestMetricsTrace({ metricTokens, metricNetwork, metricStall, metricDecode: 10 });
        const last = trace.at(-1);
        assert.equal(last.serverTtft, 100);
        assert.equal(last.clientTtft, 100 + 2 * metricNetwork);
        assert.equal(last.e2e, 100 + 2 * metricNetwork + (metricTokens - 1) * 10 + (metricTokens > 1 ? metricStall : 0));
        if (metricTokens > 1) close(last.tpot, 10 + metricStall / (metricTokens - 1));
        else { assert.equal(last.tpot, null); assert.deepEqual(last.itls, []); }
        let previous = -1;
        for (const f of trace) {
          assert.ok(f.now >= previous);
          previous = f.now;
          assert.ok(f.serverTimes.filter((t) => t < f.now).length <= f.serverCount);
          assert.ok(f.serverCount <= f.serverTimes.filter((t) => t <= f.now).length);
          assert.ok(f.clientCount <= f.serverCount);
          assert.ok(f.clientTimes.slice(0, f.clientCount).every((t) => t <= f.now));
          assert.equal(f.itls.length, Math.max(0, f.serverCount - 1));
        }
      }
});

test('新增分支的源码锚点均进入构建索引；边界参数与事件位置可从链接恢复', () => {
  const ids = lessons.map((l) => l.id);
  const index = JSON.parse(fs.readFileSync(new URL('../dist/source-index.json', import.meta.url), 'utf8'));
  for (const id of Object.keys(serviceTraces)) {
    const lesson = lessons.find((l) => l.id === id);
    const options = validateParameters({ poolMethod: 2, processorWatermark: true, metricTokens: 1, sleepLevel: 2, embedTokens: 8, loadRanks: 4 }, defaults);
    const trace = buildTrace(lesson, options);
    trace.forEach((f) => assert.ok(index.refs[sourceKey(f.source || lesson.steps[f.stepIndex].source)], `${id} 的源码分支应能定位`));
    const restored = decodeRoute(encodeRoute(id, options, trace.length - 1), ids);
    assert.deepEqual(restored.options, options);
    assert.equal(restored.index, trace.length - 1);
  }
  assert.throws(() => validateParameters({ metricDecode: 0 }));
  assert.throws(() => validateParameters({ loadRanks: 2.5 }));
  assert.throws(() => validateParameters({ poolMethod: 3 }));
});
