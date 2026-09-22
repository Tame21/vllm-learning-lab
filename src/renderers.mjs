import { experimentControls, experimentScene } from './experiment-view.mjs';
import { executableIds, buildTrace } from './engine.mjs';
import { sampleDistribution, quantize, stageFor } from './simulations.mjs';
import { esc, metric, token } from './html.mjs';
import { specMethodScene } from './spec-method-view.mjs';
export { esc, metric };
export function controls(lesson, o) {
  const enhanced = experimentControls(lesson, o);
  if (enhanced !== null) return enhanced;
  const range = (key, label, min, max, step = 1, suffix = '') =>
    `<label class="setting"><span>${label}<b>${o[key]}${suffix}</b></span><input type="range" data-param="${key}" min="${min}" max="${max}" step="${step}" value="${o[key]}" aria-label="${label}"></label>`;
  if (lesson.kind === 'sampling')
    return range('temperature', 'Temperature', 0, 2, 0.1) + range('topP', 'Top-p', 0.1, 1, 0.05);
  if (lesson.kind === 'quant')
    return `<label class="setting"><span>教学量化精度</span><select data-param="bits" aria-label="教学量化精度"><option value="8" ${o.bits === 8 ? 'selected' : ''}>INT8 · 8 bit</option><option value="4" ${o.bits === 4 ? 'selected' : ''}>INT4 · 4 bit</option></select></label>`;
  if (lesson.kind === 'parallel') return range('ranks', '参与设备数', 2, 4, 1);
  return `<div class="setting-note"><span class="small-icon">↳</span>点击节点可以跳转；用下方时间轴观察每一步。</div>`;
}
export function scene(lesson, index, o, frames) {
  if (executableIds.includes(lesson.id)) {
    const trace = frames?.[0]?.stepIndex !== undefined ? frames : buildTrace(lesson, o);
    return experimentScene(lesson, index, o, trace);
  }
  let visual = '';
  if (lesson.kind === 'spec-method') visual = specMethodScene(lesson, index);
  else if (lesson.kind === 'attention') visual = attention(index);
  else if (lesson.kind === 'sampling') visual = sampling(index, o);
  else if (lesson.kind === 'quant') visual = quant(index, o);
  else if (lesson.kind === 'parallel') visual = parallel(lesson, index, o);
  else if (lesson.kind === 'graph') visual = graph(index);
  else if (lesson.kind === 'lora') visual = lora(index);
  else if (lesson.kind === 'multimodal') visual = multimodal(index);
  else if (lesson.kind === 'transfer') visual = transfer(lesson, index);
  else visual = flow(lesson, index);
  return `${visual}<div class="state-strip"><span>状态变化</span><code>${esc(stageFor(lesson, index, o).change)}</code></div>`;
}
function flow(l, i) {
  return `<div class="flow-scene"><div class="scene-caption"><span>执行路径</span><span>按逻辑顺序展示 · 异步步骤可能重叠</span></div><div class="flow-nodes">${l.steps.map((s, n) => `<button class="flow-node ${n === i ? 'active' : n < i ? 'visited' : ''}" data-step="${n}"><span class="node-number">${String(n + 1).padStart(2, '0')}</span><strong>${esc(s.title)}</strong><small>${esc(s.change)}</small></button>`).join('')}</div><div class="data-packet"><div class="packet-label">${esc(l.english)} / ${String(i + 1).padStart(2, '0')}</div><strong>${esc(l.steps[i].title)}</strong><p>${esc(l.steps[i].body)}</p><div class="packet-track">${l.steps.map((_, n) => `<span class="${n <= i ? 'on' : ''}"></span>`).join('')}</div></div></div>`;
}
function attention(i) {
  const n = i >= 3 ? 9 : 8;
  return `<div class="scene-caption"><span>因果 Attention 矩阵</span><span>亮色位置可被读取 · 灰色是未来位置</span></div><div class="attention-layout"><div class="matrix">${Array.from(
    { length: n * n },
    (_, k) => {
      const row = Math.floor(k / n),
        col = k % n;
      return `<span style="--cells:${n}" class="matrix-cell ${col <= row && i >= 1 ? 'visible' : ''} ${i >= 3 && row === n - 1 ? 'new-row' : ''}" title="query ${row} → key ${col}"></span>`;
    },
  ).join(
    '',
  )}</div><div class="matrix-explain"><span class="eyebrow">${i < 3 ? 'PREFILL' : 'DECODE'}</span><h3>${i < 3 ? '多位置一起计算' : '新 query 读取历史 KV'}</h3><p>${i < 3 ? '每行是一个 query，每列是一个 key。因果掩码阻止当前位置看到未来 token。' : '最后一行是新 token。此前的 K、V 直接从缓存读取，不必重算所有历史位置。'}</p><div class="legend"><span><i class="green"></i>允许注意力</span><span><i></i>不可见位置</span></div></div></div>`;
}
function sampling(i, o) {
  const p = sampleDistribution(o.temperature, o.topP);
  return `<div class="scene-caption"><span>固定示例 logits → 概率分布</span><span>调整温度与 top-p，比较保留的候选</span></div><div class="prob-chart">${p.map((v) => `<div class="prob-row ${i >= 2 && !v.kept ? 'excluded' : ''}"><b>${v.word}</b><div><i style="width:${(i >= 2 ? v.prob : v.raw) * 100}%"></i></div><strong>${((i >= 2 ? v.prob : v.raw) * 100).toFixed(1)}%</strong><small>${i >= 2 ? (v.kept ? '保留' : '截断') : 'softmax'}</small></div>`).join('')}</div><div class="formula">${o.temperature === 0 ? 'temperature = 0 → 贪心选择最高分 token' : 'softmax(logits / temperature) → top-p 截断 → 重新归一化'}</div><p class="scene-footnote">概率只来自页面内的 5 个示例 logits。未调用语言模型；不包含全部 penalty 和 logits processor。</p>`;
}
function quant(i, o) {
  const q = quantize(o.bits);
  return `<div class="scene-caption"><span>对称整数权重量化教学示例</span><span>并非 FP8、AWQ 或 GPTQ 的完整算法</span></div><div class="quant-grid"><div><span class="eyebrow">原始 FP 权重</span>${q.values.map((v) => `<b>${v.value.toFixed(2)}</b>`).join('')}</div><span class="quant-arrow">→</span><div><span class="eyebrow">INT${o.bits} / scale ${q.scale.toFixed(4)}</span>${q.values.map((v) => `<b class="${i >= 1 ? 'green-cell' : ''}">${i >= 1 ? v.q : '·'}</b>`).join('')}</div><span class="quant-arrow">→</span><div><span class="eyebrow">重建近似值</span>${q.values.map((v) => `<b>${i >= 2 ? v.restored.toFixed(3) : '·'}</b>`).join('')}</div></div><div class="metrics-row">${metric(o.bits, '每个整数权重的 bit')}${metric(q.values.reduce((a, v) => a + v.error, 0) / 8 === 0 ? '0' : (q.values.reduce((a, v) => a + v.error, 0) / 8).toFixed(4), '平均绝对误差')}${metric(16 / o.bits + '×', '仅权重位宽比例', '不含 scales / 元数据 / 激活')}</div>`;
}
function parallel(l, i, o) {
  const tp = l.id === 'tp',
    pp = l.id === 'pp',
    ep = ['moe', 'eplb', 'elastic'].includes(l.id);
  return `<div class="scene-caption"><span>${esc(l.title)} · ${o.ranks} 个示意设备</span><span>展示数据归属与通信；不是性能模型</span></div><div class="device-grid" style="--ranks:${o.ranks}">${Array.from({ length: o.ranks }, (_, n) => `<div class="device ${i > 0 ? 'active' : ''}"><span>GPU ${n}</span><div class="device-core">${tp ? `权重切片 ${n}` : pp ? `模型层 ${n * 8}–${n * 8 + 7}` : ep ? `专家 ${n * 2} / ${n * 2 + 1}` : l.id === 'cp' ? `上下文片段 ${n}` : `模型副本 ${n}`}</div><div class="device-token">${i > 0 ? `${ep ? '路由 token' : pp ? 'microbatch' : tp ? '同一输入' : '请求'} ${n + 1}` : '等待输入'}</div></div>`).join('')}</div><div class="communication ${i >= 2 ? 'on' : ''}"><span>${tp ? 'All-reduce / All-gather' : pp ? 'Send → Receive' : ep ? 'All-to-all dispatch / combine' : l.id === 'cp' ? 'KV / Attention 中间结果通信' : '请求分发与协调'}</span><div>${Array.from({ length: o.ranks }, () => '<i></i>').join('')}</div></div><div class="formula">${esc(l.steps[i].change)}</div>`;
}
function graph(i) {
  return `<div class="scene-caption"><span>CPU 提交与 GPU 执行</span><span>示意时间轴，不代表真实耗时</span></div><div class="graph-lane"><b>普通执行</b><div>${['launch', 'kernel A', 'launch', 'kernel B', 'launch', 'kernel C'].map((v, n) => `<span class="${n % 2 ? 'gpu' : 'cpu'}">${v}</span>`).join('')}</div></div><div class="graph-lane"><b>${i < 2 ? '图捕获' : '图回放'}</b><div>${i < 2 ? '<span class="cpu">warmup</span><span class="gpu long">capture A → B → C</span>' : '<span class="cpu">replay</span><span class="gpu long">A → B → C</span>'}</div></div><div class="formula">CUDA Graph 减少重复提交开销；kernel 计算仍然执行。<br>形状、地址、后端与运行模式约束决定是否能回放。</div>`;
}
function lora(i) {
  return `<div class="scene-caption"><span>共享基础权重 · 请求选择适配器</span><span>示例低秩矩阵形状</span></div><div class="lora-equation"><div><b>W</b><small>基础权重 · 冻结</small></div><strong>+</strong><div class="adapter ${i >= 1 ? 'active' : ''}"><b>B × A</b><small>低秩增量 · adapter 1</small></div><strong>→</strong><div><b>y</b><small>Wx + scale · BAx</small></div></div><div class="adapter-requests">${['A → adapter 1', 'B → adapter 2', 'C → base model'].map((v) => `<span>${v}</span>`).join('')}</div><p class="scene-footnote">在线推理通常按请求应用低秩分支；不同适配器可共用基础模型，但受 rank、并发数及后端支持限制。</p>`;
}
function multimodal(i) {
  return `<div class="scene-caption"><span>多模态输入 → 统一的模型输入</span><span>尺寸、占位符数与位置编码由模型决定</span></div><div class="modality-inputs"><div><b>文字</b><span>“图片里有什么？”</span></div><div><b>图像 / 视频</b><span>pixels / frames</span></div><div><b>音频</b><span>waveform / features</span></div></div><div class="modality-bridge">↓ ${i >= 1 ? 'processor → encoder → projector' : '等待处理'} ↓</div><div class="embedding-row">${Array.from({ length: 12 }, (_, n) => `<span class="${i >= 2 ? (n < 4 ? 'text-embedding' : 'media-embedding') : ''}">${i >= 2 ? (n < 4 ? 'T' : 'E') : '·'}</span>`).join('')}</div><div class="formula">${i >= 3 ? '文本 embedding 与媒体 embedding 合并 → 模型前向' : '媒体编码结果在对应占位符位置进入模型'}</div>`;
}
function transfer(l, i) {
  return `<div class="scene-caption"><span>${esc(l.title)}</span><span>箭头表示数据或状态交接</span></div><div class="transfer-lanes"><div class="transfer-machine"><span>${l.id === 'offload' ? 'GPU 缓存' : '生产侧 / Prefill'}</span><b>${i >= 1 ? 'KV blocks' : '请求输入'}</b><div>${[0, 1, 2].map((n) => token('B' + n, i >= 1 ? 'generated' : '')).join('')}</div></div><div class="transfer-pipe ${i === 2 ? 'moving' : ''}"><strong>→</strong><span>${i >= 2 ? '传输 + 完成通知' : '准备 connector'}</span></div><div class="transfer-machine"><span>${l.id === 'offload' ? 'CPU / 外部层' : '消费侧 / Decode'}</span><b>${i >= 3 ? '数据就绪' : '等待数据'}</b><div>${[0, 1, 2].map((n) => token(i >= 3 ? 'B' + n : '·', i >= 3 ? 'generated' : '')).join('')}</div></div></div><div class="formula">${esc(l.steps[i].change)}</div>`;
}
