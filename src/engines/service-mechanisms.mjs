import { mechanismDefaults } from '../mechanism-parameters.mjs';
import { algorithmSources as S } from '../algorithm-sources.mjs';
import { serviceSources } from '../service-sources.mjs';
import { seededRandom, choose } from './speculative.mjs';

const record = (frames, state, stepIndex, event, extra = {}) =>
  frames.push(structuredClone({ ...state, stepIndex, events: [event], ...extra }));
const configured = (input) => ({ ...mechanismDefaults, seed: 42, ...input });

export function modelLoadingTrace(input = {}) {
  const o = configured(input), frames = [], width = o.loadRanks * 2;
  const tensors = Array.from({ length: o.loadLayers }, (_, layer) =>
    ['q_proj', 'o_proj', 'norm'].map((name, n) => ({
      name: `layer.${layer}.${name}`,
      layout: ['column', 'row', 'replicated'][n],
      rows: n === 2 ? 1 : width,
      cols: width,
      shard: (layer * 3 + n) % o.loadShards,
      read: false,
      loaded: [],
      ready: false,
    })),
  ).flat();
  const state = { tensors, width, ranks: o.loadRanks, shards: o.loadShards, activeTensor: 0, activeRank: null, status: '配置就绪' };
  record(frames, state, 0, `教学模型有 ${o.loadLayers} 层，TP=${o.loadRanks}；checkpoint 文件数为 ${o.loadShards}。`);
  state.status = '模型类已解析';
  record(frames, state, 1, '架构注册表解析模型类；这里使用固定示例，不模拟所有模型注册分支。');
  state.status = '加载器就绪';
  record(frames, state, 2, '示例使用默认张量加载路径；checkpoint 文件分片与 TP 权重切片是不同的划分。');
  tensors.forEach((tensor, index) => {
    state.activeTensor = index;
    state.activeRank = null;
    tensor.read = true;
    record(frames, state, 3, `读取 checkpoint 文件 ${tensor.shard} 中的 ${tensor.name}。`);
    for (let rank = 0; rank < o.loadRanks; rank++) {
      const rows = tensor.layout === 'row' ? [rank * 2, rank * 2 + 2] : [0, tensor.rows];
      const cols = tensor.layout === 'column' ? [rank * 2, rank * 2 + 2] : [0, tensor.cols];
      tensor.loaded.push({ rank, rows, cols, elements: (rows[1] - rows[0]) * (cols[1] - cols[0]) });
      state.activeRank = rank;
      record(frames, state, 3, `rank ${rank} 装入 ${tensor.name} 的行 [${rows}]、列 [${cols}]；${tensor.layout === 'replicated' ? '复制完整向量' : '仅保留本 rank 的切片'}。`);
    }
    tensor.ready = true;
    state.activeRank = null;
    record(frames, state, 3, `${tensor.name} 的示例布局处理完成；全部 rank 已就绪。`);
  });
  state.status = '全部权重就绪';
  record(frames, state, 3, '所有示例张量装载完毕；不下载权重、不执行真实加载器或量化 kernel。');
  return frames;
}

// Deterministic teaching uniforms keyed by a two-token context. This is not
// vLLM's Philox PRF and must not be used to generate or verify real watermarks.
export function contextUniforms(context, seed) {
  let key = seed >>> 0;
  for (const token of context) key = Math.imul(key ^ (token + 2), 16777619) >>> 0;
  const random = seededRandom(key);
  return Array.from({ length: 4 }, () => Math.max(1e-9, Math.min(1 - 1e-9, random())));
}
export function gammaSurvival(score, count) {
  if (count <= 0 || score <= 0) return 1;
  let term = 1, sum = 1;
  for (let i = 1; i < count; i++) { term *= score / i; sum += term; }
  return Math.min(1, Math.exp(-score) * sum);
}
export function logitsProcessorTrace(input = {}) {
  const o = configured(input), frames = [], random = seededRandom(o.seed), seen = new Set();
  const state = {
    output: [], raw: [2, 1, 0, -1], processed: [2, 1, 0, -1], probabilities: [],
    counts: [0, 0, 0, 0], context: [-1, -1], uniforms: [], noise: [], race: [],
    selected: null, round: 0, score: 0, scored: 0, pValue: 1, duplicate: false,
  };
  for (let round = 0; round < o.processorTokens; round++) {
    Object.assign(state, { round: round + 1, selected: null, uniforms: [], noise: [], race: [], probabilities: [], processed: [...state.raw], duplicate: false });
    state.context = [-1, -1, ...state.output].slice(-2);
    state.counts = state.raw.map((_, id) => state.output.filter((token) => token === id).length);
    record(frames, state, 0, `请求 A 第 ${state.round} 轮：上下文 [${state.context}]；频次只统计已生成的 token。`);
    state.processed = state.raw.map((value, id) => o.processorBan && id === 3 ? null : value - o.processorPenalty * state.counts[id]);
    const exps = state.processed.map((v) => v === null ? 0 : Math.exp(v - Math.max(...state.processed.filter((n) => n !== null))));
    state.probabilities = exps.map((v) => v / exps.reduce((a, b) => a + b, 0));
    record(frames, state, 1, `分数减去 ${o.processorPenalty} × 生成频次；${o.processorBan ? 'D 被屏蔽，概率为 0' : '全部候选允许采样'}。这是一个教学 processor。`);
    state.uniforms = contextUniforms(state.context, o.seed);
    state.noise = state.uniforms.map((u) => -Math.log(-Math.log(u)));
    state.race = state.processed.map((v, id) => v === null ? null : v + state.noise[id]);
    state.selected = o.processorWatermark
      ? state.race.indexOf(Math.max(...state.race.filter((v) => v !== null)))
      : choose(state.probabilities, random);
    state.output.push(state.selected);
    record(frames, state, 2, o.processorWatermark
      ? `以 logits − log(−log U) 的最大值选中 ${'ABCD'[state.selected]}；屏蔽候选不会参加竞争。`
      : `普通分类采样选中 ${'ABCD'[state.selected]}；下方检测仍使用相同教学 key。`,
    { source: o.processorWatermark ? serviceSources.watermark : serviceSources.sampling });
    const key = state.context.join(',');
    state.duplicate = seen.has(key);
    if (!state.duplicate) {
      seen.add(key);
      state.score += -Math.log1p(-state.uniforms[state.selected]);
      state.scored++;
    }
    state.pValue = gammaSurvival(state.score, state.scored);
    record(frames, state, 3, `${state.duplicate ? '重复上下文不重复计分' : '新上下文加入 −log(1−U) 证据'}；${state.scored} 个去重上下文，教学 p 值 ${state.pValue.toFixed(4)}。`, { source: serviceSources.detection });
  }
  return frames;
}

export const normalizeVector = (vector) => {
  const length = Math.hypot(...vector);
  return length ? vector.map((v) => v / length) : vector.map(() => 0);
};
export function poolingMechanismTrace(input = {}) {
  const o = configured(input), frames = [];
  const hidden = Array.from({ length: o.poolTokens }, (_, i) => [1 + i + o.poolShift, (i % 3) - 1 + o.poolShift]);
  const method = ['MEAN', 'CLS', 'LAST'][o.poolMethod];
  const selected = o.poolMethod === 0 ? hidden.map((_, i) => i) : [o.poolMethod === 1 ? 0 : hidden.length - 1];
  const state = { method, hidden, visible: 0, selected, consumed: [], accumulator: [0, 0], pooled: null, result: null, activeRow: null, normalized: false };
  record(frames, state, 0, `选择 embed 任务与 ${method} 汇聚；仅演示一个序列的二维隐藏状态。`);
  hidden.forEach((_, i) => {
    state.visible = i + 1;
    state.activeRow = i;
    record(frames, state, 1, `示例位置 ${i} 的隐藏向量为 [${hidden[i]}]；数值预先给定，不运行模型。`);
  });
  selected.forEach((i) => {
    state.activeRow = i;
    state.consumed.push(i);
    state.accumulator = state.accumulator.map((v, dim) => v + hidden[i][dim]);
    record(frames, state, 2, `${method === 'MEAN' ? '累加' : '选取'}位置 ${i}，当前向量 [${state.accumulator}]。`, { source: [S.mean, S.cls, S.last][o.poolMethod] });
  });
  state.pooled = state.accumulator.map((v) => v / (method === 'MEAN' ? hidden.length : 1));
  state.activeRow = null;
  record(frames, state, 2, `汇聚完成：${method === 'MEAN' ? `总和除以有效长度 ${hidden.length}` : '保留选中位置'}，得到 [${state.pooled}]。`, { source: [S.mean, S.cls, S.last][o.poolMethod] });
  state.result = o.poolNormalize ? normalizeVector(state.pooled) : [...state.pooled];
  state.normalized = o.poolNormalize;
  record(frames, state, 3, o.poolNormalize ? '按 L2 范数归一化；零向量保持为零。这里不加入 projector 或分类 head。' : '保留未归一化向量；归一化由任务和模型配置决定。', { source: S.normalize });
  record(frames, state, 3, '输出一个 embedding 向量；分类、cross-encoder 与 late interaction 不由本例模拟。');
  return frames;
}

export function promptEmbedsTrace(input = {}) {
  const o = configured(input), frames = [];
  const lookup = Array.from({ length: o.embedTokens }, (_, i) => Array.from({ length: o.embedWidth }, (_, d) => Number(((i + 1) * (d + 1) / 10).toFixed(2))));
  const inputRows = lookup.map((row) => row.map((v, d) => v + (o.embedDirect && d === 0 ? o.embedDelta : 0)));
  const state = { inputRows, lookup, rows: [], positions: [], computed: [], activeRow: null, direct: o.embedDirect, lookups: 0, status: '输入待组织' };
  record(frames, state, 0, `${o.embedDirect ? '预计算向量' : 'token ID'}输入；教学 hidden_size=${o.embedWidth}，实际维度必须匹配模型。`);
  inputRows.forEach((row, i) => {
    state.activeRow = i;
    state.rows.push([...row]);
    if (!o.embedDirect) state.lookups++;
    record(frames, state, 1, o.embedDirect ? `位置 ${i} 直接使用输入向量，不执行对应 embedding 查表。` : `token ${100 + i} 查表得到向量 [${row}]。`);
  });
  inputRows.forEach((_, i) => {
    state.activeRow = i;
    state.positions.push(o.embedPosition + i);
    record(frames, state, 2, `第 ${i} 行向量对应 position ID ${o.embedPosition + i}；位置元数据与向量保持对齐。`);
  });
  inputRows.forEach((_, i) => {
    state.activeRow = i;
    state.computed.push(i);
    record(frames, state, 3, `示例前向处理第 ${i} 行，写入 KV 逻辑槽 ${i}；预计算输入不能省去这一阶段。`);
  });
  state.activeRow = null;
  state.status = '前向完成';
  record(frames, state, 3, '两条输入路径都完成模型前向与 KV 写入；本例只计数位置，不计算真实 Attention 或输出 token。');
  return frames;
}

export function sleepTrace(input = {}) {
  const o = configured(input), frames = [];
  const state = { gpuWeights: o.sleepWeights, gpuKv: o.sleepKv, cpuWeights: 0, cpuBuffers: 0, weightsValid: true, version: 1, kvVersion: 1, kvContent: o.sleepKv, paused: false, status: '正在服务' };
  record(frames, state, 0, '初始权重 v1 与旧 KV 有效；图中容量是教学单位，不是设备实测。');
  state.paused = true;
  state.status = '请求已排空';
  record(frames, state, 0, '进入受控边界后暂停调度；示例假设设备在途工作已经结束。');
  if (o.sleepLevel === 1) state.cpuWeights = o.sleepWeights;
  else state.cpuBuffers = 1;
  record(frames, state, 1, o.sleepLevel === 1 ? 'Level 1 先将权重备份到 CPU；KV 内容不会备份。' : 'Level 2 只保存适用 buffers，不备份模型权重。');
  Object.assign(state, { gpuWeights: 0, gpuKv: 0, weightsValid: false, kvContent: 0, kvVersion: null, status: '休眠中' });
  record(frames, state, 1, '释放示例 GPU 权重与 KV 内存，旧 KV 内容丢失。');
  state.gpuWeights = o.sleepWeights;
  state.status = '只唤醒权重内存';
  record(frames, state, 2, '先唤醒 weights；分配内存不等于得到有效权重。');
  state.weightsValid = true;
  state.version = o.sleepUpdate ? 2 : 1;
  state.cpuWeights = 0;
  state.cpuBuffers = 0;
  record(frames, state, 2, `${o.sleepLevel === 1 ? '恢复 CPU 备份' : 'reload / transfer 恢复权重'}${o.sleepUpdate ? '，再完成示例更新至 v2' : '至 v1'}；尚未恢复 KV 容量。`);
  state.gpuKv = o.sleepKv;
  state.status = 'KV 内存已分配';
  record(frames, state, 2, '唤醒 kv_cache 只恢复容量，不能恢复已丢弃的 KV 内容。');
  record(frames, state, 3, '清理旧缓存索引；新请求必须重新计算 KV，不复用旧权重的结果。');
  state.paused = false;
  state.status = '恢复服务 · KV 为空';
  record(frames, state, 3, `权重 v${state.version} 已有效，KV 容量就绪，再恢复调度。`);
  return frames;
}

export function requestMetricsTrace(input = {}) {
  const o = configured(input), frames = [];
  const arrival = o.metricNetwork, scheduled = arrival + o.metricQueue;
  const serverTimes = Array.from({ length: o.metricTokens }, (_, i) => scheduled + o.metricPrefill + i * o.metricDecode + (i > 0 ? o.metricStall : 0));
  const clientTimes = serverTimes.map((t) => t + o.metricNetwork);
  const state = { now: 0, arrival, scheduled, serverTimes, clientTimes, serverCount: 0, clientCount: 0, itls: [], serverTtft: null, clientTtft: null, tpot: null, e2e: null, status: '客户端发起' };
  record(frames, state, 0, '客户端时刻 0 发起；使用同一教学时钟，真实主机的 wall-clock 与 monotonic 时间不能直接相减。');
  state.now = arrival;
  state.status = '服务端收到请求';
  record(frames, state, 0, `入站耗时 ${o.metricNetwork} ms，开始服务端到达口径。`);
  state.now = scheduled;
  state.status = '进入 Prefill';
  record(frames, state, 0, `排队 ${o.metricQueue} ms 后执行 Prefill；排队时间不是 GPU 计算时间。`);
  // Sort production and reception together: network delivery can overlap
  // several later Decode events. Production comes first on equal timestamps.
  const events = serverTimes.flatMap((time, i) => [
    { time, i, kind: 'server' },
    { time: clientTimes[i], i, kind: 'client' },
  ]).sort((a, b) => a.time - b.time || (a.kind === 'server' ? 0 : 1) - (b.kind === 'server' ? 0 : 1));
  for (const event of events) {
    const i = event.i;
    state.now = event.time;
    if (event.kind === 'server') {
      state.serverCount = i + 1;
      state.status = `服务端 token ${i + 1}`;
      if (i === 0) state.serverTtft = event.time - arrival;
      else {
        state.itls.push(event.time - serverTimes[i - 1]);
        state.tpot = (event.time - serverTimes[0]) / i;
      }
      record(frames, state, i === 0 ? 1 : 2, i === 0
        ? `服务端 TTFT=${state.serverTtft} ms，包含排队和示例 Prefill。`
        : `token ${i + 1} 的 ITL=${state.itls.at(-1)} ms；TPOT 使用后续 ${i} 个间隔。`);
    } else {
      state.clientCount = i + 1;
      state.status = `客户端收到 token ${i + 1}`;
      if (i === 0) state.clientTtft = event.time;
      record(frames, state, i === 0 ? 1 : 2, `客户端在 ${event.time} ms 收到 token ${i + 1}${i === 0 ? `，客户端 TTFT=${state.clientTtft} ms` : ''}。`);
    }
  }
  state.e2e = clientTimes.at(-1);
  state.status = '请求结束';
  record(frames, state, 3, `客户端端到端 ${state.e2e} ms；${o.metricTokens === 1 ? '只有一个输出 token，没有 Decode 间隔，TPOT 不适用' : `TPOT=(${serverTimes.at(-1)}−${serverTimes[0]})/${o.metricTokens - 1}=${state.tpot.toFixed(1)} ms`}。`);
  return frames;
}

export const serviceTraces = {
  'model-loading': modelLoadingTrace, logits: logitsProcessorTrace, pooling: poolingMechanismTrace,
  'prompt-embeds': promptEmbedsTrace, sleep: sleepTrace, metrics: requestMetricsTrace,
};
