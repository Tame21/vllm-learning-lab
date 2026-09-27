import { esc, metric, table, range, toggle } from './html.mjs';
import {
  mechanismParameters,
  mechanismParameterNames,
  mechanismIds,
} from './mechanism-parameters.mjs';

const labels = {
  lifePrompt: '输入 token 数',
  lifeOutput: '输出 token 上限',
  lifeEosAt: '第几枚输出为 EOS（0 关闭）',
  runnerV2: '使用 MRV2 持久行与 gather',
  runnerReverse: '反转本轮输入顺序',
  runnerFinishB: '首轮后完成请求 B',
  runnerAddD: '第二轮加入请求 D',
  memoryBlocks: '教学 KV 块容量',
  cancelAt: '取消 B 的轮次（0 不取消）',
  priorityMode: '启用 Priority（关闭为 FCFS）',
  priorityA: '请求 A 优先级',
  priorityB: '请求 B 优先级',
  priorityC: '请求 C 优先级',
  asyncEnabled: '允许 CPU / GPU 重叠',
  cpuCost: 'CPU 准备逻辑时隙',
  gpuCost: 'GPU 执行逻辑时隙',
  windowSize: '注意力窗口长度',
  contextTokens: '示例序列长度',
  hybridSsm: '显示状态空间层对照',
  beamWidth: 'Beam 宽度',
  beamDepth: '搜索输出长度上限',
  beamBias: '候选 A 的偏好',
  beamPenalty: '长度归一化指数',
  beamCompare: '对照独立采样',
  sdBatch: '初始 batch size',
  sdLow: '低并发区间上限',
  sdHigh: '中并发区间上限',
  sdKLow: '低并发草稿 K',
  sdKMid: '中并发草稿 K',
  sdKHigh: '高并发草稿 K',
};
const notes = {
  lifecycle: '示例 token ID，不调用模型；每块 4 个位置。EOS 设为 0 时按输出上限停止。',
  runner: '三个演示批次共用请求身份；完成 B、加入 D 和改变顺序都会重新计算布局。',
  preemption: '取消发生在轮次边界；本例不模拟仍在途的 GPU 工作。轮次从 0 开始。',
  priority: '数值越小优先级越高；候选排序仍受预算与 KV 容量约束。',
  async: '三个批次的输入相互独立；时隙是教学设定，不是设备实测延迟。',
  hybrid: '窗口包含当前 query；只回收完全落在窗口外、且本步已不再读取的整块。',
  beam: '三词示例词表 A / B / EOS。固定前缀 2 token；得分分母包含前缀和输出长度，排除 EOS。',
  'dynamic-spec': '两个区间上限必须递增。K=0 关闭草稿；区间参数不是通用最优配置。',
};

export function mechanismControls(lesson, o) {
  if (!mechanismIds.includes(lesson.id)) return null;
  return (
    mechanismParameterNames[lesson.id]
      .map((key) => {
        if (key === 'blockSize')
          return `<label class="setting"><span>每块 token 数</span><select data-param="blockSize" aria-label="每块 token 数">${[2, 4, 8].map((n) => `<option value="${n}" ${o.blockSize === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`;
        if (key === 'seed')
          return `<label class="setting"><span>随机种子</span><input type="number" min="1" max="9999" value="${o.seed}" data-param="seed" aria-label="随机种子"></label>`;
        const [initial, min, max, step] = mechanismParameters[key];
        return typeof initial === 'boolean'
          ? toggle(o, key, labels[key])
          : range(o, key, labels[key], min, max, step);
      })
      .join('') + `<p class="mechanism-control-note">${notes[lesson.id]}</p>`
  );
}
const chips = (values, kind = '', prefix = 'token') =>
  `<div class="mechanism-chips">${values.map((v, i) => `<span data-visual-key="${prefix}-${i}" class="mechanism-chip ${kind}">${esc(v)}</span>`).join('') || '<span class="mechanism-empty">∅</span>'}</div>`;
const caption = (label, detail) =>
  `<div class="scene-caption"><span>${esc(label)}</span><span>${esc(detail)}</span></div>`;
const note = (text) => `<p class="scene-footnote">${esc(text)}</p>`;

function lifecycleView(f, o) {
  const stations = ['输入', '队列', '分配', '前向', '采样', '输出'];
  return (
    caption(`请求 A · ${f.status}`, f.round ? `第 ${f.round} 轮` : '准备阶段') +
    `<div class="mechanism-route">${stations.map((s, i) => `<span class="${f.stepIndex === i ? 'active' : ''}">${s}</span>`).join('')}<div class="mechanism-packet" data-visual-key="life-packet" style="transform:translateX(${f.stepIndex * 100}%)"><b>A</b></div></div>
    <div class="mechanism-columns"><section><h3>输入序列</h3>${chips(f.prompt, 'prompt', 'life-prompt')}<h3>已采样 token</h3>${chips(
      f.output.map((n) => (n === 2 ? 'EOS' : n)),
      'generated',
      'life-output',
    )}<h3>客户端已收到</h3>${chips(f.delivered, 'delivered', 'life-delivered')}</section>
    <section><h3>KV 物理块 · 4 位置 / 块</h3><div class="mechanism-blocks">${Array.from(
      { length: Math.ceil((o.lifePrompt + o.lifeOutput - 1) / 4) },
      (_, b) =>
        `<div data-visual-key="life-block-${b}" class="mechanism-block ${f.blocks.includes(b) ? 'occupied' : ''}"><b>#${b} · ${f.blocks.includes(b) ? '占用' : '空闲'}</b><div>${Array.from(
          { length: 4 },
          (_, j) => {
            const p = b * 4 + j;
            return `<span class="${f.blocks.includes(b) && p < f.computed ? 'written' : f.scheduled.includes(p) ? 'scheduled' : ''}">${p}</span>`;
          },
        ).join('')}</div></div>`,
    ).join(
      '',
    )}</div><p class="small-note">绿色：已写 KV · 虚线位置：已调度待计算</p></section></div>
    <div class="metrics-row">${metric(f.computed, '当前 KV 位置')}${metric(f.blocks.length, '占用块')}${metric(f.delivered.length, '已交付 token')}</div>` +
    note('采样不会同时写入新 token 的 KV。停止后释放缓存，已发送的输出仍保留。')
  );
}

function runnerView(f) {
  return (
    caption(`${f.version} · 第 ${f.round} 轮`, '请求身份与行号分别显示') +
    `<div class="runner-order"><b>本轮计划</b>${chips(f.order, '', 'runner-order')}</div><div class="mechanism-columns runner-layout"><section><h3>持久请求行</h3><div class="runner-slots">${f.slots.map((id, row) => `<div data-visual-key="runner-slot-${row}" class="runner-slot ${id ? 'occupied' : ''}"><span>row ${row}</span><b>${id || '空闲'}</b><small>${f.previous[row] === id ? '保持' : `${f.previous[row] || '空闲'} → ${id || '空闲'}`}</small></div>`).join('')}</div></section><section><h3>${f.version === 'MRV2' ? '按索引 gather → 连续输入' : '按连续 batch 行 → 输入'}</h3><div class="runner-slots">${f.order
      .map((id, i) => {
        const p = f.packed[i];
        return `<div data-visual-key="runner-input-${id}" class="runner-slot ${p ? 'gathered' : ''}"><span>input ${i}</span><b>${id}</b><small>${p ? `← row ${p.slot} · token ${p.token}` : '等待整理'}</small></div>`;
      })
      .join('')}</div></section></div>` +
    table(
      ['请求', '输入行', '持久行', 'input_id', 'position', 'block table'],
      f.packed.map((p) => [p.id, p.index, p.slot, p.token, p.position, `[${p.blocks}]`]),
      'Runner 本轮输入张量',
    ) +
    `<h3 class="diagram-label">输出归属</h3>${chips(
      f.results.map((r) => `${r.id} ← ${r.token}`),
      'generated',
      'runner-results',
    )}` +
    note(
      '演示输入为每请求一个 decode 位置；省略真实张量拷贝和 kernel。MRV1 / MRV2 都属于 V1 引擎。',
    )
  );
}

function queueView(f, frames, isPriority) {
  const owners = new Map(f.requests.flatMap((r) => r.blocks.map((b) => [b, r.id])));
  const queue =
    frames.slice(0, frames.indexOf(f) + 1).findLast((frame) => frame.candidateIds)?.candidateIds ||
    [];
  const jumps = [
    ['preempt', '观察抢占'],
    ['recompute', '观察重算'],
    ['cancel', '观察取消'],
    ['finish', '观察释放'],
  ]
    .map(([kind, label]) => ({ index: frames.findIndex((t) => t.kind === kind), label }))
    .filter((x) => x.index >= 0);
  return (
    caption(
      `第 ${f.tick} 轮 · ${isPriority ? (f.policy === 'priority' ? 'Priority' : 'FCFS') : '显存压力实验'}`,
      '每帧只展示一个状态事件',
    ) +
    `<div class="mechanism-jumps">${jumps.map((j) => `<button data-step="${j.index}">${j.label} →</button>`).join('')}</div><div class="runner-order"><b>本轮候选</b>${chips(queue, '', 'queue-order')}</div>
    <div class="queue-requests">${f.requests.map((r) => `<div data-visual-key="queue-${r.id}" class="queue-request ${r.id === f.victim ? 'was-preempted' : ''}"><div><b class="req-${r.id}">请求 ${r.id}</b><span>${esc(r.status)}</span>${isPriority ? `<small>priority ${r.priority}</small>` : `<small>抢占 ${r.preemptions} 次</small>`}</div><div><span class="small-note">KV 进度 ${r.blocks.length ? r.computed : 0} / ${r.prompt + r.output} · 输出 ${r.output} / ${r.max}</span><div class="mechanism-chips">${Array.from({ length: r.prompt + r.output }, (_, n) => `<span data-visual-key="queue-${r.id}-${n}" class="mechanism-chip ${r.blocks.length && n < r.computed ? 'generated' : n < r.recomputeUntil ? 'recompute' : ''}">${n}</span>`).join('')}</div></div></div>`).join('')}</div>
    <h3 class="diagram-label">物理块池 · ${owners.size} / ${f.capacity} 占用</h3><div class="mechanism-pool">${Array.from({ length: f.capacity }, (_, b) => `<div data-visual-key="queue-block-${b}" class="mechanism-block ${owners.has(b) ? 'occupied' : ''}"><b>#${b}</b><span>${owners.get(b) || '空闲'}</span></div>`).join('')}</div>
    ${isPriority ? `<div class="queue-comparison"><div><b>当前策略已首次运行</b><p>${f.firstRun.join(' → ') || '尚未运行'}</p></div><div><b>${f.policy === 'priority' ? 'FCFS' : 'Priority'} 完整回放的首运行顺序</b><p>${f.otherOrder.join(' → ')}</p></div></div>` : ''}` +
    note(
      isPriority
        ? '先处理运行中请求，再按策略选择等待请求。优先级小的更靠前，资源不足仍须等待或抢占。'
        : '橙色位置需重算 KV，已确认输出不会删除。本轮已执行的工作不被回收；取消在轮次边界生效。',
    )
  );
}

function asyncView(f, o) {
  const lanes = [
    ['CPU 准备', 'prepareStart', 'prepareEnd'],
    ['GPU 执行', 'executeStart', 'executeEnd'],
    ['结果交付', 'outputStart', 'outputEnd'],
  ];
  return (
    caption(
      `逻辑时刻 ${f.tick} / ${f.total}`,
      o.asyncEnabled ? '允许跨批重叠' : '同步等待前批交付',
    ) +
    `<div class="mechanism-timeline" role="img" aria-label="CPU、GPU 与输出的逻辑时间线"><div class="mechanism-timeline-inner">${lanes.map(([label, start, end]) => `<div class="mechanism-lane"><b>${label}</b><div class="mechanism-lane-track" style="--ticks:${f.total}">${f.tasks.map((t) => `<div data-visual-key="${start}-${t.batch}" class="mechanism-bar batch-${t.batch} ${f.tick < t[start] ? 'future' : f.tick < t[end] ? 'running' : 'finished'}" style="grid-column:${t[start] + 1}/${t[end] + 1}">B${t.batch + 1}<small>${t[start]}–${t[end]}</small></div>`).join('')}<i class="mechanism-cursor" style="left:${(100 * f.tick) / f.total}%"></i></div></div>`).join('')}<div class="mechanism-lane"><b>时隙</b><div class="mechanism-ticks"><span>0</span><span>${f.total}</span></div></div></div></div>
    <div class="mechanism-columns"><section><h3>已准备，等待 GPU</h3>${chips(
      f.ready.map((b) => 'B' + (b + 1)),
      'scheduled',
      'async-ready',
    )}</section><section><h3>已交付结果</h3>${chips(
      f.returned.map((b) => 'B' + (b + 1)),
      'generated',
      'async-return',
    )}</section></div>
    <div class="metrics-row">${metric(f.preparing === null ? '空闲' : 'B' + (f.preparing + 1), 'CPU')}${metric(f.executing === null ? '空闲' : 'B' + (f.executing + 1), 'GPU')}${metric(f.returned.length + '/3', '已交付')}</div>` +
    note(
      '淡色条是后续计划，亮色是当前工作。批次输入独立、GPU 顺序执行；完成前不能交付结果。逻辑时隙不代表实测加速。',
    )
  );
}

function hybridView(f, o) {
  const row = (window) =>
    `<div class="history-tokens">${Array.from({ length: o.contextTokens }, (_, p) => {
      const computed = p <= f.position,
        attended = computed && (!window || p >= f.skip),
        held = window
          ? f.window.some((b) => b.logical === Math.floor(p / o.blockSize))
          : f.full.includes(Math.floor(p / o.blockSize));
      return `<span data-visual-key="${window ? 'window' : 'full'}-token-${p}" class="${attended ? 'attended' : computed && held ? 'retained' : 'expired'} ${p === f.position ? 'current' : ''}">${p}<small>${!computed ? '待算' : attended ? '读取' : held ? '保留' : '跳过'}</small></span>`;
    }).join('')}</div>`;
  return (
    caption(`当前 query：${f.position < 0 ? '待开始' : f.position}`, '完整历史与滑动窗口独立管理') +
    `<h3 class="diagram-label">Full Attention · ${f.full.length} 块</h3>${row(false)}<h3 class="diagram-label">窗口长度 ${o.windowSize} · ${f.window.length} 块</h3>${row(true)}
    <div class="mechanism-columns"><section><h3>窗口逻辑块 → 物理块</h3><div class="mechanism-blocks">${f.window.map((b) => `<div data-visual-key="hybrid-${b.logical}" class="mechanism-block occupied"><b>逻辑 ${b.logical}</b><span>→ W${b.physical}</span><small>${b.logical * o.blockSize}…${(b.logical + 1) * o.blockSize - 1}</small></div>`).join('') || '<p>尚未分配</p>'}</div></section><section><h3>本步释放</h3>${chips(
      f.freed.map((b) => `W${b.physical}（逻辑 ${b.logical}）`),
      'released',
      'hybrid-free',
    )}<p class="small-note">整块末尾早于窗口起点 ${f.skip} 才能释放。</p></section></div>
    ${o.hybridSsm ? `<div class="ssm-state"><b>状态空间层 · 固定一个示例状态</b><code>s = ${f.ssm}</code><span>s ← 0.5s + x，不是按 token 存储 K/V。</span></div>` : ''}` +
    note(
      '黄色位置：不参与当前 attention，但所在块仍保留。省略前缀缓存、投机额外保留和 Mamba checkpoint；示例递推不是实际 Mamba 算子。',
    )
  );
}

function beamView(f, o) {
  const parents = f.parents.length ? f.parents : [{ id: 'root', tokens: [] }];
  const height = Math.max(140, f.candidates.length * 38 + 28);
  const diagram = parents
    .map((parent, pi) => {
      const children = f.candidates.filter((c) => c.parent === parent.id);
      const y = children.length ? 28 + (pi * 3 + 1) * 38 : 60;
      return `<g><rect x="12" y="${y - 15}" width="130" height="30" rx="6"/><text x="24" y="${y + 4}">${esc(parent.tokens.join(' ') || '起始前缀')}</text>${children
        .map((c, i) => {
          const cy = 28 + (pi * 3 + i) * 38;
          return `<g class="beam-node ${c.status === '剪枝' ? 'pruned' : c.status === '完成' ? 'completed' : c.status === '保留' ? 'kept' : ''}"><path d="M142 ${y} C205 ${y},210 ${cy},258 ${cy}"/><rect x="258" y="${cy - 15}" width="250" height="30" rx="6"/><text x="270" y="${cy + 4}">${esc(c.tokens.join(' '))} · ${c.score.toFixed(3)} · ${c.status}</text></g>`;
        })
        .join('')}</g>`;
    })
    .join('');
  return (
    caption(
      `搜索深度 ${f.depth} / ${o.beamDepth}`,
      `Beam 宽度 ${o.beamWidth} · 前缀 ${f.promptLength} token`,
    ) +
    `<div class="beam-tree"><svg width="520" height="${height}" viewBox="0 0 520 ${height}" role="img" aria-label="候选树展开与剪枝，节点显示长度归一化得分">${diagram}</svg></div>
    <div class="mechanism-columns"><section><h3>存活分支</h3>${chips(
      f.kept.map((c) => c.tokens.join(' ') || '起始前缀'),
      'generated',
      'beam-active',
    )}</section><section><h3>已完成（EOS 不再展开）</h3>${chips(
      f.completed.map((c) => c.tokens.join(' ')),
      'delivered',
      'beam-completed',
    )}</section></div>
    ${
      f.results.length
        ? table(
            ['结果', '累计 log 概率', '归一化得分'],
            f.results.map((c) => [esc(c.tokens.join(' ')), c.logp.toFixed(3), c.score.toFixed(3)]),
            'Beam 最终结果',
          )
        : ''
    }
    ${o.beamCompare ? `<h3 class="diagram-label">独立采样 · 相同分布 / 固定种子</h3><div class="independent-samples">${f.samples.map((s) => `<div><b>${s.id}</b>${chips(s.tokens, '', 'beam-' + s.id)}<small>${s.done ? 'EOS 已停止' : '独立推进，无跨样本剪枝'}</small></div>`).join('')}</div>` : ''}` +
    note(
      '得分 = 累计 log 概率 ÷ (2 + 非 EOS 输出长度)^指数。教学词表全部枚举，省略真实模型的候选截断；EOS 不再展开。',
    )
  );
}

function dynamicView(f) {
  return (
    caption(`第 ${f.round} 轮 · batch size ${f.batch}`, '按闭区间查表，不在线学习参数') +
    `<div class="sd-load"><span>并发数 1…512</span><b>${f.batch}</b><div><i style="width:${(100 * f.batch) / 512}%"></i></div></div><div class="sd-schedule">${f.schedule.map((row, i) => `<div class="${i === f.interval ? 'selected' : ''}"><b>${row.min} ≤ batch ≤ ${row.max}</b><span>K = ${row.k}</span><small>${i === f.interval ? '← 本轮命中' : '等待匹配'}</small></div>`).join('')}</div>
    <h3 class="diagram-label">一个请求的草稿位置</h3>${f.k === 0 ? '<div class="sd-disabled">K = 0 · 不产生草稿，继续普通目标模型解码</div>' : chips(f.candidates, 'generated', 'sd-candidate')}
    <div class="metrics-row">${metric(f.k === null ? '待选' : f.k, '每请求草稿 K')}${metric(f.candidates.length * f.batch, '已准备的草稿位置')}${metric(f.batch, '本轮请求数')}</div>
    <h3 class="diagram-label">示例负载变化</h3>${chips(
      f.loads.map((v, i) => `${i + 1}轮：${v}`),
      '',
      'sd-loads',
    )}` +
    note('统计草稿位置数，不据此推算耗时。K=0 时目标模型仍然执行；下一轮重新匹配同一张配置表。')
  );
}

export function mechanismScene(lesson, index, o, frames) {
  const f = frames[index];
  const render = {
    lifecycle: () => lifecycleView(f, o),
    runner: () => runnerView(f),
    preemption: () => queueView(f, frames, false),
    priority: () => queueView(f, frames, true),
    async: () => asyncView(f, o),
    hybrid: () => hybridView(f, o),
    beam: () => beamView(f, o),
    'dynamic-spec': () => dynamicView(f),
  };
  return `<div class="mechanism-scene" data-mechanism="${lesson.id}">${render[lesson.id]()}<div class="state-strip" aria-live="polite"><span>事件 ${index + 1} / ${frames.length}</span><code>${esc(f.events.join(' '))}</code></div></div>`;
}
