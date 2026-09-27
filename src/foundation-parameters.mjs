export const foundationParameters = {
  bCase: [0, 0, 2, 1],
  bSize: [3, 1, 4, 1],
  bAngle: [45, 0, 180, 15],
  bLogit: [1, -3, 3, 0.5],
  bProb: [0.3, 0, 1, 0.05],
  bGiven: [0, 0, 1, 1],
  bPrior: [0.2, 0.05, 0.95, 0.05],
  bLikelihood: [0.8, 0.05, 0.95, 0.05],
  bFalse: [0.1, 0.05, 0.95, 0.05],
  bU: [0.35, 0, 0.99, 0.01],
  bDraws: [100, 20, 200, 20],
  bSigma: [1, 0.25, 2, 0.25],
  bMu: [0, -2, 2, 0.5],
  bEstimate: [0.6, 0.05, 0.95, 0.05],
  bToken: [0, 0, 3, 1],
  bCausal: [true],
  bLearningRate: [0.2, 0.05, 1, 0.05],
  bTrain: [true],
  bStay: [0.8, 0.1, 0.9, 0.1],
  bRounds: [6, 3, 8, 1],
  bBeta: [0.25, 0.1, 0.5, 0.05],
  bReveal: [2, 1, 3, 1],
  bDraftLength: [3, 1, 4, 1],
};
export const foundationDefaults = Object.fromEntries(
  Object.entries(foundationParameters).map(([k, v]) => [k, v[0]]),
);
export const foundationGroups = [
  ['math', '读懂公式与矩阵', '先知道符号在说什么，再做几次小计算。'],
  ['probability', '概率与统计', '理解分布、条件、抽样和不确定性。'],
  ['models', '语言模型基础', '把向量、概率和模型的生成过程连起来。'],
  ['generation', '扩散与生成方式', '理解多轮去噪，也分清不同的多 token 方法。'],
];
