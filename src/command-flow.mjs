import { parseCommand } from './command-parser.mjs';

export const commandExamples = [
  {
    name: '单卡入门',
    note: '同步调度，观察完整主链',
    command: 'vllm serve Qwen/Qwen3-0.6B --no-async-scheduling --enforce-eager',
  },
  {
    name: 'TP + 前缀复用',
    note: '双卡张量并行与分块 Prefill',
    command:
      'vllm serve Qwen/Qwen3-8B \\\n  --tensor-parallel-size 2 --distributed-executor-backend mp \\\n  --enable-prefix-caching --enable-chunked-prefill \\\n  --max-num-batched-tokens 2048',
  },
  {
    name: '投机解码',
    note: 'N-gram 提议与批量校验',
    command: `vllm serve Qwen/Qwen3-0.6B --no-async-scheduling \\\n  --speculative-config '{"method":"ngram","num_speculative_tokens":4}'`,
  },
  {
    name: 'LoRA 服务',
    note: '区分启用能力与请求选择',
    command: 'vllm serve Qwen/Qwen3-0.6B --enable-lora --max-loras 2 --max-lora-rank 16',
  },
  {
    name: '向量请求',
    note: 'Pooling 路径，无逐 token 采样循环',
    command: 'vllm serve intfloat/e5-small-v2 --runner pooling --enforce-eager',
  },
  {
    name: 'KV 传输',
    note: '连接器与远端命中条件',
    command: `vllm serve Qwen/Qwen3-0.6B \\\n  --kv-transfer-config '{"kv_connector":"NixlConnector","kv_role":"kv_both"}'`,
  },
];

const node = (id, title, source, why, detail, status = 'core') => ({
  id,
  title,
  source,
  why,
  detail,
  status,
});
const row = (main, branches = []) => ({ ...main, branches });
const describe = (value) => (typeof value === 'object' ? JSON.stringify(value) : String(value));
const reason = (options, key, fallback) =>
  Object.hasOwn(options, key) ? `--${key} = ${describe(options[key])}` : fallback;

/** Produce a logical, source-backed route, not a runtime call trace. */
export function analyzeCommand(command, scenario = {}) {
  const parsed = parseCommand(command),
    o = parsed.options;
  const result = { ...parsed, startup: [], request: [], skipped: [], facts: [], scenario: null };
  if (result.errors.length) return result;
  const fail = (message) => result.errors.push(message);
  const warn = (message) => result.warnings.push(message);
  const tp = o['tensor-parallel-size'] ?? 1,
    pp = o['pipeline-parallel-size'] ?? 1,
    dp = o['data-parallel-size'] ?? 1;
  const spec = structuredClone(o['speculative-config'] || {});
  for (const [flag, field] of [
    ['spec-method', 'method'],
    ['spec-model', 'model'],
    ['spec-tokens', 'num_speculative_tokens'],
  ]) {
    if (o[flag] !== undefined) {
      if (spec[field] !== undefined)
        fail(`--${flag} 与 --speculative-config 中的 ${field} 不能同时指定。`);
      spec[field] = o[flag];
    }
  }
  const hasSpec = Object.keys(spec).length > 0;
  if (
    spec.num_speculative_tokens !== undefined &&
    (!Number.isSafeInteger(spec.num_speculative_tokens) || spec.num_speculative_tokens <= 0)
  )
    fail('投机 token 数 num_speculative_tokens 必须是正整数。');
  if (spec.method !== undefined && typeof spec.method !== 'string')
    fail('投机解码 method 必须是字符串。');
  if (spec.method === 'ngram' && o['async-scheduling'] === true)
    fail('此版本的 ngram 投机解码不支持显式 --async-scheduling；请使用 --no-async-scheduling。');
  if (o.headless && (o['api-server-count'] > 0 || o['data-parallel-hybrid-lb']))
    fail('--headless 不能同时启用 API server 或 hybrid LB。');
  if (o['data-parallel-size-local'] > dp)
    fail('--data-parallel-size-local 不能超过 --data-parallel-size。');
  if (o['data-parallel-rank'] >= dp) fail('--data-parallel-rank 必须小于 --data-parallel-size。');
  if (o['data-parallel-external-lb'] && dp <= 1)
    fail('--data-parallel-external-lb 要求 --data-parallel-size 大于 1。');
  const externalLB = !!o['data-parallel-external-lb'] || o['data-parallel-rank'] !== undefined;
  const hybridLB =
    !!o['data-parallel-hybrid-lb'] ||
    (!o['data-parallel-multi-port-external-lb'] && o['data-parallel-start-rank'] !== undefined);
  if (
    [externalLB, hybridLB, !!o['data-parallel-multi-port-external-lb']].filter(Boolean).length > 1
  )
    fail('外部、混合、多端口 DP 负载均衡模式不能同时启用。');
  if (o['enable-auto-tool-choice'] && !o['tool-call-parser'])
    fail('--enable-auto-tool-choice 需要 --tool-call-parser。');
  if (o['lora-modules'] && !o['enable-lora'])
    warn('配置了 --lora-modules，但未显式启用 --enable-lora，请核对服务配置。');
  if (o['enable-eplb'] && !o['enable-expert-parallel'] && !o.config)
    fail('--enable-eplb 需要同时启用 --enable-expert-parallel。');
  if (o['max-num-batched-tokens'] < o['max-num-seqs'])
    fail('--max-num-batched-tokens 必须大于或等于 --max-num-seqs。');
  if (
    o['enable-chunked-prefill'] === false &&
    o['max-model-len'] > 0 &&
    o['max-num-batched-tokens'] < o['max-model-len']
  )
    fail('关闭分块 Prefill 时，--max-num-batched-tokens 不能小于 --max-model-len。');
  const runnerEnv = parsed.env.VLLM_USE_V2_MODEL_RUNNER;
  if (runnerEnv !== undefined && !['0', '1'].includes(runnerEnv))
    fail('VLLM_USE_V2_MODEL_RUNNER 在此工具中接受 0 或 1。');
  const runner = runnerEnv === '0' ? 'v1' : runnerEnv === '1' ? 'v2' : 'auto';
  const kind =
    scenario.kind && scenario.kind !== 'auto'
      ? scenario.kind
      : o.runner === 'pooling'
        ? 'embedding'
        : 'chat';
  if (!['chat', 'completion', 'embedding'].includes(kind)) fail('未知请求类型。');
  if (o.runner === 'pooling' && kind !== 'embedding')
    fail('--runner pooling 不能处理文本生成请求，请选择向量请求。');
  if (o.runner === 'generate' && kind === 'embedding')
    fail('--runner generate 不能处理向量请求，请选择生成请求。');
  if (o.runner === 'draft') warn('--runner draft 是草稿模型用途，未绘制面向用户的请求主链。');
  if (o.runner === 'pooling' && hasSpec)
    warn('Pooling 与投机解码的组合未建模，请核对 SpeculativeConfig 的实际约束。');
  if (o['scheduler-cls'] || o['worker-cls'])
    warn('使用自定义 Scheduler / Worker；请求图停在实现选择处，不推测插件内部调用。');
  if (o.grpc || o.omni || parsed.env.VLLM_USE_RUST_FRONTEND === '1')
    warn('该命令切换了 gRPC / Omni / Rust 入口；当前仅定位入口分流，未绘制该前端内部路径。');
  if (result.errors.length) return result;

  const pooling = kind === 'embedding';
  const headless = !!o.headless || o['api-server-count'] === 0;
  const asyncMode =
    o['async-scheduling'] ??
    (o.runner === 'pooling' || spec.method === 'ngram' || spec.disable_padded_drafter_batch === true
      ? false
      : 'auto');
  const eager = o['enforce-eager'] === true;
  const graphOff = eager || ['none', 'NONE', 0].includes(o['compilation-config']?.cudagraph_mode);
  const compileOff = eager || ['none', 'NONE', 0].includes(o['compilation-config']?.mode);
  const executor = o['distributed-executor-backend'] || (tp * pp * dp === 1 ? 'uni' : 'auto');
  const budget = o['max-num-batched-tokens'] ?? '按硬件确定';
  result.scenario = { kind, headless, pooling, runner, asyncMode, executor };
  result.facts = [
    ['模型', o.model || 'Qwen/Qwen3-0.6B（本地默认）'],
    ['并行规模', `TP ${tp} · PP ${pp} · DP ${dp}`],
    ['执行器', executor === 'auto' ? '自动选择 mp / ray / 平台实现' : executor],
    ['Token 预算', budget],
    [
      'Runner 实现',
      runner === 'auto' ? '由模型 / 平台校验决定' : `环境变量选择 MR${runner.toUpperCase()}`,
    ],
  ];
  const startup = result.startup;
  startup.push(
    row(
      node(
        'entry',
        '启动入口与进程布局',
        parsed.entry === 'python' ? 'python' : 'cli',
        parsed.entry === 'python' ? 'python -m API server' : 'vllm serve',
        parsed.entry === 'python'
          ? '兼容入口直接运行 API server；其部署分流行为与 vllm serve 入口不同。'
          : headless
            ? '仅启动引擎进程，不提供本进程 HTTP API。'
            : `读取模型名，决定 API server 数量与 DP 部署方式；DP=${dp}。`,
      ),
    ),
  );
  if (o.grpc || o.omni || parsed.env.VLLM_USE_RUST_FRONTEND === '1') return result;
  if (parsed.entry === 'python' && (headless || o['api-server-count'] > 1)) {
    warn(
      'Python API server 入口未经过 ServeSubcommand.cmd；此处仅定位入口，不推导 headless / 多前端部署。请改用 vllm serve 命令进行这类部署分析。',
    );
    return result;
  }
  startup.push(
    row(
      node(
        'configuration',
        '生成并校验引擎配置',
        'config',
        'EngineArgs → VllmConfig',
        '合并模型、并行、缓存、调度等配置。模型文件和实际设备尚未读取，图中的自动分支需要运行时确认。',
      ),
      [
        node(
          'validate',
          '兼容性与默认值',
          'validation',
          '显式参数 + 模型能力 + 平台',
          '例如异步调度、CUDA Graph、投机算法互相制约；本工具不替代完整配置校验。',
          'conditional',
        ),
        node(
          'auto-cache',
          '缓存 / 切块的默认开关',
          'defaults',
          '未指定时检查模型能力',
          '不能只看 CacheConfig 字段初值判断最终是否启用。',
          'conditional',
        ),
      ],
    ),
  );
  if (hasSpec)
    startup
      .at(-1)
      .branches.push(
        node(
          'spec-config',
          '校验投机解码配置',
          'speculative',
          '--speculative-config / --spec-*',
          '确定草稿方法、模型与候选长度；最终还要进行 Runner 与硬件兼容性检查。',
          'explicit',
        ),
      );
  startup.push(
    row(
      node(
        'executor-init',
        '选择执行器并创建引擎',
        'executor',
        reason(
          o,
          'distributed-executor-backend',
          executor === 'uni' ? '并行规模默认为 1 → uni' : '并行规模 > 1 → 结合设备与 Ray 环境选择',
        ),
        '执行器负责把模型任务交给一个或多个 Worker；具体设备与自定义插件仍由运行环境决定。',
        o['distributed-executor-backend'] ? 'explicit' : 'core',
      ),
      [
        node(
          'parallel-config',
          '并行拓扑与后端',
          'parallel',
          `TP=${tp} / PP=${pp} / DP=${dp}`,
          'TP 分张量，PP 分层，DP 复制引擎；三者改变的边界不同。',
          tp * pp * dp > 1 ? 'explicit' : 'core',
        ),
        node(
          'engine-client',
          headless ? '启动无前端引擎' : '建立异步引擎客户端',
          headless ? 'headless' : 'engine',
          headless ? '--headless / --api-server-count 0' : 'AsyncLLM.from_vllm_config',
          '初始化引擎通信、请求输入和结果处理。',
        ),
      ],
    ),
  );
  const loading = [];
  if (o.quantization && o.quantization !== 'None')
    loading.push(
      node(
        'quant',
        '选择量化实现',
        'quantization',
        `--quantization=${o.quantization}`,
        '按量化方法选配置，再检查模型权重、精度和硬件是否兼容。',
        'explicit',
      ),
    );
  else
    loading.push(
      node(
        'auto-quant',
        '模型是否自带量化配置？',
        'quantization',
        '读取模型配置后才能判断',
        '未指定 --quantization 不等于一定不量化。',
        'conditional',
      ),
    );
  loading.push(
    node(
      'attention-choice',
      '选择 Attention 后端',
      'attention',
      reason(o, 'attention-config', '按硬件、dtype、head size、KV 布局选择'),
      '启动时选实现；请求在模型层内使用它计算注意力。',
      'conditional',
    ),
  );
  if (o['cpu-offload-gb'] > 0)
    loading.push(
      node(
        'offload',
        '权重 CPU 卸载配置',
        'loader',
        `--cpu-offload-gb=${o['cpu-offload-gb']}`,
        '加载阶段建立相应权重访问策略，实际传输取决于模型执行。',
        'explicit',
      ),
    );
  startup.push(
    row(
      node(
        'load',
        '加载模型与权重',
        'loader',
        reason(o, 'load-format', '--load-format 默认 auto'),
        `${reason(o, 'dtype', 'dtype 默认 auto')}；通过模型注册与加载器建立实际模型。`,
      ),
      loading,
    ),
  );
  startup.push(
    row(
      node(
        'kv-init',
        '规划并分配 KV Cache',
        'kvInit',
        reason(o, 'gpu-memory-utilization', '先做内存探测，再计算缓存块数'),
        `${reason(o, 'block-size', '块大小由后端决定')}；${reason(o, 'kv-cache-dtype', 'KV 精度默认 auto')}。`,
      ),
      o['kv-transfer-config']
        ? [
            node(
              'connector-init',
              '创建 KV Connector',
              'transfer',
              '--kv-transfer-config',
              '配置连接器角色、通信和传输元数据。',
              'explicit',
            ),
          ]
        : [],
    ),
  );
  startup.push(
    row(
      node(
        'warmup',
        '预热并准备模型执行',
        'warmup',
        eager ? '--enforce-eager' : '编译配置与运行平台共同决定',
        eager
          ? '关闭 torch.compile 与 CUDA Graph，仍有模型预热流程。'
          : `torch.compile：${compileOff ? '配置关闭' : '待校验'}；CUDA Graph：${graphOff ? '配置关闭' : '待校验 / 按形状捕获'}。`,
        eager ? 'explicit' : 'core',
      ),
    ),
  );
  if (!headless)
    startup.push(
      row(
        node(
          'http-ready',
          '注册 API 并提供服务',
          'routers',
          `${o.host || '默认 host'}:${o.port || 8000}`,
          '根据支持的模型任务注册路由；请求到达后进入下方请求处理链。',
        ),
      ),
    );
  if (o.runner === 'draft') return result;

  const request = result.request;
  if (!headless)
    request.push(
      row(
        node(
          'api',
          pooling ? '接收向量请求' : kind === 'completion' ? '接收文本补全请求' : '接收对话请求',
          kind,
          pooling
            ? '/v1/embeddings（示例）'
            : kind === 'completion'
              ? '/v1/completions（示例）'
              : '/v1/chat/completions（示例）',
          'API 路径由请求决定，启动命令只决定服务能力；上方可切换本次观察的请求类型。',
        ),
      ),
    );
  if (!headless)
    request.push(
      row(
        node(
          'prepare',
          '预处理并送入 AsyncLLM',
          'async',
          '请求 → EngineCoreRequest',
          pooling ? '处理输入与 Pooling 参数。' : '检查模型、渲染模板 / 分词，整理采样和停止条件。',
        ),
        [
          node(
            'input-validation',
            '输入检查与处理',
            'input',
            reason(o, 'max-model-len', '上下文上限由模型配置决定'),
            '检查 prompt 长度、任务类型、采样或 Pooling 参数。',
          ),
          node(
            'multimodal',
            '带图片 / 音视频的输入',
            'input',
            reason(o, 'limit-mm-per-prompt', '仅在模型与请求都包含多模态时'),
            '限额只是输入约束；不表示每个请求都会执行视觉 / 音频编码器。',
            'conditional',
          ),
        ],
      ),
    );
  if (!headless && dp > 1)
    request.push(
      row(
        node(
          'data-parallel',
          externalLB || o['data-parallel-multi-port-external-lb']
            ? '外部负载均衡选择 DP 实例'
            : '为请求选择 DP 引擎',
          externalLB || o['data-parallel-multi-port-external-lb'] ? 'cli' : 'dp',
          `--data-parallel-size=${dp}${externalLB ? '；外部 LB' : hybridLB ? '；混合 LB' : ''}`,
          externalLB || o['data-parallel-multi-port-external-lb']
            ? '上游选择服务实例；此处不能假定内部 DPLB 客户端再次分配。'
            : '内部负载均衡把请求分配给引擎副本。',
          'explicit',
        ),
      ),
    );
  request.push(
    row(
      node(
        'enqueue',
        headless ? '接收外部前端发来的引擎请求' : '请求进入 EngineCore 队列',
        'queue',
        headless ? '本节点没有 HTTP API server' : '引擎通信 → add_request',
        '请求进入调度器等待队列；到这里还没有开始模型计算。',
      ),
    ),
  );
  if (o['scheduler-cls'] || o['worker-cls']) {
    request.push(
      row(
        node(
          'custom',
          '进入自定义 Scheduler / Worker',
          o['scheduler-cls'] ? 'schedulerChoice' : 'executor',
          o['scheduler-cls'] || o['worker-cls'],
          '插件可能改变全部后续路径，请从配置的类继续阅读。',
          'conditional',
        ),
      ),
    );
    return result;
  }
  const scheduling = [
    node(
      'scheduler-choice',
      asyncMode === false
        ? '同步 Scheduler'
        : asyncMode === true
          ? 'AsyncScheduler'
          : '异步 / 同步调度选择',
      asyncMode === true ? 'asyncSchedule' : 'schedulerChoice',
      reason(
        o,
        'async-scheduling',
        asyncMode === false
          ? 'Pooling / ngram / drafter 约束关闭异步'
          : '兼容的模型、算法、执行器才默认启用异步',
      ),
      '异步调度复用 Scheduler 的核心资源分配逻辑，让 CPU 准备与模型执行重叠。',
      typeof asyncMode === 'boolean' && o['async-scheduling'] !== undefined
        ? 'explicit'
        : 'conditional',
    ),
  ];
  if (o['enable-chunked-prefill'] !== false)
    scheduling.push(
      node(
        'chunked',
        '按预算分块 Prefill',
        'schedule',
        reason(o, 'enable-chunked-prefill', '模型支持时默认启用'),
        `本轮 token 预算：${budget}。长 prompt 可分轮进入，与 Decode 请求共享预算。`,
        o['enable-chunked-prefill'] ? 'explicit' : 'conditional',
      ),
    );
  else result.skipped.push('分块 Prefill：命令显式关闭');
  if (o['enable-prefix-caching'] !== false)
    scheduling.push(
      node(
        'prefix-cache',
        '查询可复用的前缀块',
        'prefix',
        reason(o, 'enable-prefix-caching', '模型支持时默认启用'),
        '开关启用后仍需前缀 hash / salt 匹配，并且缓存块已就绪；是否命中取决于请求历史。',
        o['enable-prefix-caching'] ? 'explicit' : 'conditional',
      ),
    );
  else result.skipped.push('前缀缓存：命令显式关闭');
  request.push(
    row(
      node(
        'scheduler',
        '决定这一轮算哪些 token',
        'schedule',
        `max_num_batched_tokens=${budget} · max_num_seqs=${o['max-num-seqs'] ?? '按环境确定'}`,
        '结合运行中 / 等待请求、可用 KV 空间与预算，生成 SchedulerOutput。',
      ),
      scheduling,
    ),
  );
  const transfer = o['kv-transfer-config'];
  request.push(
    row(
      node(
        'kv-allocation',
        '分配本轮 KV Cache 块',
        'allocate',
        'Scheduler 调用 KVCacheManager',
        '把 token 位置映射到物理块；空间不足时可能触发抢占与后续重算。',
      ),
      transfer
        ? [
            node(
              'kv-transfer',
              '加载远端 KV（条件分支）',
              'kvLoad',
              `连接器：${transfer.kv_connector || '待指定'}；角色：${transfer.kv_role || '待指定'}`,
              transfer.kv_role === 'kv_producer'
                ? 'producer 主要产出 / 发送 KV，不能据此断言发生远端加载；抽象接口由具体连接器实现。'
                : '只有远端匹配、角色允许且传输完成后才复用；连接器实现决定等待与同步方式。',
              'conditional',
            ),
          ]
        : [],
    ),
  );
  request.push(
    row(
      node(
        'execute',
        '提交批次给执行器',
        pp > 1 || asyncMode === true ? 'batchStep' : asyncMode === false ? 'step' : 'batchStep',
        `执行器：${executor}；PP=${pp}；异步=${asyncMode}`,
        asyncMode === 'auto'
          ? '开启异步 / 多批次时走 step_with_batch_queue，否则走 step；由初始化时的批次并发配置选择。'
          : pp > 1 || asyncMode
            ? '批次队列容纳并行或异步中的在途批次。'
            : '调度、模型执行、更新按单轮顺序推进。',
      ),
      [
        node(
          'execution-backend',
          '执行器分派',
          'executor',
          reason(o, 'distributed-executor-backend', '查看 Executor.get_class 的后端分支'),
          'uni / mp / ray / external_launcher 或自定义 Executor；硬件 Worker 由平台决定。',
        ),
      ],
    ),
  );
  const runnerNodes = [];
  if (runner === 'auto')
    runnerNodes.push(
      node(
        'runner-selection',
        '选择 MRV1 / MRV2',
        'runnerChoice',
        '环境变量未固定 Runner',
        '检查 Triton、平台、模型架构与不兼容特性，再进入下方一种实现。',
        'conditional',
      ),
    );
  if (runner !== 'v2')
    runnerNodes.push(
      node(
        'model-v1',
        'Model Runner V1',
        'runnerV1',
        runner === 'v1' ? 'VLLM_USE_V2_MODEL_RUNNER=0' : '不满足 MRV2 支持条件时回退',
        'GPU 路径：准备输入、Attention 元数据并执行模型。',
        runner === 'v1' ? 'explicit' : 'conditional',
      ),
    );
  if (runner !== 'v1')
    runnerNodes.push(
      node(
        'model-v2',
        'Model Runner V2',
        'runnerV2',
        runner === 'v2' ? 'VLLM_USE_V2_MODEL_RUNNER=1' : 'Triton、模型、平台与特性检查通过时',
        'GPU 路径：管理请求状态与输入，执行模型；与 V1 为互斥实现。',
        runner === 'v2' ? 'explicit' : 'conditional',
      ),
    );
  request.push(
    row(
      node(
        'model',
        'Worker 执行模型前向',
        'worker',
        '此图展开 GPU Worker 路径',
        'GPU Worker 把批次交给所选 Model Runner。CPU / TPU / 插件设备实现可能不同；图不假设已经检测到 GPU。',
        'conditional',
      ),
      runnerNodes,
    ),
  );
  const features = [];
  if (tp > 1)
    features.push(
      node(
        'tensor-parallel',
        'TP：分片计算与归并',
        'tp',
        `--tensor-parallel-size=${tp}`,
        '例如 RowParallelLinear 在各 rank 计算局部结果后归并；具体模型决定分片层。',
        'explicit',
      ),
    );
  if (pp > 1)
    features.push(
      node(
        'pipeline-parallel',
        'PP：阶段间传递张量',
        'pp',
        `--pipeline-parallel-size=${pp}`,
        '不同 Worker 持有不同层，阶段间传递中间张量；最后阶段产生模型输出。',
        'explicit',
      ),
    );
  if (o['enable-expert-parallel'])
    features.push(
      node(
        'expert-parallel',
        'EP：专家层并行',
        'ep',
        '--enable-expert-parallel',
        '仅对包含 MoE 专家层的模型有意义；具体 dispatch / combine 由后端决定。',
        'conditional',
      ),
    );
  if (o['enable-eplb'])
    features.push(
      node(
        'expert-balance',
        'EPLB：专家负载均衡',
        'eplb',
        '--enable-eplb',
        '依赖 MoE / EP 与统计窗口；不会在每次前向都重排专家。',
        'conditional',
      ),
    );
  if (o['enable-lora'])
    features.push(
      node(
        'lora-active',
        '激活请求的 LoRA 适配器',
        'lora',
        '--enable-lora',
        '服务已允许 LoRA；请求仍需选中已加载的适配器，基础模型请求不会自动用上 LoRA。',
        'conditional',
      ),
    );
  else result.skipped.push('LoRA：未显式启用');
  if (!graphOff)
    features.push(
      node(
        'cuda-graph',
        '按形状使用 CUDA Graph',
        'warmup',
        reason(o, 'compilation-config', '编译 / Graph 默认策略 + 平台能力'),
        '捕获发生在准备阶段；符合捕获形状的批次可回放，否则走普通执行路径。',
        'conditional',
      ),
    );
  else result.skipped.push(`CUDA Graph：${eager ? '--enforce-eager' : 'cudagraph_mode=none'} 关闭`);
  // These are collaborators inside model execution, not sequential calls after it.
  request.at(-1).branches.push(...features);
  if (pooling) {
    request.push(
      row(
        node(
          'pool',
          '聚合为向量输出',
          runner === 'v1' ? 'poolV1' : 'poolV2',
          '--runner pooling / 向量请求',
          '模型 hidden states 交给 Pooler；通常不走逐 token 采样与 Decode 循环。',
          o.runner === 'pooling' ? 'explicit' : 'conditional',
        ),
        runner === 'auto'
          ? [
              node(
                'pool-v1',
                'MRV1 的 Pooling 实现',
                'poolV1',
                'Runner 选择 V1 时',
                '与主节点的 MRV2 实现互斥。',
                'conditional',
              ),
            ]
          : [],
      ),
    );
  } else {
    const sampling = [
      node(
        'grammar',
        '应用结构化输出约束',
        'structured',
        reason(o, 'structured-outputs-config', '请求带 JSON schema / grammar 等约束时'),
        '后端配置不等于启用每个请求的 grammar；只对有约束的请求构建 token mask。',
        'conditional',
      ),
    ];
    if (hasSpec)
      sampling.push(
        node(
          'speculation',
          '草稿提议与目标模型校验',
          runner === 'v1' ? 'sampleV1' : 'sampleV2',
          `投机方法：${spec.method || '根据草稿模型判断'}；候选数：${spec.num_speculative_tokens ?? '待确定'}`,
          '模型批量校验候选；接受数量由实际输出决定，拒绝时回退。点击查看所选 / 候选 Runner 的采样与草稿衔接代码。',
          'explicit',
        ),
      );
    else result.skipped.push('投机解码：未显式配置（模型内置配置仍需启动时核对）');
    if (runner === 'auto')
      sampling.push(
        node(
          'sample-v1',
          'MRV1 的采样入口',
          'sampleV1',
          'Runner 选择 V1 时',
          '主节点展示 MRV2；两种 Runner 都可能根据投机配置走拒绝采样。',
          'conditional',
        ),
      );
    request.push(
      row(
        node(
          'sampling',
          hasSpec ? '采样 / 校验并提交输出 token' : '根据 logits 采样 token',
          runner === 'v1' ? 'sampleV1' : 'sampleV2',
          '温度、top-p、停止条件来自请求与生成配置',
          '此处不是由服务启动参数决定单个请求的实际 token；默认实现仍取决于 Runner 选择。',
        ),
        sampling,
      ),
    );
  }
  request.push(
    row(
      node(
        'update-state',
        '更新请求进度与缓存状态',
        'update',
        pooling ? 'Pooling 结果返回调度器' : '输出 token / 已计算位置回传调度器',
        pooling
          ? '请求完成后释放相关资源。'
          : '未达到停止条件 → 回到调度；完成 → 释放 KV 引用并输出最终状态。',
      ),
    ),
  );
  if (!headless)
    request.push(
      row(
        node(
          'output',
          pooling ? '整理向量结果' : '反分词与增量结果处理',
          'output',
          'EngineCoreOutputs → RequestOutput',
          '将引擎输出分发给对应前端请求。',
        ),
      ),
    );
  if (!headless && pooling)
    request.push(
      row(
        node(
          'response',
          '返回 Embedding 响应',
          'embeddingOutput',
          '完成向量请求',
          '按编码方式返回向量与 token 使用信息。',
        ),
      ),
    );
  else if (!headless)
    request.push(
      row(
        node(
          'response',
          '返回 API 响应',
          kind === 'chat' ? 'full' : 'completionFull',
          'stream 取值由请求决定',
          '非流式请求在完成后返回；流式请求逐步发送增量结果。',
        ),
        [
          node(
            'stream-response',
            '流式 SSE 返回',
            kind === 'chat' ? 'stream' : 'completionStream',
            '请求 stream=true 时',
            '这是请求参数分支，不能从 vllm serve 命令单独判断。',
            'conditional',
          ),
        ],
      ),
    );
  result.warnings.push(
    '这是依据本地源码推导的逻辑处理链；需要模型配置、运行平台和请求内容才能确定的节点已标为条件分支。',
  );
  return result;
}

export const allFlowNodes = (analysis) =>
  [...analysis.startup, ...analysis.request].flatMap((item) => [item, ...item.branches]);
