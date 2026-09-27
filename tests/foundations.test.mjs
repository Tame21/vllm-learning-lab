import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lessons } from '../src/content.mjs';
import { foundationCatalog, foundationNeeds } from '../src/foundation-catalog.mjs';
import { foundationParameters } from '../src/foundation-parameters.mjs';
import { defaults, validateParameters } from '../src/simulations.mjs';
import { buildTrace, executableIds } from '../src/engine.mjs';
import { controls, scene } from '../src/renderers.mjs';
import { algorithmNotes } from '../src/algorithm-view.mjs';
import { learningContext } from '../src/learning-view.mjs';
import { terms } from '../src/glossary.mjs';
import { parameterNames } from '../src/agent-tools.mjs';
import { encodeRoute, decodeRoute } from '../src/study-state.mjs';
import { sourceKey } from '../src/source-map.mjs';
import { seededRandom } from '../src/engines/speculative.mjs';
import {
  categorical,
  normalSample,
  normalDensity,
  integrateDensity,
  conditionalDistribution,
  bayes,
  information,
  reverseGaussianStep,
} from '../src/engines/foundations.mjs';

const sum = (a) => a.reduce((s, v) => s + v, 0);
const close = (a, b, tol = 1e-10) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const arrayClose = (a, b) => {
  assert.equal(a.length, b.length);
  a.forEach((v, i) => close(v, b[i]));
};
const lesson = (slug) => lessons.find((l) => l.id === 'base-' + slug);
const trace = (slug, o = {}) => buildTrace(lesson(slug), { ...defaults, ...o });
const last = (slug, o = {}) => trace(slug, o).at(-1);

test('基础数学：索引、归一化、张量元素数和矩阵点积符合定义', () => {
  for (let n = 1; n <= 4; n++) {
    const f = last('notation', { bSize: n });
    close(f.total, (n * (n + 1)) / 2);
    close(sum(f.p), 1);
    assert.equal(f.product, [1, 2, 6, 24][n - 1]);
    const shape = last('shapes', { bSize: n });
    assert.equal(shape.tensors.flat(2).length, 2 * n * 2);
  }
  for (const [angle, score] of [
    [0, 1],
    [90, 0],
    [180, -1],
  ]) {
    const f = last('linear', { bAngle: angle });
    close(f.score, score);
    arrayClose(f.output, [f.k[0] + 2 * f.k[1], -f.k[0] + f.k[1]]);
  }
  for (const bLogit of [-3, 0, 3]) {
    const f = last('exp-log', { bLogit });
    close(sum(f.p), 1);
    close(Math.exp(f.logProduct), f.product);
  }
});
test('事件、条件概率和独立性：零概率条件未定义，不能伪造分布', () => {
  for (const bProb of [0, 0.3, 1]) {
    const f = last('probability', { bProb });
    close(sum(f.p), 1);
    close(f.event, 1 - f.p[2]);
    assert.ok(f.p.every((p) => p >= 0));
  }
  arrayClose(
    conditionalDistribution(
      [
        [0.4, 0.1],
        [0.1, 0.4],
      ],
      0,
    ).conditional,
    [0.8, 0.2],
  );
  for (const bGiven of [0, 1]) {
    const f = last('conditional', { bCase: 1, bGiven });
    arrayClose(f.prior, f.conditional);
  }
  const zero = last('conditional', { bCase: 2, bGiven: 1 });
  assert.equal(zero.conditional, null);
  assert.equal(zero.marginal, 0);
  assert.match(zero.warning, /未定义/);
});
test('贝叶斯：后验含先验与证据归一化，似然相同就不更新先验', () => {
  const f = bayes(0.2, 0.8, 0.1);
  close(f.evidence, 0.24);
  arrayClose(f.posterior, [2 / 3, 1 / 3]);
  arrayClose(bayes(0.05, 0.5, 0.5).posterior, [0.05, 0.95]);
  assert.equal(bayes(0.2, 0, 0).posterior, null);
  assert.ok(bayes(0.9, 0.8, 0.1).posterior[0] > f.posterior[0]);
});
test('期望和方差按概率加权，确定事件的方差为零', () => {
  for (const p of [0, 0.1, 0.5, 0.9, 1]) {
    const f = last('moments', { bProb: p });
    close(f.mean, p);
    close(f.variance, p * (1 - p));
    close(f.std ** 2, f.variance);
  }
});
test('CDF 分类抽样区间端点归属明确，零概率类别不会选中', () => {
  assert.equal(categorical([0.2, 0.5, 0.3], 0), 0);
  assert.equal(categorical([0.2, 0.5, 0.3], 0.2), 1);
  assert.equal(categorical([0.2, 0.5, 0.3], 0.7), 2);
  assert.equal(categorical([0, 0.7, 0.3], 0), 1);
  assert.equal(categorical([0.2, 0.8, 0], 1 - Number.EPSILON), 1);
  assert.throws(() => categorical([0.2, 0.5, 0.3], 1));
  assert.throws(() => categorical([0.2, 0.5, 0.4], 0.4));
  const random = seededRandom(193),
    counts = [0, 0, 0];
  for (let i = 0; i < 20000; i++) counts[categorical([0.2, 0.5, 0.3], random())]++;
  [0.2, 0.5, 0.3].forEach((p, i) => close(counts[i] / 20000, p, 0.015));
});
test('蒙特卡洛频率可复现，标准误差按 1/√n 变化而非实际误差单调下降', () => {
  assert.deepEqual(last('monte-carlo', { seed: 91 }), last('monte-carlo', { seed: 91 }));
  for (const p of [0, 0.3, 1]) {
    const f = last('monte-carlo', { bProb: p, bDraws: 200 });
    close(f.estimate, f.count / f.n);
    close(f.se, Math.sqrt((p * (1 - p)) / 200));
    assert.equal(f.history.length, 200);
    if (p === 0 || p === 1) close(f.estimate, p);
  }
  close(last('monte-carlo', { bDraws: 20 }).se / last('monte-carlo', { bDraws: 80 }).se, 2);
  assert.equal(trace('monte-carlo')[0].estimate, null);
});
test('高斯密度与区间面积区分：密度可大于 1，平移缩放不改变一倍标准差概率', () => {
  for (const mu of [-2, 0, 2])
    for (const sigma of [0.25, 1, 2]) {
      close(integrateDensity(mu - sigma, mu + sigma, mu, sigma), 0.682689492137, 1e-9);
      close(integrateDensity(mu - 8 * sigma, mu + 8 * sigma, mu, sigma), 1, 1e-9);
      const f = last('gaussian', { bMu: mu, bSigma: sigma });
      close(f.x, mu + sigma * f.z);
    }
  assert.ok(normalDensity(0, 0, 0.25) > 1);
  const random = seededRandom(839),
    samples = Array.from({ length: 20000 }, () => normalSample(random));
  close(sum(samples) / samples.length, 0, 0.03);
  close(sum(samples.map((v) => v * v)) / samples.length, 1, 0.04);
});
test('熵、交叉熵、KL 的关系与零概率约定正确', () => {
  const same = information([0.3, 0.7], [0.3, 0.7]);
  close(same.kl, 0);
  close(same.entropy, same.crossEntropy);
  const f = information([0.3, 0.7], [0.8, 0.2]);
  assert.ok(f.kl > 0);
  close(f.crossEntropy, f.entropy + f.kl);
  close(information([0, 1], [0, 1]).entropy, 0);
  assert.equal(information([0.5, 0.5], [0, 1]).kl, Infinity);
  assert.ok(Number.isFinite(last('information', { bProb: 0 }).crossEntropy));
});
test('Token、链式概率和 EOS：词表维度正确，概率不是贪心策略的抽样频率', () => {
  for (let bToken = 0; bToken < 4; bToken++) {
    const f = last('tokens', { bToken });
    assert.equal(f.E[bToken].length, 2);
    assert.equal(f.z.length, 4);
    close(sum(f.p), 1);
  }
  assert.deepEqual(last('autoregressive', { bCase: 0 }).generated, ['B', 'A', 'B']);
  assert.deepEqual(last('autoregressive', { bCase: 1 }).generated, ['A', 'B', 'A']);
  const eos = last('autoregressive', { bCase: 2 });
  assert.deepEqual(eos.generated, ['B', 'EOS']);
  assert.deepEqual(eos.delivered, ['B']);
  close(eos.joint, 0.64);
  close(Math.exp(eos.logJoint), eos.joint);
});
test('Attention 因果掩码严格屏蔽未来位置，输出按 Value 加权', () => {
  for (let bToken = 0; bToken < 4; bToken++)
    for (const bCausal of [false, true]) {
      const f = last('attention', { bToken, bCausal });
      close(sum(f.weights), 1);
      if (bCausal) f.weights.slice(bToken + 1).forEach((w) => close(w, 0));
      f.output.forEach((v, d) => close(v, sum(f.weights.map((w, i) => w * f.values[i][d]))));
    }
  arrayClose(last('attention', { bToken: 0 }).output, [1, 0]);
});
test('训练沿负梯度降低损失，推理冻结参数并保持预测', () => {
  for (const eta of [0.05, 0.2, 1]) {
    const f = last('training', { bLearningRate: eta });
    close(f.theta, 2 * (1 - (1 - eta) ** 4));
    assert.ok(f.history.every((h, i) => i === 0 || h.loss <= f.history[i - 1].loss));
    const frozen = last('training', { bTrain: false, bLearningRate: eta });
    close(frozen.theta, 0);
    close(frozen.loss, 2);
    assert.ok(frozen.history.every((h) => h.theta === h.old));
  }
});
test('马尔可夫链传播完整分布，每轮质量守恒且第一二轮可手算', () => {
  const f = last('markov', { bStay: 0.8 });
  arrayClose(f.history[1], [0.8, 0.2]);
  arrayClose(f.history[2], [0.68, 0.32]);
  for (const bStay of [0.1, 0.5, 0.9])
    last('markov', { bStay }).history.forEach((p) => {
      close(sum(p), 1);
      assert.ok(p.every((v) => v >= 0));
    });
});
test('连续扩散前向遵循加噪公式，解析反向从独立末端分布返回两点先验', () => {
  for (const beta of [0.1, 0.25, 0.5])
    for (const seed of [1, 91, 9999]) {
      const frames = trace('diffusion', { bBeta: beta, bRounds: 8, seed });
      for (const f of frames.filter((f) => f.stepIndex === 1))
        close(f.forward.at(-1), Math.sqrt(1 - beta) * f.forward.at(-2) + Math.sqrt(beta) * f.noise);
      for (const f of frames.filter((f) => f.stepIndex === 3)) {
        close(sum(f.posterior), 1);
        assert.ok(f.posteriorVariance >= 0);
      }
      close(Math.abs(frames.at(-1).generated), 1);
      assert.equal(frames.at(-1).forward.length, 9);
      assert.equal(frames.at(-1).reverse.length, 9);
      assert.deepEqual(frames, trace('diffusion', { bBeta: beta, bRounds: 8, seed }));
    }
  // Test the reverse distribution separately; it receives no forward trajectory or noise history.
  const random = seededRandom(531),
    beta = 0.25,
    T = 6,
    a = (1 - beta) ** T;
  let positive = 0;
  for (let i = 0; i < 3000; i++) {
    let x = Math.sqrt(a) * (random() < 0.5 ? -1 : 1) + Math.sqrt(1 - a) * normalSample(random);
    for (let t = T; t > 0; t--) x = reverseGaussianStep(x, t, beta, random).x;
    close(Math.abs(x), 1);
    positive += Number(x > 0);
  }
  close(positive / 3000, 0.5, 0.035);
  const positiveSource = reverseGaussianStep(2, 1, 0.25, seededRandom(83));
  assert.ok(positiveSource.posterior[1] > 0.999);
  close(positiveSource.posteriorVariance, 0);
});
test('离散画布区分候选与确认：低置信度错误不提交，预算不足不伪装完成', () => {
  for (const bReveal of [1, 2, 3]) {
    const frames = trace('discrete-diffusion', { bCase: 1, bReveal }),
      f = frames.at(-1);
    assert.equal(f.complete, true);
    assert.deepEqual(f.delivered, ['我', '会', '学习', 'EOS']);
    assert.equal(frames.find((f) => f.stepIndex === 2).proposals[1], '要');
    assert.equal(frames.find((f) => f.stepIndex === 3).confirmed[1], false);
    const states = frames.filter((f) => f.confirmed);
    states.forEach((s, i) => {
      if (i > 0)
        states[i - 1].confirmed.forEach((v, j) => {
          if (v) {
            assert.equal(s.confirmed[j], true);
            assert.equal(s.canvas[j], states[i - 1].canvas[j]);
          }
        });
    });
    const incomplete = last('discrete-diffusion', { bCase: 2, bReveal });
    assert.equal(incomplete.complete, false);
    assert.deepEqual(incomplete.delivered, []);
  }
  assert.deepEqual(last('generation', { bDraftLength: 4 }).committed, ['A', 'B', '纠正词']);
  assert.deepEqual(last('generation', { bDraftLength: 2 }).committed, ['A', 'B', '下一词']);
});
test('20 节基础课先修依赖无环且所有链接有效，新增基础不会覆盖旧理解题', () => {
  assert.equal(foundationCatalog.length, 20);
  const visited = new Set(),
    active = new Set();
  const visit = (id) => {
    assert.ok(!active.has(id), '依赖环 ' + id);
    if (visited.has(id)) return;
    active.add(id);
    const row = foundationCatalog.find((l) => l.id === id);
    assert.ok(row);
    row.prerequisites.forEach(visit);
    active.delete(id);
    visited.add(id);
  };
  foundationCatalog.forEach((l) => visit(l.id));
  for (const row of foundationCatalog) {
    for (const id of [...row.prerequisites, ...row.related])
      assert.ok(
        lessons.some((l) => l.id === id),
        row.id + ' -> ' + id,
      );
    for (const key of ['why', 'intuition', 'formula', 'worked', 'pitfall', 'boundary', 'codeNote'])
      assert.ok(row[key]?.length > 8);
    const l = lesson(row.slug),
      html = algorithmNotes(l, lessons);
    assert.ok(html.includes('基础知识详细讲解'));
    assert.ok(!html.includes('undefined'));
    assert.ok(!learningContext(l, lessons, terms).includes('data-term="-1"'));
  }
  for (const [id, needs] of Object.entries(foundationNeeds)) {
    assert.ok(
      lessons.some((l) => l.id === id),
      id,
    );
    needs.forEach((id) => assert.ok(visited.has(id)));
  }
  assert.match(learningContext(lesson('notation'), lessons, terms), /这是起点/);
  // The original questions are bound before the new course is registered.
  const original = lessons.find((l) => l.id === 'lifecycle');
  assert.equal(original.answer, 0);
  assert.equal(original.choices[0], '保留请求状态与 KV，继续调度');
});
test('基础参数端点、所有事件、源码、控件与分享断点往返均有效', () => {
  const index = JSON.parse(
    fs.readFileSync(new URL('../dist/source-index.json', import.meta.url), 'utf8'),
  );
  for (const row of foundationCatalog) {
    const l = lesson(row.slug);
    assert.ok(executableIds.includes(l.id));
    for (const key of parameterNames(l))
      assert.ok(controls(l, defaults).includes(`data-param="${key}"`));
    const cases = [
      {},
      ...row.params.flatMap((key) => {
        if (key === 'seed') return [{ seed: 1 }, { seed: 9999 }];
        const [initial, min, max] = foundationParameters[key];
        return (typeof initial === 'boolean' ? [false, true] : [min, max]).map((v) => ({
          [key]: v,
        }));
      }),
      ...(row.presets || []).map((_, bCase) => ({ bCase })),
    ];
    for (const input of cases) {
      const options = validateParameters(input),
        frames = buildTrace(l, options);
      assert.ok(frames.length <= 256);
      frames.forEach((f, i) => {
        assert.ok(l.steps[f.stepIndex]);
        assert.ok(f.events.length);
        assert.ok(!/NaN|undefined|无效数值/.test(scene(l, i, options, frames)), l.id);
        assert.ok(index.refs[sourceKey(f.source || l.steps[f.stepIndex].source)], l.id);
      });
      const restored = decodeRoute(
        encodeRoute(l.id, options, frames.length - 1, 'source'),
        lessons.map((l) => l.id),
      );
      assert.deepEqual(restored.options, options);
      assert.equal(restored.index, frames.length - 1);
    }
  }
  for (const [key, [initial, min, max, step]] of Object.entries(foundationParameters)) {
    if (typeof initial === 'boolean') assert.throws(() => validateParameters({ [key]: 1 }));
    else
      for (const value of [min - step, max + step, NaN, Infinity, String(initial)])
        assert.throws(() => validateParameters({ [key]: value }));
  }
});
