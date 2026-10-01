import { mechanismDefaults } from '../mechanism-parameters.mjs';
const record = (frames, state, stepIndex, event) => frames.push(structuredClone({ ...state, stepIndex, events: [event] }));

export function dboTrace(input = {}) {
  const o = { ...mechanismDefaults, ...input }, frames = [];
  const stages = [['准备', 'compute', o.dboCompute], ['Dispatch', 'comm', o.dboComm], ['MLP', 'compute', o.dboCompute], ['Combine', 'comm', o.dboComm]];
  const jobs = [], free = { compute: 0, comm: 0 }, dependencies = { A: 0, B: 0 };
  let serial = 0;
  const add = (batch, phase) => {
    const [name, lane, duration] = stages[phase];
    const start = o.dboOverlap ? Math.max(free[lane], dependencies[batch]) : serial, end = start + duration;
    jobs.push({ id: `${batch}${phase}`, batch, phase, name, lane, start, end, status: 'pending' });
    free[lane] = end;
    dependencies[batch] = end;
    serial = end;
  };
  if (o.dboOverlap) for (let phase = 0; phase < 4; phase++) for (const batch of ['A', 'B']) add(batch, phase);
  else for (const batch of ['A', 'B']) for (let phase = 0; phase < 4; phase++) add(batch, phase);
  const state = { jobs, time: 0, done: [], status: '两个 microbatch 就绪', total: Math.max(...jobs.map((j) => j.end)), serialTotal: 4 * (o.dboCompute + o.dboComm) };
  record(frames, state, 0, '教学批次拆成 A / B；每批准备 → Dispatch → MLP → Combine，按完成事件保留依赖。');
  const events = jobs.flatMap((job) => [{ time: job.start, id: job.id, kind: 'start' }, { time: job.end, id: job.id, kind: 'end' }]).sort((a, b) => a.time - b.time || (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === 'end' ? -1 : 1));
  for (const event of events) {
    const job = state.jobs.find((j) => j.id === event.id);
    state.time = event.time;
    job.status = event.kind === 'start' ? 'running' : 'done';
    if (event.kind === 'end' && job.phase === 3) state.done.push(job.batch);
    state.status = `${job.batch} · ${job.name}${event.kind === 'start' ? '开始' : '完成'}`;
    record(frames, state, event.kind === 'end' && job.lane === 'comm' ? 3 : job.phase, `t=${event.time}：${state.status}；同一资源不重叠，下游只在本批依赖完成后执行。`);
  }
  state.status = '两个 microbatch 完成交付';
  record(frames, state, 3, `教学完成时隙 ${state.total}；串行对照 ${state.serialTotal}。真实 DBO 的收益需要实测。`);
  return frames;
}

export function dpScore(engine, clientCount = 1) {
  return Math.max(clientCount * engine.inflight, engine.waiting + engine.running) + (engine.waiting ? engine.waiting * 6 * Math.max(0, engine.usage - 0.5) : 0);
}
export function dataParallelTrace(input = {}) {
  const o = { ...mechanismDefaults, ...input }, frames = [];
  const state = {
    engines: Array.from({ length: o.dpRanks }, (_, rank) => ({ rank, waiting: rank === 0 ? o.dpBacklog : 0, running: 0, usage: rank === 0 ? o.dpKvPressure / 100 : 0.3, inflight: 0, requests: [] })),
    routes: [], scanStart: 0, scores: [], selected: null, status: 'DP 副本就绪', returned: [],
  };
  record(frames, state, 0, '每个 DP 副本维护独立请求队列；rank 0 可预设其他请求的积压，当前客户端有六个新请求。');
  for (let i = 0; i < 6; i++) {
    state.scores = state.engines.map((engine) => dpScore(engine));
    let chosen = 0;
    if (!o.dpPinned) {
      let min = Infinity;
      for (let offset = 0; offset < state.engines.length; offset++) {
        const index = (state.scanStart + offset) % state.engines.length;
        if (state.scores[index] < min) { min = state.scores[index]; chosen = index; }
      }
    }
    const engine = state.engines[chosen], id = `R${i + 1}`;
    state.selected = chosen;
    state.routes.push({ id, rank: chosen, scores: [...state.scores], scanStart: state.scanStart });
    if (!o.dpPinned) { engine.waiting++; state.scanStart = (state.scanStart + 1) % state.engines.length; }
    engine.inflight++;
    engine.requests.push(id);
    state.status = `${id} → DP ${chosen}`;
    record(frames, state, 1, o.dpPinned ? `${id} 显式指定 rank 0，跳过负载选择；仍记录请求归属与 in-flight。` : `${id} 选择最低分副本 ${chosen}；同分按本次起点 ${state.routes.at(-1).scanStart} 扫描，下一请求旋转起点。`);
  }
  state.engines.forEach((engine) => { engine.waiting = engine.requests.length + (engine.rank === 0 ? o.dpBacklog : 0); });
  state.status = '示例协调器刷新统计';
  state.scores = state.engines.map((engine) => dpScore(engine));
  record(frames, state, 2, '协调器快照与客户端 in-flight 是两个数据来源；这里刷新一次统计，不模拟生产 100ms 轮询。');
  for (const route of state.routes) {
    const engine = state.engines[route.rank];
    engine.requests = engine.requests.filter((id) => id !== route.id);
    engine.inflight--;
    state.returned.push({ ...route });
    state.status = `${route.id} 结果返回`;
    record(frames, state, 3, `${route.id} 从 DP ${route.rank} 返回原客户端，并扣减该副本 in-flight；快照等待下一次刷新。`);
  }
  state.status = '六个新请求完成';
  record(frames, state, 3, '新请求全部归还；rank 0 的预设背景积压不在本次执行范围内。');
  return frames;
}

export function disaggregatedTrace(input = {}) {
  const o = { ...mechanismDefaults, ...input }, frames = [];
  const count = Math.ceil(o.disaggTokens / 4);
  const state = {
    blocks: Array.from({ length: count }, (_, id) => ({ id, tokens: Math.min(4, o.disaggTokens - id * 4), produced: false, valid: false })),
    pending: null, time: 0, producedTokens: 0, receivedTokens: 0, chunks: 0, ack: false, failed: false, output: [], status: 'P / D 实例就绪',
    single: { computed: 0, valid: false, output: [], transfers: 0 },
  };
  record(frames, state, 0, 'P 执行 Prefill、D 等待请求所需 KV；元数据必须关联到同一请求 / 缓存布局。');
  for (const block of state.blocks) {
    block.produced = true;
    state.producedTokens += block.tokens;
    state.single.computed += block.tokens;
    state.status = `P 已生成 KV ${block.id}`;
    record(frames, state, 1, `示例块 ${block.id} 含 ${block.tokens} 个位置；末块可部分填充，先准备元数据再传输。`);
  }
  state.single.valid = true;
  state.single.output.push('示例下一 token');
  record(frames, state, 1, '单实例对照：同样的 Prompt 已计算，直接消费本实例有效 KV，无需跨实例传输；这里只比较逻辑依赖。');
  for (let start = 0; start < count; start += o.disaggChunk) {
    const ids = state.blocks.slice(start, start + o.disaggChunk).map((b) => b.id);
    state.pending = { ids, progress: 0, duration: o.disaggDelay };
    state.status = 'KV 传输中';
    record(frames, state, 2, `提交块 ${ids.join(', ')} 的教学分组传输，完成通知前 D 副本不可读取。`);
    for (let tick = 0; tick < o.disaggDelay; tick++) {
      state.time++;
      state.pending.progress++;
      record(frames, state, 2, `传输进度 ${state.pending.progress}/${o.disaggDelay}；仍等待完成确认。`);
    }
    if (o.disaggFail && start + o.disaggChunk >= count) {
      state.failed = true;
      state.pending = null;
      state.status = '最后一组传输失败 · D 被阻塞';
      record(frames, state, 3, '注入最后一组传输失败，保留已完成块；没有完整有效 KV，禁止开始 Decode。');
      return frames;
    }
    for (const id of ids) { state.blocks[id].valid = true; state.receivedTokens += state.blocks[id].tokens; }
    state.chunks++;
    state.pending = null;
    state.status = '分组传输已确认';
    record(frames, state, 3, `确认块 ${ids.join(', ')} 有效；D 已得到 ${state.receivedTokens}/${o.disaggTokens} 个位置。`);
  }
  state.ack = state.blocks.every((b) => b.valid);
  state.status = '完整 KV 就绪 · 允许 Decode';
  record(frames, state, 3, '全部请求 KV 与完成通知就绪，解除 D 的读依赖。');
  state.output.push('示例下一 token');
  state.status = 'D 产生一枚教学输出';
  record(frames, state, 3, 'D 消费已传入 KV，产生一枚占位输出；不模拟模型计算或连接器底层网络协议。');
  return frames;
}
export const distributedTraces = { dbo: dboTrace, dp: dataParallelTrace, disagg: disaggregatedTrace };
