export function prefixResult(prefix = 8, salt = false, blockSize = 4) {
  const hit = salt ? 0 : Math.floor(Math.min(prefix, 11) / blockSize) * blockSize;
  return { hit, computed: 12 - hit, blocks: hit / blockSize };
}

export function cacheTrace(isPrefix, options = {}) {
  const o = { prefix: 8, salt: false, prefixEnabled: true, ...options };
  const result = prefixResult(o.prefix, o.salt || !o.prefixEnabled);
  const frames = [];
  for (let step = 0; step < 5; step++) {
    const aReady = isPrefix || step >= 2;
    const aBlocks = isPrefix || (step >= 1 && step < 4) ? [2, 5, 1] : [];
    const bBlocks =
      isPrefix && step >= 3
        ? [0, 1, 2].map((n) => (n < result.blocks ? [2, 5][n] : [7, 8, 9][n]))
        : [];
    const requests = [
      {
        id: 'A',
        computed: aReady ? 12 : 0,
        blocks: aBlocks,
        status: !isPrefix && step === 4 ? '已释放' : '保留',
      },
    ];
    if (isPrefix)
      requests.push({
        id: 'B',
        computed: step === 4 ? 12 : step >= 3 ? result.hit : 0,
        blocks: bBlocks,
        status: step === 4 ? 'KV 就绪' : step >= 3 ? '尾部待写入' : '尚未分配',
      });
    const physical = Array.from({ length: 12 }, (_, id) => {
      const owners = requests.filter((r) => r.blocks.includes(id)).map((r) => r.id);
      const ready = owners.some((owner) => (owner === 'A' ? aReady : step === 4));
      return {
        id,
        owners,
        refs: owners.length,
        ready,
        cached: isPrefix && step >= 1 && [2, 5, 1].includes(id),
        state: owners.length
          ? ready
            ? '已就绪'
            : '已分配 / 待写入'
          : !isPrefix && step === 4 && [2, 5, 1].includes(id)
            ? '已释放'
            : '空闲',
      };
    });
    const events = isPrefix
      ? [
          'A 前向计算 12 个 prompt token，写入 3 个物理块。',
          '完整块建立 hash → 物理块映射；A 仍持有引用。',
          `B 查询得到 ${result.blocks} 个完整命中块；尚未增加引用。`,
          `B 引用 ${result.blocks} 个共享块，并为未命中尾部准备独立块。`,
          `B 写入 ${result.computed} 个未命中位置；B 的全部 12 个 KV 位置就绪。`,
        ]
      : [
          '逻辑 token 就绪，尚未分配物理块。',
          '建立 A 的块表 [2, 5, 1]。',
          '按 slot mapping 写入 K 与 V。',
          'token 6 从物理块 5 的 offset 2 读取。',
          'A 结束，引用计数归零，块可复用。',
        ];
    frames.push({
      stepIndex: step,
      requests,
      physical,
      events: [events[step]],
      hit: isPrefix && step >= 2 ? result.hit : 0,
      computed: isPrefix && step === 4 ? result.computed : 0,
      remaining: isPrefix ? (step === 4 ? 0 : result.computed) : 0,
      shared: step >= 3 ? result.blocks : 0,
      result,
      before: frames.at(-1)?.requests || [],
    });
  }
  return frames;
}

export const teachingSchema = {
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
  additionalProperties: false,
};
export const grammarVocabulary = ['{', '"name"', ':', '"vLLM"', '"模型"', '}', '42', '[]', 'EOS'];
// A finite lexer-level example of the schema above, limited to two string values.
// Actual backends constrain tokenizer IDs and may split one lexeme into many IDs.
export function grammarTrace() {
  const states = [
    { prefix: '', allowed: [], label: '接收 JSON Schema', stepIndex: 0 },
    { prefix: '', allowed: ['{'], label: '编译后，等待对象开始', stepIndex: 1 },
    { prefix: '{', allowed: ['"name"'], label: '对象开始，等待字段名', stepIndex: 2 },
    { prefix: '{"name"', allowed: [':'], label: '字段名就绪，等待冒号', stepIndex: 3 },
    {
      prefix: '{"name":',
      allowed: ['"vLLM"', '"模型"'],
      label: '字段值必须为字符串',
      stepIndex: 3,
    },
    { prefix: '{"name":"vLLM"', allowed: ['}'], label: '必需字段已完成，关闭对象', stepIndex: 3 },
    { prefix: '{"name":"vLLM"}', allowed: ['EOS'], label: '结构完成，允许结束', stepIndex: 4 },
  ];
  return states.map((s, i) => ({
    ...s,
    events: [s.label],
    previous: i ? states[i - 1].prefix : '',
    schema: teachingSchema,
  }));
}
