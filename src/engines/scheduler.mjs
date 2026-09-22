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

export function scheduleTrace(options = {}) {
  const o = { budget: 8, capacity: 16, blockSize: 4, chunked: true, ...options };
  const requests = validateRequests(o.requests || exampleRequests).map((r) => ({
    ...r,
    computed: 0,
    output: 0,
    status: '未到达',
    blocks: [],
    preemptions: 0,
    recomputeUntil: 0,
  }));
  let free = Array.from({ length: o.capacity }, (_, i) => i),
    active = [];
  const frames = [];
  for (let tick = 0; tick < 256; tick++) {
    const before = structuredClone(requests),
      events = [],
      allocations = [],
      preempted = new Set();
    requests
      .filter((r) => r.arrival === tick)
      .forEach((r) => {
        r.status = '等待';
        events.push(`${r.id} 到达：${r.prompt} 个 prompt token`);
      });
    let remaining = o.budget;
    const candidates = [
      ...active,
      ...requests.filter((r) => r.status === '等待').sort((a, b) => a.arrival - b.arrival),
    ];
    for (const r of candidates) {
      if (!remaining || r.status === '已完成' || preempted.has(r.id)) continue;
      const demand = r.prompt + r.output - r.computed;
      const count = Math.min(demand, remaining);
      if (!o.chunked && r.computed < r.prompt && demand > remaining) {
        events.push(`${r.id} 的完整 prefill 超过剩余预算，暂缓`);
        continue;
      }
      const blocksNeeded = Math.ceil((r.computed + count) / o.blockSize) - r.blocks.length;
      while (blocksNeeded > free.length) {
        const victim = [...active]
          .reverse()
          .find((v) => v !== r && !allocations.some((a) => a.id === v.id));
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
      }
      if (blocksNeeded > free.length) {
        events.push(`${r.id} 等待空闲 KV 块`);
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
      remaining -= count;
      r.computed = to;
      r.status = '运行';
      if (to >= r.recomputeUntil) r.recomputeUntil = 0;
      if (!active.includes(r)) active.push(r);
      if (r.computed === r.prompt + r.output) {
        r.output++;
        events.push(`${r.id} 生成第 ${r.output} 个输出 token（新 token 的 KV 留待下轮计算）`);
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
    if (requests.every((r) => r.status === '已完成')) break;
    if ((!allocations.length && requests.every((r) => r.arrival <= tick)) || tick === 255) {
      frames.at(-1).blocked = true;
      frames
        .at(-1)
        .events.push(
          tick === 255
            ? '达到教学模拟上限，未完成请求仍被保留'
            : '当前配置无法继续推进，请增加预算或 KV 容量',
        );
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
