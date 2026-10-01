import { mechanismDefaults } from '../mechanism-parameters.mjs';
import { snapshot } from './roadmap-core.mjs';
const setup = (input) => {
  const o = { ...mechanismDefaults, ...input }, frames = [], state = { status: '准备输入', time: 0, blocked: false };
  return { o, frames, state, snap: (step, event) => snapshot(frames, state, step, event) };
};
export function speechStreamTrace(input = {}) {
  const { o, frames, state, snap } = setup(input);
  Object.assign(state, { chunks: Array.from({ length: o.speechChunks }, (_, i) => ({ id: `audio-${i}`, received: false, encoded: false, submitted: false })), buffered: [], updates: [], deltas: [], context: '' });
  snap(0, '同一 session 接收多块音频；尚未形成 StreamingInput。');
  if (!o.speechSupported) { state.blocked = true; state.status = '模型不支持此流式续接'; for (const step of [0, 1, 2, 3]) snap(step, '停止构建续接请求；应选择支持此接口的模型或一次性转写入口。'); return frames; }
  const fragments = ['你好', '，', '这是', '教学演示', '。'];
  for (let i = 0; i < state.chunks.length; i++) {
    state.chunks[i].received = true; state.buffered.push(i); state.time++; state.status = `收到音频块 ${i}`;
    snap(0, '模型的缓冲入口接收一块教学音频。');
    if (state.buffered.length < o.speechCommit && i < state.chunks.length - 1) continue;
    const group = [...state.buffered]; for (const j of group) state.chunks[j].encoded = true;
    state.status = '当前音频组编码完成'; snap(1, '音频组转换为教学媒体特征；尚未向引擎提交。');
    state.updates.push({ id: `update-${state.updates.length}`, audio: group, contextBefore: state.context });
    for (const j of group) state.chunks[j].submitted = true; state.buffered = []; state.status = '续接请求已更新';
    snap(2, 'StreamingUpdate 只用于 resumable 请求，保留对应媒体与 prompt 字段。');
    const text = group.map((j) => fragments[j]).join(''); state.deltas.push(text); state.context += text; state.status = '客户端收到教学转写片段';
    snap(3, '输出片段成为下一组的上下文；真实音频缓冲与协议事件由模型和入口决定。');
  }
  state.status = '输入结束，教学会话完成'; snap(3, '没有后续音频块；不再创建续接更新。'); return frames;
}

// Incremental recognizer for the deliberately small teaching tag protocol.
// Keep incomplete tag prefixes in buffer instead of leaking them as content.
export function makeTeachingParser() {
  const state = { mode: 'content', buffer: '', reasoning: '', content: '', toolText: '', tool: null, parserError: null };
  const tags = [['<scratch_pad>', 'reasoning'], ['</scratch_pad>', 'content'], ['<tool_call>', 'tool'], ['</tool_call>', 'content']];
  const append = (text) => { if (state.mode === 'reasoning') state.reasoning += text; else if (state.mode === 'tool') state.toolText += text; else state.content += text; };
  return { state, push(chunk, final = false) {
    state.buffer += chunk;
    while (state.buffer) {
      const complete = tags.find(([tag]) => state.buffer.startsWith(tag));
      if (complete) {
        const [tag, mode] = complete; state.buffer = state.buffer.slice(tag.length);
        if (tag === '</tool_call>') try { const tool = JSON.parse(state.toolText); if (typeof tool.name !== 'string' || !tool.arguments || typeof tool.arguments !== 'object' || Array.isArray(tool.arguments)) throw Error('工具字段不完整'); state.tool = tool; } catch { state.parserError = '工具 JSON 无效，不能交付为可调用对象'; }
        state.mode = mode; continue;
      }
      if (!final && tags.some(([tag]) => tag.startsWith(state.buffer))) break;
      append(state.buffer[0]); state.buffer = state.buffer.slice(1);
    }
    if (final && state.mode === 'tool') state.parserError = '工具块未闭合';
    return structuredClone(state);
  } };
}
export function toolParserTrace(input = {}) {
  const { o, frames, state, snap } = setup(input), parser = makeTeachingParser();
  const json = JSON.stringify({ name: 'weather', arguments: { city: '北京' } });
  state.wireText = `<scratch_pad>先查询天气</scratch_pad>准备查询。<tool_call>${o.parserMalformed ? json.slice(0, -1) : json}</tool_call>`;
  Object.assign(state, { chunks: [], ...parser.state, handedOff: false, executed: false });
  snap(0, '教学工具 schema 已提供给模板；应用尚未收到工具调用。');
  const chunks = Array.from({ length: Math.ceil(state.wireText.length / o.parserChunk) }, (_, i) => state.wireText.slice(i * o.parserChunk, (i + 1) * o.parserChunk));
  for (let i = 0; i < chunks.length; i++) {
    state.chunks.push(chunks[i]); state.time++; state.status = `收到文本块 ${i + 1}`; snap(1, '模型文本可以把标记与 JSON 字段切在不同块中。');
    if (o.parserEnabled) Object.assign(state, parser.push(chunks[i], i === chunks.length - 1));
    else state.content += chunks[i];
    state.status = state.parserError ? '解析错误' : `${state.mode} · 缓冲 ${state.buffer.length} 字符`; snap(2, '只在标记完整时切换字段；不完整标签前缀保留在缓冲区。');
  }
  state.handedOff = !!state.tool && !state.parserError; state.status = state.handedOff ? '完整工具对象已交给应用' : state.parserError ? '解析失败，禁止工具交付' : '原始文本直接作为正文';
  snap(3, 'vLLM 交付调用结构；真正执行工具与回填结果由应用负责。'); return frames;
}

export function thinkingBudgetTrace(input = {}) {
  const { o, frames, state, snap } = setup(input);
  Object.assign(state, { mode: 'content', segment: 0, count: 0, stream: [], reasoning: [], content: [], allowed: ['thought', 'end', 'text'], forcing: false, endProgress: 0 });
  snap(0, '非投机请求的教学协议使用一个开始 token 和一至两个结束 token。');
  for (let segment = 0; segment < (o.thinkInterleave ? 2 : 1); segment++) {
    state.segment = segment + 1; state.mode = 'thinking'; state.count = 0; state.endProgress = 0; state.stream.push('<think>'); state.forcing = false;
    snap(1, '进入新思考段，按此段预算重新计数。');
    const thoughtCount = o.thinkEndKnown ? o.thinkBudget : 5;
    for (let i = 0; i < thoughtCount; i++) {
      state.allowed = ['thought', 'end', 'text']; state.forcing = false;
      state.count++; const token = `h${segment + 1}.${i + 1}`; state.stream.push(token); state.reasoning.push(token); state.status = `思考段 ${segment + 1} 已计数 ${state.count}`;
      snap(1, '追加一枚教学思考 token，开始标记不计入思考内容。');
    }
    for (let part = 0; part < o.thinkEndParts; part++) {
      const marker = o.thinkEndParts === 1 ? '</think>' : ['</', 'think>'][part];
      state.mode = 'ending'; state.forcing = o.thinkEndKnown; state.allowed = o.thinkEndKnown ? [marker] : ['thought', 'end', 'text']; state.status = o.thinkEndKnown ? '预算耗尽，强制下一结束 token' : '无结束配置，预算强制已禁用';
      snap(2, o.thinkEndKnown ? '仅保留结束序列当前项；不能在多 token 标记中插入额外思考。' : '缺少结束 token 时不强制 logits；此处教学流自然结束。');
      state.stream.push(marker); state.endProgress++; snap(2, '收到结束序列的一项，完成整段后才返回正文状态。');
    }
    state.mode = 'content'; state.forcing = false; state.allowed = ['thought', 'end', 'text']; const token = `正文${segment + 1}`; state.stream.push(token); state.content.push(token); state.status = '正文输出';
    snap(3, '解析后正文与思考字段分开交付；思考预算不是整个输出长度。');
  }
  return frames;
}

export function encoderTransferTrace(input = {}) {
  const { o, frames, state, snap } = setup(input);
  const keys = Array.from({ length: o.ecItems }, (_, i) => `media-${o.ecRepeat ? 0 : i}`);
  const cache = new Map(o.ecCacheHit ? [...new Set(keys)].map((key) => [key, [[0.2, 1], [0.4, 1]]]) : []);
  Object.assign(state, { tasks: keys.map((key, i) => ({ id: `EC-${i}`, key, producer: false, state: '等待', features: [], consumed: false, hit: false })), encoded: 0, transfer: null, cacheKeys: [...cache.keys()], lmReady: false });
  snap(0, '按媒体内容与 encoder 配置标识创建 EC 任务；此数据不是 Attention K/V。');
  for (const task of state.tasks) {
    task.hit = cache.has(task.key); task.state = task.hit ? '共享缓存命中' : '等待编码';
    snap(0, `${task.id} 查询共享 EC 键 ${task.key}。`);
    const payload = task.hit ? cache.get(task.key) : [[0.2, 1], [0.4, 1]];
    if (!task.hit) { task.producer = true; state.encoded++; task.state = '编码完成'; snap(1, '独立 encoder 产生两行教学特征，消费侧仍没有数据。'); }
    task.state = '加载中'; state.transfer = { task: task.id, progress: 0, duration: o.ecDelay };
    snap(2, '保存 / 加载 EC 特征；需要等待消费侧加载确认。');
    for (let t = 1; t <= o.ecDelay; t++) { state.time++; state.transfer.progress = t; snap(2, '传输尚未确认，不能替换媒体占位符。'); }
    if (o.ecFail) { task.state = '传输失败'; state.blocked = true; state.status = 'EC 缺失，禁止语言模型消费'; state.transfer = null; snap(3, '没有有效特征，不能将失败任务标为就绪。'); return frames; }
    task.features = structuredClone(payload); task.state = '消费侧就绪'; cache.set(task.key, payload); state.cacheKeys = [...cache.keys()]; state.transfer = null;
    snap(2, '消费侧已加载确认，同内容后续任务可以复用共享特征。');
    task.consumed = true; snap(3, '该任务特征逐行替换对应占位符。');
  }
  state.lmReady = state.tasks.every((x) => x.consumed); state.status = '全部媒体特征就绪，允许语言模型前向'; snap(3, 'EC 交接先完成，再开始语言模型计算。'); return frames;
}

export function sseServingTrace(input = {}) {
  const { o, frames, state, snap } = setup(input);
  Object.assign(state, { produced: 0, queue: [], delivered: [], wire: [], connected: true, aborted: false, finished: false, peakQueue: 0 });
  snap(0, '校验模型名与参数；教学请求尚未进入引擎。');
  if (o.serveInvalid) { state.blocked = true; state.status = '请求校验失败'; for (const step of [0, 1, 2, 3]) snap(step, '返回校验错误，不产生 engine 请求或 SSE 成功结果。'); return frames; }
  state.status = '引擎请求 A 已创建'; snap(1, '模板输入准备完成，前端持有异步输出生成器。');
  const send = (value) => state.wire.push(`data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`);
  const chunk = (delta, finish_reason = null) => ({ id: 'chatcmpl-demo', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] });
  send(chunk({ role: 'assistant', content: '' })); snap(3, 'SSE 首块包含 assistant 角色，使用双换行分隔事件。');
  for (let time = 1; state.produced < o.serveTokens || state.queue.length; time++) {
    state.time = time;
    if (state.produced < o.serveTokens) {
      const token = `片段${++state.produced}`; state.queue.push(token); state.peakQueue = Math.max(state.peakQueue, state.queue.length); state.status = '引擎输出进入队列'; snap(2, '生产与客户端消费分开；尚未送达的片段保留在队列。');
      if (o.serveCancel === state.produced) { state.connected = false; state.aborted = true; state.queue = []; state.status = '客户端断连，请求已中止'; snap(3, '取消引擎请求并丢弃未交付输出；断开的连接收不到 [DONE]。'); return frames; }
    }
    if (time % o.serveDelay === 0 && state.queue.length) {
      const token = state.queue.shift(); state.delivered.push(token); send(chunk({ content: token })); state.status = '客户端消费一段 SSE'; snap(3, '按 FIFO 编码一个 delta；输出队列长度相应减少。');
    }
  }
  send(chunk({}, 'stop')); snap(3, '发送 finish_reason=stop 的结束选择块。');
  if (o.serveUsage) { send({ id: 'chatcmpl-demo', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 4, completion_tokens: state.produced, total_tokens: 4 + state.produced } }); snap(3, '启用 include_usage 后追加 choices 为空的 usage 块。'); }
  send('[DONE]'); state.finished = true; state.status = 'SSE 正常结束'; snap(3, '最后发送 [DONE]；之后不再产生内容。'); return frames;
}

export function faultCleanupTrace(input = {}) {
  const { o, frames, state, snap } = setup(input);
  Object.assign(state, { requests: [{ id: 'A', status: '运行', blocks: [0, 1], output: ['A1'] }, { id: 'B', status: '运行', blocks: [2], output: ['B1'] }], physical: [0, 1, 2], schedulerFree: [], health: 'healthy', ack: false, progress: 0, retry: false });
  snap(0, '两个请求存在已交付输出与在途 GPU 工作。');
  state.health = o.faultCancel ? 'healthy' : 'unhealthy'; state.status = o.faultCancel ? '请求 A 被取消' : 'Worker 故障被检测';
  snap(0, '停止受影响请求的新工作；已经交付的输出仍保留。');
  const affected = state.requests.filter((x) => !o.faultCancel || x.id === 'A');
  for (const req of affected) { req.status = '已中止'; state.schedulerFree.push(...req.blocks); req.blocks = []; }
  snap(1, o.faultCancel ? '仅 A 进入终止路径，B 可以继续运行。' : '受影响引擎所有请求中止，错误与健康状态传播到客户端。');
  for (let t = 1; t <= o.faultAck; t++) { state.progress = t; state.time++; snap(2, '逻辑调度块已释放，但仍在途的物理工作尚未确认安全，禁止复用其内容。'); }
  state.ack = true; state.physical = state.physical.filter((b) => !state.schedulerFree.includes(b)); snap(2, '完成教学确认屏障后，清理持久行、请求状态与相关物理工作。');
  if (o.faultCancel) {
    const b = state.requests[1]; b.status = '已完成'; b.output.push('B2'); state.schedulerFree.push(...b.blocks); b.blocks = []; state.physical = []; state.status = 'A 已取消，B 正常完成'; snap(3, '局部取消不将另一个请求当作失败。');
  } else {
    state.retry = o.faultRetry; state.health = o.faultRetry ? 'healthy' : 'unhealthy'; state.status = o.faultRetry ? '恢复健康，可接收新请求' : '恢复失败，保留错误状态'; snap(3, '恢复依赖具体策略；先前中止请求不自动复活，客户端需要决定是否重试。');
  }
  return frames;
}
export const roadmapProtocolTraces = { speech: speechStreamTrace, tools: toolParserTrace, thinking: thinkingBudgetTrace, 'encoder-disagg': encoderTransferTrace, serving: sseServingTrace, fault: faultCleanupTrace };
