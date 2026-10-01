import { esc, metric, table } from './html.mjs';

const caption = (title, detail) => `<div class="scene-caption"><span>${esc(title)}</span><span>${esc(detail)}</span></div>`;
const note = (text) => `<p class="scene-footnote">${esc(text)}</p>`;
const fmt = (v) => v === null ? '—' : Number(v.toFixed(3));
const chips = (values, key, kind = '') => `<div class="mechanism-chips">${values.map((v, i) => `<span class="mechanism-chip ${kind}" data-visual-key="${key}-${i}">${esc(v)}</span>`).join('') || '<span class="mechanism-empty">∅</span>'}</div>`;

function loadingView(f) {
  const t = f.tensors[f.activeTensor];
  const size = t.rows * t.cols;
  const rankFor = (row, col) => t.layout === 'column' ? Math.floor(col / 2) : t.layout === 'row' ? Math.floor(row / 2) : null;
  const loaded = f.tensors.reduce((count, tensor) => count + tensor.loaded.length, 0);
  return caption(f.status, `${f.shards} 个 checkpoint 文件 · ${f.ranks} 个 TP rank`) +
    `<div class="service-tensor-list">${f.tensors.map((tensor, i) => `<span data-visual-key="load-tensor-${i}" class="${tensor.ready ? 'ready' : ''} ${i === f.activeTensor ? 'current' : ''}"><b>${esc(tensor.name)}</b><small>文件 ${tensor.shard} · ${tensor.ready ? '就绪' : `${tensor.loaded.length}/${f.ranks}`}</small></span>`).join('')}</div>
    <div class="service-columns"><section><h3>checkpoint · ${esc(t.name)}</h3><div class="service-weight-matrix" style="--cols:${t.cols}">${Array.from({ length: size }, (_, i) => {
      const row = Math.floor(i / t.cols), col = i % t.cols, rank = rankFor(row, col);
      return `<span data-visual-key="weight-${f.activeTensor}-${i}" class="${t.read ? 'read' : ''} ${rank === f.activeRank || t.layout === 'replicated' && f.activeRank !== null ? 'copying' : ''}" style="--rank-color:var(--rank-${rank ?? 0})" title="行 ${row}，列 ${col}；${rank === null ? '每个 rank 完整复制' : `归属 rank ${rank}`}">${row},${col}</span>`;
    }).join('')}</div><p class="small-note">${t.layout === 'column' ? 'ColumnParallel：沿输出维（列）切分' : t.layout === 'row' ? 'RowParallel：沿输入维（行）切分' : 'Norm：每个 rank 保留完整向量'}；示例矩阵按 [输入, 输出] 展示。</p></section>
    <section><h3>设备上的权重切片</h3><div class="service-rank-list">${Array.from({ length: f.ranks }, (_, rank) => {
      const part = t.loaded.find((p) => p.rank === rank);
      return `<div class="service-rank ${part ? 'ready' : ''}" data-visual-key="load-rank-${rank}" style="--rank-color:var(--rank-${rank})"><b>rank ${rank}</b><span>${part ? `行 [${part.rows[0]}, ${part.rows[1]}) · 列 [${part.cols[0]}, ${part.cols[1]})` : '等待装载'}</span><strong>${part ? part.elements : 0} 个元素</strong></div>`;
    }).join('')}</div></section></div>
    <div class="metrics-row">${metric(loaded, '已装载切片')}${metric(f.tensors.filter((tensor) => tensor.ready).length, '已就绪张量')}${metric(f.tensors.length * f.ranks - loaded, '待装载切片')}</div>` +
    note('教学 checkpoint 每个张量属于一个文件；真实文件可以跨多个张量。这里只演示两种 TP 切分与复制，不包含 QKV 合并、PP、量化格式、磁盘 IO 或真实后处理。');
}

function logitsView(f, o) {
  return caption(`请求 A · 第 ${f.round} 轮`, '分数、允许集合与水印竞争分别观察') +
    `<div class="service-columns"><section><h3>生成历史</h3>${chips(f.output.map((id) => 'ABCD'[id]), 'processor-output', 'generated')}<h3>上下文窗口 · 2 个 token</h3>${chips(f.context.map((id) => id === -1 ? '起点' : 'ABCD'[id]), 'processor-context')}
    <div class="service-probabilities">${f.raw.map((_, id) => `<div class="service-probability ${f.processed[id] === null ? 'blocked' : ''} ${f.selected === id ? 'selected' : ''}" data-visual-key="processor-candidate-${id}"><b>${'ABCD'[id]}</b><div><i style="width:${(f.probabilities[id] || 0) * 100}%"></i></div><strong>${f.processed[id] === null ? '屏蔽' : f.probabilities.length ? `${(f.probabilities[id] * 100).toFixed(1)}%` : '待处理'}</strong></div>`).join('')}</div></section>
    <section><h3>${o.processorWatermark ? 'Gumbel 竞争' : '普通随机采样'}</h3>${table(['候选', '原分数', '频次', '处理后', 'Gumbel', '竞争值'], f.raw.map((raw, id) => ['ABCD'[id], raw, f.counts[id], f.processed[id] === null ? '−∞' : fmt(f.processed[id]), f.noise.length && o.processorWatermark ? fmt(f.noise[id]) : '—', f.race.length && o.processorWatermark ? f.race[id] === null ? '屏蔽' : fmt(f.race[id]) : '—']), 'Logits 与 Gumbel 分数对照')}</section></div>
    <div class="formula">${o.processorWatermark ? '选取 argmax(logits − log(−log U))；U 由教学 key + 上下文决定' : '按处理后的 Softmax 概率进行普通随机采样'}</div>
    <div class="service-evidence"><div><b>检测证据</b><span>累计 −log(1−U)：${f.score.toFixed(3)}</span></div><div><b>${f.scored}</b><span>去重后上下文</span></div><div><b>${f.pValue.toFixed(4)}</b><span>教学 p 值</span></div></div>` +
    note('对照本版本 Gumbel 公式；教学随机数不实现 Philox、密钥安全或生产检测器。这里的 p 值只解释统计量，不能用于判定真实文本来源，也不证明内容事实正确。重复上下文不重复计分。');
}

function poolingView(f) {
  const visible = f.hidden.slice(0, f.visible);
  const plotVector = f.result || f.pooled || f.accumulator;
  const x = (v) => 170 + v * 15, y = (v) => 100 - v * 15;
  return caption(`${f.method} · 单序列 embedding`, f.normalized ? 'L2 归一化输出' : f.pooled ? '汇聚结果已就绪' : '逐位置观察') +
    `<div class="service-columns"><section><h3>token 隐藏状态 · ${f.hidden.length} × 2</h3><div class="service-hidden-matrix">${f.hidden.map((row, i) => `<div data-visual-key="pool-row-${i}" class="${i === f.activeRow ? 'current' : ''} ${f.consumed.includes(i) ? 'consumed' : ''}"><b>位置 ${i}</b>${row.map((v) => `<span>${i < f.visible ? fmt(v) : '·'}</span>`).join('')}<small>${f.consumed.includes(i) ? '已汇聚' : i < f.visible ? '就绪' : '待前向'}</small></div>`).join('')}</div><h3>${f.method === 'MEAN' ? '逐项累加 → 除以序列长度' : f.method === 'CLS' ? '选取第一个有效位置' : '选取最后一个有效位置'}</h3>${chips(f.accumulator.map(fmt), 'pool-sum', 'generated')}<p class="small-note">${f.pooled ? `汇聚向量：[${f.pooled.map(fmt).join(', ')}]` : '当前显示累加量；尚未输出最终向量。'}</p></section>
    <section><h3>二维向量观察窗</h3><svg class="service-vector-plot" viewBox="0 0 340 230" role="img" aria-label="隐藏状态与汇聚向量的二维坐标图"><defs><marker id="pool-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0 0L6 3L0 6" fill="#426ce2"/></marker></defs><path class="axis" d="M20 100H320M170 20V210"/><text x="320" y="93">x</text><text x="180" y="23">y</text>${visible.map((row, i) => `<g class="${f.consumed.includes(i) ? 'consumed' : ''}"><circle cx="${x(row[0])}" cy="${y(row[1])}" r="5"/><text x="${x(row[0]) + 8}" y="${y(row[1]) - 6}">${i}</text></g>`).join('')}${f.pooled ? `<path class="result" marker-end="url(#pool-arrow)" d="M170 100L${x(plotVector[0])} ${y(plotVector[1])}"/><text x="24" y="220">${f.result ? '输出' : '汇聚'}：[${plotVector.map(fmt).join(', ')}]</text>` : '<text x="24" y="220">先观察隐藏状态，再汇聚向量。</text>'}</svg></section></div>
    <div class="metrics-row">${metric(f.consumed.length, '参与汇聚的位置')}${metric(f.pooled ? fmt(Math.hypot(...f.pooled)) : '—', '汇聚向量范数')}${metric(f.result ? fmt(Math.hypot(...f.result)) : '—', '输出向量范数')}</div>` +
    note('二维隐藏状态为预设数值。CLS 指序列首位置，模型需要正确的特殊 token 与任务配置；不同 pooling 不是可任意替换的模型能力。');
}

function embedsView(f, o) {
  return caption(f.status, `${o.embedTokens} 个位置 · hidden_size ${o.embedWidth}`) +
    `<div class="service-input-route"><div class="${!f.direct ? 'active' : ''}"><b>token ID → 查表</b><small>${!f.direct ? `已执行 ${f.lookups} 次示例查表` : '当前绕过此路径'}</small></div><span>↘</span><div class="${f.direct ? 'active' : ''}"><b>预计算向量 → 直接输入</b><small>${f.direct ? '跳过对应 embedding 查表' : '切换参数可对照'}</small></div><span>↓</span><div class="active"><b>位置元数据 + 模型前向</b><small>两条路径都必须继续执行</small></div></div>
    <h3>模型输入矩阵与位置 ID</h3><div class="service-embed-matrix">${f.inputRows.map((row, i) => `<div data-visual-key="embed-row-${i}" class="${i === f.activeRow ? 'current' : ''}"><b>行 ${i}</b><div>${row.map((v) => `<span class="${i < f.rows.length ? 'ready' : ''}">${i < f.rows.length ? fmt(v) : '·'}</span>`).join('')}</div><small>position ${f.positions[i] ?? '待组织'}</small><strong>${f.computed.includes(i) ? 'KV 已写' : '待前向'}</strong></div>`).join('')}</div>
    <h3>KV 逻辑位置 · 固定 4 位置 / 块</h3><div class="service-kv-slots">${f.inputRows.map((_, i) => `<span data-visual-key="embed-kv-${i}" class="${f.computed.includes(i) ? 'ready' : ''}"><b>block ${Math.floor(i / 4)}</b><small>offset ${i % 4}</small><strong>${f.computed.includes(i) ? '已计算' : '空'}</strong></span>`).join('')}</div>
    <div class="metrics-row">${metric(f.lookups, '示例 embedding 查表')}${metric(f.positions.length, '已对齐的位置')}${metric(f.computed.length, '已前向 / KV 位置')}</div>` +
    note('这里只演示预计算输入的查表边界与位置对齐。位置起点是教学参数，不表示所有 API 都支持显式覆盖 positions；未计算 RoPE、Attention，也不模拟 Chat 模板和多模态拼接。');
}

function sleepView(f, o) {
  const total = o.sleepWeights + o.sleepKv;
  const resources = [
    ['GPU 权重', f.gpuWeights, o.sleepWeights, 'weights'],
    ['GPU KV 容量', f.gpuKv, o.sleepKv, 'kv'],
    ['CPU 权重备份', f.cpuWeights, o.sleepWeights, 'backup'],
    ['CPU buffers', f.cpuBuffers, 1, 'buffers'],
  ];
  return caption(`Level ${o.sleepLevel} · ${f.status}`, f.paused ? '调度暂停' : '调度运行') +
    `<div class="service-resource-chart">${resources.map(([label, value, max, key]) => `<div data-visual-key="sleep-${key}"><b>${label}</b><div><i style="width:${100 * value / max}%"></i></div><strong>${value} 单位</strong></div>`).join('')}</div>
    <div class="service-validity"><div class="${f.weightsValid ? 'valid' : 'invalid'}"><span>权重内容</span><b>${f.weightsValid ? `v${f.version} 有效` : f.gpuWeights ? '内存已分配，尚未恢复' : 'GPU 无权重'}</b></div><div class="${f.kvContent ? 'valid' : 'empty'}"><span>KV 内容</span><b>${f.kvContent ? `v${f.kvVersion} · ${f.kvContent} 单位` : '为空，必须重算'}</b></div><div class="${f.paused ? 'empty' : 'valid'}"><span>服务状态</span><b>${f.paused ? '等待权重和缓存就绪' : '可调度'}</b></div></div>
    <div class="metrics-row">${metric(f.gpuWeights + f.gpuKv, '示例 GPU 占用')}${metric(total - f.gpuWeights - f.gpuKv, '已释放 GPU 容量')}${metric(f.cpuWeights + f.cpuBuffers, '示例 CPU 备份')}</div>
    <div class="formula">${o.sleepLevel === 1 ? 'Level 1：备份权重 → 丢弃 KV → 恢复权重 → 分配空 KV' : 'Level 2：保留 buffers → 丢弃权重与 KV → reload / transfer → 分配空 KV'}</div>` +
    note('容量是任意教学单位，CPU buffer 大小固定为 1，未计 CUDA Graph、通信或分配器开销。Level 2 的 wake_up 不能自动恢复已丢弃权重；须先 reload / transfer。更新权重后清理旧缓存。');
}

function metricsView(f, o) {
  const end = f.clientTimes.at(-1), x = (time) => 30 + 580 * time / end;
  const first = f.serverTimes[0], last = f.serverTimes.at(-1);
  const intervals = [
    ['入站', 0, f.arrival, 'network'], ['排队', f.arrival, f.scheduled, 'queue'],
    ['Prefill', f.scheduled, first, 'prefill'], ['Decode / 等待', first, last, 'decode'],
    ['末 token 传输', last, end, 'network'],
  ].filter(([, start, finish]) => finish > start);
  const ms = (value) => value === null ? '—' : `${fmt(value)} ms`;
  return caption(`${f.now} ms · ${f.status}`, '同一教学时钟 · 时间为人工设定') +
    `<svg class="service-time-plot" viewBox="0 0 660 215" role="img" aria-label="请求阶段和服务端生成、客户端接收 token 的时间线">${intervals.map(([label, start, finish, kind]) => `<g><rect class="${kind}" x="${x(start)}" y="20" width="${x(finish) - x(start)}" height="26" rx="3"/><title>${label}：${start} 到 ${finish} ms</title></g>`).join('')}<text x="30" y="73">服务端输出</text><text x="30" y="139">客户端接收</text><path class="axis" d="M30 101H610M30 166H610"/>${f.serverTimes.map((time, i) => `<g class="${i < f.serverCount ? 'observed' : 'future'}"><circle cx="${x(time)}" cy="101" r="6"/><text x="${x(time)}" y="88" text-anchor="middle">${i + 1}</text><path class="delivery" d="M${x(time)} 107L${x(f.clientTimes[i])} 159"/></g>`).join('')}${f.clientTimes.map((time, i) => `<g class="${i < f.clientCount ? 'received' : 'future'}"><circle cx="${x(time)}" cy="166" r="6"/><text x="${x(time)}" y="190" text-anchor="middle">${time}</text></g>`).join('')}<path class="now" d="M${x(f.now)} 13V200"/><text x="30" y="211">0 ms</text><text x="600" y="211">${end} ms</text></svg>
    <div class="service-timeline-legend">${intervals.map(([label, start, finish, kind]) => `<span class="${kind}">${label} ${finish - start} ms</span>`).join('')}</div>
    <div class="metrics-row">${metric(ms(f.serverTtft), '服务端 TTFT')}${metric(ms(f.clientTtft), '客户端 TTFT')}${metric(f.tpot === null && o.metricTokens === 1 ? '不适用' : ms(f.tpot), '服务端 TPOT')}${metric(ms(f.e2e), '客户端端到端')}</div>
    <h3>服务端相邻输出间隔 ITL</h3>${chips(f.itls.map((time, i) => `${i + 1}→${i + 2}: ${time} ms`), 'metric-itl', 'generated')}
    <div class="formula">TTFT = 首输出时刻 − 对应起点<br>TPOT = (末输出 − 首输出) / (输出数 − 1)</div>` +
    note('入站和每个输出的传输延迟固定相同，传输可与后续 Decode 重叠。额外停顿只加入首个 Decode 间隔；单 token 没有 ITL，本版本统计结构中的 TPOT 记 0，页面标为不适用。请求指标不能当作 GPU profile，也不能从单请求推算系统吞吐。');
}

export function serviceMechanismView(id, frame, options) {
  const views = {
    'model-loading': loadingView, logits: logitsView, pooling: poolingView,
    'prompt-embeds': embedsView, sleep: sleepView, metrics: metricsView,
  };
  return views[id](frame, options);
}
