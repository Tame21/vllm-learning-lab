import { mechanismDefaults } from '../mechanism-parameters.mjs';
import { analyzeCommand } from '../command-flow.mjs';
import { snapshot } from './roadmap-core.mjs';
import { roadmapSources as S } from '../roadmap-sources.mjs';
const begin = (input, state) => {
  const o = { ...mechanismDefaults, ...input }, frames = [];
  Object.assign(state, { status: '收集输入条件', checks: [], blocked: false });
  const snap = (step, event, source) => snapshot(frames, state, step, event, source ? { source: { ...source, observe: event } } : {});
  return { o, state, frames, snap };
};
export function configurationTrace(input = {}) {
  const { o, state, frames, snap } = begin(input, { objects: [], command: '', route: null });
  state.command = `VLLM_USE_V2_MODEL_RUNNER=${o.cfgV2 ? 1 : 0} vllm serve demo-model --tensor-parallel-size ${o.cfgTP}${o.cfgNgram ? ` --speculative-config '{"method":"ngram","num_speculative_tokens":3,"prompt_lookup_min":1,"prompt_lookup_max":3}'` : ''}`;
  const analysis = analyzeCommand(state.command);
  snap(0, '命令经过已有解析器产生 EngineArgs；不会执行 serve 或下载模型。');
  const objects = [
    { name: 'ModelConfig', values: { model: 'demo-model', teaching_heads: o.cfgHeads } },
    { name: 'ParallelConfig', values: { tensor_parallel_size: o.cfgTP } },
    { name: 'SpeculativeConfig', values: o.cfgNgram ? { method: 'ngram', num_speculative_tokens: 3 } : null },
    { name: 'Runner 环境选择', values: { VLLM_USE_V2_MODEL_RUNNER: o.cfgV2 ? '1' : '0' } },
  ];
  for (const object of objects) { state.objects.push(object); snap(1, `${object.name} 收到对应输入，其他子配置保持默认。`); }
  state.checks.push({ condition: 'Attention 头数能被 TP 整除', ok: o.cfgHeads % o.cfgTP === 0, detail: `${o.cfgHeads} % ${o.cfgTP} = ${o.cfgHeads % o.cfgTP}` });
  snap(2, '模型与并行配置交叉校验，不能仅检查 CLI 类型。');
  state.checks.push({ condition: '启动分析器已检查的组合', ok: !analysis.errors.length, detail: analysis.errors.join('；') || '未发现已知组合错误' });
  state.blocked = state.checks.some((x) => !x.ok); snap(2, '复用启动分析器的 Runner / 投机边界检查。');
  state.route = state.blocked ? null : o.cfgV2 ? 'MRV2' : 'MRV1'; state.status = state.blocked ? '配置校验失败' : `选择 ${state.route} 教学路径`;
  snap(3, state.blocked ? '错误组合没有引擎执行路径。' : '真实启动仍需加载模型配置并执行其余平台与特性校验。'); return frames;
}
export function backendSelectionTrace(input = {}) {
  const { o, state, frames, snap } = begin(input, { candidates: ['FLASH_ATTN', 'TRITON_ATTN'].map((name) => ({ name, checks: [], eligible: null })), selected: null, metadata: null });
  const dtype = ['float16', 'bfloat16', 'float32'][o.attDtype];
  state.inputs = { head: o.attHead, dtype, capability: o.attCapability, block: o.attBlock, mla: o.attMla, fa4: o.attFa4 };
  snap(0, '固定 CUDA 教学候选集合；KV dtype=auto、Decoder、无 sink、无 sparse。');
  const rows = [
    ['head size', o.attHead % 8 === 0 && o.attHead <= (o.attFa4 ? 512 : 256), o.attHead >= 32, `head=${o.attHead}`],
    ['计算 dtype', o.attDtype < 2, o.attDtype < 2, dtype],
    ['block size', o.attBlock % 16 === 0, o.attBlock % 16 === 0, `block=${o.attBlock}`],
    ['CUDA capability', o.attCapability >= 8, true, `${o.attCapability}.0`],
    ['Dense / MLA 类型匹配', !o.attMla, !o.attMla, o.attMla ? '请求 MLA，两个 Dense 候选均排除' : 'Dense'],
  ];
  for (const [condition, flash, triton, detail] of rows) {
    state.candidates[0].checks.push({ condition, ok: flash, detail }); state.candidates[1].checks.push({ condition, ok: triton, detail });
    snap(1, `逐项检查 ${condition}，保留具体淘汰原因。`);
  }
  for (const c of state.candidates) c.eligible = c.checks.every((x) => x.ok);
  state.selected = state.candidates.find((x) => x.eligible)?.name ?? null; state.blocked = !state.selected;
  state.metadata = state.selected ? { query_start_loc: [0, 1, 3], seq_lens: [4, 6], slot_mapping: [3, 4, 5] } : null;
  snap(2, state.selected ? '本窗口按 Flash、Triton 的教学顺序选择通过项，再整理示例元数据。' : '没有候选通过，不构造可执行元数据。');
  state.status = state.selected ? `${state.selected} 通过已检查条件` : '无候选通过条件'; snap(3, '包可用性、FA 版本细分组合、后端策略与其余功能仍需真实启动检查；这里不调用 kernel。', state.selected === 'TRITON_ATTN' ? S.tritonForward : undefined); return frames;
}
export function adaptiveVerificationTrace(input = {}) {
  const { o, state, frames, snap } = begin(input, { slots: [], costRows: [], chosen: null, allocated: { A: 0, B: 0 } });
  for (let n = 0; n <= 6; n++) state.costRows.push({ n, cost: 2 + 0.1 * n + o.avCost * Math.max(0, n - 2) ** 2, expected: null, efficiency: null });
  snap(0, '成本表是教学输入，模拟捕获图 shape 的测量结果，单位不代表真实吞吐。');
  for (const [id, confidence] of [['A', o.avConfidenceA], ['B', o.avConfidenceB]]) {
    for (let position = 1; position <= 3; position++) { state.slots.push({ id, position, confidence, survival: confidence ** position, admitted: false }); snap(1, `${id} 第 ${position} 位存活概率为前缀条件置信度连乘。`); }
  }
  state.slots.sort((a, b) => b.survival - a.survival || a.position - b.position || a.id.localeCompare(b.id));
  for (const row of state.costRows) { row.expected = 2 + state.slots.slice(0, row.n).reduce((sum, x) => sum + x.survival, 0); row.efficiency = row.expected / row.cost; snap(2, `预算 ${row.n} 的期望产出 / 成本 = ${row.efficiency.toFixed(3)}。`); }
  const best = state.costRows.reduce((a, b) => b.efficiency > a.efficiency ? b : a); state.chosen = best.n;
  for (const slot of state.slots.slice(0, state.chosen)) { slot.admitted = true; state.allocated[slot.id]++; snap(2, `全局预算选择 ${slot.id} / 位置 ${slot.position}；同请求始终保留连续前缀。`); }
  state.checks = [{ condition: '匹配 DSpark confidence head、Full Graph 与设备长度后端', ok: o.avSupported, detail: '还要求无 LoRA、无 PP、非 enforce_eager' }];
  state.blocked = !o.avSupported; state.status = o.avSupported ? '已选择教学验证预算' : '支持条件不满足，禁止启用';
  snap(3, '置信度是估计值，不是实际接受结果；预算会随输入置信度和成本改变。'); return frames;
}
export function platformDispatchTrace(input = {}) {
  const { o, state, frames, snap } = begin(input, { path: [], result: null });
  const platform = ['CUDA', 'ROCm', 'CPU', 'XPU', 'OOT'][o.opPlatform]; state.platform = platform;
  snap(0, '平台标识作为教学输入，不检测当前电脑硬件。');
  const method = o.opEnabled ? ['forward_cuda', 'forward_hip', 'forward_cpu', 'forward_xpu', 'forward_oot'][o.opPlatform] : 'forward_native';
  state.path.push(method); snap(1, o.opEnabled ? `CustomOp.dispatch_forward 选择 ${method}。` : '未启用 CustomOp 时使用 forward_native。');
  const delegated = method === 'forward_hip' ? 'forward_cuda' : ['forward_cpu', 'forward_xpu', 'forward_oot'].includes(method) ? 'forward_native' : null;
  if (delegated) state.path.push(delegated);
  snap(2, delegated ? `基类默认 ${method} 委托到 ${delegated}；具体算子可覆盖。` : '直接调用所选实现。');
  const needsNative = state.path.at(-1) === 'forward_native'; state.checks.push({ condition: '所选实现存在', ok: !needsNative || o.opNative, detail: needsNative ? o.opNative ? '教学 native 已实现' : 'native 基类会抛 NotImplementedError' : '教学 CUDA 实现已存在' });
  state.blocked = state.checks.some((x) => !x.ok); snap(2, '平台分发选中方法不等于方法已经实现。');
  state.result = state.blocked ? null : 2 * o.opInput; state.status = state.blocked ? '所选方法缺少实现' : '教学算子 y=2x'; snap(3, '标量计算仅验证教学分发结果；不执行 CUDA、HIP 或 PyTorch。'); return frames;
}
export function compatibilityTrace(input = {}) {
  const { o, state, frames, snap } = begin(input, {});
  state.features = { method: ['none', 'ngram', 'dspark/confidence'][o.compatMethod], adaptive: o.compatAdaptive, lora: o.compatLora, pp: o.compatPP, eager: o.compatEager, runner: o.compatV2 ? 'MRV2' : 'MRV1' };
  snap(0, '以固定版本的明示约束逐项筛选当前组合。');
  snap(1, '文档线索只覆盖所选检查，其他模型、硬件与 kernel 约束仍需核对。');
  const checks = [
    ['自适应仅用于 DSpark + confidence head', !o.compatAdaptive || o.compatMethod === 2, '固定版本 adaptive verification 支持范围'],
    ['自适应与 LoRA 不能组合', !o.compatAdaptive || !o.compatLora, '设备长度截断与 CPU LoRA 映射边界不一致'],
    ['自适应与 PP 不能组合', !o.compatAdaptive || !o.compatPP, '成本曲线与置信度只存在于末 rank'],
    ['自适应要求 Full CUDA Graph', !o.compatAdaptive || !o.compatEager, 'enforce_eager 被启动校验拒绝'],
    ['MRV2 不支持当前 N-gram 路径', !o.compatV2 || o.compatMethod !== 1, '该方法在 MRV2 支持列表之外'],
  ];
  for (const [condition, ok, detail] of checks) { state.checks.push({ condition, ok, detail }); snap(2, condition); }
  state.blocked = state.checks.some((x) => !x.ok); state.status = state.blocked ? '所选组合存在已知冲突' : '通过本窗口已检查规则';
  snap(3, state.blocked ? '列出的冲突必须解决后才可继续启动。' : '通过当前规则仍需核对 attention backend、模型配置、安装与真实测试。'); return frames;
}
export const roadmapBranchTraces = { configuration: configurationTrace, 'attention-backends': backendSelectionTrace, 'adaptive-spec': adaptiveVerificationTrace, platform: platformDispatchTrace, compatibility: compatibilityTrace };
