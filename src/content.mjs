import { bindQuizzes } from './learning.mjs';
import { registerExtras } from './extra-lessons.mjs';
import { bindSources } from './source-map.mjs';
import { registerSpecMethods, specMethods } from './spec-methods.mjs';
export const groups = [
  ['start', '01', '从一个请求开始'],
  ['memory', '02', '调度与显存'],
  ['compute', '03', '模型与执行'],
  ['spec', '04', '投机解码'],
  ['parallel', '05', '多卡与分布式'],
  ['features', '06', '输入与输出'],
  ['ops', '07', '服务与运维'],
  ['extend', '08', '后端与扩展'],
];
export const source = (path, needle = '') => ({ path, needle });
export const step = (title, body, change, ref = 0) => ({ title, body, change, ref });
export const lessons = [];
export function add(id, title, english, group, kind, summary, analogy, steps, refs, extra = {}) {
  lessons.push({ id, title, english, group, kind, summary, analogy, steps, refs, ...extra });
}
const S = step,
  R = source;
add(
  'lifecycle',
  '一个请求的一生',
  'REQUEST LIFECYCLE',
  'start',
  'flow',
  '跟着“解释一下 KV Cache”这个请求，走完从文字到下一段文字的完整路径。',
  '把推理想成餐厅：前台接单，调度器安排出餐顺序，GPU 厨房计算，最后把结果分次送回。',
  [
    S(
      '输入处理',
      'Chat 消息先应用模板，再经 tokenizer 转成 token ID。图中的词块仅作示意，不代表真实分词。',
      '文字 → prompt_token_ids',
      0,
    ),
    S(
      '进入引擎',
      '前端经 EngineCoreClient 把请求传给 EngineCore；请求有自己的 ID、采样参数与状态。',
      'NEW → WAITING',
      1,
    ),
    S(
      '调度与分配',
      'Scheduler 决定这一轮处理多少 token；KVCacheManager 为计算准备物理缓存块。',
      'WAITING → RUNNING；分配 block_ids',
      2,
    ),
    S(
      '模型前向',
      'Executor 经 Worker 调用 Model Runner。Runner 整理输入、位置和 block table，执行模型层。',
      'input_ids + KV → hidden states',
      3,
    ),
    S(
      '采样下一个词',
      'Sampler 对 logits 应用约束与采样策略，产生下一个 token；尚未结束的请求回到下一轮调度。',
      'logits → token ID',
      4,
    ),
    S(
      '输出与结束',
      '输出处理器反分词并形成流式增量。到达停止条件后，调度器回收请求占用的缓存。',
      'token ID → 文本；RUNNING → FINISHED',
      5,
    ),
  ],
  [
    R('vllm/v1/engine/input_processor.py', 'def process_inputs'),
    R('vllm/v1/engine/core_client.py', 'class EngineCoreClient'),
    R('vllm/v1/core/sched/scheduler.py', 'def schedule('),
    R('vllm/v1/worker/gpu_model_runner.py', 'def execute_model('),
    R('vllm/v1/sample/sampler.py', 'class Sampler'),
    R('vllm/v1/engine/output_processor.py', 'class OutputProcessor'),
  ],
  {
    question: '生成一个新 token 后，请求通常去哪里？',
    choices: ['再次参与调度', '重新加载全部模型权重', '立刻释放全部缓存'],
    answer: 0,
    reason: '自回归生成需要继续使用历史 KV；只有达到停止条件或发生取消等事件时才结束请求。',
  },
);
add(
  'prefill',
  'Prefill 与 Decode',
  'TWO PHASES',
  'start',
  'attention',
  '先理解为什么读完整段提示词与逐个生成新词，是两种不同形状的计算。',
  '读题时可以一起看整道题；写答案时，每写一个词都会依赖前面的内容。',
  [
    S(
      '提示词就绪',
      '示例有 8 个 prompt token。初始还没有任何 token 的 KV 被计算。',
      'computed = 0；prompt = 8',
    ),
    S(
      'Prefill 写入',
      '用因果注意力处理 prompt：每个位置只能看自己和前面的 token。为各层写入 K、V。',
      'computed = 8；KV 长度 = 8',
    ),
    S(
      '第一枚输出',
      '完整 prefill 的最后位置产生 logits，采样得到第一个输出 token；它的 KV 尚未计算。',
      'output = 1；KV 仍为 8',
    ),
    S(
      'Decode 复用',
      '把刚生成的 token 输入模型，读取此前缓存的 KV，只增加这个新位置的 KV。',
      'computed = 9；output = 2',
    ),
    S(
      '循环直到结束',
      '每轮追加新位置，直到 EOS、stop 或 max_tokens 等停止条件满足。',
      '每轮通常推进 1 个输出 token',
    ),
  ],
  [
    R('vllm/v1/core/sched/scheduler.py', 'def schedule('),
    R('vllm/v1/attention/backends/flash_attn.py', 'class FlashAttentionBackend'),
  ],
);
add(
  'scheduler',
  '连续批处理',
  'CONTINUOUS BATCHING',
  'memory',
  'scheduler',
  '同一轮里处理多个请求；旧请求一完成，新请求就能加入，整个批次不必等最慢的那个。',
  '公交车在每一站都可以上下客；不是必须等所有乘客到终点才接下一批。',
  [
    S('请求到达', 'A、B、C 在不同的逻辑轮次到达，先进入等待队列。', 'WAITING 队列增加'),
    S(
      '分配预算',
      '每轮 token 预算限制总计算量，max_num_seqs 限制活动请求数。已有 running 请求先尝试分配。',
      'sum(scheduled_tokens) ≤ budget',
    ),
    S(
      '执行混合批次',
      '同一批次可以包含 prompt 的一段与 decode 的一个位置；不是每个请求固定占一个 token。',
      'SchedulerOutput → Model Runner',
    ),
    S(
      '完成即离开',
      '达到输出长度的请求结束并释放其块；剩下的请求继续参加下一轮。',
      'RUNNING → FINISHED',
    ),
    S(
      '新请求补位',
      '下一轮重新构造批次。注意：该模拟简化了异步、lookahead 与多种 cache group。',
      '批次成员随轮次改变',
    ),
  ],
  [
    R('vllm/v1/core/sched/scheduler.py', 'def schedule('),
    R('vllm/v1/core/sched/output.py', 'class SchedulerOutput'),
  ],
  {
    question: '一轮的 token 预算为 8，能否同时调度 6 个 prefill token 和 2 个 decode token？',
    choices: ['可以，只要其他约束也满足', '不可以，prefill 与 decode 永远分开'],
    answer: 0,
    reason: 'V1 按 token 数安排工作。注意显存、活动请求数、encoder 预算等约束仍然生效。',
  },
);
add(
  'chunked',
  '分块预填充',
  'CHUNKED PREFILL',
  'memory',
  'scheduler',
  '把长 prompt 分成几轮处理，观察它如何与正在生成的请求共享 token 预算。',
  '长作业分段做，给短作业留下插入的机会。',
  [
    S(
      '长请求入队',
      '长 prompt 如果一次占满计算资源，其他请求的下一个 token 可能需要等待。',
      'prompt 长度大于一轮剩余预算',
    ),
    S(
      '按预算切块',
      '启用切块后，本轮只安排当前预算能容纳的部分。',
      'scheduled = min(待计算量, 剩余预算)',
    ),
    S(
      '保存中间 KV',
      '这段 prefill 计算出的 KV 留在缓存里，下一轮接着后面的位置计算。',
      'num_computed_tokens 逐轮增加',
    ),
    S(
      '完成 prompt',
      '只有到达 prompt 末尾，才能用相应 logits 生成正常的第一枚输出。',
      'prefill 完成 → 第一枚输出',
    ),
    S('进入 decode', '短请求与长请求的后续 token 继续一起竞争下一轮预算。', '持续批处理继续'),
  ],
  [
    R('vllm/v1/core/sched/scheduler.py', 'num_new_tokens = ('),
    R('vllm/config/scheduler.py', 'enable_chunked_prefill'),
  ],
);
add(
  'paged',
  '分页 KV 缓存',
  'PAGED KV CACHE',
  'memory',
  'cache',
  '把一个请求连续的 token 位置，映射到显存中不必连续的物理块。',
  '一本书的章节是连续的，但它们可以放在不同书架格里；目录记录位置。',
  [
    S(
      '逻辑 token',
      '示例每块容纳 4 个 token。真实 block size 由平台和配置决定。',
      '逻辑块 0 → token 0…3',
    ),
    S(
      '分配物理块',
      '从 BlockPool 获取空闲块，建立请求自己的 block table；不用寻找一大段连续显存。',
      'A 的 block table = [2, 5, 1]',
      1,
    ),
    S(
      '写入 K 与 V',
      'slot mapping 将逻辑位置映射到物理槽位。K、V 按对应层和后端布局写入。',
      'token 6 → block 5，offset 2',
    ),
    S(
      '按表读取',
      'Attention 根据 block table 读取历史 KV，逻辑顺序不受物理分散影响。',
      '逻辑序列顺序保持不变',
    ),
    S(
      '释放与复用',
      '请求结束时降低引用计数；无人占用的块可以复用，已缓存内容可能保留至被淘汰。',
      'ref_cnt → 0；块可回到空闲队列',
      1,
    ),
  ],
  [
    R('vllm/v1/core/kv_cache_manager.py', 'def allocate_slots('),
    R('vllm/v1/core/block_pool.py', 'class BlockPool'),
    R('vllm/v1/worker/block_table.py', 'class BlockTable'),
  ],
);
add(
  'prefix',
  '自动前缀缓存',
  'PREFIX CACHING',
  'memory',
  'prefix',
  '第二个请求有相同前缀时，直接复用已经算好的完整 KV 块，减少重复 prefill。',
  '两个人读同一本书的前几章，可以共用笔记；从内容开始不同的地方各自记。',
  [
    S(
      '第一个请求计算',
      'A 的 prompt 建立 KV，并为完整块生成包含父块信息的 hash。',
      'hash(parent, tokens, extra)',
      1,
    ),
    S(
      '完整块进入缓存',
      '缓存键包含当前块、此前前缀和相关额外信息。A 的 12 token 形成 3 个完整块；B 复用时还需保留末尾计算以获得 logits。',
      'A 的 3 个完整块可查找',
      1,
    ),
    S(
      '第二个请求查找',
      'B 从开头匹配缓存，遇到不同前缀即停止；salt、LoRA、多模态内容也影响命中。',
      'B 命中前 8 个 token',
    ),
    S('共享物理块', '匹配到的 KV 不需要再计算，共享块的引用计数增加。', '共享块 ref_cnt = 2'),
    S(
      '计算剩余部分',
      'B 只计算未命中的尾部。命中主要节省 prefill，decode 本身仍需要执行。',
      '只执行未命中的 prompt 尾部',
    ),
  ],
  [
    R('vllm/v1/core/kv_cache_manager.py', 'def get_computed_blocks('),
    R('vllm/v1/core/kv_cache_utils.py', 'def hash_block_tokens('),
    R('docs/design/prefix_caching.md', 'Extra hashes'),
  ],
  {
    question: '前缀缓存能把所有 decode 计算也跳过吗？',
    choices: ['不能，它主要复用已有 prompt KV', '能，相同 prompt 总返回同一段文本'],
    answer: 0,
    reason: '缓存存的是中间 K、V，并不是完整答案；采样及之后的模型前向仍然执行。',
  },
);
add(
  'speculative',
  '投机解码：猜测与验证',
  'SPECULATIVE DECODING',
  'spec',
  'speculative',
  '先用便宜的方法提出多个候选，再由目标模型验证。观察接受、拒绝和回退的边界。',
  '助理先拟一小段草稿，主编逐个审查；发现错误后，从那里重新接着写。',
  [
    S(
      '提出草稿',
      'Proposer 用当前上下文提出 K 个候选。草稿来源可以是小模型、n-gram 或其他方法。',
      'draft = [今天, 天气, 很, 好]',
      0,
    ),
    S(
      '目标模型验证',
      '目标模型在一次批量前向中计算候选各位置的目标分布。',
      'target logits：K 个验证位置 + bonus',
    ),
    S(
      '接受连续前缀',
      '贪心场景比较目标 argmax；概率场景采用拒绝采样，不能简单比较 token 是否一样。',
      '概率接受率 min(1, p(token) / q(token))',
      1,
    ),
    S(
      '处理第一处拒绝',
      '一旦拒绝，后面的草稿全部丢弃；从校正分布采样恢复 token。全部接受时可以附加 bonus。',
      'recovered ∝ max(p − q, 0)',
      1,
    ),
    S(
      '提交已接受结果',
      '提交正确的 token 前缀，修正计算进度，下一轮重新提出草稿。收益依赖接受率与草稿开销。',
      '本轮提交 = 连续接受数 + 1',
    ),
  ],
  [
    R('vllm/v1/spec_decode/draft_model.py', 'class DraftModelProposer'),
    R('vllm/v1/sample/rejection_sampler.py', 'class RejectionSampler'),
    R('vllm/config/speculative.py', 'class SpeculativeConfig'),
  ],
  {
    question: '第 3 个草稿 token 被拒绝，第 4 个怎么办？',
    choices: ['也被丢弃，因为它依赖错误前缀', '继续保留，只替换第 3 个'],
    answer: 0,
    reason: '自回归候选依赖前缀。第一处拒绝之后的候选不能直接作为确认输出。',
  },
);

registerExtras(add, S, R);
bindSources(lessons);
lessons.sort(
  (a, b) => groups.findIndex((g) => g[0] === a.group) - groups.findIndex((g) => g[0] === b.group),
);
bindQuizzes(lessons);
// Expand the original overview chapters after binding the legacy questions, so
// inserting new lessons does not change saved answer indices for older topics.
registerSpecMethods(lessons);
const specOrder = [
  'speculative',
  ...specMethods.map((m) => m.id),
  'dynamic-spec',
  'adaptive-spec',
  'speculators',
];
lessons.sort((a, b) => {
  const groupOrder =
    groups.findIndex((g) => g[0] === a.group) - groups.findIndex((g) => g[0] === b.group);
  return groupOrder || (a.group === 'spec' ? specOrder.indexOf(a.id) - specOrder.indexOf(b.id) : 0);
});
