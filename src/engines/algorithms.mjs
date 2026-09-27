// SPDX-License-Identifier: Apache-2.0
// N-gram control logic adapted from vLLM's ngram_proposer.py.
// Copyright contributors to the vLLM project. See NOTICE and docs/ALGORITHMS.md.
import { algorithmDefaults } from '../algorithm-parameters.mjs';
import { algorithmSources as S } from '../algorithm-sources.mjs';
import { seededRandom } from './speculative.mjs';
import { beamTrace, dynamicSpecTrace } from './mechanisms.mjs';

export const softmax = (values) => {
  const max = Math.max(...values),
    exps = values.map((v) => Math.exp(v - max));
  const sum = exps.reduce((s, v) => s + v, 0);
  return exps.map((v) => v / sum);
};
const sum = (a) => a.reduce((s, v) => s + v, 0);
const dot = (a, b) => sum(a.map((v, i) => v * b[i]));
const norm = (a) => Math.hypot(...a);
const scale = (a, k) => a.map((v) => v * k);
const letters = (n) => Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
const frame = (out, stepIndex, event, state = {}) =>
  out.push(structuredClone({ stepIndex, events: [event], ...state }));
const bar = (name, values, labels = letters(values.length), extra = {}) => ({
  name,
  values,
  labels,
  ...extra,
});
const table = (head, rows) => ({ head, rows });
export const logitExamples = [
  [2, 1, 0, -1, -2],
  [2, 1, 1, 0, -1],
  [1002, 1001, 1000, 999, 998],
];
export const probabilityExamples = [
  { p: [0.1, 0.6, 0.3], q: [0.5, 0.3, 0.2] },
  { p: [0.1, 0.6, 0.3], q: [0.1, 0.6, 0.3] },
  { p: [0.1, 0.6, 0.3], q: [1, 0, 0] },
];

export function filterProbabilities(kind, logits, o) {
  const p = softmax(logits),
    ascending = logits.map((v, i) => i).sort((a, b) => logits[a] - logits[b] || a - b);
  const cumulative = [];
  let total = 0;
  for (const id of ascending) {
    total += p[id];
    cumulative[id] = total;
  }
  const threshold =
    kind === 'topk'
      ? [...logits].sort((a, b) => b - a)[o.aK - 1]
      : kind === 'minp'
        ? o.aMin * Math.max(...p)
        : 1 - o.aP;
  const kept = p.map((v, i) =>
    kind === 'topk'
      ? logits[i] >= threshold
      : kind === 'minp'
        ? v >= threshold
        : cumulative[i] > threshold || i === ascending.at(-1),
  );
  const mass = sum(p.filter((_, i) => kept[i]));
  return {
    p,
    ascending,
    cumulative,
    threshold,
    kept,
    output: p.map((v, i) => (kept[i] ? v / mass : 0)),
    mass,
  };
}
function samplingTrace(slug, o) {
  const out = [],
    z = logitExamples[o.aPreset],
    labels = letters(z.length);
  if (slug === 'softmax') {
    const greedy = o.aT === 0,
      scaled = greedy ? [...z] : scale(z, 1 / o.aT),
      m = Math.max(...scaled);
    const centered = scaled.map((v) => v - m),
      exps = centered.map(Math.exp);
    const p = greedy ? z.map((v, i) => (i === z.indexOf(Math.max(...z)) ? 1 : 0)) : softmax(scaled);
    const source = greedy ? S.greedy : undefined;
    frame(out, 0, '先读取原始 logits。', { bars: [bar('原始 logits', z)], z });
    frame(out, 1, greedy ? 'T=0：进入贪心路径，不做除零。' : `每个分数除以 T=${o.aT}。`, {
      bars: [bar(greedy ? '贪心比较原分数' : '缩放后分数', scaled)],
      source,
    });
    frame(
      out,
      2,
      greedy ? '贪心不需要指数归一化。' : '减去相同最大值，改变尺度但不改变最终概率。',
      { bars: [bar(greedy ? '原始分数' : '减最大值后的分数', greedy ? z : centered)], source },
    );
    frame(out, 3, greedy ? '只选择最大 logit 的 token。' : '指数权重除以它们的总和。', {
      bars: [bar(greedy ? '确定性选择' : '指数权重', greedy ? p : exps)],
      source,
    });
    frame(out, 4, '检查概率之和，并比较统一平移后的结果。', {
      bars: [bar('最终概率', p)],
      p,
      z,
      metrics: [
        [sum(p), '概率和'],
        [greedy ? '贪心' : o.aT, '温度 / 分支'],
      ],
      table: table(
        ['token', '原分数', '输出概率'],
        z.map((v, i) => [labels[i], v, p[i]]),
      ),
      source,
    });
    if (greedy) {
      const titles = ['读取 logits', '选择贪心分支', '跳过指数运算', '取 argmax', '检查确定性结果'];
      for (const f of out) {
        f.title = titles[f.stepIndex];
        f.body =
          f.stepIndex === 0
            ? '原分数可以直接比较大小。'
            : 'T=0 时直接对原分数取 argmax。这里用 one-hot 表示确定性结果，不执行 Softmax 的除温度和指数归一化。';
      }
    }
  } else {
    const f = filterProbabilities(slug, z, o),
      criterion =
        slug === 'topk' ? '第 k 大 logit' : slug === 'topp' ? '可移除尾部质量' : '相对概率门槛';
    frame(out, 0, '原始分布是筛选前的参照。', { bars: [bar('原始概率', f.p)], ...f });
    frame(out, 1, slug === 'topp' ? '按概率升序计算累计值。' : `确定${criterion}。`, {
      bars: [bar('原始概率', f.p)],
      table:
        slug === 'topp'
          ? table(
              ['token', 'logit', '概率', '升序累计'],
              f.ascending.map((i) => [labels[i], z[i], f.p[i], f.cumulative[i]]),
            )
          : slug === 'topk'
            ? table(
                ['名次', 'token', 'logit', '第 k 大阈值'],
                [...f.ascending]
                  .reverse()
                  .map((i, rank) => [rank + 1, labels[i], z[i], f.threshold]),
              )
            : table(
                ['token', '概率', '最高概率', '相对门槛'],
                f.p.map((p, i) => [labels[i], p, Math.max(...f.p), f.threshold]),
              ),
      ...f,
    });
    frame(out, 2, `${criterion} = ${f.threshold.toFixed(4)}；屏蔽不满足规则的候选。`, {
      bars: [bar('筛选后的原概率质量', f.p, labels, { kept: f.kept })],
      ...f,
      metrics: [
        [f.kept.filter(Boolean).length, '保留数量'],
        [f.mass, '保留质量'],
      ],
    });
    frame(out, 3, '保留集合重新归一化，总和恢复到 1。', {
      bars: [bar('重新归一化的概率', f.output, labels, { kept: f.kept })],
      ...f,
    });
    frame(out, 4, '比较前后分布：范围改变，保留项的相对比例不变。', {
      bars: [bar('原概率', f.p), bar('最终概率', f.output, labels, { kept: f.kept })],
      ...f,
      metrics: [
        [f.kept.filter(Boolean).length, '保留数量'],
        [sum(f.output), '概率和'],
      ],
    });
  }
  return out;
}

function penaltiesTrace(o) {
  const out = [],
    z = [2, -1, 1, 0, -2],
    prompt = o.aPreset === 2 ? [] : [0, 3],
    counts = o.aPreset === 0 ? [2, 1, 0, 0, 0] : [0, 0, 0, 0, 0];
  const repeated = z.map((v, i) =>
    prompt.includes(i) || counts[i] > 0 ? (v > 0 ? v / o.aRepeat : v * o.aRepeat) : v,
  );
  const frequency = repeated.map((v, i) => v - o.aFrequency * counts[i]),
    final = frequency.map((v, i) => v - (counts[i] > 0 ? o.aPresence : 0));
  const state = { z, prompt, counts, repeated, frequency, final };
  const history = table(
    ['token', 'prompt 出现', '输出次数'],
    z.map((v, i) => [letters(5)[i], prompt.includes(i) ? '是' : '否', counts[i]]),
  );
  frame(out, 0, '统计 prompt 掩码和输出计数，二者用途不同。', {
    ...state,
    bars: [bar('原始分数', z)],
    table: history,
  });
  frame(out, 1, '重复惩罚：正数除，负数乘；零保持不变。', {
    ...state,
    bars: [bar('重复惩罚后', repeated)],
    table: history,
  });
  frame(out, 2, '频率惩罚只按输出中的出现次数扣分。', {
    ...state,
    bars: [bar('频率惩罚后', frequency)],
    table: history,
  });
  frame(out, 3, '存在惩罚只检查是否出现在输出中。', {
    ...state,
    bars: [bar('存在惩罚后', final)],
    table: history,
  });
  frame(out, 4, '先改分数，再通过 Softmax 得到新的抽样概率。', {
    ...state,
    bars: [bar('原概率', softmax(z)), bar('新概率', softmax(final))],
    table: table(
      ['token', '原值', '重复后', '频率后', '最终'],
      z.map((v, i) => [letters(5)[i], v, repeated[i], frequency[i], final[i]]),
    ),
  });
  return out;
}

export function exponentialSample(p, random) {
  const u = p.map(() => Math.max(Number.EPSILON, Math.min(1 - Number.EPSILON, random())));
  const noise = u.map((v) => -Math.log(v)),
    scores = p.map((v, i) => v / noise[i]);
  return { u, noise, scores, winner: scores.indexOf(Math.max(...scores)) };
}
function exponentialTrace(o) {
  const out = [],
    p = softmax(logitExamples[o.aPreset]),
    result = exponentialSample(p, seededRandom(o.seed));
  frame(out, 0, '以该概率分布为抽样目标。', { p, bars: [bar('目标概率', p)] });
  frame(out, 1, `种子 ${o.seed} 生成逐 token 独立噪声。`, {
    p,
    ...result,
    bars: [bar('指数噪声 E', result.noise)],
    table: table(
      ['token', 'U', '−ln(U)'],
      p.map((v, i) => [letters(5)[i], result.u[i], result.noise[i]]),
    ),
  });
  frame(out, 2, '比较概率除以噪声的结果，概率较小的项也可能获胜。', {
    p,
    ...result,
    bars: [bar('竞赛分数 P/E', result.scores)],
  });
  frame(out, 3, `最大竞赛分数对应 ${letters(5)[result.winner]}。`, {
    p,
    ...result,
    bars: [bar('竞赛分数 P/E', result.scores, letters(5), { active: result.winner })],
  });
  frame(out, 4, '相同参数与种子得到相同示例；换种子观察另一场比赛。', {
    p,
    ...result,
    bars: [
      bar('目标概率', p),
      bar('竞赛分数', result.scores, letters(5), { active: result.winner }),
    ],
    metrics: [
      [letters(5)[result.winner], '本次选中'],
      [o.seed, '教学种子'],
    ],
  });
  return out;
}

export function residualMass(p, q) {
  const accepted = p.map((v, i) => Math.min(v, q[i])),
    deficit = p.map((v, i) => Math.max(v - q[i], 0)),
    rejectedMass = sum(deficit);
  const residual = rejectedMass > 1e-14 ? deficit.map((v) => v / rejectedMass) : null;
  return {
    accepted,
    deficit,
    rejectedMass,
    residual,
    reconstructed: p.map((_, i) => accepted[i] + (residual ? rejectedMass * residual[i] : 0)),
  };
}
function rejectionTrace(slug, o) {
  const out = [],
    { p, q } = probabilityExamples[o.aPreset],
    x = o.aCandidate;
  const mass = residualMass(p, q),
    alpha = q[x] > 0 ? Math.min(1, p[x] / q[x]) : 0,
    accepted = q[x] > 0 && p[x] / q[x] >= o.aU;
  const state = {
    p,
    q,
    ...mass,
    candidate: x,
    alpha,
    uniform: o.aU,
    decision: accepted,
    validProposal: q[x] > 0,
  };
  const pq = [bar('目标 p', p), bar('草稿 q', q)];
  frame(out, 0, 'p 和 q 必须是同一条件前缀下的分布。', { ...state, bars: pq });
  if (slug === 'rejection') {
    frame(out, 1, `固定观察候选 ${letters(3)[x]}，读取 p(x) 与 q(x)。`, {
      ...state,
      bars: pq.map((b) => ({ ...b, active: x })),
      metrics: [
        [p[x], 'p(x)'],
        [q[x], 'q(x)'],
      ],
    });
    frame(
      out,
      2,
      q[x] > 0
        ? `接受阈值 min(1,p/q)=${alpha.toFixed(4)}。`
        : 'q(x)=0，合法草稿不可能提出此项；展示防御性拒绝。',
      { ...state, acceptance: true, bars: pq },
    );
    frame(
      out,
      3,
      accepted ? 'u 不超过阈值，接受这个候选。' : '拒绝这个候选，不能继续直接提交后缀。',
      { ...state, acceptance: true, bars: pq },
    );
    frame(
      out,
      4,
      accepted
        ? '进入下一候选验证；如果全收，还可追加目标 bonus。'
        : '接下来要从正残差分布恢复，不是直接重新抽 p。',
      {
        ...state,
        acceptance: true,
        bars: [bar('目标 p', p), bar('条件恢复分布', mass.residual || [0, 0, 0])],
        metrics: [
          [accepted ? '接受' : '拒绝', '本次判断'],
          [q[x] === 0 ? '非法提议' : alpha, '条件接受概率'],
        ],
      },
    );
  } else {
    frame(out, 1, '接受阶段为每项交付 min(p,q) 的无条件质量。', {
      ...state,
      bars: [bar('已接受质量 h', mass.accepted)],
      metrics: [[sum(mass.accepted), '整体接受概率']],
    });
    frame(out, 2, '正差才是目标还缺少的质量；负差截为零。', {
      ...state,
      bars: [
        bar(
          '差值 p−q',
          p.map((v, i) => v - q[i]),
        ),
        bar('正残差 d', mass.deficit),
      ],
      metrics: [[mass.rejectedMass, '整体拒绝概率 R']],
    });
    frame(
      out,
      3,
      mass.residual ? '除以 R 得到拒绝条件下的恢复分布。' : 'p=q、R=0：不会进入恢复，禁止除零。',
      {
        ...state,
        bars: [bar(mass.residual ? '恢复分布 r' : '恢复分支不可达', mass.residual || [0, 0, 0])],
      },
    );
    const recovered = mass.residual
      ? exponentialSample(mass.residual, seededRandom(o.seed)).winner
      : null;
    frame(out, 4, '逐项检查 h + Rr = p；抽样只影响单次结果，不改变这个概率恒等式。', {
      ...state,
      recovered,
      massBalance: true,
      bars: [bar('重建分布 h+Rr', mass.reconstructed), bar('目标 p', p)],
      metrics: [
        [mass.rejectedMass, '拒绝质量 R'],
        [recovered === null ? '无需恢复' : letters(3)[recovered], '一次恢复抽样'],
      ],
      table: table(
        ['token', '接受 h', '恢复质量 Rr', '合计', '目标 p'],
        p.map((v, i) => [
          letters(3)[i],
          mass.accepted[i],
          mass.deficit[i],
          mass.reconstructed[i],
          v,
        ]),
      ),
    });
  }
  return out;
}

function greedyTrace(o) {
  const out = [],
    draft = ['A', 'B', 'C', 'A'],
    target =
      o.aPreset === 1 ? [...draft] : o.aPreset === 2 ? ['C', 'B', 'C', 'A'] : ['A', 'B', 'A', 'C'];
  const state = {
    draft,
    target,
    confirmed: [],
    states: draft.map(() => '待核对'),
    bonus: 'B',
    rejected: -1,
  };
  frame(out, 0, '准备草稿序列和对应位置的目标 argmax。', { ...state, tokens: true });
  for (let i = 0; i < draft.length; i++) {
    if (draft[i] !== target[i]) {
      state.rejected = i;
      state.states[i] = '纠正';
      state.states = state.states.map((v, j) => (j > i ? '丢弃' : v));
      state.confirmed.push(target[i]);
      frame(out, 2, `位置 ${i} 不一致，用 ${target[i]} 纠正，丢弃后续草稿。`, {
        ...state,
        tokens: true,
      });
      break;
    }
    state.confirmed.push(draft[i]);
    state.states[i] = '接受';
    frame(out, 1, `位置 ${i} 一致，连续确认前缀增长。`, { ...state, tokens: true });
  }
  if (state.rejected < 0) {
    state.confirmed.push(state.bonus);
    frame(out, 2, '全部匹配，追加目标 bonus B。', { ...state, tokens: true });
  }
  frame(out, 3, `本轮提交 ${state.confirmed.join(' → ')}。`, {
    ...state,
    tokens: true,
    metrics: [
      [state.confirmed.length, '提交数'],
      [state.rejected < 0 ? draft.length : state.rejected, '接受草稿数'],
    ],
  });
  return out;
}

export const ngramExamples = [
  ['A', 'B', 'C', 'A', 'B', 'D', 'A', 'B'],
  ['A', 'B', 'C', 'D'],
  Array(8).fill('A'),
];
export function ngramTrace(history, maxN, k) {
  const out = [],
    reversed = [...history].reverse(),
    lps = Array(maxN).fill(0);
  let j = 0,
    i = 1,
    best = 0,
    position = 0;
  const snap = (step, event, extra = {}) =>
    frame(out, step, event, {
      history,
      reversed,
      lps,
      i,
      j,
      best,
      position,
      ...extra,
      ngram: true,
    });
  snap(0, '反转历史，把后缀匹配转成前缀匹配。');
  while (i < reversed.length) {
    if (reversed[j] === reversed[i]) {
      j++;
      if (j >= best) {
        best = j;
        position = i;
      }
      if (i < maxN) lps[i] = j;
      snap(1, `i=${i} 匹配成功，j=${j}；当前最长=${best}。`);
      if (j === maxN) {
        j = lps[maxN - 1];
        snap(1, `已达到最大匹配长度 ${maxN}，按 LPS 回退到 ${j}。`);
      }
      i++;
    } else if (j !== 0) {
      j = lps[j - 1];
      snap(1, `失配，保持 i=${i}，j 沿 LPS 回退到 ${j}。`);
    } else {
      snap(1, `i=${i} 无可用前缀，向右继续。`);
      i++;
    }
  }
  const start = best ? history.length - 1 - position + best : -1,
    matchStart = best ? start - best : -1;
  const candidates = best ? history.slice(start, start + k) : [];
  snap(
    2,
    best ? `原历史最早的最长匹配从 ${matchStart} 开始，长度 ${best}。` : '没有匹配，不提出草稿。',
    { start, matchStart, candidates: [] },
  );
  snap(3, `复制 ${candidates.length} 个候选，之后仍需目标验证。`, {
    start,
    matchStart,
    candidates,
  });
  return out;
}

export const attentionInputs = (o) => ({
  q: o.aPreset === 2 ? [0, 0] : [1, 0],
  keys:
    o.aPreset === 1
      ? Array.from({ length: 4 }, () => [1, 0])
      : [
          [1, 0],
          [0, 1],
          [1, 1],
          [-1, 1],
        ],
  values: [
    [1, 0],
    [0, 2],
    [1, 1],
    [-1, 2],
  ],
});
function attentionTrace(o) {
  const out = [],
    { q, keys, values } = attentionInputs(o),
    scores = keys.map((k) => dot(q, k) / Math.sqrt(q.length));
  const masked = scores.map((v, i) => (i <= o.aQuery ? v : -Infinity)),
    weights = softmax(masked),
    output = [0, 0];
  const state = { q, keys, values, scores, weights, query: o.aQuery };
  const tensors = table(
    ['位置', 'Key', 'Value', '可见'],
    keys.map((k, i) => [i, k, values[i], i <= o.aQuery ? '是' : '未来']),
  );
  frame(out, 0, `选中位置 ${o.aQuery} 的 query=[${q}]。`, { ...state, table: tensors });
  frame(out, 1, '点积除以 √2，得到缩放分数。', {
    ...state,
    bars: [
      bar(
        '点积分数',
        scores,
        keys.map((_, i) => '位置 ' + i),
      ),
    ],
    table: tensors,
  });
  frame(out, 2, '未来位置被屏蔽为 −∞，不参与归一化。', {
    ...state,
    bars: [
      bar(
        '可见分数',
        scores,
        keys.map((_, i) => '位置 ' + i),
        { kept: keys.map((_, i) => i <= o.aQuery) },
      ),
    ],
    table: tensors,
  });
  frame(out, 3, '可见位置的权重相加为 1。', {
    ...state,
    bars: [bar('注意力权重', weights)],
    table: tensors,
  });
  for (let i = 0; i <= o.aQuery; i++) {
    for (let d = 0; d < 2; d++) output[d] += weights[i] * values[i][d];
    frame(out, 4, `加上位置 ${i} 的 w×V，累计输出 [${output.map((v) => v.toFixed(4))}]。`, {
      ...state,
      output,
      bars: [
        bar('注意力权重', weights, letters(4), { active: i }),
        bar('当前累计输出', output, ['维度 0', '维度 1']),
      ],
      table: table(
        ['位置', 'w', 'w×V₀', 'w×V₁'],
        values.map((v, j) => [j, weights[j], weights[j] * v[0], weights[j] * v[1]]),
      ),
    });
  }
  return out;
}

export function onlineSoftmaxTrace(scores, values, chunkSize) {
  const out = [],
    history = [];
  let m = -Infinity,
    l = 0,
    a = 0;
  frame(out, 0, '尚未读取任何块，指数和与加权累加器均为 0。', {
    m,
    l,
    a,
    history,
    bars: [bar('完整输入分数', scores), bar('对应 Value（单维示例）', values)],
  });
  for (let start = 0; start < scores.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, scores.length),
      next = Math.max(m, ...scores.slice(start, end)),
      alpha = Math.exp(m - next);
    const old = { m, l, a },
      probs = scores.slice(start, end).map((v) => Math.exp(v - next));
    frame(out, 1, `读取位置 [${start},${end})，新的最大值是 ${next}。`, {
      m,
      l,
      a,
      history,
      bars: [
        bar('本轮读取位置', scores, letters(scores.length), {
          kept: scores.map((_, i) => i >= start && i < end),
        }),
      ],
      metrics: [
        [m, '旧最大值'],
        [next, '新最大值'],
        [alpha, '旧量重缩放 α'],
      ],
    });
    l = alpha * l + sum(probs);
    a = alpha * a + sum(probs.map((p, i) => p * values[start + i]));
    m = next;
    history.push({ start, end, old, next, alpha, m, l, a });
    frame(out, 2, `完成基准变换并累加，l=${l.toFixed(4)}，a=${a.toFixed(4)}。`, {
      m,
      l,
      a,
      history,
      bars: [bar('输入分数', scores)],
      metrics: [
        [m, 'm'],
        [l, 'l'],
        [a, 'a'],
      ],
      table: table(
        ['块', '旧 m', '新 m', 'α', 'l', 'a'],
        history.map((h) => [`${h.start}…${h.end - 1}`, h.old.m, h.m, h.alpha, h.l, h.a]),
      ),
    });
  }
  const reference = dot(softmax(scores), values),
    output = a / l;
  frame(out, 3, '只在最后除以指数和，和一次性计算比较。', {
    m,
    l,
    a,
    history,
    output,
    reference,
    bars: [bar('最终注意力权重', softmax(scores))],
    metrics: [
      [output, '在线结果'],
      [reference, '一次性结果'],
      [Math.abs(output - reference), '绝对差'],
    ],
  });
  return out;
}

function ropeTrace(o) {
  const out = [],
    v = [
      [1, 0],
      [1, 1],
      [0, 0],
    ][o.aPreset],
    angle = o.aPos,
    c = Math.cos(angle),
    s = Math.sin(angle),
    rotated = [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
  const state = { vector: v, rotated, angle, cos: c, sin: s };
  frame(out, 0, '一个坐标对的原始方向。', { ...state, rotation: true, showRotated: false });
  frame(out, 1, `位置 ${o.aPos} × 频率 1 = ${angle} 弧度。`, {
    ...state,
    rotation: true,
    showRotated: false,
    metrics: [[angle, 'θ（弧度）']],
  });
  frame(out, 2, 'cos 与 sin 组成同一个旋转矩阵。', {
    ...state,
    rotation: true,
    showRotated: false,
    table: table(
      ['cos θ', '−sin θ'],
      [
        [c, -s],
        [s, c],
      ],
    ),
  });
  frame(out, 3, '两个坐标交叉混合，得到新的方向。', {
    ...state,
    rotation: true,
    showRotated: true,
    metrics: [
      [rotated[0], 'x′'],
      [rotated[1], 'y′'],
    ],
  });
  frame(out, 4, '检查旋转前后长度；零向量保持零。', {
    ...state,
    rotation: true,
    showRotated: true,
    metrics: [
      [norm(v), '原长度'],
      [norm(rotated), '旋转后长度'],
      [Math.abs(norm(v) - norm(rotated)), '长度差'],
    ],
  });
  return out;
}
function rmsTrace(o) {
  const out = [],
    x = [
      [1, 2, 3, 4],
      [0, 0, 0, 0],
      [-2, 1, -1, 2],
    ][o.aPreset],
    squares = x.map((v) => v * v),
    mean = sum(squares) / x.length,
    epsilon = 10 ** -o.aEpsPower,
    r = Math.sqrt(mean + epsilon),
    normalized = scale(x, 1 / r),
    output = scale(normalized, o.aGain);
  const state = { x, mean, epsilon, r, output };
  frame(out, 0, '保留输入正负号，只在统计尺度时平方。', { ...state, bars: [bar('输入 x', x)] });
  frame(out, 1, '逐项平方求均值，不减输入均值。', {
    ...state,
    bars: [bar('x²', squares)],
    metrics: [[mean, '均方']],
  });
  frame(out, 2, '加 ε 后开方，保证零输入也不会除零。', {
    ...state,
    metrics: [
      [epsilon, 'ε'],
      [r, '均方根分母'],
    ],
    bars: [bar('输入 x', x)],
  });
  frame(out, 3, '每个分量除以相同的分母。', { ...state, bars: [bar('x/r', normalized)] });
  frame(out, 4, '乘 γ 后得到本层输出；其均值一般不为零。', {
    ...state,
    bars: [bar('最终输出', output)],
    metrics: [
      [sum(output) / output.length, '输出均值'],
      [o.aGain, '统一 γ'],
    ],
  });
  return out;
}

function addressTrace(o) {
  const out = [],
    B = o.blockSize,
    maps = [
      [3, 0, 5, 1, 4, 2],
      [1, 5, 2, 4, 0, 3],
      [0, 1, 2, 3, 4, 5],
    ],
    map = maps[o.aPreset].slice(0, Math.ceil(12 / B)),
    position = o.aOffset,
    logical = Math.floor(position / B),
    offset = position % B,
    physical = map[logical],
    slot = physical * B + offset;
  const state = { map, position, logical, offset, physical, slot, blockSize: B, address: true };
  [
    '读取逻辑位置。',
    '整除得到逻辑块编号。',
    '查块表得到物理块编号。',
    '物理块起点加块内余数。',
    '逻辑连续不要求物理连续；slot 不是字节地址。',
  ].forEach((event, i) =>
    frame(out, i, event, {
      ...state,
      metrics:
        i >= 3
          ? [
              [logical, '逻辑块'],
              [offset, '块内偏移'],
              [slot, '物理 slot'],
            ]
          : [[position, '逻辑位置']],
      table: table(
        ['逻辑块', '物理块'],
        map.map((v, j) => [j, v]),
      ),
    }),
  );
  return out;
}
function hashTrace(o) {
  const out = [],
    a = ['A', 'B', 'C', 'D', 'E', 'F'],
    b = o.aPreset === 1 ? ['X', 'B', 'C', 'D', 'E', 'F'] : [...a],
    keys = [[], []],
    parts = [[], []],
    aliases = new Map();
  const salt = ['public', o.aPreset === 2 ? 'private' : 'public'];
  const alias = (key) => {
    if (!aliases.has(key)) aliases.set(key, 'H' + aliases.size);
    return aliases.get(key);
  };
  const snap = (step, event) =>
    frame(out, step, event, {
      hash: true,
      keys,
      parts,
      inputs: [a, b],
      salt,
      table: table(
        ['请求', '块', '键的组成（摘要仅用编号显示）', '键标签', '两请求匹配'],
        parts.flatMap((row, r) =>
          row.map((p, i) => [
            r === 0 ? 'A' : 'B',
            i,
            p.expression,
            p.alias,
            keys[0][i] === keys[1][i] ? '相同' : '不同',
          ]),
        ),
      ),
    });
  snap(0, '两个请求按 2 token 的完整块分组。');
  for (let block = 0; block < 3; block++) {
    [a, b].forEach((tokens, r) => {
      const parent = block ? keys[r][block - 1] : 'ROOT',
        chunk = tokens.slice(block * 2, block * 2 + 2),
        key = JSON.stringify([parent, chunk, salt[r]]);
      keys[r].push(key);
      parts[r].push({
        alias: alias(key),
        expression: `H(${block ? parts[r][block - 1].alias : 'ROOT'}, [${chunk}], salt=${salt[r]})`,
      });
    });
    snap(block === 0 ? 1 : 2, `第 ${block} 块加入父键、当前 token 和 salt。`);
  }
  snap(3, '逐块比较完整签名；父键不同会传播到后续块。');
  snap(4, '签名相同是复用依据；这里不计算完整请求的实际缓存命中量。');
  return out;
}
function cacheQueueTrace(o) {
  const out = [],
    refs = o.aPreset === 2 ? [1, 1, 1, 1] : o.aPreset === 1 ? [0, 1, 0, 1] : [0, 0, 0, 1],
    queue = refs.flatMap((n, i) => (n === 0 ? [i] : [])),
    cached = [true, true, true, true],
    taken = [];
  const snap = (step, event, extra = {}) =>
    frame(out, step, event, { cacheQueue: true, refs, queue, cached, taken, ...extra });
  snap(0, '只把 ref_cnt=0 的块放入可重新分配队列。');
  if (refs[1] === 0) queue.splice(queue.indexOf(1), 1);
  refs[1]++;
  snap(1, '命中块 1，增加引用；如果原来空闲，就移出队列。');
  refs[1]--;
  if (refs[1] === 0) queue.push(1);
  snap(
    2,
    refs[1] === 0 ? '释放后块 1 重新排在队尾。' : '仍有其他请求引用块 1，所以它不能入空闲队列。',
  );
  const blocked = queue.length < o.aTake;
  if (!blocked)
    for (let n = 0; n < o.aTake; n++) {
      const id = queue.shift();
      refs[id] = 1;
      cached[id] = false;
      taken.push(id);
    }
  snap(
    3,
    blocked
      ? `需要 ${o.aTake} 块，但仅有 ${queue.length} 块空闲，申请失败。`
      : `从队头分配 ${taken.join('、')}，清除对应旧缓存映射。`,
    { blocked },
  );
  snap(4, '引用计数、空闲队列和缓存内容状态分别核对。', {
    blocked,
    metrics: [
      [queue.length, '可用块'],
      [sum(refs), '引用总数'],
      [taken.length, '新分配块'],
    ],
  });
  return out;
}

export function roundAway(x) {
  return Math.sign(x) * Math.floor(Math.abs(x) + 0.5);
}
function quantTrace(o) {
  const out = [],
    x = [
      [-1.2, -0.76, -0.31, 0.08, 0.47, 0.91, 1.08, 1.4],
      [-1.2, -0.76, -0.31, 0.08, 0.47, 0.91, 1.08, 14],
      Array(8).fill(0),
    ][o.aPreset],
    absmax = Math.max(1e-10, ...x.map(Math.abs)),
    s = absmax / 127,
    scaled = scale(x, 1 / s),
    q = scaled.map(roundAway),
    restored = scale(q, s),
    errors = x.map((v, i) => Math.abs(v - restored[i]));
  const state = { x, scale: s, q, restored, errors };
  frame(out, 0, '一行激活共用一个 scale。', { ...state, bars: [bar('浮点输入', x)] });
  frame(out, 1, '绝对最大值决定格子的宽度，零行使用正下界。', {
    ...state,
    bars: [bar('绝对值', x.map(Math.abs))],
    metrics: [
      [absmax, 'absmax'],
      [s, 'scale'],
    ],
  });
  frame(out, 2, '换成 INT8 刻度，但此刻还保留小数。', { ...state, bars: [bar('x/scale', scaled)] });
  frame(out, 3, '舍入到最近整数，恰好半格时远离零。', { ...state, bars: [bar('INT8 整数 q', q)] });
  frame(out, 4, '乘回 scale，逐元素检查还原误差。', {
    ...state,
    bars: [bar('原值', x), bar('还原值', restored)],
    metrics: [
      [s, 'scale'],
      [Math.max(...errors), '最大误差'],
    ],
    table: table(
      ['元素', '原值', '整数', '还原', '绝对误差'],
      x.map((v, i) => [i, v, q[i], restored[i], errors[i]]),
    ),
  });
  return out;
}
export const loraInputs = {
  W: [
    [1, 0, 1],
    [0, 1, -1],
  ],
  A: [[1, -1, 0]],
  B: [[0.5], [-1]],
};
function loraTrace(o) {
  const out = [],
    { W, A, B } = loraInputs,
    x = [
      [1, 2, 1],
      [2, 0, -1],
      [0, 0, 0],
    ][o.aPreset],
    base = W.map((w) => dot(w, x)),
    compressed = A.map((a) => dot(a, x)),
    delta = B.map((b) => o.aScale * dot(b, compressed)),
    output = base.map((v, i) => v + delta[i]);
  const state = { W, A, B, x, base, compressed, delta, output, lora: true };
  frame(out, 0, 'W 是 2×3，A 是 1×3，B 是 2×1，输入长 3。', { ...state, show: 0 });
  frame(out, 1, '先算基础 Wx，适配器不替换这条路径。', {
    ...state,
    show: 1,
    bars: [bar('基础输出', base, ['y₀', 'y₁'])],
  });
  frame(out, 2, 'Ax 把输入压到 rank=1 的中间空间。', {
    ...state,
    show: 2,
    bars: [bar('低秩中间值', compressed, ['u₀'])],
  });
  frame(out, 3, `B(Ax) 升维并乘增量比例 ${o.aScale}。`, {
    ...state,
    show: 3,
    bars: [bar('适配器增量', delta, ['Δy₀', 'Δy₁'])],
  });
  frame(out, 4, '基础输出逐维加增量，s=0 时应精确回到基础输出。', {
    ...state,
    show: 4,
    bars: [bar('基础输出', base, ['y₀', 'y₁']), bar('最终输出', output, ['y₀', 'y₁'])],
  });
  return out;
}
function moeTrace(o) {
  const out = [],
    g = [
      [3, 1, 0, -1],
      [0, 0, 0, 0],
      [-1, 0, 1, 3],
    ][o.aPreset],
    p = softmax(g),
    selected = p
      .map((v, i) => i)
      .sort((a, b) => p[b] - p[a] || a - b)
      .slice(0, o.aExperts),
    mass = sum(selected.map((i) => p[i])),
    weights = p.map((v, i) => (selected.includes(i) ? v / mass : 0)),
    values = [2, 4, 6, 8];
  let output = 0;
  const state = { g, p, selected, weights, values };
  const names = g.map((_, i) => '专家 ' + i);
  frame(out, 0, '路由分数对应专家，而非词表。', {
    ...state,
    bars: [bar('Router logits', g, names)],
  });
  frame(out, 1, '对专家分数进行 Softmax。', { ...state, bars: [bar('Router 概率', p, names)] });
  frame(out, 2, `选择 ${o.aExperts} 个专家；示例同分按 ID 排序。`, {
    ...state,
    bars: [bar('选中专家', p, names, { kept: g.map((_, i) => selected.includes(i)) })],
  });
  frame(out, 3, '在选中的专家内部重新归一化。', {
    ...state,
    bars: [bar('合并权重', weights, names)],
    metrics: [[sum(weights), '选中权重和']],
  });
  for (const id of selected) {
    output += weights[id] * values[id];
    frame(out, 4, `汇入专家 ${id} 的权重乘输出。`, {
      ...state,
      output,
      bars: [bar('合并权重', weights, names, { active: id })],
      metrics: [[output, '累计输出']],
      table: table(
        ['专家', '权重', '示例输出', '加权贡献'],
        g.map((_, i) => [i, weights[i], values[i], weights[i] * values[i]]),
      ),
    });
  }
  return out;
}
export function eplbTrace(loads, redundant) {
  const out = [],
    counts = loads.map(() => 1),
    physical = loads.map((_, i) => i),
    packs = [[], []],
    packLoads = [0, 0];
  const snap = (step, event, extra = {}) =>
    frame(out, step, event, { eplb: true, loads, counts, physical, packs, packLoads, ...extra });
  snap(0, '每个逻辑专家先有一个物理副本。');
  for (let n = 0; n < redundant; n++) {
    const per = loads.map((v, i) => v / counts[i]),
      id = per.indexOf(Math.max(...per));
    physical.push(id);
    counts[id]++;
    snap(1, `把第 ${n + 1} 个额外副本分配给专家 ${id}，重新计算单副本负载。`);
  }
  if (!redundant) snap(1, '额外副本数为 0，保持每专家一份。');
  const items = physical.map((id, slot) => ({ id, slot, weight: loads[id] / counts[id] }));
  const slots = Math.ceil(items.length / 2);
  if (items.length % 2) items.push({ id: null, slot: items.length, weight: 0 });
  snap(2, '把副本按理想均摊负载排序；奇数个副本时补一个零负载空槽。', { items, slots });
  for (const item of [...items].sort((a, b) => b.weight - a.weight || a.slot - b.slot)) {
    const available = [0, 1].filter((rank) => packs[rank].length < slots),
      rank = available.sort((a, b) => packLoads[a] - packLoads[b] || a - b)[0];
    packs[rank].push(item);
    packLoads[rank] += item.weight;
    snap(3, `${item.id === null ? '空槽' : '专家 ' + item.id + ' 的副本'} 放入设备 ${rank}。`, {
      slots,
    });
  }
  snap(4, '各设备占相同槽数；比较代理负载，而不是推断实测速度。', {
    slots,
    metrics: [
      [Math.max(...packLoads), '最大设备负载'],
      [sum(packLoads), '总负载'],
      [physical.length, '有效物理副本'],
    ],
  });
  return out;
}
function poolingTrace(o) {
  const out = [],
    all = [
      [
        [1, 0],
        [0, 2],
        [1, 1],
        [2, 1],
      ],
      Array.from({ length: 4 }, () => [0, 0]),
      [
        [1, -1],
        [-1, 1],
        [2, -2],
        [-2, 2],
      ],
    ][o.aPreset],
    inputs = all.slice(0, o.aTokens),
    total = [0, 0],
    mode = ['Mean', 'Last', 'CLS'][o.aPoolMode];
  const source = o.aPoolMode === 1 ? S.last : o.aPoolMode === 2 ? S.cls : S.mean;
  const state = { inputs, mode, pooling: true };
  frame(out, 0, '只读取有效 token 行。', { ...state, source });
  if (o.aPoolMode === 0)
    for (let i = 0; i < inputs.length; i++) {
      for (let d = 0; d < 2; d++) total[d] += inputs[i][d];
      frame(out, 1, `累计第 ${i} 个有效 token。`, { ...state, total, active: i, source });
    }
  else {
    total.splice(0, 2, ...inputs[o.aPoolMode === 1 ? inputs.length - 1 : 0]);
    frame(out, 1, `直接选取 ${mode === 'Last' ? '最后' : '第一个'} 有效位置。`, {
      ...state,
      total,
      active: o.aPoolMode === 1 ? inputs.length - 1 : 0,
      source,
    });
  }
  const pooled = o.aPoolMode === 0 ? scale(total, 1 / inputs.length) : [...total],
    length = norm(pooled),
    output = o.aNormalize ? scale(pooled, 1 / Math.max(length, 1e-12)) : [...pooled];
  frame(out, 2, '先得到序列向量，归一化还没有发生。', {
    ...state,
    pooled,
    bars: [bar('Pooling 结果', pooled, ['维度 0', '维度 1'])],
    source,
  });
  frame(
    out,
    3,
    o.aNormalize ? '除以带下界保护的 L2 长度。' : '归一化关闭，直接保留 pooling 结果。',
    {
      ...state,
      pooled,
      output,
      length,
      bars: [bar('输出向量', output, ['维度 0', '维度 1'])],
      metrics: [[length, '原 L2 长度']],
    },
  );
  frame(out, 4, '有效 token 矩阵聚合为一个向量；零向量仍为零。', {
    ...state,
    pooled,
    output,
    length,
    bars: [bar('最终向量', output, ['维度 0', '维度 1'])],
    metrics: [
      [inputs.length + '×2 → 2', '形状'],
      [norm(output), '输出 L2 长度'],
    ],
  });
  return out;
}

export function algorithmTrace(lesson, input = {}) {
  const o = { ...algorithmDefaults, blockSize: 4, seed: 42, ...input },
    slug = lesson.slug || lesson.id.replace('alg-', '');
  if (['softmax', 'topk', 'topp', 'minp'].includes(slug)) return samplingTrace(slug, o);
  if (['rejection', 'residual'].includes(slug)) return rejectionTrace(slug, o);
  const generators = {
    penalties: penaltiesTrace,
    exponential: exponentialTrace,
    'greedy-verify': greedyTrace,
    ngram: (o) => ngramTrace(ngramExamples[o.aPreset], o.aNgram, o.aDraft),
    beam: beamTrace,
    dynamic: dynamicSpecTrace,
    attention: attentionTrace,
    'online-softmax': (o) =>
      onlineSoftmaxTrace(
        [
          [0, 1, 3, 2],
          [1, 1, 1, 1],
          [1000, 1001, 1003, 1002],
        ][o.aPreset],
        [1, 2, 4, -1],
        o.aChunk,
      ),
    rope: ropeTrace,
    rmsnorm: rmsTrace,
    'paged-address': addressTrace,
    'prefix-hash': hashTrace,
    'cache-queue': cacheQueueTrace,
    int8: quantTrace,
    lora: loraTrace,
    'moe-topk': moeTrace,
    eplb: (o) => eplbTrace([o.aSkew * 4, 4, 2, 2], o.aReplica),
    pooling: poolingTrace,
  };
  if (!Object.hasOwn(generators, slug)) throw Error('算法尚未注册');
  return generators[slug](o);
}
