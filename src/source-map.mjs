export { reviewedCommit } from './source-version.mjs';
export const sourceKey = (ref) =>
  [ref.path, ref.symbol || '', ref.heading || '', ref.needle || ''].join('#');

const scheduler = 'vllm/v1/core/sched/scheduler.py';
const runner = 'vllm/v1/worker/gpu_model_runner.py';
const runner2 = 'vllm/v1/worker/gpu/model_runner.py';
const sampler = 'vllm/v1/sample/sampler.py';
const rejection = 'vllm/v1/sample/rejection_sampler.py';
const pool = 'vllm/v1/core/block_pool.py';
const kv = 'vllm/v1/core/kv_cache_manager.py';
const core = 'vllm/v1/engine/core.py';

// One entry per authored step: [lesson reference index OR path, qualified symbol
// OR exact Markdown heading, optional unique text within that symbol].
// Documentation anchors deliberately remain labelled as documentation in the UI.
const anchors = {
  lifecycle: [
    [0, 'InputProcessor.process_inputs'],
    [1, 'AsyncMPClient.add_request_async'],
    [2, 'Scheduler.schedule'],
    [3, 'GPUModelRunner.execute_model'],
    [4, 'Sampler.forward'],
    [5, 'OutputProcessor.process_outputs'],
  ],
  prefill: [
    [0, 'Scheduler.schedule', 'num_new_tokens = ('],
    [1, 'FlashAttentionImpl.forward'],
    [sampler, 'Sampler.forward'],
    [runner, 'GPUModelRunner._prepare_inputs'],
    [scheduler, 'Scheduler._update_request_with_output'],
  ],
  configuration: [
    [0, 'EngineArgs.from_cli_args'],
    [0, 'EngineArgs.create_engine_config'],
    [1, 'VllmConfig.__post_init__'],
    [1, 'VllmConfig.use_v2_model_runner'],
  ],
  async: [
    [0, 'AsyncLLM.add_request'],
    [1, 'EngineCore.step'],
    [1, 'EngineCore.step_with_batch_queue'],
    [2, 'AsyncScheduler._update_request_with_output'],
  ],
  scheduler: [
    [0, 'Scheduler.add_request'],
    [0, 'Scheduler.schedule', 'token_budget = self.max_num_scheduled_tokens'],
    [1, 'SchedulerOutput'],
    [0, 'Scheduler._free_request'],
    [0, 'Scheduler._select_waiting_queue_for_scheduling'],
  ],
  chunked: [
    [0, 'Scheduler.add_request'],
    [0, 'Scheduler.schedule', 'num_new_tokens, token_budget, input_budget - draft_slots'],
    [0, 'Scheduler._update_after_schedule'],
    [0, 'Scheduler.update_from_output'],
    [0, 'Scheduler.schedule', 'num_new_tokens = ('],
  ],
  paged: [
    [2, 'BlockTable.add_row'],
    [1, 'BlockPool.get_new_blocks'],
    [2, 'BlockTable.compute_slot_mapping'],
    ['vllm/v1/attention/backends/flash_attn.py', 'FlashAttentionImpl.forward'],
    [1, 'BlockPool.free_blocks'],
  ],
  prefix: [
    [1, 'hash_block_tokens'],
    [pool, 'BlockPool.cache_full_blocks'],
    [0, 'KVCacheManager.get_computed_blocks'],
    [pool, 'BlockPool.touch'],
    [kv, 'KVCacheManager.allocate_slots'],
  ],
  preemption: [
    [kv, 'KVCacheManager.allocate_slots'],
    [0, 'Scheduler._preempt_request'],
    [0, 'Scheduler._preempt_request', 'request.num_computed_tokens = 0'],
    [0, 'Scheduler.finish_requests'],
  ],
  priority: [
    ['vllm/v1/request.py', 'Request.__lt__'],
    [0, 'PriorityRequestQueue'],
    [1, 'Scheduler.schedule'],
    [1, 'Scheduler._preempt_request'],
  ],
  hybrid: [
    [0, 'KVCacheSpec'],
    [0, 'KVCacheGroupSpec'],
    [1, 'SlidingWindowManager.get_num_skipped_tokens'],
    [2, '## Prefix caching'],
  ],
  runner: [
    [0, 'GPUModelRunner.execute_model'],
    [0, 'GPUModelRunner._update_states'],
    [0, 'GPUModelRunner._prepare_inputs'],
    [0, 'GPUModelRunner.sample_tokens'],
  ],
  'model-loading': [
    ['vllm/engine/arg_utils.py', 'EngineArgs.create_model_config'],
    [0, '_ModelRegistry.resolve_model_cls'],
    [2, 'get_model_loader'],
    [1, 'DefaultModelLoader.load_weights'],
  ],
  'attention-backends': [
    [0, 'get_attn_backend'],
    [2, 'AttentionBackend.validate_configuration'],
    [2, 'AttentionMetadataBuilder.build'],
    ['vllm/v1/attention/backends/flash_attn.py', 'FlashAttentionImpl.forward'],
  ],
  mla: [
    [1, 'get_attn_spec_kind'],
    [0, '## Background'],
    [0, '## How It Works'],
    [0, '## How It Works'],
  ],
  sampling: [
    [0, 'Sampler.forward'],
    [0, 'Sampler.apply_temperature'],
    [1, 'apply_top_k_top_p_pytorch'],
    [1, 'random_sample'],
  ],
  logits: [
    [0, 'LogitsProcessor.update_state'],
    [0, 'LogitsProcessor.apply'],
    [1, 'Watermarker.sample'],
    [2, 'WatermarkDetector.detect'],
  ],
  beam: [
    [0, 'BeamSearchOfflineMixin.beam_search'],
    [0, 'BeamSearchOfflineMixin._beam_search_step'],
    [0, 'BeamSearchOfflineMixin._beam_search_step'],
    [1, 'ParentRequest.get_outputs'],
  ],
  compile: [
    [1, '### 1. Dynamo Tracing'],
    [1, '### 3. IR Fusion and Transformation Passes'],
    [0, 'CompilerManager.compile'],
    [0, 'wrap_with_cudagraph_if_needed'],
  ],
  cudagraph: [
    [1, '### Full CUDA Graph capturing & warm-up'],
    [0, 'CUDAGraphWrapper.__call__'],
    [1, '### `CudagraphDispatcher`'],
    [0, 'CUDAGraphWrapper.__call__', 'replay()'],
  ],
  quantization: [
    [0, 'get_quantization_config'],
    [1, '### Implementing a Quantized Linear Method'],
    [1, '## Supported Hardware'],
    [1, '# Quantization'],
  ],
  'kv-quant': [
    [0, '### Supported FP8 KV-Cache Quantization Schemes'],
    [0, '### Scale Calibration Approaches'],
    [2, 'TurboQuantAttentionImpl.do_kv_cache_update'],
    [1, '# FP8 ViT Encoder Attention'],
  ],
  'online-quant': [
    [0, '## Supported Schemes'],
    [0, '# Online Quantization'],
    [0, '### Online quantization on unquantized layers from partially-quantized checkpoints'],
    [0, '### Activation overrides on already-quantized checkpoints'],
  ],
  speculative: [
    [runner, 'GPUModelRunner.propose_draft_token_ids'],
    [runner, 'GPUModelRunner.execute_model'],
    [1, 'rejection_random_sample_kernel'],
    [1, 'sample_recovered_tokens_kernel'],
    [1, 'RejectionSampler.parse_output'],
  ],
  'dynamic-spec': [
    [0, '## Why is Dynamic SD needed?'],
    [1, 'build_dynamic_sd_schedule_lookup'],
    [1, 'validate_and_normalize_dynamic_sd_schedule'],
    [0, '## `--speculative-config` schema'],
  ],
  'adaptive-spec': [
    [0, '## Tuning the cost profile'],
    [0, '# Adaptive Verification'],
    [0, '# Adaptive Verification'],
    [0, '## Requirements and limitations'],
  ],
  speculators: [
    [1, 'ExtractHiddenStatesProposer.propose'],
    [0, '# vLLM-Project/Speculators'],
    [0, '## Resources'],
    [rejection, 'RejectionSampler.forward'],
  ],
  tp: [
    [0, 'RowParallelLinear.weight_loader'],
    [0, 'RowParallelLinear.forward'],
    [1, 'GroupCoordinator.all_reduce'],
    [0, 'ColumnParallelLinear.forward'],
  ],
  pp: [
    [0, 'initialize_model_parallel'],
    [runner, 'GPUModelRunner._model_forward'],
    [0, 'GroupCoordinator.send_tensor_dict'],
    [1, 'MultiprocExecutor.sample_tokens'],
  ],
  dp: [
    [2, 'ParallelConfig'],
    ['vllm/v1/engine/core_client.py', 'DPLBAsyncMPClient.get_core_engine_for_request'],
    [0, 'DPCoordinatorProc.process_input_socket'],
    ['vllm/v1/engine/async_llm.py', 'AsyncLLM._run_output_handler'],
  ],
  cp: [
    ['vllm/config/parallel.py', 'ParallelConfig.set_dcp_defaults'],
    [0, 'maybe_gather_mla_latent_cache_inputs'],
    [1, 'DCPCombine.__call__'],
    [2, 'merge_attn_states'],
  ],
  moe: [
    [1, '### FusedMoEModularKernel'],
    [1, '### FusedMoEPrepareAndFinalizeModular'],
    [1, '### FusedMoEExpertsModular'],
    [1, '### TopKWeightAndReduce'],
  ],
  eplb: [
    [0, 'EplbState.step'],
    [0, 'EplbState.rearrange'],
    [1, 'rearrange_expert_weights_inplace'],
    [0, 'EplbState.update_mapping'],
  ],
  dbo: [
    [0, '### GPU Model Runner'],
    [1, 'UBatchContext.switch_to_comm'],
    [1, 'UBatchContext.switch_to_compute'],
    [1, 'UBatchContext._wait_comm_done'],
  ],
  elastic: [
    ['vllm/v1/engine/core_client.py', 'DPLBAsyncMPClient.prepare_elastic_ep'],
    ['vllm/v1/engine/core_client.py', 'DPLBAsyncMPClient._prepare_scale_up_elastic_ep'],
    ['vllm/v1/engine/core_client.py', 'DPLBAsyncMPClient.commit_elastic_ep'],
    [1, 'ParallelConfig.reconfigure_for_independent_dp_rank'],
  ],
  structured: [
    [0, 'StructuredOutputManager.grammar_init'],
    [1, 'XgrammarBackend.compile_grammar'],
    [1, 'XgrammarGrammar.fill_bitmask'],
    [1, 'XgrammarGrammar.accept_tokens'],
    [1, 'XgrammarGrammar.is_terminated'],
  ],
  lora: [
    [1, 'LoRAModelManager._create_lora_modules'],
    [0, 'WorkerLoRAManager.set_active_adapters'],
    [1, 'LoRAModelManager.set_adapter_mapping'],
    [2, '# LoRA Adapters'],
  ],
  multimodal: [
    [0, 'BaseMultiModalProcessor.apply'],
    [0, 'BaseMultiModalProcessor._apply_prompt_updates'],
    [runner, 'GPUModelRunner._execute_mm_encoder'],
    [runner, 'GPUModelRunner._gather_mm_embeddings'],
  ],
  'prompt-embeds': [
    [0, '## What are prompt embeddings?'],
    [1, 'InputProcessor.process_inputs'],
    [runner, 'GPUModelRunner._prepare_inputs'],
    [runner, 'GPUModelRunner._model_forward'],
  ],
  speech: [
    [0, 'OpenAIServingRealtime.transcribe_realtime'],
    [1, 'SpeechToTextBaseServing._preprocess_speech_to_text'],
    [2, 'StreamingUpdate.from_request'],
    [1, 'SpeechToTextBaseServing._speech_to_text_stream_generator'],
  ],
  tools: [
    [2, '## Automatic Function Calling'],
    [2, '## Constrained Decoding Behavior'],
    [3, '## Streaming chat completions'],
    [2, '## Quickstart'],
  ],
  thinking: [
    [0, 'maybe_create_thinking_budget_state_holder'],
    [0, 'ThinkingBudgetStateHolder._update_think_state'],
    [0, 'ThinkingBudgetStateHolder._apply_forcing_to_logits'],
    [2, '## How Interleaved Thinking Works'],
  ],
  pooling: [
    [0, 'get_seq_pooling_method'],
    [runner, 'GPUModelRunner._model_forward'],
    [0, 'MeanPool.forward'],
    [2, 'ServingEmbedding._build_response'],
  ],
  'long-context': [
    [0, '### Key Parameters'],
    [1, 'get_rope'],
    [2, 'FullAttentionSpec.max_memory_usage_bytes'],
    [0, '# Context Extension'],
  ],
  diffusion: [
    [0, 'DiffusionConfig'],
    [1, 'DiffusionGemmaRequestStates.init_canvas'],
    [1, '_compiled_sample_step'],
    [1, 'DiffusionGemmaModelState.custom_sampler'],
  ],
  disagg: [
    [1, '# Disaggregated Prefilling (experimental)'],
    [runner, 'GPUModelRunner.execute_model'],
    [0, 'KVConnectorBase_V1.start_load_kv'],
    [0, 'KVConnectorBase_V1.get_finished'],
  ],
  offload: [
    [2, '## Terminology: Chunks'],
    [0, 'OffloadingManager'],
    [0, 'OffloadingManager'],
    [2, '## Overview'],
  ],
  'encoder-disagg': [
    [0, '### Key abstractions'],
    [runner, 'GPUModelRunner._execute_mm_encoder'],
    [2, 'ECConnectorModelRunnerMixin.maybe_save_ec_to_connector'],
    [2, 'ECConnectorModelRunnerMixin.maybe_get_ec_connector_output'],
  ],
  serving: [
    [1, 'OpenAIServingResponses._validate_create_responses_input'],
    [0, 'OpenAIServingChat.render_chat_request'],
    [0, 'OpenAIServingChat.chat_completion_stream_generator'],
    [0, 'OpenAIServingChat.chat_completion_full_generator'],
  ],
  sleep: [
    [core, 'EngineCore.pause_scheduler'],
    [1, 'Worker.sleep'],
    [1, 'Worker.wake_up'],
    [core, 'EngineCore.reset_prefix_cache'],
  ],
  metrics: [
    [0, 'RequestStateStats'],
    [0, 'IterationStats.update_from_output'],
    [0, 'IterationStats.update_from_finished_request'],
    [3, 'EventPublisher.publish'],
  ],
  invariance: [
    [0, '## Enabling Batch Invariance'],
    [0, '## Motivation'],
    [0, '## Implementation Details'],
    [0, '## Tested Models'],
  ],
  fault: [
    [0, 'EngineCoreSentinel.on_fault'],
    [0, 'EngineCoreSentinel._push_status'],
    [1, 'WorkerSentinel._clean_worker_state'],
    [0, 'EngineCoreSentinel.retry'],
  ],
  platform: [
    [0, 'resolve_current_platform_cls_qualname'],
    [1, 'CustomOp.dispatch_forward'],
    [1, 'CustomOp.forward'],
    [2, '## Types of Supported CustomOp in vLLM'],
  ],
  plugins: [
    [0, 'load_plugins_by_group'],
    [1, '## How vLLM Discovers Plugins'],
    [0, 'load_general_plugins'],
    [1, '## Compatibility Guarantee'],
  ],
  connectors: [
    [0, 'KVConnectorFactory.create_connector'],
    [1, 'KVConnectorBase_V1.build_connector_meta'],
    [1, 'KVConnectorBase_V1.start_load_kv'],
    [1, 'KVConnectorBase_V1.get_finished'],
  ],
  rust: [
    [0, '## Architecture'],
    [1, '# gRPC protocol'],
    [0, '### External Engine'],
    [0, '### Example Request'],
  ],
  compatibility: [
    [0, '### Feature x Hardware'],
    [0, '### Feature x Feature'],
    [1, 'VllmConfig.__post_init__'],
    [2, 'SpeculativeConfig._verify_args'],
  ],
};

export function bindSources(lessons) {
  for (const lesson of lessons) {
    // Method-specific storyboards colocate their code anchors with their steps.
    if (lesson.kind === 'spec-method') {
      if (!lesson.steps.every((s) => s.source?.path && (s.source.symbol || s.source.heading)))
        throw Error(`Incomplete source mapping: ${lesson.id}`);
      continue;
    }
    const entries = anchors[lesson.id];
    if (!entries || entries.length !== lesson.steps.length)
      throw Error(`Incomplete source mapping: ${lesson.id}`);
    lesson.steps.forEach((step, index) => {
      const [file, target, needle] = entries[index];
      step.source = {
        path: typeof file === 'number' ? lesson.refs[file].path : file,
        ...(target.startsWith('#') ? { heading: target } : { symbol: target }),
        ...(needle ? { needle } : {}),
        observe: step.change,
      };
    });
    if (lesson.id === 'runner') {
      const methods = ['execute_model', 'update_requests', 'prepare_inputs', 'sample_tokens'];
      lesson.steps.forEach(
        (step, i) =>
          (step.alternateSource = {
            path: runner2,
            symbol: `GPUModelRunner.${methods[i]}`,
            observe: `MRV2 路径：${step.change}`,
          }),
      );
    }
  }
}
