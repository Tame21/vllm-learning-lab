export const roadmapBranchCatalog = {
  configuration: {
    parameters: { cfgTP: [2, 1, 4, 1], cfgHeads: [8, 4, 12, 4], cfgV2: [false], cfgNgram: [true] },
    labels: { cfgTP: '教学 TP 大小', cfgHeads: '教学模型 Attention 头数', cfgV2: '选择 MRV2', cfgNgram: '请求 N-gram 投机' },
    note: '复用启动命令分析器；模型头数为显式教学条件，未加载真实配置。',
    presets: [['配置分组与校验', {}], ['头数不能整除 TP', { cfgTP: 3, cfgHeads: 8 }], ['MRV2 与 N-gram 冲突', { cfgV2: true }]],
  },
  'attention-backends': {
    parameters: { attHead: [64, 8, 512, 8], attDtype: [0, 0, 2, 1], attCapability: [8, 7, 9, 1], attBlock: [16, 8, 32, 8], attFa4: [false], attMla: [false] },
    labels: { attHead: 'Attention head size', attDtype: '计算 dtype', attCapability: '教学 CUDA capability 主版本', attBlock: 'KV kernel block size', attFa4: 'FlashAttention 4 可用', attMla: '模型请求 MLA' },
    choices: { attDtype: [[0, 'float16'], [1, 'bfloat16'], [2, 'float32']] },
    note: '检查 FLASH_ATTN / TRITON_ATTN 已核对的条件子集；不是完整平台后端自动选择器。',
    presets: [['Dense 后端条件', {}], ['小 head 仅 Flash 通过', { attHead: 16 }], ['无候选 / block 不合法', { attBlock: 8 }], ['MLA 排除 Dense 后端', { attMla: true }]],
  },
  'adaptive-spec': {
    parameters: { avConfidenceA: [0.9, 0.2, 1, 0.1], avConfidenceB: [0.5, 0.2, 1, 0.1], avCost: [1, 0, 3, 0.5], avSupported: [true] },
    labels: { avConfidenceA: 'A 各位置条件置信度', avConfidenceB: 'B 各位置条件置信度', avCost: '教学计算饱和成本', avSupported: '满足 DSpark 置信度与后端要求' },
    note: '两请求各三个位置；存活概率为条件置信度连乘，成本曲线是教学输入。',
    presets: [['跨请求存活分配', {}], ['高计算成本', { avCost: 3 }], ['低置信度 A', { avConfidenceA: 0.2 }], ['不满足支持条件', { avSupported: false }]],
  },
  platform: {
    parameters: { opPlatform: [0, 0, 4, 1], opEnabled: [true], opNative: [true], opInput: [2, 1, 3, 1] },
    labels: { opPlatform: 'CustomOp 分发平台', opEnabled: '启用 CustomOp', opNative: '教学算子实现 forward_native', opInput: '教学标量输入 x' },
    choices: { opPlatform: [[0, 'CUDA'], [1, 'ROCm / HIP'], [2, 'CPU'], [3, 'XPU'], [4, 'Out of tree']] },
    note: '只核对 CustomOp 基类分发；教学算子实现 CUDA 与可选 native，不据此推断模型支持。',
    presets: [['CUDA 分发', {}], ['CPU 默认 native', { opPlatform: 2 }], ['关闭 CustomOp', { opEnabled: false }], ['缺少 native 实现', { opPlatform: 2, opNative: false }]],
  },
  compatibility: {
    parameters: { compatMethod: [2, 0, 2, 1], compatAdaptive: [true], compatLora: [false], compatPP: [false], compatEager: [false], compatV2: [true] },
    labels: { compatMethod: '投机方法', compatAdaptive: '请求自适应验证', compatLora: '启用 LoRA', compatPP: 'PP 大于 1', compatEager: 'Enforce Eager', compatV2: '选择 MRV2' },
    choices: { compatMethod: [[0, '不使用投机'], [1, 'N-gram'], [2, 'DSpark + confidence head']] },
    note: '检查固定版本已确认的五类组合限制；通过这些条件不等于所有模型和平台都支持。',
    presets: [['已检查条件通过', {}], ['自适应与 LoRA 冲突', { compatLora: true }], ['自适应与 Eager 冲突', { compatEager: true }], ['N-gram 与 MRV2 冲突', { compatAdaptive: false, compatMethod: 1 }]],
  },
};
