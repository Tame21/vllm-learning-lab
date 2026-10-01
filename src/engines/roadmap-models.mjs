import { mechanismDefaults } from '../mechanism-parameters.mjs';
import { snapshot, rng } from './roadmap-core.mjs';
import { softmax } from './algorithms.mjs';
import { roadmapSources as S } from '../roadmap-sources.mjs';
const setup = (input, state) => {
  const o = { ...mechanismDefaults, seed: 42, ...input }, frames = [];
  Object.assign(state, { status: '准备教学数据', blocked: false });
  return { o, state, frames, snap: (step, event, source) => snapshot(frames, state, step, event, source ? { source: { ...source, observe: event } } : {}) };
};
export function mlaIndexTrace(input = {}) {
  const { o, state, frames, snap } = setup(input, { cacheRows: [], layers: [], indices: [], computations: 0 });
  state.rank = o.mlaRank; state.latents = Array.from({ length: 4 }, (_, i) => [i / 2, 1].slice(0, o.mlaRank));
  state.projection = [[1, 0], [0, 1], [1, 1], [-1, 1]].map((row) => row.slice(0, o.mlaRank));
  snap(0, 'latent 与独立 RoPE 分量存储；低秩表示不等于稀疏 token 选择。');
  for (let i = 0; i < 4; i++) { state.cacheRows.push({ position: i, latent: state.latents[i], rope: [i / 10], reconstructed: state.projection.map((row) => row.reduce((sum, v, j) => sum + v * state.latents[i][j], 0)) }); snap(0, '用教学上投影恢复四维 key 供观察；不代表真实 MLA KV 布局或权重。'); }
  let previous = [];
  for (let layer = 0; layer < 6; layer++) {
    const full = layer % o.indexFreq === 0, scores = [0.3, 0.8, 0.4, 0.6].map((x, i) => x + (layer % 3) * (i === 2 ? 0.3 : 0));
    const fresh = scores.map((score, i) => ({ position: i, score })).sort((a, b) => b.score - a.score || a.position - b.position).slice(0, o.indexTopK).map((x) => x.position);
    snap(1, full ? `层 ${layer} 将计算 Top-${o.indexTopK} 索引。` : `层 ${layer} 不重新计算索引，读取上一 F 层结果。`);
    if (full) { previous = fresh; state.computations++; }
    state.indices = [...previous]; state.layers.push({ layer, kind: full ? 'F' : 'S', scores: full ? scores : null, indices: [...previous] });
    state.status = `层 ${layer} · ${full ? '计算并缓存' : '复用索引'}`;
    snap(full ? 2 : 3, full ? 'F 层将新的候选位置存入索引缓存。' : 'S 层复用缓存的 token 索引；latent KV 内容没有因此被删掉。');
  }
  return frames;
}
export function extractionDatasetTrace(input = {}) {
  const { o, state, frames, snap } = setup(input, { layers: [], rows: [], exported: null, sampled: [201], returned: [], checkpoint: false, trainedHere: false });
  state.tokenIds = Array.from({ length: o.dataRows }, (_, i) => 100 + i);
  snap(0, '提取模式接收目标模型 token 与辅助层隐藏状态。');
  for (let layer = 0; layer < o.dataLayers; layer++) {
    state.layers.push(Array.from({ length: o.dataRows - (o.dataMismatch && layer === o.dataLayers - 1 ? 1 : 0) }, (_, i) => [i / 10, layer / 10]));
    snap(0, `辅助层 ${layer} 的二维教学特征到达。`);
  }
  if (state.layers.some((rows) => rows.length !== o.dataRows)) { state.blocked = true; state.status = '层间 token 行数不匹配'; for (const step of [1, 2, 3]) snap(step, '不能 stack 或导出错位的教学样本；没有 checkpoint 接入。'); return frames; }
  for (let position = 0; position < o.dataRows; position++) { state.rows.push({ position, token: state.tokenIds[position], hidden: state.layers.map((rows) => rows[position]), next: state.tokenIds[position + 1] ?? null }); snap(0, '同一 token 位置的多层特征 stack 为 [层, 2]，保留位置身份。'); }
  state.returned = [...state.sampled]; snap(0, 'ExtractHiddenStatesProposer 返回目标 sampled token 列，目的为缓存提取，并非独立猜测。');
  state.status = '外部训练边界'; snap(1, '浏览器只提供对齐样本；不训练 drafter，也不计算损失或梯度。');
  state.exported = { teaching_only: true, shape: [o.dataRows, o.dataLayers, 2], records: state.rows.slice(0, -1) };
  snap(2, '导出教学记录，最后一行没有已知 next token，因此不作为此处的 next-token 训练对。');
  state.checkpoint = o.dataCheckpoint; state.blocked = !o.dataCheckpoint; state.status = o.dataCheckpoint ? '外部 checkpoint 就绪，可继续验证接入' : '等待外部训练 checkpoint';
  snap(3, 'checkpoint 必须匹配目标与方法格式；本窗口没有运行它或给出接受率。'); return frames;
}
export function elasticTopologyTrace(input = {}) {
  const { o, state, frames, snap } = setup(input, { old: [0, 1, 2, 3].map((expert) => ({ expert, rank: expert % 2, valid: true })), target: [], activeWorld: 2, epoch: 1, groupReady: false, time: 0, transfer: null });
  state.targetWorld = o.elasticWorld; snap(0, '旧 EP 拓扑继续持有四个逻辑专家，准备规模变更事务。');
  state.target = state.old.map((x) => ({ expert: x.expert, rank: x.expert % o.elasticWorld, valid: false }));
  snap(1, '构造目标分组与教学专家布局；仅准备，不改变活动拓扑。');
  for (const expert of state.target) {
    const old = state.old.find((x) => x.expert === expert.expert); state.transfer = { expert: expert.expert, from: old.rank, to: expert.rank, progress: 0 };
    for (let t = 1; t <= o.elasticDelay; t++) { state.time++; state.transfer.progress = t; snap(2, `E${expert.expert} 的目标权重等待迁移 / 就绪确认。`); }
    expert.valid = true; state.transfer = null; snap(2, `目标 rank ${expert.rank} 确认 E${expert.expert} 内容就绪。`);
  }
  state.groupReady = o.elasticBarrier;
  if (!state.groupReady) { state.blocked = true; state.status = '新通信组屏障失败，保留旧拓扑'; snap(3, '目标权重就绪还不足以切换；通信组与一致版本必须一并确认。'); return frames; }
  state.activeWorld = o.elasticWorld; state.epoch = 2; state.status = '目标拓扑已激活'; snap(3, '同一事务切换 world 与专家映射，再结束旧拓扑的教学观察。'); return frames;
}
export function longContextTrace(input = {}) {
  const { o, state, frames, snap } = setup(input, { pairs: [], accessible: [], original: [1, 2, 3, 4], rotated: [] });
  state.maxBytes = o.longMax * 2 * 4 * 2;
  state.fullHistory = 0;
  state.position = o.longPosition; state.maxLength = o.longMax;
  snap(0, '位置从 0 开始，合法位置须小于 max_model_len；容量按单头四维 FP16 Full KV 计算。');
  if (o.longPosition >= o.longMax) { state.blocked = true; state.status = 'position 超过教学长度上限'; for (const step of [0, 1, 2, 3]) snap(step, '不会绕过模型长度配置生成位置表示或创建缓存。'); return frames; }
  for (let pair = 0; pair < 2; pair++) {
    const x = state.original.slice(pair * 2, pair * 2 + 2), angle = o.longPosition / o.longFactor / 10000 ** (2 * pair / 4);
    const rotated = [x[0] * Math.cos(angle) - x[1] * Math.sin(angle), x[0] * Math.sin(angle) + x[1] * Math.cos(angle)];
    state.pairs.push({ pair, angle, input: x, output: rotated }); state.rotated.push(...rotated);
    snap(1, '成对坐标旋转保持每对向量的长度；因子改变角度。');
  }
  state.accessible = Array.from({ length: o.longPosition + 1 }, (_, i) => i).filter((i) => !o.longWindow || i >= o.longPosition - o.longWindow + 1);
  state.fullHistory = o.longPosition + 1; state.status = '位置与可访问历史已准备'; snap(2, '窗口限制查询可见范围；Full Attention 层仍保留全部对应历史，不等同于窗口层缓存淘汰。');
  snap(3, '增加配置长度与使用位置缩放不保证真实模型长上下文质量。'); return frames;
}
export function diffusionCanvasTrace(input = {}) {
  const { o, state, frames, snap } = setup(input, { canvas: [], argmax: [], history: [], entropy: [], probabilities: [], accepted: [], output: [], soft: [], round: 0, converged: false, phase: '配置' }), random = rng(o.seed);
  const valid = Math.min(o.diffCanvas, o.diffValid), letters = ['A', 'B', 'C']; state.valid = valid;
  snap(0, 'DiffusionGemma 使用随机 token canvas；这里不把它画成永远冻结的 Mask 槽。');
  state.canvas = Array.from({ length: o.diffCanvas }, () => Math.floor(random() * 3)); state.phase = 'denoise';
  snap(1, '初始化整个随机画布；有效尾部之外的 padding 不作为输出。');
  for (let round = 1; round <= o.diffRounds; round++) {
    state.round = round;
    const logits = Array.from({ length: o.diffCanvas }, (_, i) => i < valid ? letters.map((_, j) => j === (i + 1) % 3 ? Math.min(6, round + 1) : 0) : [0, 0, 0]);
    state.probabilities = logits.map(softmax); state.entropy = state.probabilities.map((p) => -p.reduce((sum, x) => sum + x * Math.log(x), 0));
    state.argmax = logits.map((row) => row.indexOf(Math.max(...row)));
    const sampled = logits.map((row) => { const noisy = row.map((x) => x - Math.log(-Math.log(random()))); return noisy.indexOf(Math.max(...noisy)); });
    const order = state.entropy.map((entropy, i) => ({ entropy, i })).sort((a, b) => a.entropy - b.entropy || a.i - b.i);
    state.accepted = Array(o.diffCanvas).fill(false); let sum = 0, largest = 0;
    for (const x of order) { sum += x.entropy; largest = Math.max(largest, x.entropy); state.accepted[x.i] = sum - largest <= o.diffEntropy + 1e-12; }
    state.canvas = sampled.map((x, i) => state.accepted[i] ? x : Math.floor(random() * 3));
    state.history.push([...state.argmax]); const required = o.diffStable + 1, recent = state.history.slice(-required);
    const stable = recent.length === required && recent.every((row) => row.every((x, i) => x === recent[0][i]));
    state.meanEntropy = state.entropy.reduce((a, b) => a + b, 0) / o.diffCanvas;
    state.converged = stable && state.meanEntropy < o.diffConfidence || round === o.diffRounds;
    state.soft = state.converged ? [] : state.probabilities.map((p) => [p[0] - p[2], p[1] + p[2]]);
    state.status = `去噪第 ${round} 步`; snap(2, '按累计熵减去最大项决定接受或重新随机；记录 argmax 历史并准备 self-conditioning 教学向量。');
    if (state.converged) { state.phase = '等待 commit'; state.status = round === o.diffRounds ? '最大步数到达，下步提交' : '稳定且置信通过，下步提交'; snap(2, '去噪步只准备收敛标记，本步尚未输出 canvas token。'); break; }
  }
  state.phase = 'commit'; state.output = state.argmax.slice(0, valid).map((x) => letters[x]); state.status = '有效 canvas 已提交';
  snap(3, '下一次 encoder / causal commit 输出保存的 argmax canvas；不输出 padding。随机重新初始化下个 canvas 属于后续块。'); return frames;
}
export function reductionInvarianceTrace(input = {}) {
  const { o, state, frames, snap } = setup(input, { layouts: [], selected: [] });
  const big = 10 ** o.invariantPower, values = [big, 1, -big]; state.values = values; snap(0, '固定同一组三项，只改变 FP32 累加顺序；不进行随机抽样。');
  const orders = [[0, 1, 2], o.invariantFixed ? [0, 1, 2] : [0, 2, 1]];
  for (let layout = 0; layout < 2; layout++) {
    const row = { layout, order: orders[layout], partials: [], sum: 0, token: null }; state.layouts.push(row);
    for (const i of row.order) { row.sum = Math.fround(Math.fround(row.sum) + Math.fround(values[i])); row.partials.push(row.sum); snap(1, `布局 ${layout} 累加 ${values[i]}，FP32 部分和 ${row.sum}。`); }
  }
  snap(2, o.invariantFixed ? '教学 invariant 路径保持同一归约顺序，舍入轨迹相同。' : '两种顺序的舍入轨迹可能不同，临界 logits 会放大差异。');
  for (const row of state.layouts) { row.token = row.sum >= o.invariantMargin ? 'A' : 'B'; state.selected.push(row.token); snap(3, `布局 ${row.layout} logits=[${row.sum}, ${o.invariantMargin}]，贪心选择 ${row.token}。`); }
  state.status = state.selected[0] === state.selected[1] ? '两种布局教学结果一致' : '归约差异改变贪心结果'; snap(3, '这里只解释数值来源；不复现真实硬件 kernel 或保证所有批次确定性。'); return frames;
}
export function pluginRegistryTrace(input = {}) {
  const { o, state, frames, snap } = setup(input, { plugins: [], processes: [] });
  state.group = o.pluginEndpoint ? 'vllm.endpoint_plugins' : 'vllm.general_plugins';
  const allow = o.pluginAllow === 0 ? null : o.pluginAllow === 1 ? [] : o.pluginAllow === 2 ? ['alpha'] : ['alpha', 'beta'];
  state.allow = allow; state.plugins = ['alpha', 'beta'].map((name) => ({ name, admitted: allow === null ? !o.pluginEndpoint : allow.includes(name), loaded: false, error: null }));
  snap(0, 'entry_points 提供两个教学插件；一般插件未设置白名单时可加载，endpoint 必须显式列出。', o.pluginEndpoint ? S.endpoint : undefined);
  for (const plugin of state.plugins) {
    plugin.loaded = plugin.admitted && !(o.pluginFail && plugin.name === 'beta'); plugin.error = plugin.admitted && !plugin.loaded ? '加载异常，跳过该插件' : null;
    snap(1, plugin.loaded ? `${plugin.name} 的注册回调已发现。` : `${plugin.name} ${plugin.error ?? '被白名单过滤'}。`, o.pluginEndpoint ? S.endpoint : undefined);
  }
  for (let p = 0; p < o.pluginProcesses; p++) {
    state.processes.push({ id: `process-${p}`, registered: state.plugins.filter((x) => x.loaded).map((x) => `${x.name}:DemoImplementation`), callbacks: state.plugins.filter((x) => x.loaded).length, secondLoadCallbacks: o.pluginEndpoint ? null : 0 });
    snap(2, o.pluginEndpoint ? `独立教学前端 ${p} 调用已准入 factory；本例不重复加载 endpoint。` : `教学进程 ${p} 调用已加载回调，本进程重复加载受幂等标记约束。`);
  }
  state.status = '教学 registry 已更新'; snap(3, '注册到本进程不代表外部实现内部已验证；页面没有导入或执行第三方插件代码。'); return frames;
}
export function connectorContractTrace(input = {}) {
  const { o, state, frames, snap } = setup(input, { handle: null, layers: [], finishedSending: [], finishedReceiving: [], producerReleased: false, time: 0 });
  state.name = o.connectorName ? 'Mooncake' : 'NIXL'; state.blocks = Array.from({ length: o.connectorBlocks }, (_, i) => `B${i}`);
  snap(0, 'Factory 按 connector 名选择注册实现；观察共同接口，不模拟网络库。');
  if (!o.connectorRegistered) { state.blocked = true; state.status = 'Factory 查不到实现'; for (const step of [0, 1, 2, 3]) snap(step, '未注册的 connector 没有传输句柄或可消费数据。'); return frames; }
  state.handle = 'transfer-A-to-B'; state.layers = ['L0', 'L1'].map((name) => ({ name, loaded: false, consumed: false, progress: 0 })); snap(1, 'Scheduler metadata 关联请求、块身份与两层待加载工作。');
  for (const layer of state.layers) {
    for (let t = 1; t <= o.connectorDelay; t++) { layer.progress = t; state.time++; snap(2, `${layer.name} start_load_kv 在途；Attention 仍等待此层完成。`); }
    if (o.connectorFail && layer.name === 'L1') { state.blocked = true; state.status = '层加载失败，禁止完成请求'; snap(3, '部分层已经消费不等于整个请求成功；不释放发送侧状态。'); return frames; }
    layer.loaded = true; snap(2, `${layer.name} 的 wait_for_layer_load 确认完成。`, S.layerLoad);
    layer.consumed = true; snap(2, '仅在本层数据完成后允许 Attention 消费对应 KV。', S.layerLoad);
  }
  state.finishedSending = ['A']; state.finishedReceiving = ['B']; state.status = '两侧完成通知已收到'; snap(3, 'get_finished 区分发送完成与接收完成，不把创建句柄当作完成。');
  state.producerReleased = true; snap(3, '发送确认后才结束教学发送侧资源保留。'); return frames;
}
export function rustProtocolTrace(input = {}) {
  const { o, state, frames, snap } = setup(input, { fields: [], typeFrame: '00', payloadReady: false, submitted: false, outputs: [], finish: null });
  const prompt = Array.from({ length: o.rustTokens }, (_, i) => 100 + i);
  snap(0, 'Rust HTTP 输入转为引擎请求；Add 请求类型为单字节 00。', S.rustType);
  state.fields = [['request_id', 'String / str', 'request-A'], ['prompt_token_ids', 'Option<Vec<u32>> / list[int] | None', prompt], ['mm_features', 'Option<MmFeatures> / None', null], ['sampling_params', 'Option<EngineCoreSamplingParams>', { max_tokens: 2 }], ['pooling_params', 'Option<OpaqueValue>', null], ['arrival_time', 'f64 / float', 1.25], ['client_index', 'u32 / int', 0], ['prompt_embeds', 'OpaqueValue / auxiliary tensor', o.rustEmbeds ? '请求预计算张量' : null]];
  snap(1, 'EngineCoreRequest 使用 tuple / MessagePack 字段顺序；JSON 仅用于本窗口展示值。', S.rustRequest);
  if (o.rustEmbeds) { state.blocked = true; state.status = '此 Rust client 阶段不支持 Prompt Embeddings'; snap(1, 'Prompt Embeddings 需要独立的辅助张量编码边界。', S.rustRequest); snap(2, '该字段涉及 Python 自定义 tensor / auxiliary frame 编码，不能将展示 JSON 当作真实 wire payload。', S.rustRequest); snap(3, '阻止提交；没有伪造成功输出。'); return frames; }
  state.payloadReady = true; snap(1, '字段已对齐，真实负载还由 Rust MessagePack codec 编码；gRPC proto 是另一个 schema。', S.rustRequest);
  state.submitted = true; snap(2, '经 ZMQ 边界提交到现有 Python EngineCore；本页面没有启动 Rust 或 Python 引擎。');
  state.outputs.push({ request_id: 'request-A', new_token_ids: [201], finish_reason: null }); snap(3, '引擎 token 输出按同一个 request_id 回传前端。', S.rustOutput);
  if (o.rustAbort) { state.typeFrame = '01'; snap(3, 'Abort 消息类型为单字节 01，请求身份保持不变。', S.rustType); state.finish = { value: 2, name: 'Abort' }; state.outputs.push({ request_id: 'request-A', new_token_ids: [], finish_reason: 2 }); }
  else { state.outputs.push({ request_id: 'request-A', new_token_ids: [202], finish_reason: 1 }); state.finish = { value: 1, name: 'Length' }; }
  state.status = `输出流结束 · ${state.finish.name}`; snap(3, 'FinishReason 在边界上使用整数枚举，前端再转换为协议响应。', S.rustOutput); return frames;
}
export const roadmapModelTraces = { mla: mlaIndexTrace, speculators: extractionDatasetTrace, elastic: elasticTopologyTrace, 'long-context': longContextTrace, diffusion: diffusionCanvasTrace, invariance: reductionInvarianceTrace, plugins: pluginRegistryTrace, connectors: connectorContractTrace, rust: rustProtocolTrace };
