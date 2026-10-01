import { esc, metric } from './html.mjs';
const caption = (title, detail) => `<div class="scene-caption"><span>${esc(title)}</span><span>${esc(detail)}</span></div>`;

function graphView(f, o) {
  return caption(f.status, '捕获准备与本次运行分开计数') +
    `<h3>已配置的捕获大小</h3><div class="device-graph-buckets">${f.sizes.map((size) => `<div data-visual-key="graph-bucket-${size}" class="${f.captured.includes(size) ? 'captured' : ''} ${f.matched === size ? 'matched' : ''} ${f.activeSize === size ? 'current' : ''}"><b>batch ${size}</b><span>${f.captured.includes(size) ? 'A → B → C 已记录' : o.graphEnabled ? '等待捕获' : '未启用'}</span></div>`).join('')}</div>
    <div class="device-graph-input"><b>运行时输入 · ${o.graphBatch}</b><div>${Array.from({ length: o.graphBatch + f.padding }, (_, i) => `<span class="${i >= o.graphBatch ? 'padding' : ''}" data-visual-key="graph-input-${i}">${i >= o.graphBatch ? 'pad' : i + 1}</span>`).join('')}</div></div>
    <div class="device-graph-choice"><b>${f.mode}</b><span>${esc(f.reason || '先预热，再捕获，最后为运行时批次选择路径。')}</span></div>
    <h3>本次运行的设备工作</h3><div class="device-kernel-lane">${['A', 'B', 'C'].map((name) => `<div data-visual-key="kernel-${name}" class="${f.executed.includes(name) ? 'executed' : ''}"><small>${f.mode === 'Graph Replay' ? '一次 replay 内的依赖' : 'CPU 单独 launch'}</small><b>kernel ${name}</b><span>${f.executed.includes(name) ? '已执行' : '待执行'}</span></div>`).join('')}</div>
    <div class="metrics-row">${metric(f.cpuSubmissions, '本次 CPU 提交')}${metric(f.gpuKernels, '本次 GPU kernel')}${metric(f.captureKernels, '准备期捕获 kernel')}${metric(f.padding, '补齐位置')}</div>
    <p class="scene-footnote">示例只研究 full graph 的稳定输入与大小选择。真实 dispatcher 还考虑模式、后端和多种 batch 描述；生产 Runner 可通过稳定缓冲区复制输入。地址变化时的 Eager 是本观察窗的安全演示分支，不表示 vLLM 会自动修复任意错误地址。提交次数不能换算成 GPU 性能。</p>`;
}

function offloadView(f, o) {
  return caption(`访问 ${f.round || '准备'} · ${f.status}`, `教学传输时间 ${f.time} 个时隙`) +
    `<div class="device-access-sequence"><b>访问序列</b>${f.accesses.map((id, i) => `<span class="${i + 1 === f.round ? 'current' : i < f.reads.length ? 'done' : ''}">${id}</span>`).join('')}</div>
    <div class="service-columns"><section><h3>GPU 槽 · 内容必须有效才能读</h3><div class="device-tier gpu">${Array.from({ length: o.offloadCapacity }, (_, slot) => {
      const block = f.gpu.find((b) => b.slot === slot), loading = f.pending?.direction === 'load' && f.pending.slot === slot;
      return `<div data-visual-key="offload-gpu-${slot}" class="${block ? 'ready' : loading ? 'loading' : ''}"><small>物理槽 ${slot}</small><b>${block ? `KV ${block.id}` : loading ? `KV ${f.pending.id}` : '空闲'}</b><span>${block ? `H${block.id} / g0 · 有效` : loading ? '传输中 · 禁止读取' : '可分配'}</span></div>`;
    }).join('')}</div></section><section><h3>CPU 副本 · 以缓存键查找</h3><div class="device-tier cpu">${f.cpu.map((block) => `<div data-visual-key="offload-cpu-${block.id}" class="${block.valid ? 'ready' : ''} ${f.pending?.direction === 'store' && f.pending.id === block.id ? 'loading' : ''}"><small>H${block.id} / group 0</small><b>KV ${block.id}</b><span>${block.valid ? '有效副本' : '缺失'}</span></div>`).join('')}</div></section></div>
    <section><h3>外部缓存 · 容量 ${o.offloadExternalCapacity} 块</h3><div class="device-tier external">${f.external.map((b) => `<div data-visual-key="offload-external-${b.id}" class="${b.valid ? 'ready' : ''}"><small>H${b.id} / group 0</small><b>KV ${b.id}</b><span>${b.valid ? '有效副本' : '缺失'}</span></div>`).join('')}</div></section>
    <div class="device-transfer-state ${f.pending ? 'active' : ''}"><b>${f.pending ? `${f.pending.from} → ${f.pending.to} · KV ${f.pending.id}` : '没有在途传输'}</b><div><i style="width:${f.pending ? 100 * f.pending.progress / f.pending.duration : 0}%"></i></div><span>${f.pending ? `${f.pending.progress} / ${f.pending.duration} · 等待完成事件` : '后续读取只使用有效 GPU 副本'}</span></div>
    <div class="metrics-row">${metric(f.hits, 'GPU 命中')}${metric(f.loads, 'CPU 加载完成')}${metric(f.recomputes, '缺失后重算')}${metric(f.stores, 'CPU 备份完成')}${metric(f.restores, '外部回载完成')}${metric(f.evictions.length, '下层淘汰次数')}</div>
    <p class="scene-footnote">教学 LRU 分别管理 GPU / CPU / 外部容量，备份确认后释放源槽，回载确认后才消费。外部层是缓存契约示例，不代表所有 connector 提供三层组合。六个独立完整块均可重算，未模拟并发请求 pin、多缓存组、网络协议或带宽收益。物理槽变化不改变 H / group 缓存键。</p>`;
}

export const deviceMechanismView = (id, frame, options) => id === 'cudagraph' ? graphView(frame, options) : offloadView(frame, options);
