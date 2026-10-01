import test from 'node:test';
import assert from 'node:assert/strict';
import { mlaIndexTrace, extractionDatasetTrace, elasticTopologyTrace, longContextTrace, diffusionCanvasTrace, reductionInvarianceTrace, pluginRegistryTrace, connectorContractTrace, rustProtocolTrace } from '../src/engines/roadmap-models.mjs';
test('MLA 表示和稀疏索引分别变化，S 层复用上一 F 层且不重算', () => {
  for (const mlaRank of [1, 2]) for (const indexFreq of [1, 2, 3]) {
    const f = mlaIndexTrace({ mlaRank, indexFreq }).at(-1); assert.equal(f.computations, Math.ceil(6 / indexFreq)); assert.equal(f.cacheRows.length, 4);
    assert.ok(f.cacheRows.every((r) => r.latent.length === mlaRank && r.reconstructed.length === 4));
    for (let i = 1; i < f.layers.length; i++) if (f.layers[i].kind === 'S') { assert.deepEqual(f.layers[i].indices, f.layers[i - 1].indices); assert.equal(f.layers[i].scores, null); }
  }
});
test('提取层按 token 位置 stack，返回目标 sampled 列；错位不能导出，外部训练没有伪执行', () => {
  const f = extractionDatasetTrace({ dataRows: 6, dataLayers: 3 }).at(-1); assert.deepEqual(f.exported.shape, [6, 3, 2]); assert.equal(f.exported.records.length, 5);
  for (const row of f.rows) for (let layer = 0; layer < 3; layer++) assert.deepEqual(row.hidden[layer], [row.position / 10, layer / 10]);
  assert.deepEqual(f.returned, f.sampled); assert.equal(f.trainedHere, false); assert.equal(f.checkpoint, false);
  const bad = extractionDatasetTrace({ dataMismatch: true }).at(-1); assert.ok(bad.blocked); assert.equal(bad.exported, null);
});
test('EP 扩缩容保留每个逻辑专家，所有权重与组屏障确认后才切拓扑', () => {
  for (const elasticWorld of [1, 2, 4]) for (const elasticBarrier of [true, false]) {
    const trace = elasticTopologyTrace({ elasticWorld, elasticBarrier }), f = trace.at(-1);
    assert.deepEqual(f.target.map((x) => x.expert), [0, 1, 2, 3]); assert.ok(f.target.every((x) => x.rank < elasticWorld));
    for (const frame of trace) if (frame.epoch === 2) assert.ok(frame.groupReady && frame.target.every((x) => x.valid)); else assert.equal(frame.activeWorld, 2);
    assert.equal(f.activeWorld, elasticBarrier ? elasticWorld : 2);
  }
});
test('长上下文旋转保持范数，窗口只改变访问范围，超限不生成位置或缓存', () => {
  for (const longFactor of [1, 4]) for (const longWindow of [0, 4]) {
    const f = longContextTrace({ longFactor, longWindow }).at(-1);
    for (const p of f.pairs) assert.ok(Math.abs(Math.hypot(...p.input) - Math.hypot(...p.output)) < 1e-12);
    assert.equal(f.accessible.length, longWindow || 13); assert.equal(f.maxBytes, 24 * 16);
  }
  const bad = longContextTrace({ longPosition: 16, longMax: 16 }).at(-1); assert.ok(bad.blocked); assert.deepEqual(bad.pairs, []); assert.deepEqual(bad.accessible, []);
});
test('去噪不提前提交；熵接受规则、种子复现与有效 canvas 截短守恒', () => {
  for (const diffCanvas of [2, 6]) for (const diffValid of [2, 6]) for (const diffEntropy of [0, 2]) {
    const trace = diffusionCanvasTrace({ diffCanvas, diffValid, diffEntropy, seed: 11 }), f = trace.at(-1);
    assert.deepEqual(trace, diffusionCanvasTrace({ diffCanvas, diffValid, diffEntropy, seed: 11 }));
    assert.equal(f.output.length, Math.min(diffCanvas, diffValid)); assert.ok(f.converged); assert.equal(f.phase, 'commit');
    assert.ok(trace.slice(0, -1).every((x) => x.output.length === 0));
    for (const frame of trace.filter((x) => x.entropy.length)) {
      let sum = 0, largest = 0;
      for (const { entropy, i } of frame.entropy.map((entropy, i) => ({ entropy, i })).sort((a, b) => a.entropy - b.entropy || a.i - b.i)) { sum += entropy; largest = Math.max(largest, entropy); assert.equal(frame.accepted[i], sum - largest <= diffEntropy + 1e-12); }
    }
  }
});
test('FP32 归约按真实逐加舍入改变临界 argmax，共同顺序不受布局影响', () => {
  const f = reductionInvarianceTrace().at(-1); assert.deepEqual(f.layouts.map((r) => r.sum), [0, 1]); assert.deepEqual(f.selected, ['B', 'A']);
  const stable = reductionInvarianceTrace({ invariantFixed: true }).at(-1); assert.deepEqual(stable.selected, ['B', 'B']);
  const small = reductionInvarianceTrace({ invariantPower: 4 }).at(-1); assert.deepEqual(small.layouts.map((r) => r.sum), [1, 1]);
});
test('插件白名单与 endpoint 默认准入有区别，失败加载不进入各进程 registry', () => {
  for (const pluginEndpoint of [false, true]) for (const pluginAllow of [0, 1, 2, 3]) {
    const f = pluginRegistryTrace({ pluginEndpoint, pluginAllow, pluginFail: true }).at(-1);
    assert.equal(f.plugins[0].loaded, pluginAllow === 2 || pluginAllow === 3 || !pluginEndpoint && pluginAllow === 0); assert.equal(f.plugins[1].loaded, false);
    for (const p of f.processes) { assert.equal(p.callbacks, f.plugins.filter((x) => x.loaded).length); assert.ok(!p.registered.some((x) => x.startsWith('beta:'))); assert.equal(p.secondLoadCallbacks, pluginEndpoint ? null : 0); }
  }
});
test('Connector 每层确认后才消费，发送确认后才释放，失败或未注册不伪造完成', () => {
  for (const connectorFail of [false, true]) {
    const trace = connectorContractTrace({ connectorFail }), f = trace.at(-1);
    for (const frame of trace) for (const l of frame.layers) if (l.consumed) assert.ok(l.loaded);
    for (const frame of trace) if (frame.producerReleased) assert.ok(frame.finishedSending.includes('A') && frame.finishedReceiving.includes('B'));
    assert.equal(f.producerReleased, !connectorFail); assert.equal(f.blocked, connectorFail);
  }
  const bad = connectorContractTrace({ connectorRegistered: false }).at(-1); assert.equal(bad.handle, null); assert.deepEqual(bad.finishedReceiving, []);
});
test('Rust 请求身份贯穿字段与输出，类型/结束枚举准确，unsupported tensor 不提交', () => {
  const normal = rustProtocolTrace().at(-1); assert.ok(normal.submitted); assert.equal(normal.typeFrame, '00'); assert.deepEqual(normal.finish, { value: 1, name: 'Length' }); assert.ok(normal.outputs.every((x) => x.request_id === 'request-A'));
  const abort = rustProtocolTrace({ rustAbort: true }).at(-1); assert.equal(abort.typeFrame, '01'); assert.equal(abort.finish.value, 2);
  const bad = rustProtocolTrace({ rustEmbeds: true }).at(-1); assert.ok(bad.blocked); assert.equal(bad.submitted, false); assert.deepEqual(bad.outputs, []);
});
