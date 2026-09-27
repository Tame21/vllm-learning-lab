import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lessons } from '../src/content.mjs';
import { algorithmCatalog } from '../src/algorithm-catalog.mjs';
import { algorithmParameters } from '../src/algorithm-parameters.mjs';
import { defaults, validateParameters } from '../src/simulations.mjs';
import { buildTrace, executableIds } from '../src/engine.mjs';
import { controls, scene } from '../src/renderers.mjs';
import { parameterNames } from '../src/agent-tools.mjs';
import { encodeRoute, decodeRoute } from '../src/study-state.mjs';
import { sourceKey } from '../src/source-map.mjs';
import { seededRandom } from '../src/engines/speculative.mjs';
import {
  softmax,
  filterProbabilities,
  exponentialSample,
  residualMass,
  probabilityExamples,
  ngramTrace,
  onlineSoftmaxTrace,
  roundAway,
  loraInputs,
  eplbTrace,
} from '../src/engines/algorithms.mjs';

const sum = (a) => a.reduce((s, v) => s + v, 0);
const dot = (a, b) => sum(a.map((v, i) => v * b[i]));
const close = (a, b, message = '') =>
  assert.ok(Math.abs(a - b) < 1e-10, `${message}: ${a} != ${b}`);
const arrayClose = (a, b) => {
  assert.equal(a.length, b.length);
  a.forEach((v, i) => close(v, b[i]));
};
const lesson = (slug) => lessons.find((l) => l.id === 'alg-' + slug);
const trace = (slug, o = {}) => buildTrace(lesson(slug), { ...defaults, ...o });
const last = (slug, o = {}) => trace(slug, o).at(-1);

test('稳定 Softmax 平移不变、温度为零明确切换贪心', () => {
  arrayClose(softmax([2, 1, 0, -1, -2]), softmax([1002, 1001, 1000, 999, 998]));
  const cold = last('softmax', { aT: 0.1 }),
    warm = last('softmax', { aT: 2 });
  assert.ok(cold.p[0] > warm.p[0]);
  close(sum(cold.p), 1);
  const greedy = last('softmax', { aT: 0 });
  arrayClose(greedy.p, [1, 0, 0, 0, 0]);
  assert.equal(greedy.source.symbol, 'Sampler.greedy_sample');
  assert.match(greedy.body, /直接对原分数取 argmax/);
});
test('Top-k 并列、Top-p 等号与 Min-p 相对阈值遵循独立定义', () => {
  const topk = filterProbabilities('topk', [2, 1, 1, 0, -1], { aK: 2 });
  assert.deepEqual(topk.kept, [true, true, true, false, false]);
  close(sum(topk.output), 1);
  const topp = filterProbabilities('topp', [0, 0, 0, 0], { aP: 0.5 });
  assert.deepEqual(topp.kept, [false, false, true, true]);
  arrayClose(topp.output, [0, 0, 0.5, 0.5]);
  assert.equal(filterProbabilities('topp', [0, 0, 0, 0], { aP: 1 }).kept.filter(Boolean).length, 4);
  const min = filterProbabilities('minp', [2, 2, 1, 0], { aMin: 1 });
  assert.deepEqual(min.kept, [true, true, false, false]);
  assert.equal(filterProbabilities('minp', [2, 1, 0], { aMin: 0 }).kept.filter(Boolean).length, 3);
});
test('重复惩罚处理正负号，频率和存在惩罚仅计输出历史', () => {
  const f = last('penalties');
  close(f.repeated[0], 2 / 1.5);
  close(f.repeated[1], -1.5);
  close(f.frequency[0], 2 / 1.5 - 1);
  close(f.final[0], 2 / 1.5 - 1 - 0.5);
  const prompt = last('penalties', { aPreset: 1 });
  arrayClose(prompt.repeated, prompt.final);
  close(prompt.final[0], 2 / 1.5);
  arrayClose(last('penalties', { aPreset: 2 }).final, [2, -1, 1, 0, -2]);
});
test('指数竞赛可复现，零概率不胜出，固定种子的经验频率接近目标', () => {
  const p = [0.1, 0.6, 0.3, 0],
    random = seededRandom(718),
    counts = [0, 0, 0, 0];
  for (let i = 0; i < 30000; i++) counts[exponentialSample(p, random).winner]++;
  p.forEach((v, i) => assert.ok(Math.abs(counts[i] / 30000 - v) < 0.015));
  assert.equal(counts[3], 0);
  assert.deepEqual(last('exponential', { seed: 77 }), last('exponential', { seed: 77 }));
});
test('接受检验含等号；q=0 防御拒绝；残差恢复逐项重建目标分布', () => {
  assert.equal(last('rejection', { aU: 0.2 }).decision, true);
  assert.equal(last('rejection', { aU: 0.21 }).decision, false);
  assert.equal(last('rejection', { aCandidate: 1, aU: 0.99 }).decision, true);
  assert.equal(last('rejection', { aPreset: 2, aCandidate: 1, aU: 0 }).validProposal, false);
  assert.equal(last('rejection', { aPreset: 2, aCandidate: 1, aU: 0 }).decision, false);
  for (const { p, q } of probabilityExamples) {
    const f = residualMass(p, q);
    close(sum(q.map((v, i) => (v > 0 ? v * Math.min(1, p[i] / v) : 0))) + f.rejectedMass, 1);
    arrayClose(f.reconstructed, p);
    if (f.residual) close(sum(f.residual), 1);
    else close(f.rejectedMass, 0);
  }
  arrayClose(residualMass([0.1, 0.6, 0.3], [0.5, 0.3, 0.2]).residual, [0, 0.75, 0.25]);
  assert.equal(last('residual', { aPreset: 1 }).recovered, null);
});
test('首个贪心不匹配截断后缀，全接受才追加 bonus', () => {
  assert.deepEqual(last('greedy-verify').confirmed, ['A', 'B', 'A']);
  assert.deepEqual(last('greedy-verify', { aPreset: 2 }).confirmed, ['C']);
  assert.deepEqual(last('greedy-verify', { aPreset: 1 }).confirmed, ['A', 'B', 'C', 'A', 'B']);
  assert.deepEqual(last('greedy-verify').states, ['接受', '接受', '纠正', '丢弃']);
});
test('反转 KMP 对照朴素后缀搜索，含重叠、同长最早匹配与无匹配', () => {
  const random = seededRandom(42);
  for (let t = 0; t < 160; t++) {
    const n = 2 + Math.floor(random() * 12),
      history = Array.from({ length: n }, () => Math.floor(random() * 3));
    for (let max = 1; max <= 5; max++) {
      let best = 0,
        start = -1;
      for (let size = 1; size <= Math.min(max, n - 1); size++) {
        for (let i = 0; i < n - size; i++) {
          if (history.slice(i, i + size).every((v, j) => v === history[n - size + j])) {
            best = size;
            start = i + size;
            break;
          }
        }
      }
      const f = ngramTrace(history, max, 4).at(-1);
      assert.equal(f.best, best);
      assert.equal(f.start, start);
      assert.deepEqual(f.candidates, best ? history.slice(start, start + 4) : []);
    }
  }
});
test('因果 Attention 屏蔽未来，权重和为一且输出为 Value 加权和', () => {
  for (let aPreset = 0; aPreset < 3; aPreset++)
    for (let aQuery = 0; aQuery < 4; aQuery++) {
      const f = last('attention', { aPreset, aQuery });
      close(sum(f.weights), 1);
      f.weights.forEach((v, i) => {
        if (i > aQuery) assert.equal(v, 0);
      });
      arrayClose(
        f.output,
        [0, 1].map((d) =>
          dot(
            f.weights,
            f.values.map((v) => v[d]),
          ),
        ),
      );
    }
  arrayClose(last('attention', { aPreset: 2, aQuery: 3 }).weights, [0.25, 0.25, 0.25, 0.25]);
});
test('在线 Softmax 重缩放后与完整 Attention 相同，不依赖分块或分数偏移', () => {
  for (const offset of [0, 1000, -1000])
    for (const block of [1, 2, 3, 4]) {
      const scores = [0, 1, 3, 2].map((v) => v + offset),
        values = [1, 2, 4, -1],
        f = onlineSoftmaxTrace(scores, values, block).at(-1);
      close(f.output, dot(softmax(scores), values));
      close(f.m, Math.max(...scores));
      assert.ok(f.l > 0);
    }
});
test('RoPE 保持模长，RMSNorm 包含 epsilon 且不强制均值归零', () => {
  for (let aPreset = 0; aPreset < 3; aPreset++)
    for (let aPos = 0; aPos <= 6; aPos++) {
      const f = last('rope', { aPreset, aPos });
      close(Math.hypot(...f.vector), Math.hypot(...f.rotated));
    }
  const normal = last('rmsnorm');
  assert.ok(sum(normal.output) / 4 > 0);
  normal.output.forEach((v, i) =>
    close(v, normal.x[i] / Math.sqrt(dot(normal.x, normal.x) / 4 + 1e-6)),
  );
  arrayClose(last('rmsnorm', { aPreset: 1 }).output, [0, 0, 0, 0]);
});
test('分页映射跨块时以块表跳转，slot 始终指向正确块内位置', () => {
  for (const blockSize of [2, 4, 8])
    for (let aOffset = 0; aOffset < 12; aOffset++)
      for (let aPreset = 0; aPreset < 3; aPreset++) {
        const f = last('paged-address', { blockSize, aOffset, aPreset });
        assert.equal(Math.floor(f.slot / blockSize), f.map[Math.floor(aOffset / blockSize)]);
        assert.equal(f.slot % blockSize, aOffset % blockSize);
      }
});
test('链式键按父块与 salt 隔离，缓存队列只驱逐零引用块且申请失败原子化', () => {
  const same = last('prefix-hash');
  assert.deepEqual(same.keys[0], same.keys[1]);
  for (const aPreset of [1, 2]) {
    const f = last('prefix-hash', { aPreset });
    f.keys[0].forEach((v, i) => assert.notEqual(v, f.keys[1][i]));
  }
  for (let aPreset = 0; aPreset < 3; aPreset++)
    for (let aTake = 1; aTake <= 4; aTake++) {
      const frames = trace('cache-queue', { aPreset, aTake }),
        before = frames[2],
        after = frames.at(-1);
      for (const f of frames) {
        assert.equal(f.queue.length, new Set(f.queue).size);
        assert.deepEqual(
          [...f.queue].sort(),
          f.refs.flatMap((ref, id) => (ref === 0 ? [id] : [])),
        );
      }
      if (after.blocked) {
        assert.deepEqual(after.refs, before.refs);
        assert.deepEqual(after.queue, before.queue);
      } else
        for (const id of after.taken) {
          assert.equal(before.refs[id], 0);
          assert.equal(after.cached[id], false);
        }
    }
});
test('INT8 按 libdevice round 半格远离零，零行安全，误差在半尺度以内', () => {
  assert.deepEqual([-0.5, -1.5, -2.5, 0.5, 1.5, 2.5].map(roundAway), [-1, -2, -3, 1, 2, 3]);
  for (let aPreset = 0; aPreset < 3; aPreset++) {
    const f = last('int8', { aPreset });
    assert.ok(f.scale > 0);
    f.q.forEach((v) => assert.ok(Number.isInteger(v) && v >= -127 && v <= 127));
    f.errors.forEach((v) => assert.ok(v <= f.scale / 2 + 1e-12));
  }
  assert.ok(last('int8', { aPreset: 1 }).scale > last('int8').scale);
});
test('LoRA 两步低秩路径等于合并权重乘输入，比例为零退回基础结果', () => {
  const { W, A, B } = loraInputs;
  for (let aPreset = 0; aPreset < 3; aPreset++)
    for (const aScale of [0, 0.5, 1, 2]) {
      const f = last('lora', { aPreset, aScale }),
        merged = W.map((row, i) => row.map((v, j) => v + aScale * B[i][0] * A[0][j]));
      arrayClose(
        f.output,
        merged.map((row) => dot(row, f.x)),
      );
      if (aScale === 0) arrayClose(f.output, f.base);
    }
});
test('MoE 选择固定 k 个专家并归一化；EPLB 保持总负载与每设备槽位数', () => {
  for (let aPreset = 0; aPreset < 3; aPreset++)
    for (let aExperts = 1; aExperts <= 4; aExperts++) {
      const f = last('moe-topk', { aPreset, aExperts });
      assert.equal(f.selected.length, aExperts);
      close(sum(f.weights), 1);
      close(f.output, dot(f.weights, f.values));
      f.weights.forEach((v, i) => {
        if (!f.selected.includes(i)) assert.equal(v, 0);
      });
    }
  for (let extra = 0; extra <= 4; extra++) {
    const f = eplbTrace([12, 4, 2, 2], extra).at(-1);
    assert.equal(sum(f.counts), 4 + extra);
    assert.equal(f.physical.length, 4 + extra);
    close(sum(f.packLoads), 20);
    assert.equal(f.packs[0].length, f.packs[1].length);
    const slots = f.packs.flat().map((p) => p.slot);
    assert.equal(slots.length, new Set(slots).size);
  }
  assert.deepEqual(eplbTrace([12, 4, 2, 2], 2).at(-1).counts, [3, 1, 1, 1]);
});
test('Pooling 的 Mean/Last/CLS 各自符合定义，零向量 L2 不除零', () => {
  for (let aPoolMode = 0; aPoolMode < 3; aPoolMode++)
    for (let aPreset = 0; aPreset < 3; aPreset++)
      for (let aTokens = 1; aTokens <= 4; aTokens++) {
        const f = last('pooling', { aPoolMode, aPreset, aTokens, aNormalize: false });
        const expected =
          aPoolMode === 1
            ? f.inputs.at(-1)
            : aPoolMode === 2
              ? f.inputs[0]
              : [0, 1].map((d) => sum(f.inputs.map((v) => v[d])) / aTokens);
        arrayClose(f.output, expected);
        const normalized = last('pooling', { aPoolMode, aPreset, aTokens });
        close(Math.hypot(...normalized.output), Math.hypot(...expected) > 0 ? 1 : 0);
      }
});
test('24 章所有案例可渲染、参数可往返，动态源码分支都已索引', () => {
  const index = JSON.parse(
    fs.readFileSync(new URL('../dist/source-index.json', import.meta.url), 'utf8'),
  );
  assert.equal(algorithmCatalog.length, 24);
  for (const row of algorithmCatalog) {
    const l = lesson(row.slug);
    assert.ok(executableIds.includes(l.id));
    for (const id of [...row.prerequisites, ...row.related])
      assert.ok(
        lessons.some((l) => l.id === id),
        `${row.id}: ${id}`,
      );
    for (const key of ['why', 'intuition', 'formula', 'worked', 'pitfall', 'boundary', 'cost'])
      assert.ok(l[key]?.length > 8);
    for (const key of parameterNames(l))
      assert.ok(controls(l, defaults).includes(`data-param="${key}"`));
    for (let aPreset = 0; aPreset < (row.presets?.length || 1); aPreset++) {
      const options = validateParameters({ aPreset }),
        frames = buildTrace(l, options);
      frames.forEach((f, i) => {
        assert.ok(l.steps[f.stepIndex]);
        assert.ok(f.events.length);
        const html = scene(l, i, options, frames);
        assert.ok(!/NaN|undefined/.test(html), l.id);
        assert.ok(index.refs[sourceKey(f.source || l.steps[f.stepIndex].source)]);
      });
      const route = decodeRoute(
        encodeRoute(l.id, options, frames.length - 1, 'source'),
        lessons.map((l) => l.id),
      );
      assert.equal(route.options.aPreset, aPreset);
      assert.equal(route.index, frames.length - 1);
    }
  }
  for (const [key, [initial, min, max, step]] of Object.entries(algorithmParameters)) {
    if (typeof initial === 'boolean') assert.throws(() => validateParameters({ [key]: 1 }));
    else {
      assert.throws(() => validateParameters({ [key]: max + step }));
      assert.throws(() => validateParameters({ [key]: min - step }));
    }
  }
});
