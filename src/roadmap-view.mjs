import { esc, metric, table } from './html.mjs';
import { roadmapSpecViews } from './roadmap-spec-view.mjs';
import { roadmapProtocolViews } from './roadmap-protocol-view.mjs';
import { roadmapBranchViews } from './roadmap-branch-view.mjs';
import { roadmapModelViews } from './roadmap-model-view.mjs';
export const num = (v) => v === null || v === undefined ? '—' : Number(v).toPrecision(4);
export const vec = (v) => `[${v.map(num).join(', ')}]`;
export const caption = (f, detail) => `<div class="scene-caption"><span>${esc(f.status)}</span><span>${esc(detail)}</span></div>`;
export const footnote = (text) => `<p class="scene-footnote">${esc(text)}</p>`;
export const chips = (items, prefix = 'roadmap-chip') => `<div class="roadmap-chips">${items.map((x, i) => `<span data-visual-key="${prefix}-${i}" class="${x.active ? 'active' : ''} ${x.ready ? 'ready' : ''}">${esc(x.label ?? x)}</span>`).join('')}</div>`;

function prefillView(f, o) {
  const total = o.prefillPrompt + o.prefillOutput - 1, latest = f.queries.at(-1);
  return caption(f, `第 ${f.round || 'Prefill'} 轮 · Q / K / V 身份保持`) +
    `<div class="roadmap-attention"><div class="roadmap-causal" style="--matrix-n:${total}">${Array.from({ length: total * total }, (_, k) => {
      const row = Math.floor(k / total), col = k % total, computed = f.queries.some((q) => q.position === row);
      return `<span class="${computed && col <= row ? 'ready' : ''} ${row === latest?.position ? 'active' : ''}" title="Q ${row} → K ${col} · ${computed && col <= row ? '可读' : '尚未计算 / 未来'}">${row === latest?.position ? col : ''}</span>`;
    }).join('')}</div><div><h3>最新 query</h3><p>${latest ? `${latest.phase} · position ${latest.position}<br>输入 token ${latest.token}<br>Q ${vec(latest.q)}` : '等待前向'}</p><h3>已采样输出</h3>${chips(f.output.map((x) => ({ label: `${x.eos ? 'EOS' : x.token} · ${x.kvWritten ? 'KV 已写' : 'KV 未写'}`, ready: x.kvWritten })), 'prefill-output')}<p>最后一枚输出要继续生成时，才进入下一轮输入。</p></div></div>
    ${table(['KV 位置', '输入 token', '缓存 K', '缓存 V'], f.cache.map((row) => [row.position, row.token, vec(row.k), vec(row.v)]), 'Prefill Decode KV 增长')}
    <div class="metrics-row">${metric(f.cache.length, '已计算 KV 位置')}${metric(f.output.length, '已采样输出')}${metric(f.queries.filter((q) => q.phase === 'D').length, '新增 Decode query')}</div>` +
    footnote('每个 Prefill query 只看到当前及之前的位置，行动画是观察顺序，不代表 GPU 逐 token 串行执行 Prefill。K/V 和输出 ID 是教学值，未运行模型；停止后保留历史显示，缓存回收可在生命周期实验中观察。');
}

function samplingView(f, o) {
  return caption(f, `T=${o.temperature} · p=${o.topP} · seed=${o.seed}`) +
    `<div class="roadmap-probabilities">${f.words.map((word, i) => `<div class="${f.selected === i ? 'selected' : ''}"><b>${word}</b><div><i style="width:${100 * (f.normalized[i] ?? f.probabilities[i] ?? 0)}%"></i></div><span>${num(f.normalized[i] ?? f.probabilities[i])}</span></div>`).join('')}</div>
    ${table(['候选', 'logit', '温度后分数', '原概率', '保留', '最终概率', 'p / Exp(1)'], f.words.map((word, i) => [word, f.logits[i], f.scaled.length ? num(f.scaled[i]) : o.temperature === 0 ? '贪心跳过' : '待变换', num(f.probabilities[i]), f.kept.includes(i) ? '是' : '待选 / 否', num(f.normalized[i]), num(f.races.find((x) => x.i === i)?.score)]), '采样各阶段数值')}
    <div class="advanced-gate ${f.selected !== null ? 'ready' : ''}"><b>${f.selected === null ? '尚未产生输出' : `选中 ${f.words[f.selected]}`}</b><span>${o.temperature === 0 ? '贪心分支不使用 Top-p 和随机数' : '屏蔽 → 重新归一化 → 指数竞赛'}</span></div>` +
    footnote('Top-p 取降序概率累计覆盖阈值的最短前缀，本例概率没有并列。指数竞赛使用 p/Exp(1)，随机流由页面内 LCG 生成，不能与 PyTorch 相同 seed 的输出逐项比较；仅研究五个候选，其他 logits processor 不在此图中。');
}

function integerView(f, o) {
  return caption(f, `INT${o.bits} · scale=${num(f.scale)}`) +
    `${table(['元素', '原始浮点', '除以 scale', '舍入整数', '解包整数', '还原', '绝对误差'], f.raw.map((x, i) => { const q = f.integers[i], restored = f.restored.find((r) => r.i === i); return [i, x, num(q?.scaled), q?.integer ?? '待舍入', restored?.integer ?? '待解包', num(restored?.value), num(restored?.error)]; }), '整数缩放舍入与还原')}
    <h3>教学存储字节</h3><div class="roadmap-bytes">${f.bytes.map((x, i) => `<div data-visual-key="quant-byte-${i}"><b>0x${x.byte.toString(16).padStart(2, '0')}</b><code>${x.byte.toString(2).padStart(8, '0')}</code><small>元素 ${x.indices.join(' / ')}</small></div>`).join('') || '等待位打包'}</div>
    <div class="metrics-row">${metric(f.integers.length, '已量化元素')}${metric(f.bytes.length, '数据字节')}${metric(f.restored.length, '已解包元素')}${metric(num(f.restored.length ? f.restored.reduce((sum, x) => sum + x.error, 0) / f.restored.length : null), '当前平均绝对误差')}</div>` +
    footnote('有符号对称范围 INT4 为 −7…7、INT8 为 −127…127，舍入半格远离零。INT4 首元素放在低四位。字节包含元素补码，scale 另存；真实 AWQ/GPTQ kernel 的布局、分组、零点、校准与元数据不同，本例不能作为兼容打包实现。');
}

function cpView(f, o) {
  return caption(f, `${o.cpPrefill ? 'PCP / KV Gather' : 'DCP / LSE 合并'} · query ${f.query}`) +
    `<div class="dp-replicas">${f.shards.map((s) => `<section data-visual-key="cp-rank-${s.rank}"><h3>rank ${s.rank}</h3>${chips(s.positions.map((p) => ({ label: p, ready: s.ready && p <= f.query, active: p === f.query })), `cp-position-${s.rank}`)}<p>${o.cpPrefill ? s.positions.includes(f.query) ? '本 rank 拥有观察 query' : '本 rank 提供自己的 KV' : '同一 query · 不同 KV 片段'}</p></section>`).join('')}</div>
    ${table(['rank', '可见位置', '局部 LSE', '局部 Attention 输出', '合并系数'], f.partials.map((p, i) => [p.rank, p.visible.join(', '), num(p.lse), vec(p.output), num(f.factors[i])]), '上下文并行局部结果')}
    <div class="advanced-results"><div><b>本场景当前输出</b><span>${vec(f.output)}</span></div><div><b>单设备对照</b><span>${vec(f.reference)}</span></div></div>
    <div class="advanced-formula">${o.cpPrefill ? 'KV Gather 完成 → 所属 rank 对完整可见 KV 计算 Attention' : 'factorᵣ = exp(LSEᵣ − global_LSE)；o = Σ factorᵣ × oᵣ'}</div>` +
    footnote('八个位置、单头二维示例。PCP 演示局部 query / Gather 完整 KV；DCP 演示复制 query / 分片 KV / LSE 缩放归并，不能直接平均局部归一化结果。连续 token 切片是教学布局，未复现 block interleave、负载均衡或 ring attention。生产 DCP 复用 TP 设备组，不能把这里 rank 数直接当成新增 GPU 数。');
}

function eplbView(f) {
  const layout = (items, next) => `<div class="roadmap-expert-layout">${items.map((x, i) => `<div data-visual-key="eplb-${next ? 'new' : 'old'}-${x.rank}-${x.slot}" class="${next && f.valid[i] ? 'ready' : ''} ${next && f.pending?.index === i ? 'active' : ''}"><small>GPU ${x.rank} / 槽 ${x.slot}</small><b>${x.logical === null ? '空槽' : `专家 ${x.logical}`}</b><span>${next ? f.valid[i] ? '目标权重就绪' : '待复制确认' : '旧映射有效'}</span></div>`).join('')}</div>`;
  return caption(f, `映射 v${f.mapVersion} · 权重 v${f.weightVersion}`) +
    `<div class="roadmap-probabilities">${f.loads.map((load, i) => `<div><b>E${i}</b><div><i style="width:${100 * load / Math.max(...f.loads)}%"></i></div><span>${load} / ${f.counts[i]} 副本</span></div>`).join('')}</div>
    <h3>旧布局 · 切换前保持可服务</h3>${layout(f.old, false)}<h3>新布局 · 等所有目标权重确认</h3>${layout(f.target, true)}
    <div class="advanced-gate ${f.mapVersion === 2 ? 'ready' : ''}" data-visual-key="eplb-gate"><b>${f.mapVersion === 2 ? '映射切换已完成' : '映射尚未切换'}</b><span>${f.pending ? `E${f.pending.destination.logical} 从 GPU ${f.pending.source.rank} → ${f.pending.destination.rank}：${f.pending.progress}/${f.pending.duration}` : f.targetReady ? '全部目标副本就绪' : '等待目标权重'}</span></div>
    <div class="metrics-row">${metric(f.valid.filter(Boolean).length, '目标就绪槽')}${metric(f.target.filter((x) => x.logical !== null).length, '有效物理副本')}${metric(f.time, '教学迁移时隙')}</div>` +
    footnote('复用算法章的单层、两设备、固定容量分配；副本负载视为理想均摊。迁移使用影子目标槽与确认屏障来解释版本一致性，未复现生产原地搬运、多层分组或异步缓冲策略。物理专家复制不改变逻辑专家总负载，迁移时隙不是性能测量。');
}

function loraView(f, o) {
  return caption(f, `r=${o.loraRank} · 增量比例 ${o.loraScale}`) +
    `<div class="advanced-materialize"><b>共享 W = [1, 0, 1] / [0, 1, −1]</b><span>adapter 1 与 2 的 A/B 不同；base 映射为 0</span></div>
    <div class="dp-replicas">${f.adapters.slice(1).map((a, i) => `<section><h3>adapter ${i + 1}</h3><p>A ${a.A.map(vec).join(' / ')}<br>B ${a.B.map(vec).join(' / ')}</p><p>${f.loaded.includes(i + 1) ? '当前批次已选择' : '本批次未选择'}</p></section>`).join('')}</div>
    ${table(['当前行', '输入身份', 'adapter ID', 'x', 'Wx', 'Ax', '增量', '最终输出'], f.rows.map((row, i) => { const mapping = f.mapping.find((m) => m.id === row.id), r = f.results.find((x) => x.id === row.id); return [i, row.id, mapping?.adapter ?? '待映射', vec(row.x), r ? vec(r.base) : '待算', r ? r.compressed.length ? vec(r.compressed) : 'base 跳过' : '待算', r ? vec(r.delta) : '待算', r ? vec(r.output) : '待算']; }), '混合 LoRA 请求计算')}` +
    footnote('小矩阵仅研究映射和低秩计算；比例已包含 alpha/r，不重复除以 r。反转行顺序时，同一请求保持适配器与数值结果。未模拟 adapter 加载淘汰、并发准入、模型层选择或真实 kernel 的融合与打包。');
}

function mediaView(f, o) {
  return caption(f, ['图像', '视频帧', '音频特征'][o.mmType]) +
    `<div class="roadmap-media-items">${f.items.map((item) => `<section><b>${item.id} · ${item.count} 行特征</b><code>${esc(item.key)}</code><span>${item.features.length ? item.hit ? '缓存命中' : '编码完成' : '等待编码'}</span><small>${item.features.map(vec).join(' / ')}</small></section>`).join('')}</div>
    <h3>文本 / 媒体输入逐位置对齐</h3><div class="roadmap-embedding-rows">${f.rows.map((row) => `<div data-visual-key="mm-row-${row.position}" class="${row.kind} ${row.ready ? 'ready' : ''}"><small>position ${row.position}</small><b>${row.label}</b><span>${row.vector ? vec(row.vector) : '媒体占位 · 等待向量'}</span></div>`).join('')}</div>
    <div class="advanced-gate ${f.valid ? 'ready' : ''}" data-visual-key="mm-gate"><b>${f.failed ? '占位数量错误 · 禁止前向' : f.valid ? '完整模型输入已对齐' : '等待对应特征'}</b><span>不会把缺失向量当成已就绪输入</span></div>
    <div class="metrics-row">${metric(f.encoded, '实际教学编码行')}${metric(f.hits, '重复媒体缓存命中')}${metric(f.merged, '已替换媒体位置')}</div>` +
    footnote('图像每项 2 行、视频 2 帧各 2 行、音频每项 3 行，均为教学配置。编码向量是预设数据，缓存键只解释内容与 encoder 配置身份；未实现真实哈希、媒体解码或网络模型。不同模型的媒体 token 数、M-RoPE 和占位协议不同，本表 position 仅表示输入行序号。');
}

const views = { ...roadmapModelViews, ...roadmapBranchViews, ...roadmapProtocolViews, ...roadmapSpecViews, prefill: prefillView, sampling: samplingView, quantization: integerView, cp: cpView, eplb: eplbView, lora: loraView, multimodal: mediaView };
export const roadmapScene = (id, f, o) => views[id](f, o);
