import { mechanismDefaults } from '../mechanism-parameters.mjs';
import { algorithmSources as S } from '../algorithm-sources.mjs';
import { softmax, eplbTrace } from './algorithms.mjs';
export const snapshot = (frames, state, stepIndex, event, extra = {}) => frames.push(structuredClone({ ...state, stepIndex, events: [event], ...extra }));
export const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
export const rng = (seed) => { let value = seed >>> 0; return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return (value + 0.5) / 4294967296; }; };

export function prefillTrace(input = {}) {
  const o = { ...mechanismDefaults, ...input }, frames = [];
  const state = { prompt: Array.from({ length: o.prefillPrompt }, (_, i) => 100 + i), cache: [], queries: [], output: [], round: 0, status: '输入就绪', stopped: false };
  snapshot(frames, state, 0, 'Prompt 的每个位置需要计算；采样与 KV 写入是两个事件。');
  const write = (position, token, step) => {
    const row = { position, token, k: [1 + position / 10, -position / 10], v: [position / 5, 1] };
    state.cache.push(row);
    state.queries.push({ position, token, q: [0.6, 0.4], visible: state.cache.map((x) => x.position), phase: step === 1 ? 'P' : 'D' });
    state.status = `位置 ${position} 的 Q/K/V 已计算`;
    snapshot(frames, state, step, `${step === 1 ? 'Prefill' : 'Decode'} query ${position} 可读 0…${position}；当前位置 K/V 写入后，下次直接复用历史。`);
  };
  for (let i = 0; i < state.prompt.length; i++) write(i, state.prompt[i], 1);
  const count = o.prefillEos > 0 ? Math.min(o.prefillEos, o.prefillOutput) : o.prefillOutput;
  for (let n = 1; n <= count; n++) {
    state.round = n;
    if (n > 1) { state.output[n - 2].kvWritten = true; write(state.prompt.length + n - 2, state.output.at(-1).token, 3); }
    const eos = o.prefillEos === n;
    state.output.push({ token: eos ? 2 : 200 + n, eos, kvWritten: false });
    state.status = eos ? '采样到 EOS' : `第 ${n} 枚教学输出已采样`;
    snapshot(frames, state, n === 1 ? 2 : 4, '当前输出 token 尚无 KV；若继续生成，它才成为下一轮输入。', { source: S.greedy });
  }
  state.stopped = true;
  state.status = state.output.at(-1).eos ? 'EOS 停止' : '达到输出上限';
  snapshot(frames, state, 4, '停止后不再为最后一枚输出执行前向；保留本例历史用于观察，不模拟缓存回收。');
  return frames;
}

export function samplingTrace(input = {}) {
  const o = { ...mechanismDefaults, ...input }, frames = [], random = rng(o.seed ?? 42);
  const logits = [3.2, 2.4, 1.6, 0.8, 0.1], words = ['缓存', '模型', '显存', '调度', '苹果'];
  const state = { logits, words, scaled: [], probabilities: [], kept: [], normalized: [], races: [], selected: null, status: '固定 logits 已得到' };
  snapshot(frames, state, 0, '显示五个候选的原始分数，尚未归一化。');
  if (o.temperature === 0) {
    state.selected = logits.indexOf(Math.max(...logits));
    state.probabilities = logits.map((_, i) => i === state.selected ? 1 : 0);
    state.kept = [state.selected]; state.normalized = [...state.probabilities];
    state.status = 'T=0 · 贪心分支';
    snapshot(frames, state, 1, '直接取最高分；不执行除零、Top-p 或随机竞赛。', { source: S.greedy });
    snapshot(frames, state, 3, `选中 ${words[state.selected]}。`, { source: S.greedy });
    snapshot(frames, state, 3, '结果可复现；种子在本贪心分支不参与选择。', { source: S.greedy });
    snapshot(frames, state, 3, '修改温度可重新进入概率抽样路径。', { source: S.greedy });
    return frames;
  }
  state.scaled = logits.map((v) => v / o.temperature);
  state.status = '温度缩放完成';
  snapshot(frames, state, 1, '除以 Temperature，较高温度使概率更分散。');
  state.probabilities = softmax(state.scaled);
  state.status = 'Softmax 完成';
  snapshot(frames, state, 1, '减去最大分数后求指数并归一化。', { source: S.softmax });
  let cumulative = 0;
  const order = state.probabilities.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p || a.i - b.i);
  for (const { p, i } of order) {
    if (cumulative >= o.topP) break;
    state.kept.push(i); cumulative += p;
    state.status = `Top-p 已保留 ${state.kept.length} 个候选`;
    snapshot(frames, state, 2, `加入 ${words[i]}，原概率累计 ${cumulative.toFixed(4)}；达到阈值后停止。`);
  }
  state.normalized = state.probabilities.map((p, i) => state.kept.includes(i) ? p / cumulative : 0);
  state.status = '保留候选重新归一化';
  snapshot(frames, state, 2, '被移除候选为零，保留集合的概率和重新变为 1。');
  for (const i of state.kept) {
    const u = random(), noise = -Math.log(u), score = state.normalized[i] / noise;
    state.races.push({ i, u, noise, score });
    state.status = `${words[i]} 参与指数竞赛`;
    snapshot(frames, state, 3, '使用 p / Exp(1) 比较候选；随机数是固定种子的教学生成器。', { source: S.race });
  }
  state.selected = state.races.reduce((best, x) => x.score > best.score ? x : best).i;
  state.status = `已选中 ${words[state.selected]}`;
  snapshot(frames, state, 3, '选最大竞赛值，零概率候选不参与。', { source: S.race });
  return frames;
}

export function integerQuantTrace(input = {}) {
  const o = { ...mechanismDefaults, ...input }, frames = [];
  const raw = [-1.2, -0.76, -0.31, 0.08, 0.47, 0.91, 1.08, 1.4], max = 2 ** (o.bits - 1) - 1, scale = Math.max(...raw.map(Math.abs)) / max;
  const state = { raw, scale, integers: [], bytes: [], restored: [], active: null, status: `选择对称 INT${o.bits}` };
  snapshot(frames, state, 0, `量化范围为 ±${max}，scale=${scale.toPrecision(5)}；不复现具体量化框架校准。`);
  for (let i = 0; i < raw.length; i++) {
    const scaled = raw[i] / scale, integer = Math.sign(scaled) * Math.floor(Math.abs(scaled) + 0.5);
    state.integers.push({ i, scaled, integer }); state.active = i; state.status = `元素 ${i} 缩放与舍入`;
    snapshot(frames, state, 1, '对称整数、half-away-from-zero 舍入，继续存储 scale。', { source: S.quant });
  }
  const mask = 2 ** o.bits - 1;
  for (let i = 0; i < raw.length; i += o.bits === 4 ? 2 : 1) {
    const low = state.integers[i].integer & mask, high = o.bits === 4 ? state.integers[i + 1].integer & mask : null;
    state.bytes.push({ indices: high === null ? [i] : [i, i + 1], byte: high === null ? low : low | (high << 4) });
    state.status = `已打包 ${state.bytes.length} 个教学字节`;
    snapshot(frames, state, 2, o.bits === 4 ? '低四位对应首元素，高四位对应第二元素；负数按四位补码表示。' : '有符号 INT8 按八位补码写入一字节。');
  }
  for (const packed of state.bytes) for (let j = 0; j < packed.indices.length; j++) {
    const code = (packed.byte >> (j * o.bits)) & mask, integer = code >= 2 ** (o.bits - 1) ? code - 2 ** o.bits : code;
    const i = packed.indices[j], value = integer * scale;
    state.restored.push({ i, integer, value, error: Math.abs(value - raw[i]) });
    state.status = `还原元素 ${i}`;
    snapshot(frames, state, 3, '从字节解码有符号整数，再乘 scale；误差来自量化，不来自位打包。');
  }
  return frames;
}

export function contextParallelTrace(input = {}) {
  const o = { ...mechanismDefaults, ...input }, frames = [], n = 8, query = o.cpPrefill ? o.cpQuery : n - 1;
  const keys = Array.from({ length: n }, (_, i) => [i * 0.2, 1 - i * 0.1]), values = Array.from({ length: n }, (_, i) => [i / 3, 1 - i / 5]);
  const scores = keys.map((key, i) => i <= query ? dot([0.8, -0.4], key) / Math.sqrt(2) : null);
  const distribution = softmax(scores.filter((x) => x !== null));
  const reference = [0, 1].map((d) => distribution.reduce((sum, p, i) => sum + p * values[i][d], 0));
  const shards = Array.from({ length: o.cpRanks }, (_, rank) => ({ rank, positions: Array.from({ length: n }, (_, i) => i).filter((i) => Math.floor(i * o.cpRanks / n) === rank), ready: false }));
  const state = { query, keys, values, scores, shards, partials: [], factors: [], output: [0, 0], reference, gathered: false, status: o.cpPrefill ? 'PCP：Q/K/V 按 token 切分' : 'DCP：共享 Q，KV 按上下文切分' };
  snapshot(frames, state, 0, o.cpPrefill ? '本例选择 partial query / full KV 的 Gather 路径。' : '固定末位置 query，计算各 rank 的局部 Attention 与 LSE。');
  const local = (rank, positions) => {
    const visible = positions.filter((i) => i <= query);
    if (!visible.length) return { rank, visible, lse: null, output: [0, 0] };
    const logits = visible.map((i) => scores[i]), m = Math.max(...logits), exps = logits.map((s) => Math.exp(s - m)), sum = exps.reduce((a, b) => a + b, 0);
    return { rank, visible, lse: m + Math.log(sum), output: [0, 1].map((d) => visible.reduce((total, i, j) => total + exps[j] / sum * values[i][d], 0)) };
  };
  for (const shard of state.shards) {
    shard.ready = true;
    if (!o.cpPrefill) state.partials.push(local(shard.rank, shard.positions));
    state.status = `rank ${shard.rank} 局部数据就绪`;
    snapshot(frames, state, 1, o.cpPrefill ? `rank ${shard.rank} 生成自己的 Q/K/V；Attention 尚未读取其他 rank 的 KV。` : `rank ${shard.rank} 输出局部归一化结果与 LSE。`);
  }
  state.gathered = true;
  state.status = o.cpPrefill ? 'Gather 全部 KV' : 'Gather 局部 LSE';
  snapshot(frames, state, 2, o.cpPrefill ? 'query 的所属 rank 得到完整 KV，再应用因果掩码。' : '各 rank 的结果按 exp(local LSE − global LSE) 缩放，不能直接取平均。');
  if (o.cpPrefill) {
    const owner = state.shards.find((s) => s.positions.includes(query)).rank;
    state.partials = [local(owner, Array.from({ length: n }, (_, i) => i))]; state.factors = [1];
  } else {
    const m = Math.max(...state.partials.filter((p) => p.lse !== null).map((p) => p.lse));
    const weights = state.partials.map((p) => p.lse === null ? 0 : Math.exp(p.lse - m)), sum = weights.reduce((a, b) => a + b, 0);
    state.factors = weights.map((v) => v / sum);
  }
  for (let i = 0; i < state.partials.length; i++) {
    for (let d = 0; d < 2; d++) state.output[d] += state.partials[i].output[d] * state.factors[i];
    state.status = o.cpPrefill ? '所属 rank 完成 Attention' : `合并 rank ${state.partials[i].rank}`;
    snapshot(frames, state, 3, '数值结果与相同因果可见范围的单设备 Attention 对照。');
  }
  return frames;
}

export function expertLayoutTrace(input = {}) {
  const o = { ...mechanismDefaults, ...input }, frames = [], loads = [o.eplbSkew * 4, 4, 2, 2];
  const planned = eplbTrace(loads, o.eplbReplicas).at(-1), slots = planned.slots;
  const target = planned.packs.flatMap((pack, rank) => pack.map((p, slot) => ({ rank, slot, logical: p.id, load: p.weight })));
  const old = target.map((_, i) => ({ rank: Math.floor(i / slots), slot: i % slots, logical: i < 4 + o.eplbReplicas ? i % 4 : null }));
  const state = { loads, counts: [...planned.counts], old, target, valid: target.map((x) => x.logical === null), pending: null, time: 0, mapVersion: 1, weightVersion: 1, active: old, targetReady: false, status: '收集逻辑专家负载' };
  snapshot(frames, state, 0, '四个逻辑专家负载固定，冗余副本与两设备等容量槽数可调。');
  state.status = '新布局已规划';
  snapshot(frames, state, 1, '热专家先获得额外副本，副本理想均摊负载，再按固定槽容量装箱。');
  for (let i = 0; i < target.length; i++) {
    if (target[i].logical === null) continue;
    const source = old.find((x) => x.logical === target[i].logical);
    state.pending = { index: i, source, destination: target[i], progress: 0, duration: o.eplbDelay };
    state.status = `准备专家 ${target[i].logical} 的目标权重`;
    snapshot(frames, state, 2, '旧映射保持有效；目标槽没有完成确认前，不可切换请求路由。');
    for (let t = 0; t < o.eplbDelay; t++) { state.time++; state.pending.progress++; snapshot(frames, state, 2, '教学权重复制进行中；真实实现还考虑原地搬运与异步策略。'); }
    state.valid[i] = true; state.pending = null;
    snapshot(frames, state, 2, '目标权重复制已确认；映射仍停留在旧版本。');
  }
  state.targetReady = state.valid.every(Boolean); state.weightVersion = 2;
  state.status = '新权重布局就绪';
  snapshot(frames, state, 3, '等待路由切换屏障；新映射尚未激活。');
  state.mapVersion = 2; state.active = target; state.status = '原子切换到新映射';
  snapshot(frames, state, 3, '映射版本与权重版本一致后，后续请求使用新物理专家槽。');
  return frames;
}

export function mixedLoraTrace(input = {}) {
  const o = { ...mechanismDefaults, ...input }, frames = [], W = [[1, 0, 1], [0, 1, -1]];
  const adapters = [null, { A: [[1, -1, 0], [0, 1, 1]].slice(0, o.loraRank), B: [[0.5, 0.25].slice(0, o.loraRank), [-1, 0.5].slice(0, o.loraRank)] }, { A: [[0, 1, -1], [1, 0, 1]].slice(0, o.loraRank), B: [[-0.25, 1].slice(0, o.loraRank), [0.75, -0.5].slice(0, o.loraRank)] }];
  const rows = [{ id: 'A0', request: 'A', adapter: 1, x: [1, 2, 1] }, { id: 'A1', request: 'A', adapter: 1, x: [2, 1, 0] }, { id: 'B0', request: 'B', adapter: o.loraDisableB ? 0 : 2, x: [1, 2, 1] }, { id: 'C0', request: 'C', adapter: 0, x: [1, 2, 1] }];
  if (o.loraReverse) rows.reverse();
  const state = { W, adapters, rows, mapping: [], results: [], loaded: [], status: '共享基础矩阵 W' };
  snapshot(frames, state, 0, 'W 为 2×3；每个适配器 A 为 r×3，B 为 2×r，共用相同基础模型。');
  state.loaded = [...new Set(rows.map((r) => r.adapter).filter(Boolean))]; state.status = '当前批次适配器已选择';
  snapshot(frames, state, 1, 'base 映射为 0；适配器身份跟随请求，不随批次行顺序交换。');
  for (let i = 0; i < rows.length; i++) { state.mapping.push({ row: i, id: rows[i].id, adapter: rows[i].adapter }); state.status = `行 ${i} 映射到 adapter ${rows[i].adapter}`; snapshot(frames, state, 2, `输入 ${rows[i].id} 与 adapter ID 逐行对齐。`); }
  for (const row of rows) {
    const base = W.map((w) => dot(w, row.x)), a = adapters[row.adapter];
    const compressed = a ? a.A.map((x) => dot(x, row.x)) : [], delta = a ? a.B.map((b) => o.loraScale * dot(b, compressed)) : [0, 0];
    state.results.push({ ...row, base, compressed, delta, output: base.map((v, i) => v + delta[i]) });
    state.status = `${row.id} 完成 Wx + scale·B(Ax)`;
    snapshot(frames, state, 3, '恢复请求身份查看结果；base 分支增量严格为零。', { source: S.lora });
  }
  return frames;
}

export function mediaAlignmentTrace(input = {}) {
  const o = { ...mechanismDefaults, ...input }, frames = [], size = [2, 4, 3][o.mmType];
  const items = Array.from({ length: o.mmItems }, (_, i) => ({ id: `M${i}`, key: `type${o.mmType}/content${o.mmRepeat ? 0 : i}/encoder-demo`, count: size, hit: false, features: [] }));
  const state = { items, rows: [], cache: [], encoded: 0, hits: 0, merged: 0, valid: false, failed: false, status: '媒体内容已解析' };
  snapshot(frames, state, 0, '每项媒体由内容与 encoder 配置形成教学缓存键，重复出现不等于需要重复编码。');
  for (let i = 0; i < items.length; i++) {
    state.rows.push({ kind: 'text', label: `T${i}`, position: state.rows.length, vector: [0.1 * i, 1], ready: true });
    const count = size - (o.mmMismatch && i === items.length - 1 ? 1 : 0);
    for (let j = 0; j < count; j++) state.rows.push({ kind: 'media', label: `${items[i].id}:${j}`, item: items[i].id, feature: j, position: state.rows.length, ready: false, vector: null });
  }
  state.status = '占位布局已生成';
  snapshot(frames, state, 1, '文本行与媒体占位行按顺序对齐；数量来自本观察窗的类型配置。');
  for (const item of state.items) {
    const entry = state.cache.find((x) => x.key === item.key);
    if (entry) { item.features = entry.features; item.hit = true; state.hits++; }
    else {
      item.features = Array.from({ length: size }, (_, j) => [o.mmType + 0.2 * (j + 1), (o.mmRepeat ? 0 : Number(item.id.slice(1))) + 0.3 * j]);
      state.cache.push({ key: item.key, features: item.features }); state.encoded += size;
    }
    state.status = `${item.id} ${item.hit ? '命中已有特征' : '编码完成'}`;
    snapshot(frames, state, 2, `教学 encoder ${item.hit ? '复用缓存' : '生成'} ${size} 行向量，媒体身份与对应占位范围保持一致。`);
  }
  for (const item of state.items) {
    const rows = state.rows.filter((r) => r.item === item.id);
    if (rows.length !== item.features.length) {
      state.failed = true; state.status = '特征与占位数量不匹配';
      snapshot(frames, state, 3, `${item.id} 有 ${item.features.length} 行特征、${rows.length} 个占位；阻止模型前向。`);
      return frames;
    }
    for (const row of rows) { row.vector = [...item.features[row.feature]]; row.ready = true; state.merged++; state.status = `合并 position ${row.position}`; snapshot(frames, state, 3, '媒体特征只进入对应占位行；相邻文字行保持原向量。'); }
  }
  state.valid = state.rows.every((r) => r.ready); state.status = '完整 embedding 输入就绪';
  snapshot(frames, state, 3, '行数、媒体索引与有效向量全部对齐；位置编码规则仍由真实模型定义。');
  return frames;
}
export const roadmapTraces = { prefill: prefillTrace, sampling: samplingTrace, quantization: integerQuantTrace, cp: contextParallelTrace, eplb: expertLayoutTrace, lora: mixedLoraTrace, multimodal: mediaAlignmentTrace };
