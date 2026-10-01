import { mechanismDefaults } from '../mechanism-parameters.mjs';
const record = (frames, state, stepIndex, event, extra = {}) => frames.push(structuredClone({ ...state, stepIndex, events: [event], ...extra }));

export function cudaGraphTrace(input = {}) {
  const o = { ...mechanismDefaults, ...input }, frames = [];
  const sizes = Array.from({ length: o.graphMax / 2 }, (_, i) => 2 * (i + 1));
  const state = { sizes, captured: [], activeSize: null, matched: null, padding: 0, status: '等待预热', mode: '待选择', reason: '', cpuSubmissions: 0, gpuKernels: 0, executed: [], captureKernels: 0 };
  record(frames, state, 0, '示例每次前向包含 kernel A / B / C；捕获大小由本观察窗显式配置。');
  state.status = '预热完成';
  record(frames, state, 0, '准备稳定缓冲区并预热；未模拟真实模型、平台支持校验或初始化 kernel。');
  if (o.graphEnabled) {
    for (const size of sizes) {
      state.activeSize = size;
      state.status = `捕获 batch ${size}`;
      record(frames, state, 1, `开始捕获大小 ${size} 的设备工作与依赖。`);
      state.captureKernels += 3;
      state.captured.push(size);
      record(frames, state, 1, `大小 ${size} 的 A → B → C 已捕获；捕获期间也执行设备工作。`);
    }
  } else {
    state.status = '跳过捕获';
    record(frames, state, 1, 'CUDA Graph 关闭；保留普通逐 kernel 提交路径。');
  }
  state.activeSize = null;
  state.matched = o.graphEnabled && o.graphStable ? sizes.find((size) => size >= o.graphBatch) ?? null : null;
  state.padding = state.matched === null ? 0 : state.matched - o.graphBatch;
  state.mode = state.matched === null ? 'Eager' : 'Graph Replay';
  state.reason = !o.graphEnabled ? '未启用 Graph' : !o.graphStable ? '示例替换了捕获时的输入地址，不能安全回放' : state.matched === null ? '批次超出已捕获范围' : `匹配捕获大小 ${state.matched}，补齐 ${state.padding} 个位置`;
  state.status = '运行路径已选择';
  record(frames, state, 2, `实际 batch=${o.graphBatch}：${state.reason}。`);
  if (state.matched !== null) {
    state.cpuSubmissions = 1;
    record(frames, state, 3, 'CPU 提交一次 replay；GPU 仍执行完整的三项工作。');
  }
  for (const name of ['A', 'B', 'C']) {
    if (state.matched === null) state.cpuSubmissions++;
    state.executed.push(name);
    state.gpuKernels++;
    state.status = `执行 kernel ${name}`;
    record(frames, state, 3, `${state.mode} 执行 kernel ${name}；累计设备 kernel ${state.gpuKernels} 个。`, state.matched === null ? { source: { path: 'vllm/compilation/cuda_graph.py', symbol: 'CUDAGraphWrapper.__call__' } } : {});
  }
  state.status = '本次前向完成';
  record(frames, state, 3, `运行时 CPU 提交 ${state.cpuSubmissions} 次，GPU kernel ${state.gpuKernels} 个；不能据此直接推算加速比。`, state.matched === null ? { source: { path: 'vllm/compilation/cuda_graph.py', symbol: 'CUDAGraphWrapper.__call__' } } : {});
  return frames;
}

export { tieredCacheTrace as kvOffloadTrace } from './tiered-cache.mjs';
