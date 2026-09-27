import { algorithmSources as S } from './algorithm-sources.mjs';
const embedding = {
  path: 'vllm/model_executor/layers/vocab_parallel_embedding.py',
  symbol: 'VocabParallelEmbedding.forward',
};
const logits = {
  path: 'vllm/model_executor/layers/logits_processor.py',
  symbol: 'LogitsProcessor.forward',
};
const diffusion = { path: 'vllm/config/diffusion.py', symbol: 'DiffusionConfig' };
const denoise = {
  path: 'vllm/model_executor/models/diffusion_gemma.py',
  symbol: '_compiled_sample_step',
};
const rows = [];
const add = (slug, title, family, summary, detail) =>
  rows.push({ id: 'base-' + slug, slug, title, family, summary, ...detail });
const steps = (ref, items) =>
  items.map(([title, body]) => ({ title, body, change: body, source: ref }));

add(
  'notation',
  '先读懂公式：下标、求和与 argmax',
  'math',
  '把 Σ、∏、下标、条件符号、归一化读成普通话。',
  {
    params: ['bSize'],
    prerequisites: [],
    related: ['alg-softmax', 'alg-rejection', 'alg-rope'],
    why: '公式难懂，常常先卡在符号，而不是计算。本章先把常用符号翻译成逐项操作，之后再去理解概率公式。',
    intuition: 'Σ 像一张加法清单，∏ 像一张乘法清单；下标告诉你从哪一格取数。',
    symbols: [
      ['xᵢ', '数组 x 的第 i 项；本工具位置编号从 0 开始'],
      ['Σᵢ xᵢ', '把指定范围内的每一项加起来'],
      ['∏ᵢ xᵢ', '把指定范围内的每一项乘起来'],
      ['argmaxᵢ xᵢ', '最大值所在的位置，区别于 max 返回值'],
      ['∝', '只给相对比例，需要再除以总和'],
      ['p(x|c)', '在条件 c 已知时，x 的概率；竖线不是除号'],
      ['√x / x²', '平方根 / 平方；与下标区分'],
      ['x∈R / X∼p', 'x 是实数 / 随机变量 X 服从分布 p'],
    ],
    formula: 'x = [1,2,3,4]\nΣᵢ xᵢ = x₀+x₁+…\n∏ᵢ xᵢ = x₀×x₁×…\npᵢ ∝ xᵢ  ⇒  pᵢ = xᵢ / Σⱼxⱼ',
    worked:
      '取前三项 [1,2,3]：求和为 6，连乘为 6，最大值是 3，但 argmax 是位置 2。作为非负权重归一化后，得到 [1/6,2/6,3/6]，总和为 1。',
    pitfall:
      '下标不表示幂；xᵢ 与 x² 不同。argmax 返回索引。归一化需要非负权重且总和大于零，不能对任意带负号数组直接当概率处理。',
    boundary:
      '用 1～4 项整数讲符号，不引入求导或无限级数。右侧源码是这些符号对应操作的一个使用位置。',
    codeNote: '采样器包含 argmax、求和和归一化相关操作；本章符号练习不是源码逐行执行。',
    steps: steps(S.softmax, [
      ['确定索引', '先知道数组长度与下标范围。'],
      ['逐项求和', '累计器从 0 开始，每次加当前元素。'],
      ['连乘与最大位置', '连乘从 1 开始；最大值和所在位置分别记录。'],
      ['归一化', '所有正权重除以同一个总和。'],
      ['读回自然语言', '把索引、求和和分母连接成一句操作说明。'],
    ]),
    quiz: [
      '[1,2,3] 的 argmax（从 0 编号）是多少？',
      '2，是最大值所在的位置',
      '3，是数组最大值',
      'max 是 3，argmax 是下标 2；注意区分结果的含义。',
    ],
  },
);
add(
  'shapes',
  '标量、向量、矩阵与张量形状',
  'math',
  '从一个数到一张表，读懂 batch、序列长度和 hidden size。',
  {
    params: ['bSize'],
    prerequisites: ['base-notation'],
    related: ['runner', 'tp', 'alg-lora'],
    why: '模型里大多数计算处理的是一组数组。先看 shape，就能判断哪个轴是请求、哪个轴是 token、哪个轴是特征，也能提前发现乘法维度不匹配。',
    intuition: '一本账本有多页，每页多行，每行多列。张量维度描述这套目录结构，而不是“数字大小”。',
    symbols: [
      ['标量', '一个数，shape=[]'],
      ['向量', '一列或一行数，shape=[d]'],
      ['矩阵', '二维数表，shape=[n,d]'],
      ['B×S×D', 'batch 数 × 每序列位置数 × 每位置特征数'],
    ],
    formula:
      '一个 token 的表示：h ∈ Rᴰ\n一条序列：H ∈ Rˢˣᴰ\n一批序列：X ∈ Rᴮˣˢˣᴰ\n元素总数 = B×S×D',
    worked:
      '2 条序列，每条 3 个位置，每个位置 2 个特征，共 2×3×2=12 个数。这里“3 个位置”不是 hidden size，“2 维特征”也不表示只有两个词。',
    pitfall:
      'reshape 改变看待数据的形状，不会凭空增加信息；transpose 交换轴并改变索引对应关系。真实 vLLM 常把有效 token 打包成 [总 token 数,D]，不总是保留 B×S×D。',
    boundary: '固定 B=2、D=2，让序列长度变化；省略 padding、stride、dtype 与物理内存连续性。',
    codeNote: 'Embedding 的查表输出与输入 token ID 的 shape 有关；本章不模拟张量并行的完整切分。',
    steps: steps(embedding, [
      ['看一个数', '标量可以是某个 token 表示中的一个分量。'],
      ['把分量组成向量', '每个位置拥有 D 个特征。'],
      ['把位置组成矩阵', '一条序列按位置排成多行。'],
      ['把序列组成 batch', '增加 batch 轴，不把请求身份混在一起。'],
      ['核对元素数', '三个轴相乘，得到数组中数字的数量。'],
    ]),
    quiz: ['[2,3,4] 形状的张量有多少个元素？', '24', '9', '各轴的可能索引组合数相乘：2×3×4=24。'],
  },
);
add(
  'linear',
  '点积、矩阵乘法与相似度',
  'math',
  '看清“对应相乘再相加”，理解线性层和注意力的基本计算。',
  {
    params: ['bAngle'],
    prerequisites: ['base-shapes'],
    related: ['alg-attention', 'alg-lora', 'tp'],
    why: 'Attention 用点积比较 query/key，线性层用矩阵把输入映射成另一组特征。复杂的大模型也依赖这些小操作。',
    intuition: '点积像把每个评分标准乘上权重再汇总；矩阵的每一行是一套不同的权重。',
    symbols: [
      ['q·k', '对应分量相乘后求和'],
      ['‖q‖₂', '向量的欧氏长度'],
      ['cos(q,k)', '点积除以两个向量长度'],
      ['W∈Rᵐˣⁿ', 'm 行 n 列矩阵，把 n 维输入变成 m 维输出'],
    ],
    formula: 'q·k = Σᵢqᵢkᵢ\ncos(q,k) = (q·k)/(‖q‖₂‖k‖₂)\nyᵢ = ΣⱼWᵢⱼxⱼ',
    worked:
      'q=[1,0]，k 与它夹角 60° 且长度为 1，则点积为 0.5。W=[[1,2],[-1,1]] 乘 k=[0.5,0.866]，得到约 [2.232,0.366]。',
    pitfall:
      '点积不一定是概率，也可能为负；向量长度变化会改变点积，即使方向相同。零向量的余弦相似度分母为零，需要另外定义处理。',
    boundary: '二维单位向量可画在平面上；这里只示范线性变换，省略 bias、非线性与高维空间。',
    codeNote: 'Attention 内的 QK 点积是本概念的应用位置，不是余弦相似度的直接实现。',
    steps: steps(S.attention, [
      ['摆出两个向量', 'q 固定朝右，拖动角度改变 k 的方向。'],
      ['逐坐标相乘', '先产生两个中间乘积，不要直接相加坐标。'],
      ['把乘积求和', '单位向量的点积等于夹角余弦。'],
      ['矩阵逐行计算', '把矩阵每行分别与输入做点积。'],
      ['检查形状与符号', '输出长度等于矩阵行数，负值也是合法结果。'],
    ]),
    quiz: [
      '两个非零向量点积为负，说明什么？',
      '夹角大于 90°，不是“负概率”',
      '计算出了不合法的概率',
      '点积是一个有符号的数；它还不是 Softmax 后的注意力权重。',
    ],
  },
);
add(
  'exp-log',
  '指数、对数与概率归一化',
  'math',
  '理解为什么分数要取指数、为什么序列概率要取对数。',
  {
    params: ['bLogit'],
    prerequisites: ['base-notation'],
    related: ['alg-softmax', 'alg-beam', 'alg-exponential'],
    why: 'logits 可能为负，不能直接当概率。指数把分数变为正权重；对数把许多小概率的连乘改为求和。',
    intuition: '指数放大差距，对数压缩尺度。它们互为逆操作，但把分数变成概率还差一个“除总和”。',
    symbols: [
      ['exp(z)=eᶻ', '严格为正的指数函数'],
      ['ln(x)', '自然对数，要求 x>0'],
      ['logit', '模型输出的未归一化分数'],
      ['log probability', '概率的对数，通常不大于 0'],
    ],
    formula: 'ln(exp(z)) = z\npᵢ = exp(zᵢ)/Σⱼexp(zⱼ)\nln(p₁p₂) = ln p₁ + ln p₂',
    worked:
      '分数 [1,0] 的指数权重约为 [2.718,1]，总和 3.718，概率为 [0.7311,0.2689]。条件概率 0.5、0.2 的序列联合概率为 0.1，对数为 ln0.5+ln0.2≈−2.3026。',
    pitfall:
      'logit 不是 log probability。对数底数要一致；本工具使用自然对数。p=0 对应 log p=−∞，不会变成 0。',
    boundary: '动画使用稳定的减最大值实现；完整数值稳定性可继续到算法章。',
    codeNote: 'Softmax 与 Beam 的 log 概率累加是实际使用位置。',
    steps: steps(S.softmax, [
      ['读取两个分数', '分数可以正、负或零。'],
      ['减去共同基准', '使用最大分数作为数值稳定基准。'],
      ['指数变正权重', '权重还没有归一化。'],
      ['除以总权重', '得到总和为 1 的概率。'],
      ['对数把乘变加', '比较两次条件概率的连乘与 log 求和。'],
    ]),
    quiz: [
      'exp(logit) 之后就是概率了吗？',
      '还需要除以所有指数权重的总和',
      '是，因为已经大于零',
      '正数只是权重；概率分布还需要总和为 1。',
    ],
  },
);
add(
  'probability',
  '随机变量、事件与离散分布',
  'probability',
  '把“随机选中一个 token”拆成可能结果、事件与概率。',
  {
    params: ['bProb'],
    prerequisites: ['base-notation'],
    related: ['alg-softmax', 'alg-rejection', 'sampling'],
    why: '接受率、目标分布、草稿分布都在描述随机结果。如果分不清“一次结果”和“长期机会”，就容易把采样算法读错。',
    intuition:
      '抽球前每种颜色都有机会；抽球后只看到一个颜色。概率表描述抽球规则，不是某一次抽到的颜色。',
    symbols: [
      ['Ω', '所有可能结果的集合'],
      ['X', '把随机结果映射成数值或类别的随机变量'],
      ['事件 A', '一组可能结果'],
      ['P(X=x)', '离散结果 x 的概率'],
    ],
    formula: 'Ω={A,B,C}\np(A)=r; p(B)=0.6(1−r); p(C)=0.4(1−r)\nP(X∈{A,B})=p(A)+p(B)\nΣₓp(x)=1',
    worked:
      'r=0.3 时，分布为 [0.3,0.42,0.28]。事件“不是 C”有两种互斥结果，因此概率为 0.3+0.42=0.72。一次恰好选中 C 并不否定这个分布。',
    pitfall: '概率最高不等于一定发生。只有互斥事件才能直接把概率相加；有交集时需扣掉重复部分。',
    boundary: '使用三类别玩具词表；真实词表通常包含大量 token，且概率取决于完整上下文。',
    codeNote: '采样器消费 token 分布；本章不复现某个 GPU 随机数流。',
    steps: steps(S.exponential, [
      ['列出可能结果', '先确定样本空间与类别。'],
      ['分配概率质量', '每项非负，所有项加起来为 1。'],
      ['组合一个事件', '把 A 或 B 的互斥概率相加。'],
      ['看补事件', '“不是 C”与 C 的概率和为 1。'],
      ['区分结果与规则', '单次样本不是整张概率表。'],
    ]),
    quiz: [
      '最高概率为 0.6 的 token 是否必然被抽中？',
      '不，仍有 0.4 的机会抽到其他项',
      '是，最高概率就是确定结果',
      '随机采样保留其他非零概率项；贪心才固定取最大项。',
    ],
  },
);
add(
  'conditional',
  '条件概率、联合概率与独立性',
  'probability',
  '用一张联合概率表解释竖线、分母、概率链式法则。',
  {
    params: ['bCase', 'bGiven'],
    presets: ['相关的两个位置', '独立的两个位置', '第二个条件不可能发生'],
    prerequisites: ['base-probability'],
    related: ['alg-rejection', 'alg-greedy-verify', 'speculative'],
    why: '语言模型预测的是“给定前缀之后”的下一词概率。更换前缀就更换了条件，因此不能随便沿用旧的后续预测。',
    intuition: '知道一个条件后，把注意力缩到符合条件的那几格，再把这些格重新归一化。',
    symbols: [
      ['P(A,B)', 'A 和 B 同时发生的联合概率'],
      ['P(B)', '把所有 A 的联合概率相加得到边缘概率'],
      ['P(A|B)', '只在 B 已发生的样本中看 A 的比例'],
      ['独立', '知道 B 不改变 A 的分布'],
    ],
    formula: 'P(A|B)=P(A,B)/P(B)，要求 P(B)>0\nP(A,B)=P(A|B)P(B)\n独立时 P(A,B)=P(A)P(B)',
    worked:
      '联合表为 [[0.4,0.1],[0.1,0.4]]，行是 A=0/1，列是 B=0/1。P(B=0)=0.5，P(A=0|B=0)=0.4/0.5=0.8；但 P(A=0)=0.5，说明不独立。',
    pitfall:
      'P(A|B) 通常不等于 P(B|A)；P(B)=0 时这一定义没有可用分母，不能输出一个貌似正常的概率向量。',
    boundary: '两个二值位置的静态联合表；真实模型用神经网络计算很长上下文的条件分布。',
    codeNote:
      '投机验证中的 p/q 需要以同一个前缀为条件，这里连接的是概念，不是拒绝 kernel 内计算联合概率表。',
    steps: steps(S.rejection, [
      ['读取联合表', '四格表示互斥的联合结果，总和为 1。'],
      ['选择已知条件', '固定列 B，只看这一列。'],
      ['计算边缘概率', '列内相加得到 P(B)。'],
      ['归一化条件列', '每格除以 P(B)；零分母明确停止。'],
      ['与原分布比较', '只有分布不变时，才符合独立性的相应条件。'],
    ]),
    quiz: [
      '为什么投机推理首拒绝后的预测不能直接继续提交？',
      '后续预测所依赖的条件前缀已经变了',
      '因为后续 token 的概率一定为零',
      '条件前缀改变后，旧的条件概率不再是新前缀下的正确预测；不等于所有后续词都不可能。',
    ],
  },
);
add(
  'bayes',
  '全概率与贝叶斯：从结果反推来源',
  'probability',
  '区分先验、似然、证据与后验，避免颠倒条件方向。',
  {
    params: ['bPrior', 'bLikelihood', 'bFalse'],
    prerequisites: ['base-conditional'],
    related: ['alg-residual', 'base-diffusion'],
    why: '看到一个观察结果后，我们会重新判断它来自哪种隐藏状态。扩散反向过程中的条件推断也需要这种思路。',
    intuition: '两个盒子按不同概率产出红球。看见红球以后，回头计算它来自哪个盒子的机会。',
    symbols: [
      ['P(H)', '选择盒子 H 的先验概率'],
      ['P(E|H)', '盒子 H 产出红球 E 的似然'],
      ['P(E)', '把所有盒子来源合起来的红球概率'],
      ['P(H|E)', '看见红球后的来源后验'],
    ],
    formula: 'P(E)=P(E|H)P(H)+P(E|非H)P(非H)\nP(H|E)=P(E|H)P(H)/P(E)',
    worked:
      '选 H 的概率为 0.2，它出红球的概率为 0.8；另一个盒子出红球概率为 0.1。红球总概率 0.2×0.8+0.8×0.1=0.24。看到红球后，来自 H 的概率为 0.16/0.24=2/3。',
    pitfall: '似然高不等于后验高，来源本身可能极少出现。后验需要同时考虑先验和证据的总概率。',
    boundary:
      '盒子示例避免应用领域假设；输入范围使证据始终有正概率。本课是基础统计知识，并不是 vLLM 提供了通用贝叶斯推断接口。',
    codeNote: '这里只连接到条件采样相关位置；源码不实现本章的盒子贝叶斯计算。',
    steps: steps(S.residual, [
      ['设置先验', '先决定两个盒子被选择的机会。'],
      ['乘各自的似然', '先验乘似然，得到两条通往证据的概率质量。'],
      ['按全概率相加', '所有互斥来源的证据质量相加。'],
      ['归一化成后验', '每条来源质量除以同一个证据总量。'],
      ['比较先验和后验', '观察证据如何改变对来源的判断。'],
    ]),
    quiz: [
      'P(红球|盒子H)=0.8，是否意味着 P(盒子H|红球)=0.8？',
      '不，后者还取决于先验和另一盒子的情况',
      '是，条件可以直接交换',
      '贝叶斯公式需要用先验加权，并除以证据总概率。',
    ],
  },
);
add(
  'moments',
  '期望、方差与标准差',
  'probability',
  '用伯努利事件看平均值和波动，理解“平均收益”不等于每轮收益。',
  {
    params: ['bProb'],
    prerequisites: ['base-probability'],
    related: ['alg-rejection', 'alg-rmsnorm', 'metrics'],
    why: '平均接受数量、采样噪声和归一化都会用到平均或波动。期望描述概率加权的长期中心，方差描述偏离中心的程度。',
    intuition:
      '期望像平均落点，方差像落点分散程度。两次实验均值相同，也可能一个很稳定、一个波动很大。',
    symbols: [
      ['E[X]', '按概率加权的数值平均'],
      ['Var(X)', '偏离均值的平方的期望'],
      ['σ', '标准差，为方差开平方'],
      ['Bernoulli(p)', '只取 0/1、成功概率为 p 的随机变量'],
    ],
    formula: 'E[X]=ΣₓxP(X=x)\nVar(X)=E[(X−E[X])²]\nBernoulli(p): E[X]=p; Var(X)=p(1−p)',
    worked:
      'p=0.3 时，X 只可能取 0 或 1，均值为 0.3，但一次不可能得到“0.3 次成功”。方差为 0.21，标准差约 0.4583。p=0 或 1 时没有随机波动。',
    pitfall: '方差单位是原单位的平方；标准差才与原数值同单位。E[X²] 和 E[X]² 一般不同。',
    boundary: '精确计算已知分布的总体矩，而不是用有限样本估计。多个事件相加的方差还要考虑相关性。',
    codeNote: 'RMSNorm 使用二阶原点矩 E[X²]；它不是先减均值后计算方差的 LayerNorm。',
    steps: steps(S.rms, [
      ['列出数值和概率', 'X=0 或 1，与类别名称不同，这里有数值含义。'],
      ['求加权平均', '逐项计算 x×P(X=x)。'],
      ['计算偏离平方', '先减均值再平方，负偏离不会被抵消。'],
      ['按概率再平均', '得到方差，再开方得到标准差。'],
      ['观察边界', '成功率为 0 或 1 时，结果确定，方差为 0。'],
    ]),
    quiz: [
      '伯努利变量均值为 0.3，一次试验会得到 0.3 吗？',
      '不会，单次仍只能是 0 或 1',
      '会，期望就是每次的结果',
      '期望是按分布平均后的量，不必属于随机变量的实际取值集合。',
    ],
  },
);
add(
  'cdf',
  '均匀随机数、CDF 与分类抽样',
  'probability',
  '在 0～1 的数轴上划区间，把随机数变成一个离散结果。',
  {
    params: ['bCase', 'bU'],
    presets: ['A/B/C = 0.2/0.5/0.3', '包含零概率类别', '三个类别等概率'],
    prerequisites: ['base-probability'],
    related: ['alg-exponential', 'alg-rejection'],
    why: '“按概率抽样”需要具体算法。一维均匀随机数加累积概率，能把抽象的概率表变成可执行操作。',
    intuition: '把一条长度为 1 的尺子分成三段，段长就是概率。闭眼落下一个点，看它落在哪一段。',
    symbols: [
      ['U∼Uniform[0,1)', '0 到 1 之间均匀取值'],
      ['CDF', '按固定类别顺序累计概率'],
      ['类别区间', '左闭右开，长度等于该类别概率'],
    ],
    formula: 'Fᵢ=Σⱼ≤ᵢpⱼ\n选择第一个满足 U<Fᵢ 的 i\n类别 i 对应 [Fᵢ₋₁,Fᵢ)',
    worked:
      'p=[0.2,0.5,0.3] 时区间为 [0,0.2)、[0.2,0.7)、[0.7,1)。U=0.35 选 B；U 恰好为 0.2 也选 B。零概率项的区间长度为零，不应被选中。',
    pitfall:
      '一个随机数只产生一次样本。固定种子用于复现，不会让每次样本都等于最高概率项。区间边界须统一，避免重复或漏选。',
    boundary:
      '这里讲逆 CDF 分类采样；vLLM 的默认原生路径使用指数竞赛等方法。原理都是按目标分布选结果，不代表同样的随机数得到同一个 token。',
    codeNote: '打开源码可对照 random_sample 的指数噪声实现；此处不是声称它按 CDF 搜索。',
    steps: steps(S.exponential, [
      ['读取分类分布', '先检查非负与总和为 1。'],
      ['建立累积边界', '顺序加起来，最后一个边界应为 1。'],
      ['放入均匀随机数', 'U 是输入，不是输出类别概率。'],
      ['定位区间', '用左闭右开约定选唯一类别。'],
      ['得到一次样本', '分布不变，下一个 U 可以产生另一个结果。'],
    ]),
    quiz: [
      '概率为零的类别在 CDF 数轴上占多长？',
      '0，不会被合法抽中',
      '与其他类别一样长',
      '区间长度就是类别概率。零概率类别没有可供随机数落入的区间。',
    ],
  },
);
add(
  'monte-carlo',
  '频率、蒙特卡洛与随机误差',
  'probability',
  '重复抽样，观察频率趋近概率，但不要求误差每一步都变小。',
  {
    params: ['bProb', 'bDraws', 'seed'],
    prerequisites: ['base-moments', 'base-cdf'],
    related: ['alg-exponential', 'alg-rejection', 'invariance'],
    why: '一次随机实验说明不了分布是否正确。重复独立抽样可以用频率估计概率，但有限次数仍会波动。',
    intuition:
      '连续掷硬币，正面比例会在真实概率附近摆动；多掷几次增加信息，却不能保证下一次一定更接近。',
    symbols: [
      ['n', '独立样本数量'],
      ['p̂', '样本中成功次数除以总次数'],
      ['标准误差', '样本均值的标准差'],
      ['seed', '伪随机数序列的可复现起点'],
    ],
    formula: 'p̂=(X₁+…+Xₙ)/n\nE[p̂]=p\nSE(p̂)=√(p(1−p)/n)，独立伯努利假设下',
    worked:
      'p=0.3、n=100 时标准误差约为 √0.0021=0.0458。样本成功率可能是 0.27 或 0.34，都不奇怪。样本量扩大 4 倍，标准误差约缩小到一半。',
    pitfall:
      '频率不是精确概率；更大的 n 不保证某一次实际误差更小。种子相同可复现，也不等于模型在所有硬件上有相同输出。',
    boundary:
      '使用浏览器的确定性伪随机数生成器演示独立伯努利抽样。图中的标准误差是分布的尺度，不是对本次误差的确定上界。',
    codeNote: '随机采样代码是概念使用位置；本课的频率实验和教学种子不对应 GPU 的随机序列。',
    steps: steps(S.exponential, [
      ['设定真实成功率', '玩具实验里 p 已知，用来对照估计值。'],
      ['逐次抽样', '独立抽取 U，小于 p 则记 1，否则记 0。'],
      ['累计成功次数', '每增加样本就更新频率。'],
      ['比较概率与频率', '保留历史曲线，观察误差也会暂时变大。'],
      ['解释标准误差', '说明样本量怎样改变统计波动尺度。'],
    ]),
    quiz: [
      '样本数从 100 增至 400，标准误差约变为多少？',
      '原来的一半',
      '原来的四分之一',
      '标准误差与 1/√n 成比例，而不是与 1/n 成比例。',
    ],
  },
);
add(
  'gaussian',
  '连续概率、密度与高斯噪声',
  'probability',
  '区分曲线高度和区间概率，读懂 N(μ,σ²)。',
  {
    params: ['bMu', 'bSigma', 'seed'],
    prerequisites: ['base-moments'],
    related: ['base-diffusion', 'alg-rmsnorm'],
    why: '扩散公式中的噪声通常来自高斯分布。连续随机变量的概率要看区间面积，不能直接把某一点的密度当作概率。',
    intuition: '曲线像沙堆的轮廓，某段下面的面积代表落在这个区间的机会；峰更高，可能只是分布更窄。',
    symbols: [
      ['μ', '分布中心、均值'],
      ['σ', '标准差，控制宽窄'],
      ['N(μ,σ²)', '第二个参数是方差，不是标准差'],
      ['f(x)', '概率密度，可以大于 1'],
    ],
    formula: 'f(x)=exp(−(x−μ)²/(2σ²))/(σ√(2π))\n区间概率 = 曲线下对应面积\nZ∼N(0,1) ⇒ X=μ+σZ',
    worked:
      'μ=0、σ=1 的标准正态在 [−1,1] 的概率约 0.6827。σ=0.25 时峰值约 1.596，大于 1 也合法，因为整体面积仍为 1。',
    pitfall:
      '连续分布中精确落在单个点的概率为 0，但密度不必为 0。有限区间之外仍有尾部概率；图画到边缘不代表分布被截断。',
    boundary: '曲线展示 μ±4σ，面积用数值积分作近似；不将小样本直方图当作精确密度。',
    codeNote: '本章是扩散基础；当前源码入口是离散 dLLM 配置，不代表 vLLM 在这里运行高斯图像扩散。',
    steps: steps(diffusion, [
      ['确定均值与标准差', '先看中心，再看分散尺度。'],
      ['画概率密度', '高度与概率不是同一个量。'],
      ['给区间涂面积', '观察 [μ−σ,μ+σ] 的概率质量。'],
      ['把标准噪声缩放平移', '一个 Z 样本变成 μ+σZ。'],
      ['比较窄与宽', '缩放改变密度高度，仍保持总面积约为 1。'],
    ]),
    quiz: [
      '高斯密度的峰值大于 1 是否非法？',
      '不，受限为 1 的是总概率，不是密度高度',
      '是，任何概率相关量都不能大于 1',
      '连续概率由面积计算；窄分布可以有很高的密度峰。',
    ],
  },
);
add(
  'information',
  '熵、交叉熵与 KL 散度',
  'probability',
  '区分分布的不确定性、预测代价和两个分布的差异。',
  {
    params: ['bProb', 'bEstimate'],
    prerequisites: ['base-exp-log', 'base-probability'],
    related: ['alg-rejection', 'alg-residual', 'diffusion'],
    why: '“模型很确定”与“模型预测正确”不是同一件事。熵看自身分布，交叉熵和 KL 还需要另一个参考分布。',
    intuition:
      '熵问“结果有多难猜”；交叉熵问“用 q 来描述真实来自 p 的结果要付多少代价”；KL 是多付出的部分。',
    symbols: [
      ['p', '参考或数据分布'],
      ['q', '预测分布'],
      ['H(p)', '分布自身的熵'],
      ['H(p,q)', '使用 q 描述 p 的交叉熵'],
      ['KL(p‖q)', '相对熵，通常不对称'],
    ],
    formula: 'H(p)=−Σᵢpᵢ ln pᵢ\nH(p,q)=−Σᵢpᵢ ln qᵢ\nKL(p‖q)=H(p,q)−H(p)\n约定 0 ln 0 = 0',
    worked:
      'p=[0.5,0.5] 时熵为 ln2≈0.6931。若 q=[0.9,0.1]，交叉熵约 1.2040，KL 约 0.5108；q 很偏向第一项并不意味着匹配 p。',
    pitfall:
      '低熵不等于高准确率；KL 不是对称距离。若 p 某项大于 0 而 q 对应为 0，交叉熵和 KL 为无穷大，不该悄悄忽略它。',
    boundary: '使用两个类别和自然对数，单位为 nat；q 的滑条避开 0 与 1 以便观察有限数值。',
    codeNote: 'DiffusionGemma 使用熵相关判断；本章不把通用 KL 公式当成其具体提交条件。',
    steps: steps(denoise, [
      ['摆出 p 与 q', '明确哪一个分布用来作参考。'],
      ['计算信息量', '概率越小，−ln p 越大。'],
      ['按 p 加权', '分别累计自身信息量和预测信息量。'],
      ['相减得到 KL', '交叉熵减熵得到相对差异。'],
      ['比较相等与偏离', 'q=p 时 KL 为 0；确定不等于正确。'],
    ]),
    quiz: [
      '模型预测分布熵很低，能说明它预测正确吗？',
      '不能，它可能很确信地给出错误分布',
      '能，低熵就是准确率高',
      '熵只描述自身的集中程度；需要参考目标或真实样本才能讨论正确性。',
    ],
  },
);
add(
  'tokens',
  'Token、词表、Embedding 与 Logits',
  'models',
  '把文本、整数 ID、特征向量和词表分数串起来。',
  {
    params: ['bToken'],
    prerequisites: ['base-shapes', 'base-exp-log'],
    related: ['lifecycle', 'prefill', 'runner', 'alg-softmax'],
    why: '模型不会直接处理一个中文字的“含义”。分词把文本变成 ID，Embedding 把 ID 变成向量，模型再输出下一 token 的分数。',
    intuition:
      'ID 像书架编号，Embedding 像这本书的特征卡。编号本身大小不表达语义远近，特征卡才参与后续计算。',
    symbols: [
      ['词表 V', '可用 token 与 ID 的对应表'],
      ['E∈Rⱽˣᴰ', '每个 token 一行特征的 Embedding 表'],
      ['h', '模型处理上下文后的隐藏向量'],
      ['z∈Rⱽ', '每个候选 token 的 logit'],
    ],
    formula: 'token ID i → E[i,:]\n隐藏向量 h → z = Wh\nz → Softmax(z) → 下一 token 分布',
    worked:
      '教学词表只有“我、爱、学习、EOS”四项。选择 ID=1 取出“爱”的那一行向量，而不是把数值 1 本身当语义。隐藏向量经输出映射生成 4 个分数，再转换为概率。',
    pitfall:
      'token 不等于汉字或英文单词；EOS 也是特定 ID。输入 Embedding 与输出权重有的模型共享、有的不共享，不能一概而论。',
    boundary:
      '玩具词表与矩阵是人为设定，不运行真实 tokenizer；中间 Transformer 先作为抽象变换，后续章节补充。',
    codeNote: 'Embedding 查表和 LogitsProcessor 是真实概念入口；示例矩阵不是模型权重。',
    steps: steps(embedding, [
      ['选择一个 token ID', 'ID 是离散索引，不带连续距离含义。'],
      ['查 Embedding 表', '取出对应行，得到 D 维特征。'],
      ['经过上下文模型', '示例隐藏向量承接表征，实际由多层网络计算。'],
      ['映射回词表分数', '每个词表项获得一个 logit。'],
      ['变成下一词分布', '归一化后才讨论采样概率。'],
    ]),
    quiz: [
      'ID=100 的词是否一定比 ID=10 的词更重要？',
      '不是，ID 只是词表索引',
      '是，数值越大权重越大',
      '词表索引不表示重要性；模型通过学到的向量与上下文计算分数。',
    ],
  },
);
add(
  'autoregressive',
  '自回归、概率链与 Prefill / Decode',
  'models',
  '解释为什么下一步依赖已确认前缀，以及训练时为何能并行处理位置。',
  {
    params: ['bCase'],
    presets: ['已知前缀 A', '已知前缀 B', '中途遇到 EOS'],
    prerequisites: ['base-conditional', 'base-tokens'],
    related: ['prefill', 'speculative', 'mtp', 'alg-beam'],
    why: '自回归语言模型把整段文字概率拆成逐位置条件概率。理解这条链，就能理解 KV Cache、逐 token 解码和投机验证的边界。',
    intuition: '接龙时每个新词都接在已经确认的词后面。前面的词换了，后面的选择依据也要重新评估。',
    symbols: [
      ['x<t', '当前位置之前的所有 token'],
      ['P(xₜ|x<t)', '给定前缀的下一 token 概率'],
      ['EOS', '结束符号，不是普通文字内容'],
    ],
    formula: 'P(x₁,…,xₙ)=∏ₜP(xₜ|x<t)\nlog P(序列)=Σₜlog P(xₜ|x<t)',
    worked:
      '给定起始前缀后，示例依次选择的模型条件概率为 0.8、0.8、0.8，这条续写序列的模型概率为 0.512。每项来自不同前缀。这里用贪心挑选一条路径便于观察，0.512 不是重复运行贪心策略的输出频率。',
    pitfall:
      '训练时有完整正确序列，可以在因果掩码下并行计算多个位置的损失；生成时未知的未来 token 不能被直接读取。Prefill 也常能产出第一枚输出。',
    boundary:
      '两类别加 EOS 的手工条件分布，贪心选择仅方便看依赖。忽略真实文本、KV 布局和停止字符串。',
    codeNote: 'Sampler 是下一个 token 的选择位置；完整 Prefill / Decode 与 KV 写入请跳转原机制章。',
    steps: steps(S.greedy, [
      ['给定已知前缀', '前缀是条件，不属于本轮猜测。'],
      ['计算下一词分布', '分布随当前最后一个词和上下文而变。'],
      ['确认一个新 token', '新 token 进入下一轮条件。'],
      ['累加 log 概率', '路径概率来自沿途条件概率相乘。'],
      ['检查 EOS 与边界', '遇到 EOS 停止；训练并行不取消生成依赖。'],
    ]),
    quiz: [
      '训练能并行算多个位置，为什么普通生成仍逐步进行？',
      '训练已知真实前缀，生成时未来词还未知',
      '因为训练不使用条件概率',
      '因果掩码可保证训练位置只读取其前缀；生成缺少后续真实 token，必须先得到它们。',
    ],
  },
);
add(
  'attention',
  '从 Q/K/V 到 Transformer',
  'models',
  '理解“找谁的信息、按多少比例读取”，再认识层与缓存。',
  {
    params: ['bToken', 'bCausal'],
    prerequisites: ['base-linear', 'base-tokens'],
    related: ['alg-attention', 'alg-online-softmax', 'runner', 'paged'],
    why: '自回归依赖前缀，Attention 提供读取前缀信息的计算方式。Q/K 决定权重，V 提供被组合的内容。',
    intuition:
      'Query 像问题，Key 像索引标签，Value 像正文；先比较索引，再按权重汇总内容。这个类比帮助记忆，不表示模型真的检索一份文档。',
    symbols: [
      ['Q', '当前查询向量'],
      ['K', '各位置用于匹配的向量'],
      ['V', '各位置被加权组合的向量'],
      ['因果掩码', '屏蔽当前 query 之后的位置'],
    ],
    formula: 'scoreᵢ=(Q·Kᵢ)/√d\nw=Softmax(score+mask)\noutput=ΣᵢwᵢVᵢ',
    worked:
      '四个位置中选择第 1 个（从 0 开始），因果掩码只允许读取位置 0 和 1。权重和为 1，但输出是向量，不是下一词概率；后面还会有其他层与输出映射。',
    pitfall:
      'Attention 权重不是最终 token 概率。Transformer 通常还包含多头、MLP、归一化和残差连接，不能把整个网络等同于一次 Attention。',
    boundary:
      '固定二维 Q/K/V。关闭因果掩码只作可见范围对照，不表示所有模型都可安全切换注意力规则。',
    codeNote: '源码展示注意力 kernel 的掩码、归一化与 Value 累加；未模拟完整 Transformer。',
    steps: steps(S.attention, [
      ['选择当前位置', '每个 token 可以产生自己的 Query。'],
      ['比较 Q 与 K', '点积分数高代表当前规则下匹配更强。'],
      ['应用可见范围', '因果模式屏蔽未来；掩码在归一化之前生效。'],
      ['组合 Value', '按权重加和向量，不直接输出词表 token。'],
      ['放回网络结构', 'Attention 后还有残差、归一化和 MLP 等处理；历史 K/V 可以缓存。'],
    ]),
    quiz: [
      'Attention 输出的向量就是下一 token 的概率表吗？',
      '不是，还需经过网络后续处理与词表映射',
      '是，Attention 已经做了 Softmax',
      'Attention 的 Softmax 在上下文位置上归一化；下一 token 的分布在词表维度上归一化。',
    ],
  },
);
add(
  'training',
  '训练、损失、梯度与推理',
  'models',
  '用一个可手算参数解释学习发生在哪里，以及推理时权重为何固定。',
  {
    params: ['bTrain', 'bLearningRate'],
    prerequisites: ['base-linear'],
    related: ['model-loading', 'lora', 'speculators'],
    why: '“模型训练过”与“服务正在生成”是不同阶段。学习算法修改参数，推理用已有参数计算结果；普通 vLLM 请求不会自动替你训练基础权重。',
    intuition:
      '训练像根据错题修改答题方法，推理像使用已经学好的方法做新题。输入更长不等于更新了参数。',
    symbols: [
      ['θ', '模型参数，本例只有一个数'],
      ['L', '衡量预测与目标差距的损失'],
      ['∂L/∂θ', '参数略微增大时损失变化的方向与速率'],
      ['η', '学习率，控制更新步长'],
    ],
    formula: 'ŷ=θx，目标 y=2，输入 x=1\nL=0.5(ŷ−y)²\ng=(ŷ−y)x\n训练：θ ← θ−ηg；推理：θ 保持不变',
    worked:
      'θ=0、x=1、y=2 时预测 0，损失 2，梯度 −2。学习率 0.2 时，θ 更新为 0.4，下一次预测 0.4，损失变为 1.28。',
    pitfall:
      '梯度不是模型答案，也不是损失本身。学习率并非越大越好；复杂模型的训练还有数据、优化器、正则化等因素。',
    boundary: '显式公式更新一个标量，不训练语言模型。对比的“推理模式”只是展示相同权重被反复使用。',
    codeNote: '模型权重参与线性与 LoRA 前向；这里的梯度下降例子不是 vLLM 推理层中的训练步骤。',
    steps: steps(S.lora, [
      ['设定参数与目标', '区分可变权重、输入和教学目标。'],
      ['前向计算损失', '先有预测，再比较预测与目标。'],
      ['计算梯度', '本例可手算对参数的导数。'],
      ['更新或冻结', '训练应用更新，推理保持参数不变。'],
      ['再次前向检查', '比较损失与参数是否发生变化。'],
    ]),
    quiz: [
      '普通推理请求读到新的 prompt，会自动更新基础模型权重吗？',
      '不会，通常只改变运行状态和激活',
      '会，每次对话都是一次梯度训练',
      '普通推理复用已经加载的权重；上下文与 KV 状态变化不等于模型训练。',
    ],
  },
);
add(
  'markov',
  '马尔可夫链与状态转移',
  'generation',
  '通过两种状态的转移概率，为理解多步扩散做准备。',
  {
    params: ['bStay', 'bRounds'],
    prerequisites: ['base-conditional'],
    related: ['base-diffusion', 'base-discrete-diffusion'],
    why: '多轮随机过程需要描述相邻步骤之间怎样变化。扩散的前向过程常用马尔可夫转移来定义，而反向条件分布不是简单反转箭头。',
    intuition: '每轮只查看当前格子来决定下一步去哪里；已经走过的路线可以被当前状态概括。',
    symbols: [
      ['sₜ', '第 t 步的状态'],
      ['Tᵢⱼ', '当前 i、下一步 j 的概率'],
      ['πₜ', '第 t 步各状态的概率分布'],
    ],
    formula: 'P(sₜ₊₁|s₀,…,sₜ)=P(sₜ₊₁|sₜ)\nπₜ₊₁=πₜT\n每行 ΣⱼTᵢⱼ=1',
    worked:
      '保持原状态的概率为 0.8，从状态 A 确定出发，第一轮为 [0.8,0.2]；第二轮为 [0.68,0.32]。这是分布的传播，不是说一个物体被劈成两半。',
    pitfall:
      '马尔可夫性相对于“如何定义状态”而言；状态可以包含整段上下文，不等于语言模型只看最后一个 token。反向转移还依赖边缘分布。',
    boundary: '两个状态、固定对称矩阵，传播完整概率分布；不声称所有链都收敛或具有相同稳态。',
    codeNote: 'dLLM 的迭代状态是概念连接位置，实际实现不是本章的两状态链。',
    steps: steps(diffusion, [
      ['确定状态空间', '示例只有 A 与 B。'],
      ['读取转移矩阵', '每一行给定一种当前状态，行和为 1。'],
      ['传播一个步骤', '按当前状态概率加权各行。'],
      ['重复传播', '保留每一轮分布，观察变化。'],
      ['区分分布与轨迹', '一个样本只在一个状态，分布描述所有可能样本。'],
    ]),
    quiz: [
      '马尔可夫过程是否意味着语言模型只能看最后一个词？',
      '不是，状态可以定义成完整前缀',
      '是，必须丢弃所有历史',
      '条件独立是相对于状态表示而言；完整上下文也可包含在当前状态中。',
    ],
  },
);
add(
  'diffusion',
  '什么是扩散模型：加噪与反向生成',
  'generation',
  '先认识前向破坏与反向条件采样，再理解为什么去噪需要模型。',
  {
    params: ['bBeta', 'bRounds', 'seed'],
    prerequisites: ['base-gaussian', 'base-bayes', 'base-markov'],
    related: ['diffusion', 'base-discrete-diffusion'],
    why: '扩散模型学习从噪声状态逐步生成数据。加噪规则已知，反向预测通常需要训练好的网络；不是保存噪声后直接做减法。',
    intuition: '前向逐步降低信号比例；反向根据当前可见状态判断哪些更干净的状态合理，再继续采样。',
    symbols: [
      ['x₀ / xₜ', '干净数据 / 第 t 步的噪声状态'],
      ['βₜ', '本步加入的噪声方差比例'],
      ['αₜ=1−βₜ', '本步保留信号的平方系数'],
      ['ᾱₜ', '从 1 到 t 的 α 连乘'],
      ['ε∼N(0,1)', '标准高斯噪声'],
    ],
    formula: '前向：xₜ=√αₜ xₜ₋₁+√βₜ εₜ\n边缘：xₜ|x₀ ∼ N(√ᾱₜ x₀, 1−ᾱₜ)\n反向：从 p(xₜ₋₁|xₜ) 采样',
    worked:
      'β=0.25、x₀=1、噪声 ε=0.4 时，x₁=√0.75×1+0.5×0.4≈1.066。一次加噪后数值不一定减小，下降的是统计意义上的信号比例。',
    pitfall:
      '生成不要求找回原来那一个样本。不同随机路径可以生成不同结果；看到了加噪过程，并不等于知道任意数据的反向条件分布。',
    boundary:
      '动画数据仅为等概率的 −1 / +1；反向转移用这个已知玩具先验的精确贝叶斯公式，独立启动一条生成链，不读回前向保存的噪声。真实 DDPM 用训练网络近似反向过程。',
    codeNote:
      '当前 vLLM 的此入口是离散语言扩散配置，不是图像 DDPM 实现。连续高斯基础用于理解概念，随后再学习离散版本。',
    citations: [['DDPM 原始论文（式 2、4、6）', 'https://arxiv.org/abs/2006.11239']],
    details: [
      [
        '真实模型学什么？',
        '训练时有干净样本，也知道人为加进去的噪声。DDPM 的一种常见训练方式，让网络 εθ(xₜ,t) 预测这些噪声，用平方误差衡量预测好坏。生成时仅给网络当前状态和时间步，用预测结果构造下一步反向转移；此时没有原样本对应的噪声答案。不同模型也可以预测干净数据或采用其他参数化。',
        '噪声预测的简化训练目标：E[‖ε−εθ(xₜ,t)‖²]',
      ],
      [
        '本例为何无需训练？',
        '因为数据分布被完全规定为 −1 和 +1 各一半，可以先计算这两种来源的后验概率，抽一个来源，再从给定来源与当前状态的条件高斯采样。真实图像的数据分布远更复杂，不能靠这两个已知候选代替训练。图里的“条件均值、条件方差”指选定来源后的高斯分量，不是整个混合分布的均值和方差。',
        's∈{−1,+1}\nP(s|xₜ) ∝ 0.5×exp(−(xₜ−√ᾱₜ s)²/[2(1−ᾱₜ)])\n随后采样 xₜ₋₁ ∼ q(xₜ₋₁|xₜ,s)',
      ],
      [
        '起点为什么也要说明？',
        '步数较少时，末端状态不一定已经接近标准高斯。本例从精确的两分量末端混合分布另起一条链；真实 DDPM 通常选择足够的加噪程度，让末端近似 N(0,I)，再从高斯噪声开始生成。不要用本例 3～8 步的滑条去推断真实模型需要多少步。',
        '本例 pₜ = 0.5N(−√ᾱₜ,1−ᾱₜ) + 0.5N(+√ᾱₜ,1−ᾱₜ)',
      ],
    ],
    steps: steps(diffusion, [
      ['设定玩具数据分布', '干净数据只有 −1 与 +1 两种，各占一半。'],
      ['前向逐步加噪', '显示信号系数与噪声系数的变化。'],
      ['独立启动反向链', '从本例的末端边缘分布采样，不倒放刚才的随机轨迹。'],
      ['按后验逐步采样', '利用已知玩具先验计算反向条件分布。'],
      ['回到数据空间', '最终落在 −1 或 +1，不保证等于前向那枚样本。'],
    ]),
    quiz: [
      '扩散生成是否就是把前向保存的噪声逐步减回去？',
      '不是，生成需要根据当前状态进行反向预测或条件采样',
      '是，保存每步噪声就能生成全新数据',
      '真实生成没有待恢复的原图和对应噪声日志；本例用可解析先验代替训练网络。',
    ],
  },
);
add(
  'discrete-diffusion',
  '离散扩散：Mask、画布与多轮去噪',
  'generation',
  '把连续数值换成 token 状态，看清“提出整块”和“确认结果”的区别。',
  {
    params: ['bReveal', 'bCase'],
    presets: ['按置信度逐步填充', '首轮猜错，下一轮修正', '迭代预算不足'],
    prerequisites: ['base-diffusion', 'base-tokens', 'base-information'],
    related: ['diffusion', 'dflash', 'base-generation'],
    why: '文字是离散 token，不能直接给 ID 加一个高斯小数。离散扩散可以定义 token 之间的转移，或把 token 逐步变成 Mask，再学习从损坏状态恢复。',
    intuition:
      '先摆出一排待填格子，每轮为多个位置提出候选，再按规定确认部分位置。候选可以被修正，不是每轮都直接追加输出。',
    symbols: [
      ['canvas', '当前整块待生成位置'],
      ['MASK', '吸收态教学例中的未知符号'],
      ['去噪轮次', '多次读取和更新同一批位置'],
      ['提交', '满足规则后交付可见输出'],
    ],
    formula:
      '本教学例的损坏：token → MASK\n一轮去噪：为未确认位置提议候选 → 选择部分位置确认\n确认数量受规则与迭代预算限制',
    worked:
      '四个未知位置可以先提出“我／会／学习／EOS”，只确认最有把握的两格；下一轮利用更新后的上下文再处理剩余格子。首轮低置信度错误候选会留待后续修正。',
    pitfall:
      'Mask 只是离散扩散的一种设计，不是所有扩散语言模型都从 Mask 开始。概率置信度高也不保证真实语义正确。',
    boundary:
      '使用预设候选和分数讲依赖，不运行模型，不宣称改动“每轮确认数”能提高真实质量。当前 DiffusionGemma 实现使用随机 token 画布、熵规则、重加噪与专门提交条件，不能把本例当成它的精确算法。',
    codeNote:
      '这里连接当前 DiffusionGemma 的 _compiled_sample_step，可对比随机词重加噪与熵规则，而不是寻找本例的 Mask 选择代码。',
    citations: [['D3PM：离散状态空间与吸收态设计', 'https://arxiv.org/abs/2107.03006']],
    steps: steps(denoise, [
      ['区分离散损坏', '显示 token 如何被 Mask 替代，ID 不进行高斯加法。'],
      ['初始化待填画布', '新生成从未知位置开始，损坏演示不提供隐藏答案。'],
      ['并行提出候选', '示例候选由固定表给出，还不是已交付输出。'],
      ['确认或保留待更新', '每轮只确认一定数量；其余位置下一轮继续。'],
      ['检查提交条件', '仍有未知位置时，预算用完不能假装完成。'],
    ]),
    quiz: [
      '所有离散扩散模型都从全 MASK 序列开始吗？',
      '不是，损坏过程和初始化方式取决于模型',
      '是，这是扩散的定义',
      '吸收态 Mask、随机替换等都可定义离散转移；需要核对具体模型。',
    ],
  },
);
add(
  'generation',
  '分清自回归、MTP、投机与扩散',
  'generation',
  '用三条生成时间线看“多 token”背后的不同含义。',
  {
    params: ['bDraftLength'],
    prerequisites: ['base-autoregressive', 'base-discrete-diffusion'],
    related: ['mtp', 'speculative', 'diffusion'],
    why: '一次看见多个候选，并不能说明它们使用同一种生成模型。需要分别问：候选来自哪里、依赖什么、谁来验证、什么时候能提交。',
    intuition:
      '普通自回归逐词接龙；投机先打草稿再审核；扩散在一组位置上反复修改。MTP 是一种多 token 预测能力，在本工具关注的推理路径里可作为草稿来源。',
    symbols: [
      ['自回归', '按已确认前缀定义下一位置分布'],
      ['MTP', '模型的多 token 预测模块，实际结构因模型而异'],
      ['投机解码', '提议草稿后由目标模型验证并校正'],
      ['扩散生成', '多轮更新同一组位置，按模型规则提交'],
    ],
    formula:
      '普通 AR：前缀 → 下一个 token → 新前缀\n投机：前缀 → 草稿候选 → 目标验证 → 连续确认前缀\n扩散：噪声 / 未知画布 → 多轮更新 → 提交块',
    worked:
      '草稿 A/B/C 的第三项不被目标接受时，只提交 A/B 与纠正词；这与扩散把同一块中的多个位置再次更新不是一回事。MTP 产生的候选也不能因为“来自同一模型”就跳过相应验证。',
    pitfall:
      '不能把“多 token”都叫扩散，也不能把一次多个候选都解释成独立预测。MTP 是否并行、依赖哪些隐藏状态，都要看具体模型和 proposer。',
    boundary:
      '时间线只对比数据依赖与提交规则，不比较速度。当前 dLLM 复用部分投机数据通路，但字段复用不意味着执行相同的拒绝采样算法。',
    codeNote:
      '先查看 DiffusionConfig 对复用数据通路的说明，再沿下方链接分别进入 MTP、投机验证和扩散机制章。',
    steps: steps(diffusion, [
      ['分别确定生成状态', 'AR 是前缀，投机还有未验证候选，扩散维护画布。'],
      ['观察普通自回归', '每轮确认一个新位置后再形成下一轮条件。'],
      ['观察草稿与验证', '多个草稿位置先等待，目标验证后才能提交。'],
      ['观察迭代画布', '同一批位置反复更新，提交由模型规则决定。'],
      ['对照关键问题', '候选、条件依赖、验证器与提交时机分别回答。'],
    ]),
    quiz: [
      '一个模型一次提出多个 token，就能判定它是扩散模型吗？',
      '不能，还要看生成状态、条件依赖与更新规则',
      '能，多 token 就是扩散',
      'MTP、投机解码、扩散都可能涉及多个位置，但定义和提交规则不同。',
    ],
  },
);

export const foundationCatalog = rows;
export const foundationIds = rows.map((r) => r.id);
export const foundationParameterNames = Object.fromEntries(rows.map((r) => [r.id, r.params]));
export const foundationNeeds = {
  lifecycle: ['base-tokens', 'base-autoregressive'],
  prefill: ['base-autoregressive'],
  runner: ['base-shapes', 'base-attention'],
  sampling: ['base-probability', 'base-cdf'],
  speculative: ['base-conditional', 'base-cdf'],
  mtp: ['base-generation', 'base-autoregressive'],
  diffusion: ['base-diffusion', 'base-discrete-diffusion'],
  dflash: ['base-discrete-diffusion', 'base-generation'],
  'alg-softmax': ['base-exp-log', 'base-probability'],
  'alg-topk': ['base-probability'],
  'alg-topp': ['base-cdf'],
  'alg-minp': ['base-probability'],
  'alg-penalties': ['base-tokens'],
  'alg-exponential': ['base-cdf', 'base-exp-log'],
  'alg-rejection': ['base-conditional', 'base-cdf'],
  'alg-residual': ['base-conditional', 'base-bayes'],
  'alg-greedy-verify': ['base-autoregressive'],
  'alg-ngram': ['base-tokens'],
  'alg-beam': ['base-exp-log', 'base-autoregressive'],
  'alg-dynamic': ['base-generation'],
  'alg-attention': ['base-linear', 'base-attention'],
  'alg-online-softmax': ['base-exp-log', 'base-attention'],
  'alg-rope': ['base-linear'],
  'alg-rmsnorm': ['base-moments'],
  'alg-paged-address': ['base-shapes'],
  'alg-prefix-hash': ['base-tokens'],
  'alg-cache-queue': ['base-notation'],
  'alg-int8': ['base-shapes'],
  'alg-lora': ['base-linear', 'base-training'],
  'alg-moe-topk': ['base-probability', 'base-linear'],
  'alg-eplb': ['base-moments'],
  'alg-pooling': ['base-moments', 'base-shapes'],
};
export function registerFoundations(lessons) {
  rows.forEach((row, i) => {
    const [question, correct, wrong, reason] = row.quiz;
    const refs = [
      ...new Map(row.steps.map((s) => [s.source.path + '#' + s.source.symbol, s.source])).values(),
    ];
    if (row.slug === 'tokens') refs.push(logits);
    lessons.push({
      ...row,
      kind: 'foundation',
      group: 'foundations',
      english: 'FOUNDATION · ' + String(i + 1).padStart(2, '0'),
      analogy: row.intuition,
      refs,
      question,
      choices: i % 2 ? [wrong, correct] : [correct, wrong],
      answer: i % 2,
      reason,
      misconception: reason,
      steps: row.steps.map((s) => ({ ...s, source: { ...s.source, observe: row.codeNote } })),
    });
  });
}
