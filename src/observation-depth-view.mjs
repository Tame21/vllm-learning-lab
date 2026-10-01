import { esc, table } from './html.mjs';

export function depthView(id, f) {
  if (['scheduler', 'chunked'].includes(id) && f.phase)
    return `<div class="depth-phases" aria-label="调度微事件">${[['queue','准入'],['allocate','分配'],['compute','执行'],['sample','采样'],['finish','释放'],['round-end','轮次结算']].map(([phase,label]) => `<span class="${f.phase === phase || (phase === 'compute' && f.phase === 'recompute') ? 'current' : ''}">${label}</span>`).join('')}</div>`;
  if (id === 'paged' && f.address) {
    const a = f.address;
    return `<div class="depth-address" aria-label="当前 KV 地址"><b>${a.operation} token ${a.position}</b><span>逻辑块 ${a.logical}</span><span>→ 物理块 ${a.physical}</span><span>→ offset ${a.offset}</span><strong>→ slot ${a.slot}</strong></div>`;
  }
  if (id === 'prefix' && f.lookups)
    return table(['逻辑块', '教学链式 hash 键', '查询结果'], f.lookups.map((r) => [r.logical, esc(r.key), r.hit ? '命中 #' + r.physical : esc(r.reason)]), '前缀整块查找') + `<p class="scene-footnote">键名展示 parent / token / salt 依赖，不模拟生产 hash 算法。末尾 logits：${f.logitsReady ? '已计算' : '尚未计算'}。</p>`;
  if (id === 'tp' && f.partialNow)
    return table(['Rank', '已累加列', '局部部分和', '已进入归并'], f.shards.map((s) => [s.rank, `${f.progress[s.rank]}/${s.input.length}`, `[${f.partialNow[s.rank]}]`, f.reducedRanks.includes(s.rank) ? '是' : '否']), '逐列局部乘法') + `<div class="depth-address">归并累计 [${f.reduction}]</div>`;
  if (id === 'pp' && f.pipelinePhase)
    return `<div class="depth-phases" aria-label="流水线阶段">${['填充','稳态','排空'].map((phase) => `<span class="${f.pipelinePhase === phase ? 'current' : ''}">${phase}</span>`).join('')}</div><p class="scene-footnote">${f.hasSteady ? 'microbatch 足够形成稳态。' : 'microbatch 少于段数，本次没有满流水线稳态。'}${f.handoffs.map((h) => `M${h.batch}：时隙 ${h.completedAt + 1} 完成 GPU ${h.from}，本时隙进入 GPU ${h.to}。`).join(' ')}</p>`;
  if (id === 'moe' && f.routeProgress)
    return table(['Token', '原 Rank', '当前状态', '返回原 Rank 的加权结果'], f.tokens.map((t) => { const p = f.routeProgress.find((r) => r.token === t.id); return [`T${t.id}`, t.origin, p?.phase === 'combined' ? '已返回' : p?.phase === 'compute' ? '专家已计算' : p ? '已分发' : '等待分发', p?.phase === 'combined' ? t.output.toFixed(4) : '等待 combine']; }), 'Token 路由身份');
  if (id === 'structured' && f.grammarState)
    return `<div class="depth-address"><b>语法状态 ${esc(f.grammarState)}</b><span>允许 ${f.allowed.length} 项</span><span>排除 ${f.excluded.length} 项</span></div>`;
  return '';
}

export function synchronousScheduleView(comparison, currentRound) {
  const total = Math.max(...comparison.map((m) => m.roundsTrace.length));
  return table(['逻辑轮次', ...comparison.map((m) => m.label)], Array.from({ length: total }, (_, tick) => [tick + 1, ...comparison.map((m) => {
    const f = m.roundsTrace[tick];
    const prior = m.roundsTrace.at(-1);
    const text = f ? f.blocked ? '停滞 · 未完成' : f.allocations.map((a) => `${a.id}:${a.phase} ${a.count}`).join(' · ') || '等待到达' : prior.blocked ? '停滞 · 未完成' : '已完成';
    return `<span class="${tick === currentRound ? 'depth-current' : ''}">${esc(text)}</span>`;
  })]), '切块同步轮次对照');
}
