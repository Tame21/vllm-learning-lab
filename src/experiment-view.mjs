import { esc, token, metric, table, range, toggle } from './html.mjs';
import { exampleRequests } from './engines/scheduler.mjs';
import { grammarVocabulary } from './engines/cache.mjs';

export function experimentControls(lesson, o) {
  if (lesson.kind === 'scheduler') {
    const requests = o.requests || exampleRequests;
    return (
      range(o, 'budget', '每轮 token 预算', 4, 16, 4) +
      range(o, 'capacity', 'KV 物理块数量', 4, 20, 2) +
      `<label class="setting"><span>每块 token 数</span><select data-param="blockSize" aria-label="每块 token 数">${[2, 4, 8].map((n) => `<option value="${n}" ${o.blockSize === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>` +
      toggle(o, 'chunked', '启用 Chunked Prefill') +
      `<div class="workload-editor"><div class="section-heading"><h3>设计你的工作负载</h3><div class="preset-actions"><button data-preset="default">默认</button><button data-preset="pressure">显存压力</button><button data-preset="long">长短请求混合</button></div></div><p>到达轮次从 0 开始；修改任一值后会重新推演。最多 6 个请求。</p><div class="request-editor-head"><span>请求</span><span>输入长度</span><span>输出上限</span><span>到达轮次</span><span></span></div>${requests
        .map(
          (r, n) =>
            `<div class="request-editor-row" data-row="${r.id}"><b>${r.id}</b>${[
              ['prompt', 1, 32, '输入长度'],
              ['max', 1, 16, '输出上限'],
              ['arrival', 0, 12, '到达轮次'],
            ]
              .map(
                ([key, min, max, label]) =>
                  `<input type="number" data-request="${n}" data-field="${key}" min="${min}" max="${max}" value="${r[key]}" aria-label="请求 ${r.id} ${label}">`,
              )
              .join(
                '',
              )}<button data-remove-request="${n}" aria-label="删除请求 ${r.id}" ${requests.length === 1 ? 'disabled' : ''}>×</button></div>`,
        )
        .join(
          '',
        )}<button class="quiet-button" data-action="add-request" ${requests.length === 6 ? 'disabled' : ''}>＋ 添加请求</button></div>`
    );
  }
  if (lesson.id === 'prefix')
    return (
      range(o, 'prefix', '相同前缀 token', 0, 12) +
      toggle(o, 'salt', '使用不同 cache salt') +
      toggle(o, 'prefixEnabled', '启用前缀缓存')
    );
  if (lesson.id === 'speculative')
    return (
      range(o, 'drafts', '草稿 token 数', 1, 6) +
      range(o, 'quality', '草稿分布接近目标的程度', 0, 100, 10) +
      `<label class="setting"><span>随机种子</span><input type="number" data-param="seed" min="1" max="9999" value="${o.seed}" aria-label="随机种子"></label>`
    );
  if (lesson.id === 'pp')
    return (
      range(o, 'ranks', '流水线段数', 2, 4) + range(o, 'microbatches', '独立 microbatch 数', 1, 6)
    );
  return null;
}

function stateDiff(frame) {
  if (!frame.requests) return '';
  const rows = frame.requests.map((r) => {
    const before = frame.before?.find((b) => b.id === r.id);
    const transition = (a, b) =>
      `${esc(a ?? '—')} <span class="delta-arrow">→</span> <b>${esc(b)}</b>`;
    return [
      r.id,
      transition(before?.computed, r.computed),
      transition(before?.output, r.output ?? '—'),
      transition(before?.blocks?.join(',') || '∅', r.blocks.join(',') || '∅'),
    ];
  });
  return `<section class="state-inspector"><h3>这一轮改变了什么</h3>${table(['请求', '已计算 KV 位置', '已生成 token', '持有的物理块'], rows, '执行前后状态')}<p class="scene-footnote">左侧是执行前，右侧是执行后；调度图中的物理块池展示执行期间占用，完成后释放反映在此表中。</p></section>`;
}

function schedulerView(frame, frames, o) {
  const owners = new Map(frame.blocksDuring.flatMap((r) => r.blocks.map((id) => [id, r.id])));
  return `<div class="scene-caption"><span>第 ${frame.tick + 1} 轮 · ${frame.requests.length} 个请求</span><span>P 新 prompt · D 新 decode · R 重算历史 KV</span></div>
    <div class="request-lanes">${frame.requests.map((r) => `<div class="request-lane"><div class="request-label"><b class="req-${r.id}">${r.id}</b><span>${r.status}</span></div><div class="request-track">${Array.from({ length: r.prompt }, (_, n) => token(n, n < r.computed ? 'prompt computed' : 'prompt')).join('')}<span class="phase-break">→</span>${Array.from({ length: r.max }, (_, n) => token(n + 1, n < r.output ? 'generated' : 'pending')).join('')}</div><span class="lane-number">${r.output}/${r.max}</span></div>`).join('')}</div>
    <div class="batch-tokens">${frame.allocations.map((a) => `<div class="batch-card req-${a.id}"><b>${a.id}</b><span>${a.phase} · 位置 ${a.from}…${a.to - 1}</span><strong>${a.count} tokens</strong><small>P${a.prefill} / D${a.decode} / R${a.recompute}</small></div>`).join('') || '<p>本轮没有计算，等待资源或请求到达。</p>'}</div>
    <h3 class="diagram-label">执行期间的 KV 物理块池</h3><div class="block-pool">${Array.from({ length: o.capacity }, (_, id) => `<div class="physical-block ${owners.has(id) ? 'allocated' : ''}"><b>#${id}</b><span>${owners.get(id) || '空闲'}</span></div>`).join('')}</div>
    <div class="timeline-grid"><div class="timeline-head"><span>批次时间线</span><span>点击轮次回看</span></div><div class="timeline-scroll"><table aria-label="请求调度时间线"><thead><tr><th>请求</th>${frames.map((f, i) => `<th><button data-step="${i}" class="${i === frame.tick ? 'current' : ''}">${i + 1}</button></th>`).join('')}</tr></thead><tbody>${frame.requests
      .map(
        (r) =>
          `<tr><th>${r.id}</th>${frames
            .map((f, i) => {
              const a = f.allocations.find((a) => a.id === r.id);
              return `<td><button data-step="${i}" class="timeline-cell ${a ? 'filled req-' + r.id : ''} ${i === frame.tick ? 'current' : ''}" aria-label="第 ${i + 1} 轮请求 ${r.id}">${a ? [a.prefill ? 'P' + a.prefill : '', a.decode ? 'D' + a.decode : '', a.recompute ? 'R' + a.recompute : ''].filter(Boolean).join('+') : '·'}</button></td>`;
            })
            .join('')}</tr>`,
      )
      .join('')}</tbody></table></div></div>
    <div class="metrics-row">${metric(frame.used + '/' + o.budget, '本轮计算 token')}${metric(frame.usedDuring + '/' + o.capacity, '执行期间占用块')}${metric(
      frame.allocations.reduce((n, a) => n + a.recompute, 0),
      '本轮重算 token',
    )}</div>
    ${frame.blocked ? '<div class="notice warning">此配置无法继续完成。请增加 KV 容量、提高预算或启用切块。对照指标中的“停滞”表示未完成，不能作为更快的结果。</div>' : ''}`;
}

function cacheView(lesson, f, index, o) {
  return `<div class="scene-caption"><span>逻辑块 → 物理块 → 引用计数</span><span>每块 4 个 token · 状态来自同一执行记录</span></div><div class="cache-layout"><div class="logical-side">${f.requests
    .map(
      (r) =>
        `<p class="eyebrow">请求 ${r.id} · ${r.status}</p><div class="block-row">${[0, 1, 2]
          .map((n) => {
            const id = r.blocks[n],
              physical = f.physical.find((p) => p.id === id),
              shared = physical?.refs > 1;
            return `<div class="logical-block ${shared ? 'shared' : ''}"><span>逻辑块 ${n}</span><div>${[0, 1, 2, 3].map((v) => token(n * 4 + v, n * 4 + v < r.computed ? 'generated' : 'pending')).join('')}</div><b>${id === undefined ? '未分配' : '↓ #' + id}</b><small>${shared ? '命中 / 共享' : physical?.state || '无引用'}</small></div>`;
          })
          .join('')}</div>`,
    )
    .join(
      '',
    )}</div><div class="physical-side"><p class="eyebrow">GPU 物理块池</p><div class="physical-grid">${f.physical.map((p) => `<div class="physical-block ${p.refs ? 'allocated' : ''} ${p.refs > 1 ? 'shared' : ''}"><b>#${p.id}</b><span>${p.owners.join(' + ') || p.state}</span><small>ref ${p.refs}${p.cached ? ' · hash' : ''}</small></div>`).join('')}</div></div></div>
  ${lesson.id === 'prefix' ? `<div class="metrics-row">${metric(f.hit, 'B 命中 token')}${metric(f.computed, 'B 已执行尾部 token')}${metric(f.remaining, 'B 还需计算 token')}</div>` : '<div class="formula">token 6 → 逻辑块 ⌊6/4⌋ = 1 → 物理块 5<br>槽位 = 5 × 4 + 2 = 22</div>'}`;
}

function grammarView(f) {
  return `<div class="scene-caption"><span>${esc(f.label)}</span><span>词法单元示例；真实后端约束 tokenizer ID</span></div><pre class="schema-block">${esc(JSON.stringify(f.schema, null, 2))}</pre><div class="formula">当前前缀：<code>${esc(f.prefix) || '∅'}</code></div><h3 class="diagram-label">这一状态的允许集合</h3><div class="grammar-candidates">${grammarVocabulary.map((word) => token(word, f.allowed.includes(word) ? 'generated' : 'discarded')).join('')}</div><p class="scene-footnote">绿色可选，划线项被屏蔽。示例词表仅提供两个字符串值；完整 Schema 允许其他字符串。每次接受一个词法单元后重新计算允许集合。</p>`;
}

function speculativeView(f, index, o) {
  return `<div class="scene-caption"><span>可复现的拒绝采样 · seed ${o.seed}</span><span>p / q 为示例分布，不调用模型</span></div><div class="spec-lane"><label>草稿候选</label><div>${f.candidates.map((c, n) => token(c.word, index < 2 ? 'draft' : n < f.accepted ? 'generated' : n === f.accepted ? 'rejected' : 'discarded')).join('')}</div></div>
    ${
      index >= 1
        ? table(
            ['位置 / 候选', 'q(候选)', 'p(候选)', 'min(1,p/q)', '随机数 u', '决策'],
            f.candidates.map((c, n) => [
              `${c.position} / ${c.word}`,
              c.q[c.candidate].toFixed(3),
              c.p[c.candidate].toFixed(3),
              c.probability.toFixed(3),
              index >= 2 ? c.u.toFixed(3) : '待验证',
              index >= 2 ? c.state : '待验证',
            ]),
            '拒绝采样计算',
          )
        : ''
    }
    ${index >= 3 ? `<div class="formula">${f.rejected < 0 ? 'Bonus 目标分布' : '恢复分布 normalize(max(p − q, 0))'}<br>${f.vocabulary.map((w, n) => `${w}: ${f.recovery[n].toFixed(3)}`).join(' · ')} → ${f.extra}</div>` : ''}
    <div class="spec-result"><span class="eyebrow">提交输出</span><div>${index >= 4 ? f.committed.map((w, n) => token(w, n === f.committed.length - 1 ? 'bonus' : 'generated')).join('') : '等待接受与恢复计算完成'}</div></div>
    <div class="metrics-row">${metric(o.drafts, '草稿长度')}${metric(index >= 2 ? f.accepted : '—', '连续接受数')}${metric(index >= 4 ? f.committed.length : '—', '本轮提交 token')}</div>
    <p class="scene-footnote">对本次提交的 ${f.committed.length} 个 token：普通自回归需要 ${f.committed.length} 次顺序目标前向；示例投机需要 1 次批量验证，还需草稿生成与更大的验证计算。调用次数不能直接换算成加速比。</p>`;
}

function tensorView(f, index) {
  return `<div class="scene-caption"><span>行并行线性层 · y = x Wᵀ</span><span>x[1,12] · W[2,12] · y[1,2]</span></div><div class="device-grid" style="--ranks:${f.shards.length}">${f.shards.map((s) => `<div class="device active"><span>GPU ${s.rank}</span><div class="device-core">W[:, ${s.from}:${s.to}]<br>${s.weights.map((row) => `[${row}]`).join('<br>')}</div><div class="device-token">xᵣ = [${s.input}]<br>${index >= 1 ? `局部结果 [${s.partial}]` : '等待乘法'}</div></div>`).join('')}</div><div class="communication ${index >= 2 ? 'on' : ''}"><span>All-reduce · SUM</span><div>${f.shards.map(() => '<i></i>').join('')}</div></div><div class="formula">${index >= 2 ? f.shards.map((s) => `[${s.partial}]`).join(' + ') + ` = [${f.output}]` : '局部乘法之后才能对部分和执行归并'}</div>`;
}

function pipelineView(f, frames) {
  return `<div class="scene-caption"><span>流水线逻辑时隙 ${f.tick + 1}</span><span>假定各段等时；microbatch 之间独立</span></div><div class="device-grid" style="--ranks:${f.ranks}">${f.stages.map((s) => `<div class="device ${s.batch === null ? '' : 'active'}"><span>GPU ${s.rank}</span><div class="device-core">层 ${s.rank * 8}–${s.rank * 8 + 7}</div><div class="device-token">${s.batch === null ? '空泡 / 等待' : '执行 M' + s.batch}</div></div>`).join('')}</div>${table(
    ['阶段', ...frames.map((_, n) => '时隙 ' + (n + 1))],
    f.stages.map((s) => [
      'GPU ' + s.rank,
      ...frames.map(
        (frame, n) =>
          `<button class="pipeline-cell ${n === f.tick ? 'current' : ''}" data-step="${n}">${frame.stages[s.rank].batch === null ? '·' : 'M' + frame.stages[s.rank].batch}</button>`,
      ),
    ]),
    '流水线时序',
  )}<div class="metrics-row">${metric(f.completed + '/' + f.batches, '已完成 microbatch')}${metric(f.ranks * f.batches, '逐个串行的时隙')}${metric(frames.length, '填满再排空的时隙')}</div><p class="scene-footnote">数值比较仅描述这个等时教学模型的依赖关系，不代表 vLLM 实际设备耗时，也不表示自回归 token 可任意并行。</p>`;
}

function moeView(f, index) {
  return `<div class="scene-caption"><span>4 个 token · 4 个专家 · Top-2 路由</span><span>专家 e 放在 GPU (e mod ${f.ranks})</span></div>${table(
    ['Token / 起点', '选中专家与归一化权重', 'Dispatch → 计算 → Combine'],
    f.tokens.map((t) => [
      `T${t.id} / GPU ${t.origin}<br>x = ${t.input}`,
      t.routes.map((r) => `E${r.expert} × ${r.weight.toFixed(3)}`).join('<br>'),
      index === 0
        ? '等待分发'
        : t.routes
            .map(
              (r) =>
                `GPU ${t.origin} → GPU ${r.rank} / E${r.expert}${index >= 2 ? ' → ' + r.value : ''}`,
            )
            .join('<br>'),
    ]),
    '专家路由',
  )}<div class="device-grid" style="--ranks:${f.ranks}">${Array.from(
    { length: f.ranks },
    (_, rank) =>
      `<div class="device ${index >= 1 ? 'active' : ''}"><span>GPU ${rank}</span><div class="device-core">${
        [0, 1, 2, 3]
          .filter((e) => e % f.ranks === rank)
          .map((e) => '专家 ' + e)
          .join(' / ') || '无专家'
      }</div><div class="device-token">${index >= 1 ? f.tokens.flatMap((t) => t.routes.filter((r) => r.rank === rank).map((r) => `T${t.id}→E${r.expert}`)).join(' · ') : '等待 dispatch'}</div></div>`,
  ).join(
    '',
  )}</div>${index >= 3 ? `<div class="formula">${f.tokens.map((t) => `T${t.id}: ${t.routes.map((r) => `${r.weight.toFixed(3)} × ${r.value}`).join(' + ')} = ${t.output.toFixed(3)}`).join('<br>')}</div>` : ''}<p class="scene-footnote">示例专家 fₑ(x)=(e+1)x；真实模型使用专家网络。跨卡 dispatch 与 combine 需要通信，同卡分支只需要本地搬运。</p>`;
}

export function experimentScene(lesson, index, o, frames) {
  const f = frames[index];
  let visual = '';
  if (lesson.kind === 'scheduler') visual = schedulerView(f, frames, o);
  else if (lesson.kind === 'cache' || lesson.kind === 'prefix')
    visual = cacheView(lesson, f, index, o);
  else if (lesson.id === 'structured') visual = grammarView(f);
  else if (lesson.id === 'speculative') visual = speculativeView(f, index, o);
  else if (lesson.id === 'tp') visual = tensorView(f, index);
  else if (lesson.id === 'pp') visual = pipelineView(f, frames);
  else if (lesson.id === 'moe') visual = moeView(f, index);
  return (
    visual +
    stateDiff(f) +
    `<div class="state-strip"><span>本步事件</span><code>${esc(f.events.join(' '))}</code></div>`
  );
}

export function comparisonView(lesson, comparison, frames, o) {
  if (lesson.kind === 'scheduler')
    return `<section class="comparison-panel"><h3>同一工作负载，开关切块会怎样？</h3>${table(
      ['配置', '完成', '逻辑轮次', '计算 token', '重算 token', '峰值 KV 块'],
      comparison.map((m) => [
        m.label,
        `${m.finished}/${m.total}${m.blocked ? ' · 停滞' : ''}`,
        m.rounds,
        m.computed,
        m.recomputed,
        m.peak,
      ]),
      '同工作负载对照',
    )}<p>两组均使用上方请求、预算与块容量。停滞组尚未完成，计算量不能直接与完成组比较。</p></section>`;
  if (lesson.id === 'prefix') {
    const r = frames.at(-1).result;
    return `<section class="comparison-panel"><h3>同样的 A、B 请求，缓存节省了多少计算？</h3>${table(
      ['配置', 'A 计算 token', 'B 计算 token', '总计算 token', '同时持有的物理块'],
      [
        ['关闭缓存', 12, 12, 24, 6],
        ['当前缓存设置', 12, r.computed, 12 + r.computed, 6 - r.blocks],
      ],
      '前缀缓存对照',
    )}<p>只统计这两个 12-token prompt 的 prefill；decode 与缓存查找开销未计入。</p></section>`;
  }
  return '';
}
