import { foundationDefaults } from '../foundation-parameters.mjs';
import { softmax } from './algorithms.mjs';
import { seededRandom } from './speculative.mjs';
const sum = (a) => a.reduce((s, v) => s + v, 0);
const dot = (a, b) => sum(a.map((v, i) => v * b[i]));
const names = (n) => Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
const push = (out, stepIndex, event, state = {}) =>
  out.push(structuredClone({ stepIndex, events: [event], ...state }));
const bar = (name, values, labels = names(values.length), extra = {}) => ({
  name,
  values,
  labels,
  ...extra,
});
const table = (head, rows) => ({ head, rows });
const row = (label, values, status = []) => ({ label, values, status });

export function categorical(p, u) {
  if (
    !Number.isFinite(u) ||
    u < 0 ||
    u >= 1 ||
    p.some((v) => !Number.isFinite(v) || v < 0) ||
    Math.abs(sum(p) - 1) > 1e-9
  )
    throw Error('分类采样需要合法概率与 [0,1) 内的随机数');
  let c = 0;
  for (let i = 0; i < p.length; i++) {
    c += p[i];
    if (u < c) return i;
  }
  return p.findLastIndex((v) => v > 0);
}
export function normalSample(random) {
  const u = Math.max(Number.EPSILON, random()),
    v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export const normalDensity = (x, mu = 0, sigma = 1) =>
  Math.exp(-0.5 * ((x - mu) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI));
export function integrateDensity(lo, hi, mu, sigma) {
  const n = 400,
    h = (hi - lo) / n;
  let value = normalDensity(lo, mu, sigma) + normalDensity(hi, mu, sigma);
  for (let i = 1; i < n; i++) value += (i % 2 ? 4 : 2) * normalDensity(lo + i * h, mu, sigma);
  return (value * h) / 3;
}
export function conditionalDistribution(joint, given) {
  const marginal = sum(joint.map((r) => r[given]));
  return { marginal, conditional: marginal > 0 ? joint.map((r) => r[given] / marginal) : null };
}
export function bayes(prior, likelihood, falseLikelihood) {
  const masses = [prior * likelihood, (1 - prior) * falseLikelihood],
    evidence = sum(masses);
  return { masses, evidence, posterior: evidence ? masses.map((v) => v / evidence) : null };
}
export function information(p, q) {
  const entropy = -sum(p.map((v) => (v > 0 ? v * Math.log(v) : 0)));
  const crossEntropy = -sum(p.map((v, i) => (v > 0 ? v * Math.log(q[i]) : 0)));
  return { entropy, crossEntropy, kl: Math.max(0, crossEntropy - entropy) };
}
function notation(o) {
  const out = [],
    values = [1, 2, 3, 4].slice(0, o.bSize);
  let total = 0,
    product = 1;
  push(out, 0, '下标从 0 开始，先确定要取哪几项。', {
    board: [row('数组 x', values)],
    table: table(
      ['下标 i', 'xᵢ'],
      values.map((v, i) => [i, v]),
    ),
  });
  values.forEach((v, i) => {
    total += v;
    push(out, 1, `把 x${i}=${v} 加入累计器。`, {
      board: [
        row(
          '数组 x',
          values,
          values.map((_, j) => (j === i ? 'active' : '')),
        ),
      ],
      metrics: [
        [total, '当前求和'],
        [i + 1, '已读取项数'],
      ],
    });
  });
  for (const v of values) product *= v;
  push(out, 2, '连乘与最大位置是不同的运算。', {
    metrics: [
      [product, '连乘'],
      [Math.max(...values), 'max 值'],
      [values.indexOf(Math.max(...values)), 'argmax 索引'],
    ],
  });
  const p = values.map((v) => v / total);
  push(out, 3, '正权重除以同一总和。', { bars: [bar('归一化后', p)], total, p });
  push(out, 4, '区分“取第几项”“取数值”和“按权重归一化”。', {
    values,
    total,
    product,
    p,
    bars: [bar('权重', values), bar('概率', p)],
    metrics: [[sum(p), '概率和']],
  });
  return out;
}
function shapes(o) {
  const out = [],
    B = 2,
    S = o.bSize,
    D = 2,
    tensors = Array.from({ length: B }, (_, b) =>
      Array.from({ length: S }, (_, s) => [b * 10 + s * 2 + 1, b * 10 + s * 2 + 2]),
    );
  for (let phase = 0; phase < 5; phase++)
    push(
      out,
      phase,
      [
        '一个数没有额外的坐标轴。',
        '一个位置的两个特征组成向量。',
        '一条序列按位置排成矩阵。',
        '两条序列组成 batch。',
        '元素数量是轴长度的乘积。',
      ][phase],
      {
        shapes: true,
        phase,
        tensors,
        B,
        S,
        D,
        metrics: [
          [
            phase === 0 ? '[]' : phase === 1 ? '[2]' : phase === 2 ? `[${S},2]` : `[2,${S},2]`,
            'shape',
          ],
          [phase === 0 ? 1 : phase === 1 ? D : phase === 2 ? S * D : B * S * D, '可见元素数'],
        ],
      },
    );
  return out;
}
function linear(o) {
  const out = [],
    theta = (o.bAngle * Math.PI) / 180,
    q = [1, 0],
    k = [Math.cos(theta), Math.sin(theta)],
    products = q.map((v, i) => v * k[i]),
    score = sum(products),
    W = [
      [1, 2],
      [-1, 1],
    ],
    output = W.map((w) => dot(w, k));
  const state = { plane: { q, k }, q, k, W, output, score };
  push(out, 0, '两条向量从同一原点出发。', state);
  push(out, 1, '每个坐标先对应相乘。', {
    ...state,
    table: table(
      ['坐标', 'q', 'k', '乘积'],
      q.map((v, i) => [i, v, k[i], products[i]]),
    ),
  });
  push(out, 2, '相乘结果相加，得到点积。', {
    ...state,
    metrics: [
      [score, '点积'],
      [o.bAngle, '夹角（度）'],
    ],
  });
  push(out, 3, '矩阵每一行分别与 k 做点积。', {
    ...state,
    table: table(
      ['W 的行', '输入 k', '行点积'],
      W.map((w, i) => [w, k, output[i]]),
    ),
  });
  push(out, 4, '2×2 矩阵乘 2 维向量，输出仍为 2 维。', {
    ...state,
    bars: [bar('输入向量 k', k, ['k₀', 'k₁']), bar('Wk', output, ['y₀', 'y₁'])],
  });
  return out;
}
function expLog(o) {
  const out = [],
    z = [o.bLogit, 0],
    m = Math.max(...z),
    shifted = z.map((v) => v - m),
    weights = shifted.map(Math.exp),
    p = softmax(z);
  push(out, 0, 'logits 不需要非负，也不需要总和为 1。', { bars: [bar('原分数', z)] });
  push(out, 1, '统一减去最大值，避免大指数溢出。', {
    bars: [bar('减最大值', shifted)],
    metrics: [[m, '共同基准']],
  });
  push(out, 2, '指数把分数映射成正权重。', {
    bars: [bar('指数权重', weights)],
    metrics: [[sum(weights), '权重和']],
  });
  push(out, 3, '除以总和，才得到概率。', {
    p,
    bars: [bar('概率', p)],
    metrics: [[sum(p), '概率和']],
  });
  push(out, 4, '同一条路径的概率相乘，对数概率相加。', {
    p,
    product: 0.5 * 0.2,
    logProduct: Math.log(0.5) + Math.log(0.2),
    table: table(
      ['计算', '结果'],
      [
        ['0.5 × 0.2', 0.1],
        ['ln(0.5) + ln(0.2)', Math.log(0.1)],
        ['exp(log 联合概率)', 0.1],
      ],
    ),
  });
  return out;
}
function probability(o) {
  const out = [],
    p = [o.bProb, (1 - o.bProb) * 0.6, (1 - o.bProb) * 0.4],
    event = p[0] + p[1];
  push(out, 0, '可能结果只有 A、B、C。', { board: [row('样本空间 Ω', ['A', 'B', 'C'])] });
  push(out, 1, '拖动 A 的概率，其余质量按 6:4 分配。', { p, bars: [bar('概率质量', p)] });
  push(out, 2, 'A 与 B 互斥，可以直接相加。', {
    p,
    event,
    bars: [bar('事件 A 或 B', p, names(3), { kept: [true, true, false] })],
    metrics: [[event, 'P(A 或 B)']],
  });
  push(out, 3, '补事件 C 占其余质量。', {
    p,
    event,
    bars: [bar('事件 / 补事件', [event, p[2]], ['A 或 B', 'C'])],
  });
  push(out, 4, '一张概率表描述规则，单次实验只给一个结果。', {
    p,
    event,
    bars: [bar('完整分布', p)],
    metrics: [
      [sum(p), '总质量'],
      [event, 'P(不是 C)'],
    ],
  });
  return out;
}
function conditional(o) {
  const out = [],
    joint = [
      [
        [0.4, 0.1],
        [0.1, 0.4],
      ],
      [
        [0.15, 0.35],
        [0.15, 0.35],
      ],
      [
        [0.5, 0],
        [0.5, 0],
      ],
    ][o.bCase],
    given = o.bGiven,
    { marginal, conditional: p } = conditionalDistribution(joint, given),
    prior = joint.map(sum);
  const state = { joint, given, marginal, conditional: p, prior, jointGrid: true };
  push(out, 0, '四格加起来等于 1，行是 A，列是 B。', state);
  push(out, 1, `已知 B=${given}，只选中这一列。`, { ...state, highlight: true });
  push(out, 2, '列求和就是该条件发生的概率。', {
    ...state,
    highlight: true,
    metrics: [[marginal, 'P(B)']],
  });
  push(out, 3, p ? '除以选中列的总质量。' : '条件事件 B 的概率为 0，不能进行条件归一化。', {
    ...state,
    highlight: true,
    bars: p ? [bar('条件分布 P(A|B)', p, ['A=0', 'A=1'])] : [],
    warning: p ? '' : 'P(B)=0：条件分布在此公式下未定义。',
  });
  push(out, 4, p ? '对比边缘与条件分布，观察是否改变。' : '零概率条件不伪造均匀分布。', {
    ...state,
    bars: p ? [bar('原 P(A)', prior, ['A=0', 'A=1']), bar('P(A|B)', p, ['A=0', 'A=1'])] : [],
    warning: p ? '' : '未定义，不等于全零概率分布。',
  });
  return out;
}
function bayesTrace(o) {
  const out = [],
    result = bayes(o.bPrior, o.bLikelihood, o.bFalse),
    prior = [o.bPrior, 1 - o.bPrior],
    likelihood = [o.bLikelihood, o.bFalse],
    state = { ...result, prior, likelihood, boxes: true };
  push(out, 0, '先验是在观察红球前选择两个盒子的机会。', {
    ...state,
    bars: [bar('先验', prior, ['H', '非 H'])],
  });
  push(out, 1, '沿每条路径将先验乘似然。', {
    ...state,
    table: table(
      ['来源', '先验', '红球似然', '红球联合质量'],
      prior.map((v, i) => [i === 0 ? 'H' : '非H', v, likelihood[i], result.masses[i]]),
    ),
  });
  push(out, 2, '两条互斥来源合起来，得到证据总概率。', {
    ...state,
    metrics: [[result.evidence, 'P(红球)']],
  });
  push(out, 3, '用每条来源质量除以证据总量。', {
    ...state,
    bars: [bar('后验', result.posterior, ['H', '非 H'])],
  });
  push(out, 4, '后验取决于似然，也取决于原先的来源比例。', {
    ...state,
    bars: [bar('先验', prior, ['H', '非 H']), bar('后验', result.posterior, ['H', '非 H'])],
  });
  return out;
}
function moments(o) {
  const out = [],
    p = [1 - o.bProb, o.bProb],
    mean = o.bProb,
    weighted = [0, o.bProb],
    squared = [mean ** 2, (1 - mean) ** 2],
    variance = dot(p, squared),
    state = { p, mean, variance, std: Math.sqrt(variance) };
  push(out, 0, '只可能出现 0 或 1。', { ...state, bars: [bar('伯努利概率', p, ['X=0', 'X=1'])] });
  push(out, 1, '数值乘概率后再相加。', {
    ...state,
    bars: [bar('均值的各项贡献', weighted, ['0×P(0)', '1×P(1)'])],
    metrics: [[mean, 'E[X]']],
  });
  push(out, 2, '每个值减去同一个均值，然后平方。', {
    ...state,
    bars: [bar('偏离平方', squared, ['X=0', 'X=1'])],
  });
  push(out, 3, '偏离平方按概率加权。', {
    ...state,
    bars: [
      bar(
        '方差各项贡献',
        p.map((v, i) => v * squared[i]),
        ['X=0', 'X=1'],
      ),
    ],
  });
  push(out, 4, '均值、方差和标准差是不同的量。', {
    ...state,
    metrics: [
      [mean, '期望'],
      [variance, '方差'],
      [Math.sqrt(variance), '标准差'],
    ],
  });
  return out;
}
export const cdfExamples = [
  [0.2, 0.5, 0.3],
  [0, 0.7, 0.3],
  [1 / 3, 1 / 3, 1 / 3],
];
function cdf(o) {
  const out = [],
    p = cdfExamples[o.bCase],
    boundaries = [];
  let total = 0;
  p.forEach((v) => {
    total += v;
    boundaries.push(total);
  });
  const winner = categorical(p, o.bU),
    state = { p, boundaries, u: o.bU, winner, cdf: true };
  for (let i = 0; i < 5; i++)
    push(
      out,
      i,
      [
        '每个类别的概率决定区间长度。',
        '累计边界从 0 走到 1。',
        '把 U 放到刻度尺上。',
        `U=${o.bU} 落在 ${names(3)[winner]} 的区间内。`,
        '这是一次分类样本，下次可使用另一个 U。',
      ][i],
      {
        ...state,
        showPointer: i >= 2,
        showWinner: i >= 3,
        table: table(
          ['类别', '概率', '区间左端', '区间右端（不含）'],
          p.map((v, j) => [names(3)[j], v, j ? boundaries[j - 1] : 0, boundaries[j]]),
        ),
      },
    );
  return out;
}
function monteCarlo(o) {
  const out = [],
    random = seededRandom(o.seed),
    history = [],
    samples = [];
  let count = 0;
  const snap = (phase, event) =>
    push(out, phase, event, {
      history,
      samples: [...samples.slice(-20)],
      count,
      n: samples.length,
      p: o.bProb,
      estimate: samples.length ? count / samples.length : null,
      monteCarlo: true,
      metrics: [
        [samples.length, '已抽样 n'],
        [count, '成功次数'],
        [samples.length ? count / samples.length : '尚无样本', '样本频率'],
      ],
    });
  snap(0, '先固定真实概率，再开始抽样。');
  for (let i = 1; i <= o.bDraws; i++) {
    const x = Number(random() < o.bProb);
    samples.push(x);
    count += x;
    history.push(count / i);
    if (i === 1) snap(1, `第一个样本是 ${x}。`);
    else if (i % 10 === 0) snap(2, `累计 ${i} 个样本，更新频率。`);
  }
  snap(3, '更多样本通常减小波动尺度，但本次误差不必单调下降。');
  const estimate = count / o.bDraws,
    se = Math.sqrt((o.bProb * (1 - o.bProb)) / o.bDraws);
  push(out, 4, '标准误差按独立伯努利假设计算，不是每次误差的硬上界。', {
    monteCarlo: true,
    history,
    samples: samples.slice(-20),
    count,
    n: o.bDraws,
    p: o.bProb,
    estimate,
    se,
    metrics: [
      [estimate, '样本频率'],
      [Math.abs(estimate - o.bProb), '本次绝对误差'],
      [se, '理论标准误差'],
    ],
  });
  return out;
}
function gaussian(o) {
  const out = [],
    mu = o.bMu,
    sigma = o.bSigma,
    points = Array.from({ length: 161 }, (_, i) => {
      const x = mu - 4 * sigma + (i * 8 * sigma) / 160;
      return [x, normalDensity(x, mu, sigma)];
    }),
    area = integrateDensity(mu - sigma, mu + sigma, mu, sigma),
    z = normalSample(seededRandom(o.seed)),
    x = mu + sigma * z,
    state = { mu, sigma, points, area, z, x, gaussian: true };
  for (let i = 0; i < 5; i++)
    push(
      out,
      i,
      [
        '先观察均值和标准差的不同作用。',
        '画出的高度是密度，完整曲线面积为 1。',
        '涂色区域为均值左右一个标准差。',
        '标准高斯样本先缩放、再平移。',
        '比较峰值和面积，窄分布可以更高。',
      ][i],
      {
        ...state,
        shade: i >= 2,
        metrics:
          i >= 3
            ? [
                [z, '标准噪声 Z'],
                [x, 'X=μ+σZ'],
                [area, '区间概率约'],
              ]
            : [
                [mu, 'μ'],
                [sigma, 'σ'],
                [normalDensity(mu, mu, sigma), '峰值密度'],
              ],
      },
    );
  return out;
}
function entropy(o) {
  const out = [],
    p = [o.bProb, 1 - o.bProb],
    q = [o.bEstimate, 1 - o.bEstimate],
    result = information(p, q),
    state = { p, q, ...result };
  push(out, 0, 'p 是参考分布，q 是用于预测的分布。', {
    ...state,
    bars: [bar('p', p), bar('q', q)],
  });
  push(out, 1, '越少见的事件，发生时的信息量越大。', {
    ...state,
    table: table(
      ['类别', 'p', '−ln p', '−ln q'],
      p.map((v, i) => [names(2)[i], v, v > 0 ? -Math.log(v) : Infinity, -Math.log(q[i])]),
    ),
  });
  push(out, 2, '用 p 加权两个信息量，注意 0×ln0 的极限约定。', {
    ...state,
    bars: [
      bar(
        '熵各项贡献',
        p.map((v) => (v > 0 ? -v * Math.log(v) : 0)),
      ),
      bar(
        '交叉熵各项贡献',
        p.map((v, i) => (v > 0 ? -v * Math.log(q[i]) : 0)),
      ),
    ],
  });
  push(out, 3, '交叉熵减熵，得到 KL(p‖q)。', {
    ...state,
    metrics: [
      [result.entropy, 'H(p)'],
      [result.crossEntropy, 'H(p,q)'],
      [result.kl, 'KL(p‖q)'],
    ],
  });
  push(out, 4, '低熵看的是集中程度，不能单独证明预测正确。', {
    ...state,
    bars: [bar('分布 p', p), bar('分布 q', q)],
    metrics: [[result.kl, 'KL（nat）']],
  });
  return out;
}
function tokens(o) {
  const out = [],
    vocabulary = ['我', '爱', '学习', 'EOS'],
    E = [
      [1, 0],
      [0, 1],
      [1, 1],
      [-1, 0],
    ],
    id = o.bToken,
    hidden = E[id].map((v, i) => v + [0.2, 0.1][i]),
    W = [
      [1, 0],
      [0, 1],
      [1, 1],
      [-1, -1],
    ],
    z = W.map((w) => dot(w, hidden)),
    p = softmax(z),
    state = { id, vocabulary, E, hidden, z, p };
  push(out, 0, '这个教学词表的 ID 范围是 0～3。', {
    ...state,
    board: [
      row(
        '词表',
        vocabulary,
        vocabulary.map((_, i) => (i === id ? 'active' : '')),
      ),
    ],
  });
  push(out, 1, '取出指定 token 的特征行，不将 ID 大小当语义。', {
    ...state,
    table: table(
      ['ID', 'Token', 'Embedding'],
      E.map((e, i) => [i, vocabulary[i], e]),
    ),
  });
  push(out, 2, '示例用固定偏移代表抽象的上下文处理，不运行 Transformer。', {
    ...state,
    board: [row('Embedding', E[id]), row('教学隐藏向量', hidden)],
  });
  push(out, 3, '每个输出权重行与隐藏向量点积。', {
    ...state,
    bars: [bar('词表 logits', z, vocabulary)],
    table: table(
      ['输出权重行', 'h', 'logit'],
      W.map((w, i) => [w, hidden, z[i]]),
    ),
    source: {
      path: 'vllm/model_executor/layers/logits_processor.py',
      symbol: 'LogitsProcessor.forward',
    },
  });
  push(out, 4, '最终概率在词表维度上归一化。', {
    ...state,
    bars: [bar('下一 token 分布', p, vocabulary)],
    metrics: [[sum(p), '概率和']],
  });
  return out;
}
function autoregressive(o) {
  const out = [],
    prefix = [o.bCase === 1 ? 'B' : 'A'],
    generated = [],
    conditionals = [];
  let joint = 1;
  const snap = (phase, event, extra = {}) =>
    push(out, phase, event, {
      prefix,
      generated,
      conditionals,
      joint,
      board: [row('已知前缀', prefix), row('本轮已确认', generated)],
      ...extra,
    });
  snap(0, '已知前缀先作为模型条件。');
  for (let t = 0; t < 3; t++) {
    const previous = generated.at(-1) || prefix.at(-1),
      p =
        o.bCase === 2 && t === 1
          ? [0.1, 0.1, 0.8]
          : previous === 'A'
            ? [0.1, 0.8, 0.1]
            : [0.8, 0.1, 0.1];
    snap(1, '读取当前前缀下的分布。', { bars: [bar('下一词概率', p, ['A', 'B', 'EOS'])] });
    const winner = p.indexOf(Math.max(...p)),
      token = ['A', 'B', 'EOS'][winner];
    conditionals.push(p[winner]);
    generated.push(token);
    joint *= p[winner];
    snap(2, `确认 ${token}，它进入后续条件。`);
    snap(3, '累乘沿途概率，也可累加其对数。', {
      metrics: [
        [joint, '路径联合概率'],
        [Math.log(joint), 'log 路径概率'],
      ],
    });
    if (token === 'EOS') break;
  }
  snap(
    4,
    generated.at(-1) === 'EOS'
      ? '遇到 EOS，停止扩展。'
      : '完成三位置教学轨迹，真实请求继续遵循其停止条件。',
    { logJoint: Math.log(joint), delivered: generated.filter((x) => x !== 'EOS') },
  );
  return out;
}
function attention(o) {
  const out = [],
    keys = [
      [1, 0],
      [0, 1],
      [1, 1],
      [-1, 1],
    ],
    values = [
      [1, 0],
      [0, 2],
      [1, 1],
      [-1, 2],
    ],
    q = keys[o.bToken],
    scores = keys.map((k) => dot(q, k) / Math.sqrt(2)),
    visible = keys.map((_, i) => !o.bCausal || i <= o.bToken),
    weights = softmax(scores.map((s, i) => (visible[i] ? s : -Infinity))),
    output = [0, 1].map((d) =>
      dot(
        weights,
        values.map((v) => v[d]),
      ),
    ),
    state = { q, keys, values, weights, output, visible };
  push(out, 0, `当前位置为 ${o.bToken}，Query 是 [${q}]。`, {
    ...state,
    table: table(
      ['位置', 'K', 'V'],
      keys.map((k, i) => [i, k, values[i]]),
    ),
  });
  push(out, 1, 'Q 与每个 K 点积，再除以 √d。', { ...state, bars: [bar('匹配分数', scores)] });
  push(out, 2, o.bCausal ? '因果模式屏蔽未来位置。' : '关闭因果掩码，仅作全可见教学对照。', {
    ...state,
    bars: [bar('可见分数', scores, names(4), { kept: visible })],
  });
  push(out, 3, '权重在可见的上下文位置上归一化。', {
    ...state,
    bars: [bar('Attention 权重', weights), bar('组合后的向量', output, ['维度 0', '维度 1'])],
  });
  push(out, 4, '整个 Transformer 还包括后续子层；KV 缓存存的是历史 K/V。', {
    ...state,
    board: [
      row('常见 Transformer 子层示意', ['归一化', 'Attention', '残差', '归一化', 'MLP', '残差']),
    ],
    metrics: [[sum(weights), '注意力权重和']],
  });
  return out;
}
function training(o) {
  const out = [],
    history = [];
  let theta = 0;
  const snap = (phase, event, extra = {}) =>
    push(out, phase, event, { theta, history, training: o.bTrain, ...extra });
  snap(0, '固定输入 x=1、目标 y=2，只学习一个参数 θ。');
  for (let epoch = 0; epoch < 4; epoch++) {
    const prediction = theta,
      loss = 0.5 * (prediction - 2) ** 2,
      gradient = prediction - 2;
    snap(1, `第 ${epoch + 1} 次前向：预测 ${prediction.toFixed(4)}。`, {
      prediction,
      loss,
      metrics: [
        [theta, 'θ'],
        [loss, '损失'],
      ],
    });
    snap(2, o.bTrain ? '训练模式计算梯度。' : '推理模式不执行反向；此梯度数值仅用作教学对照。', {
      gradient,
      metrics: [[gradient, '教学梯度 g']],
    });
    const old = theta;
    if (o.bTrain) theta -= o.bLearningRate * gradient;
    history.push({ epoch, old, loss, gradient, theta });
    snap(3, o.bTrain ? '沿负梯度更新 θ。' : '权重冻结，θ 保持不变。', {
      table: table(
        ['轮', '原 θ', '损失', '梯度', '新 θ'],
        history.map((h) => [h.epoch + 1, h.old, h.loss, h.gradient, h.theta]),
      ),
    });
  }
  snap(4, '再次前向，比较训练与推理对权重的影响。', {
    prediction: theta,
    loss: 0.5 * (theta - 2) ** 2,
    metrics: [
      [theta, '最终 θ'],
      [0.5 * (theta - 2) ** 2, '最终损失'],
    ],
  });
  return out;
}
function markov(o) {
  const out = [],
    T = [
      [o.bStay, 1 - o.bStay],
      [1 - o.bStay, o.bStay],
    ],
    history = [[1, 0]];
  let p = [1, 0];
  const snap = (phase, event) =>
    push(out, phase, event, {
      T,
      p,
      history,
      board: [row('本轮状态概率', p)],
      table: table(
        ['当前状态', '下一 A', '下一 B'],
        T.map((r, i) => [names(2)[i], ...r]),
      ),
      bars: [bar('状态概率', p)],
    });
  snap(0, '确定从 A 出发，分布为 [1,0]。');
  snap(1, '每行是一个给定当前状态的条件分布。');
  for (let n = 1; n <= o.bRounds; n++) {
    p = [0, 1].map((j) => sum(p.map((v, i) => v * T[i][j])));
    history.push(p);
    snap(n === 1 ? 2 : 3, `第 ${n} 轮，π 新 = π 旧 × T。`);
  }
  snap(4, '这是完整分布的传播；单个随机轨迹不会同时处在两个格子。');
  return out;
}
export function reverseGaussianStep(x, t, beta, random) {
  const alpha = 1 - beta,
    abar = alpha ** t,
    previous = alpha ** (t - 1),
    variance = 1 - abar;
  const modes = [-1, 1],
    posterior = softmax(modes.map((mode) => (-0.5 * (x - Math.sqrt(abar) * mode) ** 2) / variance));
  const chosen = modes[categorical(posterior, random())],
    posteriorVariance = (beta * (1 - previous)) / (1 - abar);
  const mean =
    ((Math.sqrt(previous) * beta) / (1 - abar)) * chosen +
    ((Math.sqrt(alpha) * (1 - previous)) / (1 - abar)) * x;
  return {
    x: mean + Math.sqrt(posteriorVariance) * normalSample(random),
    posterior,
    chosen,
    mean,
    posteriorVariance,
  };
}
function diffusionTrace(o) {
  const out = [],
    forwardRandom = seededRandom(o.seed),
    reverseRandom = seededRandom(o.seed + 7919),
    beta = o.bBeta,
    steps = o.bRounds,
    forward = [forwardRandom() < 0.5 ? -1 : 1],
    reverse = [];
  const state = () => ({ diffusion: true, forward, reverse, beta, steps });
  push(out, 0, '玩具数据分布只有 −1 / +1，各占一半；真实图像或语言分布远复杂于此。', {
    ...state(),
    board: [row('已知数据先验', ['−1：50%', '+1：50%'])],
  });
  for (let t = 1; t <= steps; t++) {
    const noise = normalSample(forwardRandom),
      x = Math.sqrt(1 - beta) * forward.at(-1) + Math.sqrt(beta) * noise;
    forward.push(x);
    push(out, 1, `前向 t=${t}：信号缩放后加上新的高斯噪声。`, {
      ...state(),
      t,
      noise,
      metrics: [
        [(1 - beta) ** t, 'ᾱₜ'],
        [Math.sqrt((1 - beta) ** t), '信号系数'],
        [Math.sqrt(1 - (1 - beta) ** t), '边缘噪声系数'],
      ],
    });
  }
  const terminalMode = reverseRandom() < 0.5 ? -1 : 1,
    abar = (1 - beta) ** steps;
  reverse.push(Math.sqrt(abar) * terminalMode + Math.sqrt(1 - abar) * normalSample(reverseRandom));
  push(out, 2, '另取随机数，从本例精确的末端边缘分布启动生成；不倒放前向日志。', {
    ...state(),
    t: steps,
    warning: '这是两点先验的解析教学模型，反向条件由公式给出，不是已训练的图像模型。',
  });
  for (let t = steps; t >= 1; t--) {
    const result = reverseGaussianStep(reverse.at(-1), t, beta, reverseRandom);
    reverse.push(result.x);
    push(out, 3, `反向 ${t}→${t - 1}：按当前状态的后验选择来源，再采样更干净状态。`, {
      ...state(),
      t: t - 1,
      ...result,
      bars: [bar('当前 xₜ 对两种干净来源的后验', result.posterior, ['−1', '+1'])],
      metrics: [
        [result.mean, '条件均值'],
        [result.posteriorVariance, '条件方差'],
      ],
    });
  }
  push(out, 4, '到达数据空间。最终生成不要求等于前向例子的原始值。', {
    ...state(),
    generated: reverse.at(-1),
    metrics: [
      [forward[0], '前向例子 x₀'],
      [reverse.at(-1), '独立生成结果'],
      [steps, '反向步数'],
    ],
  });
  return out;
}
function discrete(o) {
  const out = [],
    canvas = Array(4).fill('MASK'),
    confirmed = Array(4).fill(false),
    history = [],
    budget = o.bCase === 2 ? 1 : 4;
  const snap = (phase, event, extra = {}) =>
    push(out, phase, event, {
      canvas,
      confirmed,
      history,
      budget,
      board: [
        row(
          '当前生成画布',
          canvas,
          confirmed.map((v) => (v ? 'accepted' : 'pending')),
        ),
      ],
      ...extra,
    });
  push(out, 0, '损坏示例只用于说明 token→Mask；生成的候选使用另一套预设表。', {
    board: [
      row('损坏示例', ['天', '气', '很', '好']),
      row('损坏后的输入', ['天', 'MASK', 'MASK', '好']),
    ],
  });
  snap(1, '生成初始化为全未知；并没有读取上面那句示例的答案。');
  for (let round = 1; round <= budget && !confirmed.every(Boolean); round++) {
    const proposals = ['我', o.bCase === 1 && round === 1 ? '要' : '会', '学习', 'EOS'];
    const confidence =
      o.bCase === 1 && round === 1 ? [0.95, 0.4, 0.85, 0.75] : [0.99, 0.98, 0.95, 0.94];
    const candidates = confirmed
        .flatMap((v, i) => (v ? [] : [i]))
        .sort((a, b) => confidence[b] - confidence[a]),
      selected = candidates.slice(0, o.bReveal);
    snap(2, `第 ${round} 轮：预设候选不等于已确认输出。`, {
      round,
      proposals,
      confidence,
      board: [
        row(
          '当前画布',
          canvas,
          confirmed.map((v) => (v ? 'accepted' : 'pending')),
        ),
        row(
          '本轮候选',
          proposals,
          confirmed.map((v) => (v ? 'muted' : 'active')),
        ),
      ],
      bars: [
        bar('预设置信度', confidence, ['位置 0', '位置 1', '位置 2', '位置 3'], {
          kept: confirmed.map((v) => !v),
        }),
      ],
    });
    for (const i of selected) {
      canvas[i] = proposals[i];
      confirmed[i] = true;
    }
    history.push({ round, selected, canvas: [...canvas] });
    snap(3, `按置信度确认 ${selected.length} 个位置，其他位置保留待更新。`, { round, proposals });
  }
  const complete = confirmed.every(Boolean);
  snap(
    4,
    complete
      ? '教学画布已全部确认，可以提交这块结果。'
      : '预算耗尽但仍有未知位置，不能假装已经生成完整块。',
    {
      complete,
      delivered: complete ? [...canvas] : [],
      metrics: [
        [confirmed.filter(Boolean).length, '已确认位置'],
        [history.length, '已用轮次'],
        [complete ? '可提交' : '未完成', '块状态'],
      ],
    },
  );
  return out;
}
function generation(o) {
  const out = [],
    K = o.bDraftLength,
    draft = ['A', 'B', 'C', 'D'].slice(0, K),
    accepted = Math.min(K, 2),
    committed = K <= 2 ? [...draft, '下一词'] : ['A', 'B', '纠正词'];
  push(out, 0, '先问当前维护的是前缀、草稿，还是整块画布。', {
    board: [
      row('普通 AR', ['前缀']),
      row('MTP / 其他 proposer', ['前缀', '未验证草稿']),
      row('扩散', ['画布位置 0', '位置 1', '位置 2', '位置 3']),
    ],
  });
  for (let n = 1; n <= 3; n++)
    push(out, 1, `普通 AR 第 ${n} 轮：确认一个新位置。`, {
      board: [row('已确认前缀', ['A', 'B', 'C'].slice(0, n), Array(n).fill('accepted'))],
    });
  push(out, 2, `提出 ${K} 个草稿，尚未验证。`, {
    board: [row('草稿候选', draft, Array(K).fill('pending'))],
    K,
  });
  push(out, 2, K <= 2 ? '全部草稿匹配，再加目标下一词。' : '第三项不匹配，丢弃其后旧草稿并纠正。', {
    board: [
      row(
        '本轮可提交',
        committed,
        committed.map(() => 'accepted'),
      ),
    ],
    K,
    accepted,
    committed,
  });
  for (let n = 0; n < 3; n++)
    push(out, 3, `扩散示意第 ${n + 1} 轮：继续更新同一组位置。`, {
      board: [
        row(
          '同一块画布',
          [
            ['?', '?', '?', '?'],
            ['我', '?', '学习', '?'],
            ['我', '会', '学习', 'EOS'],
          ][n],
          Array(4).fill(n === 2 ? 'accepted' : 'pending'),
        ),
      ],
    });
  push(out, 4, '多 token 是现象；状态、条件依赖、验证与提交规则才区分方法。', {
    K,
    accepted,
    committed,
    table: table(
      ['方式', '更新对象', '提交依据'],
      [
        ['普通 AR', '已确认前缀后的位置', '选中下一 token'],
        ['MTP / 其他草稿 + 投机', '未验证候选前缀', '目标验证与纠正'],
        ['扩散', '同一组画布位置', '模型的去噪 / 稳定 / 提交规则'],
      ],
    ),
  });
  return out;
}
export function foundationTrace(lesson, input = {}) {
  const o = { ...foundationDefaults, seed: 42, ...input };
  const generators = {
    notation,
    shapes,
    linear,
    'exp-log': expLog,
    probability,
    conditional,
    bayes: bayesTrace,
    moments,
    cdf,
    'monte-carlo': monteCarlo,
    gaussian,
    information: entropy,
    tokens,
    autoregressive,
    attention,
    training,
    markov,
    diffusion: diffusionTrace,
    'discrete-diffusion': discrete,
    generation,
  };
  const slug = lesson.slug || lesson.id.replace('base-', '');
  if (!Object.hasOwn(generators, slug)) throw Error('前置基础尚未注册');
  return generators[slug](o);
}
