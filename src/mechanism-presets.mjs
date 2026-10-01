import { mechanismDefaults, mechanismParameterNames } from './mechanism-parameters.mjs';
import { esc } from './html.mjs';
import { roadmapCatalog } from './roadmap-parameters.mjs';

export const mechanismPresets = {
  ...Object.fromEntries(Object.entries(roadmapCatalog).map(([id, x]) => [id, x.presets])),
  compile: [
    ['融合并复用', {}],
    ['关闭融合对照', { compileFusion: false }],
    ['形状变化', { compileChangeShape: true }],
  ],
  'kv-quant': [
    ['手动 scale', {}],
    ['scale 太小 / 饱和', { kvQuantScale: 0.002 }],
    ['当前张量自动 scale', { kvQuantCalibrate: true }],
  ],
  'online-quant': [
    ['普通权重', {}],
    ['权重离群值', { quantOutlier: 16 }],
    ['激活幅度变化', { quantActivation: 4 }],
  ],
  dbo: [
    ['双批次重叠', {}],
    ['串行执行对照', { dboOverlap: false }],
    ['通信耗时较长', { dboComm: 6, dboCompute: 2 }],
  ],
  dp: [
    ['负载感知路由', {}],
    ['空队列 / 同分轮转', { dpBacklog: 0, dpKvPressure: 30 }],
    ['显式指定副本', { dpPinned: true }],
  ],
  disagg: [
    ['逐块传输', {}],
    ['合并四块传输', { disaggTokens: 16, disaggChunk: 4 }],
    ['传输失败阻塞', { disaggFail: true }],
  ],
  'model-loading': [
    ['两卡切分', { loadRanks: 2, loadShards: 2 }],
    ['四卡 / 单文件', { loadRanks: 4, loadShards: 1 }],
    ['单卡 / 多文件', { loadRanks: 1, loadShards: 4 }],
  ],
  logits: [
    ['Gumbel 水印', { processorWatermark: true }],
    ['普通采样对照', { processorWatermark: false }],
    ['加大频次惩罚', { processorPenalty: 2, processorTokens: 10 }],
  ],
  pooling: [
    ['MEAN + 归一化', { poolMethod: 0, poolNormalize: true }],
    ['MEAN 原向量', { poolMethod: 0, poolNormalize: false }],
    ['LAST 对照', { poolMethod: 2 }],
  ],
  'prompt-embeds': [
    ['预计算输入', { embedDirect: true }],
    ['token 查表对照', { embedDirect: false }],
    ['改变输入向量', { embedDirect: true, embedDelta: 1 }],
  ],
  sleep: [
    ['Level 1 恢复', { sleepLevel: 1 }],
    ['Level 2 重载', { sleepLevel: 2 }],
    ['Level 2 更新权重', { sleepLevel: 2, sleepUpdate: true }],
  ],
  metrics: [
    ['基准请求', {}],
    ['网络慢于 Decode', { metricNetwork: 40, metricDecode: 10 }],
    ['排队与停顿', { metricQueue: 100, metricStall: 60 }],
    ['单 token 边界', { metricTokens: 1 }],
  ],
  cudagraph: [
    ['匹配并回放', {}],
    ['超出捕获范围', { graphBatch: 10 }],
    ['输入地址变化', { graphStable: false }],
    ['关闭 Graph', { graphEnabled: false }],
  ],
  offload: [
    ['小容量 / CPU 命中', { offloadCapacity: 1 }],
    ['小容量 / 必须重算', { offloadCapacity: 1, offloadHit: false }],
    ['增加 GPU 容量', { offloadCapacity: 4 }],
    ['三层小容量 / 回载', { offloadCapacity: 1, offloadCpuCapacity: 1, offloadExternalCapacity: 1, offloadHit: false, offloadExternalHit: true }],
    ['CPU 淘汰 / 外部关闭', { offloadCapacity: 1, offloadCpuCapacity: 1, offloadExternalCapacity: 0, offloadHit: false }],
  ],
};

export function mechanismPresetParameters(id, index) {
  const preset = mechanismPresets[id]?.[index];
  if (!preset) throw Error('场景预设不存在');
  const initial = Object.fromEntries(mechanismParameterNames[id].map((key) => [key, key === 'seed' ? 42 : mechanismDefaults[key]]));
  return { ...initial, ...preset[1] };
}

export function mechanismScenarioButtons(lesson, options) {
  const presets = mechanismPresets[lesson.id];
  if (!presets) return '';
  return `<div class="mechanism-scenarios" role="group" aria-label="${esc(lesson.title)}场景预设"><span>选个场景，再单步观察</span><div>${presets.map(([label], i) => {
    const values = mechanismPresetParameters(lesson.id, i);
    const active = Object.entries(values).every(([key, value]) => options[key] === value);
    return `<button data-mechanism-preset="${i}" aria-pressed="${active}" class="${active ? 'active' : ''}">${esc(label)}</button>`;
  }).join('')}</div></div>`;
}
