import { esc, metric, table, range, toggle } from './html.mjs';
import { algorithmCatalog } from './algorithm-catalog.mjs';
import { algorithmFamilies, algorithmParameters } from './algorithm-parameters.mjs';
import { mechanismControls, mechanismScene } from './mechanism-view.mjs';

const labels = {
  aT: '温度 T（0 为贪心）',
  aK: 'Top-k',
  aP: 'Top-p',
  aMin: 'Min-p 比例',
  aU: '接受判断的随机数 u',
  aRepeat: '重复惩罚 r',
  aFrequency: '频率惩罚 f',
  aPresence: '存在惩罚 h',
  aNgram: '最长匹配 n',
  aDraft: '草稿上限 K',
  aQuery: 'Query 位置（从 0 开始）',
  aChunk: '每块元素数',
  aPos: '位置 m',
  aEpsPower: 'ε = 10 的负几次方',
  aGain: '统一权重 γ',
  aOffset: '逻辑 token 位置',
  aTake: '申请物理块数',
  aScale: 'LoRA 增量比例 s',
  aExperts: '选择专家数 k',
  aReplica: '额外副本数',
  aSkew: '专家 0 负载倍数',
  aTokens: '有效 token 数',
  aNormalize: '启用 L2 归一化',
};
export const number = (v) => {
  if (Array.isArray(v)) return '[' + v.map(number).join(', ') + ']';
  if (typeof v !== 'number') return String(v ?? '');
  if (!Number.isFinite(v)) return v === -Infinity ? '−∞' : v === Infinity ? '∞' : '无效数值';
  if (v !== 0 && Math.abs(v) < 0.0001) return v.toExponential(2);
  return Number(v.toFixed(4)).toString();
};
const select = (o, key, label, choices) =>
  `<label class="setting"><span>${esc(label)}</span><select data-param="${key}" aria-label="${esc(label)}">${choices.map(([value, title]) => `<option value="${value}" ${o[key] === value ? 'selected' : ''}>${esc(title)}</option>`).join('')}</select></label>`;
export function algorithmControls(lesson, o) {
  if (lesson.slug === 'beam') return mechanismControls({ id: 'beam' }, o);
  if (lesson.slug === 'dynamic') return mechanismControls({ id: 'dynamic-spec' }, o);
  return (
    lesson.params
      .map((key) => {
        if (key === 'aPreset')
          return select(
            o,
            key,
            '输入案例',
            lesson.presets.map((s, i) => [i, s]),
          );
        if (key === 'aCandidate')
          return select(o, key, '观察候选 token', [
            [0, 'A'],
            [1, 'B'],
            [2, 'C'],
          ]);
        if (key === 'aPoolMode')
          return select(o, key, 'Pooling 规则', [
            [0, 'Mean · 均值'],
            [1, 'Last · 最后位置'],
            [2, 'CLS · 首位置'],
          ]);
        if (key === 'blockSize')
          return select(o, key, '每块 token 数', [
            [2, 2],
            [4, 4],
            [8, 8],
          ]);
        if (key === 'seed')
          return `<label class="setting"><span>随机种子</span><input type="number" min="1" max="9999" value="${o.seed}" data-param="seed" aria-label="随机种子"></label>`;
        const [initial, min, max, step] = algorithmParameters[key];
        return typeof initial === 'boolean'
          ? toggle(o, key, labels[key])
          : range(o, key, labels[key], min, max, step);
      })
      .join('') +
    '<p class="mechanism-control-note">先预测，再单步计算。修改输入会回到第一帧；实验链接保存当前参数与步骤。</p>'
  );
}

export const algorithmEntry = () =>
  `<section class="algorithm-entry"><div><span class="eyebrow">ALGORITHM STUDIO</span><h2>从公式到每一步计算</h2><p>24 个源码算法 · 概率采样、投机验证、模型计算、缓存与专家路由</p></div><button class="quiet-button" data-view="algorithms">打开算法专题 →</button></section>`;

export function algorithmCatalogView(query = '', study = {}) {
  const matches = algorithmCatalog.filter((l) =>
    `${l.title} ${l.summary} ${l.family} ${l.steps.map((s) => s.source.symbol).join(' ')}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return `<div class="lesson-heading"><div><div class="eyebrow">ALGORITHM STUDIO · 24 LABS</div><h1>算法，一步一步算明白</h1><p>先找到要学的算法，再沿着输入、公式、计算和源码验证。每章都有可改参数的观察窗与理解题。</p></div><span class="badge">${matches.length} / 24 个算法</span></div>
  <div class="algorithm-route"><b>推荐入门顺序</b><span>① 稳定 Softmax</span><span>② 接受 / 拒绝判断</span><span>③ 正残差恢复</span><span>④ 再按方向展开</span></div>
  <div class="algorithm-featured"><div><span class="eyebrow">从你的问题出发</span><h2>接受了多少，拒绝后又该补多少？</h2><p>把一次投机验证拆成两章：先计算 p/q 的接受阈值，再用 min(p,q) + max(p−q,0) = p 检查最终概率。</p></div><div><button data-lesson="alg-rejection">01 接受 / 拒绝采样 →</button><button data-lesson="alg-residual">02 正残差恢复与正确性 →</button></div></div>
  ${
    algorithmFamilies
      .map(([id, title, subtitle], group) => {
        const rows = matches.filter((l) => l.family === id);
        return rows.length
          ? `<section class="algorithm-family"><div class="section-heading"><div><span class="eyebrow">0${group + 1} · ${id.toUpperCase()}</span><h2>${title}</h2><p>${subtitle}</p></div><span>${rows.length} 个算法</span></div><div class="algorithm-cards">${rows.map((l) => `<button class="algorithm-card" data-lesson="${l.id}"><span class="algorithm-card-number">${String(algorithmCatalog.indexOf(l) + 1).padStart(2, '0')}</span><div><h3>${esc(l.title)}</h3><p>${esc(l.summary)}</p><small>${study.quiz?.[l.id]?.passed ? '✓ 理解题通过' : study.completed?.includes(l.id) ? '◐ 已读' : '输入案例 · 数值推演 · 源码'}</small></div><span aria-hidden="true">↗</span></button>`).join('')}</div></section>`
          : '';
      })
      .join('') || '<p class="empty">没有匹配的算法，试试在左侧搜索 Softmax、KMP、LoRA 或拒绝。</p>'
  }
  <p class="small-note">本目录整理当前源码中的 24 个核心算法与规则。每章标明选用的实现路径与简化范围；设备专用 kernel、模型变体与所有优化分支不逐一复现。</p>`;
}

export function algorithmIntro(lesson) {
  if (lesson.kind !== 'algorithm') {
    const related = algorithmCatalog.filter((row) => row.related.includes(lesson.id));
    return related.length
      ? `<div class="algorithm-related-entry"><span>继续拆解算法</span>${related.map((row) => `<button data-lesson="${row.id}">${esc(row.title)} ↗</button>`).join('')}</div>`
      : '';
  }
  return `<div class="algorithm-intro"><div><span class="eyebrow">这个算法解决什么</span><p>${esc(lesson.why)}</p></div><button class="quiet-button" data-view="algorithms">算法目录 ↗</button></div>`;
}
export function algorithmNotes(lesson, lessons) {
  if (!['algorithm', 'foundation'].includes(lesson.kind)) return '';
  const foundation = lesson.kind === 'foundation';
  const related = lesson.related.map((id) => lessons.find((l) => l.id === id)).filter(Boolean);
  return `<section class="algorithm-notes ${foundation ? 'foundation-notes' : ''}" aria-label="${foundation ? '基础知识详细讲解' : '算法详细讲解'}"><div class="section-heading"><div><span class="eyebrow">UNDERSTAND THE MATH</span><h2>对着数值读公式</h2></div><span>建议：先手算，再播放验证</span></div><div class="algorithm-reading-grid"><article><h3>符号先认清</h3>${table(
    ['符号', '意思'],
    lesson.symbols.map(([s, d]) => [`<code>${esc(s)}</code>`, esc(d)]),
    '公式符号说明',
  )}<h3>计算规则</h3><pre class="algorithm-formula">${esc(lesson.formula)}</pre></article><article><h3>带数算一遍</h3><p>${esc(lesson.worked)}</p><div class="algorithm-pitfall"><h3>容易误解的地方</h3><p>${esc(lesson.pitfall)}</p></div></article></div>${lesson.details ? `<div class="foundation-deep-reading">${lesson.details.map(([title, body, formula]) => `<article><h3>${esc(title)}</h3><p>${esc(body)}</p>${formula ? `<pre class="algorithm-formula">${esc(formula)}</pre>` : ''}</article>`).join('')}</div>` : ''}<div class="algorithm-reading-grid algorithm-reading-secondary"><article><h3>动手验证</h3><ol><li>先暂停，预测下一步哪些值会改变。</li><li>${lesson.presets ? `切换“输入案例”：${lesson.presets.map(esc).join(' / ')}，观察边界是否符合公式。` : '修改观察窗下的参数，比较各步骤和最后结果。'}</li><li>打开“想一想”检验理解，再点击“对应源码”${foundation ? '查看概念的应用位置' : '核对判断条件'}。</li></ol>${lesson.cost ? `<h3>计算成本</h3><p>${esc(lesson.cost)}</p>` : ''}${lesson.codeNote ? `<h3>这段知识在源码中怎么用</h3><p>${esc(lesson.codeNote)}</p>` : ''}</article><article><h3>本实验与真实实现的边界</h3><p>${esc(lesson.boundary)}</p><h3>放回 vLLM 执行过程看</h3><div class="algorithm-related">${related.map((l) => `<button data-lesson="${l.id}">${esc(l.title)} ↗</button>`).join('')}<button data-view="${foundation ? 'foundations' : 'algorithms'}">${foundation ? '返回前置基础' : '返回全部算法'} ↗</button></div>${lesson.citations ? `<div class="foundation-references"><h3>继续阅读原始资料</h3>${lesson.citations.map(([name, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(name)} ↗</a>`).join('')}</div>` : ''}</article></div></section>`;
}

function barsView(bars) {
  return `<div class="algorithm-bars">${bars
    .map((b, n) => {
      const maximum = Math.max(1e-12, ...b.values.map(Math.abs)),
        signed = b.values.some((v) => v < 0);
      return `<section class="algorithm-bar-panel" aria-label="${esc(b.name)}"><h3>${esc(b.name)}</h3>${b.values
        .map((v, i) => {
          const width = (Math.abs(v) / maximum) * (signed ? 50 : 100),
            left = signed ? (v < 0 ? 50 - width : 50) : 0;
          return `<div data-visual-key="alg-bar-${n}-${i}" class="algorithm-bar-row ${b.kept?.[i] === false ? 'masked' : ''} ${b.active === i ? 'active' : ''}"><b>${esc(b.labels[i])}</b><div class="algorithm-bar-track ${signed ? 'signed' : ''}"><i style="left:${left}%;width:${width}%" class="${v < 0 ? 'negative' : ''}"></i></div><code>${esc(number(v))}</code><small>${b.kept?.[i] === false ? '移除' : b.active === i ? '当前' : ''}</small></div>`;
        })
        .join(
          '',
        )}<p class="algorithm-chart-note">${signed ? '中线为 0；左侧负值，右侧正值。' : '每个面板独立缩放，以右侧数值为准。'}</p></section>`;
    })
    .join('')}</div>`;
}
const chips = (values, key, classes = () => '', labels = () => '') =>
  `<div class="algorithm-chips">${values.map((v, i) => `<span data-visual-key="${key}-${i}" class="algorithm-chip ${classes(i)}"><small>${esc(labels(i))}</small><b>${esc(number(v))}</b></span>`).join('') || '<span class="mechanism-empty">∅</span>'}</div>`;
function acceptanceView(f) {
  return `<section class="algorithm-acceptance"><h3>在 0 到 1 之间比较 u 和接受阈值</h3><div class="acceptance-track" role="img" aria-label="接受阈值 ${number(f.alpha)}，随机数 ${number(f.uniform)}"><i style="width:${100 * f.alpha}%"></i><span style="left:${100 * f.uniform}%" class="acceptance-pointer"></span></div><div class="acceptance-scale"><span>0 · 绿色为接受区间</span><b>阈值 ${number(f.alpha)} / u=${number(f.uniform)}</b><span>1</span></div><p>${!f.validProposal ? 'q(x)=0：此候选不能由当前 q 合法提出，源码防御性拒绝。' : f.stepIndex < 3 ? '先预测：随机数是否落在绿色区间内？' : f.decision ? '✓ 接受，u ≤ min(1,p/q)' : '× 拒绝，进入正残差恢复'}</p></section>`;
}
function massBalanceView(f) {
  const maximum = Math.max(...f.p);
  return `<section class="algorithm-bar-panel algorithm-mass-balance"><h3>每个 token：接受的质量 + 恢复的质量 = 目标概率</h3><p><span class="green-ink">绿色 min(p,q)</span> ＋ <span class="blue-ink">蓝色 R×r = max(p−q,0)</span></p>${f.p.map((p, i) => `<div class="algorithm-bar-row"><b>${String.fromCharCode(65 + i)}</b><div class="algorithm-bar-track"><i style="left:0;width:${(100 * f.accepted[i]) / maximum}%;background:#70ad8e"></i><i style="left:${(100 * f.accepted[i]) / maximum}%;width:${(100 * f.deficit[i]) / maximum}%"></i></div><code>${number(p)}</code><small>p</small></div>`).join('')}<p>R 是整体验证被拒绝的概率；r 是已经拒绝之后使用的条件分布。恢复质量是 R×r，不能直接把 r 加到接受质量上。</p></section>`;
}
function greedyView(f) {
  return `<div class="algorithm-token-compare"><h3>草稿与目标 argmax（位置从 0 开始）</h3><p>草稿</p>${chips(
    f.draft,
    'draft',
    (i) =>
      f.states[i] === '接受'
        ? 'accepted'
        : f.states[i] === '丢弃'
          ? 'discarded'
          : f.states[i] === '纠正'
            ? 'rejected'
            : '',
    (i) => `${i} · ${f.states[i]}`,
  )}<p>同一验证批次的目标预测</p>${chips(
    f.target,
    'target',
    (i) => (i > f.rejected && f.rejected >= 0 ? 'discarded' : ''),
    (i) => '位置 ' + i,
  )}<p>可提交的连续前缀 ${f.rejected >= 0 ? '· 拒绝后的旧预测不再有效' : ''}</p>${chips(f.confirmed, 'confirmed', () => 'accepted')}</div>`;
}
function ngramView(f) {
  return `<div class="algorithm-kmp"><h3>原历史 → 反转序列 → 候选</h3><p>原历史 · 高亮找到的旧片段</p>${chips(
    f.history,
    'history',
    (i) => (f.matchStart >= 0 && i >= f.matchStart && i < f.start ? 'accepted' : ''),
    (i) => i,
  )}<p>反转序列 · i 扫描，j 表示已匹配前缀长度</p>${chips(
    f.reversed,
    'reverse',
    (i) => (i === f.i ? 'cursor' : ''),
    (i) => (i === f.i ? 'i=' + i : i < f.j ? '前缀 ' + i : i),
  )}<p>LPS 回退表</p>${chips(
    f.lps,
    'lps',
    () => '',
    (i) => '索引 ' + i,
  )}<div class="metrics metrics-row">${metric(f.j, '匹配长度 j')}${metric(f.best, '最长匹配')}${metric(f.i, '扫描位置 i')}</div><p>提议候选 · 仍需目标模型验证</p>${chips(f.candidates || [], 'proposal', () => 'accepted')}</div>`;
}
function rotationView(f) {
  const point = (v) => [150 + v[0] * 70, 150 - v[1] * 70];
  const [x, y] = point(f.vector),
    [rx, ry] = point(f.rotated);
  return `<div class="algorithm-rotation"><svg viewBox="0 0 300 300" role="img" aria-label="RoPE 旋转：原向量 ${number(f.vector)}，旋转后 ${number(f.rotated)}"><circle cx="150" cy="150" r="100" fill="none" stroke="#dbe3ec"/><path d="M15 150H285 M150 15V285" stroke="#b9c5d6"/><text x="274" y="143">x</text><text x="160" y="25">y</text><line x1="150" y1="150" x2="${x}" y2="${y}" stroke="#5977d9" stroke-width="3"/><circle cx="${x}" cy="${y}" r="5" fill="#5977d9"/>${f.showRotated ? `<line data-visual-key="rope-line" x1="150" y1="150" x2="${rx}" y2="${ry}" stroke="#218871" stroke-width="4"/><circle cx="${rx}" cy="${ry}" r="5" fill="#218871"/>` : ''}</svg><div><h3>同一长度，新的方向</h3><p class="blue-ink">蓝色 · 原向量 ${esc(number(f.vector))}</p><p class="green-ink">绿色 · ${f.showRotated ? esc(number(f.rotated)) : '单步到旋转计算后显示'}</p><p>θ=${number(f.angle)} 弧度</p><p>cos θ=${number(f.cos)}<br>sin θ=${number(f.sin)}</p></div></div>`;
}
function addressView(f) {
  return `<div class="algorithm-address"><h3>逻辑位置 ${f.position} → 物理存储</h3><div class="algorithm-address-equation"><span>${f.position}</span><b>÷ ${f.blockSize}</b><span>块 ${f.stepIndex >= 1 ? f.logical : '?'}</span><b>查表 →</b><span>物理块 ${f.stepIndex >= 2 ? f.physical : '?'}</span><b>+ 偏移 →</b><span>slot ${f.stepIndex >= 3 ? f.slot : '?'}</span></div><div class="algorithm-physical-blocks">${Array.from(
    { length: 6 },
    (_, id) =>
      `<section class="${id === f.physical && f.stepIndex >= 2 ? 'active' : ''}"><b>物理块 ${id}</b>${chips(
        Array.from({ length: f.blockSize }, (_, i) => id * f.blockSize + i),
        'slot-' + id,
        (i) => (f.stepIndex >= 3 && id === f.physical && i === f.offset ? 'accepted' : ''),
      )}</section>`,
  ).join('')}</div></div>`;
}
function hashView(f) {
  return `<section class="algorithm-hash"><h3>哈希输入相等才复用 · Hₙ 是教学代号</h3>${f.inputs.map((tokens, row) => `<p>请求 ${row ? 'B' : 'A'} · salt=${esc(f.salt[row])}</p>${chips(tokens, 'hash-input-' + row)}`).join('')}${f.parts.map((parts, row) => `<div class="algorithm-hash-row"><b>请求 ${row ? 'B' : 'A'} 的键链</b>${parts.map((p, i) => `<div data-visual-key="hash-${row}-${i}" class="algorithm-hash-block ${row && p.alias === f.parts[0][i].alias ? 'accepted' : 'different'}"><small>块 ${i}</small><strong>${esc(p.alias)}</strong><code>${esc(p.expression)}</code></div>`).join('<span class="algorithm-arrow">→</span>')}</div>`).join('')}</section>`;
}
function queueView(f) {
  return `<section class="algorithm-cache"><h3>引用计数与可分配队列</h3><div class="algorithm-cache-blocks">${f.refs.map((ref, id) => `<div data-visual-key="cache-${id}" class="${ref ? 'occupied' : 'free'}"><b>物理块 ${id}</b><span>ref=${ref}</span><small>${f.taken.includes(id) ? '本轮新分配' : ref ? '正在使用' : '可分配'} · ${f.cached[id] ? '有缓存标签' : '旧标签已驱逐'}</small></div>`).join('')}</div><p>空闲队列：左侧先取，释放后加入右侧</p>${chips(
    f.queue.map((id) => '块 ' + id),
    'queue',
    () => 'accepted',
  )}<p>${f.blocked ? '容量不足：本次申请失败，队列与引用计数保持原样。' : f.taken.length ? '已分配：' + f.taken.join('、') : '在使用的块不能作为驱逐候选。'}</p></section>`;
}
const matrix = (name, values) =>
  `<div class="algorithm-matrix"><b>${esc(name)}</b>${values.map((row) => `<div>${row.map((v) => `<code>${esc(number(v))}</code>`).join('')}</div>`).join('')}</div>`;
function loraView(f) {
  return `<section class="algorithm-lora"><h3>y = Wx + sB(Ax)</h3><div class="algorithm-matrices">${matrix(
    'x',
    f.x.map((v) => [v]),
  )}${matrix('W · 2×3', f.W)}${matrix('A · 1×3', f.A)}${matrix('B · 2×1', f.B)}</div><div class="algorithm-lora-path"><span class="${f.show >= 1 ? 'active' : ''}">Wx = ${f.show >= 1 ? number(f.base) : '?'}</span><span>＋</span><span class="${f.show >= 2 ? 'active' : ''}">Ax = ${f.show >= 2 ? number(f.compressed) : '?'}</span><span>→</span><span class="${f.show >= 3 ? 'active' : ''}">sB(Ax) = ${f.show >= 3 ? number(f.delta) : '?'}</span><span>＝</span><span class="${f.show >= 4 ? 'active' : ''}">${f.show >= 4 ? number(f.output) : '最终输出'}</span></div></section>`;
}
function eplbView(f) {
  return `<section class="algorithm-eplb"><h3>逻辑专家 → 物理副本 → 设备</h3>${barsView([{ name: '每副本理想负载 L/c', values: f.loads.map((v, i) => v / f.counts[i]), labels: f.loads.map((v, i) => 'E' + i) }])}<div class="algorithm-replicas">${f.counts.map((n, i) => `<div><b>专家 ${i} · ${n} 份</b>${chips(Array(n).fill('E' + i), 'replica-' + i, () => 'accepted')}<small>逻辑总负载 ${number(f.loads[i])}</small></div>`).join('')}</div><div class="algorithm-device-packs">${f.packs
    .map(
      (pack, i) =>
        `<section><h3>设备 ${i} · 负载 ${number(f.packLoads[i])}</h3>${chips(
          pack.map((p) => (p.id === null ? '空槽' : `E${p.id} / ${number(p.weight)}`)),
          'pack-' + i,
        )}<small>${pack.length} / ${f.slots ?? '…'} 槽</small></section>`,
    )
    .join('')}</div></section>`;
}
function poolingView(f) {
  return `<section class="algorithm-pooling"><h3>${esc(f.mode)} · 有效 token 矩阵</h3>${table(
    ['位置', '向量', '本步'],
    f.inputs.map((v, i) => [i, esc(number(v)), f.active === i ? '← 当前读取' : '']),
    'Pooling 有效输入',
  )}${f.total ? `<p>当前${f.mode === 'Mean' ? '累计和' : '选中向量'} = <code>${esc(number(f.total))}</code></p>` : ''}</section>`;
}
export function algorithmScene(lesson, index, o, frames, leadingVisual = '') {
  if (lesson.slug === 'beam') return mechanismScene({ id: 'beam' }, index, o, frames);
  if (lesson.slug === 'dynamic') return mechanismScene({ id: 'dynamic-spec' }, index, o, frames);
  const f = frames[index];
  const extras = [
    f.acceptance && acceptanceView(f),
    f.massBalance && massBalanceView(f),
    f.tokens && greedyView(f),
    f.ngram && ngramView(f),
    f.rotation && rotationView(f),
    f.address && addressView(f),
    f.hash && hashView(f),
    f.cacheQueue && queueView(f),
    f.lora && loraView(f),
    f.eplb && eplbView(f),
    f.pooling && poolingView(f),
  ]
    .filter(Boolean)
    .join('');
  return `<div class="algorithm-scene"><div class="scene-caption"><span>数值推演 · ${esc(f.title ?? lesson.steps[f.stepIndex].title)}</span><span>${index + 1} / ${frames.length}</span></div>${leadingVisual}${extras}${f.bars && !f.massBalance ? barsView(f.bars) : ''}${f.metrics ? `<div class="metrics metrics-row">${f.metrics.map(([v, l]) => metric(number(v), l)).join('')}</div>` : ''}${
    f.table
      ? table(
          f.table.head,
          f.table.rows.map((row) => row.map((v) => esc(number(v)))),
          '本步计算明细',
        )
      : ''
  }<div class="state-strip"><span>本步计算</span><code>${f.events.map(esc).join(' ')}</code></div></div>`;
}
