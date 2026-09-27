import { mechanismDefaults } from '../mechanism-parameters.mjs';

const snapshot = (frames, state, stepIndex, event, extra = {}) =>
  frames.push(structuredClone({ ...state, ...extra, stepIndex, events: [event] }));

export function lifecycleTrace(input = {}) {
  const o = { ...mechanismDefaults, ...input },
    frames = [];
  const state = {
    prompt: Array.from({ length: o.lifePrompt }, (_, i) => 100 + i),
    output: [],
    delivered: [],
    computed: 0,
    blocks: [],
    scheduled: [],
    status: '输入就绪',
    round: 0,
  };
  snapshot(frames, state, 0, '示例 token ID 已准备好；这里不运行真实 tokenizer。');
  state.status = '等待调度';
  snapshot(frames, state, 1, '请求 A 连同输出上限进入引擎队列。');
  for (let i = 0; i < o.lifeOutput; i++) {
    state.round = i + 1;
    const target = state.prompt.length + state.output.length;
    state.scheduled = Array.from({ length: target - state.computed }, (_, n) => state.computed + n);
    state.blocks = Array.from({ length: Math.ceil(target / 4) }, (_, n) => n);
    state.status = i === 0 ? 'Prefill' : 'Decode';
    snapshot(
      frames,
      state,
      2,
      `第 ${state.round} 轮分配 ${state.blocks.length} 个 KV 块；安排 ${state.scheduled.length} 个计算位置。`,
    );
    state.computed = target;
    snapshot(
      frames,
      state,
      3,
      `模型前向写入位置 ${state.scheduled.join(', ')} 的 KV；本轮输出还没有产生。`,
    );
    const eos = o.lifeEosAt > 0 && i + 1 === o.lifeEosAt;
    state.output.push(eos ? 2 : 201 + i);
    snapshot(
      frames,
      state,
      4,
      `采样得到 ${eos ? 'EOS' : 201 + i}；新 token 的 KV 需要下一轮前向计算。`,
    );
    if (!eos) state.delivered.push(201 + i);
    state.status = eos ? 'EOS 停止' : i + 1 === o.lifeOutput ? '达到输出上限' : '继续生成';
    snapshot(
      frames,
      state,
      5,
      eos ? 'EOS 触发停止，输出流结束。' : `向客户端交付第 ${state.delivered.length} 个示例输出。`,
    );
    if (eos) break;
  }
  state.blocks = [];
  state.computed = 0;
  state.scheduled = [];
  snapshot(frames, state, 5, '结束请求，释放 KV 块；已交付的输出保留。', { released: true });
  return frames;
}

export function runnerTrace(input = {}) {
  const o = { ...mechanismDefaults, ...input },
    frames = [];
  const records = {
    A: { token: 101, position: 8, blocks: [0, 3, 6] },
    B: { token: 201, position: 4, blocks: [1, 4] },
    C: { token: 301, position: 6, blocks: [2, 5, 9] },
    D: { token: 401, position: 2, blocks: [7] },
  };
  let slots = [null, null, null, null];
  const state = {
    version: o.runnerV2 ? 'MRV2' : 'MRV1',
    round: 0,
    slots,
    previous: [],
    order: [],
    packed: [],
    results: [],
    removed: [],
  };
  for (let round = 0; round < 3; round++) {
    const active =
      round === 0
        ? ['A', 'B', 'C']
        : ['C', 'A', ...(o.runnerFinishB ? [] : ['B']), ...(o.runnerAddD ? ['D'] : [])];
    const order = o.runnerReverse ? [...active].reverse() : active;
    Object.assign(state, {
      round: round + 1,
      order,
      packed: [],
      results: [],
      previous: [...slots],
      removed: slots.filter((id) => id && !active.includes(id)),
    });
    snapshot(
      frames,
      state,
      0,
      `本轮计划顺序 ${order.join(' → ')}；完成的请求 ${state.removed.join(', ') || '无'}。`,
    );
    if (o.runnerV2) {
      slots = slots.map((id) => (active.includes(id) ? id : null));
      for (const id of active) if (!slots.includes(id)) slots[slots.indexOf(null)] = id;
    } else slots = [...order, ...Array(4 - order.length).fill(null)];
    state.slots = [...slots];
    snapshot(
      frames,
      state,
      1,
      o.runnerV2
        ? '请求保留各自持久行；完成释放的行可被新请求使用。'
        : '为本轮模型输入调整持久 batch 的连续行顺序。',
    );
    state.packed = order.map((id, index) => ({
      id,
      index,
      slot: slots.indexOf(id),
      token: records[id].token,
      position: records[id].position,
      blocks: records[id].blocks.slice(0, Math.ceil((records[id].position + 1) / 4)),
    }));
    snapshot(
      frames,
      state,
      2,
      o.runnerV2
        ? '按本轮顺序 gather 各持久行，生成紧凑输入。'
        : '持久 batch 的本轮顺序直接对应输入；按位置整理 token 和块表。',
    );
    state.results = state.packed.map((row) => ({
      id: row.id,
      token: row.token + 1,
      index: row.index,
    }));
    snapshot(frames, state, 3, '设备输出按本轮请求映射返回，不按旧的行号猜测请求身份。');
    for (const id of order) {
      records[id].token++;
      records[id].position++;
    }
  }
  return frames;
}

export function asyncTrace(input = {}) {
  const o = { ...mechanismDefaults, ...input },
    tasks = [];
  let cpuEnd = 0,
    gpuEnd = 0,
    outputEnd = 0;
  for (let batch = 0; batch < 3; batch++) {
    const prepareStart = o.asyncEnabled ? cpuEnd : outputEnd;
    cpuEnd = prepareStart + o.cpuCost;
    const executeStart = Math.max(cpuEnd, gpuEnd);
    gpuEnd = executeStart + o.gpuCost;
    outputEnd = Math.max(gpuEnd, outputEnd) + 1;
    tasks.push({
      batch,
      prepareStart,
      prepareEnd: cpuEnd,
      executeStart,
      executeEnd: gpuEnd,
      outputStart: outputEnd - 1,
      outputEnd,
    });
  }
  return Array.from({ length: outputEnd + 1 }, (_, tick) => {
    const preparing = tasks.find((t) => t.prepareStart <= tick && tick < t.prepareEnd);
    const executing = tasks.find((t) => t.executeStart <= tick && tick < t.executeEnd);
    const returned = tasks.filter((t) => t.outputEnd <= tick).map((t) => t.batch);
    const ready = tasks
      .filter((t) => t.prepareEnd <= tick && tick < t.executeStart)
      .map((t) => t.batch);
    const completedNow = tasks.find((t) => t.outputEnd === tick);
    const event = completedNow
      ? `批次 ${completedNow.batch + 1} 的结果已交付。`
      : preparing && executing
        ? `CPU 准备 ${preparing.batch + 1}，GPU 同时执行 ${executing.batch + 1}。`
        : executing
          ? `GPU 执行批次 ${executing.batch + 1}；未完成的结果不能提前消费。`
          : preparing
            ? `CPU 准备批次 ${preparing.batch + 1} 的独立输入。`
            : '等待完成事件与输出交付。';
    return {
      tick,
      total: outputEnd,
      tasks,
      preparing: preparing?.batch ?? null,
      executing: executing?.batch ?? null,
      returned,
      ready,
      stepIndex:
        tick === 0 ? 0 : completedNow || tick === outputEnd ? 3 : preparing && executing ? 2 : 1,
      events: [event],
    };
  });
}

export function hybridTrace(input = {}) {
  const o = { ...mechanismDefaults, blockSize: 4, ...input },
    frames = [];
  const state = { position: -1, skip: 0, full: [], window: [], freed: [], pendingFree: [], ssm: 0 };
  let nextPhysical = 0;
  const reusable = [];
  snapshot(frames, state, 0, '识别完整注意力、窗口注意力和示例状态空间层。');
  snapshot(frames, state, 1, `完整历史与窗口缓存分组管理；每个块容纳 ${o.blockSize} 个位置。`);
  for (let q = 0; q < o.contextTokens; q++) {
    state.position = q;
    state.skip = Math.max(0, q - o.windowSize + 1);
    state.freed = [];
    const logical = Math.floor(q / o.blockSize);
    if (!state.full.includes(logical)) state.full.push(logical);
    if (!state.window.some((b) => b.logical === logical))
      state.window.push({ logical, physical: reusable.length ? reusable.shift() : nextPhysical++ });
    state.pendingFree = state.window
      .filter((b) => (b.logical + 1) * o.blockSize <= state.skip)
      .map((b) => b.logical);
    state.ssm = Number((0.5 * state.ssm + q + 1).toFixed(4));
    snapshot(
      frames,
      state,
      2,
      `位置 ${q} 读取 [${state.skip}, ${q}] 的窗口；块内仍有有效位置时不能整块释放。`,
    );
    state.freed = state.window.filter((b) => state.pendingFree.includes(b.logical));
    reusable.push(...state.freed.map((b) => b.physical));
    state.window = state.window.filter((b) => !state.pendingFree.includes(b.logical));
    state.pendingFree = [];
    snapshot(
      frames,
      state,
      3,
      state.freed.length
        ? `本步读写完成，回收 ${state.freed.map((b) => 'W' + b.physical).join('、')}，供后续逻辑块复用。`
        : '本步读写完成，没有可以整块回收的窗口缓存。',
    );
  }
  return frames;
}

export function beamProbabilities(tokens, bias) {
  const last = tokens.at(-1),
    depth = tokens.length;
  const logits = [
    (last === 'B' ? 1 : 1.5) + bias * 0.15,
    last === 'A' ? 1.8 : 1.1,
    depth >= 2 ? 1.6 : -1.8,
  ];
  const values = logits.map((x) => Math.exp(x - Math.max(...logits))),
    sum = values.reduce((a, b) => a + b, 0);
  return ['A', 'B', 'EOS'].map((token, i) => ({ token, p: values[i] / sum }));
}
// The pinned implementation counts the prompt in seq_len and excludes the final EOS.
const beamPromptLength = 2;
const beamScore = (node, penalty) =>
  node.logp / (beamPromptLength + node.tokens.filter((t) => t !== 'EOS').length) ** penalty;
export function beamTrace(input = {}) {
  const o = { ...mechanismDefaults, seed: 42, ...input },
    frames = [];
  let active = [{ id: 'root', tokens: [], logp: 0, score: 0 }],
    completed = [];
  let randomState = o.seed >>> 0;
  const random = () => {
    randomState = (Math.imul(1664525, randomState) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  const samples = Array.from({ length: o.beamWidth }, (_, i) => ({
    id: 'S' + (i + 1),
    tokens: [],
    done: false,
  }));
  const state = {
    depth: 0,
    promptLength: beamPromptLength,
    parents: [],
    candidates: [],
    kept: active,
    completed: [],
    samples,
    results: [],
  };
  snapshot(frames, state, 0, '从同一个前缀开始；候选概率来自可调的三词教学分布。');
  for (let depth = 1; depth <= o.beamDepth && active.length; depth++) {
    const parents = active;
    const children = parents.flatMap((parent) =>
      beamProbabilities(parent.tokens, o.beamBias).map(({ token, p }) => {
        const child = {
          id: parent.id + '-' + token,
          parent: parent.id,
          tokens: [...parent.tokens, token],
          logp: parent.logp + Math.log(p),
          p,
          status: '候选',
        };
        return { ...child, score: beamScore(child, o.beamPenalty) };
      }),
    );
    for (const sample of samples.filter((s) => !s.done)) {
      const u = random();
      let sum = 0;
      const choice = beamProbabilities(sample.tokens, o.beamBias).find((c) => (sum += c.p) > u);
      sample.tokens.push(choice.token);
      sample.done = choice.token === 'EOS';
    }
    Object.assign(state, { depth, parents, candidates: children, kept: [], completed, samples });
    snapshot(frames, state, 1, `每个存活分支扩展 A、B、EOS，得到 ${children.length} 个候选。`);
    const sorted = children
      .filter((c) => c.tokens.at(-1) !== 'EOS')
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    active = sorted.slice(0, o.beamWidth);
    completed = [...completed, ...children.filter((c) => c.tokens.at(-1) === 'EOS')].sort(
      (a, b) => b.score - a.score,
    );
    state.candidates = children.map((c) => ({
      ...c,
      status:
        c.tokens.at(-1) === 'EOS' ? '完成' : active.some((a) => a.id === c.id) ? '保留' : '剪枝',
    }));
    state.kept = active;
    state.completed = completed;
    snapshot(
      frames,
      state,
      2,
      `保留最多 ${o.beamWidth} 个未结束分支；EOS 候选进入完成集合，不再展开。`,
    );
  }
  state.results = [...active, ...completed].sort((a, b) => b.score - a.score).slice(0, o.beamWidth);
  snapshot(frames, state, 3, '达到长度上限后合并存活与已完成候选，按长度归一化得分返回结果。');
  return frames;
}

export function dynamicSpecTrace(input = {}) {
  const o = { ...mechanismDefaults, ...input },
    frames = [];
  const schedule = [
    { min: 1, max: o.sdLow, k: o.sdKLow },
    { min: o.sdLow + 1, max: o.sdHigh, k: o.sdKMid },
    { min: o.sdHigh + 1, max: 512, k: o.sdKHigh },
  ];
  const loads = [
    o.sdBatch,
    Math.min(512, Math.ceil(o.sdBatch * 1.5)),
    Math.max(1, Math.floor(o.sdBatch / 2)),
    1,
  ];
  loads.forEach((batch, round) => {
    const interval = schedule.findIndex((row) => row.min <= batch && batch <= row.max);
    const state = {
      round: round + 1,
      batch,
      schedule,
      interval: -1,
      k: null,
      candidates: [],
      loads,
    };
    snapshot(frames, state, 0, `第 ${round + 1} 轮观察到并发数 ${batch}。`);
    state.interval = interval;
    state.k = schedule[interval].k;
    snapshot(
      frames,
      state,
      1,
      `匹配闭区间 [${schedule[interval].min}, ${schedule[interval].max}]，选择 K=${state.k}。`,
    );
    state.candidates = Array.from({ length: state.k }, (_, i) => 'd' + (i + 1));
    snapshot(
      frames,
      state,
      2,
      state.k
        ? `每请求准备 ${state.k} 个草稿候选，全批共 ${state.k * batch} 个草稿位置。`
        : 'K=0，不产生草稿；目标模型仍按普通解码路径执行。',
    );
    snapshot(frames, state, 3, '本轮结束，下一轮按新的并发数重新查询同一张配置表。');
  });
  return frames;
}
