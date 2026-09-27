import { algorithmSources as S } from './algorithm-sources.mjs';
import { mechanismParameterNames } from './mechanism-parameters.mjs';

// Each row is a complete lesson, with its own explanation, worked example and question.
// Keep IDs stable: they are used by saved progress and shared experiment links.
const rows = [];
const add = (slug, title, family, summary, detail) =>
  rows.push({ id: 'alg-' + slug, slug, title, family, summary, ...detail });
const step = (title, body, source) => ({ title, body, source: S[source], change: body });
const logitsPresets = ['普通分数', '并列分数', '大分数偏移'];
const distributions = ['p 与 q 不同', 'p 与 q 完全相同', 'q 为单点分布'];

add(
  'softmax',
  '稳定 Softmax 与温度',
  'sampling',
  '把任意分数变成概率，并解释为什么温度为 0 要走另一条路径。',
  {
    params: ['aPreset', 'aT'],
    presets: logitsPresets,
    related: ['sampling'],
    prerequisites: [],
    why: '模型输出的 logits 可以为负，也不一定相加为 1。采样器需要非负且总和为 1 的概率；直接对很大的 logits 求指数又容易溢出。',
    intuition:
      '先给所有选手减去同一个基准分，再比较指数权重。统一减分不改变相对差距，却能避免数字大到装不下。',
    symbols: [
      ['zᵢ', '第 i 个 token 的原始分数'],
      ['T', '正温度，控制分数差距'],
      ['m', '温度缩放后最大的分数'],
      ['pᵢ', '归一化后的抽样概率'],
    ],
    formula:
      'T > 0: sᵢ = zᵢ / T; m = max(s); pᵢ = exp(sᵢ−m) / Σⱼ exp(sⱼ−m)\nT = 0: 选择 argmax(z)，不计算 z / 0',
    worked:
      '分数 [2,1,0,−1,−2]、T=1 时，减去最大值后为 [0,−1,−2,−3,−4]，概率约为 [0.6364,0.2341,0.0861,0.0317,0.0117]。把全部分数加 1000，结果应保持不变。',
    pitfall: '温度降低不保证某次随机抽样必然选择第一名。只有显式贪心路径才总是取最大分数。',
    boundary:
      '这里使用 JavaScript 双精度；真实实现会按设备、dtype 和采样路径选择 kernel。并列最大值的具体选中项受实现的 tie-break 影响。',
    cost: '词表大小为 V 时，若已知 logits，最大值、指数和归一化各为 O(V)。',
    steps: [
      step('读取 logits', '分数不是概率。先观察各 token 的相对高低。', 'temperature'),
      step('温度缩放', 'T 越小，分数差距越大。T=0 使用贪心分支，避免除零。', 'temperature'),
      step('减去最大值', '最大指数变成 exp(0)=1；所有指数都不会大于 1。', 'softmax'),
      step('求和并归一化', '每个指数权重除以相同的总和，得到概率。', 'softmax'),
      step('检查分布', '检查总和为 1，并对照统一平移前后的结果。', 'softmax'),
    ],
    quiz: [
      '全部 logits 加上 1000，稳定 Softmax 的概率如何变化？',
      '不变，只要数值计算没有引入额外误差',
      '第一名的概率必然变为 1',
      '共同偏移在分子分母中抵消；减最大值正是利用这个性质。',
    ],
  },
);
add('topk', 'Top-k 阈值筛选', 'sampling', '只让分数足够高的候选继续参与抽样，注意并列阈值。', {
  params: ['aPreset', 'aK'],
  presets: logitsPresets,
  related: ['sampling'],
  prerequisites: ['alg-softmax'],
  why: '低分候选过多时，可以先缩小抽样范围。Top-k 根据排名设门槛，最后仍需要在保留集合中抽样。',
  intuition:
    '录取线由第 k 名的分数决定。源码使用“小于录取线”排除，所以和第 k 名同分的候选可能一同留下。',
  symbols: [
    ['k', '名义保留数量'],
    ['τ', '第 k 大的 logit'],
    ['−∞', '被屏蔽的分数；Softmax 权重为 0'],
  ],
  formula: 'τ = kth_largest(z)\nz′ᵢ = zᵢ if zᵢ ≥ τ else −∞\np′ = softmax(z′)',
  worked:
    '[2,1,0,−1,−2] 中 k=2，阈值为 1，保留 A/B，重新归一化为 [0.7311,0.2689,0,0,0]。并列例 [2,1,1,0,−1] 会保留 3 个。',
  pitfall:
    '“Top-k 总是恰好剩下 k 个”不符合这里核对的阈值实现；并列项可能超过 k。它也不是直接返回第 k 名。',
  boundary: '实验对照 PyTorch 阈值路径。不同设备采样后端可能采用不同选择和并列处理方式。',
  cost: '完整排序示例 O(V log V)；源码可用 topk 选择，不能把示例排序成本当成所有 kernel 的成本。',
  steps: [
    step('读取分数', '保持原 token 身份，避免排序后把 ID 搞错。', 'topk'),
    step('寻找第 k 大', '按分数排序，只用第 k 名确定门槛。', 'topk'),
    step('屏蔽低于门槛者', '严格小于阈值的项变为 −∞，并列项保留。', 'topk'),
    step('重新归一化', '被屏蔽项概率为零，其他项的相对比例不变。', 'softmax'),
    step('检查并列边界', '保留集合确定后才进入抽样。', 'topk'),
  ],
  quiz: [
    '分数 [2,1,1,0]，此阈值实现 k=2 保留几个？',
    '3 个',
    '2 个',
    '阈值为 1；源码屏蔽小于 1 的项，不屏蔽同分的两个 1。',
  ],
});
add(
  'topp',
  'Top-p 累积概率截断',
  'sampling',
  '按概率质量而非固定个数保留候选，观察跨过阈值的那一项。',
  {
    params: ['aPreset', 'aP'],
    presets: logitsPresets,
    related: ['sampling'],
    prerequisites: ['alg-softmax', 'alg-topk'],
    why: '尖锐分布只需少量候选，平坦分布则需更多候选。固定 k 无法直接表达“覆盖多少概率质量”。',
    intuition: '从概率大的候选开始装篮子，直到装够指定比例。让篮子第一次达到门槛的候选也要留下。',
    symbols: [
      ['p₀', '用户设置的 Top-p 阈值'],
      ['Pᵢ', '截断前概率'],
      ['Cᵢ', '排序后的累计概率'],
    ],
    formula:
      '源码路径：按概率升序排列\n屏蔽 Cᵢ ≤ 1−p₀ 的项；强制保留最后一项\n对留下的概率重新归一化',
    worked:
      '默认概率前两项为 0.6364、0.2341，Top-p=0.8 时只留第一项不够；留下 A/B 后覆盖 0.8705，再归一化为 0.7311、0.2689。',
    pitfall: '0.8 是截断前累计质量目标，不是保留 80% 的词，也不是让最后概率之和停在 0.8。',
    boundary:
      '实验使用本地 PyTorch 路径的升序累计和 ≤ 判断；相等、并列分数和浮点舍入都可能影响边界项。',
    cost: '排序示例 O(V log V)，累计与归一化 O(V)。',
    steps: [
      step('得到原概率', '用稳定 Softmax 得到总和为 1 的分布。', 'softmax'),
      step('升序累计', '这里按源码从小到大累计，移除低概率尾部。', 'topp'),
      step('应用质量门槛', '移除累计质量不超过 1−p₀ 的项，至少保留一项。', 'topp'),
      step('重新分配概率', '被移除质量由保留集合按原比例重新分配。', 'softmax'),
      step('对比保留数量', '改变阈值，同一分布的保留个数会改变。', 'topp'),
    ],
    quiz: [
      'Top-p=0.8，最大两项概率 0.6、0.3，第二项是否保留？',
      '保留，它使累计质量首次达到门槛',
      '丢弃，因为加上它超过 0.8',
      'Top-p 不是要求每次加入后仍不超过阈值；跨过门槛的项需要保留。',
    ],
  },
);
add('minp', 'Min-p 相对概率门槛', 'sampling', '用最高概率作为基准，移除相对它太小的候选。', {
  params: ['aPreset', 'aMin'],
  presets: logitsPresets,
  related: ['sampling', 'logits'],
  prerequisites: ['alg-softmax', 'alg-topp'],
  why: '有些时候希望每个候选都有足够的相对可信度，而不是凑齐一个累计概率目标。',
  intuition: '第一名的概率是标尺，候选至少达到标尺的一定比例才能留下。',
  symbols: [
    ['μ', 'min_p 相对比例'],
    ['Pmax', '当前分布的最大概率'],
    ['τ', '实际门槛 μ×Pmax'],
  ],
  formula: 'τ = μ × max(P)\n保留 Pᵢ ≥ τ 的项，再归一化',
  worked:
    '最高概率为 0.6364、μ=0.2，则门槛约 0.1273。A/B 留下，概率约 0.0861 的 C 被移除。门槛不是固定的 0.2。',
  pitfall:
    'Min-p 不等于 Top-p，也不表示“每个 token 的绝对概率至少是 μ”。当 μ=1 时，并列最高概率项都能留下。',
  boundary:
    '本章隔离 Min-p 的输入分布；真实采样流水线中还存在温度、惩罚和其他 processor，顺序以 Sampler 为准。',
  cost: 'Softmax、最大值和阈值判断均为 O(V)，不要求排序。',
  steps: [
    step('读取当前分布', '这里固定观察进入 Min-p 规则的分数。', 'minp'),
    step('寻找最高概率', '取 Pmax 作为相对尺度。', 'minp'),
    step('计算并应用门槛', '低于 μ×Pmax 的项被屏蔽，等于门槛的项保留。', 'minp'),
    step('重新归一化', '被筛除项不再参与后续抽样。', 'softmax'),
    step('比较 Top-p', 'Min-p 逐项比较，不计算累计概率。', 'minp'),
  ],
  quiz: [
    'Pmax=0.5，min_p=0.1，实际门槛是多少？',
    '0.05',
    '0.1',
    '相对门槛等于 0.5×0.1，而不是直接使用 0.1。',
  ],
});
add(
  'penalties',
  '重复、频率与存在惩罚',
  'sampling',
  '区分三种惩罚的公式，以及 prompt 与已生成历史的不同作用。',
  {
    params: ['aPreset', 'aRepeat', 'aFrequency', 'aPresence'],
    presets: ['重复输出 A', '只有 prompt 出现 A', '没有历史'],
    related: ['logits'],
    prerequisites: ['alg-softmax'],
    why: '持续重复某些词可能降低生成质量。采样前先改变 logits，让历史参与候选评分。',
    intuition:
      '重复惩罚改变出现过的词的分数比例；频率惩罚按出现次数扣分；存在惩罚只看是否出现，不看次数。',
    symbols: [
      ['r', 'repetition_penalty'],
      ['f、h', 'frequency / presence 系数'],
      ['cᵢ', '已生成输出中 token i 的次数'],
    ],
    formula: '出现于 prompt 或输出：z′ᵢ = zᵢ/r（zᵢ>0），否则 zᵢ×r\nz″ᵢ = z′ᵢ − f×cᵢ − h×1[cᵢ>0]',
    worked:
      'A 分数 2，在输出中出现 2 次，r=1.5、f=h=0.5：2 → 1.3333 → 0.3333 → −0.1667。B 为负分时乘以 r 会变得更负，不能也除以 r。',
    pitfall:
      '频率和存在惩罚使用输出历史；重复惩罚检查 prompt 与输出。把三个系数都按出现次数相乘是错误的。',
    boundary:
      '只显示基础三种惩罚，不包含模型专用 processor、白名单、水印和 tokenization。实验系数限制在非负惩罚范围。',
    cost: '形成计数与掩码需要读取历史，应用规则为 O(V)。',
    steps: [
      step('统计历史', '记录 prompt 是否出现，以及输出中的次数。', 'penalties'),
      step('按正负号重复惩罚', '正数除以 r，负数乘以 r，零保持零。', 'penalties'),
      step('按输出次数扣分', '频率系数乘输出计数，prompt 不计入这一项。', 'penalties'),
      step('按输出是否出现扣分', '每个出现过的 token 只扣一次存在惩罚。', 'penalties'),
      step('观察最终概率', '改变的是 logits，概率需要重新经过 Softmax。', 'softmax'),
    ],
    quiz: [
      '某词只在 prompt 中出现，会受到哪种基础惩罚？',
      '重复惩罚；频率和存在惩罚不因此生效',
      '三种都会因为 prompt 出现而生效',
      '本地实现分别使用 prompt/output 掩码与输出计数，三种作用范围不同。',
    ],
  },
);
add(
  'exponential',
  '指数竞赛随机采样',
  'sampling',
  '解释源码为什么用 probability / exponential_noise 再取 argmax。',
  {
    params: ['aPreset', 'seed'],
    presets: logitsPresets,
    related: ['sampling'],
    prerequisites: ['alg-softmax'],
    why: '需要按概率抽一个 token，同时避免某些多项式抽样路径带来的设备同步。',
    intuition:
      '每个候选参加随机计时赛。概率高的候选平均跑得更快，但单次比赛仍可能输给概率小的候选。',
    symbols: [
      ['Pᵢ', '目标抽样概率'],
      ['Uᵢ', '独立的 (0,1) 均匀数'],
      ['Eᵢ', '−ln(Uᵢ)，服从单位指数分布'],
    ],
    formula: 'Eᵢ = −ln(Uᵢ)\n选择 argmax(Pᵢ / Eᵢ)，等价于 argmin(Eᵢ / Pᵢ)',
    worked:
      '若 P=[0.6,0.3,0.1]，一次噪声 E=[1,0.2,1]，比值为 [0.6,1.5,0.1]，因此 B 获胜；这不违反 A 的总体概率更高。重复足够多次的频率才接近 P。',
    pitfall:
      'argmax 的输入已经包含随机噪声，所以它不是贪心抽样。这里的噪声 E 也不是投机推理里的草稿分布 q。',
    boundary:
      '教学种子只保证本工具复现，不与 PyTorch/CUDA 的随机数序列逐位相同。零概率候选不能获胜。',
    cost: '每个候选一个随机数和一个比值，再归约，O(V)。',
    steps: [
      step('准备概率', '先将分数转为归一化概率。', 'exponential'),
      step('生成独立噪声', '每个 token 有自己的指数噪声。', 'exponential'),
      step('计算竞赛分数', '概率除以噪声，不能只比较原概率。', 'race'),
      step('找出赢家', '选择比值最大的 token ID。', 'race'),
      step('改变种子重试', '一次结果不是总体分布，固定种子用于复现。', 'race'),
    ],
    quiz: [
      '源码用了 argmax，为什么仍是随机采样？',
      'argmax 比较的是加入独立随机噪声后的分数',
      'argmax 本身会随机选一个元素',
      '随机性来自指数噪声；最终 argmax 是确定性的。',
    ],
  },
);
add(
  'rejection',
  '投机推理：接受 / 拒绝检验',
  'speculation',
  '从一个候选的 p/q 比值出发，弄清接受概率与首拒绝截断。',
  {
    params: ['aPreset', 'aCandidate', 'aU'],
    presets: distributions,
    related: ['speculative'],
    prerequisites: ['alg-softmax', 'alg-exponential'],
    why: '草稿模型便宜，但它提出 token 的概率 q 通常不同于目标概率 p。直接全收会改变目标分布。',
    intuition:
      '草稿给某个词的机会过多时，只接受其中一部分；给得不够时可以全收，缺失的概率质量留给恢复阶段补齐。',
    symbols: [
      ['q(x)', '草稿在同一前缀下提出 x 的概率'],
      ['p(x)', '目标在同一前缀下给 x 的概率'],
      ['u', '用于接受检验的均匀随机数'],
      ['α(x)', '条件接受概率'],
    ],
    formula:
      'x ∼ q; α(x) = min(1, p(x)/q(x))\n源码判断 q(x)>0 且 p(x)/q(x) ≥ u\n首次拒绝之后的草稿不再提交',
    worked:
      'p=[0.1,0.6,0.3]，q=[0.5,0.3,0.2]。草稿提出 A 时，α=0.1/0.5=0.2。u=0.25 拒绝，u=0.15 接受；若提出 B，比值 2，必接受。',
    pitfall:
      '不能直接以 p(x) 当接受概率，也不能比较两模型的 argmax。随机采样与贪心验证是两套判断。',
    boundary:
      '本章隔离单位置检验，默认是已知完整 q 的精确分支；q(x)=0 不可能被合法草稿采样提出，源码仍会防御性拒绝。多位置提交可到“投机解码”观察。',
    cost: '给定两个分布和候选 ID，单次检验 O(1)；目标模型计算概率的成本不包含在内。',
    steps: [
      step(
        '对齐同一个前缀',
        'p 与 q 必须描述同一个条件上下文。手动候选用于固定观察一项。',
        'rejection',
      ),
      step('读取候选概率', '只读取候选 x 对应的 p(x)、q(x)，不是比较整个向量大小。', 'rejection'),
      step('形成接受阈值', 'p/q 大于 1 时等效阈值为 1；q=0 时拒绝。', 'rejection'),
      step('比较随机数', '按照本地源码的 ≥ 边界决定接受或拒绝。', 'rejection'),
      step(
        '决定后续路径',
        '接受才可继续验证后续候选；拒绝时切换到残差恢复，并丢弃后缀。',
        'rejection',
      ),
    ],
    quiz: [
      'p(A)=0.1、q(A)=0.5，接受 A 的概率是多少？',
      '0.2',
      '0.1',
      '必须用目标概率除以草稿概率，抵消草稿过度提出 A 的倾向。',
    ],
  },
);
add(
  'residual',
  '拒绝后的残差恢复分布',
  'speculation',
  '逐项推导 max(p−q,0)，验证“接受质量 + 恢复质量 = p”。',
  {
    params: ['aPreset', 'seed'],
    presets: distributions,
    related: ['speculative'],
    prerequisites: ['alg-rejection'],
    why: '拒绝后若再次直接从 p 抽样，已经通过接受阶段获得概率质量的 token 会被重复补偿，最终分布一般不再等于 p。',
    intuition:
      '先数清接受阶段已经交付了多少概率，只补目标还欠的部分。负的欠账按零处理，再把剩余欠账归一化。',
    symbols: [
      ['hᵢ=min(pᵢ,qᵢ)', '通过草稿且接受的无条件概率质量'],
      ['dᵢ=max(pᵢ−qᵢ,0)', '还欠的质量'],
      ['R=Σdᵢ', '整体拒绝概率'],
      ['rᵢ=dᵢ/R', '发生拒绝后使用的条件恢复分布'],
    ],
    formula: 'qᵢ × min(1,pᵢ/qᵢ) = min(pᵢ,qᵢ) = hᵢ\nrᵢ = max(pᵢ−qᵢ,0) / R\nhᵢ + R×rᵢ = pᵢ',
    worked:
      'p=[0.1,0.6,0.3]、q=[0.5,0.3,0.2]：h=[0.1,0.3,0.2]，总接受质量 0.6；d=[0,0.3,0.1]、R=0.4、r=[0,0.75,0.25]。逐项相加 h+0.4r，恰好恢复 p。',
    pitfall:
      'r 是“已发生拒绝”这个条件下的分布，不能把 r 本身和 p 比较就断言算法有偏。必须乘整体拒绝概率 R 再与接受质量相加。',
    boundary:
      'p=q 时 R=0，不会进入拒绝恢复，不能除以零。源码指数竞赛只需相对权重，可省略显式归一化；图中归一化是为了讲解。单点 q 对应屏蔽草稿 token 的特殊情形。',
    cost: '逐词相减、截零和抽样为 O(V)。',
    steps: [
      step('对照目标与草稿', '检查两者分别归一化为 1。', 'residual'),
      step(
        '计算已接受质量',
        '每项最多拿到 min(p,q)，草稿不足的部分无法靠接受阶段补出。',
        'rejection',
      ),
      step('只保留正的差', '对 p−q 截零；负值意味着已经不欠这项了。', 'residual'),
      step('构造条件恢复分布', '仅在 R>0 时除以 R，恢复抽样补上缺失质量。', 'residual'),
      step('逐项验算守恒', '把接受质量与恢复质量堆叠起来，应与 p 一致。', 'residual'),
    ],
    quiz: [
      '若 p=q，残差全为 0，应该怎么办？',
      '不会发生拒绝，无需残差恢复',
      '把零向量归一化后继续恢复',
      '总接受概率已经为 1；残差分支在这个条件下不可达。',
    ],
  },
);
add(
  'greedy-verify',
  '贪心投机验证与 Bonus',
  'speculation',
  '逐位置比较目标 argmax，首个不一致处纠正，全部一致才追加 Bonus。',
  {
    params: ['aPreset'],
    presets: ['第 3 个不匹配', '全部匹配', '第 1 个不匹配'],
    related: ['speculative'],
    prerequisites: ['alg-rejection'],
    why: '温度为 0 的目标是复现目标模型的贪心序列，不需要套用随机 p/q 接受率。',
    intuition:
      '把草稿当作预填的答案，按题号核对。第一道错题之后的答案依赖了错误前提，因此不能继续直接采用。',
    symbols: [
      ['dᵢ', '第 i 个草稿 token'],
      ['tᵢ', '目标在该位置的 argmax'],
      ['b', '所有草稿都匹配后，目标多算出的下一 token'],
    ],
    formula:
      '按序比较 dᵢ == tᵢ\n首个不一致 j：提交 d₀…dⱼ₋₁ 和 tⱼ\n全部一致：提交全部草稿，再追加 b',
    worked:
      '草稿 A/B/C/A，目标 A/B/A/C：前两个接受，第三个改为 A，第四个丢弃，提交 A/B/A。若全部一致，则这轮可提交 4+1 个。',
    pitfall: '不能跳过错误位置后继续接收“碰巧相等”的后续候选；目标之后要基于纠正后的前缀继续。',
    boundary: '不模拟 EOS、中途停止或最大长度截断；实际最终交付还要满足这些请求约束。',
    cost: '验证 K 个草稿为 O(K)，首拒绝后停止提交。',
    steps: [
      step('读取两条序列', '逐位置的目标答案来自相同草稿前缀的并行验证。', 'greedyVerify'),
      step('逐位置核对', '匹配项加入已确认前缀。', 'greedyVerify'),
      step('纠正或追加', '首拒绝用目标 token 纠正；全收则追加 bonus。', 'greedyVerify'),
      step(
        '提交连续前缀',
        '后缀丢弃不代表目标模型永远不会生成它，只是需要重新验证。',
        'greedyVerify',
      ),
    ],
    quiz: [
      '第 2 个草稿不匹配，第 3 个恰巧匹配，可以继续收吗？',
      '不能，后续条件前缀已经改变',
      '可以，逐个 token 相等即可',
      '验证必须保留连续正确前缀，首拒绝后的条件上下文已失效。',
    ],
  },
);
add(
  'ngram',
  'N-gram 的反转 KMP 匹配',
  'speculation',
  '观察 LPS 回退、最长后缀匹配和候选复制，理解无模型草稿。',
  {
    params: ['aPreset', 'aNgram', 'aDraft'],
    presets: ['重复 AB 的历史', '没有可匹配后缀', '重复 A 与重叠匹配'],
    related: ['ngram'],
    prerequisites: ['alg-greedy-verify'],
    why: '如果最近的一段 token 在历史里出现过，可以把那次出现之后的 token 当作便宜的草稿。关键是高效找到最长匹配。',
    intuition:
      '把历史倒过来，寻找“开头这段”又在哪里出现。匹配失败时利用已知的前后缀关系退回，而不是从头比较所有字符。',
    symbols: [
      ['LPS[i]', '截至 i 的子串中，最长相等真前缀 / 后缀长度'],
      ['j', '当前已匹配前缀长度'],
      ['nmax', '允许的最大匹配长度'],
      ['K', '最多复制多少草稿'],
    ],
    formula:
      '匹配：j ← j+1\n不匹配且 j>0：j ← LPS[j−1]\n原历史复制起点 = N−1−最佳匹配末尾位置+最长匹配长度',
    worked:
      '历史 A B C A B D A B，末尾 AB 在更早处出现。最大匹配长度为 3 时可找到长度 2 的 AB；同长匹配按本地实现选择原历史最早处，后续复制 C A B。',
    pitfall:
      '找到历史续写不等于目标模型同意。N-gram 只负责提议，后面仍要验证；没有匹配时不能凭空产生草稿。',
    boundary:
      '移植固定源码中反转 KMP 的控制逻辑，最小长度固定为 1；省略批处理、Numba 和模型最大长度限制。示例 A/B 是 token ID 标签。',
    cost: 'KMP 扫描 O(N)，LPS 存储 O(nmax)，另有最多 O(K) 的复制。',
    steps: [
      step('反转历史', '末尾后缀问题转为反转序列的前缀匹配。', 'ngram'),
      step('扫描与 LPS 回退', '观察 i 与 j：失配时 j 回退，但 i 不必同时退回。', 'ngram'),
      step('定位最长匹配', '同长度优先原历史更早的位置；达到 nmax 后用 LPS 继续。', 'ngram'),
      step('复制并交给验证器', '仅复制匹配后已存在的 token，长度可能小于 K，也可能为 0。', 'ngram'),
    ],
    quiz: [
      '历史中找到了续写，是否就能跳过目标模型验证？',
      '不能，匹配只产生草稿候选',
      '能，历史出现过就一定正确',
      '语言模型按当前完整上下文预测；重复子串不保证后续概率相同。',
    ],
  },
);
add(
  'beam',
  'Beam Search 累积评分与剪枝',
  'speculation',
  '把现有候选树提升为算法推演：累计 log 概率、长度惩罚、EOS 与最终排序。',
  {
    params: mechanismParameterNames.beam,
    related: ['beam'],
    prerequisites: ['alg-softmax'],
    why: '每一步只保留一个最好 token 可能错过整体更好的序列。Beam 同时保留少量路径，在搜索成本和探索范围间取舍。',
    intuition:
      '同时走几条路线，每到一个路口扩展，再留下评分最好的几条。已经到终点的路线另存，不再继续走。',
    symbols: [
      ['B', 'Beam 宽度'],
      ['L', '累计 log 概率'],
      ['ℓ', '含固定前缀、排除末尾 EOS 的长度'],
      ['λ', '长度归一化指数'],
    ],
    formula: 'L新 = L父 + ln P(token | 前缀)\nscore = L / ℓ^λ\n每轮保留最多 B 个未结束分支',
    worked:
      '路径 A→B 的条件概率若是 0.6、0.5，则累计概率为 0.3，累计 log 概率为 ln(0.6)+ln(0.5)=ln(0.3)。本地源码的长度计入 prompt；实验固定 prompt 为 2 token。',
    pitfall:
      '不同长度的累计 log 概率不能直接当作长度归一化得分。Beam 也不保证找到全局最优序列，因为被剪掉的路径不再回来。',
    boundary:
      '三词 A/B/EOS 全枚举的教学搜索，省略真实 logprobs 截断、模型调用和结构化限制。独立采样只作对照，不参与 Beam 排名。',
    cost: '每轮扩展约 B×V 个候选的朴素上界；实际返回候选数通常受 top logprobs 限制。',
    steps: [
      step('建立起始前缀', '初始化累计 log 概率为 0。', 'beam'),
      step('扩展并加分', '沿路径累加 log 概率，EOS 进入完成集合。', 'beamStep'),
      step('排序与剪枝', '根据长度归一化得分保留 B 条存活路径。', 'beamScore'),
      step('合并最终结果', '把存活与完成候选合并排序后返回。', 'beam'),
    ],
    quiz: [
      'Beam 宽度增大就保证找到全局最优序列吗？',
      '不保证，仍有剪枝与长度上限',
      '保证，只要宽度大于 1',
      '有限宽度搜索仍可能丢弃后来会更好的路径。',
    ],
  },
);
add(
  'dynamic',
  '动态草稿长度的区间查表',
  'speculation',
  '把并发数映射为草稿数 K，区分配置规则和在线优化算法。',
  {
    params: mechanismParameterNames['dynamic-spec'],
    related: ['dynamic-spec'],
    prerequisites: ['alg-rejection'],
    why: '大 batch 下每请求都生成很多草稿会增加验证工作；可以按批大小设置不同 K。',
    intuition: '用一张分段价目表：当前人数落在哪一档，就使用那一档的草稿额度。',
    symbols: [
      ['B', '当前批大小'],
      ['[l,h,K]', '闭区间与对应草稿数'],
      ['K=0', '不产生草稿，目标普通解码继续'],
    ],
    formula: '找到 l ≤ B ≤ h 的配置行\nK(B) = 该行 K\n批次草稿位置数 = B × K(B)',
    worked:
      '区间 [1,64]→3、[65,128]→1、[129,512]→0。B=64 用 3，B=65 用 1；96→144→48→1 的四轮负载对应 1→0→3→3。',
    pitfall: '这不是模型自动学习最佳 K，也不能把 B×K 直接当成目标总计算量或延迟。',
    boundary:
      '实验要求三个连续闭区间覆盖 1…512；真实配置允许的范围和后端兼容性以校验函数为准，尤其注意 DP/Runner 约束。',
    cost: '预先建立稠密查表后，每轮查询可为 O(1)；表的构建和大小与配置覆盖范围相关。',
    steps: [
      step('读取当前批大小', '同一个请求下一轮可能落入不同 batch。', 'dynamic'),
      step('查闭区间', '边界 64、65 不属于同一区间，避免 off-by-one。', 'dynamic'),
      step('按 K 准备位置', 'K=0 关闭草稿而不是结束请求。', 'dynamicValidate'),
      step('下一轮重新查表', '配置表不变，运行时输入 B 改变。', 'dynamic'),
    ],
    quiz: [
      'K=0 表示什么？',
      '不生成草稿，目标模型继续普通解码',
      '本轮所有请求都停止生成',
      '关闭的是投机提议，不是目标生成路径。',
    ],
  },
);
add(
  'attention',
  '因果缩放点积 Attention',
  'model',
  '用一个 query、四个 key/value 手算相关性、掩码和加权和。',
  {
    params: ['aPreset', 'aQuery'],
    presets: ['普通向量', '相同 Key', '零 Query'],
    related: ['prefill', 'attention-backends'],
    prerequisites: ['alg-softmax'],
    why: '当前 token 需要结合可见上下文的信息。Q/K 决定关注哪里，V 决定从那里取出什么。',
    intuition:
      'Query 是检索问题，Key 是目录标签，Value 是实际内容。匹配分数变成权重后，再汇总内容。',
    symbols: [
      ['q、kᵢ', '长度 d 的 query/key 向量'],
      ['vᵢ', '第 i 个位置的 value 向量'],
      ['sᵢ', '缩放点积分数'],
      ['wᵢ', '可见位置上的注意力权重'],
    ],
    formula: 'sᵢ = q·kᵢ / √d\n未来位置的 sᵢ = −∞\nw = softmax(s); o = Σᵢ wᵢvᵢ',
    worked:
      'q=[1,0]、k₀=[1,0]、k₁=[0,1]，分数为 [0.7071,0]，若只允许这两项，权重约 [0.6698,0.3302]。v₀=[1,0]、v₁=[0,2]，输出约 [0.6698,0.6605]。',
    pitfall: '掩码必须在 Softmax 前应用。先对未来位置归一化再把结果清零，会让剩余权重和小于 1。',
    boundary:
      '单头、无量化的小矩阵；不包含 GQA、ALiBi、滑窗、softcap、sink 和具体 flash kernel 布局。',
    cost: '一个 query 对 N 个 key 的朴素计算为 O(Nd)；完整 N×N 自注意力为 O(N²d)。',
    steps: [
      step('准备 Q/K/V', '同一位置的 Key 与 Value 必须保持对应。', 'attention'),
      step('点积与缩放', '逐位置计算相似度，除以 √d 调整尺度。', 'attention'),
      step('屏蔽未来', '因果约束允许当前与过去位置，不允许未来。', 'attention'),
      step('Softmax 权重', '只在可见位置上归一化。', 'attention'),
      step('加权汇总 V', '结果是 Value 的加权和，不是 Key 的加权和。', 'attention'),
    ],
    quiz: [
      '因果 Attention 应在什么时候屏蔽未来位置？',
      'Softmax 之前',
      'Softmax 之后只把输出权重清零',
      '先屏蔽才能让归一化分母只包含合法可见位置。',
    ],
  },
);
add(
  'online-softmax',
  '在线 Softmax 与分块 Attention',
  'model',
  '逐块维护最大值、指数和与加权累加器，解释重缩放为何不可省。',
  {
    params: ['aPreset', 'aChunk'],
    presets: ['后块出现更大分数', '相同分数', '大分数偏移'],
    related: ['prefill', 'cp'],
    prerequisites: ['alg-attention'],
    why: '不必一次存下完整的注意力分数矩阵，也能计算同一个归一化结果。但不同块的局部最大值不同，不能直接相加。',
    intuition: '各批货用不同刻度称重。换到新的统一刻度时，之前累计的重量也必须换算。',
    symbols: [
      ['m', '已读分数的最大值'],
      ['l', '以 m 为基准的指数和'],
      ['a', '同一基准下的未归一化加权和'],
      ['α', '旧基准换成新基准的倍率'],
    ],
    formula:
      'm新 = max(m旧, max(s块))\nα = exp(m旧−m新)\nl新 = αl旧 + Σ exp(s块−m新)\na新 = αa旧 + Σ exp(s块−m新)v\n最终 o = a/l',
    worked:
      '先读分数 [0,1]，m=1、l=exp(−1)+1≈1.3679。下一块包含 3 时，m 变为 3，旧 l 必须乘 exp(1−3)≈0.1353，再加新块贡献。',
    pitfall:
      '不能平均各块的局部 Softmax 输出；各块的归一化分母不同。更换块大小也不应改变精确数学结果。',
    boundary:
      '演示单 query 的标量 value；不复现 GPU tile 调度与低精度误差。源码可能用 exp2 和相应尺度，实现形式不同而数学目标相同。',
    cost: '顺序读取 O(N)，维护标量 m/l 与输出大小的累加器；避免存整条概率数组。',
    steps: [
      step('初始化统计量', 'm=−∞、l=0、a=0；尚无任何质量。', 'online'),
      step('读取下一个块', '找本块最大值，更新全局基准。', 'online'),
      step('重缩放并累加', '把旧 l/a 换算到新 m，再加本块贡献。', 'online'),
      step('最终归一化', 'a/l 与一次性 Softmax 加权和进行数值对照。', 'attention'),
    ],
    quiz: [
      '后块最大值更大，旧的累加器怎么办？',
      '乘 exp(m旧−m新) 后再累加',
      '原样保留，只缩放新块',
      '新旧统计必须使用同一指数基准，才能正确相加。',
    ],
  },
);
add(
  'rope',
  'RoPE：成对坐标旋转',
  'model',
  '在平面里转动 query/key 的一个坐标对，理解位置差如何进入点积。',
  {
    params: ['aPreset', 'aPos'],
    presets: ['向量 [1,0]', '向量 [1,1]', '零向量'],
    related: ['long-context', 'prompt-embeds'],
    prerequisites: ['alg-attention'],
    why: '点积自身不包含 token 顺序。RoPE 按位置旋转 Q/K 的成对坐标，让相对位置影响相似度。',
    intuition: '同样的一支箭放到不同位置时，方向按位置转动。两支箭的夹角因此包含位置差。',
    symbols: [
      ['t', 'token 位置'],
      ['ω', '当前坐标对的旋转频率'],
      ['θ=tω', '旋转角，单位弧度'],
      ['(x,y)', '参与同一旋转的两维'],
    ],
    formula: 'x′ = x cos θ − y sin θ\ny′ = x sin θ + y cos θ\nx′²+y′² = x²+y²',
    worked:
      '固定 ω=1，位置 t=2 时，[1,0] 旋转为 [cos2,sin2]≈[−0.4161,0.9093]，长度仍为 1。实际不同坐标对使用不同频率。',
    pitfall:
      '旋转保留向量长度，不代表所有 Attention 分数保持不变。两向量在不同位置旋转，其点积会随相对角度改变。',
    boundary:
      '只画一个标准坐标对，ω 固定为首频率 1；不代表整个高维 RoPE，也不包含 NTK、YaRN、多模态位置扩展或不同配对布局。',
    cost: '每个旋转维度常数次乘加，总计 O(drot)。',
    steps: [
      step(
        '选择坐标对',
        '确认哪两个分量是一对；实际布局可能是 interleaved 或 split-half。',
        'rope',
      ),
      step('位置变成角度', '角度等于位置乘频率，不是直接把位置加到向量上。', 'rope'),
      step('计算 cos / sin', '使用同一个角度形成正交旋转。', 'rope'),
      step('旋转两个分量', '交叉项的正负号决定旋转方向。', 'rope'),
      step('检查长度不变', '对照旋转前后的平方范数。', 'rope'),
    ],
    quiz: [
      '标准 RoPE 旋转会改变单个向量对的长度吗？',
      '精确数学中不会',
      '一定随位置变长',
      '二维旋转矩阵是正交矩阵，保留欧氏范数。',
    ],
  },
);
add(
  'rmsnorm',
  'RMSNorm：均方根归一化',
  'model',
  '逐项平方、求均值、加 epsilon，再恢复方向并乘学习权重。',
  {
    params: ['aPreset', 'aEpsPower', 'aGain'],
    presets: ['向量 [1,2,3,4]', '全零向量', '含负数向量'],
    related: ['runner'],
    prerequisites: [],
    why: '网络层间的数值尺度可能不断变化。RMSNorm 用输入的均方根调节尺度，同时保留可学习的维度权重。',
    intuition: '先测这组数总体有多大，再统一换一个刻度；最后允许各维度使用自己的放大系数。',
    symbols: [
      ['xᵢ', '第 i 维输入'],
      ['ε', '避免分母过小的正数'],
      ['γᵢ', '可学习的逐维权重'],
      ['r', 'sqrt(mean(x²)+ε)'],
    ],
    formula: 'r = sqrt((Σxᵢ²)/d + ε)\nyᵢ = γᵢ × xᵢ / r',
    worked:
      '[1,2,3,4] 的均方为 7.5，忽略很小 ε 时 r≈2.7386；γ 全为 1 时输出约 [0.3651,0.7303,1.0954,1.4606]。',
    pitfall: '名字里出现 norm 不代表减均值。RMSNorm 不做 x−mean(x)，所以输出均值一般不为零。',
    boundary:
      '示例把 γ 各维设为同一可调系数；真实模型权重逐维不同。省略残差融合、截断 variance size 与 dtype 转换。',
    cost: '平方归约与逐维缩放为 O(d)。',
    steps: [
      step('读取输入与权重', '输入可正可负，平方只用于计算尺度。', 'rms'),
      step('平方求均值', '这里是均方，不是先减均值后的方差。', 'rms'),
      step('加 ε 并开方', '零输入也能得到有限分母。', 'rms'),
      step('按尺度归一化', '每个原始分量除以同一个 r，符号不变。', 'rms'),
      step('乘学习权重', 'γ 再调整各维尺度；检查结果是否有限。', 'rms'),
    ],
    quiz: [
      'RMSNorm 输出均值一定为 0 吗？',
      '不一定，它没有减去输入均值',
      '一定，所有归一化都会把均值变为 0',
      'RMSNorm 按均方根缩放；LayerNorm 的减均值步骤不在这里。',
    ],
  },
);
add(
  'paged-address',
  '分页 KV 的地址映射',
  'cache',
  '从 token 位置求逻辑块、块内偏移，再通过块表得到物理 slot。',
  {
    params: ['aPreset', 'aOffset', 'blockSize'],
    presets: ['离散物理块', '换一组物理块', '连续物理块'],
    related: ['paged'],
    prerequisites: [],
    why: '请求的逻辑 token 是连续的，但显存中的物理块不必连续。需要一个明确的映射才能正确读写 KV。',
    intuition: '逻辑页码像书的目录，物理块像分散的书架格子。先查目录，再加上页内行号。',
    symbols: [
      ['p', '从 0 开始的 token 位置'],
      ['B', '每块 token 数'],
      ['T[b]', '逻辑块 b 对应的物理块 ID'],
      ['slot', '物理 token 槽位'],
    ],
    formula: 'b = floor(p/B)\nr = p mod B\nslot = T[b]×B + r',
    worked:
      'B=4，块表 [3,0,5]，位置 p=5：逻辑块 1，块内偏移 1，查到物理块 0，slot=0×4+1=1。逻辑相邻不代表物理相邻。',
    pitfall:
      'slot 是 token 槽位编号，不是字节地址；真实 K/V tensor 还需要 head、维度、dtype 和布局步长。',
    boundary: '单组缓存、无上下文并行；省略 kernel block 与 cache block 大小转换。',
    cost: '给定块表，单位置索引和映射 O(1)。',
    steps: [
      step('选择逻辑位置', '位置从 0 开始，不能和“第几个 token”的自然编号混淆。', 'slot'),
      step('除法得到逻辑块', '整除确定在哪一块。', 'slot'),
      step('查物理块表', '块表给出位置，不复制整个 KV。', 'slot'),
      step('加上块内偏移', '物理块起点加余数得到 slot。', 'slot'),
      step('验证映射', '改变块大小或块表，观察同一逻辑位置落到哪里。', 'slot'),
    ],
    quiz: [
      '逻辑位置连续，物理 slot 必须连续吗？',
      '不必须，跨块时要查块表',
      '必须，否则 Attention 不能执行',
      '分页通过块表保持逻辑顺序，物理块允许离散。',
    ],
  },
);
add(
  'prefix-hash',
  '前缀缓存的链式哈希键',
  'cache',
  '逐块组合父键、当前 token 与附加键，解释相同后缀为何不能随便复用。',
  {
    params: ['aPreset'],
    presets: ['前缀全部相同', '首块不同、后块相同', 'token 相同、salt 不同'],
    related: ['prefix'],
    prerequisites: ['alg-paged-address'],
    why: '某块的 KV 不只由本块 token 决定，还依赖此前上下文。缓存键必须编码前缀，不能只对本块独立查重。',
    intuition: '每页的签名同时封入上一页的签名。前面一页改动，会顺着链影响后面各页。',
    symbols: [
      ['Hparent', '前一个完整块的键'],
      ['tokens', '当前完整块 token 序列'],
      ['extra', 'salt、LoRA、多模态等关联信息'],
      ['H', '实际实现选择的哈希函数'],
    ],
    formula: 'key块 = H(Hparent, tuple(tokens), extra)\n查找时还要考虑 KV cache group',
    worked:
      '两请求后两个 token 均为 C/D，但前缀分别是 A/B 与 X/B，第二块的父键不同，因此第二块键也不同。token 全相同时，不同 salt 同样隔离缓存。',
    pitfall: '命中缓存键只说明找到了可复用块，不代表完整请求、尾部 logits 或所有缓存组都无需计算。',
    boundary:
      '画面用完整、可读的嵌套签名代替压缩哈希摘要，避免教学哈希碰撞；不实现 SHA/CBOR，不模拟完整命中长度或碰撞安全。',
    cost: '每个完整块的哈希读取本块 token 与固定大小父摘要；实际摘要算法及附加键影响成本。',
    steps: [
      step('按完整块分组', '教学块大小固定为 2，只把完整块放进链。', 'hash'),
      step('组合第一块键', '根键、token 与附加键共同参与。', 'hash'),
      step('把父键串入下一块', '相同当前块还必须有相同前缀。', 'hash'),
      step('对照另一请求', '同时检查 token、父键与附加信息。', 'lookup'),
      step('理解命中边界', '缓存键是复用的必要依据，不是整个请求免算的证明。', 'lookup'),
    ],
    quiz: [
      '当前块 token 相同，但父块键不同，可以直接认为命中吗？',
      '不可以，当前块的条件上下文不同',
      '可以，只比较当前 token 即可',
      '链式键把此前上下文传递到当前块，防止跨不同前缀误复用。',
    ],
  },
);
add(
  'cache-queue',
  '空闲块队列、引用计数与淘汰',
  'cache',
  '观察命中触碰、释放入队和从队头重新分配，区分缓存与占用。',
  {
    params: ['aPreset', 'aTake'],
    presets: ['命中空闲缓存块', '块仍被请求引用', '全部块都在使用'],
    related: ['prefix', 'paged', 'preemption'],
    prerequisites: ['alg-prefix-hash'],
    why: '物理块即使没有请求引用，仍可能保留可复用的缓存内容。新的分配需要从可用块中选择，并清理旧的缓存索引。',
    intuition:
      '空闲桌面上可以暂放资料。有人再次使用它，就从空闲队列取走；需要新桌面时，队头的旧资料可能被清掉。',
    symbols: [
      ['ref_cnt', '正在引用物理块的请求数量'],
      ['free queue', 'ref_cnt=0 的可重用物理块队列'],
      ['touch', '复用缓存时增加引用并移出空闲队列'],
    ],
    formula:
      '命中：ref_cnt 0→1 时从 free queue 移除\n释放：ref_cnt 减到 0 时入队\n分配：从队头取块，清除旧缓存映射，再置为占用',
    worked:
      '空闲顺序为 [0,1,2]，命中块 1 后只剩 [0,2]。释放它后排到队尾，变成 [0,2,1]；此时需要两块，选择 0 和 2，而不是刚用过的 1。',
    pitfall: 'ref_cnt=0 不等于内容已经清空。正在被引用的块也不能为了命中率被随便淘汰。',
    boundary:
      '单组块池示例，省略 null block、异步延迟释放、部分块缓存与多组协调。称为队列淘汰更准确，不等于对所有块做一个无约束 LRU。',
    cost: '源码链式空闲队列支持单块移除/入队；申请 n 块通常需要 O(n) 次操作。',
    steps: [
      step('检查队列和引用', '绿色占用块不在可重用队列里。', 'allocate'),
      step('命中并 touch', '缓存复用增加引用；原来空闲的块先移出队列。', 'touch'),
      step('释放引用', '只有引用减到零时才重新加入队尾。', 'free'),
      step('申请新的物理块', '容量不足时应失败，不得挑选仍被引用的块。', 'allocate'),
      step('核对淘汰和归属', '已重新分配块的旧缓存映射被移除。', 'allocate'),
    ],
    quiz: [
      'ref_cnt 为 0，是否表示原缓存内容已经不可复用？',
      '不一定，重新分配前仍可能命中',
      '是，释放引用会立刻抹掉缓存',
      '空闲可重用与内容是否仍缓存是两个不同的状态。',
    ],
  },
);
add('int8', '逐 Token 对称 INT8 量化', 'numeric', '逐项计算 absmax、scale、舍入值和还原误差。', {
  params: ['aPreset'],
  presets: ['普通激活', '一个离群大值', '全零输入'],
  related: ['quantization', 'online-quant'],
  prerequisites: [],
  why: '将浮点激活用更小的整数表示能减少存储和传输，但有限刻度会引入误差。',
  intuition: '把一把连续刻度尺换成 255 个对称刻度；scale 决定每一格代表多少原始数值。',
  symbols: [
    ['a', '一行输入的 max(abs(x))'],
    ['s', '浮点与整数刻度之间的比例'],
    ['qᵢ', '量化整数'],
    ['x̂ᵢ', '用 qᵢ×s 还原的近似值'],
  ],
  formula: 'a = max(max|xᵢ|, 1e−10)\ns = a/127\nqᵢ = round_half_away_from_zero(xᵢ/s)\nx̂ᵢ = qᵢ×s',
  worked:
    '若 absmax=1.4，scale≈0.011024。x=0.47 对应 42.6357，舍入得到 q=43，还原约 0.4740。未裁剪时绝对误差通常不超过 scale/2。',
  pitfall:
    '离群大值会增大所有元素共用的 scale，令小值分辨率变差。INT8、FP8、AWQ 和 GPTQ 不是同一个算法。',
  boundary:
    '对照 per-token INT8 CUDA 路径，使用最近整数（半格远离零）舍入；不执行整数 GEMM、权重量化校准或跨平台舍入细节。',
  cost: '扫描 absmax 与逐项量化 O(d)，每行额外保存一个 scale。',
  steps: [
    step('读取一行激活', '一行共用同一个 scale。', 'quant'),
    step('寻找绝对最大值', '零行使用正下界防止 scale=0。', 'quant'),
    step('换成整数刻度', '缩放到约 [−127,127] 的范围。', 'quant'),
    step('舍入并存储', '舍入之后，多个接近的原值可能落在同一格。', 'quant'),
    step('还原并测误差', '整数乘 scale，逐项比较误差。', 'quant'),
  ],
  quiz: [
    '加入一个很大的离群值，对同一行小值有什么影响？',
    '共用 scale 变大，小值刻度可能更粗',
    '小值量化精度一定提高',
    '一行共享 absmax，因此离群值会扩大每个整数刻度代表的原始范围。',
  ],
});
add('lora', 'LoRA 的低秩增量计算', 'numeric', '用两次小矩阵乘法得到 Δy，并与基础输出逐维相加。', {
  params: ['aPreset', 'aScale'],
  presets: ['普通输入', '换一个输入', '零输入'],
  related: ['lora'],
  prerequisites: [],
  why: '为多个任务保存完整的大权重矩阵代价高。低秩增量用较小的 A/B 表达对基础线性层的调整。',
  intuition: '基础模型先给答案，适配器先把输入压缩成少量特征，再把这些特征扩展成一份修正意见。',
  symbols: [
    ['W', '基础矩阵，形状 out×in'],
    ['A', '降维矩阵 r×in'],
    ['B', '升维矩阵 out×r'],
    ['s', '增量缩放，实际常与 alpha/r 有关'],
  ],
  formula: 'ybase = Wx\nu = Ax\nΔy = sBu\ny = ybase + Δy',
  worked:
    'W=[[1,0,1],[0,1,−1]]，A=[[1,−1,0]]，B=[[0.5],[−1]]，x=[1,2,1]。基础输出 [2,1]，u=−1，s=1 时增量 [−0.5,1]，结果 [1.5,2]。',
  pitfall: 'LoRA 不是拿 A 或 B 替换基础 W。没有适配器或 s=0 时应保留基础输出。',
  boundary:
    '固定 rank=1 的数值例子；省略多适配器映射、TP、量化、异步 stream 和权重加载时的缩放折入。',
  cost: '增量 O(r×in + out×r)，参数量 r(in+out)，不包含基础 Wx。',
  steps: [
    step('对齐矩阵形状', '先检查输入维度与 A/W 的列数一致。', 'lora'),
    step('计算基础输出', 'Wx 独立于适配器增量。', 'lora'),
    step('低秩降维', 'Ax 得到 r 维中间向量。', 'lora'),
    step('升维与缩放', 'B(Ax) 回到输出维度，再应用增量比例。', 'lora'),
    step('逐维合并', '基础输出加增量，而不是替换基础结果。', 'lora'),
  ],
  quiz: [
    's=0 时，LoRA 层的输出应是什么？',
    '基础输出 Wx',
    '全零向量',
    '归零的是增量路径，基础线性层仍然存在。',
  ],
});
add(
  'moe-topk',
  'MoE Top-k 路由与权重归一化',
  'numeric',
  '区分选哪些专家、给它们多少权重，以及最后如何合并结果。',
  {
    params: ['aPreset', 'aExperts'],
    presets: ['偏向专家 0', '所有专家同分', '偏向专家 3'],
    related: ['moe'],
    prerequisites: ['alg-softmax', 'alg-topk'],
    why: '每个 token 只送给部分专家，可以限制计算量，同时允许不同 token 使用不同的专家组合。',
    intuition: '先挑选几个最合适的顾问，再按权重汇总各自意见。选择名单与意见权重是不同的步骤。',
    symbols: [
      ['gᵢ', 'router 给专家 i 的分数'],
      ['S', 'Top-k 专家集合'],
      ['wᵢ', '选中专家上的归一化权重'],
      ['fᵢ(x)', '专家输出'],
    ],
    formula: 'P = softmax(g)\nS = topk(P)\nwᵢ = Pᵢ / Σⱼ∈S Pⱼ\ny = Σᵢ∈S wᵢ fᵢ(x)',
    worked:
      '路由概率 [0.6,0.3,0.08,0.02]，Top-2 选择前两位，权重为 2/3、1/3；若专家输出为 2、5，合并结果是 3，而不是 7。',
    pitfall: '选中两个专家不代表各占 1/2，也不是把 token 拆成两半后分别处理。',
    boundary:
      '选用 softmax + renormalize 的普通路由示例。不同模型可用 sigmoid、分组 Top-k、纠偏 bias 或不重新归一化；专家函数使用简单数值。',
    cost: 'softmax O(E)，专家选择的实现依赖后端，合并约 O(k×输出维度)。',
    steps: [
      step('读取 Router 分数', '这里的类别是专家 ID，不是词表 token。', 'moe'),
      step('计算路由概率', '只表示 router 的偏好，还没有执行专家。', 'moe'),
      step('选择 Top-k 专家', '名单与原 ID 保持对应，同分按示例固定顺序。', 'moe'),
      step('在选中集合内归一化', '本章启用 renormalize，权重之和为 1。', 'moe'),
      step('执行并加权合并', '乘权重再相加，不能直接把专家输出相加。', 'moe'),
    ],
    quiz: [
      '选中两个专家的原概率 0.6、0.3，归一化权重是什么？',
      '2/3 和 1/3',
      '0.5 和 0.5',
      '先除以选中集合总质量 0.9，保留原始相对比例。',
    ],
  },
);
add(
  'eplb',
  'EPLB：副本分配与均衡装箱',
  'numeric',
  '观察高负载专家获得副本，再按容量约束装入设备。',
  {
    params: ['aSkew', 'aReplica'],
    related: ['eplb', 'moe'],
    prerequisites: ['alg-moe-topk'],
    why: '逻辑专家的访问量可能很不均匀。若一个热门专家只有一个物理副本，所在设备容易形成瓶颈。',
    intuition: '给最忙的服务窗口增加同类窗口，再把这些窗口分配到各大厅；每个大厅还有座位数量限制。',
    symbols: [
      ['Lᵢ', '逻辑专家观测负载'],
      ['cᵢ', '当前物理副本数'],
      ['Lᵢ/cᵢ', '假定均摊时的单副本负载'],
      ['pack', '一个设备可容纳的一组副本'],
    ],
    formula:
      '副本分配：重复选择 argmax(Lᵢ/cᵢ)，令 cᵢ += 1\n装箱：按副本负载降序，放入当前最轻且未满的设备',
    worked:
      'L=[12,4,2,2]，初始每个 1 个副本。第一个额外副本给专家 0，单副本负载降到 6；第二个仍给它，降到 4。随后将物理副本按负载排序装箱。',
    pitfall:
      '复制专家并没有增加语义上的新专家，也不保证全局最优摆放。理想均摊负载不等于真实网络通信与迁移耗时。',
    boundary:
      '对照默认策略的复制与 balanced_packing 子算法，固定两设备；补齐空槽以满足每设备同等槽数。省略层/节点层级、迁移与原槽位保留。',
    cost: '朴素副本选择 O(R×E)，装箱排序 O(P log P)，设备选择还与设备数相关。',
    steps: [
      step('读取逻辑专家负载', '一次观测窗口的负载作为固定输入。', 'replicas'),
      step('逐个分配额外副本', '每增加一份副本就重新比较 L/c。', 'replicas'),
      step('准备物理副本任务', '同一逻辑专家的负载按副本数均摊。', 'replicas'),
      step('降序均衡装箱', '设备满槽后不能继续选择它，即使其负载较小。', 'packing'),
      step('比较最大设备负载', '这是代理指标，不是硬件吞吐的预测。', 'packing'),
    ],
    quiz: [
      '设备还有较低负载但槽位已经满了，还能继续放专家吗？',
      '不能，装箱同时受槽位数量约束',
      '能，只要比另一设备轻',
      '默认 balanced_packing 要保证每个 pack 的物理项数相同，满槽项会被屏蔽。',
    ],
  },
);
add(
  'pooling',
  '序列 Pooling 与 L2 归一化',
  'numeric',
  '把 token 向量聚合成一个序列向量，再决定是否归一化。',
  {
    params: ['aPreset', 'aTokens', 'aPoolMode', 'aNormalize'],
    presets: ['不同 token 向量', '全零向量', '正负抵消'],
    related: ['pooling'],
    prerequisites: [],
    why: 'Embedding 接口需要每条序列一个向量，而模型内部通常为每个 token 输出一个向量。',
    intuition:
      '把多份局部描述汇总成一句总评：可以取平均，也可以取指定位置的代表；最后统一向量长度便于比较。',
    symbols: [
      ['hₜ', '第 t 个有效 token 的向量'],
      ['n', '有效 token 数，不是 padding 长度'],
      ['v', '聚合结果'],
      ['‖v‖₂', '向量欧氏长度'],
    ],
    formula: 'Mean: v = Σhₜ/n; Last: v = hₙ₋₁; CLS: v = h₀\n可选 L2: y = v / max(‖v‖₂, ε)',
    worked:
      'h₀=[1,0]、h₁=[0,2]、h₂=[1,1]，均值为 [2/3,1]；L2 长度约 1.20185，归一化约 [0.5547,0.8321]。Last 则直接取 [1,1] 后再选择是否归一化。',
    pitfall:
      'Mean、Last、CLS 不是可任意替换的效果等价操作；模型训练目标决定该用哪一种。零向量也不能直接除以零。',
    boundary:
      '展示有效 token 的小矩阵。归一化采用基础 L2 定义，真实 Pooler 可包含 projector、维度截断、activation 和任务专属头。',
    cost: 'Mean 读取 O(nd)，Last/CLS 选择后归一化为 O(d)。',
    steps: [
      step('只取有效 token', 'padding 不参与本示例的均值分母。', 'mean'),
      step('选择聚合规则', 'Mean、Last、CLS 的输入相同，聚合方式不同。', 'mean'),
      step('得到序列向量', '先完成 pooling，再决定后续处理。', 'mean'),
      step('可选长度归一化', '使用非零下界处理零向量。', 'normalize'),
      step('检查输出形状', 'n×d 变成 d，不是生成一个新的 token。', 'normalize'),
    ],
    quiz: [
      '均值 Pooling 应除以什么？',
      '有效 token 数',
      '包含 padding 的固定最大长度',
      '把 padding 计入分母会稀释真实 token 的表示。',
    ],
  },
);

export const algorithmCatalog = rows;
export const algorithmIds = rows.map((r) => r.id);
export const algorithmParameterNames = Object.fromEntries(rows.map((r) => [r.id, r.params]));
export function registerAlgorithms(lessons) {
  rows.forEach((row, index) => {
    const [question, correct, wrong, reason] = row.quiz;
    const refs = [
      ...new Map(row.steps.map((s) => [s.source.path + '#' + s.source.symbol, s.source])).values(),
    ];
    if (row.slug === 'softmax') refs.push(S.greedy);
    if (row.slug === 'pooling') refs.push(S.last, S.cls);
    lessons.push({
      ...row,
      algorithm: row,
      group: 'algorithms',
      kind: 'algorithm',
      english: 'ALGORITHM · ' + String(index + 1).padStart(2, '0'),
      analogy: row.intuition,
      refs,
      question,
      choices: index % 2 ? [wrong, correct] : [correct, wrong],
      answer: index % 2,
      reason,
      misconception: reason,
      steps: row.steps.map((s) => ({ ...s, source: { ...s.source, observe: s.body } })),
    });
  });
}
