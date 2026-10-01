export const roadmapSources = {
  rustType: { path: 'rust/src/engine-core-client/src/protocol/request.rs', needle: 'pub enum EngineCoreRequestType' },
  rustRequest: { path: 'rust/src/engine-core-client/src/protocol/request.rs', needle: 'pub struct EngineCoreRequest' },
  rustOutput: { path: 'rust/src/engine-core-client/src/protocol/output.rs', needle: 'pub enum EngineCoreFinishReason' },
  layerLoad: { path: 'vllm/distributed/kv_transfer/kv_connector/v1/base.py', symbol: 'KVConnectorBase_V1.wait_for_layer_load' },
  endpoint: { path: 'vllm/plugins/__init__.py', symbol: 'load_endpoint_plugins' },
  tritonForward: { path: 'vllm/v1/attention/backends/triton_attn.py', symbol: 'TritonAttentionImpl.forward' },
};
