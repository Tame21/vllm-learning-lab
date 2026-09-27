import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lifecycleTrace,
  runnerTrace,
  asyncTrace,
  hybridTrace,
  beamTrace,
  beamProbabilities,
  dynamicSpecTrace,
} from '../src/engines/mechanisms.mjs';
import { queueMechanismTrace } from '../src/engines/queue-mechanisms.mjs';
import { mechanismIds, mechanismParameterNames } from '../src/mechanism-parameters.mjs';
import { lessons } from '../src/content.mjs';
import { buildTrace, executableIds } from '../src/engine.mjs';
import { defaults, validateParameters } from '../src/simulations.mjs';
import { parameterNames } from '../src/agent-tools.mjs';
import { scene, controls } from '../src/renderers.mjs';
import { encodeRoute, decodeRoute, emptyStudy, saveStudy, loadStudy } from '../src/study-state.mjs';

test('生命周期采样与 KV 写入分开，EOS / 长度上限停止并保留交付结果', () => {
  for (const lifePrompt of [2, 6, 12])
    for (const lifeOutput of [1, 4, 8])
      for (const lifeEosAt of [0, 1, 3, 8]) {
        const trace = lifecycleTrace({ lifePrompt, lifeOutput, lifeEosAt });
        const stoppedByEos = lifeEosAt > 0 && lifeEosAt <= lifeOutput;
        const count = stoppedByEos ? lifeEosAt : lifeOutput;
        const sampled = trace.filter((f) => f.stepIndex === 4);
        assert.equal(sampled.length, count);
        for (const frame of sampled) {
          assert.equal(frame.computed, lifePrompt + frame.output.length - 1);
          assert.equal(frame.blocks.length, Math.ceil(frame.computed / 4));
          assert.equal(frame.scheduled.length, frame.round === 1 ? lifePrompt : 1);
        }
        const last = trace.at(-1);
        assert.equal(last.output.length, count);
        assert.equal(last.delivered.length, count - (stoppedByEos ? 1 : 0));
        assert.equal(last.status, stoppedByEos ? 'EOS 停止' : '达到输出上限');
        assert.deepEqual(last.blocks, []);
        assert.equal(last.computed, 0);
        assert.deepEqual(trace[0].output, []);
        assert.ok(sampled[0].blocks.length > 0, '释放末帧不能污染历史帧');
      }
});

test('Runner V2 保持存活请求行，V1 跟随当轮顺序，gather 与输出归属一致', () => {
  for (const runnerV2 of [false, true])
    for (const runnerReverse of [false, true])
      for (const runnerFinishB of [false, true])
        for (const runnerAddD of [false, true]) {
          const trace = runnerTrace({ runnerV2, runnerReverse, runnerFinishB, runnerAddD });
          const packed = trace.filter((f) => f.stepIndex === 2);
          for (const f of packed)
            for (const p of f.packed) {
              assert.equal(f.order[p.index], p.id);
              assert.equal(f.slots[p.slot], p.id);
              assert.equal(p.blocks.length, Math.ceil((p.position + 1) / 4));
              if (!runnerV2) assert.equal(p.index, p.slot);
            }
          if (runnerV2)
            for (const id of ['A', 'C'])
              assert.equal(packed[1].slots.indexOf(id), packed[0].slots.indexOf(id));
          assert.equal(packed[1].order.includes('B'), !runnerFinishB);
          assert.equal(packed[1].order.includes('D'), runnerAddD);
          if (runnerAddD) assert.equal(packed[1].packed.find((p) => p.id === 'D').position, 2);
          for (const f of trace.filter((f) => f.stepIndex === 3))
            for (const r of f.results)
              assert.equal(r.token, f.packed.find((p) => p.id === r.id).token + 1);
          assert.deepEqual(trace[0].slots, [null, null, null, null]);
        }
});

test('队列事件始终独占物理块；抢占不删除输出，重算不能多产 token', () => {
  for (const id of ['preemption', 'priority'])
    for (let memoryBlocks = 4; memoryBlocks <= 10; memoryBlocks++) {
      const trace = queueMechanismTrace(id, { memoryBlocks });
      let previous = trace[0];
      for (const f of trace) {
        const owned = f.requests.flatMap((r) => r.blocks);
        assert.equal(new Set([...owned, ...f.free]).size, memoryBlocks);
        assert.equal(owned.length + f.free.length, memoryBlocks);
        for (const r of f.requests) {
          const old = previous.requests.find((p) => p.id === r.id);
          assert.ok(r.output >= old.output && r.output <= r.max);
          if (f.kind !== 'sample') assert.equal(r.output, old.output);
          if (!['已完成', '已取消'].includes(r.status))
            assert.ok(r.computed <= r.blocks.length * 4);
        }
        if (f.kind === 'preempt') {
          const victim = f.requests.find((r) => r.id === f.victim);
          assert.equal(victim.computed, 0);
          assert.deepEqual(victim.blocks, []);
          assert.ok(victim.recomputeUntil > 0);
        }
        previous = f;
      }
      assert.ok(trace.at(-1).requests.every((r) => r.status === '已完成'));
      assert.equal(trace.at(-1).free.length, memoryBlocks);
      assert.ok(trace.length <= 256);
    }
  const trace = queueMechanismTrace('preemption');
  const resumed = trace.find((f) => f.kind === 'recompute' && f.requestId === 'B');
  assert.equal(resumed.requests.find((r) => r.id === 'B').output, 1);
  assert.equal(resumed.allocations.find((a) => a.id === 'B').recompute, 4);
});

test('取消 B 在轮次边界释放缓存，取消后不再调度；晚于完成的取消不改写结果', () => {
  for (let cancelAt = 1; cancelAt <= 12; cancelAt++) {
    const trace = queueMechanismTrace('preemption', { cancelAt });
    const at = trace.findIndex((f) => f.kind === 'cancel');
    if (at >= 0) {
      const b = trace[at].requests.find((r) => r.id === 'B');
      assert.equal(trace[at].tick, cancelAt);
      assert.deepEqual(b.blocks, []);
      assert.equal(b.computed, 0);
      for (const f of trace.slice(at)) {
        const current = f.requests.find((r) => r.id === 'B');
        assert.equal(current.status, '已取消');
        assert.equal(current.output, b.output);
        assert.ok(!f.allocations.some((a) => a.id === 'B'));
      }
    } else assert.equal(trace.at(-1).requests.find((r) => r.id === 'B').status, '已完成');
    assert.ok(trace.at(-1).requests.every((r) => ['已完成', '已取消'].includes(r.status)));
  }
});

test('FCFS / Priority 对照按数值与到达排序，等待准入不抢占运行中的请求', () => {
  for (const priorityA of [-3, 0, 3])
    for (const priorityB of [-3, 0, 3])
      for (const priorityC of [-3, 0, 3])
        for (const priorityMode of [false, true]) {
          const trace = queueMechanismTrace('priority', {
            priorityMode,
            priorityA,
            priorityB,
            priorityC,
          });
          const priorities = { A: priorityA, B: priorityB, C: priorityC };
          const expected = ['A', 'B', 'C'].sort(
            (a, b) => (priorityMode ? priorities[a] - priorities[b] : 0) || a.localeCompare(b),
          );
          assert.deepEqual(trace.find((f) => f.kind === 'queue').candidateIds, expected);
          assert.equal(trace.find((f) => f.kind === 'compute').requestId, expected[0]);
          assert.ok(trace.at(-1).requests.every((r) => r.status === '已完成'));
          assert.ok(trace.length < 256);
          for (let i = 1; i < trace.length; i++)
            if (trace[i].kind === 'preempt') {
              assert.equal(
                trace[i - 1].requests.find((r) => r.id === trace[i].victim).status,
                '运行',
              );
            }
        }
  const priority = queueMechanismTrace('priority', { memoryBlocks: 10 });
  const fcfs = queueMechanismTrace('priority', { memoryBlocks: 10, priorityMode: false });
  assert.deepEqual(priority.at(-1).firstRun, ['B', 'C', 'A']);
  assert.deepEqual(fcfs.at(-1).firstRun, ['A', 'B', 'C']);
  assert.deepEqual(priority.at(-1).otherOrder, fcfs.at(-1).firstRun);
});

test('异步泳道遵守准备→执行→交付依赖，GPU 不重叠执行且同步耗时为各段之和', () => {
  for (const cpuCost of [1, 2, 5])
    for (const gpuCost of [2, 4, 8]) {
      const sync = asyncTrace({ cpuCost, gpuCost, asyncEnabled: false });
      const async = asyncTrace({ cpuCost, gpuCost, asyncEnabled: true });
      assert.equal(sync.at(-1).total, 3 * (cpuCost + gpuCost + 1));
      assert.ok(async.at(-1).total < sync.at(-1).total);
      for (const trace of [sync, async]) {
        const tasks = trace[0].tasks;
        for (let i = 0; i < tasks.length; i++) {
          const t = tasks[i];
          assert.ok(t.executeStart >= t.prepareEnd);
          assert.ok(t.outputStart >= t.executeEnd);
          if (i) assert.ok(t.executeStart >= tasks[i - 1].executeEnd);
        }
        for (const f of trace) for (const b of f.returned) assert.ok(tasks[b].outputEnd <= f.tick);
        assert.deepEqual(trace.at(-1).returned, [0, 1, 2]);
      }
    }
});

test('混合 KV 只释放窗口外整块，部分块继续保留，物理块能用于后续逻辑块', () => {
  for (const windowSize of [2, 4, 12])
    for (const blockSize of [2, 4, 8]) {
      const trace = hybridTrace({ contextTokens: 24, windowSize, blockSize });
      for (const f of trace.filter((f) => f.stepIndex >= 2)) {
        assert.equal(f.skip, Math.max(0, f.position - windowSize + 1));
        for (let p = f.skip; p <= f.position; p++)
          assert.ok(f.window.some((b) => b.logical === Math.floor(p / blockSize)));
        for (const b of f.freed) assert.ok((b.logical + 1) * blockSize <= f.skip);
        assert.equal(new Set(f.window.map((b) => b.physical)).size, f.window.length);
        if (f.stepIndex === 3)
          assert.ok(f.window.every((b) => (b.logical + 1) * blockSize > f.skip));
      }
      assert.equal(trace.at(-1).full.length, Math.ceil(24 / blockSize));
    }
  const trace = hybridTrace({ contextTokens: 24, windowSize: 4, blockSize: 4 });
  const recycled = trace.find((f) => f.freed.length).freed[0];
  assert.ok(
    trace.some((f) =>
      f.window.some((b) => b.physical === recycled.physical && b.logical !== recycled.logical),
    ),
  );
  const partial = trace.find((f) => f.position === 4 && f.stepIndex === 3);
  assert.ok(
    partial.window.some((b) => b.logical === 0),
    '位置 0 已过期，但位置 1–3 仍在窗口中',
  );
});

test('Beam 累加 log 概率，得分包含前缀且排除 EOS，保留最优分支并不再扩展已结束候选', () => {
  for (const beamWidth of [1, 2, 4])
    for (const beamPenalty of [0, 1, 2]) {
      const trace = beamTrace({ beamWidth, beamDepth: 5, beamPenalty });
      for (const f of trace.filter((f) => f.stepIndex === 2)) {
        assert.ok(f.kept.length <= beamWidth);
        const expected = f.candidates
          .filter((c) => c.tokens.at(-1) !== 'EOS')
          .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
          .slice(0, beamWidth);
        assert.deepEqual(
          f.kept.map((c) => c.id),
          expected.map((c) => c.id),
        );
        for (const c of f.candidates) {
          const parent = f.parents.find((p) => p.id === c.parent);
          assert.equal(c.logp, parent.logp + Math.log(c.p));
          assert.equal(
            c.score,
            c.logp / (2 + c.tokens.filter((t) => t !== 'EOS').length) ** beamPenalty,
          );
          assert.ok(!parent.tokens.includes('EOS'));
        }
        for (const parent of f.parents)
          assert.ok(
            Math.abs(
              f.candidates.filter((c) => c.parent === parent.id).reduce((sum, c) => sum + c.p, 0) -
                1,
            ) < 1e-12,
          );
      }
      const final = trace.at(-1);
      assert.equal(final.results.length, beamWidth);
      assert.ok(final.results.every((r, i, a) => !i || a[i - 1].score >= r.score));
    }
});

test('独立采样由种子复现，分布参数会改变候选得分，显示开关不改变搜索结果', () => {
  assert.deepEqual(beamTrace({ seed: 15 }), beamTrace({ seed: 15 }));
  assert.notDeepEqual(
    beamTrace({ seed: 15 }).at(-1).samples,
    beamTrace({ seed: 93 }).at(-1).samples,
  );
  assert.notDeepEqual(beamProbabilities([], 0), beamProbabilities([], 8));
  assert.deepEqual(
    beamTrace({ beamCompare: false }).at(-1).results,
    beamTrace({ beamCompare: true }).at(-1).results,
  );
});

test('动态草稿闭区间边界不重叠，跨负载重新查表，K=0 不产生草稿位置', () => {
  for (const [sdBatch, expected] of [
    [1, 3],
    [64, 3],
    [65, 1],
    [128, 1],
    [129, 0],
    [512, 0],
  ]) {
    const trace = dynamicSpecTrace({ sdBatch });
    assert.equal(trace[1].k, expected);
    assert.equal(trace[2].candidates.length, expected);
    for (const f of trace.filter((f) => f.stepIndex === 2)) {
      const row = f.schedule[f.interval];
      assert.ok(row.min <= f.batch && f.batch <= row.max);
      assert.equal(f.candidates.length, row.k);
    }
  }
  assert.deepEqual(
    dynamicSpecTrace({ sdBatch: 96 })
      .filter((f) => f.stepIndex === 1)
      .map((f) => f.k),
    [1, 0, 3, 3],
  );
  assert.throws(() => validateParameters({ sdLow: 128, sdHigh: 128 }), /上限/);
  assert.throws(() => validateParameters({ beamWidth: 2.5 }));
  assert.throws(() => validateParameters({ asyncEnabled: 1 }));
  assert.throws(() => validateParameters({ lifePrompt: Infinity }));
});

test('新增专题所有事件可渲染并映射讲解；参数链接和持久断点完整恢复', () => {
  const ids = lessons.map((l) => l.id),
    values = new Map();
  const storage = { getItem: (k) => values.get(k) || null, setItem: (k, v) => values.set(k, v) };
  const study = emptyStudy();
  for (const id of mechanismIds) {
    const lesson = lessons.find((l) => l.id === id);
    const options = validateParameters({
      lifePrompt: 12,
      runnerV2: false,
      cancelAt: 2,
      priorityA: -3,
      asyncEnabled: false,
      windowSize: 8,
      beamWidth: 4,
      sdBatch: 512,
    });
    const trace = buildTrace(lesson, options);
    assert.ok(executableIds.includes(id));
    assert.ok(trace.length > lesson.steps.length && trace.length <= 256);
    assert.deepEqual(parameterNames(lesson), mechanismParameterNames[id]);
    for (const name of parameterNames(lesson))
      assert.match(controls(lesson, options), new RegExp(`data-param="${name}"`));
    trace.forEach((f, index) => {
      assert.ok(lesson.steps[f.stepIndex]?.source);
      assert.ok(f.events.length);
      const html = scene(lesson, index, options, trace);
      assert.match(html, new RegExp(`data-mechanism="${id}"`));
      assert.doesNotMatch(html, /NaN|undefined/);
    });
    const route = decodeRoute(encodeRoute(id, options, trace.length - 1, 'source'), ids);
    assert.deepEqual(route.options, options);
    assert.equal(route.index, trace.length - 1);
    study.sessions[id] = { options, index: route.index, tab: 'source' };
  }
  assert.equal(saveStudy(storage, study), true);
  assert.deepEqual(loadStudy(storage, ids), study);
  assert.equal(
    lessons.filter((l) => l.kind === 'flow' && !executableIds.includes(l.id)).length,
    30,
  );
});
