const map = {
  'README.md': ['compatibility', '文档兼容性表是入口，最终以配置校验和实际后端为准。'],
  'automatic_prefix_caching.md': ['prefix', '复用已有 KV，不能缓存或跳过整个答案。'],
  'batch_invariance.md': ['invariance', '批次不变性涉及数值路径；本快照文档标记 beta。'],
  'context_extension.md': ['long-context', '位置编码、长度、缓存容量与质量验证需要一起考虑。'],
  'custom_arguments.md': ['serving', '自定义参数在协议解析后进入相应配置。'],
  'custom_logitsprocs.md': ['logits', '在受支持的采样路径修改候选分数。'],
  'disagg_encoder.md': ['encoder-disagg', '独立 encoder 传递媒体特征。'],
  'disagg_prefill.md': ['disagg', '交接 KV 数据与完成状态。'],
  'ec_cpu_connector.md': ['encoder-disagg', 'EC CPU connector 缓存 encoder 输出。'],
  'index_cache.md': ['mla', 'F 层计算 top-k，S 层复用索引。'],
  'interleaved_thinking.md': ['thinking', '按模型标记与解析状态处理交错推理。'],
  'kv_offloading_usage.md': ['offload', '使用外部容量需考虑传输依赖与加载开销。'],
  'lora.md': ['lora', '请求级映射让多个 LoRA 共用基础模型。'],
  'multimodal_inputs.md': ['multimodal', 'processor、encoder 与占位符合并均有模型专用行为。'],
  'per_request_metrics.md': ['metrics', '明确请求起点、首 token 与结束时间。'],
  'prompt_embeds.md': ['prompt-embeds', '预计算向量不会跳过后续模型前向。'],
  'reasoning_outputs.md': ['tools', '模型专用 parser 拆分 reasoning 与正文。'],
  'sleep_mode.md': ['sleep', '区分备份权重的 level 1 和丢弃权重的 level 2。'],
  'structured_outputs.md': ['structured', '逐 token 更新语法允许集合。'],
  'tool_calling.md': ['tools', '返回工具调用结构，由调用方执行。'],
  'watermarking.md': ['logits', '生成器与匹配检测器共同定义统计信号。'],
  'quantization/bnb.md': ['plugins', 'BitsAndBytes 已迁往仓库外插件。', '外部插件'],
  'quantization/gguf.md': ['plugins', 'GGUF 已迁往仓库外插件。', '外部插件'],
  'quantization/quantized_kvcache.md': ['kv-quant', 'KV dtype、scale 与 attention 后端需匹配。'],
  'quantization/fp8_vit_attn.md': ['kv-quant', '视觉 encoder FP8 attention 有独立限制。'],
  'quantization/online.md': ['online-quant', '加载时转换权重，前向时按方案处理激活尺度。'],
  'speculative_decoding/README.md': ['speculative', '连续接受前缀与首次拒绝决定本轮提交。'],
  'speculative_decoding/draft_model.md': ['draft-model', '独立小模型逐 token 提议，目标模型验证。'],
  'speculative_decoding/n_gram.md': ['ngram', '从已有 token 匹配中提出候选。'],
  'speculative_decoding/suffix.md': ['suffix', '按后缀续写频次提议，实际候选长度可变。'],
  'speculative_decoding/eagle.md': ['eagle', '目标特征与专用草稿结构共同提议。'],
  'speculative_decoding/mtp.md': ['mtp', 'MTP 与模型结构关联，不是通用加头开关。'],
  'speculative_decoding/mlp.md': [
    'mlp-spec',
    'MLP 级联机制；当前模型注册未启用，Runner 未接入。',
    '机制参考',
  ],
  'speculative_decoding/extract_hidden_states.md': [
    'speculators',
    '保存隐藏状态，准备草稿训练数据。',
  ],
  'speculative_decoding/speculators.md': [
    'speculators',
    '外部库负责草稿训练，本仓提供数据与推理集成。',
    '外部训练项目',
  ],
  'speculative_decoding/parallel_draft_model.md': [
    'parallel-draft',
    '只支持对应方法和模型的并行提议。',
  ],
  'speculative_decoding/dynamic_speculative_decoding.md': [
    'dynamic-spec',
    '按 batch-size 配置区间选择 K。',
  ],
  'speculative_decoding/adaptive_verification.md': [
    'adaptive-spec',
    '用置信度和成本分配预算，有明确支持条件。',
  ],
  'speculative_decoding/acceptance_metrics.md': [
    'adaptive-spec',
    '逐位置接受率、接受长度和性能收益并不相同。',
  ],
};
const quantNotes = {
  auto_awq: 'AWQ 的分组、scale 与打包格式需匹配 kernel；整数示例不实现 AWQ 校准。',
  b12x: 'b12x 是可选设备 kernel 后端，linear 与 MoE 可分别选择，存在格式与平台限制。',
  gptqmodel: 'GPTQ checkpoint 经对应配置和 kernel 消费；本工具不运行 GPTQ 校准。',
  inc: 'AutoRound / INC 负责量化导出；可用 recipe 取决于平台与文件格式。',
  fp8: 'FP8 使用低精度浮点格式与尺度；INT 示意图不模拟 FP8 的指数和尾数。',
  int4: 'W4A16 使用 4 bit 权重和 16 bit 激活；另有分组与尺度元数据。',
  int8_w4a8: 'W4A8 的权重与激活位宽不同，不能只按权重估计整体资源。',
  int8_w8a8: 'W8A8 同时量化权重与激活，分别需要对应尺度。',
  modelopt: 'ModelOpt 导出的配置、尺度与 checkpoint 格式决定推理路径。',
  quark: 'Quark 模型需要正确导出格式与受支持的设备实现。',
  torchao: 'TorchAO 使用对应量化配置及张量表示，能力需看本地文档。',
  README: '先读注册、装载、层选择、kernel 主链，再扩展各格式。',
};
export function coverageFor(path) {
  const p = path.replace('docs/features/', '');
  if (map[p]) return { lesson: map[p][0], note: map[p][1], level: map[p][2] || '机制演示' };
  if (p.startsWith('quantization/'))
    return {
      lesson: 'quantization',
      note:
        quantNotes[p.split('/').at(-1).replace('.md', '')] ||
        '量化工具准备表示，推理后端消费对应格式。',
      level: '后端变体',
    };
  if (/^(nixl|mooncake|moriio)_/.test(p))
    return {
      lesson: 'connectors',
      note: '展示 connector 生命周期；传输模式、版本与兼容性以本地文档为准。',
      level: '传输变体',
    };
  return null;
}
