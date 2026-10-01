import { scheduleTrace } from './scheduler.mjs';
import { cacheTrace, grammarTrace } from './cache.mjs';
import { speculativeTrace } from './speculative.mjs';
import { tensorParallelTrace, pipelineTrace, moeTrace } from './parallel.mjs';

const copy = (x) => structuredClone(x);
const frame = (frames, state, stepIndex, event) => frames.push(copy({ ...state, stepIndex, events: [event] }));

export function schedulerObservation(options) {
  const events = [];
  const rounds = scheduleTrace(options, (f) => events.push(f));
  const frames = [];
  for (const round of rounds) {
    let previous = round.before;
    for (const event of events.filter((f) => f.tick === round.tick)) {
      frames.push({ ...event, before: copy(previous), blocksDuring: event.requests.map((r) => ({ id: r.id, blocks: [...r.blocks] })), usedDuring: event.capacity - event.free.length, used: event.allocations.reduce((n, a) => n + a.count, 0), budget: options.budget ?? 8, stepIndex: 1, phase: event.kind });
      previous = event.requests;
    }
    frames.push({ ...round, before: copy(previous), phase: 'round-end', roundEnd: true });
  }
  // Preserve all round results for large workloads; the URL supports 256 frames.
  return frames.length <= 256 ? frames : rounds.map((f) => ({ ...f, phase: 'round-end', roundEnd: true }));
}

export function pagedObservation(options) {
  const base = cacheTrace(false, options), frames = base.slice(0, 2).map(copy);
  const state = copy(base[1]);
  state.address = null;
  for (let position = 0; position < 12; position++) {
    const logical = Math.floor(position / 4), offset = position % 4, physical = state.requests[0].blocks[logical];
    state.address = { operation: '写', position, logical, offset, physical, slot: physical * 4 + offset };
    state.requests[0].computed = position + 1;
    state.physical.find((p) => p.id === physical).ready = offset === 3;
    frame(frames, state, 2, `写 token ${position}：逻辑块 ${logical} → 物理块 ${physical} → slot ${state.address.slot}。`);
  }
  Object.assign(state, copy(base[2]));
  for (let position = 0; position < 12; position++) {
    const logical = Math.floor(position / 4), offset = position % 4, physical = state.requests[0].blocks[logical];
    state.address = { operation: '读', position, logical, offset, physical, slot: physical * 4 + offset };
    frame(frames, state, 3, `读 token ${position}：块表[${logical}]=${physical}，slot=${physical}×4+${offset}=${state.address.slot}。`);
  }
  frames.push(copy(base[4]));
  return frames;
}

export function prefixObservation(options) {
  const base = cacheTrace(true, options), frames = [copy(base[0]), copy(base[1])];
  const state = copy(base[2]);
  state.lookups = [];
  state.logitsReady = false;
  state.hashKeys = [0, 1, 2].map((i) => `H(parent=${i ? 'H' + (i - 1) : 'root'},tokens=${i * 4}…${i * 4 + 3},salt=A)`);
  // Names represent a chained hash contract, not a cryptographic implementation.
  for (let logical = 0; logical < 3; logical++) {
    const hit = logical < state.result.blocks;
    state.lookups.push({ logical, key: state.hashKeys[logical], hit, physical: hit ? [2, 5, 1][logical] : null, reason: options.salt ? 'salt 不同' : !options.prefixEnabled ? '缓存关闭' : hit ? '完整块命中' : '不完整共享 / 末尾 logits 留算' });
    frame(frames, state, 2, `查找 B 逻辑块 ${logical}：${hit ? '命中 #' + [2, 5, 1][logical] : '未命中'}；查询阶段引用计数保持 1。`);
  }
  Object.assign(state, copy(base[3]));
  frame(frames, state, 3, `绑定 B 块表，${state.result.blocks} 个命中块引用计数从 1 增至 2。`);
  for (let position = state.result.hit; position < 12; position++) {
    state.requests[1].computed = position + 1;
    state.computed = position + 1 - state.result.hit;
    state.remaining = 12 - position - 1;
    frame(frames, state, 4, `B 执行未命中位置 ${position}；末尾位置 11 保留前向以获得输出 logits。`);
  }
  Object.assign(state, copy(base[4]));
  state.logitsReady = true;
  frame(frames, state, 4, '尾部 KV 与末尾 logits 均完成；缓存命中不等于可以跳过所有前向。');
  return frames;
}

export function speculativeObservation(options) {
  const base = speculativeTrace(options), final = base.at(-1), frames = [];
  const state = { ...copy(final), candidates: final.candidates.map((c) => ({ ...copy(c), state: '待验证' })), accepted: 0, committed: [], checked: 0 };
  frame(frames, state, 0, base[0].events[0]);
  frame(frames, state, 1, base[1].events[0]);
  for (let i = 0; i < final.candidates.length; i++) {
    const candidate = state.candidates[i];
    state.checked = i + 1;
    candidate.state = candidate.accepted ? '接受' : '拒绝';
    if (candidate.accepted) state.accepted++;
    else state.candidates.slice(i + 1).forEach((c) => { c.state = '丢弃'; });
    frame(frames, state, 2, `位置 ${i + 1}：u=${candidate.u.toFixed(3)}，接受阈值=${candidate.probability.toFixed(3)} → ${candidate.state}${candidate.accepted ? '' : '；后续草稿全部丢弃，不再检验'}。`);
    if (!candidate.accepted) break;
  }
  frame(frames, state, 3, base[3].events[0]);
  Object.assign(state, copy(final));
  frame(frames, state, 4, base[4].events[0]);
  return frames;
}

export function tensorObservation(options) {
  const base = tensorParallelTrace(options.ranks), state = copy(base[0]), frames = [];
  state.progress = state.shards.map(() => 0);
  state.partialNow = state.shards.map(() => [0, 0]);
  state.reduction = [0, 0];
  state.reducedRanks = [];
  frame(frames, state, 0, base[0].events[0]);
  for (let column = 0; column < state.shards[0].input.length; column++) {
    state.shards.forEach((shard, rank) => {
      state.progress[rank]++;
      for (let row = 0; row < 2; row++) state.partialNow[rank][row] += shard.input[column] * shard.weights[row][column];
    });
    frame(frames, state, 1, `各 rank 同步累加局部列 ${column} 的 x×W；部分和尚未归并。`);
  }
  for (const shard of state.shards) {
    state.reducedRanks.push(shard.rank);
    state.reduction = state.reduction.map((v, row) => v + state.partialNow[shard.rank][row]);
    frame(frames, state, 2, `观察归并贡献 rank ${shard.rank}：累计 [${state.reduction}]。这不是网络 All-reduce 算法时序。`);
  }
  frame(frames, state, 3, `归并完成，各 rank 看到相同输出 [${state.output}]。`);
  return frames;
}

export function pipelineObservation(options) {
  return pipelineTrace(options.ranks, options.microbatches).map((f) => ({ ...f, pipelinePhase: f.tick < f.ranks - 1 ? '填充' : f.tick < f.batches ? '稳态' : '排空', handoffs: f.stages.filter((s) => s.rank > 0 && s.batch !== null).map((s) => ({ batch: s.batch, from: s.rank - 1, to: s.rank, completedAt: f.tick - 1 })), hasSteady: f.batches >= f.ranks }));
}

export function moeObservation(options) {
  const base = moeTrace(options.ranks), state = copy(base[0]), frames = [];
  state.routeProgress = [];
  frame(frames, state, 0, base[0].events[0]);
  for (const t of state.tokens) {
    state.routeProgress.push({ token: t.id, phase: 'dispatch' });
    frame(frames, state, 1, `T${t.id} 从 rank ${t.origin} 分发到 ${t.routes.map((r) => 'rank ' + r.rank + ' / E' + r.expert).join('、')}；身份保持 T${t.id}。`);
  }
  state.routeProgress.forEach((p) => { p.phase = 'compute'; });
  frame(frames, state, 2, base[2].events[0]);
  for (const t of state.tokens) {
    state.routeProgress.find((p) => p.token === t.id).phase = 'combined';
    frame(frames, state, 3, `T${t.id} 返回 rank ${t.origin}：${t.routes.map((r) => r.weight.toFixed(3) + '×' + r.value).join('+')}=${t.output.toFixed(3)}。`);
  }
  return frames;
}

export function structuredObservation(options) {
  const value = options.grammarValue === 1 ? '模型' : 'vLLM';
  return grammarTrace().map((f, i) => ({ ...f, prefix: f.prefix.replace('vLLM', value), previous: f.previous.replace('vLLM', value), grammarState: ['schema', 'object-start', 'field-name', 'colon', 'string-value', 'object-end', 'finished'][i], excluded: ['{', '"name"', ':', '"vLLM"', '"模型"', '}', '42', '[]', 'EOS'].filter((x) => !f.allowed.includes(x)) }));
}

export const observationTraces = { scheduler: schedulerObservation, chunked: schedulerObservation, paged: pagedObservation, prefix: prefixObservation, speculative: speculativeObservation, tp: tensorObservation, pp: pipelineObservation, moe: moeObservation, structured: structuredObservation };
