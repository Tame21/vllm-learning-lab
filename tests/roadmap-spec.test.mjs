import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupMethodTrace, suffixMethodTrace, serialMethodTrace, parallelMethodTrace } from '../src/engines/roadmap-spec.mjs';
import { defaults, validateParameters } from '../src/simulations.mjs';
import { encodeRoute, decodeRoute } from '../src/study-state.mjs';
import { lessons } from '../src/content.mjs';

test('可编辑 N-gram 与直接后缀搜索一致；最早最长匹配、上下文余量和无匹配都准确', () => {
  for (let mask = 0; mask < 256; mask++) {
    const history = Array.from({ length: 8 }, (_, i) => mask & (1 << i) ? 'A' : 'B');
    for (const specN of [1, 3, 6]) {
      const f = lookupMethodTrace('ngram', { specHistory: history.join(' '), specN, specK: 5 }).at(-1), row = f.histories[0];
      let best = 0, start = -1;
      for (let n = Math.min(specN, history.length); n > 0 && !best; n--)
        for (let i = 0; i < history.length - n; i++) if (history.slice(-n).every((x, j) => x === history[i + j])) { best = n; start = i; break; }
      assert.equal(row.matchLength, best); assert.equal(row.matchStart, start);
      assert.deepEqual(row.candidates, best ? history.slice(start + best, start + best + 5) : []);
    }
  }
  assert.deepEqual(lookupMethodTrace('ngram', { specHistory: 'A B C D E F' }).at(-1).candidates, []);
  assert.deepEqual(lookupMethodTrace('ngram', { specHistory: Array(24).fill('A').join(' ') }).at(-1).candidates, []);
});
test('批量 N-gram 按行有效长度复制，屏蔽行全填充且不进入验证', () => {
  for (const specGpuDisableB of [false, true]) {
    const f = lookupMethodTrace('ngram-gpu', { specGpuDisableB, specK: 5 }).at(-1);
    for (const row of f.histories) {
      assert.deepEqual(row.tensor.slice(0, row.valid), row.candidates);
      assert.ok(row.tensor.slice(row.valid).every((x) => x === -1));
      assert.equal(row.tensor.length, 5);
      assert.ok(row.valid <= row.tokens.length - (row.copyStart < 0 ? row.tokens.length : row.copyStart));
    }
    assert.equal(f.histories[1].valid, specGpuDisableB ? 0 : 2);
    assert.ok(!f.accepted.includes(-1));
  }
});
test('教学后缀树频次归一化，门限收紧使路径停止，未知上下文不凭空起草', () => {
  const normal = suffixMethodTrace({ specMinProb: 0.1 }), strict = suffixMethodTrace({ specMinProb: 1 });
  assert.ok(strict.at(-1).candidates.length < normal.at(-1).candidates.length);
  for (const f of normal) if (f.edges.length) assert.ok(Math.abs(f.edges.reduce((s, e) => s + e.probability, 0) - 1) < 1e-12);
  assert.deepEqual(suffixMethodTrace({ specHistory: 'X Y Z' }).at(-1).candidates, []);
});
test('串行草稿输入来自前一候选，KV 只属于已输入位置；EAGLE3 辅助形状随层数变化', () => {
  for (const id of ['draft-model', 'eagle', 'eagle3', 'mtp']) {
    const f = serialMethodTrace(id, { specK: 5 }).at(-1);
    assert.equal(f.forwards, 5); assert.equal(f.kv.length, 5);
    for (let i = 1; i < 5; i++) { assert.equal(f.rows[i].input, f.rows[i - 1].output); assert.equal(f.rows[i].position, f.rows[i - 1].position + 1); }
    assert.equal(f.kv.at(-1).position, 8);
  }
  for (const specAuxLayers of [1, 2, 3]) assert.equal(serialMethodTrace('eagle3', { specAuxLayers }).at(-1).featureWidth, 2 * specAuxLayers);
  assert.notDeepEqual(serialMethodTrace('eagle', { specFeature: 0 }).at(-1).candidates, serialMethodTrace('eagle', { specFeature: 2 }).at(-1).candidates);
});
test('MTP 索引共享是条件分支，关闭时每步重新计算；MLP 仍未接入验证', () => {
  for (const specMtpShare of [true, false]) {
    const f = serialMethodTrace('mtp', { specMtpShare }).at(-1);
    assert.equal(f.rows[0].indexState, '重新计算');
    assert.ok(f.rows.slice(1).every((x) => x.indexState === (specMtpShare ? '复用首轮索引' : '重新计算')));
  }
  const mlp = serialMethodTrace('mlp-spec').at(-1);
  assert.equal(mlp.blocked, true); assert.deepEqual(mlp.accepted, []); assert.equal(mlp.bonus, null); assert.deepEqual(mlp.verification, []);
});
test('并行方法单骨干输出多个位置，DSpark 仍依次读取前一候选，改变偏置改变序列', () => {
  for (const id of ['parallel-draft', 'dflash', 'dspark']) {
    const trace = parallelMethodTrace(id, { specK: 5 }), f = trace.at(-1);
    assert.equal(f.forwards, 1); assert.equal(f.queries.length, id === 'dflash' ? 6 : 5);
    if (id === 'dspark') for (let i = 1; i < f.rows.length; i++) assert.equal(f.rows[i].input, f.rows[i - 1].output);
    assert.ok(trace.every((x) => x.forwards <= 1));
  }
  assert.notDeepEqual(parallelMethodTrace('dspark', { specMarkov: 0 }).at(-1).candidates, parallelMethodTrace('dspark', { specMarkov: 2 }).at(-1).candidates);
  assert.equal(parallelMethodTrace('dspark', { specAnchorPrediction: false, specK: 5 }).at(-1).queries.length, 6);
  const medusa = parallelMethodTrace('medusa').at(-1);
  assert.ok(medusa.rows.every((x) => x.input === '共享 h' && x.dependency === '无前一候选依赖'));
  const blocked = parallelMethodTrace('parallel-draft', { specParallelTrained: false }).at(-1);
  assert.equal(blocked.forwards, 0); assert.equal(blocked.blocked, true); assert.deepEqual(blocked.candidates, []);
});
test('共同贪心验证只提交首拒绝以前的连续前缀，纠正或 bonus 二选一', () => {
  for (let specRejectAt = 0; specRejectAt <= 5; specRejectAt++) {
    const f = serialMethodTrace('draft-model', { specK: 5, specRejectAt }).at(-1);
    if (specRejectAt) {
      assert.deepEqual(f.accepted, f.candidates.slice(0, specRejectAt - 1));
      assert.deepEqual(f.discarded, f.candidates.slice(specRejectAt - 1));
      assert.equal(f.verification.length, specRejectAt); assert.equal(f.recovered, f.target[specRejectAt - 1]); assert.equal(f.bonus, null);
    } else { assert.deepEqual(f.accepted, f.candidates); assert.equal(f.bonus, 'BONUS'); assert.equal(f.recovered, null); }
  }
});
test('文本参数拒绝非法 token 和超长历史，可随参数链接恢复', () => {
  for (const specHistory of ['', '   ', '<script>', 'A'.repeat(9), Array(25).fill('A').join(' '), 12]) assert.throws(() => validateParameters({ specHistory }));
  const options = validateParameters({ specHistory: 'A_1 B2 A_1', specHistoryB: 'X Y Z' });
  const lesson = lessons.find((x) => x.id === 'ngram-gpu');
  const route = decodeRoute(encodeRoute(lesson.id, options, 3), lessons.map((x) => x.id));
  assert.equal(route.options.specHistory, options.specHistory); assert.equal(route.options.specHistoryB, options.specHistoryB);
  assert.equal(defaults.specK, 3);
});
