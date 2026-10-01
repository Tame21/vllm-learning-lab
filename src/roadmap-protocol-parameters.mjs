export const roadmapProtocolCatalog = {
  speech: {
    parameters: { speechChunks: [4, 2, 5, 1], speechCommit: [2, 1, 2, 1], speechSupported: [true] },
    labels: { speechChunks: '教学音频块数', speechCommit: '每组提交的音频块', speechSupported: '所选模型支持流式续接' },
    note: '音频向量与转写片段为教学数据；缓冲和续接能力由真实模型接口决定。',
    presets: [['分组音频续接', {}], ['逐块提交', { speechCommit: 1 }], ['模型不支持续接', { speechSupported: false }]],
  },
  tools: {
    parameters: { parserChunk: [9, 3, 15, 3], parserMalformed: [false], parserEnabled: [true] },
    labels: { parserChunk: '教学文本块字符数', parserMalformed: '工具 JSON 缺少右括号', parserEnabled: '启用匹配的教学 parser' },
    note: 'scratch_pad / tool_call 教学标记；展示跨块缓冲与完整 JSON 检查，不执行工具。',
    presets: [['跨块工具参数', {}], ['小块标记边界', { parserChunk: 3 }], ['损坏的工具 JSON', { parserMalformed: true }], ['关闭 parser', { parserEnabled: false }]],
  },
  thinking: {
    parameters: { thinkBudget: [3, 0, 5, 1], thinkEndParts: [2, 1, 2, 1], thinkInterleave: [true], thinkEndKnown: [true] },
    labels: { thinkBudget: '每段教学思考 token 预算', thinkEndParts: '结束标记 token 数', thinkInterleave: '正文后再次进入思考', thinkEndKnown: '配置已知的思考结束 token' },
    note: '非投机、单请求状态机；预算为 0 时直接强制结束标记，结束序列可以有多个 token。',
    presets: [['分段思考预算', {}], ['零预算立即退出', { thinkBudget: 0 }], ['缺少结束标记配置', { thinkEndKnown: false }]],
  },
  'encoder-disagg': {
    parameters: { ecItems: [2, 1, 3, 1], ecRepeat: [true], ecCacheHit: [false], ecDelay: [2, 1, 3, 1], ecFail: [false] },
    labels: { ecItems: '媒体任务数', ecRepeat: '任务共享媒体内容', ecCacheHit: '共享 EC 已有有效特征', ecDelay: '特征传输时隙', ecFail: '特征传输失败' },
    note: 'EC 是 encoder 特征；到达消费侧并确认后才可用于媒体占位，不与 K/V 混用。',
    presets: [['编码后复用 EC', {}], ['已有 EC 缓存命中', { ecCacheHit: true }], ['传输失败阻止 LM', { ecFail: true }]],
  },
  serving: {
    parameters: { serveTokens: [4, 1, 5, 1], serveDelay: [2, 1, 3, 1], serveUsage: [true], serveCancel: [0, 0, 5, 1], serveInvalid: [false] },
    labels: { serveTokens: '教学输出片段数', serveDelay: '客户端消费间隔', serveUsage: '末尾包含 usage 块', serveCancel: '产生第几个片段时断连（0 关闭）', serveInvalid: '请求校验失败' },
    note: '展示 OpenAI Chat Completions SSE 的简化响应；人工时隙只用于观察输出队列。',
    presets: [['SSE 与 usage', {}], ['慢客户端积压', { serveDelay: 3 }], ['第二片段断连', { serveCancel: 2 }], ['请求无效', { serveInvalid: true }]],
  },
  fault: {
    parameters: { faultCancel: [false], faultAck: [2, 1, 3, 1], faultRetry: [true] },
    labels: { faultCancel: '仅取消 A（关闭则 worker 故障）', faultAck: '在途工作确认时隙', faultRetry: '示例恢复策略成功' },
    note: '调度块释放和在途物理工作确认分开；恢复健康不会自动重放已中止的请求。',
    presets: [['Worker 故障传播', {}], ['只取消请求 A', { faultCancel: true }], ['恢复失败保留错误', { faultRetry: false }]],
  },
};
