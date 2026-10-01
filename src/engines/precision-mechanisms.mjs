import { mechanismDefaults } from '../mechanism-parameters.mjs';
import { serviceSources } from '../service-sources.mjs';
import { tensorScale, quantizeE4M3 } from './fp8.mjs';
const record = (frames, state, stepIndex, event, source) => frames.push(structuredClone({ ...state, stepIndex, events: [event], ...(source ? { source } : {}) }));
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const attention = (keys, values) => {
  const scores = keys.map((key) => dot([0.6, -0.4], key) / Math.sqrt(2));
  const exp = scores.map((x) => Math.exp(x - Math.max(...scores))), denominator = exp.reduce((a, b) => a + b, 0);
  const probabilities = exp.map((x) => x / denominator);
  return { probabilities, output: [0, 1].map((d) => values.reduce((sum, row, i) => sum + row[d] * probabilities[i], 0)) };
};

export function compileTrace(input = {}) {
  const o = { ...mechanismDefaults, ...input }, frames = [];
  const shapes = [o.compileRows, o.compileChangeShape ? o.compileRows + 1 : o.compileRows, o.compileRows];
  const state = { status: '等待追踪', graph: [], fused: false, cache: [], calls: [], current: null, launches: 0, intermediateElements: 0, output: [] };
  record(frames, state, 0, '追踪一个二维隐藏维度的 RMSNorm → FP8 Quant 教学子图。');
  state.graph = ['RMSNorm', 'FP8 Quant'];
  state.status = '已追踪算子图';
  record(frames, state, 0, '分离路径会物化归一化结果，再由量化算子读取。');
  state.fused = o.compileFusion;
  if (state.fused) state.graph = ['RMSNorm + FP8 Quant'];
  state.status = state.fused ? '融合为一个教学 kernel' : '保留两个教学 kernel';
  record(frames, state, 1, state.fused ? '示例融合消除归一化中间张量的写入与读取，保留两项数学运算。' : '关闭融合：两项数学运算各自提交。');
  for (let i = 0; i < shapes.length; i++) {
    const rows = shapes[i], key = `${rows}×2/${state.fused ? 'fused' : 'separate'}`;
    const hit = state.cache.includes(key);
    state.current = { i, rows, key, hit };
    if (!hit) state.cache.push(key);
    state.status = hit ? '命中教学编译缓存' : '生成新的教学编译项';
    record(frames, state, 2, `前向 ${i + 1}，输入 ${rows}×2：${hit ? '命中' : '新增'}键 ${key}。`);
    const raw = Array.from({ length: rows }, (_, r) => [0.7 + r * 0.2, -0.4 + r * 0.1]);
    const normalized = raw.map((row) => { const rms = Math.sqrt(dot(row, row) / 2 + 1e-6); return row.map((v) => v / rms); });
    const scale = tensorScale(normalized.flat());
    state.output = normalized.map((row) => row.map((v) => quantizeE4M3(v, scale).restored));
    state.launches += state.fused ? 1 : 2;
    if (!state.fused) state.intermediateElements += rows * 2;
    state.calls.push({ ...state.current, launches: state.fused ? 1 : 2, output: state.output, scale });
    state.status = `前向 ${i + 1} 完成`;
    record(frames, state, 3, `完成归一化和量化；本次提交 ${state.fused ? 1 : 2} 个教学 kernel，输出 ${rows}×2。`);
  }
  return frames;
}

export function kvQuantTrace(input = {}) {
  const o = { ...mechanismDefaults, ...input }, frames = [];
  const rawK = Array.from({ length: o.kvQuantTokens }, (_, i) => [1.23 - i * 0.17, -0.67 + i * 0.09]);
  const rawV = Array.from({ length: o.kvQuantTokens }, (_, i) => [0.81 + i * 0.08, -1.17 + i * 0.13]);
  const state = { status: '浮点 K / V 就绪', rawK, rawV, scaleK: null, scaleV: null, cache: [], read: [], result: null, reference: attention(rawK, rawV), clipped: 0 };
  record(frames, state, 0, '单头、二维教学 K/V；使用 E4M3 有限数格式。');
  state.scaleK = o.kvQuantCalibrate ? tensorScale(rawK.flat()) : o.kvQuantScale;
  state.scaleV = o.kvQuantCalibrate ? tensorScale(rawV.flat()) : o.kvQuantScale;
  state.status = 'scale 已选择';
  record(frames, state, 1, o.kvQuantCalibrate ? '用当前示例张量的绝对最大值 / 448 选择 K、V 各一个 scale；这不是数据集校准。' : `手动设置 K/V scale=${o.kvQuantScale}；超过 ±448×scale 的值会饱和。`);
  for (let i = 0; i < rawK.length; i++) {
    const k = rawK[i].map((v) => quantizeE4M3(v, state.scaleK)), v = rawV[i].map((value) => quantizeE4M3(value, state.scaleV));
    state.cache.push({ i, k, v });
    state.clipped += [...k, ...v].filter((x) => x.clipped).length;
    state.status = `已写入 token ${i}`;
    record(frames, state, 2, `K/V token ${i} 写入 FP8 字节；缓存存编码，scale 另存。`, serviceSources.fp8Write);
  }
  for (const block of state.cache) {
    state.read.push({ i: block.i, k: block.k.map((x) => x.restored), v: block.v.map((x) => x.restored) });
    state.status = `已读取 token ${block.i}`;
    record(frames, state, 3, `读取 token ${block.i}，示例计算 dequant = decoded × scale。`, serviceSources.fp8Overview);
  }
  state.result = attention(state.read.map((x) => x.k), state.read.map((x) => x.v));
  state.status = 'Attention 对照完成';
  record(frames, state, 3, '相同浮点 Q 分别读取原始与恢复后的 K/V，比较教学 Attention 输出。', serviceSources.fp8Overview);
  return frames;
}

export function onlineQuantTrace(input = {}) {
  const o = { ...mechanismDefaults, ...input }, frames = [];
  const raw = Array.from({ length: o.quantRows }, (_, r) => [0.23 + r * 0.11, -0.71 - r * 0.06]);
  raw[0][1] *= o.quantOutlier;
  const activation = [0.63 * o.quantActivation, -0.37 * o.quantActivation];
  const state = { status: '等待加载', raw, loaded: false, weights: [], scale: null, activation, activationScale: null, quantActivation: [], reference: raw.map((row) => dot(row, activation)), output: [], ready: false };
  record(frames, state, 0, '选择 per-tensor FP8 权重路径；一个二维输入向量用于观察运行时激活量化。');
  state.loaded = true;
  state.status = '浮点权重已加载';
  record(frames, state, 1, '先得到当前层浮点权重；真实加载器还可通过 meta 与逐层处理控制内存峰值。');
  state.scale = tensorScale(raw.flat());
  record(frames, state, 2, `当前层 weight scale = max |W| / 448 = ${state.scale.toPrecision(4)}。`, serviceSources.onlineWeights);
  for (const row of raw) {
    state.weights.push(row.map((v) => quantizeE4M3(v, state.scale)));
    state.status = `教学转换 ${state.weights.length} / ${raw.length} 行`;
    record(frames, state, 2, '逐行展开仅为了观察编码变化，不表示生产 kernel 的执行粒度。', serviceSources.onlineWeights);
  }
  state.ready = true;
  state.activationScale = tensorScale(activation);
  state.quantActivation = activation.map((v) => quantizeE4M3(v, state.activationScale));
  state.status = '运行时激活 scale 已生成';
  record(frames, state, 3, '权重 scale 随加载保存；当前激活的 scale 在本次前向动态计算。', serviceSources.onlineApply);
  state.output = state.weights.map((row) => dot(row.map((x) => x.restored), state.quantActivation.map((x) => x.restored)));
  state.status = '教学线性层对照完成';
  record(frames, state, 3, '计算恢复后的 W 与 x 的点积；展示量化误差，不执行真实低精度 GEMM。', serviceSources.onlineApply);
  return frames;
}
export const precisionTraces = { compile: compileTrace, 'kv-quant': kvQuantTrace, 'online-quant': onlineQuantTrace };
