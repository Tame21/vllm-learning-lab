export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
export function choose(distribution, random) {
  const u = random();
  let total = 0;
  for (let i = 0; i < distribution.length; i++) {
    total += distribution[i];
    if (u < total) return i;
  }
  return distribution.length - 1;
}
export function rejectionDecision(p, q, candidate, u) {
  const probability = Math.min(1, p[candidate] / q[candidate]);
  const residual = p.map((v, i) => Math.max(v - q[i], 0));
  const sum = residual.reduce((a, b) => a + b, 0);
  return {
    probability,
    accepted: q[candidate] > 0 && u <= probability,
    residual: sum ? residual.map((v) => v / sum) : [...p],
  };
}
export function speculativeTrace(options = {}) {
  const o = { drafts: 4, quality: 50, seed: 42, ...options };
  const random = seededRandom(o.seed),
    verifier = seededRandom(o.seed ^ 0x9e3779b9);
  const vocabulary = ['甲', '乙', '丙'];
  const targets = [
    [0.1, 0.65, 0.25],
    [0.6, 0.15, 0.25],
    [0.25, 0.25, 0.5],
  ];
  const base = [0.7, 0.2, 0.1],
    fidelity = o.quality / 100;
  const candidates = Array.from({ length: o.drafts }, (_, i) => {
    const p = targets[i % targets.length],
      q = p.map((v, n) => fidelity * v + (1 - fidelity) * base[n]);
    const candidate = choose(q, random),
      u = verifier();
    return {
      position: i + 1,
      p: [...p],
      q,
      candidate,
      word: vocabulary[candidate],
      u,
      ...rejectionDecision(p, q, candidate, u),
    };
  });
  const rejected = candidates.findIndex((c) => !c.accepted);
  const accepted = rejected < 0 ? o.drafts : rejected;
  const recovery =
    rejected < 0 ? targets[o.drafts % targets.length] : candidates[rejected].residual;
  const extra = vocabulary[choose(recovery, verifier)];
  const committed = [...candidates.slice(0, accepted).map((c) => c.word), extra];
  return Array.from({ length: 5 }, (_, stepIndex) => ({
    stepIndex,
    candidates: candidates.map((c, i) => ({
      ...c,
      state: i < accepted ? '接受' : i === accepted ? '拒绝' : '丢弃',
    })),
    accepted,
    rejected,
    recovery,
    extra,
    committed,
    vocabulary,
    events: [
      [
        `使用种子 ${o.seed}，从草稿分布 q 采样 ${o.drafts} 个候选。`,
        '目标模型提供各位置的 p；此处使用可检查的三词示例分布。',
        rejected < 0
          ? '全部候选通过接受检验。'
          : `第 ${rejected + 1} 个候选被拒绝，后续候选全部丢弃。`,
        rejected < 0
          ? '全部接受，从目标 bonus 分布采样额外 token。'
          : '从 max(p−q, 0) 归一化后的分布采样恢复 token。',
        `提交 ${accepted} 个接受 token + 1 个${rejected < 0 ? ' bonus' : '恢复'} token，共 ${committed.length} 个。`,
      ][stepIndex],
    ],
  }));
}
