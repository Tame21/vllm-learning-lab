export const exampleRequests = [
  { id: 'A', prompt: 8, max: 4, arrival: 0 },
  { id: 'B', prompt: 4, max: 3, arrival: 1 },
  { id: 'C', prompt: 12, max: 3, arrival: 2 },
];

export function validateRequests(requests) {
  if (!Array.isArray(requests) || requests.length < 1 || requests.length > 6)
    throw Error('请设置 1–6 个请求');
  const ids = new Set();
  return requests.map((r) => {
    if (!r || !/^[A-F]$/.test(r.id) || ids.has(r.id)) throw Error('请求 ID 必须为不重复的 A–F');
    ids.add(r.id);
    for (const [key, min, max] of [
      ['prompt', 1, 32],
      ['max', 1, 16],
      ['arrival', 0, 12],
    ]) {
      if (!Number.isInteger(r[key]) || r[key] < min || r[key] > max)
        throw Error(`${r.id}.${key} 应在 ${min}–${max} 之间`);
    }
    return { id: r.id, prompt: r.prompt, max: r.max, arrival: r.arrival };
  });
}

export function scheduleTrace(options = {}, observe = null) {
  const o = { budget: 8, capacity: 16, blockSize: 4, chunked: true, ...options };
  const requests = validateRequests(o.requests || exampleRequests).map((r) => ({
    ...r,
    computed: 0,
    output: 0,
    status: '未到达',
    blocks: [],
    preemptions: 0,
    recomputeUntil: 0,
    priority: o.priorityValues?.[r.id] ?? 0,
  }));
  let free = Array.from({ length: o.capacity }, (_, i) => i),
    active = [];
  const frames = [];
  for (let tick = 0; tick < 256; tick++) {
    const before = structuredClone(requests),
      events = [],
      allocations = [],
      preempted = new Set();
    const emit = (kind, event, extra = {}) =>
      observe?.(
        structuredClone({
          tick,
          kind,
          events: [event],
          requests,
          free,
          capacity: o.capacity,
          allocations,
          ...extra,
        }),
      );
    if (tick === 0) emit('initial', 'A、B、C 等待到达；KV 物理块全部空闲。');
    requests
      .filter((r) => r.arrival === tick && r.status === '未到达')
      .forEach((r) => {
        r.status = '等待';
        events.push(`${r.id} 到达：${r.prompt} 个 prompt token`);
        emit('arrival', events.at(-1));
      });
    if (o.cancelAt > 0 && tick === o.cancelAt) {
      const cancelled = requests.find(
        (r) => r.id === 'B' && !['已完成', '已取消'].includes(r.status),
      );
      if (cancelled) {
        free.push(...cancelled.blocks);
        cancelled.blocks = [];
        cancelled.computed = 0;
        cancelled.recomputeUntil = 0;
        cancelled.status = '已取消';
        active = active.filter((r) => r !== cancelled);
        events.push('轮次边界取消 B，保留已交付输出并释放其 KV 块。');
        emit('cancel', events.at(-1));
      }
    }
    let remaining = o.budget;
    const candidates = [
      ...active,
      ...requests
        .filter((r) => r.status === '等待')
        .sort(
          (a, b) =>
            (o.policy === 'priority' ? a.priority - b.priority : 0) ||
            a.arrival - b.arrival ||
            a.id.localeCompare(b.id),
        ),
    ];
    emit(
      'queue',
      `候选顺序 ${candidates.map((r) => r.id).join(' → ') || '空'}；已运行请求继续，等待队列按策略排序。`,
      { candidateIds: candidates.map((r) => r.id) },
    );
    for (const r of candidates) {
      if (!remaining || ['已完成', '已取消'].includes(r.status) || preempted.has(r.id)) continue;
      const demand = r.prompt + r.output - r.computed;
      const count = Math.min(demand, remaining);
      if (!o.chunked && r.computed < r.prompt && demand > remaining) {
        events.push(`${r.id} 的完整 prefill 超过剩余预算，暂缓`);
        continue;
      }
      const blocksNeeded = Math.ceil((r.computed + count) / o.blockSize) - r.blocks.length;
      while (blocksNeeded > free.length) {
        // Only a running request's allocation failure triggers preemption.
        // The current request can itself be the lowest-priority victim.
        // This synchronous teaching model has already executed earlier allocations.
        const victims = active.includes(r)
          ? active.filter((v) => !allocations.some((a) => a.id === v.id))
          : [];
        const victim =
          o.policy === 'priority'
            ? victims.sort((a, b) => b.priority - a.priority || b.arrival - a.arrival)[0]
            : victims.at(-1);
        if (!victim) break;
        victim.recomputeUntil = Math.max(victim.recomputeUntil, victim.computed);
        free.push(...victim.blocks);
        victim.blocks = [];
        victim.computed = 0;
        victim.status = '等待';
        victim.preemptions++;
        active = active.filter((v) => v !== victim);
        preempted.add(victim.id);
        events.push(
          `显存不足，抢占 ${victim.id}；保留 ${victim.output} 个输出，${victim.recomputeUntil} 个 KV 位置需重算`,
        );
        emit('preempt', events.at(-1), { victim: victim.id });
        if (victim === r) break;
      }
      if (preempted.has(r.id)) continue;
      if (blocksNeeded > free.length) {
        events.push(`${r.id} 等待空闲 KV 块`);
        emit('wait', events.at(-1));
        continue;
      }
      const from = r.computed,
        to = from + count;
      const recompute = Math.max(0, Math.min(to, r.recomputeUntil) - from);
      const prefill = Math.max(0, Math.min(to, r.prompt) - Math.max(from + recompute, 0));
      const decode = count - recompute - prefill;
      while (r.blocks.length < Math.ceil(to / o.blockSize)) r.blocks.push(free.shift());
      const phase = recompute ? '重算' : prefill ? 'prefill' : 'decode';
      allocations.push({
        id: r.id,
        count,
        phase,
        from,
        to,
        recompute,
        prefill,
        decode,
        blocks: [...r.blocks],
      });
      events.push(
        `${r.id} 写入位置 [${from}, ${to})：新 prompt ${prefill}，新 decode ${decode}，重算 ${recompute}`,
      );
      emit(
        'allocate',
        `为 ${r.id} 安排位置 [${from}, ${to})，准备物理块 ${r.blocks.join(', ')}。`,
        { requestId: r.id },
      );
      remaining -= count;
      r.computed = to;
      r.status = '运行';
      if (to >= r.recomputeUntil) r.recomputeUntil = 0;
      if (!active.includes(r)) active.push(r);
      emit(recompute ? 'recompute' : 'compute', events.at(-1), { requestId: r.id });
      if (r.computed === r.prompt + r.output) {
        r.output++;
        events.push(`${r.id} 生成第 ${r.output} 个输出 token（新 token 的 KV 留待下轮计算）`);
        emit('sample', events.at(-1), { requestId: r.id });
      }
    }
    const usedDuring = o.capacity - free.length;
    const blocksDuring = requests.map((r) => ({ id: r.id, blocks: [...r.blocks] }));
    for (const r of [...active])
      if (r.output >= r.max) {
        r.status = '已完成';
        free.push(...r.blocks);
        r.blocks = [];
        active = active.filter((v) => v !== r);
        events.push(`${r.id} 完成，释放 KV 块`);
        emit('finish', events.at(-1), { requestId: r.id });
      }
    frames.push({
      tick,
      before,
      requests: structuredClone(requests),
      allocations,
      events,
      used: o.budget - remaining,
      usedDuring,
      blocksDuring,
      free: [...free],
      budget: o.budget,
      stepIndex: 1,
    });
    if (requests.every((r) => ['已完成', '已取消'].includes(r.status))) break;
    if (
      (!allocations.length && !preempted.size && requests.every((r) => r.arrival <= tick)) ||
      tick === 255
    ) {
      frames.at(-1).blocked = true;
      frames
        .at(-1)
        .events.push(
          tick === 255
            ? '达到教学模拟上限，未完成请求仍被保留'
            : '当前配置无法继续推进，请增加预算或 KV 容量',
        );
      emit('blocked', frames.at(-1).events.at(-1));
      break;
    }
  }
  return frames;
}

export function scheduleMetrics(frames) {
  return {
    rounds: frames.length,
    computed: frames.reduce((n, f) => n + f.used, 0),
    recomputed: frames.flatMap((f) => f.allocations).reduce((n, a) => n + a.recompute, 0),
    peak: Math.max(...frames.map((f) => f.usedDuring)),
    finished: frames.at(-1).requests.filter((r) => r.status === '已完成').length,
    total: frames.at(-1).requests.length,
    blocked: !!frames.at(-1).blocked,
  };
}
