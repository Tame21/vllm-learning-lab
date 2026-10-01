import test from 'node:test';
import assert from 'node:assert/strict';
import { speechStreamTrace, makeTeachingParser, toolParserTrace, thinkingBudgetTrace, encoderTransferTrace, sseServingTrace, faultCleanupTrace } from '../src/engines/roadmap-protocols.mjs';
test('音频分组只提交收到且已编码的块，每块一次，续接上下文等于先前输出', () => {
  for (const speechChunks of [2, 5]) for (const speechCommit of [1, 2]) {
    const trace = speechStreamTrace({ speechChunks, speechCommit }), f = trace.at(-1);
    assert.deepEqual(f.updates.flatMap((x) => x.audio), Array.from({ length: speechChunks }, (_, i) => i));
    assert.equal(f.context, f.deltas.join(''));
    for (let i = 0; i < f.updates.length; i++) assert.equal(f.updates[i].contextBefore, f.deltas.slice(0, i).join(''));
    for (const frame of trace) for (const c of frame.chunks) if (c.submitted) assert.ok(c.received && c.encoded);
  }
  const blocked = speechStreamTrace({ speechSupported: false }).at(-1);
  assert.ok(blocked.blocked); assert.deepEqual(blocked.updates, []); assert.deepEqual(blocked.deltas, []);
});
test('增量 parser 在任意字符块边界保留标签，合法 JSON 才交付工具且从不执行', () => {
  const text = '<scratch_pad>分析</scratch_pad>正文<tool_call>{"name":"weather","arguments":{"city":"北京"}}</tool_call>';
  for (let width = 1; width <= text.length; width++) {
    const parser = makeTeachingParser();
    for (let i = 0; i < text.length; i += width) parser.push(text.slice(i, i + width), i + width >= text.length);
    assert.equal(parser.state.reasoning, '分析'); assert.equal(parser.state.content, '正文'); assert.equal(parser.state.buffer, ''); assert.equal(parser.state.parserError, null);
    assert.deepEqual(parser.state.tool, { name: 'weather', arguments: { city: '北京' } });
  }
  const normal = toolParserTrace().at(-1), broken = toolParserTrace({ parserMalformed: true }).at(-1);
  assert.ok(normal.handedOff); assert.equal(normal.executed, false); assert.equal(broken.handedOff, false); assert.ok(broken.parserError);
  const raw = toolParserTrace({ parserEnabled: false }).at(-1); assert.equal(raw.content, raw.wireText); assert.equal(raw.tool, null);
});
test('思考预算独立于正文，每段重置；零预算与多 token 结束标记都没有额外思考', () => {
  for (const thinkBudget of [0, 3, 5]) for (const thinkEndParts of [1, 2]) {
    const trace = thinkingBudgetTrace({ thinkBudget, thinkEndParts, thinkInterleave: true }), f = trace.at(-1);
    assert.equal(f.reasoning.length, 2 * thinkBudget); assert.equal(f.content.length, 2);
    for (const frame of trace) if (frame.forcing) { assert.equal(frame.allowed.length, 1); assert.equal(frame.count, thinkBudget); }
    assert.equal(f.mode, 'content'); assert.equal(f.endProgress, thinkEndParts);
  }
  const noConfig = thinkingBudgetTrace({ thinkEndKnown: false, thinkBudget: 0 });
  assert.ok(noConfig.every((x) => !x.forcing)); assert.equal(noConfig.at(-1).reasoning.length, 10);
});
test('EC 特征确认前不消费，同内容复用减少编码；传输失败无法前向', () => {
  for (const ecRepeat of [true, false]) for (const ecCacheHit of [true, false]) {
    const trace = encoderTransferTrace({ ecItems: 3, ecRepeat, ecCacheHit }), f = trace.at(-1);
    assert.ok(f.lmReady); assert.equal(f.encoded, ecCacheHit ? 0 : ecRepeat ? 1 : 3);
    for (const frame of trace) for (const task of frame.tasks) if (task.consumed) assert.equal(task.features.length, 2);
    for (const frame of trace) if (frame.transfer) assert.equal(frame.tasks.find((t) => t.id === frame.transfer.task).features.length, 0);
  }
  const failed = encoderTransferTrace({ ecFail: true }).at(-1); assert.ok(failed.blocked); assert.equal(failed.lmReady, false); assert.ok(failed.tasks.every((t) => !t.consumed));
});
test('SSE FIFO 无重复内容，finish / usage / DONE 顺序正确，断连与无效请求不成功结束', () => {
  for (const serveTokens of [1, 5]) for (const serveDelay of [1, 3]) for (const serveUsage of [true, false]) {
    const f = sseServingTrace({ serveTokens, serveDelay, serveUsage }).at(-1);
    assert.deepEqual(f.delivered, Array.from({ length: serveTokens }, (_, i) => `片段${i + 1}`)); assert.ok(f.finished); assert.equal(f.queue.length, 0);
    assert.equal(f.wire.at(-1), 'data: [DONE]\n\n');
    const messages = f.wire.slice(0, -1).map((x) => JSON.parse(x.slice(6)));
    assert.equal(messages[0].choices[0].delta.role, 'assistant');
    assert.equal(messages.filter((x) => x.usage).length, serveUsage ? 1 : 0);
    assert.equal(messages.at(serveUsage ? -2 : -1).choices[0].finish_reason, 'stop');
  }
  const cancel = sseServingTrace({ serveCancel: 2 }).at(-1); assert.equal(cancel.produced, 2); assert.ok(cancel.aborted); assert.equal(cancel.finished, false); assert.ok(cancel.wire.every((x) => !x.includes('[DONE]')));
  const invalid = sseServingTrace({ serveInvalid: true }).at(-1); assert.equal(invalid.produced, 0); assert.deepEqual(invalid.wire, []);
});
test('故障释放逻辑块后仍等待物理确认，健康恢复不复活请求；单请求取消不杀 B', () => {
  for (const faultCancel of [true, false]) for (const faultRetry of [true, false]) {
    const trace = faultCleanupTrace({ faultCancel, faultRetry }), f = trace.at(-1);
    for (const frame of trace) if (!frame.ack) assert.deepEqual(frame.physical, [0, 1, 2]);
    assert.deepEqual(f.physical, []); assert.equal(new Set(f.schedulerFree).size, 3);
    assert.equal(f.requests[0].status, '已中止'); assert.deepEqual(f.requests[0].output, ['A1']);
    assert.equal(f.requests[1].status, faultCancel ? '已完成' : '已中止');
    assert.equal(f.health, faultCancel || faultRetry ? 'healthy' : 'unhealthy');
  }
});
