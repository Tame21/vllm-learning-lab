const gumbel = 'vllm/v1/watermarking/gumbel.py';
export const serviceSources = {
  sampling: { path: 'vllm/v1/sample/sampler.py', symbol: 'Sampler.sample' },
  watermark: { path: gumbel, symbol: 'GumbelWatermarker.sample' },
  detection: { path: gumbel, symbol: 'GumbelWatermarkDetector._score_tokens' },
  survival: { path: gumbel, symbol: '_gamma_survival_integer_shape' },
  fp8Write: { path: 'vllm/v1/attention/backends/flash_attn.py', symbol: 'FlashAttentionImpl.do_kv_cache_update' },
  fp8Overview: { path: 'docs/features/quantization/quantized_kvcache.md', needle: '### Supported FP8 KV-Cache Quantization Schemes' },
  onlineWeights: { path: 'vllm/model_executor/layers/quantization/online/fp8.py', symbol: 'Fp8PerTensorOnlineLinearMethod.process_weights_after_loading' },
  onlineApply: { path: 'vllm/model_executor/layers/quantization/online/fp8.py', symbol: 'Fp8PerTensorOnlineLinearMethod.apply' },
};
