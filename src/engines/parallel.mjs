export function tensorParallelTrace(ranks = 2) {
  const x = Array.from({ length: 12 }, (_, i) => (i % 3) + 1);
  const weights = [x.map((_, i) => (i % 2 ? 2 : 1)), x.map((_, i) => (i % 3) - 1)];
  const width = 12 / ranks;
  const shards = Array.from({ length: ranks }, (_, rank) => {
    const from = rank * width,
      to = from + width,
      input = x.slice(from, to),
      w = weights.map((row) => row.slice(from, to));
    return {
      rank,
      from,
      to,
      input,
      weights: w,
      partial: w.map((row) => row.reduce((sum, v, i) => sum + v * input[i], 0)),
    };
  });
  const output = [0, 1].map((i) => shards.reduce((n, s) => n + s.partial[i], 0));
  return Array.from({ length: 4 }, (_, stepIndex) => ({
    stepIndex,
    x,
    weights,
    shards,
    output,
    events: [
      [
        '沿输入维拆 W[2,12]，每卡持有 W[:, 分片] 与对应 x。',
        '每卡计算局部 yᵣ = xᵣ Wᵣᵀ，得到形状 [1,2] 的部分和。',
        `All-reduce 求和得到 y = [${output}]，结果在各 rank 上一致。`,
        '后续列并行层可继续使用已归并的输入。',
      ][stepIndex],
    ],
  }));
}
export function pipelineTrace(ranks = 2, batches = 3) {
  return Array.from({ length: ranks + batches - 1 }, (_, tick) => ({
    stepIndex: tick === 0 ? 1 : tick >= ranks - 1 ? 3 : 2,
    tick,
    ranks,
    batches,
    stages: Array.from({ length: ranks }, (_, rank) => ({
      rank,
      batch: tick - rank >= 0 && tick - rank < batches ? tick - rank : null,
    })),
    completed: Math.max(0, Math.min(batches, tick - ranks + 2)),
    events: [`逻辑时隙 ${tick + 1}：各段处理不同的独立 microbatch；只有上一段完成后才能交接。`],
  }));
}
export function moeTrace(ranks = 2) {
  const logits = [
    [4, 3, 1, 0],
    [0, 2, 4, 1],
    [3, 0, 1, 4],
    [1, 4, 3, 0],
  ];
  const tokens = logits.map((scores, i) => {
    const selected = scores
      .map((score, expert) => ({ expert, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    const denominator = selected.reduce((n, e) => n + Math.exp(e.score), 0);
    const routes = selected.map((e) => ({
      expert: e.expert,
      rank: e.expert % ranks,
      weight: Math.exp(e.score) / denominator,
      value: (e.expert + 1) * (i + 1),
    }));
    return {
      id: i,
      input: i + 1,
      origin: i % ranks,
      scores,
      routes,
      output: routes.reduce((n, r) => n + r.weight * r.value, 0),
    };
  });
  return Array.from({ length: 4 }, (_, stepIndex) => ({
    stepIndex,
    ranks,
    tokens,
    events: [
      [
        '对每个 token 选 Top-2 专家，并对选中的 softmax 权重重新归一化。',
        '按目标专家所在 rank 分发 token；同卡路径无需跨设备搬运。',
        '示例专家计算 fₑ(x) = (e+1) × x；实际专家通常是 MLP。',
        '把专家输出送回原 rank，按路由权重加权求和。',
      ][stepIndex],
    ],
  }));
}
