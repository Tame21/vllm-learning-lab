const common = { specK: [3, 1, 5, 1], specRejectAt: [2, 0, 5, 1] };
const labels = { specK: '候选上限 K', specRejectAt: '教学目标首个不匹配位置（0 全收）', specHistory: '请求 A 的 token 历史', specHistoryB: '请求 B 的 token 历史', specN: '最长后缀窗口', specAnchor: 'Anchor token', specFeature: '教学隐藏特征首维', specAuxLayers: '辅助特征层数', specMtpShare: '匹配模型具备索引共享接口', specParallelTrained: '草稿模型具备并行训练配置', specContext: '教学上下文 KV 位置数', specMarkov: '教学 Markov 偏置幅度', specMinProb: '示例路径最低条件频率', specGpuDisableB: '请求 B 不允许提出草稿' };
const entry = (parameters, note, presets, choices) => ({ parameters: { ...common, ...parameters }, labels, note, presets, ...(choices ? { choices } : {}) });
const history = { specHistory: ['A B C D A B', 24], specN: [3, 1, 6, 1] };
const anchor = { specAnchor: [0, 0, 2, 1] }, choices = { specAnchor: [[0, 'A'], [1, 'B'], [2, 'C']] };
labels.specAnchorPrediction = 'DSpark anchor 也预测第一枚候选';
const boundary = '候选使用教学数据；目标验证采用明确的贪心对照，首次不匹配后不提交剩余草稿。';
export const roadmapSpecCatalog = {
  ngram: entry(history, '空格分隔 1–24 个短 token；计算最长后缀的最早历史匹配，不调用模型。', [['重复后缀', {}], ['没有历史匹配', { specHistory: 'A B C D E F' }], ['全部候选接受', { specRejectAt: 0 }]]),
  'ngram-gpu': entry({ ...history, specHistoryB: ['A B A', 24], specGpuDisableB: [false] }, '两行历史有效长度独立；−1 是候选填充，不能作为有效 token 提交。', [['不同有效长度', {}], ['屏蔽请求 B', { specGpuDisableB: true }], ['两行无匹配', { specHistory: 'A B C D', specHistoryB: 'X Y Z' }]]),
  suffix: entry({ ...history, specMinProb: [0.5, 0.1, 1, 0.1] }, '固定训练片段与当前历史构成频次树；不复现外部 Arctic 后缀库。', [['频次树续写', {}], ['高门限停止', { specMinProb: 1 }], ['未知后缀', { specHistory: 'X Y Z' }]]),
  'draft-model': entry(anchor, boundary, [['串行草稿', {}], ['更长候选链', { specK: 5 }], ['全收与 bonus', { specRejectAt: 0 }]], choices),
  eagle: entry({ ...anchor, specFeature: [1, 0, 2, 1] }, 'token 与目标隐藏状态按位置对齐；示例递推不执行 EAGLE 权重。', [['隐藏状态对齐', {}], ['改变隐藏特征', { specFeature: 2 }], ['首项拒绝', { specRejectAt: 1 }]], choices),
  eagle3: entry({ ...anchor, specFeature: [1, 0, 2, 1], specAuxLayers: [3, 1, 3, 1] }, '每层使用二维教学特征；展示拼接宽度，真实选择的层由模型配置决定。', [['三层特征拼接', {}], ['单层对照', { specAuxLayers: 1 }], ['全收与 bonus', { specRejectAt: 0 }]], choices),
  mtp: entry({ ...anchor, specMtpShare: [true] }, '匹配的 MRV2 MTP 路径可复用 Top-k 索引；不假定所有 MTP 模型有相同结构。', [['匹配模型 / 索引复用', {}], ['关闭索引复用', { specMtpShare: false }], ['多步 MTP', { specK: 5 }]], choices),
  'mlp-spec': { ...entry({ ...anchor, specFeature: [1, 0, 2, 1] }, '只展示级联输入；固定版本 registry 未接入，最终仍禁止执行。', [['级联输入图解', {}], ['较长级联', { specK: 5 }]], choices), names: ['specK', 'specAnchor', 'specFeature'] },
  medusa: entry({ ...anchor, specFeature: [1, 0, 2, 1] }, '同一个二维教学隐藏状态进入多个预测头；各头没有前一候选依赖。', [['共享隐藏状态扇出', {}], ['改变共享特征', { specFeature: 2 }], ['全收与 bonus', { specRejectAt: 0 }]], choices),
  'parallel-draft': entry({ ...anchor, specParallelTrained: [true] }, '一次骨干前向产生 K 个位置；模型缺少并行训练配置时阻止这条路径。', [['并行查询块', {}], ['模型配置不匹配', { specParallelTrained: false }], ['五位置对照', { specK: 5 }]], choices),
  dflash: entry({ ...anchor, specContext: [4, 1, 8, 1] }, '上下文 KV 与 anchor / mask 查询分开观察；向量和 logits 为教学数据。', [['上下文与 mask 查询', {}], ['较长上下文', { specContext: 8 }], ['全部接受', { specRejectAt: 0 }]], choices),
  dspark: entry({ ...anchor, specContext: [4, 1, 8, 1], specMarkov: [2, 0, 2, 0.5], specAnchorPrediction: [true] }, '默认 K 个查询（anchor + K−1 noise）；关闭 anchor 预测后改为 1+K 填充布局。', [['Markov 顺序依赖', {}], ['关闭 Markov 偏置', { specMarkov: 0 }], ['1+K 填充布局', { specAnchorPrediction: false }], ['全部接受', { specRejectAt: 0 }]], choices),
};
