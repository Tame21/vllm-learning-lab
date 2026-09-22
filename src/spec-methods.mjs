// Teaching paths reviewed against the local source snapshot. These are mechanism
// storyboards, not model inference or claims about hardware speedup.
const base = 'vllm/v1/spec_decode/';
const gpu = 'vllm/v1/worker/gpu/spec_decode/';
const config = 'vllm/config/speculative.py';
const reject = 'vllm/v1/sample/rejection_sampler.py';
const ar = gpu + 'autoregressive/speculator.py';
const llm = base + 'llm_base_proposer.py';
const stage = (title, body, change, path, symbol, needle) => ({
  title,
  body,
  change,
  source: { path, symbol, ...(needle ? { needle } : {}), observe: change },
});
const verify = () =>
  stage(
    '交给目标模型验证',
    '候选还不是最终输出。目标模型计算验证分布，接受连续前缀；首次拒绝后的候选不直接提交。具体验证分支取决于采样模式和草稿分布接口。',
    'draft tokens → target verification → accepted prefix',
    reject,
    'RejectionSampler.forward',
  );
const quiz = (question, correct, wrong, reason) => ({
  question,
  choices: [correct, wrong],
  answer: 0,
  reason,
  misconception: `${wrong}：${reason}`,
});

export const specFamilies = [
  {
    id: 'lookup',
    label: '查历史',
    description: '不用额外草稿权重，从已有 token 中找可复用的后续片段。',
  },
  {
    id: 'autoregressive',
    label: '逐步起草',
    description: '区分独立小模型、目标隐藏状态与模型自带的 MTP 模块。',
  },
  {
    id: 'heads',
    label: '轻量预测头',
    description: '比较顺序 MLP 级联和共享隐藏状态上的多个预测头。',
  },
  {
    id: 'parallel',
    label: '并行起草',
    description: '并行计算多个位置；是否仍有顺序采样，是方法之间的重要区别。',
  },
];

export const specMethods = [
  {
    id: 'ngram',
    name: 'N-gram',
    title: 'N-gram：从历史复制草稿',
    family: 'lookup',
    method: 'ngram',
    summary: '拿当前结尾的一段 token，在本请求历史中找匹配，再复制匹配位置之后的 token。',
    analogy: '发现前面写过同样的句子开头，就拿后半句作草稿，请主编检查。',
    input: '本请求的 token 历史',
    weights: '无额外草稿权重',
    proposal: 'CPU 上匹配并复制',
    useful: '理解重复文本如何变成候选；匹配不到时可以没有草稿。',
    boundary: '当前路径是 MRV1 的 CPU / Numba proposer。复制到的 token 仍可能被目标模型拒绝。',
    config: {
      method: 'ngram',
      num_speculative_tokens: 2,
      prompt_lookup_min: 2,
      prompt_lookup_max: 4,
    },
    steps: [
      stage(
        '取出当前后缀',
        '读取已生成的 token 历史，在配置的最小与最大 n 范围内选择待匹配后缀。这里匹配的是 token ID，不是按汉字搜索字符串。',
        'history = [A B C D … A B]；suffix = [A B]',
        base + 'ngram_proposer.py',
        'NgramProposer.propose',
      ),
      stage(
        '查找历史匹配',
        '在当前请求已有序列中查找后缀先前出现的位置，优先选择可匹配的长 n-gram。示意中前面的 A B 对上了当前后缀。',
        '[A B] C D … [A B] → 找到历史位置',
        base + 'ngram_proposer.py',
        '_find_longest_matched_ngram_and_propose_tokens',
      ),
      stage(
        '复制后续片段',
        '从匹配位置后面提取至多 K 个候选。没有匹配、剩余长度或模型长度不满足时，候选会变短或为空。',
        '历史后续 [C D] → 草稿 [C D]',
        base + 'ngram_proposer.py',
        'NgramProposer.batch_propose',
      ),
      verify(),
    ],
  },
  {
    id: 'ngram-gpu',
    name: 'N-gram GPU',
    title: 'N-gram GPU：在设备上查历史',
    family: 'lookup',
    method: 'ngram_gpu',
    summary: '保留 N-gram 的查找思路，把历史维护、批量匹配与有效候选计数放到 GPU 张量路径。',
    analogy: '查找规则类似，但把多份历史放到同一张工作台上批量检查。',
    input: 'GPU 上的批量 token 张量',
    weights: '无额外草稿权重',
    proposal: 'GPU 匹配 + 有效长度',
    useful: '对照 CPU 版本，理解数据搬运、padding 和有效长度的区别。',
    boundary: 'GPU 不代表一定更快。当前配置明确将 ngram / ngram_gpu 排除在 MRV2 支持列表之外。',
    config: {
      method: 'ngram_gpu',
      num_speculative_tokens: 3,
      prompt_lookup_min: 2,
      prompt_lookup_max: 4,
    },
    steps: [
      stage(
        '在设备上更新历史',
        '将本轮有效输出写入 GPU 历史张量，忽略丢弃请求与无效位置，计算各请求的临时长度。',
        'token_ids_gpu + valid sampled tokens',
        base + 'ngram_proposer_gpu.py',
        'NgramProposerGPU.propose',
      ),
      stage(
        '批量匹配多个 n',
        '每种 n 查找最早的有效历史匹配，再从有匹配的 n 中选最长者。请求之间可能匹配到不同的 n。',
        'request × history × n → longest valid match',
        base + 'ngram_proposer_gpu.py',
        'NgramGPUKernel._find_first_and_extract_all_n_parallel',
      ),
      stage(
        '携带有效长度返回',
        '无匹配或越界位置使用 -1。proposer 同时返回候选张量和每请求的有效候选数，下游不能把 padding 当成真实草稿。',
        'A: [C D A], valid=3；B: [-1 -1 -1], valid=0',
        base + 'ngram_proposer_gpu.py',
        'NgramProposerGPU.propose',
      ),
      verify(),
    ],
    ...quiz(
      'GPU 草稿张量中的 -1 能作为真实候选送去提交吗？',
      '不能，必须结合有效候选数处理',
      '能，张量形状固定就都是有效 token',
      'padding 只维持形状；num_valid_draft_tokens 才描述本请求有效候选长度。',
    ),
  },
  {
    id: 'suffix',
    name: 'Suffix',
    title: 'Suffix：按频次选择历史续写',
    family: 'lookup',
    method: 'suffix',
    summary: '用后缀树缓存历史续写，依据频次与概率门限提出长度可变的候选。',
    analogy: '翻阅过往草稿的索引，选择更常出现的续写；把握不大就少写一点。',
    input: 'prompt、当前响应与缓存的历史生成',
    weights: '无额外草稿权重',
    proposal: '后缀树查找，长度可变',
    useful: '比较“复制一处匹配”与“根据历史续写频次提议”的差别。',
    boundary: '需要 Arctic Inference；树的具体实现位于该外部库。K 是候选上限，缓存范围受配置控制。',
    config: { method: 'suffix', num_speculative_tokens: 16 },
    steps: [
      stage(
        '建立后缀缓存',
        'vLLM 创建 SuffixDecodingCache，设置树深度、缓存数量和概率门限；本地文件负责接入外部库。',
        'prompt / cached responses → suffix cache',
        base + 'suffix_decoding.py',
        'SuffixDecodingProposer.__init__',
      ),
      stage(
        '更新本请求的响应',
        '首次进入时加入 prompt，随后把新输出加入 active response，再取最近一段后缀作为查询模式。',
        '新增输出 → active response；末尾 token → pattern',
        base + 'suffix_decoding.py',
        'SuffixDecodingProposer.propose',
        'add_active_response',
      ),
      stage(
        '按频次提议续写',
        '向缓存调用 speculate，由其选择续写。最小概率、最大推测比例和 K 上限共同限制长度，因而不同请求可返回不同数量的候选。',
        'pattern → 频次 / 门限 → 0…K 个候选',
        base + 'suffix_decoding.py',
        'SuffixDecodingProposer.propose',
        'self.suffix_cache.speculate',
      ),
      verify(),
    ],
    ...quiz(
      'Suffix 中 K=16，是否每次都必须验证 16 个草稿？',
      '不必，16 是候选上限',
      '必须，K 固定了每轮实际长度',
      '后缀匹配和概率等门限会产生长度可变的草稿。',
    ),
  },
  {
    id: 'draft-model',
    name: 'Draft Model',
    title: 'Draft Model：独立小模型逐词起草',
    family: 'autoregressive',
    method: 'draft_model',
    summary: '独立草稿模型读 token，上一个候选进入下一次草稿前向；目标模型负责最终验证。',
    analogy: '助理独立读稿，逐词续写；主编集中检查这小段草稿。',
    input: '上下文 token 与草稿模型自己的 KV',
    weights: '独立草稿模型',
    proposal: '默认逐 token 自回归',
    useful: '先理解双模型开销，再理解为什么接受率高也不一定有净收益。',
    boundary:
      '默认需兼容词表；异构词表 TLI 是额外配置。当前 MRV1 校验要求 draft TP 与 target TP 一致。',
    config: {
      method: 'draft_model',
      model: 'MATCHING_DRAFT_CHECKPOINT',
      num_speculative_tokens: 3,
    },
    steps: [
      stage(
        '加载独立草稿模型',
        '使用独立的模型配置、embedding 和输出头。普通 Draft Model proposer 不把目标隐藏状态作为草稿输入。',
        'target model + independent draft model',
        base + 'draft_model.py',
        'DraftModelProposer.__init__',
      ),
      stage(
        '生成第一个候选',
        '根据当前 token 与草稿 KV 做前向，产生下一位置的草稿 token；图中只展示候选链，不执行真实模型。',
        'context → draft forward → d₁',
        llm,
        'SpecDecodeBaseProposer.propose',
      ),
      stage(
        '递归生成后续候选',
        '默认路径把前一个草稿 token 和更新后的状态用于下一步，重复直到得到 K 个候选。这与开启 parallel_drafting 的分支不同。',
        'd₁ → next forward → d₂ → next forward → d₃',
        llm,
        'SpecDecodeBaseProposer.propose',
      ),
      verify(),
    ],
    ...quiz(
      '普通 Draft Model 的第二个候选通常依赖什么？',
      '前一个草稿 token 及更新后的草稿状态',
      '只把同一组 logits 重复三次',
      '默认自回归草稿逐步更新输入与状态；并行草稿需要另外的结构与配置。',
    ),
  },
  {
    id: 'eagle',
    name: 'EAGLE',
    title: 'EAGLE：借助目标隐藏状态起草',
    family: 'autoregressive',
    method: 'eagle',
    summary: '草稿网络利用目标模型的隐藏特征与 token 输入，继续预测后续候选。',
    analogy: '助理拿到主编的思考笔记，再根据刚确认的词继续写。',
    input: '目标隐藏状态 + token',
    weights: '匹配目标模型的 EAGLE 权重',
    proposal: '特征辅助的逐步提议',
    useful: '与独立 Draft Model 对照：目标特征如何减少草稿需要重新学习的工作。',
    boundary: '特征维度、模型结构、训练权重必须匹配。本专题展示 MRV1 的 EAGLE 路径。',
    config: { method: 'eagle', model: 'MATCHING_EAGLE_CHECKPOINT', num_speculative_tokens: 3 },
    steps: [
      stage(
        '接入目标隐藏特征',
        'EagleProposer 启用 pass_hidden_states_to_model，目标特征因此成为草稿网络的输入之一。',
        'target hidden states → proposer',
        base + 'eagle.py',
        'EagleProposer.__init__',
      ),
      stage(
        '对齐特征、token 与位置',
        '整理已确认的 token、位置与隐藏状态，准备第一轮草稿输入。它们必须描述相互对应的上下文。',
        '(token, position, hidden) → draft inputs',
        llm,
        'SpecDecodeBaseProposer.set_inputs_first_pass',
      ),
      stage(
        '递推草稿状态',
        '草稿模型前向后采样候选，并用返回的隐藏状态继续后续草稿步骤。此处展示线性候选路径。',
        '(hₜ, token) → d₁ → d₂ → d₃',
        llm,
        'SpecDecodeBaseProposer.propose',
      ),
      verify(),
    ],
  },
  {
    id: 'eagle3',
    name: 'EAGLE3',
    title: 'EAGLE3：融合目标的多层特征',
    family: 'autoregressive',
    method: 'eagle3',
    summary: '在常见 EAGLE3 路径中采集多层辅助隐藏状态，融合后交给草稿模型。',
    analogy: '除了最后结论，助理还参考主编在不同思考阶段留下的笔记。',
    input: '多层辅助隐藏状态（典型配置）',
    weights: '匹配目标模型的 EAGLE3 权重',
    proposal: '先融合特征，再逐步提议',
    useful: '和 EAGLE 对照输入接口，而不是把两者只理解成模型大小不同。',
    boundary:
      '某些 checkpoint 设置 use_aux_hidden_state=false，不能一概认定都采集多层特征。展示 MRV2 主路径，变体开关可读 MRV1 源码。',
    config: { method: 'eagle3', model: 'MATCHING_EAGLE3_CHECKPOINT', num_speculative_tokens: 3 },
    steps: [
      stage(
        '核对特征采集配置',
        '常见 checkpoint 使用辅助隐藏状态；本地代码也允许 use_aux_hidden_state=false 的变体。先核对配置再决定观察哪些层。',
        'checkpoint → use_aux_hidden_state',
        llm,
        'SpecDecodeBaseProposer._get_eagle3_use_aux_hidden_state_from_config',
      ),
      stage(
        '拼接与融合多层特征',
        'MRV2 收到 aux_hidden_states 时先拼接，再调用 combine_hidden_states。没有辅助输出时走 last_hidden_states 分支。',
        '[h低, h中, h高] → concat → combine_hidden_states',
        ar,
        'AutoRegressiveSpeculator.propose',
      ),
      stage(
        '执行多步草稿解码',
        '融合后的特征参与初始草稿前向，随后在草稿网络中迭代生成候选。多层输入不等于多个最终输出已经被接受。',
        'fused h + tokens → draft d₁ → d₂ → d₃',
        ar,
        'AutoRegressiveSpeculator._multi_step_decode',
      ),
      stage(
        '交给目标模型验证',
        '把候选交回目标模型的验证与采样路径，统计接受与拒绝，下一轮按真实输出继续更新状态。MRV2 使用自己的 rejection sample 入口。',
        'draft tokens → target → accepted prefix',
        gpu + 'rejection_sampler.py',
        'RejectionSampler.__call__',
      ),
    ],
    ...quiz(
      '所有 EAGLE3 checkpoint 都强制使用多层辅助特征吗？',
      '不是，需要检查 checkpoint 的特征配置',
      '是，方法名足以确定全部特征接口',
      '本地代码包含关闭 auxiliary hidden states 的配置分支。',
    ),
  },
  {
    id: 'mtp',
    name: 'MTP',
    title: 'MTP：使用模型的多 Token 预测模块',
    family: 'autoregressive',
    method: 'mtp',
    summary: '使用模型家族训练好的 MTP 模块或匹配的 assistant checkpoint 来生成草稿。',
    analogy: '模型自带一个练过“往后多想几步”的助手，但仍要逐个核对猜测。',
    input: '目标特征 + token，依模型结构',
    weights: '原生 MTP 模块或匹配助手权重',
    proposal: '模块递推，具体实现因模型而异',
    useful: '理解“多 token 预测训练”如何接入投机推理，以及模型专属实现的边界。',
    boundary:
      '不能给任意模型加 method=mtp 就获得能力；Gemma4、多模块 MTP 等有专门分支。本图展示通用 MRV2 MTP 路径。',
    target: 'MTP_CAPABLE_TARGET',
    config: { method: 'mtp', num_speculative_tokens: 3 },
    steps: [
      stage(
        '选择模型对应的 MTP 路径',
        'init_speculator 按模型配置选择 Gemma4、多模块或通用 MTPSpeculator，不能把不同模型的辅助模块随意互换。',
        'model architecture → matching MTP speculator',
        gpu + '__init__.py',
        'init_speculator',
      ),
      stage(
        '加载预测模块',
        '通用 MTPSpeculator 加载与目标相匹配的草稿模块，并读取模型相关的共享配置。是否共享层、权重或 KV 要看具体模型。',
        'matching MTP weights + target interface',
        gpu + 'mtp/speculator.py',
        'MTPSpeculator.load_draft_model',
      ),
      stage(
        '迭代产生候选',
        '通用路径继承自回归 speculator，多步更新草稿输入。多模块变体会选择相应预测层；不要把 MTP 直接等同于并行的多输出头。',
        'MTP step 1 → step 2 → step 3',
        ar,
        'AutoRegressiveSpeculator._multi_step_decode',
      ),
      stage(
        '验证后继续下一轮',
        '候选经目标模型的验证路径处理，只有接受的连续前缀和相应恢复 / bonus token 进入确认输出。',
        'MTP candidates → target verification',
        gpu + 'rejection_sampler.py',
        'RejectionSampler.__call__',
      ),
    ],
    ...quiz(
      '任意目标模型都能仅靠 method=mtp 生成 MTP 草稿吗？',
      '不能，需要匹配的训练权重和模型实现',
      '能，这个参数会自动训练出预测模块',
      '该配置选择已有实现，不会为普通模型训练新的 MTP 能力。',
    ),
  },
  {
    id: 'mlp-spec',
    name: 'MLP Speculator',
    title: 'MLP Speculator：轻量级联预测',
    family: 'heads',
    method: 'mlp_speculator',
    status: 'reference',
    summary: '按文档理解“上下文向量 + 已采样 token”的 MLP 级联；当前快照仅作机制参考。',
    analogy: '把思考摘要和上一个词交给一个小预测器，再把结果交给下一个。',
    input: '上下文向量 + 已采样 token',
    weights: '匹配目标的 MLP 草稿权重',
    proposal: '轻量 MLP 级联（文档机制）',
    useful: '和 Medusa 对照：前一位置的 token 是否参与下一阶段预测。',
    boundary:
      '当前快照模型注册项被注释，MRV1 无 mlp_speculator 分发分支，MRV2 也不接受它。文档存在不等于当前可运行。',
    steps: [
      {
        title: '理解级联输入',
        body: '文档描述每一阶段同时使用上下文向量和已采样 token。该图用于解释机制，不代表当前快照能执行 MLP 推理。',
        change: 'context vector + sampled token → stage 1',
        source: {
          path: 'docs/features/speculative_decoding/mlp.md',
          heading: '# MLP Draft Models',
          observe: '文档中的机制描述',
        },
      },
      stage(
        '观察轻量模块结构',
        '本地保留的模型类定义 embedding、projection、归一化和多个输出 head。结构片段有助于理解轻量级联，但不构成完整运行接入。',
        'projection(state) + embedding(token) → next state',
        'vllm/model_executor/models/mlp_speculator.py',
        'MLPSpeculator.__init__',
      ),
      stage(
        '检查模型注册状态',
        '注册表里的 MLPSpeculatorPreTrainedModel 条目已被注释；先检查实现与注册，不能把旧文档命令当作已验证的启动方式。',
        '模型类片段存在；注册项未启用',
        'vllm/model_executor/models/registry.py',
        '_SPECULATIVE_DECODING_MODELS',
        'MLPSpeculatorPreTrainedModel',
      ),
      stage(
        '检查 Runner 接入边界',
        '当前 MRV1 的 proposer 选择没有 MLP 分支，未知方法会报错。这也说明为什么本专题不提供可运行命令模板。',
        'mlp_speculator → no MRV1 dispatch branch',
        'vllm/v1/worker/gpu_model_runner.py',
        'GPUModelRunner.__init__',
        'Unknown speculative decoding method',
      ),
    ],
  },
  {
    id: 'medusa',
    name: 'Medusa',
    title: 'Medusa：同一隐藏状态上的多个预测头',
    family: 'heads',
    method: 'medusa',
    summary: '本地 Medusa proposer 把目标隐藏状态送入多个预测头，每个头生成一个位置的候选。',
    analogy: '多个助手同时看同一份摘要，分别猜后面第 1、2、3 个词。',
    input: '同一目标隐藏状态',
    weights: '匹配目标的 Medusa heads',
    proposal: '多头预测后堆叠候选',
    useful: '与 MLP 级联对照：共享输入的多头和依赖前一候选的多阶段不是同一结构。',
    boundary:
      '本地 proposer 逐头 argmax 后 stack 为候选序列；不要把论文中的完整树搜索流程套到这段实现上。MRV1 路径。',
    config: { method: 'medusa', model: 'MATCHING_MEDUSA_CHECKPOINT', num_speculative_tokens: 3 },
    steps: [
      stage(
        '加载匹配的预测头',
        'MedusaProposer 加载草稿模型头，其隐藏维度和词表等需要与目标模型匹配。',
        'target model + Medusa heads',
        base + 'medusa.py',
        'MedusaProposer.load_model',
      ),
      stage(
        '向多个头分发隐藏状态',
        '把同一个目标 hidden state 输入 Medusa 模型，再计算每个头的 logits。',
        'h → [head₁, head₂, head₃]',
        base + 'medusa.py',
        'MedusaProposer.propose',
      ),
      stage(
        '逐头选词并堆叠',
        '当前实现对每个头的 logits 取 argmax，再沿候选维堆叠。这里画线性候选序列，不画未在此处实现的候选树。',
        'argmax(headᵢ) → stack → [d₁ d₂ d₃]',
        base + 'medusa.py',
        'MedusaProposer.propose',
      ),
      verify(),
    ],
    ...quiz(
      '本地 MedusaProposer.propose 返回什么？',
      '逐头 argmax 后堆叠的候选序列',
      '自动遍历所有候选的完整搜索树',
      '这段实现直接 stack 各头候选；学习时要区分论文机制与当前代码路径。',
    ),
  },
  {
    id: 'parallel-draft',
    name: 'PARD',
    title: 'PARD：一次前向提议多个位置',
    family: 'parallel',
    method: 'draft_model',
    summary: '使用专门训练的并行草稿模型，在一次草稿前向中预测多个位置。',
    analogy: '助理一次填好一排空格，主编再检查整排候选。',
    input: '上下文 + 并行草稿占位位置',
    weights: '专门训练的 PARD checkpoint',
    proposal: '一次草稿前向，多位置预测',
    useful: '对照普通 Draft Model：减少串行草稿前向，但仍需目标验证。',
    boundary:
      'PARD 的配置是 method=draft_model 加 parallel_drafting=true。普通小模型不会因打开开关就变成 PARD；当前是 MRV1 路径。',
    config: {
      method: 'draft_model',
      model: 'MATCHING_PARD_CHECKPOINT',
      parallel_drafting: true,
      num_speculative_tokens: 3,
    },
    steps: [
      stage(
        '读取并行草稿标记',
        '匹配的 checkpoint 定义并行输入标记，例如 pard_token。proposer 根据模型配置读取这些标记。',
        'parallel_drafting=true + trained checkpoint',
        llm,
        'SpecDecodeBaseProposer._init_parallel_drafting_params',
      ),
      stage(
        '准备多个候选位置',
        '在第一轮输入中准备并行草稿位置与相关元数据，把多个待预测位置一起送入草稿模型。',
        'context + [slot₁ slot₂ slot₃]',
        llm,
        'SpecDecodeBaseProposer.set_inputs_first_pass',
      ),
      stage(
        '一次前向输出多个候选',
        'parallel_drafting 分支在第一轮前向后直接采样并 reshape 为请求 × K，不进入普通逐 token 草稿循环。',
        'one forward → [d₁ d₂ d₃]',
        llm,
        'SpecDecodeBaseProposer.propose',
        'if self.num_speculative_tokens == 1 or self.parallel_drafting',
      ),
      verify(),
    ],
  },
  {
    id: 'dflash',
    name: 'DFlash',
    title: 'DFlash：上下文 KV 与并行 Mask 块',
    family: 'parallel',
    method: 'dflash',
    summary: '先为目标特征准备上下文 KV，再用 anchor 和 mask 组成查询块，并行预测候选。',
    analogy: '先准备好参考资料，再同时补齐多个空白位置。',
    input: '目标特征、上下文 KV、anchor + masks',
    weights: '匹配的 DFlash 权重',
    proposal: '查询块并行前向与采样',
    useful: '看清 anchor 与候选位置的区别，为理解 DSpark 建立参照。',
    boundary:
      '图中是 MRV2 的普通 DFlash：1 个 anchor + K 个 mask。DFlash2 有独立候选选择器；注意力与 KV 组随 checkpoint 而异。',
    config: { method: 'dflash', model: 'MATCHING_DFLASH_CHECKPOINT', num_speculative_tokens: 3 },
    steps: [
      stage(
        '准备上下文 KV',
        '草稿侧使用目标特征准备上下文缓存，再为各请求组织待预测的查询块，避免把所有历史都画成 mask 位置。',
        'target features → context KV',
        gpu + 'dflash/speculator.py',
        'DFlashSpeculator.propose',
      ),
      stage(
        '构造 anchor 与 mask 块',
        '普通 DFlash 每请求有 1+K 个查询 token：anchor 加 K 个 mask。mask 位于其将要预测的位置，anchor 本身不计入这 K 个候选。',
        '[anchor | mask₁ mask₂ mask₃]',
        gpu + 'dflash/speculator.py',
        'prepare_dflash_inputs',
      ),
      stage(
        '并行填充候选',
        '一次查询块前向获得各位置隐藏状态，在 mask 位置采样得到候选。没有 DSpark 那个依赖前一候选的 Markov 采样链。',
        '[mask₁ mask₂ mask₃] → [d₁ d₂ d₃]',
        gpu + 'dflash/speculator.py',
        'DFlashSpeculator._generate_draft',
      ),
      stage(
        '目标模型验证',
        '并行得到的候选仍进入目标模型的验证路径，只有连续接受的前缀才能继续提交。',
        'parallel draft → target verification',
        gpu + 'rejection_sampler.py',
        'RejectionSampler.__call__',
      ),
    ],
    ...quiz(
      '普通 DFlash 设置 K=3，anchor + mask 查询块有多少位置？',
      '4 个：1 个 anchor 加 3 个 mask',
      '3 个：anchor 本身就是第一个草稿',
      '这是普通 DFlash 的 1+K 布局；DSpark 默认 anchor-as-first 则不同。',
    ),
  },
  {
    id: 'dspark',
    name: 'DSpark',
    title: 'DSpark：并行骨干与顺序 Markov 头',
    family: 'parallel',
    method: 'dspark',
    summary: '骨干网络并行计算整个块，轻量 Markov 头再从左到右注入候选之间的依赖。',
    analogy: '先同时列出每个位置的备选，再根据前一个定下来的词逐个修正。',
    input: '目标特征 + 查询块 + 前一候选',
    weights: '匹配的 DSpark 权重',
    proposal: '并行骨干 + 顺序 Markov 采样',
    useful: '理解半自回归：主要计算可以并行，采样仍能保留块内顺序依赖。',
    boundary:
      '当前仅 MRV2。默认 K 个 query=anchor+(K−1) noise；Speculators 格式可用 1+K 布局。自适应验证另需 confidence head。',
    config: { method: 'dspark', model: 'MATCHING_DSPARK_CHECKPOINT', num_speculative_tokens: 3 },
    steps: [
      stage(
        '确定查询块布局',
        '默认 sample_from_anchor=true，anchor 预测第一个草稿，共 K 个查询位置。具体 checkpoint 也可采用 DFlash 的 1+K 布局。',
        'default: [anchor noise₂ noise₃] → K query slots',
        gpu + 'dspark/speculator.py',
        'DSparkSpeculator.__init__',
      ),
      stage(
        '并行计算骨干特征',
        '复用 DFlash 的上下文 KV 与块前向，得到每个候选位置的基础特征和 logits。骨干阶段是并行的。',
        'parallel backbone → [base logits₁ logits₂ logits₃]',
        gpu + 'dspark/speculator.py',
        'DSparkSpeculator._generate_draft',
      ),
      stage(
        '顺序加入 Markov 偏置',
        '从 anchor 开始：以前一 token 计算 Markov bias，加到当前位置 base logits 上再采样。刚得到的候选又作为下一位置的 prev。',
        'logitsᵢ + bias(prev) → dᵢ；prev = dᵢ',
        gpu + 'dspark/speculator.py',
        'DSparkSpeculator._sample_sequential',
      ),
      {
        ...stage(
          '验证与可选置信度策略',
          '目标模型仍负责验证。有 confidence head 并开启对应配置时，可用置信度驱动自适应验证；这属于额外策略，不是每个 DSpark 都启用。',
          'draft tokens → verification；optional confidence budget',
          gpu + 'rejection_sampler.py',
          'RejectionSampler.__call__',
        ),
        alternateSource: {
          path: gpu + 'dspark/speculator.py',
          symbol: 'DSparkSpeculator._sample_sequential',
          needle: 'confidence = self.model.compute_confidence',
          observe: '可选 confidence head 的概率输出',
        },
      },
    ],
    ...quiz(
      'DSpark 是所有阶段都完全并行吗？',
      '不是，骨干并行，但 Markov 采样依次进行',
      '是，每个候选完全不依赖前一候选',
      '顺序 Markov 头用上一个采样 token 修正当前 logits，形成块内依赖。',
    ),
  },
];

export function specCommand(method) {
  if (!method.config || method.status === 'reference') return null;
  const runner = ['eagle3', 'mtp', 'dflash', 'dspark'].includes(method.id) ? 1 : 0;
  return `VLLM_USE_V2_MODEL_RUNNER=${runner} vllm serve ${method.target || 'TARGET_MODEL'} --speculative-config '${JSON.stringify(method.config)}'`;
}

export function specMethodLesson(id) {
  const method = specMethods.find((m) => m.id === id);
  if (!method) throw Error(`Unknown speculative method: ${id}`);
  const refs = [
    ...new Set([
      ...method.steps.flatMap((s) => [s.source.path, s.alternateSource?.path].filter(Boolean)),
      config,
      'vllm/config/vllm.py',
    ]),
  ].map((path) => ({ path, needle: '' }));
  return {
    ...method,
    english: method.name.toUpperCase(),
    group: 'spec',
    kind: 'spec-method',
    refs,
  };
}

export function registerSpecMethods(lessons) {
  for (const method of specMethods) {
    const existing = lessons.find((l) => l.id === method.id);
    const lesson = {
      ...existing,
      ...specMethodLesson(method.id),
    };
    if (!lesson.question || !lesson.steps.every((s) => s.source?.symbol || s.source?.heading))
      throw Error(`Incomplete speculative method: ${method.id}`);
    if (existing) Object.assign(existing, lesson);
    else lessons.push(lesson);
  }
}
