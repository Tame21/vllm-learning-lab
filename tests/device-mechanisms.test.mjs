import test from 'node:test';
import assert from 'node:assert/strict';
import { cudaGraphTrace, kvOffloadTrace } from '../src/engines/device-mechanisms.mjs';
import { mechanismPresets, mechanismPresetParameters } from '../src/mechanism-presets.mjs';
import { mechanismParameterNames } from '../src/mechanism-parameters.mjs';
import { validateParameters } from '../src/simulations.mjs';
import { buildTrace } from '../src/engine.mjs';
import { lessons } from '../src/content.mjs';

test('Graph 只选择已捕获且足够大的形状；回放减少 CPU 提交但不跳过设备 kernel，准备开销另计', () => {
  for (const graphMax of [2, 4, 6, 8])
    for (let graphBatch = 1; graphBatch <= 10; graphBatch++)
      for (const graphEnabled of [true, false])
        for (const graphStable of [true, false]) {
          const trace = cudaGraphTrace({ graphMax, graphBatch, graphEnabled, graphStable });
          const f = trace.at(-1), replay = graphEnabled && graphStable && graphBatch <= graphMax;
          assert.equal(f.mode, replay ? 'Graph Replay' : 'Eager');
          assert.equal(f.gpuKernels, 3);
          assert.deepEqual(f.executed, ['A', 'B', 'C']);
          assert.equal(f.cpuSubmissions, replay ? 1 : 3);
          assert.equal(f.captureKernels, graphEnabled ? 3 * graphMax / 2 : 0);
          if (replay) {
            assert.ok(f.captured.includes(f.matched));
            assert.ok(f.matched >= graphBatch && f.matched - graphBatch < 2);
            assert.equal(f.padding, f.matched - graphBatch);
          } else { assert.equal(f.matched, null); assert.equal(f.padding, 0); }
          assert.deepEqual(trace[0].captured, []);
          assert.equal(trace[0].gpuKernels, 0);
          trace.forEach((frame) => assert.equal(frame.gpuKernels, frame.executed.length));
        }
});

test('卸载读取必须等待有效 GPU 副本；传输完成前不提前标为有效，容量与物理槽唯一性始终保持', () => {
  for (const offloadCapacity of [1, 2, 4])
    for (const offloadTarget of [0, 1, 3, 5])
      for (const offloadHit of [true, false])
        for (const offloadDelay of [1, 4]) {
          const trace = kvOffloadTrace({ offloadCapacity, offloadTarget, offloadHit, offloadDelay });
          let previousReads = 0;
          for (const f of trace) {
            assert.ok(f.gpu.length + (f.pending?.direction === 'load' ? 1 : 0) <= offloadCapacity);
            assert.equal(new Set(f.gpu.map((b) => b.id)).size, f.gpu.length);
            assert.equal(new Set(f.gpu.map((b) => b.slot)).size, f.gpu.length);
            if (f.pending?.direction === 'load') assert.ok(!f.gpu.some((b) => b.id === f.pending.id));
            if (f.pending?.direction === 'store') assert.equal(f.cpu[f.pending.id].valid, false);
            if (f.reads.length > previousReads) {
              assert.equal(f.pending, null);
              assert.ok(f.gpu.some((b) => b.id === f.reads.at(-1)));
            }
            previousReads = f.reads.length;
          }
          assert.deepEqual(trace.at(-1).reads, [0, offloadTarget, 1, offloadTarget, 0]);
          assert.equal(trace[0].reads.length, 0);
        }
  const cold = kvOffloadTrace({ offloadCapacity: 1, offloadTarget: 3, offloadHit: false }).at(-1);
  assert.equal(cold.recomputes, 1);
  assert.equal(cold.stores, 1);
  assert.ok(cold.cpu[3].valid);
});

test('场景预设只设置当前专题参数，恢复一致的基线且所有场景生成可播放记录', () => {
  for (const [id, presets] of Object.entries(mechanismPresets))
    presets.forEach((_, i) => {
      const params = mechanismPresetParameters(id, i);
      assert.deepEqual(Object.keys(params), mechanismParameterNames[id]);
      const trace = buildTrace(lessons.find((l) => l.id === id), validateParameters(params));
      assert.ok(trace.length > 4 && trace.length <= 256);
      assert.ok(trace.every((f) => f.events.length));
    });
  assert.throws(() => mechanismPresetParameters('metrics', 99));
});
