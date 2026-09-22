import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCommand, tokenizeCommand, commandOptions } from '../src/command-parser.mjs';
import { analyzeCommand, allFlowNodes, commandExamples } from '../src/command-flow.mjs';
import { commandSources } from '../src/command-sources.mjs';
import { commandView } from '../src/command-view.mjs';
import { sourceKey } from '../src/source-map.mjs';

const data = JSON.parse(fs.readFileSync(new URL('../dist/source-index.json', import.meta.url)));
const nodes = (analysis) =>
  Object.fromEntries(allFlowNodes(analysis).map((node) => [node.id, node]));
const valid = (command, scenario) => {
  const result = analyzeCommand(command, scenario);
  assert.deepEqual(result.errors, [], command);
  return result;
};

test('命令解析保留引号内路径与 JSON，接受 Bash / PowerShell / CMD 续行', () => {
  for (const continuation of ['\\', '`', '^']) {
    const result = parseCommand(
      `vllm serve "D:\\models\\my model" ${continuation}\r\n --speculative-config '{"method":"ngram","num_speculative_tokens":4}'`,
    );
    assert.deepEqual(result.errors, []);
    assert.equal(result.options.model, 'D:\\models\\my model');
    assert.equal(result.options['speculative-config'].num_speculative_tokens, 4);
  }
  assert.deepEqual(tokenizeCommand('vllm serve "a\\\"b" # note'), ['vllm', 'serve', 'a"b']);
});

test('别名、等号、下划线参数与 JSON 点字段保持正确语义', () => {
  const result = valid(
    'VLLM_USE_V2_MODEL_RUNNER=0 vllm serve demo -tp=2 --pipeline_parallel_size 3 --speculative-config.method ngram -sc.num_speculative_tokens 4 --no-async-scheduling',
  );
  assert.equal(result.options['tensor-parallel-size'], 2);
  assert.equal(result.options['pipeline-parallel-size'], 3);
  assert.equal(result.options['speculative-config'].num_speculative_tokens, 4);
  assert.equal(result.scenario.runner, 'v1');
  assert.ok(nodes(result)['model-v1']);
  assert.ok(!nodes(result)['model-v2']);
  assert.ok(nodes(result)['tensor-parallel']);
  assert.ok(nodes(result)['pipeline-parallel']);
});

test('支持当前源码的长度写法；错误数值与缺失参数不产生流程', () => {
  assert.equal(valid('vllm serve --max-model-len auto').options['max-model-len'], -1);
  assert.equal(
    valid('vllm serve --max-model-len 8K --max-num-batched-tokens 2k').options['max-model-len'],
    8192,
  );
  for (const suffix of [
    '-tp 0',
    '-tp 1.5',
    '-tp -2',
    '-tp',
    '--port 99999',
    '--gpu-memory-utilization 2',
    '--max-model-len 1.5K',
    '--max-num-batched-tokens nan',
    '--enable-lora=false',
  ]) {
    const result = analyzeCommand('vllm serve demo ' + suffix);
    assert.ok(result.errors.length, suffix);
    assert.equal(result.request.length, 0);
  }
});

test('冲突模型参数报错，重复开关后者生效，未知参数单独保留', () => {
  const result = valid(
    'vllm serve first -tp 2 -tp 4 --enable-prefix-caching --no-enable-prefix-caching --future-feature value',
  );
  assert.equal(result.options.model, 'first');
  assert.equal(result.options['tensor-parallel-size'], 4);
  assert.equal(result.options['enable-prefix-caching'], false);
  assert.equal(result.unknown[0].name, '--future-feature');
  assert.equal(result.unknown[0].value, 'value');
  assert.ok(analyzeCommand('vllm serve first --model second').errors.length);
  assert.ok(result.warnings.some((warning) => warning.includes('未建模')));
  assert.equal(parseCommand('vllm serve --constructor value').unknown.length, 1);
});

test('错误 JSON、引号、shell 组合和危险 JSON 键有明确错误', () => {
  for (const command of [
    'vllm serve "demo',
    'vllm serve demo | tee output',
    'vllm serve demo; other',
    `vllm serve demo --speculative-config '{broken}'`,
    'vllm serve demo --speculative-config []',
    'vllm serve demo --compilation-config.__proto__.x 1',
    'vllm serve demo --compilation-config.constructor.x 1',
    'docker run image vllm serve demo',
    '',
  ]) {
    assert.ok(parseCommand(command).errors.length, command);
  }
  assert.equal({}.x, undefined);
  assert.ok(
    parseCommand('vllm serve "$MODEL"').warnings.some((warning) => warning.includes('未展开')),
  );
});

test('关闭参数删除对应分支，自动值保留实际源码选择点', () => {
  const result = valid(
    'vllm serve demo --no-enable-prefix-caching --no-enable-chunked-prefill --no-async-scheduling --enforce-eager',
  );
  const graph = nodes(result);
  assert.equal(graph['prefix-cache'], undefined);
  assert.equal(graph.chunked, undefined);
  assert.equal(graph['cuda-graph'], undefined);
  assert.equal(graph.execute.source, 'step');
  assert.equal(graph['scheduler-choice'].source, 'schedulerChoice');
  const auto = nodes(valid('vllm serve demo'));
  assert.equal(auto['prefix-cache'].status, 'conditional');
  assert.equal(auto['model-v1'].status, 'conditional');
  assert.equal(auto['model-v2'].status, 'conditional');
  assert.equal(auto.grammar.status, 'conditional');
});

test('投机解码与异步兼容性、别名冲突有验证，未启用不伪造草稿', () => {
  assert.ok(nodes(valid('vllm serve demo --spec-method ngram --spec-tokens 4')).speculation);
  assert.equal(valid('vllm serve demo --spec-method ngram').scenario.asyncMode, false);
  assert.equal(nodes(valid('vllm serve demo')).speculation, undefined);
  for (const command of [
    'vllm serve demo --async-scheduling --spec-method ngram',
    `vllm serve demo --speculative-config '{"num_speculative_tokens":4}' --spec-tokens 2`,
    `vllm serve demo --speculative-config '{"num_speculative_tokens":0}'`,
  ])
    assert.ok(analyzeCommand(command).errors.length, command);
});

test('单个请求仍有 LoRA、结构化输出、多模态和流式条件', () => {
  const graph = nodes(
    valid(
      `vllm serve demo --enable-lora --structured-outputs-config '{"backend":"xgrammar"}' --limit-mm-per-prompt '{"image":2}'`,
    ),
  );
  for (const id of ['lora-active', 'grammar', 'multimodal', 'stream-response'])
    assert.equal(graph[id].status, 'conditional', id);
  assert.equal(graph.response.source, 'full');
  assert.equal(nodes(valid('vllm serve demo', { kind: 'completion' })).api.source, 'completion');
});

test('Pooling 不包含采样、结构化输出或 Decode 循环；请求类型冲突阻止绘图', () => {
  const result = valid('vllm serve intfloat/e5-small-v2 --runner pooling');
  assert.equal(result.scenario.kind, 'embedding');
  assert.ok(nodes(result).pool);
  assert.equal(nodes(result).sampling, undefined);
  assert.equal(nodes(result).grammar, undefined);
  assert.equal(nodes(result).response.source, 'embeddingOutput');
  assert.ok(analyzeCommand('vllm serve demo --runner pooling', { kind: 'chat' }).errors.length);
  assert.ok(
    analyzeCommand('vllm serve demo --runner generate', { kind: 'embedding' }).errors.length,
  );
});

test('Headless 没有 HTTP，DP 的内部和外部负载均衡路径不同', () => {
  const headless = nodes(valid('vllm serve demo --headless -dp 2'));
  for (const id of ['api', 'prepare', 'response', 'http-ready', 'output'])
    assert.equal(headless[id], undefined, id);
  assert.ok(headless.enqueue);
  assert.equal(nodes(valid('vllm serve demo -dp 2'))['data-parallel'].source, 'dp');
  assert.equal(
    nodes(valid('vllm serve demo -dp 2 --data-parallel-external-lb'))['data-parallel'].source,
    'cli',
  );
  assert.ok(analyzeCommand('vllm serve demo --headless --api-server-count 1').errors.length);
  assert.ok(analyzeCommand('vllm serve demo -dp 2 --data-parallel-size-local 4').errors.length);
});

test('外部配置、其他前端、自定义实现明确限定推导边界', () => {
  assert.ok(
    valid('vllm serve demo --config settings.yaml').warnings.some((warning) =>
      warning.includes('文件未读取'),
    ),
  );
  assert.equal(valid('vllm serve demo --grpc').request.length, 0);
  assert.equal(valid('vllm serve demo --scheduler-cls my.Custom').request.at(-1).id, 'custom');
  const legacy = valid('python -m vllm.entrypoints.openai.api_server --model demo -tp 2');
  assert.equal(legacy.entry, 'python');
  assert.equal(legacy.startup[0].source, 'python');
});

test('JSON 点字段组按本地 CLI 顺序覆盖整段 JSON，并支持列表追加', () => {
  const result = valid(
    `vllm serve demo --compilation-config.mode 0 --compilation-config.cudagraph_capture_sizes+ 1,2 --compilation-config.cudagraph_capture_sizes+ 4 --compilation-config '{"mode":3,"cudagraph_mode":"NONE"}'`,
  );
  assert.equal(result.options['compilation-config'].mode, 0);
  assert.equal(result.options['compilation-config'].cudagraph_mode, undefined);
  assert.deepEqual(result.options['compilation-config'].cudagraph_capture_sizes, ['1', '2', '4']);
  assert.ok(result.warnings.some((warning) => warning.includes('覆盖整个 JSON')));
  assert.ok(analyzeCommand('vllm serve demo --enable-eplb').errors.length);
  assert.ok(
    analyzeCommand('vllm serve demo --max-num-seqs 10 --max-num-batched-tokens 5').errors.length,
  );
  assert.ok(
    analyzeCommand(
      'vllm serve demo --no-enable-chunked-prefill --max-model-len 2K --max-num-batched-tokens 1024',
    ).errors.length,
  );
});

test('全部示例可解析，图节点和参数均有实际可定位的本地符号', () => {
  for (const example of commandExamples) {
    for (const item of allFlowNodes(valid(example.command)))
      assert.ok(commandSources[item.source], item.id);
  }
  for (const def of Object.values(commandOptions)) assert.ok(commandSources[def.source]);
  for (const [id, source] of Object.entries(commandSources)) {
    const ref = data.refs[sourceKey(source)];
    assert.ok(ref, id);
    assert.equal(ref.kind, 'implementation');
    assert.ok(ref.line >= ref.rangeStart && ref.line <= ref.rangeEnd, id);
    assert.equal(ref.symbol, source.symbol);
  }
});

test('页面转义用户输入，隐藏参数表中的凭据，不把错误配置渲染为成功流程', () => {
  const command = `vllm serve '<img src=x onerror=alert(1)>' --api-key fake-test-secret`;
  const analysis = valid(command);
  const state = {
    draft: command,
    analyzedCommand: command,
    analysis,
    phase: 'request',
    cursor: 0,
    kind: 'auto',
    analyzedKind: 'auto',
  };
  const html = commandView(state, data);
  assert.ok(!html.includes('<img src=x'));
  const result = html.slice(html.indexOf('id="command-result"'));
  assert.ok(!result.includes('fake-test-secret'));
  assert.match(result, /已隐藏/);
  const error = commandView({ ...state, analysis: analyzeCommand('vllm serve demo -tp 0') }, data);
  assert.match(error, /请先修正命令/);
  assert.ok(!error.includes('command-flow-list'));
});
