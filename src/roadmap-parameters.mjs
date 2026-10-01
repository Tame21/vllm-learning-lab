import { roadmapSpecCatalog } from './roadmap-spec-parameters.mjs';
import { roadmapProtocolCatalog } from './roadmap-protocol-parameters.mjs';
import { roadmapBranchCatalog } from './roadmap-branch-parameters.mjs';
import { roadmapModelCatalog } from './roadmap-model-parameters.mjs';
// Further roadmap experiments keep their parameters, controls and presets together.
export const roadmapCatalog = {
  ...roadmapSpecCatalog,
  ...roadmapProtocolCatalog,
  ...roadmapBranchCatalog,
  ...roadmapModelCatalog,
  prefill: {
    parameters: { prefillPrompt: [5, 2, 8, 1], prefillOutput: [3, 1, 5, 1], prefillEos: [0, 0, 5, 1] },
    labels: { prefillPrompt: 'Prompt 位置数', prefillOutput: '教学输出上限', prefillEos: '第几枚输出为 EOS（0 关闭）' },
    note: 'Q/K/V 与 token ID 是教学值；已采样 token 的 KV 在下一次前向才写入。',
    presets: [['多轮 Decode', {}], ['第一枚输出即 EOS', { prefillEos: 1 }], ['较长 Prompt', { prefillPrompt: 8 }]],
  },
  sampling: {
    parameters: { temperature: [1, 0, 2, 0.1], topP: [0.9, 0.1, 1, 0.05] },
    names: ['temperature', 'topP', 'seed'],
    labels: { temperature: 'Temperature', topP: 'Top-p' },
    note: '五词固定 logits；指数竞赛的随机流可复现，但不是 PyTorch / CUDA 随机流。',
    presets: [['随机采样', {}], ['贪心 T=0', { temperature: 0 }], ['较小 Top-p', { topP: 0.4 }]],
  },
  quantization: {
    parameters: { bits: [8, 4, 8, 4] }, labels: { bits: '教学量化位宽' },
    choices: { bits: [[8, 'INT8 · 一元素一字节'], [4, 'INT4 · 两元素一字节']] },
    note: '对称量化、半格远离零；INT4 打包约定首元素在低四位，不代表 AWQ / GPTQ 布局。',
    presets: [['INT8 编码', { bits: 8 }], ['INT4 打包', { bits: 4 }]],
  },
  cp: {
    parameters: { cpRanks: [2, 2, 4, 1], cpPrefill: [false], cpQuery: [7, 0, 7, 1] },
    labels: { cpRanks: '教学 CP rank 数', cpPrefill: 'PCP：局部 Q / Gather KV', cpQuery: 'PCP 观察 query 位置' },
    note: '固定八位置、单头二维 Attention；DCP 观察末位置，PCP 可选 query。连续切片是教学布局。',
    presets: [['DCP / LSE 合并', {}], ['PCP / Gather KV', { cpPrefill: true }], ['PCP 早期 query', { cpPrefill: true, cpQuery: 1 }]],
  },
  eplb: {
    parameters: { eplbSkew: [8, 1, 12, 1], eplbReplicas: [2, 0, 4, 1], eplbDelay: [2, 1, 3, 1] },
    labels: { eplbSkew: '专家 0 负载倍率', eplbReplicas: '冗余物理副本数', eplbDelay: '每槽迁移确认时隙' },
    note: '两设备、四逻辑专家；复用算法章的单层教学分配，权重就绪后才切换映射。',
    presets: [['热点专家复制', {}], ['均衡负载', { eplbSkew: 1 }], ['无冗余副本', { eplbReplicas: 0 }]],
  },
  lora: {
    parameters: { loraRank: [1, 1, 2, 1], loraScale: [1, 0, 2, 0.5], loraReverse: [false], loraDisableB: [false] },
    labels: { loraRank: '教学低秩 r', loraScale: '增量比例（已含 alpha/r）', loraReverse: '反转批次行顺序', loraDisableB: '请求 B 使用基础模型' },
    note: '三个请求、四行输入共用 W；A/B 使用不同适配器，C 的映射为 base。',
    presets: [['混合适配器批次', {}], ['反转行顺序', { loraReverse: true }], ['零增量对照', { loraScale: 0 }]],
  },
  multimodal: {
    parameters: { mmType: [0, 0, 2, 1], mmItems: [2, 1, 3, 1], mmRepeat: [true], mmMismatch: [false] },
    labels: { mmType: '教学媒体类型', mmItems: '媒体出现次数', mmRepeat: '重复使用同一媒体内容', mmMismatch: '占位符少一个位置' },
    choices: { mmType: [[0, '图像 · 每项 2 行'], [1, '视频 · 2 帧 × 2 行'], [2, '音频 · 3 个特征行']] },
    note: '向量与占位数量为教学配置；展示逐行对应，模型位置编码与真实 encoder 另有约束。',
    presets: [['重复图像 / 缓存命中', {}], ['视频帧对齐', { mmType: 1 }], ['音频特征对齐', { mmType: 2 }], ['占位数量不匹配', { mmMismatch: true }]],
  },
};
export const roadmapIds = Object.keys(roadmapCatalog);
export const roadmapParameters = Object.assign({}, ...Object.values(roadmapCatalog).map((x) => x.parameters));
export const roadmapParameterNames = Object.fromEntries(Object.entries(roadmapCatalog).map(([id, x]) => [id, x.names ?? Object.keys(x.parameters)]));
