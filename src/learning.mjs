// Scenario questions are authored per topic, rather than generated from step order.
const bank = {
  lifecycle: [
    '首个输出已生成，但尚未停止。引擎接下来需要什么？',
    '保留请求状态与 KV，继续调度',
    '重新加载模型权重后才能继续',
    '模型权重会跨请求复用；自回归生成继续读取已有 KV。',
  ],
  prefill: [
    '8-token prompt 刚完成前向并采样首 token，已计算的 KV 长度是多少？',
    '8；新输出的 KV 尚待下一轮计算',
    '9；采样会同时计算新 token 的 KV',
    '采样只选择 token ID，新 token 必须作为下一次前向的输入才会产生 KV。',
  ],
  configuration: [
    '一个平台不支持所选 Runner 与功能组合，应如何判断？',
    '查看配置校验和支持分支',
    '参数能解析就代表组合受支持',
    '解析成功只是第一步，平台、模型和功能组合还会经过后续校验。',
  ],
  async: [
    'GPU 正在执行 N 批，CPU 能准备 N+1 批吗？',
    '可以，但依赖与屏障必须满足',
    '不需要等待任何结果，所有状态都能直接复用',
    '异步重叠需要处理在途输出与状态依赖，不能提前复用仍在访问的内存。',
  ],
  scheduler: [
    '一轮预算为 8，6 个 prefill token 与 2 个 decode token 能同批吗？',
    '其他约束满足时可以',
    'prefill 和 decode 必须分成两轮',
    'token 预算限制的是计算位置总数；显存和活动请求数等约束也必须满足。',
  ],
  chunked: [
    '长 prompt 被切成多轮，处理第一块后一定能给用户首 token 吗？',
    '需要完成可用于首个输出的 prompt 末尾计算',
    '每块结束都会直接输出一个正常回答 token',
    '切块保存中间 KV；普通自回归首 token 依赖完整 prompt 的末尾位置。',
  ],
  paged: [
    '逻辑上相邻的两个 KV 块，物理上必须相邻吗？',
    '不必，block table 记录映射',
    '必须，否则 Attention 无法读取',
    '逻辑顺序由块表保持；物理块可分散存放。',
  ],
  prefix: [
    '两个 12-token prompt 完全相同，本实验每块 4 token，B 能复用多少？',
    '8 token，保留尾部计算以获得 logits',
    '12 token，因此无需目标模型前向',
    '该源码路径至少保留末尾 token 的计算；本实验按完整块对齐，最多复用前 8 个位置。',
  ],
  preemption: [
    '请求已输出 2 个 token 后被抢占，恢复时会怎样？',
    '保留输出文本，重建被回收的 KV',
    '删除这 2 个输出并从空文本开始',
    '抢占重置已计算 KV 进度；已确认的输出 token 仍是请求上下文的一部分。',
  ],
  priority: [
    '请求优先级最高，但剩余 KV 不足，是否必然立即运行？',
    '仍需要资源满足，可能等待或触发抢占',
    '最高优先级可以跳过显存检查',
    '队列排序只决定候选顺序，不能创造计算预算或可用缓存块。',
  ],
  hybrid: [
    '滑动窗口层与全注意力层能使用完全相同的回收规则吗？',
    '需要按 CacheSpec 协调各类型状态',
    '都按最近一个 token 回收即可',
    '全注意力需要历史 KV，窗口层可跳过窗口外位置，状态空间层又有不同状态。',
  ],
  runner: [
    'MRV2 是否意味着使用 V2 引擎？',
    'MRV1 与 MRV2 都可以处在 V1 引擎中',
    'Runner 编号必须与引擎编号一致',
    'Model Runner 是把调度计划转换为设备输入的执行组件，其版本与引擎命名不同。',
  ],
  'model-loading': [
    '模型结构名称已注册，是否意味着权重已加载到设备？',
    '还要选择加载器、装载分片并做后处理',
    '注册会自动把全部权重复制到所有 GPU',
    '注册表负责定位实现；权重读取、切分与后处理是后续步骤。',
  ],
  'attention-backends': [
    '某 Attention kernel 支持 FP16，是否足够判定可以选用？',
    '还要核对 head size、缓存类型、平台等条件',
    '只需 dtype 匹配',
    '后端选择综合多项约束；某一种 dtype 受支持并不覆盖所有形状与功能。',
  ],
  mla: [
    'IndexCache 的 S 层主要复用什么？',
    '先前 F 层产生的稀疏索引',
    '把整个 Attention 输出直接复用',
    '索引复用节省索引选择开销，后续注意力计算仍需执行。',
  ],
  sampling: [
    '降低 temperature 会怎样影响这组非相等 logits？',
    '概率更集中于高分 token',
    '词表中的所有 token 会变得等概率',
    '除以更小的温度会放大分数差异；温度为 0 时走贪心分支。',
  ],
  logits: [
    '请求在 persistent batch 中换了位置，Logits Processor 应关注什么？',
    '同步请求状态与批次索引',
    '只记住初次进入时的索引即可',
    '处理器必须跟踪请求增删和位置变化，否则可能把约束应用到另一个请求。',
  ],
  beam: [
    'Beam Search 会永远保留所有生成分支吗？',
    '按评分和 beam 宽度剪枝，并处理停止条件',
    '候选指数增长也全部保留',
    'beam 宽度限制保留的分支数；它不同于彼此独立的多样本采样。',
  ],
  compile: [
    '编译缓存存在，是否任意形状都能命中？',
    '要满足形状范围、配置和运行路径等匹配条件',
    '文件存在就能给所有模型直接复用',
    '图捕获、编译范围与配置会影响缓存键和可执行路径。',
  ],
  cudagraph: [
    'CUDA Graph 回放减少的主要是什么？',
    '重复的 CPU 提交开销',
    '模型中全部 GPU kernel 的计算',
    '回放仍执行图内 kernel，形状和地址等条件决定是否可以复用图。',
  ],
  quantization: [
    'INT4 权重相比 FP16 位宽小 4 倍，模型总显存一定小 4 倍吗？',
    '还需计入 scales、激活与 KV 等',
    '总显存会严格按权重位宽同比缩小',
    '权重仅占总显存的一部分；量化还可能带来元数据和中间缓冲。',
  ],
  'kv-quant': [
    '权重已量化，是否代表 KV Cache 也自动使用同样精度？',
    'KV dtype 和尺度有单独的配置与支持要求',
    '权重位宽会自动决定所有缓存位宽',
    'KV 与权重是不同对象，后端支持及尺度策略需要分别检查。',
  ],
  'online-quant': [
    '加载时在线量化主要发生在哪个边界？',
    '读取权重后转换表示，激活处理依方案决定',
    '每生成一个 token 都重新下载并量化整个模型',
    '在线量化可在加载阶段转换浮点权重；激活量化则属于前向路径。',
  ],
  speculative: [
    '第 3 个草稿被拒绝，第 4 个草稿应怎样处理？',
    '丢弃，从校正分布恢复后重新提议',
    '保留第 4 个，只替换第 3 个',
    '后续草稿依赖被拒绝的前缀，不能直接当作已确认输出。',
  ],
  ngram: [
    'N-gram 草稿匹配到了历史文本，能直接输出给用户吗？',
    '仍需目标模型验证',
    '历史出现过就无需验证',
    'N-gram 只负责低成本提议，不改变目标分布的验证职责。',
  ],
  eagle: [
    'EAGLE 草稿结构可以随意匹配任意目标模型吗？',
    '需要相匹配的结构、训练和特征接口',
    '只要两个模型的名称不同即可',
    '草稿可能依赖特定目标隐藏状态、层和辅助权重，必须核对兼容性。',
  ],
  'parallel-draft': [
    '并行产生多个草稿位置，是否意味着这些位置已经被接受？',
    '仍需目标验证并处理首次拒绝',
    '并行提议直接等价于并行输出',
    '并行化的是提议过程；验证与提交的正确性要求仍然存在。',
  ],
  'dynamic-spec': [
    '为什么批次更大时可能选择更短的草稿 K？',
    '验证成本和可用计算预算会随批次变化',
    'K 越大在所有负载下都必然更快',
    '较长草稿增加验证量；收益还取决于接受率、批次和设备成本。',
  ],
  'adaptive-spec': [
    '自适应验证只需挑接受率最高的请求吗？',
    '还要考虑成本模型与总预算',
    '无需关注形状和验证成本',
    '自适应策略使用存活概率和形状成本分配验证预算，受支持边界限制。',
  ],
  'mlp-spec': [
    'MLP 草稿质量不好时会怎样？',
    '更多候选被拒绝，收益可能下降',
    '目标模型被迫接受错误候选',
    '验证仍约束最终输出；低接受率会浪费草稿和验证计算。',
  ],
  speculators: [
    '本地 vLLM 的隐藏状态提取是否包含 Speculators 全部训练过程？',
    '外部训练与导出还需对应项目',
    '采集到隐藏状态就已经训练完成',
    '数据提取、外部训练、模型导出和推理接入属于不同环节。',
  ],
  tp: [
    '行并行线性层的各卡局部乘法完成后，需要什么？',
    '将各卡部分和归并',
    '直接拼接输入 token 文本',
    '沿输入维拆分产生的是同一输出的部分和，通常需要求和通信。',
  ],
  pp: [
    '流水线填充后，不同 GPU 可以同时处理什么？',
    '不同独立 microbatch 的不同层段',
    '同一请求尚未生成的全部未来 token',
    '层段间存在先后依赖；本实验的并行来自多个独立 microbatch。',
  ],
  dp: [
    'DP 副本与 TP 分片最大的区别是什么？',
    'DP 副本可分别处理请求，TP 协作计算模型',
    'DP 把同一权重矩阵均匀切成碎片',
    'DP 复制模型执行能力；MoE DP 还可能需要全局协调。',
  ],
  cp: [
    '上下文并行合并 Attention 结果时，可以直接平均局部输出吗？',
    '需要考虑各片段的归一化信息',
    '无论各片段 logits 如何都平均即可',
    '局部 softmax 的归一化基准不同，合并需使用 log-sum-exp 等信息。',
  ],
  moe: [
    '同一 token 路由到两个专家后，如何得到最终结果？',
    '按路由权重组合专家输出',
    '随机保留其中一个专家输出',
    'Top-k 路由产生多条专家路径，combine 按权重聚合并恢复 token 顺序。',
  ],
  eplb: [
    '迁移专家权重后，为什么还需要更新映射？',
    '逻辑专家与物理位置的对应关系改变了',
    '迁移会改变所有输入文本的 token ID',
    '路由使用逻辑专家身份，执行需要正确的物理布局；切换必须协调。',
  ],
  dbo: [
    '通信和计算重叠是否可以忽略依赖同步？',
    '只能重叠互不依赖的部分，并在消费前同步',
    '开启 DBO 后所有同步都可移除',
    '双批次重叠使用 microbatch 与流事件协调，通信结果就绪后才能消费。',
  ],
  elastic: [
    '增减 EP 规模能否只修改一个 GPU 数量参数就结束？',
    '还需迁移专家并协调拓扑切换',
    '现有请求会自动猜出新的专家位置',
    '规模变化影响通信组、专家布局和在途工作，需要受控准备与提交。',
  ],
  structured: [
    'JSON Schema 合法，是否能保证字段内容符合事实？',
    '只能约束结构与允许的值域',
    '合法 JSON 就保证内容真实',
    '语法约束限制 token 选择，无法替代事实核查。',
  ],
  lora: [
    '同一批次中不同 LoRA 请求能否共享基础权重？',
    '可以，按请求应用各自适配器',
    '每个请求必须复制一整套基础模型',
    'LoRA 使用低秩增量与请求映射，仍受 rank、并发数和后端能力限制。',
  ],
  multimodal: [
    '图像编码结果如何进入语言模型输入？',
    '与模型规定的媒体占位位置对应',
    '随意追加一个固定 token 就能适配所有模型',
    'processor、媒体编码器与占位布局必须一致，具体数量与位置由模型决定。',
  ],
  'prompt-embeds': [
    '直接传入 prompt embeddings 后，哪些步骤仍然需要？',
    '位置处理与模型前向',
    '所有 Attention 与 KV 计算都可跳过',
    '绕过文本 token 查表不等于已经完成模型各层计算。',
  ],
  speech: [
    '收到新的音频片段后，为什么要更新请求状态？',
    '流式输入持续扩展，模型和输出协议需要协调',
    '每片音频都完全不需要此前上下文',
    '流式请求会随输入变化，增量输出必须与对应上下文一致。',
  ],
  tools: [
    '模型生成了 tool call，工具是否已经执行？',
    '应用接到调用描述后再执行相应工具',
    '生成 JSON 就会自动操作外部系统',
    '工具描述生成与应用执行属于不同边界。',
  ],
  thinking: [
    '思考预算只需要在最终文本上截断字符吗？',
    '需跟踪推理阶段与 token 协议',
    '截断最后几个字符即可保证合法结束',
    '预算控制在采样时跟踪标记与阶段，避免破坏模型的推理结束协议。',
  ],
  pooling: [
    'Embedding 任务一定需要逐 token 自回归生成答案吗？',
    '通常前向后按任务汇聚或评分',
    '必须先生成一段长文本才能得到向量',
    'pooling 可从隐藏状态取 CLS、最后位置或均值等，具体由模型任务决定。',
  ],
  'long-context': [
    '扩大 max_model_len 后，模型长文本质量是否自然有保证？',
    '还需位置编码配置、显存和质量验证',
    '配置能启动就代表任意长度都准确',
    '长度声明不会自动训练模型的新能力；还要核对 RoPE 与模型支持。',
  ],
  diffusion: [
    '离散扩散语言模型与普通自回归有何不同？',
    '可能迭代更新多个待定位置',
    '必然与标准 decode 一样每轮只追加一个位置',
    '专用配置、状态与采样器管理迭代更新，不能套用所有自回归假设。',
  ],
  disagg: [
    'Decode 侧收到 KV 传输请求后能立即读取吗？',
    '需要对应块与完成状态都就绪',
    '开始传输就等价于数据已完整可用',
    '传输计划、设备搬运和完成通知必须协调，避免读取未就绪数据。',
  ],
  offload: [
    '把 KV 卸载到 CPU 后，再次使用时一定没有代价吗？',
    '命中仍可能需要加载和传输等待',
    '命中意味着所有 GPU 访问都零开销',
    '缓存层级节省设备容量，但涉及传输、映射和异步完成依赖。',
  ],
  'encoder-disagg': [
    '独立 Encoder 输出交给语言模型侧时，需要保证什么？',
    '媒体标识、占位对应与数据就绪一致',
    '只要字节数量相同就可以混用',
    'EC 连接器协调编码结果归属及完成状态，避免不同媒体输入串用。',
  ],
  serving: [
    '流式响应中的一个事件是否一定对应一个完整汉字？',
    '不一定，token、反分词增量与协议事件不同',
    '每个事件固定是一个汉字',
    'token 与字符并非一一对应；协议还可能包含工具、推理和结束事件。',
  ],
  sleep: [
    '深度休眠丢弃权重后，唤醒内存是否就能直接回答？',
    '还需要恢复正确权重和相关状态',
    '只重新申请显存即可恢复模型内容',
    '分配内存与恢复权重是不同操作；清理缓存和版本状态后才能恢复服务。',
  ],
  metrics: [
    'TTFT 是否只测 GPU 的 prefill 时间？',
    '还可能包含排队、预处理与传输等',
    '等于单个 GPU kernel 的耗时',
    '首 token 延迟从请求生命周期观察，必须核对指标起止点。',
  ],
  invariance: [
    '固定随机种子是否总能消除批次改变带来的数值差异？',
    '还需控制计算路径与归约等条件',
    '固定种子就能保证所有硬件逐 bit 相同',
    '浮点运算顺序和 kernel 选择也会影响结果，批次不变性有支持边界。',
  ],
  fault: [
    'Worker 失败后只重试同一调用是否总是安全？',
    '需传播失败、清理状态并按策略恢复',
    '内存和通信状态一定自动保持正确',
    '故障可能破坏设备、通信和请求状态，恢复流程必须协调这些资源。',
  ],
  platform: [
    'CUDA 后端可运行的特性是否必然在其他平台同样可用？',
    '需要平台能力与算子实现验证',
    '统一 API 就保证实现完全相同',
    '统一接口下仍有不同 kernel、dtype 与特性支持范围。',
  ],
  plugins: [
    '加载外部插件后，哪里能找到它的全部实现？',
    '可能需要跳转插件自己的项目',
    '本地 vLLM 必定包含外部库全部源码',
    '本仓库展示注册与调用接口，外部实现由插件分发。',
  ],
  connectors: [
    'Scheduler 的 connector 元数据能替代 Worker 搬运吗？',
    '元数据描述计划，设备侧仍需执行传输',
    '写入元数据就已经把 KV 移到目标 GPU',
    '计划和执行位于不同层，完成通知连接资源生命周期。',
  ],
  rust: [
    'Rust 前端能否在不运行推理引擎时完成真实模型生成？',
    '需要引擎提供模型推理，纯 renderer 只负责渲染',
    '只要协议转换成功就已完成模型计算',
    '请求渲染、协议序列化与模型执行是不同职责。',
  ],
  compatibility: [
    '文档列出了两个特性，是否代表它们能任意组合？',
    '还需核对组合矩阵、配置校验和平台分支',
    '分别存在就保证组合可用',
    '特性之间可能共享资源或存在执行路径冲突，需要针对组合验证。',
  ],
};

export function bindQuizzes(lessons) {
  lessons.forEach((lesson, index) => {
    const row = bank[lesson.id];
    if (!row) throw Error(`Missing scenario question: ${lesson.id}`);
    const [question, correct, wrong, reason] = row,
      answer = index % 2;
    Object.assign(lesson, {
      question,
      choices: answer ? [wrong, correct] : [correct, wrong],
      answer,
      reason,
      misconception: `${wrong}：这个判断忽略了机制约束。${reason}`,
    });
  });
}

export const learningPaths = [
  {
    title: '建立推理主线',
    description: '从请求到生成，弄清 token、调度和 KV。',
    ids: ['lifecycle', 'prefill', 'scheduler', 'paged', 'prefix', 'sampling'],
  },
  {
    title: '推演优化机制',
    description: '预测结果，调整参数，再解释计算和通信变化。',
    ids: ['chunked', 'preemption', 'speculative', 'structured', 'tp', 'pp', 'moe'],
  },
  {
    title: '带着状态读源码',
    description: '把实验现象连接到配置、Runner、异步和后端分支。',
    ids: ['configuration', 'runner', 'async', 'attention-backends', 'compile', 'compatibility'],
  },
];
export const prerequisites = {
  prefix: ['paged', 'prefill'],
  scheduler: ['prefill'],
  chunked: ['scheduler'],
  preemption: ['scheduler', 'paged'],
  speculative: ['sampling', 'prefill'],
  tp: ['runner'],
  pp: ['runner'],
  moe: ['tp'],
  structured: ['sampling'],
  async: ['scheduler', 'runner'],
};

export function challengeFor(lesson, options, frames) {
  if (lesson.kind === 'scheduler') {
    const total = frames.flatMap((f) => f.allocations).reduce((n, a) => n + a.recompute, 0);
    return {
      question: '预测：这组请求整个推演中，会重算多少个历史 KV 位置？',
      answer: total,
      explanation: `时间线中所有 R 相加为 ${total}。P 和 D 是新计算位置，不计入重算。`,
      step: frames.findIndex((f) => f.allocations.some((a) => a.recompute)),
    };
  }
  if (lesson.id === 'prefix')
    return {
      question: '预测：按当前前缀长度与开关，B 会命中多少个 token？',
      answer: frames.at(-1).result.hit,
      explanation:
        '按完整块复用；12-token prompt 至少保留尾部以获取 logits，不同 salt 会隔离缓存。',
      step: 2,
    };
  if (lesson.id === 'paged')
    return {
      question: 'token 6 的物理槽位编号是多少？（块表 [2,5,1]，block size=4）',
      answer: 22,
      explanation: '逻辑块 floor(6/4)=1，对应物理块 5；5×4 + 6 mod 4 = 22。',
      step: 3,
    };
  if (lesson.id === 'speculative')
    return {
      question: '根据当前 p/q 与随机种子，本轮最终会提交多少个 token？',
      answer: frames.at(-1).committed.length,
      explanation: '连续接受数加 1：首次拒绝时加恢复 token，全部接受时加 bonus。',
      step: 2,
    };
  if (lesson.id === 'structured')
    return {
      question: '前缀 {"name": 之后，示例词表有多少个合法的下一词法单元？',
      answer: 2,
      explanation: '示例词表中的两个字符串值合法；42、对象括号等不符合该状态。',
      step: 4,
    };
  if (lesson.id === 'tp')
    return {
      question: '将所有 rank 的局部结果求和，第一个输出分量是多少？',
      answer: frames.at(-1).output[0],
      explanation: '同一输出位置的部分和做 All-reduce SUM，结果与未切分矩阵乘法一致。',
      step: 1,
    };
  if (lesson.id === 'pp')
    return {
      question: '在各段等时的假设下，这组 microbatch 需要多少个流水线时隙完成？',
      answer: frames.length,
      explanation: `段数 + microbatch 数 − 1 = ${options.ranks} + ${options.microbatches} − 1。`,
      step: frames.length - 1,
    };
  if (lesson.id === 'moe')
    return {
      question: 'T0 的两个专家输出加权后是多少？保留 3 位小数。',
      answer: Number(frames.at(-1).tokens[0].output.toFixed(3)),
      explanation: '先将选中专家的路由权重归一化，再乘各专家输出并求和。',
      step: 3,
    };
  return null;
}
