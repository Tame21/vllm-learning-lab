import test from 'node:test';
import assert from 'node:assert/strict';
import { configurationTrace, backendSelectionTrace, adaptiveVerificationTrace, platformDispatchTrace, compatibilityTrace } from '../src/engines/roadmap-branches.mjs';
import { analyzeCommand } from '../src/command-flow.mjs';
test('配置分组接受合法 TP，头数不能整除与显式 MRV2 未接入方法阻止路径', () => {
  for (const cfgTP of [1, 2, 3, 4]) {
    const f = configurationTrace({ cfgTP, cfgHeads: 8 }).at(-1); assert.equal(f.blocked, 8 % cfgTP !== 0); assert.equal(f.objects.length, 4);
    assert.equal(f.route, f.blocked ? null : 'MRV1');
  }
  assert.equal(configurationTrace({ cfgV2: true }).at(-1).route, null);
  for (const method of ['ngram', 'ngram_gpu', 'suffix', 'draft_model', 'medusa', 'mlp_speculator']) {
    const a = analyzeCommand(`VLLM_USE_V2_MODEL_RUNNER=1 vllm serve demo --speculative-config '${JSON.stringify({ method, num_speculative_tokens: 2 })}'`);
    assert.ok(a.errors.some((x) => x.includes('init_speculator'))); assert.deepEqual(a.request, []);
  }
});
test('Attention 后端条件保留全部淘汰原因，较小 head 和旧 capability 产生不同候选', () => {
  assert.equal(backendSelectionTrace({ attHead: 16 }).at(-1).selected, 'FLASH_ATTN');
  const old = backendSelectionTrace({ attCapability: 7 }).at(-1); assert.equal(old.selected, 'TRITON_ATTN'); assert.ok(old.source.path.endsWith('triton_attn.py'));
  for (const input of [{ attBlock: 8 }, { attDtype: 2 }, { attMla: true }]) {
    const f = backendSelectionTrace(input).at(-1); assert.equal(f.selected, null); assert.equal(f.metadata, null); assert.ok(f.candidates.every((c) => c.checks.some((x) => !x.ok)));
  }
  assert.equal(backendSelectionTrace({ attHead: 512, attFa4: true }).at(-1).candidates[0].eligible, true);
  assert.equal(backendSelectionTrace({ attHead: 512 }).at(-1).candidates[0].eligible, false);
});
test('存活乘积排序保持每请求前缀，预算最大化教学期望产出/成本而非固定长度', () => {
  for (const avConfidenceA of [0.2, 0.9, 1]) for (const avConfidenceB of [0.2, 0.9, 1]) for (const avCost of [0, 3]) {
    const f = adaptiveVerificationTrace({ avConfidenceA, avConfidenceB, avCost }).at(-1);
    for (const id of ['A', 'B']) {
      const admitted = f.slots.filter((s) => s.id === id && s.admitted).map((s) => s.position).sort();
      assert.deepEqual(admitted, Array.from({ length: f.allocated[id] }, (_, i) => i + 1));
    }
    assert.equal(f.allocated.A + f.allocated.B, f.chosen);
    assert.equal(f.costRows[f.chosen].efficiency, Math.max(...f.costRows.map((r) => r.efficiency)));
    for (const slot of f.slots) assert.equal(slot.survival, (slot.id === 'A' ? avConfidenceA : avConfidenceB) ** slot.position);
  }
  assert.ok(adaptiveVerificationTrace({ avCost: 3 }).at(-1).chosen < adaptiveVerificationTrace({ avCost: 0 }).at(-1).chosen);
  assert.equal(adaptiveVerificationTrace({ avSupported: false }).at(-1).blocked, true);
});
test('CustomOp 默认委托与 native 缺失边界一致，关闭 custom 统一走 native', () => {
  const expected = [['forward_cuda'], ['forward_hip', 'forward_cuda'], ['forward_cpu', 'forward_native'], ['forward_xpu', 'forward_native'], ['forward_oot', 'forward_native']];
  for (let opPlatform = 0; opPlatform < 5; opPlatform++) {
    assert.deepEqual(platformDispatchTrace({ opPlatform }).at(-1).path, expected[opPlatform]);
    assert.equal(platformDispatchTrace({ opPlatform, opInput: 3 }).at(-1).result, 6);
    const native = platformDispatchTrace({ opPlatform, opEnabled: false, opNative: false }).at(-1); assert.equal(native.blocked, true); assert.equal(native.result, null); assert.deepEqual(native.path, ['forward_native']);
  }
});
test('兼容性只在触发相关条件时判冲突，关闭自适应不误报其约束', () => {
  assert.equal(compatibilityTrace().at(-1).blocked, false);
  for (const input of [{ compatLora: true }, { compatPP: true }, { compatEager: true }, { compatMethod: 0 }]) assert.equal(compatibilityTrace(input).at(-1).blocked, true);
  assert.equal(compatibilityTrace({ compatAdaptive: false, compatLora: true, compatPP: true, compatEager: true }).at(-1).blocked, false);
  assert.equal(compatibilityTrace({ compatAdaptive: false, compatMethod: 1, compatV2: true }).at(-1).blocked, true);
});
