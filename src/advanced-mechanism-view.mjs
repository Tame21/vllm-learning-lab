import { esc, metric, table } from './html.mjs';
const caption = (f, detail) => `<div class="scene-caption"><span>${esc(f.status)}</span><span>${esc(detail)}</span></div>`;
const number = (value) => value === null || value === undefined ? '待计算' : Number(value).toPrecision(4);
const vector = (values) => values.map(number).join(', ');
const note = (text) => `<p class="scene-footnote">${esc(text)}</p>`;
const encoded = (values) => values.map((x) => `<span class="fp8-value ${x.clipped ? 'clipped' : ''}" title="恢复值 ${number(x.restored)}；误差 ${number(x.error)}"><b>0x${x.code.toString(16).padStart(2, '0')}</b><small>${number(x.restored)}</small></span>`).join('');

function compileView(f) {
  return caption(f, '算子变换 → 编译缓存 → 三次前向') +
    `<div class="advanced-graph"><div class="advanced-node">输入 rows × 2</div>${f.graph.length ? f.graph.map((name) => `<span>→</span><div class="advanced-node ${f.fused ? 'fused' : ''}">${esc(name)}</div>`).join('') : '<span>→ 等待追踪</span>'}<span>→</span><div class="advanced-node">输出 FP8 + scale</div></div>
    <div class="advanced-materialize"><b>${f.graph.length ? f.fused ? '融合路径：中间结果留在教学 kernel 内' : '分离路径：写入归一化张量，再重新读取' : '先记录数学运算，再选择融合路径'}</b><span>两条路径都完成 RMSNorm 和 FP8 量化</span></div>
    <h3>教学编译缓存</h3><div class="advanced-cache">${f.cache.map((key) => `<span data-visual-key="compile-cache-${esc(key)}" class="${f.current?.key === key ? 'current' : ''}">${esc(key)}</span>`).join('') || '<span>尚无编译项</span>'}</div>
    ${table(['前向', '输入形状', '编译项', '教学提交'], f.calls.map((call) => [call.i + 1, `${call.rows}×2`, call.hit ? '命中' : '新增', call.launches]), '三次前向编译记录')}
    <div class="metrics-row">${metric(f.cache.length, '编译版本')}${metric(f.launches, '运行提交累计')}${metric(f.intermediateElements, '物化中间元素')}</div>
    <div class="advanced-output"><b>最近一次恢复后的输出</b><span>${f.output.length ? f.output.map((row) => `[${vector(row)}]`).join(' · ') : '等待前向'}</span></div>` +
    note('二维示例 RMSNorm 权重为 1、epsilon=1e-6。融合两条路径使用相同数学公式；真实 IR pass、分段、动态 shape、后端、缓存键和浮点顺序更复杂。本缓存只按确切形状 / 融合模式查找，物化数量与提交数量不能换算成实测加速比。');
}

function kvView(f, o) {
  const rows = f.rawK.map((k, i) => {
    const cached = f.cache.find((x) => x.i === i), read = f.read.find((x) => x.i === i);
    return [`T${i}`, `K [${vector(k)}]<br>V [${vector(f.rawV[i])}]`, cached ? `<div class="fp8-pair">${encoded(cached.k)}${encoded(cached.v)}</div>` : '未写入', read ? `K [${vector(read.k)}]<br>V [${vector(read.v)}]` : '等待读取'];
  });
  const bytes = o.kvQuantTokens * 4;
  return caption(f, '单头 K / V · 二维 · E4M3') +
    `<div class="advanced-scale"><span>K scale <b>${number(f.scaleK)}</b></span><span>V scale <b>${number(f.scaleV)}</b></span><span>规则 <b>encode(x / scale)</b></span></div>
    ${table(['Token', '原始浮点 K / V', 'FP8 字节 → 恢复值', '读取后的 K / V'], rows, 'KV FP8 编码与恢复')}
    <div class="metrics-row">${metric(f.cache.length, '已写入 token')}${metric(f.read.length, '已读取 token')}${metric(f.clipped, '饱和元素')}${metric(bytes + 8, 'FP8 完成后字节', `${bytes} 数据 + 8 scale；16 位数据对照 ${bytes * 2}`)}</div>
    <div class="advanced-results"><div><b>原始 K/V 的 Attention</b><span>[${vector(f.reference.output)}]</span></div><div><b>恢复 K/V 的 Attention</b><span>${f.result ? `[${vector(f.result.output)}]` : '等待缓存完整读取'}</span></div><div><b>输出绝对误差</b><span>${f.result ? `[${vector(f.result.output.map((v, i) => Math.abs(v - f.reference.output[i])))}]` : '待计算'}</span></div></div>` +
    note('FP8 使用 nearest-even 与有限饱和，scale 为每张量一个 FP32 值。参考运算使用 JS 数值，不模拟 FP16/BF16 舍入。这里先恢复 K/V 再执行浮点 Attention，Q 固定为 [0.6, -0.4]；FA3 的 Q 量化、逐头 scale、Encoder FP8 与 TurboQuant 属于不同路径。字节数忽略布局、对齐与其他元数据，小张量可能因 scale 开销而不节省容量。');
}

function onlineView(f) {
  const elements = f.raw.length * 2;
  return caption(f, '加载时权重量化 / 运行时激活量化') +
    `<div class="advanced-scale"><span>Weight scale <b>${number(f.scale)}</b></span><span>Activation scale <b>${number(f.activationScale)}</b></span><span>权重状态 <b>${f.ready ? '转换完成' : f.loaded ? '已加载 / 转换中' : '未加载'}</b></span></div>
    ${table(['权重行', '原始浮点', 'FP8 字节 → 恢复值', '最大绝对误差'], f.raw.map((row, i) => [i, `[${vector(row)}]`, f.weights[i] ? `<div class="fp8-pair">${encoded(f.weights[i])}</div>` : '待转换', f.weights[i] ? number(Math.max(...f.weights[i].map((x) => Math.abs(x.error)))) : '待计算']), '在线权重量化')}
    <div class="advanced-activation"><b>本次输入 x · [${vector(f.activation)}]</b><div class="fp8-pair">${f.quantActivation.length ? encoded(f.quantActivation) : '前向开始后动态选择 scale'}</div></div>
    <div class="metrics-row">${metric(f.weights.length, '教学已转换行')}${metric(elements * 2, '16 位权重字节')}${metric(elements + 4, 'FP8 权重 + scale 字节')}</div>
    ${table(['输出行', '浮点 W·x 参考', '恢复后的 W·x', '绝对误差'], f.reference.map((v, i) => [i, number(v), f.output.length ? number(f.output[i]) : '待计算', f.output.length ? number(Math.abs(f.output[i] - v)) : '待计算']), '在线量化线性输出对照')}` +
    note('只演示单层 per-tensor FP8 权重：scale=max|W|/448。两列矩阵按 [输出, 输入] 展示，逐行动画不代表生产转换粒度，也未模拟打包、TP 全局 amax 或加载内存峰值。一枚 token 的动态激活 scale 可对照 per-tensor / per-token 路径；真实 GPU 后端也可能使用 W8A16。参考结果是 JS 浮点点积，不评估模型质量或 GPU 性能。');
}

function dboView(f) {
  return caption(f, `当前 t=${f.time} · 教学逻辑时隙`) +
    `<div class="dbo-legend"><span class="batch-a">microbatch A</span><span class="batch-b">microbatch B</span><span>浅色待执行 · 实色执行中 / 已完成</span></div>
    <div class="dbo-timeline">${['compute', 'comm'].map((lane) => `<section><b>${lane === 'compute' ? '计算' : '通信'}</b><div class="dbo-lane">${f.jobs.filter((j) => j.lane === lane).map((j) => `<div data-visual-key="dbo-${j.id}" class="dbo-job batch-${j.batch.toLowerCase()} ${j.status}" style="left:${100 * j.start / f.total}%;width:${100 * (j.end - j.start) / f.total}%" title="${j.batch} ${j.name}: ${j.start}…${j.end}"><b>${j.batch}</b><small>${esc(j.name)}</small></div>`).join('')}<i class="dbo-cursor" style="left:${100 * f.time / f.total}%"></i></div></section>`).join('')}<div class="dbo-axis"><span>0</span><span>总时隙 ${f.total}</span></div></div>
    ${table(['批次', '阶段', '资源', '起止时隙', '状态'], f.jobs.map((j) => [j.batch, j.name, j.lane, `${j.start} → ${j.end}`, j.status === 'done' ? '完成' : j.status === 'running' ? '执行中' : '等待依赖 / 资源']), 'DBO 依赖执行表')}
    <div class="metrics-row">${metric(f.done.length, '完成 microbatch')}${metric(f.total, '本场景总时隙')}${metric(f.serialTotal, '串行对照时隙')}${metric(f.serialTotal - f.total, '教学减少时隙')}</div>` +
    note('简化 MoE DAG：准备 → Dispatch → MLP → Combine。每个资源一次只执行一个阶段，通信完成后才允许本批消费结果。真实 DBO 面向 DP+EP，使用线程 yield、接收 hook 与 CUDA 事件，并有更复杂的 MLA / shared expert 调度和全 rank 准入；这里不复现该完整调度，也不预测硬件加速比。');
}

function dpView(f, o) {
  return caption(f, o.dpPinned ? '显式 data_parallel_rank=0' : `下次同分扫描起点 DP ${f.scanStart}`) +
    `<div class="dp-replicas">${f.engines.map((engine) => `<section data-visual-key="dp-replica-${engine.rank}" class="${f.selected === engine.rank ? 'selected' : ''}"><h3>DP ${engine.rank}</h3><p>统计等待 ${engine.waiting} · 运行 ${engine.running}<br>KV ${Math.round(engine.usage * 100)}% · 本客户端在途 ${engine.inflight}</p><div>${engine.requests.map((id) => `<span>${id}</span>`).join('') || '<small>本客户端队列为空</small>'}</div></section>`).join('')}</div>
    <div class="advanced-formula">score = max(in-flight × client_count, waiting + running)<br>+ waiting × 6 × max(0, KV usage − 0.5)</div>
    ${table(['请求', '路由前各副本分数', '起点', '选中副本'], f.routes.map((r) => [r.id, r.scores.map((x, i) => `${i}:${number(x)}`).join(' · '), o.dpPinned ? '显式指定' : r.scanStart, `DP ${r.rank}`]), 'DP 路由决策记录')}
    <div class="metrics-row">${metric(f.routes.length, '已路由请求')}${metric(f.returned.length, '已返回原客户端')}${metric(f.engines.reduce((sum, e) => sum + e.inflight, 0), '客户端剩余在途')}</div>` +
    note('本窗口按固定版本 DPLBAsyncMPClient 的分数、waiting 增量与轮转扫描实现，client_count=1。其余副本 KV 使用率设为 30%，rank 0 可改变。显式指定副本跳过负载选择。返回时减少客户端在途，统计快照等待后续更新；未模拟跨 rank MoE 同步、late-interaction 特例、多客户端或真实性能。');
}

function disaggView(f, o) {
  const blocks = (side) => f.blocks.map((b) => `<div data-visual-key="disagg-${side}-${b.id}" class="disagg-block ${side === 'p' ? b.produced ? 'ready' : '' : b.valid ? 'ready' : f.failed ? 'failed' : f.pending?.ids.includes(b.id) ? 'loading' : ''}"><b>KV ${b.id}</b><span>${b.tokens} / 4 个位置</span><small>${side === 'p' ? b.produced ? '已生成' : '待 Prefill' : b.valid ? '有效可读' : f.failed ? '缺失 / 禁止读' : f.pending?.ids.includes(b.id) ? '在途 / 禁止读' : '等待传输'}</small></div>`).join('');
  return caption(f, `请求 A · ${o.disaggTokens} 个 Prompt token`) +
    `<div class="service-columns"><section><h3>P · Prefill 实例</h3><div class="disagg-blocks">${blocks('p')}</div></section><section><h3>D · Decode 实例</h3><div class="disagg-blocks">${blocks('d')}</div></section></div>
    <div class="device-transfer-state ${f.pending ? 'active' : ''}"><b>${f.pending ? `P → D · 块 ${f.pending.ids.join(', ')}` : f.failed ? '传输失败，需要连接器 / 应用处理' : f.ack ? '完整 KV 已确认' : '等待传输完成通知'}</b><div><i style="width:${f.pending ? 100 * f.pending.progress / f.pending.duration : 0}%"></i></div><span>${f.pending ? `${f.pending.progress}/${f.pending.duration} 个时隙` : `已确认 ${f.chunks} 组传输`}</span></div>
    ${table(['同一请求逻辑对照', '已计算位置', '本侧可读 KV', '输出 token', '跨实例传输'], [['单实例', f.single.computed, f.single.valid ? '有效' : '等待 Prefill', f.single.output.length, 0], ['P / D 分离', f.producedTokens, f.ack ? '有效' : '等待确认', f.output.length, f.chunks]], '单实例与分离依赖对照')}
    <div class="advanced-gate ${f.ack ? 'ready' : ''}" data-visual-key="disagg-gate"><b>${f.ack ? 'Decode 读依赖已解除' : 'Decode 等待完整有效 KV'}</b><span>${f.output.length ? 'D 已产生一枚教学输出' : 'D 尚未产生输出'}</span></div>
    <div class="metrics-row">${metric(f.producedTokens, 'P 已计算位置')}${metric(f.receivedTokens, 'D 已确认位置')}${metric(f.time, '教学传输时隙')}${metric(f.output.length, 'D 输出 token')}</div>` +
    note('四位置 / 块，末块有效长度单独计数。教学传输顺序为先 Prefill 再分组传输，真实 connector 可采用不同流水线。失败分支阻塞 Decode，不假设所有 connector 都自动重算；请求元数据、缓存布局和完成通知须一致。get_finished 的读写完成契约与网络复制完成分别观察，不预测分离吞吐或延迟收益。');
}

const views = { compile: compileView, 'kv-quant': kvView, 'online-quant': onlineView, dbo: dboView, dp: dpView, disagg: disaggView };
export const advancedMechanismView = (id, f, o) => views[id](f, o);
