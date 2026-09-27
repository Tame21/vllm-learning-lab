const ref = (path, symbol) => ({ path, symbol });
const sample = 'vllm/v1/sample/ops/topk_topp_sampler.py';
const reject = 'vllm/v1/sample/rejection_sampler.py';
const beam = 'vllm/entrypoints/generate/beam_search/offline.py';
const cache = 'vllm/v1/core/block_pool.py';
export const algorithmSources = {
  temperature: ref('vllm/v1/sample/sampler.py', 'Sampler.apply_temperature'),
  greedy: ref('vllm/v1/sample/sampler.py', 'Sampler.greedy_sample'),
  softmax: ref(sample, 'TopKTopPSampler.forward_native'),
  topk: ref(sample, 'apply_top_k_only'),
  topp: ref(sample, 'apply_top_k_top_p_pytorch'),
  minp: ref('vllm/v1/sample/logits_processor/builtin.py', 'MinPLogitsProcessor.apply'),
  penalties: ref('vllm/model_executor/layers/utils.py', 'apply_penalties'),
  exponential: ref(sample, 'random_sample'),
  race: ref(sample, 'sample_with_exponential_noise'),
  rejection: ref(reject, 'rejection_random_sample_kernel'),
  residual: ref(reject, 'sample_recovered_tokens_kernel'),
  greedyVerify: ref(reject, 'rejection_greedy_sample_kernel'),
  ngram: ref(
    'vllm/v1/spec_decode/ngram_proposer.py',
    '_find_longest_matched_ngram_and_propose_tokens',
  ),
  beam: ref(beam, 'BeamSearchOfflineMixin.beam_search'),
  beamStep: ref(beam, 'BeamSearchOfflineMixin._beam_search_step'),
  beamScore: ref('vllm/entrypoints/generate/beam_search/utils.py', 'get_beam_search_score'),
  dynamic: ref('vllm/v1/spec_decode/dynamic/utils.py', 'build_dynamic_sd_schedule_lookup'),
  dynamicValidate: ref(
    'vllm/v1/spec_decode/dynamic/utils.py',
    'validate_and_normalize_dynamic_sd_schedule',
  ),
  attention: ref('vllm/v1/attention/ops/triton_unified_attention.py', 'kernel_unified_attention'),
  online: ref('vllm/v1/attention/ops/triton_attention_helpers.py', 'softmax_step'),
  rope: ref(
    'vllm/model_executor/layers/rotary_embedding/base.py',
    'RotaryEmbedding.forward_static',
  ),
  rms: ref('vllm/ir/ops/layernorm.py', 'rms_norm'),
  slot: ref('vllm/v1/worker/block_table.py', 'ComputeSlotMappingKernel.kernel'),
  hash: ref('vllm/v1/core/kv_cache_utils.py', 'hash_block_tokens'),
  lookup: ref(cache, 'BlockPool.get_cached_block'),
  allocate: ref(cache, 'BlockPool.get_new_blocks'),
  touch: ref(cache, 'BlockPool.touch'),
  free: ref(cache, 'BlockPool.free_blocks'),
  quant: ref(
    'vllm/model_executor/layers/quantization/utils/int8_utils.py',
    '_per_token_quant_int8',
  ),
  lora: ref('vllm/lora/layers/base_linear.py', 'BaseLinearLayerWithLoRA._apply_lora_to_output'),
  moe: ref('vllm/model_executor/layers/fused_moe/router/fused_topk_router.py', 'fused_topk'),
  replicas: ref('vllm/distributed/eplb/policy/default.py', 'DefaultEplbPolicy.replicate_experts'),
  packing: ref('vllm/distributed/eplb/policy/default.py', 'DefaultEplbPolicy.balanced_packing'),
  mean: ref('vllm/model_executor/layers/pooler/seqwise/methods.py', 'MeanPool.forward'),
  last: ref('vllm/model_executor/layers/pooler/seqwise/methods.py', 'LastPool.forward'),
  cls: ref('vllm/model_executor/layers/pooler/seqwise/methods.py', 'CLSPool.forward'),
  normalize: ref(
    'vllm/model_executor/layers/pooler/seqwise/heads.py',
    'EmbeddingPoolerHead.forward',
  ),
};
