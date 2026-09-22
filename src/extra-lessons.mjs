import { specMethodLesson } from './spec-methods.mjs';

export function registerExtras(add, S, R) {
  // Keep the four original chapters in their legacy registration slots so
  // existing saved quiz answers keep their meaning as the catalog expands.
  const M = (id) => {
    const m = specMethodLesson(id);
    add(m.id, m.title, m.english, m.group, m.kind, m.summary, m.analogy, m.steps, m.refs, m);
  };
  const L = (id, title, en, group, kind, summary, analogy, steps, refs, extra = {}) =>
    add(
      id,
      title,
      en,
      group,
      kind,
      summary,
      analogy,
      steps.map((s) => S(...s)),
      refs.map((r) => (Array.isArray(r) ? R(...r) : R(r))),
      extra,
    );
  L(
    'configuration',
    '从配置到引擎',
    'CONFIGURATION',
    'start',
    'flow',
    '沿着启动参数，看模型、缓存、并行与 Runner 的配置如何汇合。',
    '开工前先核对设备、原料和工艺是否匹配。',
    [
      ['读取入口参数', 'CLI 或 LLM 初始化参数被转换成统一的引擎参数。', 'CLI / LLM → EngineArgs'],
      [
        '组合子配置',
        '模型、缓存、并行、调度、编译和投机配置被组装进 VllmConfig。',
        'Model + Cache + Parallel + Scheduler',
      ],
      [
        '校验组合',
        '平台、模型结构、dtype 与功能组合影响后端选择；特性不能任意叠加。',
        '不满足约束 → 报错或受控回退',
      ],
      [
        '选择执行路径',
        'use_v2_model_runner 综合显式设置和可用能力。Model Runner V2 仍在 V1 引擎中。',
        'V1 Engine → MRV1 或 MRV2',
      ],
    ],
    ['vllm/engine/arg_utils.py', ['vllm/config/vllm.py', 'def use_v2_model_runner']],
  );
  L(
    'async',
    '进程通信与异步调度',
    'ASYNC ENGINE',
    'start',
    'flow',
    '区分前端、EngineCore 和 GPU Worker，理解 CPU 与 GPU 如何同时工作。',
    '前台继续接单时，厨房仍在做上一道菜。',
    [
      [
        '前端接单',
        'AsyncLLM 处理异步请求，EngineCoreClient 传送请求和输出消息。',
        'API 进程 → EngineCoreClient',
      ],
      ['提交当前批次', 'EngineCore 获取调度计划并向执行器提交工作。', 'step N → GPU 队列'],
      [
        '重叠准备下一批',
        'CPU 准备后续批次时 GPU 可以执行当前批次，具体屏障因 Runner 而异。',
        'CPU(N+1) ∥ GPU(N)',
      ],
      [
        '消费完成结果',
        '输出回到调度器更新状态，再由输出处理器传给前端。',
        'future 完成 → 请求状态更新',
      ],
    ],
    [
      'vllm/v1/engine/async_llm.py',
      'vllm/v1/engine/core.py',
      'vllm/v1/core/sched/async_scheduler.py',
    ],
  );
  L(
    'preemption',
    '抢占、重算与取消',
    'REQUEST LIFETIME',
    'memory',
    'flow',
    '显存不够或客户端断开时，请求和 KV 缓存分别会发生什么。',
    '腾出工作台不会删除订单，但再次加工可能要重做准备。',
    [
      [
        '分配失败',
        '无法分配新计算所需的缓存块时，调度器尝试按策略抢占请求。',
        'allocate_slots → 无法分配',
      ],
      [
        '回收可释放块',
        '抢占受在途工作和优先级等限制，不能立即复用设备仍在访问的内存。',
        'RUNNING → PREEMPTED',
      ],
      [
        '恢复并重算',
        '已生成的 token 保留，恢复时通过重算等路径重建缺失的 KV。',
        'computed 重置；已生成文本保留',
      ],
      [
        '取消或完成',
        '进入终止和资源清理路径；异步执行可能延迟最终释放。',
        '请求终止 → free blocks',
      ],
    ],
    [
      ['vllm/v1/core/sched/scheduler.py', 'def _preempt_request('],
      'vllm/v1/request.py',
      ['vllm/v1/core/kv_cache_manager.py', 'def free('],
    ],
  );
  L(
    'priority',
    'FCFS 与优先级队列',
    'SCHEDULING POLICY',
    'memory',
    'flow',
    '比较先来先服务、优先级排序与资源限制的关系。',
    '普通队列按到达先后排，优先队列还要比较订单等级。',
    [
      [
        '请求携带排序信息',
        '请求保存到达时间和 priority 等信息。',
        'request → (priority, arrival_time)',
      ],
      [
        '选择队列实现',
        'FCFS 使用到达顺序，PriorityRequestQueue 按优先级和到达时间组织候选。',
        'FCFS / priority',
      ],
      [
        '检查资源约束',
        '排在前面也需要满足 token 预算、KV 容量与其他约束。',
        '候选请求 → 可调度请求',
      ],
      [
        '必要时抢占',
        '资源不足时策略也影响抢占对象，并非每轮无条件重排全部活动请求。',
        '运行队列 + policy → 抢占决策',
      ],
    ],
    ['vllm/v1/core/sched/request_queue.py', 'vllm/v1/core/sched/scheduler.py'],
  );
  L(
    'hybrid',
    '滑动窗口与混合 KV',
    'HYBRID CACHE',
    'memory',
    'flow',
    '全注意力、滑动窗口和状态空间层需要不同的缓存管理。',
    '有的工位保留完整资料，有的只留最近记录，有的只留汇总状态。',
    [
      [
        '识别层类型',
        'KVCacheSpec 描述 full attention、sliding window、Mamba 等需求。',
        '层 → 不同 CacheSpec',
      ],
      ['组织缓存组', '把合适的层组织为 cache group，协调不同类型分配。', '多层 → cache groups'],
      [
        '按类型推进',
        '窗口层可以跳过窗口外块，SSM 状态不等于普通 K、V token 序列。',
        '各类型有不同状态生命周期',
      ],
      [
        '协调命中和释放',
        '混合类型的前缀命中长度和回收规则需要联合决定。',
        'single-type managers → coordinator',
      ],
    ],
    [
      'vllm/v1/kv_cache_interface.py',
      'vllm/v1/core/single_type_kv_cache_manager.py',
      'docs/design/hybrid_kv_cache_manager.md',
    ],
  );
  L(
    'runner',
    'Model Runner V1 / V2',
    'MODEL RUNNER',
    'compute',
    'flow',
    '把调度器的工作清单变成 GPU 输入。',
    '调度器写派工单，Runner 把工具与原料放到机器要求的位置。',
    [
      [
        '接收计划',
        'SchedulerOutput 描述新增、继续、结束请求以及本轮 token 数。',
        '请求差量 + num_scheduled_tokens',
      ],
      [
        '维护持久状态',
        'MRV1 维护 persistent batch；MRV2 将请求持久行与本轮输入分离。',
        '持久状态 ≠ 本轮输入布局',
      ],
      [
        '收集设备输入',
        '整理 input_ids、positions、block table 和 attention metadata。',
        'state gather → 连续输入张量',
      ],
      [
        '执行与输出',
        '选择普通执行或图回放，再采样或 pooling 并返回结果。',
        'model → sampler / pooler',
      ],
    ],
    [
      'vllm/v1/worker/gpu_model_runner.py',
      'vllm/v1/worker/gpu/model_runner.py',
      'docs/design/model_runner_v2.md',
    ],
  );
  L(
    'model-loading',
    '模型注册与权重加载',
    'MODEL & WEIGHTS',
    'compute',
    'flow',
    '分清选择模型代码、构造模型和载入权重的过程。',
    '先选择图纸，再装配机器，最后装入参数。',
    [
      [
        '读取模型配置',
        '架构名、量化配置与 dtype 决定后续实现路径。',
        'config.architectures → registry',
      ],
      [
        '定位模型实现',
        '模型注册表解析原生实现或适用的 Transformers / 插件路径。',
        '架构名 → 模型类',
      ],
      ['选择加载器', '根据格式选择默认、分片、tensorizer 或其他 loader。', 'load_format → loader'],
      [
        '分片装载与后处理',
        '各设备载入对应权重，并行切分、量化后处理与内存布局在相应阶段执行。',
        'checkpoint tensors → device weights',
      ],
    ],
    [
      'vllm/model_executor/models/registry.py',
      'vllm/model_executor/model_loader/default_loader.py',
      'vllm/model_executor/model_loader/__init__.py',
    ],
  );
  L(
    'attention-backends',
    'Attention 后端选择',
    'ATTENTION BACKENDS',
    'compute',
    'flow',
    '同一个 Attention 接口如何落到不同平台的具体实现。',
    '相同的任务，在不同机器上需要不同工具。',
    [
      [
        '收集约束',
        '平台、head size、dtype、KV dtype 与 attention 类型影响候选后端。',
        '模型需求 + 平台能力',
      ],
      [
        '筛选后端',
        'selector 和 registry 定位实现，显式指定也需要通过支持条件。',
        '候选列表 → selected backend',
      ],
      ['构造元数据', '整理 query 长度、序列长度和 block table 等后端输入。', '请求状态 → metadata'],
      [
        '调用 kernel',
        '根据阶段和形状选择实际计算程序；不同后端的布局不能随意互换。',
        'attention interface → device kernel',
      ],
    ],
    [
      'vllm/v1/attention/selector.py',
      'vllm/v1/attention/backends/registry.py',
      'vllm/v1/attention/backend.py',
    ],
  );
  L(
    'mla',
    'MLA、稀疏注意力与 IndexCache',
    'MLA & INDEXCACHE',
    'compute',
    'flow',
    '区分 KV 压缩、稀疏 token 选择和跨层索引复用。',
    '压缩笔记后挑重点阅读，相邻章节还可以共用重点目录。',
    [
      [
        '构造专用表示',
        'MLA 使用 latent 等模型专用表示，不能直接套用普通 MHA 的缓存布局。',
        '模型结构 → 专用 KV 表示',
      ],
      [
        '选择稀疏索引',
        'DSA 路径按模型逻辑选择历史 token 的 top-k 索引。',
        '候选历史 → top-k indices',
      ],
      ['F 层计算', 'IndexCache 中 F（Full）层重新计算并保存索引。', 'F：compute + store'],
      [
        'S 层复用',
        'S（Shared）层沿用此前索引，节省重复 top-k，复用的不是最终 attention 输出。',
        'S：reuse indices',
      ],
    ],
    ['docs/features/index_cache.md', 'vllm/v1/attention/selector.py'],
  );
  L(
    'sampling',
    '采样、温度与 Top-p',
    'SAMPLING',
    'compute',
    'sampling',
    '通过概率柱状图观察温度和 top-p 对候选集合的影响。',
    '先打分，再缩小范围，最后按规则选一个。',
    [
      ['得到 logits', '输出头给词表候选打分，图中使用五个词的缩小示例。', 'hidden states → logits'],
      [
        '温度变换',
        '真实路径还组合 penalties、mask 等操作；此处单独看温度的影响。',
        'softmax(logits / T)',
      ],
      ['Top-p 截断', '按概率排序，保留累计概率达到阈值的最小前缀，再归一化。', '低概率候选 → 0'],
      [
        '生成 token',
        '概率采样按分布抽取；T=0 走贪心。图中不调用模型或实际抽样。',
        '概率分布 → token ID',
      ],
    ],
    [['vllm/v1/sample/sampler.py', 'class Sampler'], 'vllm/v1/sample/ops/topk_topp_sampler.py'],
    {
      question: '降低正数 temperature 通常会怎样？',
      choices: ['高分候选占更大概率', '所有候选概率更平均'],
      answer: 0,
      reason: '更低的正温度会放大相同 logits 之间的差；温度为零时使用贪心路径。',
    },
  );
  L(
    'logits',
    'Logits Processor 与水印',
    'LOGITS & WATERMARK',
    'compute',
    'flow',
    '观察采样附近的分数处理与水印扩展点。',
    '评分表可以按规则加减分，也可以留下特定的统计线索。',
    [
      [
        '维护请求状态',
        'processor 根据请求参数和历史 token 保存状态，批次变化时更新映射。',
        'request ID → processor state',
      ],
      [
        '处理候选',
        '重复惩罚、禁用词或自定义 processor 改变分数与允许集合。',
        'raw logits → processed logits',
      ],
      [
        '水印采样',
        '对应实现按配置、上下文和算法运行，不一定只是给某些词加固定偏置。',
        'config → watermarker / sampler',
      ],
      [
        '检测统计信号',
        '生成序列可由匹配的 detector 分析。水印检测不证明文本事实正确。',
        'token sequence → detector',
      ],
    ],
    [
      'vllm/v1/sample/logits_processor/interface.py',
      'vllm/v1/watermarking/watermarker.py',
      'vllm/v1/watermarking/detector.py',
    ],
  );
  L(
    'beam',
    'Beam Search 与多样本',
    'MULTIPLE CANDIDATES',
    'compute',
    'flow',
    '对比独立生成多个样本与每轮筛选搜索分支。',
    '几个人独立作答，与每轮留下最优几条路线，是两种办法。',
    [
      [
        '建立候选',
        'parallel sampling 构造子请求，beam search 维护候选序列。',
        '一个 prompt → 多个候选',
      ],
      [
        '推进分支',
        '各分支得到下一个 token 或候选分数，可利用适用的前缀缓存。',
        '候选 → 下一步扩展',
      ],
      [
        '选择与停止',
        '束搜索按评分保留 beam，独立采样不做同样的跨分支淘汰。',
        'beam 排序 / 独立推进',
      ],
      [
        '聚合结果',
        '将各候选整理为接口需要的结果列表，更多候选会增加资源需求。',
        'sequences → outputs',
      ],
    ],
    ['vllm/entrypoints/generate/beam_search/offline.py', 'vllm/v1/engine/parallel_sampling.py'],
  );
  L(
    'compile',
    '编译、IR 与算子融合',
    'COMPILATION',
    'compute',
    'flow',
    '观察模型图如何经过捕获、优化与编译。',
    '把手写工序提前整理成适合机器执行的程序。',
    [
      [
        '捕获计算图',
        'torch.compile 捕获适用计算，动态图与特殊算子可能形成边界。',
        'Python forward → graph',
      ],
      [
        '图变换与融合',
        'vLLM pass 识别可优化模式，进行适用的 IR 变换与融合。',
        'graph → optimized graph',
      ],
      [
        '编译和缓存',
        '按相关配置与形状编译专门版本，后续可复用编译产物。',
        'graph → compiled callable',
      ],
      [
        '匹配运行路径',
        '根据运行条件选择对应版本。编译与 CUDA Graph 是不同的机制。',
        'runtime shape → executable',
      ],
    ],
    ['vllm/compilation/backends.py', 'docs/design/vllm_ir.md', 'docs/design/fusions.md'],
  );
  L(
    'cudagraph',
    'CUDA Graph：捕获与回放',
    'CUDA GRAPHS',
    'compute',
    'graph',
    '记录一连串 kernel 的提交与依赖，在条件满足时整段回放。',
    '录下机器操作顺序，下次按播放键，机器仍然需要进行计算。',
    [
      [
        '预热',
        '先准备模型与内存布局，避免首次初始化进入不适合捕获的路径。',
        'warmup → stable buffers',
      ],
      [
        '捕获',
        'CUDA Graph 记录设备工作和依赖，受形状、地址与后端等约束。',
        'kernels A / B / C → graph',
      ],
      [
        '匹配形状',
        '选择支持当前批次的图，不匹配时按具体策略选择其他路径。',
        'runtime shape → graph key',
      ],
      ['回放', '减少逐 kernel 提交开销，但并没有跳过模型前向的设备计算。', 'replay → GPU kernels'],
    ],
    ['vllm/compilation/cuda_graph.py', 'docs/design/cuda_graphs.md'],
  );
  L(
    'quantization',
    '权重量化与精度',
    'WEIGHT QUANTIZATION',
    'compute',
    'quant',
    '观察整数位宽、尺度与重建误差的关系。',
    '用更少刻度记录数值，节省空间但可能丢失细节。',
    [
      [
        '读取配置',
        '不同量化方法规定权重、激活、分组和打包方式。图中只演示对称整数方法。',
        '浮点权重 → 量化规则',
      ],
      [
        '映射并打包',
        '示例 q=round(w/scale)。AWQ、GPTQ、FP8 等有不同准备与表示方式。',
        'w → q + scale',
      ],
      [
        '选择 kernel',
        '选择能够消费相应打包表示的线性层或 MoE kernel，按实现处理尺度。',
        'quantized tensors → kernel',
      ],
      ['观察误差', '位宽比例不等于整机显存比例，也不是吞吐或加速保证。', '近似表示 → 数值误差'],
    ],
    ['vllm/model_executor/layers/quantization/__init__.py', 'docs/features/quantization/README.md'],
  );
  L(
    'kv-quant',
    'KV / Encoder 量化',
    'KV & ENCODER QUANTIZATION',
    'compute',
    'flow',
    '分开理解权重、KV Cache 和视觉 encoder 的低精度表示。',
    '固定资料和随请求增长的笔记，可以分别压缩。',
    [
      [
        '配置 KV dtype',
        'KV dtype 与权重 dtype 是两个不同维度，支持依平台和 attention 后端而定。',
        'cache_dtype ≠ weight_dtype',
      ],
      ['确定尺度', '按方法生成或读取 K、V 对应的量化尺度。', '浮点 K / V → scale'],
      ['存储与计算', '按后端布局写入低精度缓存，读取时正确处理值与尺度。', '低精度 KV → attention'],
      [
        '识别专用变体',
        'TurboQuant、INT4 和视觉 FP8 attention 有独立的布局和条件。',
        'method + model + backend',
      ],
    ],
    [
      'docs/features/quantization/quantized_kvcache.md',
      'docs/features/quantization/fp8_vit_attn.md',
      'vllm/v1/attention/backends/turboquant_attn.py',
    ],
  );
  M('ngram');
  M('eagle');
  M('parallel-draft');
  L(
    'dynamic-spec',
    '动态草稿长度',
    'DYNAMIC SPECULATION',
    'spec',
    'flow',
    '并发数变化时，通过配置区间调整草稿长度。',
    '厨房忙时减少可能被退回的试做品，空闲时可以多试几份。',
    [
      ['观察批次大小', '读取当前并发数，查询预先配置的范围表。', 'batch size → interval'],
      [
        '选择 K',
        '文档示例：1…64 选 3，65…128 选 1，129…512 选 0；不是通用最优值。',
        'interval → speculative tokens K',
      ],
      [
        '限制草稿与验证量',
        'K 变小可减少验证计算，K=0 表示不产生草稿。',
        'draft / verify work follows K',
      ],
      [
        '下轮重新匹配',
        '负载变化后重选区间，不等于自动学习最佳参数。',
        'configured rule + runtime choice',
      ],
    ],
    [
      'docs/features/speculative_decoding/dynamic_speculative_decoding.md',
      'vllm/v1/spec_decode/dynamic/utils.py',
    ],
  );
  L(
    'adaptive-spec',
    '自适应验证与接受率',
    'ADAPTIVE VERIFICATION',
    'spec',
    'flow',
    '让置信度较高的候选优先使用验证预算。',
    '审稿时间有限时，先审预期更有价值的部分。',
    [
      ['测量形状成本', '启动时依据捕获图测量步骤开销，形成 cost model。', 'profile → cost curve'],
      [
        '估计存活概率',
        '连乘每个位置的置信度，估计连续接受到该位置的概率。',
        'confidence product → survival',
      ],
      [
        '跨请求分预算',
        '候选竞争全局预算，同一轮不同请求可保留不同草稿长度。',
        'global budget → per-request lengths',
      ],
      [
        '核对支持边界',
        '本快照文档限定 DSpark confidence head、full CUDA graphs，且不支持 LoRA / PP。接受率要区分逐位置与平均长度。',
        'support checks → enable',
      ],
    ],
    [
      'docs/features/speculative_decoding/adaptive_verification.md',
      'docs/features/speculative_decoding/acceptance_metrics.md',
    ],
  );
  L(
    'tp',
    '张量并行 TP',
    'TENSOR PARALLELISM',
    'parallel',
    'parallel',
    '把同一层的大矩阵切分到多张卡。',
    '同一道大题拆成几部分，大家一起算完这一层。',
    [
      ['切分权重', '列并行与行并行层按对应规则把权重分给多个 rank。', 'matrix → weight shards'],
      [
        '局部计算',
        '每张卡使用自己的分片计算局部结果，attention heads 也可能被切分。',
        'local shard × input',
      ],
      [
        '集合通信',
        '根据张量布局使用 all-reduce、all-gather 等，不是所有层都用同一种通信。',
        'partial results → collective',
      ],
      [
        '推进下一层',
        '形成下一层所需布局；降低单卡容量需求，同时增加通信。',
        'aligned tensor → next layer',
      ],
    ],
    ['vllm/model_executor/layers/linear.py', 'vllm/distributed/parallel_state.py'],
  );
  L(
    'pp',
    '流水线并行 PP',
    'PIPELINE PARALLELISM',
    'parallel',
    'parallel',
    '按层分配多个 stage，传递中间激活。',
    '不同工位顺序加工，多个订单可以在不同工位重叠。',
    [
      ['分配层段', '各 PP rank 负责一部分模型层，图中层数仅为示意。', 'layer range → stage'],
      [
        '执行局部层',
        '当前 stage 计算自己的层段，生成 intermediate tensors。',
        'input → intermediate activations',
      ],
      [
        '交接给下一段',
        '通过 rank 间通信传递中间张量，空泡和重叠程度依执行模式而定。',
        'send → receive',
      ],
      [
        '最后阶段输出',
        '最后一个 stage 完成最终输出相关工作，并将结果返回引擎。',
        'last stage → engine output',
      ],
    ],
    ['vllm/distributed/parallel_state.py', 'vllm/v1/executor/multiproc_executor.py'],
  );
  L(
    'dp',
    '数据并行 DP 与路由',
    'DATA PARALLELISM',
    'parallel',
    'parallel',
    '多个副本处理不同请求，副本内部仍可使用 TP / PP。',
    '开几家厨房接不同订单，每家内部仍能分工。',
    [
      [
        '建立副本',
        '每个 DP rank 对应自己的 EngineCore，内部可有多个 GPU Worker。',
        'workers = DP × PP × TP',
      ],
      [
        '路由请求',
        '根据部署方式由 API 或外部路由把请求送往对应副本。',
        'request A / B → different ranks',
      ],
      [
        '调度与协调',
        '各副本本地调度，MoE 等组合还存在跨 rank 协调需求。',
        'local scheduler + coordinator',
      ],
      ['返回响应', '增加副本主要扩大并发容量，不会自动加快单个请求。', 'replica output → client'],
    ],
    ['vllm/v1/engine/coordinator.py', 'docs/design/arch_overview.md', 'vllm/config/parallel.py'],
  );
  L(
    'cp',
    '上下文并行 PCP / DCP',
    'CONTEXT PARALLELISM',
    'parallel',
    'parallel',
    '长上下文分布到多个设备后，如何正确合并 attention 结果。',
    '每人看一部分历史材料，再按正确权重汇总。',
    [
      [
        '选择阶段与模式',
        'PCP 与 DCP 面向不同阶段，使用不同上下文切分方式。',
        'prefill CP / decode CP',
      ],
      [
        '局部计算',
        '各 rank 使用对应 query 和本地 KV 片段计算局部 attention。',
        'local KV → partial attention',
      ],
      [
        '通信与合并',
        '不能简单平均局部输出，需要正确利用归一化信息。',
        'partial outputs + LSE → merge',
      ],
      [
        '继续模型',
        '合并后按张量布局进入后续层，支持情况受 TP、模型和后端约束。',
        'merged results → next layer',
      ],
    ],
    [
      'vllm/v1/attention/ops/pcp.py',
      'vllm/v1/attention/ops/dcp.py',
      'vllm/v1/attention/ops/merge_attn_states.py',
    ],
  );
  L(
    'moe',
    'MoE 与专家并行 EP',
    'MIXTURE OF EXPERTS',
    'parallel',
    'parallel',
    '路由器决定 token 去哪些专家计算，再汇总结果。',
    '分诊台把任务交给合适的专家，最后整合意见。',
    [
      ['路由打分', '按模型规则为 token 选 top-k 专家。', 'token → selected experts'],
      [
        '分发 token',
        'EP 将专家放在不同 rank，dispatch 把 token 送到相应设备。',
        'all-to-all dispatch',
      ],
      ['专家计算', '专家只处理分到的 token，负载可能不均衡。', 'expert weights × routed tokens'],
      [
        '加权组合',
        'combine 将结果送回并按路由权重组合，恢复原 token 顺序。',
        'expert results → weighted sum',
      ],
    ],
    ['vllm/model_executor/layers/fused_moe/layer.py', 'docs/design/fused_moe_modular_kernel.md'],
  );
  L(
    'eplb',
    '专家负载均衡 EPLB',
    'EXPERT LOAD BALANCING',
    'parallel',
    'parallel',
    '通过统计负载、冗余专家和布局迁移缓解热点。',
    '热门专家增加同类工位，减少排队。',
    [
      ['统计专家负载', '收集窗口内各专家处理 token 的数量。', 'token counts → load statistics'],
      [
        '计算布局',
        '策略决定逻辑专家到物理副本的映射，冗余副本需要额外容量。',
        'logical → physical mapping',
      ],
      [
        '迁移权重',
        '搬运需要重新放置的专家权重，同步与异步路径各有条件。',
        'old placement → new placement',
      ],
      [
        '切换映射',
        '权重与映射准备一致后使用新布局，不能路由到错误参数。',
        'mapping version = weight version',
      ],
    ],
    ['vllm/distributed/eplb/eplb_state.py', 'vllm/distributed/eplb/rebalance_execute.py'],
  );
  L(
    'dbo',
    '双批次重叠 DBO',
    'DUAL BATCH OVERLAP',
    'parallel',
    'flow',
    '交错两个 microbatch 的通信和计算，减少等待。',
    '等一个订单的材料时，先加工另一个订单。',
    [
      ['切分批次', '按 token 数、配置和后端支持选择 microbatch 切分。', 'batch → microbatch 0 / 1'],
      ['启动通信', '一个 microbatch 在相应设备流上执行通信。', 'batch 0：communication'],
      ['重叠计算', '利用另一批次的独立工作填补空闲，仍受资源和依赖约束。', 'batch 1：compute'],
      [
        '同步与组合',
        '在需要数据的边界同步，保持正确结果和请求顺序。',
        'dependency barrier → combine',
      ],
    ],
    ['docs/design/dbo.md', 'vllm/v1/worker/ubatching.py'],
  );
  L(
    'elastic',
    '弹性 EP 与扩缩容',
    'ELASTIC EXPERT PARALLEL',
    'parallel',
    'flow',
    '设备数量改变时，通信、专家权重与路由都需要协调切换。',
    '增减工位前先交接资料与任务。',
    [
      ['发起规模变更', '扩缩容需要协调器和受支持路径配合。', 'old world → target world'],
      ['准备目标布局', '建立通信关系与专家映射，准备权重交接资源。', 'new groups + expert layout'],
      [
        '迁移和协调',
        '在约定边界同步状态，迁移对应权重及元数据。',
        'prepare → transfer → coordinate',
      ],
      ['使用新拓扑', '切换完成后继续执行，故障恢复能力依实际分支而定。', 'target topology active'],
    ],
    ['vllm/distributed/elastic_ep/__init__.py', 'vllm/config/parallel.py'],
  );
  L(
    'structured',
    '结构化输出：JSON / Grammar',
    'STRUCTURED OUTPUTS',
    'features',
    'structured',
    '把语法约束放到每一步采样，而不是生成完才修 JSON。',
    '每落一个字都检查还能不能组成合法句子。',
    [
      [
        '接收约束',
        'JSON Schema、regex 或 grammar 由请求携带。',
        'request → structured output params',
      ],
      [
        '编译语法',
        '后端把约束编译为可追踪 token 前缀的状态，不同后端支持能力不同。',
        'schema → grammar state',
      ],
      [
        '屏蔽非法候选',
        '每步按当前状态构建允许集合，图中的字符串候选为简化示意。',
        '非法 logits → −∞',
      ],
      [
        '采样并推进',
        '采样从合法候选中选择，已接受 token 更新语法状态。',
        'accepted token → advance grammar',
      ],
      [
        '交付结构化结果',
        '结构有效不保证事实正确，工具参数仍需要应用逻辑验证。',
        'valid JSON ≠ factual verification',
      ],
    ],
    ['vllm/v1/structured_output/__init__.py', 'vllm/v1/structured_output/backend_xgrammar.py'],
  );
  L(
    'lora',
    'LoRA 与多适配器推理',
    'MULTI-LORA',
    'features',
    'lora',
    '请求共用基础模型，同时选择不同低秩增量。',
    '同一台机器装不同小配件，完成不同风格的任务。',
    [
      ['共享基础模型', '基础权重共用，LoRA 是额外的低秩参数。', 'base W + adapters'],
      ['选择适配器', '请求绑定 LoRA ID，管理器处理加载、缓存与并发限制。', 'request → LoRARequest'],
      [
        '建立映射',
        '混合批次内每个 token 需要对应的 adapter 索引，防止串用参数。',
        'token row → adapter ID',
      ],
      [
        '计算低秩增量',
        '适用层计算 Wx + scale·BAx，支持受 rank、模型结构和 kernel 限制。',
        'y = Wx + scale·BAx',
      ],
    ],
    ['vllm/lora/worker_manager.py', 'vllm/lora/model_manager.py', 'docs/features/lora.md'],
  );
  L(
    'multimodal',
    '图像、视频与音频输入',
    'MULTIMODAL INPUTS',
    'features',
    'multimodal',
    '拆解媒体处理、编码、缓存和占位符替换。',
    '先把图片和声音翻译成向量语言，再与文字合并。',
    [
      ['解析媒体', 'processor 检查输入尺寸、数量和模型支持能力。', 'text + images / audio / video'],
      [
        '处理与占位',
        '模型专用 processor 准备张量、占位 token 和元数据。',
        'media → tensors + placeholders',
      ],
      [
        '编码与缓存',
        'encoder 计算媒体特征，调度器考虑 encoder token 预算与缓存。',
        'encoder → cached features',
      ],
      [
        '合并输入',
        '媒体 embedding 在对应占位符处进入模型，位置编码与融合由模型决定。',
        'text embeddings + media embeddings',
      ],
    ],
    [
      'vllm/multimodal/processing/processor.py',
      'vllm/v1/core/encoder_cache_manager.py',
      'docs/design/mm_processing.md',
    ],
  );
  L(
    'prompt-embeds',
    'Prompt Embeddings 与位置编码',
    'EMBEDDING INPUTS',
    'features',
    'flow',
    '直接输入 embedding 时，省掉的是哪一段计算。',
    '交付翻译后的材料，后续加工仍然存在。',
    [
      [
        '提供向量',
        '接口接收满足模型维度、dtype 与配置要求的向量。',
        'prompt_embeds：[tokens, hidden]',
      ],
      [
        '绕过相应查表',
        'embedding 输入省略对应的文本 embedding 查表，并没有跳过模型前向。',
        'precomputed vectors → model input',
      ],
      ['组织位置', 'RoPE、M-RoPE 等仍由模型和输入位置元数据决定。', 'positions + embeddings'],
      [
        '正常计算',
        '调度、KV 与模型计算继续进行，特性组合支持要看当前实现。',
        'model forward → outputs',
      ],
    ],
    ['docs/features/prompt_embeds.md', 'vllm/v1/engine/input_processor.py'],
  );
  L(
    'speech',
    '语音转写与流式输入',
    'SPEECH & STREAMING',
    'features',
    'flow',
    '音频分块到达时，会话状态怎样持续推进。',
    '电话语音持续到达，需要边接收边维护本次会话。',
    [
      [
        '接收输入',
        '转写、翻译和 realtime 接收相应格式，并非所有模型都支持流式输入。',
        'audio / audio chunks',
      ],
      [
        '处理和编码',
        '模型专用 processor 与 encoder 产生可推理的媒体表示。',
        'audio → encoded features',
      ],
      [
        '增量更新请求',
        '适用路径添加新内容，协调调度与 encoder 状态。',
        'streaming update → request state',
      ],
      [
        '返回增量事件',
        '按协议发送增量结果与结束事件，实时连接与一次性转写语义不同。',
        'incremental output → client',
      ],
    ],
    [
      'vllm/entrypoints/speech_to_text/realtime/serving.py',
      'vllm/entrypoints/speech_to_text/base/serving.py',
      'vllm/v1/request.py',
    ],
  );
  L(
    'tools',
    '工具调用与推理内容',
    'TOOLS & REASONING',
    'features',
    'flow',
    '从生成内容中解析 reasoning、正文与工具调用。',
    '模型写出工具指令单，真正执行的是应用。',
    [
      [
        '渲染工具说明',
        'chat template 按模型要求组织 tools 和 messages。',
        'messages + tools → prompt',
      ],
      ['模型生成结构', '输出可能包含 reasoning 标记、工具名称和参数。', 'tokens → tagged text'],
      [
        '增量解析',
        '专用 parser 维护可能跨 chunk 的边界，形成可消费的 delta。',
        'partial tokens → parser state',
      ],
      [
        '交还应用',
        '客户端执行工具，再把结果放进下一轮；vLLM 不自动执行任意工具。',
        'tool call → application → next turn',
      ],
    ],
    [
      'vllm/tool_parsers/__init__.py',
      'vllm/reasoning/__init__.py',
      'docs/features/tool_calling.md',
      'docs/features/reasoning_outputs.md',
    ],
  );
  L(
    'thinking',
    '交错思考与思考预算',
    'THINKING CONTROL',
    'features',
    'flow',
    '理解模型输出中的思考片段，以及预算怎样影响输出阶段。',
    '按协议区分草稿与正文，并给草稿设置长度规则。',
    [
      [
        '配置模型协议',
        'parser 和控制参数必须与模型的标记、输出方式匹配。',
        'model markers + request config',
      ],
      ['跟踪阶段', '状态记录当前位置属于 reasoning、正文或交错片段。', 'tokens → thinking state'],
      [
        '应用预算',
        '受支持的路径达到预算时，按协议改变允许 token 或结束思考。',
        'budget reached → transition',
      ],
      [
        '返回解析内容',
        '把 reasoning / content 等字段交给客户端，不保证内容的事实正确性。',
        'parsed deltas → response',
      ],
    ],
    [
      'vllm/v1/sample/thinking_budget_state.py',
      'vllm/v1/worker/gpu/sample/thinking_budget.py',
      'docs/features/interleaved_thinking.md',
    ],
  );
  L(
    'pooling',
    'Embedding、分类与重排',
    'POOLING & RERANKING',
    'features',
    'flow',
    '隐藏状态如何成为向量、类别或相关性分数。',
    '读完材料后交摘要向量或打分，而不是继续写文章。',
    [
      [
        '选择任务',
        'embed、classify、score 等入口组织输入和 pooling 参数。',
        'input → pooling task',
      ],
      [
        '模型前向',
        '模型产生 token 隐藏状态，attention mask 由模型与任务确定。',
        'input → token hidden states',
      ],
      [
        '汇聚或评分',
        '按配置取 CLS、last、mean 或 all，并经过适用 head / activation。',
        'hidden states → vector / scores',
      ],
      [
        '整理输出',
        '按需要归一化；cross-encoder、late interaction 等有独立评分规则。',
        'embeddings / classes / ranking',
      ],
    ],
    [
      'vllm/model_executor/layers/pooler/seqwise/methods.py',
      'vllm/entrypoints/pooling/scoring/serving.py',
      'vllm/entrypoints/pooling/embed/serving.py',
    ],
  );
  L(
    'long-context',
    '长上下文、RoPE 与混合模型',
    'LONG CONTEXT & HYBRID MODELS',
    'features',
    'flow',
    '延长上下文涉及位置编码、缓存容量和模型结构。',
    '书变厚了，页码、书架和阅读方式都需要匹配。',
    [
      [
        '检查长度配置',
        'max_model_len、RoPE 与模型能力及实际资源必须匹配。',
        'model length + position config',
      ],
      [
        '生成位置表示',
        '不同 RoPE scaling 和 M-RoPE 使用不同位置变换。',
        'positions → positional transform',
      ],
      [
        '管理历史',
        '长序列提高缓存需求，Mamba、GDN、窗口注意力各有状态规则。',
        'long history → KV / state demand',
      ],
      [
        '核对质量和分支',
        '扩长配置不保证长上下文质量，稀疏、压缩、Engram 等须读对应模型实现。',
        'configuration ≠ quality guarantee',
      ],
    ],
    [
      'docs/features/context_extension.md',
      'vllm/model_executor/layers/rotary_embedding/__init__.py',
      'vllm/v1/kv_cache_interface.py',
    ],
  );
  L(
    'diffusion',
    '离散扩散语言模型',
    'DIFFUSION LANGUAGE MODEL',
    'features',
    'flow',
    '并非所有模型都严格按每次追加一个 token 来生成。',
    '先留下一些待填位置，再多轮逐步完善。',
    [
      [
        '准备专用配置',
        '扩散模型使用对应 block 和迭代参数，不应直接套用普通自回归循环。',
        'DiffusionConfig → model path',
      ],
      ['构造待更新位置', '按模型约定准备或选择需要更新的位置。', 'mask / partial sequence'],
      ['迭代更新', '模型多步更新候选，具体去噪和选择方式由实现规定。', 'step t → refined sequence'],
      [
        '提交结果',
        '达到模型定义的条件后输出。此动画展示概念流程，不模拟真实去噪数值。',
        'completed block → output',
      ],
    ],
    ['vllm/config/diffusion.py', 'vllm/model_executor/models/diffusion_gemma.py'],
  );
  L(
    'disagg',
    'Prefill / Decode 分离',
    'DISAGGREGATED SERVING',
    'ops',
    'transfer',
    '两个实例分别处理 prefill 与 decode，核心是交接 KV。',
    '备料厨房把材料与清单送给出餐厨房。',
    [
      [
        '路由请求',
        '部署中的路由层选择 prefill 实例，connector 负责对应数据交接。',
        'request → prefill instance',
      ],
      ['计算 KV', '生产端生成可传输的 KV 与元数据。', 'computed KV → connector'],
      [
        '传输与完成通知',
        'scheduler 与 worker 协同管理异步发送、接收与完成状态。',
        'send / load → completion',
      ],
      [
        '继续生成',
        '消费端确认 KV 可用再 decode，超时和加载失败走对应恢复路径。',
        'KV ready → decode',
      ],
    ],
    ['vllm/distributed/kv_transfer/kv_connector/v1/base.py', 'docs/features/disagg_prefill.md'],
  );
  L(
    'offload',
    'KV 卸载与缓存分层',
    'KV OFFLOADING',
    'ops',
    'transfer',
    '观察 GPU、CPU 和外部存储间的数据移动。',
    '书桌放常用资料，远处书架更大但取回需要时间。',
    [
      [
        '选择卸载对象',
        '具体策略确定哪些 KV 值值得移到其他层，不同 connector 能力不同。',
        'GPU blocks → candidates',
      ],
      ['准备映射', '分配目标空间，记录重新查找与恢复所需的标识。', 'GPU IDs → external IDs'],
      [
        '异步搬运',
        'copy backend 或外部库执行传输，必须维护相关读写依赖。',
        'GPU → CPU / other tiers',
      ],
      ['命中后加载', '查找并恢复，收益要与带宽、延迟和元数据开销比较。', 'lookup → load → ready'],
    ],
    [
      'vllm/v1/kv_offload/base.py',
      'vllm/v1/simple_kv_offload/manager.py',
      'docs/features/kv_offloading_usage.md',
    ],
  );
  L(
    'encoder-disagg',
    'Encoder 分离与 EC 缓存',
    'DISAGGREGATED ENCODER',
    'ops',
    'flow',
    '独立运行媒体 encoder，传输媒体特征而不是语言模型 KV。',
    '翻译台先处理图片声音，再交给文字推理。',
    [
      ['建立媒体任务', '确定需要执行的 encoder 工作与缓存键。', 'media → encoder task'],
      [
        '执行编码',
        '独立 encoder 产生对应 embedding 或 features。',
        'pixels / audio → encoder output',
      ],
      [
        'EC 数据交接',
        '通过 EC transfer 或 CPU cache 等路径共享特征，区别于 KV transfer。',
        'encoder features → connector',
      ],
      [
        '语言模型消费',
        '在占位符对应位置使用已经就绪的媒体特征。',
        'features ready → language model',
      ],
    ],
    [
      'docs/features/disagg_encoder.md',
      'docs/features/ec_cpu_connector.md',
      'vllm/v1/worker/ec_connector_model_runner_mixin.py',
    ],
  );
  L(
    'serving',
    '服务协议与流式响应',
    'SERVING PROTOCOLS',
    'ops',
    'flow',
    '沿 Chat、Completion、Responses、Batch 等入口追到引擎。',
    '不同格式的订单先转为通用派工单。',
    [
      [
        '校验请求',
        '检查字段、模型名和参数；自定义参数需要对应接口支持。',
        'HTTP JSON → protocol object',
      ],
      [
        '输入转换',
        'chat template、tokenizer 与媒体处理器组织引擎输入。',
        'messages → engine inputs',
      ],
      ['异步消费输出', '调用 engine client，持续消费输出对象。', 'request ID → async generator'],
      [
        '编码协议结果',
        '形成 SSE delta 或完整响应，处理 usage、取消与结束状态。',
        'engine output → protocol response',
      ],
    ],
    [
      'vllm/entrypoints/openai/chat_completion/serving.py',
      'vllm/entrypoints/openai/responses/serving.py',
      'docs/features/custom_arguments.md',
    ],
  );
  L(
    'sleep',
    '休眠、唤醒与权重更新',
    'SLEEP & WEIGHT TRANSFER',
    'ops',
    'flow',
    '区分暂停请求、释放显存与写入新权重。',
    '暂停营业不等于清空仓库，恢复前还要核对设备与原料。',
    [
      [
        '进入受控边界',
        '暂停或排空适用工作，避免请求使用更新中的参数。',
        'active work → controlled boundary',
      ],
      [
        '选择休眠级别',
        'Level 1 权重备份到 CPU 并丢弃 KV；Level 2 丢弃权重和 KV，保留适用 buffers。',
        'level 1：backup；level 2：discard',
      ],
      [
        '唤醒与加载',
        '按需分配内存，使用 reload 或 weight transfer 恢复有效权重。',
        'allocate → transfer / reload',
      ],
      [
        '清理状态再恢复',
        '旧权重产生的 KV 不能直接当成新权重的有效结果。',
        'new weights + valid state → resume',
      ],
    ],
    [
      'docs/features/sleep_mode.md',
      'vllm/v1/worker/gpu_worker.py',
      'vllm/distributed/weight_transfer/base.py',
    ],
  );
  L(
    'metrics',
    '指标、Tracing 与性能观察',
    'OBSERVABILITY',
    'ops',
    'flow',
    '沿请求时间轴区分排队、首 token、token 间隔与总耗时。',
    '等位、第一道菜和全部上齐的时间不是同一个指标。',
    [
      [
        '记录起点',
        '客户端发起与服务端接收时间可能不同，先明确统计边界。',
        'request start / arrival',
      ],
      [
        '记录首 token',
        'TTFT 可能包含排队、prefill 与传输，不能理解成纯 GPU 时间。',
        'first token − start = TTFT',
      ],
      [
        '统计后续输出',
        '观察 ITL、TPOT 和长度，再结合队列与 cache 使用判断瓶颈。',
        'ITL / TPOT / throughput',
      ],
      [
        '关联其他层次',
        'tracing、profile 与请求指标看不同层面，KV events 则记录缓存事件。',
        'metrics + spans + device timeline',
      ],
    ],
    [
      'vllm/v1/metrics/stats.py',
      'vllm/v1/metrics/prometheus.py',
      'docs/features/per_request_metrics.md',
      'vllm/distributed/kv_events.py',
    ],
  );
  L(
    'invariance',
    'Batch Invariance 与确定性',
    'REPRODUCIBILITY',
    'ops',
    'flow',
    '固定随机种子之外，批次形状和数值归约也会影响结果。',
    '有限精度的小数加法，分组顺序不同可能产生细微差异。',
    [
      ['控制比较条件', '固定模型、输入、采样配置和硬件软件边界。', 'controlled experiment'],
      [
        '识别变化来源',
        'batch shape 影响 kernel 或归约路径，小误差可能改变 token 选择。',
        'batch layout → numeric path',
      ],
      [
        '使用受支持路径',
        'Batch invariance 对平台和算子有约束，本地文档仍标记 beta。',
        'supported kernels + config',
      ],
      [
        '比较结果和成本',
        '该选项不是跨所有硬件软件版本的绝对一致承诺。',
        'same input → supported invariant path',
      ],
    ],
    ['docs/features/batch_invariance.md', 'vllm/model_executor/determinism/__init__.py'],
  );
  L(
    'fault',
    '故障检测与资源清理',
    'FAULT TOLERANCE',
    'ops',
    'flow',
    '区分故障检测、阻止继续执行、清理和恢复。',
    '发现工位失联，先停止派单，再决定能否恢复。',
    [
      ['检测异常', 'sentinel 或监督逻辑发现进程退出、通信异常等事件。', 'worker / engine failure'],
      [
        '传播失败',
        '引擎和服务层进入对应错误处理，避免将无效结果作为成功返回。',
        'failure → error state',
      ],
      [
        '清理资源',
        '协调处理相关请求、通信与进程，未确认安全前不能任意复用内存。',
        'pending work → cleanup',
      ],
      [
        '按策略恢复',
        '重启、降级或弹性恢复依配置而定，不保证每个请求都能透明恢复。',
        'restart / recover / report',
      ],
    ],
    [
      'vllm/v1/fault_tolerance/engine_core_sentinel.py',
      'vllm/v1/worker/sentinel/gpu_worker_sentinel.py',
      'vllm/config/fault_tolerance.py',
    ],
  );
  L(
    'platform',
    '硬件平台与 Kernel 分发',
    'PLATFORMS & KERNELS',
    'extend',
    'flow',
    '同一模型接口如何落到 CUDA、ROCm、CPU、XPU 与平台插件。',
    '同一工序在不同机器上需要不同操作程序。',
    [
      ['识别平台', 'platforms 与插件发现机制返回当前设备能力。', 'environment → current_platform'],
      [
        '选择执行组件',
        '按平台约束选择 worker、attention backend 与 dtype 等。',
        'platform → worker / backend',
      ],
      [
        '分发算子',
        'CustomOp、IR 或模型专用层路由到对应设备 kernel。',
        'operator → device implementation',
      ],
      [
        '核对差异',
        'vllm-ascend 是独立的硬件适配项目；本工具的 vLLM 源码索引不包括它的内部实现。',
        'capability checks → valid path',
      ],
    ],
    ['vllm/platforms/__init__.py', 'vllm/model_executor/custom_op.py', 'docs/design/custom_op.md'],
  );
  L(
    'plugins',
    '插件与外部量化后端',
    'PLUGINS & EXTERNAL BACKENDS',
    'extend',
    'flow',
    '识别主仓接口与仓库外实现的边界。',
    '主系统提供插槽，外接设备还有自己的内部结构。',
    [
      [
        '发现插件',
        '通过 entry points 等机制发现不同类别扩展。',
        'installed package → plugin discovery',
      ],
      [
        '注册实现',
        '扩展加入对应 registry 或 factory，并满足接口契约。',
        'plugin → register implementation',
      ],
      [
        '按配置调用',
        '模型、平台或 loader 配置选择插件，主仓通过约定接口调用。',
        'config → plugin path',
      ],
      [
        '继续读外部实现',
        'GGUF / BitsAndBytes 已迁往仓库外插件；这里展示接入过程，内部 kernel 需要插件源码。',
        '主仓契约 → external repository',
      ],
    ],
    [
      'vllm/plugins/__init__.py',
      'docs/design/plugin_system.md',
      'docs/features/quantization/gguf.md',
      'docs/features/quantization/bnb.md',
    ],
  );
  L(
    'connectors',
    'NIXL / Mooncake 等 Connector',
    'CONNECTOR ECOSYSTEM',
    'extend',
    'flow',
    '同一 KV connector 接口怎样连接不同传输系统。',
    '统一货运单可以交给不同物流公司。',
    [
      [
        '定位 connector',
        '配置与 factory 选择 NIXL、Mooncake、MoriIO 等相应实现。',
        'connector name → implementation',
      ],
      [
        'Scheduler 侧计划',
        '整理需要读取或保存的 KV，构造跨进程 metadata。',
        'request / blocks → metadata',
      ],
      ['Worker 侧传输', '管理设备地址、实际发送接收和完成事件。', 'metadata → transfer'],
      [
        '完成后变更状态',
        '等相关操作完成才消费或释放资源，外部网络库内部不都在主仓。',
        'finished event → safe transition',
      ],
    ],
    [
      'vllm/distributed/kv_transfer/kv_connector/factory.py',
      'vllm/distributed/kv_transfer/kv_connector/v1/base.py',
      'docs/features/nixl_connector_usage.md',
    ],
  );
  L(
    'rust',
    'Rust 前端与跨语言协议',
    'RUST FRONTEND',
    'extend',
    'flow',
    '查看另一组前端实现如何与推理引擎交互。',
    '换一种语言写前台，订单仍需按双方约定交接。',
    [
      ['解析请求', 'Rust 前端按支持的 API 解析请求并组织内部表示。', 'HTTP / protocol → request'],
      [
        '序列化协议',
        '双方约定字段、token 和消息表示，不能只根据函数名推断。',
        'request → wire representation',
      ],
      ['调用引擎', '通过相应 client 与 transport 交给推理端。', 'client → inference engine'],
      ['解析输出流', '增量输出编码成前端协议，处理错误与结束事件。', 'engine events → response'],
    ],
    ['rust/README.md', 'rust/proto/README.md'],
  );
  L(
    'compatibility',
    '特性组合与支持边界',
    'COMPATIBILITY',
    'extend',
    'flow',
    '分别支持的两个功能，不一定可以同时启用。',
    '两种工具各自可用，安装在一起仍可能冲突。',
    [
      [
        '列出使用条件',
        '同时确定模型、平台、dtype、Runner 和特性组合。',
        'model + platform + runner + features',
      ],
      [
        '查文档线索',
        '兼容性文档是入口，可能落后于代码，仍需核对实现。',
        'docs → candidate constraints',
      ],
      ['追配置校验', 'VllmConfig 和子配置决定默认值、拒绝与回退。', 'validators → selected path'],
      [
        '核对分支与测试',
        '查看具体运行路径及边界测试，不把所有组合都视作已验证。',
        'branches + tests → behavior',
      ],
    ],
    ['docs/features/README.md', 'vllm/config/vllm.py', 'vllm/config/speculative.py'],
  );
  L(
    'online-quant',
    '加载时在线量化',
    'ONLINE QUANTIZATION',
    'compute',
    'flow',
    '没有预量化 checkpoint 时，在加载阶段转换权重。',
    '原料入库时转换成更紧凑的包装，使用时仍按对应规则处理。',
    [
      [
        '选择量化方案',
        '按文档支持选择 FP8 per-tensor、per-block 或其他方案，能力受平台限制。',
        'floating checkpoint + scheme',
      ],
      [
        '加载浮点权重',
        '先读取 BF16 / FP16 参数，转换发生在模型加载流程。',
        'checkpoint → floating weights',
      ],
      [
        '转换权重表示',
        '根据方案生成低精度值与 tensor 或 block 粒度的尺度。',
        'weights → low precision + scales',
      ],
      [
        '前向处理激活',
        '对应路径动态处理激活尺度并调用匹配 kernel；不是在线重新训练模型。',
        'activations + quantized weights → output',
      ],
    ],
    ['docs/features/quantization/online.md', 'vllm/model_executor/layers/quantization/__init__.py'],
  );
  M('mlp-spec');
  L(
    'speculators',
    '草稿训练数据与 Speculators',
    'DRAFT TRAINING INTEGRATION',
    'spec',
    'flow',
    '把隐藏状态数据采集、外部草稿训练和推理接入串起来。',
    '先收集主编的示例，再训练助理，最后让助理参与实际出稿。',
    [
      [
        '提取训练数据',
        'vLLM 的提取路径保存训练所需的 token / hidden states 等信息。',
        'target execution → hidden states',
      ],
      [
        '外部训练',
        'Speculators 项目训练专用草稿，本主仓并不包含所有训练内部实现。',
        'dataset → external training',
      ],
      [
        '导出标准格式',
        '按兼容格式保存模型、配置和权重，供推理侧识别。',
        'trained drafter → checkpoint',
      ],
      [
        '接入验证循环',
        '加载适配的草稿并执行目标验证，收益需用实际工作负载测试。',
        'checkpoint → speculative inference',
      ],
    ],
    [
      'docs/features/speculative_decoding/speculators.md',
      'vllm/v1/spec_decode/extract_hidden_states.py',
    ],
  );
}
